"""辅导编排器（对齐 03 引擎层 / 02 M2 F2 冻结点）。

把 诊断 → 路径 → 讲解（四态）→ 练习 → 反馈 串成闭环。
- 诊断：复用 KST 选题 + BKT 更新（engine/diagnostic）
- 路径：graph_engine.plan_path
- 讲解：苏格拉底四态状态机（state_machine）
- 输出：全部经 OutputSanitizer 自检；LLM 回复经 LLMGateway（无 key 自动 mock）
- 纯内存态（M3 持久化到 PG）

CLI 演示：python -m app.cli tutor [--pack junior_math_eq_ineq] [--seed 42]
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field

from app.domain.loader import load_pack
from app.engine.diagnostic import bkt_update, select_next_question
from app.engine.graph_engine import KnowledgeGraph, plan_path
from app.engine.llm_gateway.gateway import LLMGateway
from app.engine.llm_gateway import templates
from app.engine.state_machine.frustration import assess_frustration
from app.engine.state_machine.output_sanitizer import OutputSanitizer
from app.engine.state_machine.state_machine import TutorStateMachine
from app.engine.state_machine.states import Event, State

# mock 引导语（确定性，按提示层级递增；均不泄露答案，对齐引导语评估规范）
_HINTS = [
    "再想一想：这一步的依据是什么？能不能先说出来？",
    "提示：注意这里容易错在符号上，检查一下你的推导。",
    "换个角度：如果是这个知识点，你会先处理哪一部分？",
]


@dataclass
class TurnResult:
    """一轮辅导的输出（供 CLI/前端渲染）。"""

    state: str
    message: str
    degraded: bool = False
    mock: bool = False
    context: dict = field(default_factory=dict)


class TutorOrchestrator:
    def __init__(self, pack_id: str = "junior_math_eq_ineq", gateway=None, user_api_key: str | None = None) -> None:
        self.pack = load_pack(pack_id)
        self.graph = KnowledgeGraph(self.pack.graph)
        self.rules = self.pack.diagnostic_rules
        self.gateway = gateway or LLMGateway()
        # M4r24d：按用户 key 调用 LLM（此前编排器不传 key → 永远 mock 模板）
        self.user_api_key = user_api_key
        self.sanitizer = OutputSanitizer()
        self.sm = TutorStateMachine()
        self.mastery: dict[str, float] = {
            nid: self.rules.bkt.p_l0 for nid in self.graph.node_ids
        }
        self.answered_counts: dict[str, int] = {}
        self.recent: dict[str, int] = {}  # M4r20：节点连续作答次数（出题轮换）
        self.pool: list = list(self.pack.questions)
        self.current_question = None
        self.path: list[str] = []
        self.weak_nodes: list[str] = []
        self.verify_question = None
        self.history: list[str] = []
        # M4r5：诊断配置（题型/题量/难度，前端自主选择）
        self.diag_config: dict = {"qtypes": ["choice", "blank", "open"], "qcount": 10, "difficulty": "auto"}
        # M4r7h：辅导题库（按配置过滤）+ 练习轮数
        self.tutor_pool: list = list(self.pack.questions)
        self.max_rounds: int = 1
        self.practice_rounds: int = 0
        self._used_nodes: set[str] = set()  # M5：本会话已巩固的知识点（循环选题不重复；恢复会话兜底初始化）
        self.review_queue: list[str] = []  # M5：错题复习队列（qid，去重；复习答对移除）
        self.review_tries: dict[str, int] = {}  # M5：错题复习次数（≥2 次未答对 → 移出队列防无限反复）
        self.due_override: list[str] = []  # M6：跨会话到期复习题（routes 层按 SM-2 调度表注入，优先出题）
        self.due_count: int = 0  # M6：跨会话到期复习题数（routes 层刷新，完成提示用）
        self.is_review: bool = False  # M5：当前题是否为错题复习题
        self.current_node: str | None = None  # M4r7i：当前辅导知识点（变式题匹配依据）
        self._ease_verify: bool = False  # M4r20 T3：挫败后变式降档标记

    # ---------- 阶段 1：诊断 ----------

    def start_diagnosis(self, config: dict | None = None) -> dict:
        """初始化诊断：按配置过滤题型/难度/题量，选第一题（不消耗作答）。"""
        if config:
            merged = dict(self.diag_config)
            merged.update({k: v for k, v in config.items() if v is not None})
            self.diag_config = merged
        qtypes = self.diag_config.get("qtypes") or ["choice", "blank", "open"]
        diff = self.diag_config.get("difficulty", "auto")
        base_pool = [q for q in self.pack.questions if q.type in qtypes]
        qcount_target = int(self.diag_config.get("qcount", 10))
        if diff != "auto":
            # M4r21g/M5：难度过滤后若题库不足 qcount，自动放宽难度凑够——双向放宽（hard 不足并入 medium，easy 不足并入 medium/hard），
            # 避免"选了 15 题实际只出 1 题"（此前只向更高难度放宽，hard 已是最顶无法凑够）
            levels = ["easy", "medium", "hard"]
            lo_hi = {"easy": (0, 0.34), "medium": (0.34, 0.66), "hard": (0.66, 1.01)}
            pool = [q for q in base_pool if lo_hi[diff][0] <= q.difficulty < lo_hi[diff][1]]
            if len(pool) < qcount_target:
                expanded = list(pool)
                for lv in levels:
                    if len(expanded) >= qcount_target:
                        break
                    if lv == diff:
                        continue
                    expanded.extend(q for q in base_pool if lo_hi[lv][0] <= q.difficulty < lo_hi[lv][1])
                pool = expanded
                # 记录实际放宽后的难度范围（供结束语提示）
                self.diag_config["_actual_difficulty"] = diff if len(pool) >= qcount_target else f"{diff}→放宽"
            else:
                self.diag_config["_actual_difficulty"] = diff
        else:
            pool = list(base_pool)
        self.pool = pool
        self.recent = {}
        self.current_question = select_next_question(
            self.mastery, self.pool, self.rules, self.recent
        )
        return self._diag_state()

    def diagnose(self, correct: bool) -> dict:
        """提交一题作答，推进 BKT 与选题；返回当前收敛状态。"""
        if self.current_question is None:
            self.current_question = select_next_question(
                self.mastery, self.pool, self.rules, self.recent
            )
            return self._diag_state()
        q = self.current_question
        # M4r20：更新连续作答计数（本轮涉及的节点 +1，其他节点清零）
        touched = set(q.step_node_map.values())
        for nid in self.recent:
            if nid not in touched:
                self.recent[nid] = 0
        for nid in touched:
            self.recent[nid] = self.recent.get(nid, 0) + 1
        for nid in q.step_node_map.values():
            self.mastery[nid] = bkt_update(self.mastery[nid], correct, self.rules.bkt)
            self.answered_counts[nid] = self.answered_counts.get(nid, 0) + 1
        if q in self.pool:
            self.pool.remove(q)
        self.current_question = select_next_question(
            self.mastery, self.pool, self.rules, self.recent
        )
        return self._diag_state()

    def _diag_state(self) -> dict:
        # M4r5：用户自选题量上限（qcount）优先于置信度终止
        answered = sum(self.answered_counts.values())
        max_q = int(self.diag_config.get("qcount", 10))
        if self.current_question is None or answered >= max_q:
            # M4r20 D3：结束语带薄弱点总结 + 引导下一步
            weak = min(self.mastery, key=self.mastery.get) if self.mastery else None
            summary = (
                f"诊断完成。最薄弱的是「{weak}」（掌握度 {round(self.mastery[weak] * 100)}%），"
                "建议进入辅导练习针对性地巩固。"
                if weak
                else "诊断完成。"
            )
            return {
                "stage": "diagnose",
                "done": True,
                "qcount": max_q,
                "answered": answered,
                "weakest": weak,
                "summary": summary,
            }
        weak = min(self.mastery, key=self.mastery.get)
        confident = (1 - self.mastery[weak]) >= self.rules.termination.confidence_threshold
        return {
            "stage": "diagnose",
            "done": False,
            "question": self.current_question,
            "weakest": weak,
            "confidence": round(1 - self.mastery[weak], 3),
            "terminated": confident,
            "qcount": max_q,
            "answered": answered,
        }

    # ---------- 阶段 2：路径 ----------

    def build_path(self) -> list[str]:
        weak = min(self.mastery, key=self.mastery.get)
        self.weak_nodes = [n for n, m in self.mastery.items() if m <= self.mastery[weak] + 0.05]
        self.path = plan_path(self.graph, self.weak_nodes)
        return self.path

    # ---------- 阶段 3：四态辅导 ----------

    def tutor_start(self, config: dict | None = None) -> TurnResult:
        """进入辅导：按配置（题型/难度/练习轮数）过滤题库，给出第一个引导。

        M4r7h：辅导也支持题量（练习轮数）/题型/难度配置（对齐诊断）。
        """
        if config:
            merged = dict(self.diag_config)
            merged.update({k: v for k, v in config.items() if v is not None})
            self.diag_config = merged
        # 辅导题库过滤（变式题来源）
        qtypes = self.diag_config.get("qtypes") or ["choice", "blank", "open"]
        diff = self.diag_config.get("difficulty", "auto")
        base_pool = [q for q in self.pack.questions if q.type in qtypes]
        if diff != "auto":
            levels = ["easy", "medium", "hard"]
            lo_hi = {"easy": (0, 0.34), "medium": (0.34, 0.66), "hard": (0.66, 1.01)}
            pool = [q for q in base_pool if lo_hi[diff][0] <= q.difficulty < lo_hi[diff][1]]
            # M5：所选难度题量不足（如 hard 档全库仅 1 题）→ 双向放宽（并入相邻难度）凑够 max_rounds，
            # 避免"选了 15 道题实际只出 1 道"
            if len(pool) < self.max_rounds:
                expanded = list(pool)
                for lv in levels:
                    if len(expanded) >= self.max_rounds:
                        break
                    if lv == diff:
                        continue
                    expanded.extend(q for q in base_pool if lo_hi[lv][0] <= q.difficulty < lo_hi[lv][1])
                pool = expanded
                self.diag_config["_actual_difficulty"] = diff if len(pool) >= self.max_rounds else f"{diff}→放宽"
        else:
            pool = list(base_pool)
        self.tutor_pool = pool
        # 练习轮数：仅在 config 显式提供 qcount 时生效（诊断默认 10 不串扰辅导）
        qc = config.get("qcount") if config else None
        self.max_rounds = max(1, int(qc)) if qc is not None else 1
        self.practice_rounds = 0
        self._used_nodes: set[str] = set()  # M5：本会话已巩固的知识点（循环选题不重复）
        self.review_queue = []  # M5：错题复习队列（去重；复习答对移除）
        self.review_tries = {}  # M5：错题复习次数（≥2 次未答对 → 移出队列防无限反复）
        self.is_review = False  # M5：当前题是否为错题复习题
        self.sm.reset()
        if not self.path:
            self.build_path()
        return self._tutor_start_round()

    def _pick_node_question(self, exclude_id: str | None = None):
        """从路径中顺延选择首个有可用题的节点；同节点内按难度递进（M4r20 T1）。

        exclude_id: 排除某题（变式验证避免重复原题，T2）。
        """
        path = self.path or []
        all_cands = list(path) + [n for n in self.graph.node_ids if n not in path]
        # M5：优先选未巩固过的知识点（题量 > 路径长度时从全图补足且不重复）；全部练过才允许重复
        candidates = [n for n in all_cands if n not in self._used_nodes] or all_cands
        for n in candidates:
            # M5：错题已在复习队列中，不作为新题重复出（由复习机制随机间隔插入）
            qs = [
                q for q in self.tutor_pool
                if n in q.step_node_map.values()
                and q.id != exclude_id
                and q.id not in self.review_queue
            ]
            if not qs:
                continue
            # 难度递进：先易后难（辅导从低难度题切入，逐步加难）
            return n, min(qs, key=lambda q: q.difficulty)
        return None, None

    def _pick_verify(self):
        """变式验证题：同节点、排除当前题、难度略高于原题（形成梯度，T1+T2）。

        无排除后可用题 → 用 variant_generator 生成变式；仍无 → None。
        挫败降档（T3）：_ease_verify 为真时选更低难度，用后复位。
        """
        node = self.current_node or (self.path[0] if self.path else None)
        cur = self.verify_question
        cands = [
            q for q in self.tutor_pool
            if node in q.step_node_map.values() and q.id != (cur.id if cur else None)
        ]
        base = cur.difficulty if cur else 0.5
        if self._ease_verify:
            # 挫败降档：选明显更低难度的题
            self._ease_verify = False
            lower = [q for q in cands if q.difficulty <= base - 0.15]
            return min(lower, key=lambda q: q.difficulty) if lower else (
                min(cands, key=lambda q: q.difficulty) if cands else None
            )
        if cands:
            # 难度递进：选略高于当前题难度的（若存在），否则取最高
            higher = [q for q in cands if q.difficulty >= base - 0.05]
            return min(higher, key=lambda q: q.difficulty) if higher else min(cands, key=lambda q: q.difficulty)
        # 同节点无其他题 → 生成变式（排除原题，参数化改数字）
        # M4r23：seed 改为随机（此前 hash(node) 固定 → 同一知识点永远同一变式，单调）
        # M5：生成后校验内容/答案与原题是否完全相同（如题干无数字可偏移的文本题）→
        #     完全相同视为"无真变式"返回 None，由错题复习机制替代（避免"变式=原题"）
        if cur is not None:
            try:
                from app.engine.variant_generator import generate_variant

                res = generate_variant(cur, seed=random.randint(1, 10**6))
                if res.question is not None and not self._is_same_question(res.question, cur):
                    return res.question
            except Exception:
                pass
        return None

    @staticmethod
    def _is_same_question(a, b) -> bool:
        """变式真伪判定：归一化（去空白/`$`）后题干与答案完全相同 → 视为同一题（无真变式）。"""
        import re as _re

        norm = lambda s: _re.sub(r"[\s$]", "", str(s))  # noqa: E731
        return norm(a.content) == norm(b.content) and norm(a.answer) == norm(b.answer)

    def _record_wrong(self, qid: str | None) -> None:
        """M5：记录错题（去重）——后续随机间隔复习。"""
        if qid and qid not in self.review_queue:
            self.review_queue.append(qid)

    def _clear_review(self, qid: str | None) -> None:
        """M5：复习答对 → 移出错题队列。"""
        if qid and qid in self.review_queue:
            self.review_queue.remove(qid)

    def _tutor_start_round(self) -> TurnResult:
        """启动一轮辅导：从路径中顺延选择首个有可用题的节点（M4r7i）。"""
        self.sm.reset()
        node, q = self._pick_node_question()
        self.current_node = node
        self.verify_question = q
        if self.verify_question is None:
            return TurnResult(
                state=self.sm.state.value,
                message="当前配置（题型/难度）下暂无可用题目，请调整配置后再试。",
                context=dict(self.sm.context),
            )
        msg = f"我们来看这个知识点：{node}。先试试这道题。"
        ctx = dict(self.sm.context)
        ctx["is_review"] = False  # M5：首次出题为新题
        ctx["progress"] = {"practice": self.practice_rounds, "total": self.max_rounds, "review_left": len(self.review_queue)}
        return TurnResult(state=self.sm.state.value, message=msg, context=ctx)

    def tutor_step(self, user_msg: str, correct: bool | None = None) -> TurnResult:
        """处理学生一条回复，推进状态机并产出引导。

        correct: 判断题的场景由编排层判定对错；开放对话由正确性分析（M3 起）提供。
        """
        state = self.sm.state

        # 连续错误统一累积（VERIFY 态由状态机 VERIFY_FAIL 事件递增，此处不加）
        if correct is False and state in (State.ELICIT, State.IDENTIFY):
            self.sm.context["consecutive_wrong"] += 1

        # 挫败感检测（任一作答态）
        # M5：错题复习——判错记入复习队列（去重）；复习题答对移出；复习题 2 次未答对移出（交复盘，防无限反复）
        if correct is False and self.verify_question is not None:
            qid = self.verify_question.id
            self._record_wrong(qid)
            if self.is_review:
                tries = self.review_tries.get(qid, 0) + 1
                self.review_tries[qid] = tries
                if tries >= 2:
                    self._clear_review(qid)
        elif correct is True and self.is_review and self.verify_question is not None:
            self._clear_review(self.verify_question.id)

        if correct is False and state in (State.ELICIT, State.IDENTIFY, State.HINT, State.VERIFY):
            fa = assess_frustration(self.sm.context, user_msg)
            if fa.action == "switch_explain":
                self.sm.step(Event.GIVE_UP, frustrate="switch_explain")
                # M4r20 T3：挫败降档——后续变式题自动选更低难度
                self._ease_verify = True
                return TurnResult(
                    state=self.sm.state.value,
                    message="没关系，我们换个方式：先看看这类题的关键步骤，再试一次。",
                    context=dict(self.sm.context),
                )

        # 状态转移
        if state == State.ELICIT:
            if correct is True:
                # M5：先判定是否有真变式——有则进变式验证；无（同节点无题且参数化无效）则直接通过本题
                vq = self._pick_verify()
                if vq is not None:
                    self.sm.step(Event.ANSWER_CORRECT)
                    self.verify_question = vq
                    return TurnResult(
                        state=self.sm.state.value,
                        message="再来一道变式验证，请看下方题目。",
                        context=dict(self.sm.context),
                    )
                return self._finish_question(True)
            self.sm.step(Event.LOCATED)
            # M4r24c：ELICIT 求助（"我不会/讲讲"）→ 针对性提示，替代固定"先说说你的思路"
            targeted = self._gen_targeted_hint(0)
            return TurnResult(
                state=self.sm.state.value,
                message=targeted or "先说说你的思路，卡在哪一步了？",
                context=dict(self.sm.context),
            )
        if state == State.IDENTIFY:
            if correct is True:
                self.sm.step(Event.CLASSIFIED, error_category="concept")
                return self._hint_turn()
            if correct is None:
                # M4r24h：IDENTIFY 态求助 → 针对性提示，不推进状态机
                _seek = ("我不会", "讲讲", "帮我", "教教", "求助", "不懂", "怎么解", "提示我")
                if any(k in user_msg for k in _seek):
                    targeted = self._gen_targeted_hint(1)
                    return TurnResult(
                        state=self.sm.state.value,
                        message=targeted or "先想想刚答错的这步，依据是什么？",
                        context=dict(self.sm.context),
                    )
            self.sm.step(Event.CLASSIFIED, error_category="operation")
            return self._hint_turn()
        if state == State.HINT:
            # M4r24h：HINT 态输入区分——求助类 → 给针对性提示不推进；
            # 其他（"好，我按提示想想"）→ 正常 HINT_GIVEN → 变式验证
            _seek = ("我不会", "讲讲", "帮我", "教教", "求助", "不懂", "怎么解", "提示我")
            if correct is None and any(k in user_msg for k in _seek):
                targeted = self._gen_targeted_hint(1)
                return TurnResult(
                    state=self.sm.state.value,
                    message=targeted or "先想想刚答错的这步，依据是什么？",
                    context=dict(self.sm.context),
                )
            # M5：引导结束（不再进变式验证，答错题已记入复习队列）→ 进入下一题
            self.sm.step(Event.HINT_GIVEN)
            return self._finish_question(False)
        if state == State.VERIFY:
            if correct is True:
                self.sm.step(Event.VERIFY_PASS)
                return self._finish_question(True)
            self.sm.step(Event.VERIFY_FAIL)
            return self._identify_turn()
        # DONE
        return TurnResult(
            state=self.sm.state.value, message="本轮完成，可以开始下一题。", context=dict(self.sm.context)
        )

    def _hint_turn(self) -> TurnResult:
        """给出最小提示并停留在 HINT 态（等待学生回应后由 HINT 分支触发 HINT_GIVEN → 变式验证）。

        M4r24c：提示结合当前题目——有 key 时用 LLM 生成针对性提示（不泄露答案），
        无 key/mock 时用题目知识点 + 题干关键词构造针对性话术，替代固定 _HINTS 模板。
        """
        level = min(self.sm.context["hint_level"], len(_HINTS) - 1)
        # 针对性提示（优先 LLM，回退题目信息模板）
        targeted = self._gen_targeted_hint(level)
        raw = targeted or _HINTS[level]
        res = self.sanitizer.sanitize(raw, question=self.verify_question, fallback=_HINTS[level])
        return TurnResult(
            state=self.sm.state.value,  # hint
            message=res.text,
            degraded=res.degraded,
            context=dict(self.sm.context),
        )

    def _gen_targeted_hint(self, level: int) -> str | None:
        """生成结合当前题目的针对性提示。有 key → LLM；无 key → 题目信息模板。

        返回 None 表示放弃（回退 _HINTS 模板）。均不泄露答案。
        """
        q = self.verify_question
        if q is None:
            return None
        node = self.current_node or next(iter(q.step_node_map.values()), None)
        # 题干去 LaTeX/占位符，取前 60 字
        import re as _re

        brief = _re.sub(r"[_\\{}${}]", "", q.content)[:60]
        try:
            prompt = (
                f"你是苏格拉底式辅导老师。学生卡在下面这道题，请给出一个【提示】帮 TA 继续思考，"
                f"但绝不要直接给出答案或完整步骤。\n"
                f"题目：{brief}\n"
                f"涉及知识点：{node}\n"
                f"提示层级：{'最模糊' if level == 0 else '中等' if level == 1 else '较具体但无答案'}\n"
                f"只输出 1-2 句提示，不要解释，不要给答案。"
            )
            resp = self.gateway.generate("tutor", prompt, ctx={"max_tokens": 120, "temperature": 0.7, "user_api_key": self.user_api_key})
            # M4r24c：mock/降级响应无针对性（固定模板）→ 丢弃，用题目信息回退
            if getattr(resp, "mock", False) or getattr(resp, "level", 0) >= 1:
                raise ValueError("mock response, use fallback")
            text = (resp.text or "").strip()
            if len(text) >= 8 and len(text) <= 200:
                return text
        except Exception:
            pass
        # 无 key/失败回退：用题目知识点构造（仍针对性，不泄露答案）
        if node:
            return f"这道题围绕「{node}」，先回忆一下这个知识点涉及的关键概念，再对照题目试试。"
        return None

    def _verify_turn(self) -> TurnResult:
        self.verify_question = self._pick_verify()
        msg = "再来一道变式验证，请看下方题目。"
        return TurnResult(state=self.sm.state.value, message=msg, context=dict(self.sm.context))

    def _finish_question(self, passed: bool) -> TurnResult:
        """M5：本题结束统一出口——passed=True（答对巩固完成）记已巩固节点；passed=False（答错引导完）不记。
        复习题不占题量额度；新题占额度；满额 → 完成总结（提示剩余错题）。"""
        if not self.is_review:
            if passed and self.current_node:
                self._used_nodes.add(self.current_node)
            self.practice_rounds += 1
        if self.practice_rounds >= self.max_rounds:
            weak = "、".join((self.weak_nodes or ["—"])[:3])
            self.verify_question = None
            left = (
                f"还有 {self.due_count} 道复习到期（按遗忘曲线），可开启新会话复习。"
                if self.due_count
                else ""
            )
            return TurnResult(
                state=State.DONE.value,
                message=(
                    f"🎉 本轮练习完成！巩固了 {self.practice_rounds} 个知识点。"
                    f"当前薄弱点是：{weak}。{left}"
                ),
                context=dict(self.sm.context),
            )
        node, q = self._next_question()
        self.current_node = node
        self.verify_question = q
        if q is None:
            return TurnResult(
                state=State.DONE.value,
                message="当前配置下暂无更多题目，本轮练习到此结束。",
                context=dict(self.sm.context),
            )
        # M5：进入下一题前重置状态机（此前 VERIFY 分支的 sm.reset() 被吸收进统一出口，遗漏会卡死在 DONE 态）
        self.sm.reset()
        ctx = dict(self.sm.context)
        ctx["is_review"] = self.is_review  # M5：复习题标记（前端显示"复习"徽标）
        ctx["progress"] = {"practice": self.practice_rounds, "total": self.max_rounds, "review_left": len(self.review_queue)}
        msg = "这是之前答错的题，再试一次。" if self.is_review else f"很好，这一步掌握了！进入下一个知识点：{node}。先试试这道题。"
        return TurnResult(
            state=State.ELICIT.value,
            message=msg,
            context=ctx,
        )

    def _next_question(self) -> tuple[str | None, Question | None]:
        """M6：下一题——跨会话到期复习（SM-2 调度，routes 注入 due_override）优先，
        其次会话内随机队列（无 db 环境），最后新知识点题。"""
        # M6：SM-2 到期复习题（跨会话持久化）
        if self.due_override:
            qid = self.due_override.pop(0)
            q = next((x for x in self.pack.questions if x.id == qid), None)
            if q is not None:
                self.is_review = True
                return next(iter(q.step_node_map.values()), None), q
            self.is_review = False
            return self._pick_node_question()
        # 原有：会话内随机队列（兼容无 db 环境）
        if self.review_queue and random.random() < 0.25:
            cur_id = self.verify_question.id if self.verify_question else None
            cands = [qid for qid in self.review_queue if qid != cur_id]
            if cands:
                qid = random.choice(cands)
                q = next((x for x in self.pack.questions if x.id == qid), None)
                if q is not None:
                    self.is_review = True
                    return next(iter(q.step_node_map.values()), None), q
        self.is_review = False
        return self._pick_node_question()

    def explain_question(self) -> str:
        """灯泡求助（M5 抽卡）：对当前题生成简短易懂的讲解/提示，不直接给最终答案。

        HINT 态复用状态机提示（逐层递进）；其余状态生成 2-3 句讲解思路。
        无 key / LLM 失败时回退模板。
        """
        q = self.verify_question or self.current_question
        if q is None:
            return "当前没有题目，先开始作答吧。"
        node = self.current_node or next(iter(q.step_node_map.values()), None)
        # HINT 态：灯泡内容 = 状态机提示（层级递进）
        if self.sm.state == State.HINT:
            level = min(self.sm.context.get("hint_level", 0), len(_HINTS) - 1)
            targeted = self._gen_targeted_hint(level)
            return targeted or _HINTS[level]
        # 其余状态：简短讲解思路
        import re as _re

        brief = _re.sub(r"[_\\{}${}]", "", q.content)[:80]
        try:
            prompt = (
                "你是苏格拉底式辅导老师。学生点了求助灯泡，请用 2-3 句简短、易懂的话讲清楚这道题的【思考思路】，"
                "帮 TA 找到入手点，但不要直接给出最终答案或完整步骤。\n"
                f"题目：{brief}\n"
                f"涉及知识点：{node}\n"
                "只输出 2-3 句话，不要标题，不要多余解释。"
            )
            resp = self.gateway.generate(
                "tutor",
                prompt,
                ctx={"max_tokens": 150, "temperature": 0.7, "user_api_key": self.user_api_key},
            )
            if not getattr(resp, "mock", False) and getattr(resp, "level", 0) < 1:
                text = (resp.text or "").strip()
                if 8 <= len(text) <= 300:
                    return text
        except Exception:
            pass
        if node:
            return (
                f"这道题围绕「{node}」：先回忆这个知识点的关键概念，"
                "再看题目给了什么条件、要求什么，从这两个角度找入手点。"
            )
        return "先读题，标出已知条件和要求，再想它考的是哪个知识点、对应什么方法。"

    def _identify_turn(self) -> TurnResult:
        self.sm.step(Event.CLASSIFIED, error_category="operation")
        return TurnResult(
            state=self.sm.state.value,
            message="变式没过，我们重新定位：这题你第一步做了什么？",
            context=dict(self.sm.context),
        )

    # ---------- 状态快照（M3 会话恢复） ----------

    def save_state(self) -> dict:
        """导出可持久化状态快照（存 sessions.context）。"""
        return {
            "sm": self.sm.to_dict(),
            "mastery": dict(self.mastery),
            "path": list(self.path),
            "weak_nodes": list(self.weak_nodes),
            "answered_counts": dict(self.answered_counts),
            "pack_id": self.pack.manifest.id,
            "current_question_id": self.current_question.id
            if self.current_question
            else None,
            "pool_ids": [q.id for q in self.pool],
            "diag_config": dict(self.diag_config),
            "verify_question_id": self.verify_question.id
            if self.verify_question
            else None,
            # M4r21c：变式题不在题库，恢复需完整内容（否则 restore 后变式题丢失）
            "verify_question_data": (
                {
                    "id": self.verify_question.id,
                    "type": self.verify_question.type,
                    "content": self.verify_question.content,
                    "options": self.verify_question.options,
                    "answer": self.verify_question.answer,
                    "difficulty": self.verify_question.difficulty,
                    "step_node_map": self.verify_question.step_node_map,
                }
                if self.verify_question
                else None
            ),
            "practice_rounds": self.practice_rounds,
            "max_rounds": self.max_rounds,
            "current_node": self.current_node,
            "ease_verify": self._ease_verify,
        }

    def restore_state(self, state: dict) -> None:
        """从快照恢复（重启后重建会话，恢复 100%）。"""
        if state.get("pack_id") and state["pack_id"] != self.pack.manifest.id:
            raise ValueError(
                f"快照领域包 {state['pack_id']} 与当前 {self.pack.manifest.id} 不一致"
            )
        self.sm = TutorStateMachine.from_dict(state["sm"])
        self.mastery.update(state.get("mastery", {}))
        self.path = list(state.get("path", []))
        self.weak_nodes = list(state.get("weak_nodes", []))
        self.answered_counts = dict(state.get("answered_counts", {}))
        # 恢复诊断进度：当前题与剩余题库（缺省回退全量）
        cqid = state.get("current_question_id")
        if cqid:
            self.current_question = next(
                (q for q in self.pack.questions if q.id == cqid), None
            )
        pool_ids = state.get("pool_ids")
        if pool_ids is not None:
            by_id = {q.id: q for q in self.pack.questions}
            self.pool = [by_id[i] for i in pool_ids if i in by_id]
        # M4r5：恢复诊断配置（题型/题量/难度）
        if state.get("diag_config"):
            self.diag_config.update(state["diag_config"])
        # M4r7f：恢复辅导变式题（AI 判题对象）
        vqid = state.get("verify_question_id")
        if vqid:
            self.verify_question = next(
                (q for q in self.pack.questions if q.id == vqid), None
            )
            # M4r21c：变式题不在题库（动态生成）→ 用快照保存的完整内容重建
            if self.verify_question is None and state.get("verify_question_data"):
                from app.domain.schemas import Question  # 局部导入（避免循环依赖）

                d = state["verify_question_data"]
                try:
                    self.verify_question = Question(**d)
                except Exception:
                    self.verify_question = None
        # M4r7h：恢复辅导题库与练习轮数
        self.max_rounds = int(state.get("max_rounds", self.max_rounds))
        self.practice_rounds = int(state.get("practice_rounds", 0))
        self.current_node = state.get("current_node")
        self._ease_verify = bool(state.get("ease_verify", False))  # M4r20 T3
        qtypes = self.diag_config.get("qtypes") or ["choice", "blank", "open"]
        diff = self.diag_config.get("difficulty", "auto")
        pool = [q for q in self.pack.questions if q.type in qtypes]
        if diff != "auto":
            lo, hi = {"easy": (0, 0.34), "medium": (0.34, 0.66), "hard": (0.66, 1.01)}[diff]
            pool = [q for q in pool if lo <= q.difficulty < hi]
        self.tutor_pool = pool

    # ---------- 阶段 4：反馈 ----------

    def summary(self) -> str:
        if not self.weak_nodes:
            self.build_path()
        return (
            "本轮小结：薄弱点是 "
            + "、".join(self.weak_nodes[:3])
            + "。建议按路径 "
            + " → ".join(self.path[:5])
            + " 顺序巩固。"
        )
