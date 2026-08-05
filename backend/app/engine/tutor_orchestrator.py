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
    def __init__(self, pack_id: str = "junior_math_eq_ineq", gateway=None) -> None:
        self.pack = load_pack(pack_id)
        self.graph = KnowledgeGraph(self.pack.graph)
        self.rules = self.pack.diagnostic_rules
        self.gateway = gateway or LLMGateway()
        self.sanitizer = OutputSanitizer()
        self.sm = TutorStateMachine()
        self.mastery: dict[str, float] = {
            nid: self.rules.bkt.p_l0 for nid in self.graph.node_ids
        }
        self.answered_counts: dict[str, int] = {}
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
        self.current_node: str | None = None  # M4r7i：当前辅导知识点（变式题匹配依据）

    # ---------- 阶段 1：诊断 ----------

    def start_diagnosis(self, config: dict | None = None) -> dict:
        """初始化诊断：按配置过滤题型/难度/题量，选第一题（不消耗作答）。"""
        if config:
            merged = dict(self.diag_config)
            merged.update({k: v for k, v in config.items() if v is not None})
            self.diag_config = merged
        qtypes = self.diag_config.get("qtypes") or ["choice", "blank", "open"]
        diff = self.diag_config.get("difficulty", "auto")
        pool = [q for q in self.pack.questions if q.type in qtypes]
        if diff != "auto":
            lo, hi = {"easy": (0, 0.34), "medium": (0.34, 0.66), "hard": (0.66, 1.01)}[diff]
            pool = [q for q in pool if lo <= q.difficulty < hi]
        self.pool = pool
        self.current_question = select_next_question(
            self.mastery, self.pool, self.rules
        )
        return self._diag_state()

    def diagnose(self, correct: bool) -> dict:
        """提交一题作答，推进 BKT 与选题；返回当前收敛状态。"""
        if self.current_question is None:
            self.current_question = select_next_question(self.mastery, self.pool, self.rules)
            return self._diag_state()
        q = self.current_question
        for nid in q.step_node_map.values():
            self.mastery[nid] = bkt_update(self.mastery[nid], correct, self.rules.bkt)
            self.answered_counts[nid] = self.answered_counts.get(nid, 0) + 1
        if q in self.pool:
            self.pool.remove(q)
        self.current_question = select_next_question(self.mastery, self.pool, self.rules)
        return self._diag_state()

    def _diag_state(self) -> dict:
        # M4r5：用户自选题量上限（qcount）优先于置信度终止
        answered = sum(self.answered_counts.values())
        max_q = int(self.diag_config.get("qcount", 10))
        if self.current_question is None or answered >= max_q:
            return {
                "stage": "diagnose",
                "done": True,
                "qcount": max_q,
                "answered": answered,
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
        pool = [q for q in self.pack.questions if q.type in qtypes]
        if diff != "auto":
            lo, hi = {"easy": (0, 0.34), "medium": (0.34, 0.66), "hard": (0.66, 1.01)}[diff]
            pool = [q for q in pool if lo <= q.difficulty < hi]
        self.tutor_pool = pool
        # 练习轮数：仅在 config 显式提供 qcount 时生效（诊断默认 10 不串扰辅导）
        qc = config.get("qcount") if config else None
        self.max_rounds = max(1, int(qc)) if qc is not None else 1
        self.practice_rounds = 0
        self.sm.reset()
        if not self.path:
            self.build_path()
        return self._tutor_start_round()

    def _pick_node_question(self):
        """从路径中顺延选择首个有可用题的节点；路径无匹配则放宽到全图（M4r7i）。"""
        path = self.path or []
        candidates = list(path) + [n for n in self.graph.node_ids if n not in path]
        for n in candidates:
            q = next((q for q in self.tutor_pool if n in q.step_node_map.values()), None)
            if q:
                return n, q
        return None, None

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
        msg = f"我们来看这个知识点：{node}。先试试这题：{self.verify_question.content}"
        return TurnResult(state=self.sm.state.value, message=msg, context=dict(self.sm.context))

    def tutor_step(self, user_msg: str, correct: bool | None = None) -> TurnResult:
        """处理学生一条回复，推进状态机并产出引导。

        correct: 判断题的场景由编排层判定对错；开放对话由正确性分析（M3 起）提供。
        """
        state = self.sm.state

        # 连续错误统一累积（VERIFY 态由状态机 VERIFY_FAIL 事件递增，此处不加）
        if correct is False and state in (State.ELICIT, State.IDENTIFY):
            self.sm.context["consecutive_wrong"] += 1

        # 挫败感检测（任一作答态）
        if correct is False and state in (State.ELICIT, State.IDENTIFY, State.HINT, State.VERIFY):
            fa = assess_frustration(self.sm.context, user_msg)
            if fa.action == "switch_explain":
                self.sm.step(Event.GIVE_UP, frustrate="switch_explain")
                return TurnResult(
                    state=self.sm.state.value,
                    message="没关系，我们换个方式：先看看这类题的关键步骤，再试一次。",
                    context=dict(self.sm.context),
                )

        # 状态转移
        if state == State.ELICIT:
            if correct is True:
                self.sm.step(Event.ANSWER_CORRECT)
                return self._verify_turn()
            self.sm.step(Event.LOCATED)
            return TurnResult(
                state=self.sm.state.value,
                message="先说说你的思路，卡在哪一步了？",
                context=dict(self.sm.context),
            )
        if state == State.IDENTIFY:
            if correct is True:
                self.sm.step(Event.CLASSIFIED, error_category="concept")
                return self._hint_turn()
            self.sm.step(Event.CLASSIFIED, error_category="operation")
            return self._hint_turn()
        if state == State.HINT:
            # 状态机保证：HINT 态只能经 HINT_GIVEN 离开（提示给出 → 变式验证）
            self.sm.step(Event.HINT_GIVEN)
            return self._verify_turn()
        if state == State.VERIFY:
            if correct is True:
                self.sm.step(Event.VERIFY_PASS)
                if self.sm.state == State.DONE and self.practice_rounds + 1 < self.max_rounds and len(self.path) > 1:
                    # M4r7h：练习轮数未满且路径有后续 → 进入下一知识点（顺延选有题的节点）
                    self.practice_rounds += 1
                    self.path = self.path[1:]
                    self.sm.reset()
                    node, q = self._pick_node_question()
                    self.current_node = node
                    self.verify_question = q
                    if self.verify_question is None:
                        return TurnResult(
                            state=self.sm.state.value,
                            message="当前配置下剩余知识点暂无可用题目，本轮练习到此结束。",
                            context=dict(self.sm.context),
                        )
                    return TurnResult(
                        state=self.sm.state.value,
                        message=f"很好，这一步掌握了！进入下一个知识点：{node}。先试试这题：{self.verify_question.content}",
                        context=dict(self.sm.context),
                    )
                self.practice_rounds += 1
                if self.practice_rounds >= self.max_rounds or len(self.path) <= 1:
                    # M4r7i：练习完成总结（轮数满/路径耗尽）——不再显示误导性"进入下一题"
                    weak = "、".join((self.weak_nodes or ["—"])[:3])
                    return TurnResult(
                        state=self.sm.state.value,
                        message=(
                            f"🎉 本轮练习完成！巩固了 {self.practice_rounds} 个知识点。"
                            f"当前薄弱点是：{weak}。"
                            "可以去仪表盘查看路径，或开始新的会话继续巩固。"
                        ),
                        context=dict(self.sm.context),
                    )
                return TurnResult(
                    state=self.sm.state.value,
                    message="很好，这一步掌握了！我们进入下一题。",
                    context=dict(self.sm.context),
                )
            self.sm.step(Event.VERIFY_FAIL)
            return self._identify_turn()
        # DONE
        return TurnResult(
            state=self.sm.state.value, message="本轮完成，可以开始下一题。", context=dict(self.sm.context)
        )

    def _hint_turn(self) -> TurnResult:
        """给出最小提示并停留在 HINT 态（等待学生回应后由 HINT 分支触发 HINT_GIVEN → 变式验证）。

        修复 M4r7f：原来此处提前触发 HINT_GIVEN 导致提示态瞬移 VERIFY，
        学生下一条消息被误当作变式题作答判错。
        """
        level = min(self.sm.context["hint_level"], len(_HINTS) - 1)
        raw = _HINTS[level]
        res = self.sanitizer.sanitize(raw)
        return TurnResult(
            state=self.sm.state.value,  # hint
            message=res.text,
            degraded=res.degraded,
            context=dict(self.sm.context),
        )

    def _verify_turn(self) -> TurnResult:
        self.verify_question = self._pick_verify()
        msg = f"再来一道变式验证：{self.verify_question.content if self.verify_question else '同型题'}"
        return TurnResult(state=self.sm.state.value, message=msg, context=dict(self.sm.context))

    def _identify_turn(self) -> TurnResult:
        self.sm.step(Event.CLASSIFIED, error_category="operation")
        return TurnResult(
            state=self.sm.state.value,
            message="变式没过，我们重新定位：这题你第一步做了什么？",
            context=dict(self.sm.context),
        )

    def _pick_verify(self):
        node = self.current_node or (self.path[0] if self.path else None)
        cands = [q for q in self.tutor_pool if node in q.step_node_map.values()]
        return cands[-1] if cands else None

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
            "practice_rounds": self.practice_rounds,
            "max_rounds": self.max_rounds,
            "current_node": self.current_node,
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
        # M4r7h：恢复辅导题库与练习轮数
        self.max_rounds = int(state.get("max_rounds", self.max_rounds))
        self.practice_rounds = int(state.get("practice_rounds", 0))
        self.current_node = state.get("current_node")
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
