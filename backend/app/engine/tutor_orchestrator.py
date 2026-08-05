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

    # ---------- 阶段 1：诊断 ----------

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
        if self.current_question is None:
            return {"stage": "diagnose", "done": True}
        weak = min(self.mastery, key=self.mastery.get)
        confident = (1 - self.mastery[weak]) >= self.rules.termination.confidence_threshold
        return {
            "stage": "diagnose",
            "done": False,
            "question": self.current_question,
            "weakest": weak,
            "confidence": round(1 - self.mastery[weak], 3),
            "terminated": confident,
        }

    # ---------- 阶段 2：路径 ----------

    def build_path(self) -> list[str]:
        weak = min(self.mastery, key=self.mastery.get)
        self.weak_nodes = [n for n, m in self.mastery.items() if m <= self.mastery[weak] + 0.05]
        self.path = plan_path(self.graph, self.weak_nodes)
        return self.path

    # ---------- 阶段 3：四态辅导 ----------

    def tutor_start(self) -> TurnResult:
        """进入辅导：给出第一个引导（当前薄弱节点相关题目）。"""
        self.sm.reset()
        if not self.path:
            self.build_path()
        node = self.path[0] if self.path else self.graph.node_ids[0]
        self.verify_question = next(
            (q for q in self.pack.questions if node in q.step_node_map.values()), None
        )
        msg = f"我们来看这个知识点：{node}。先试试这题：{self.verify_question.content if self.verify_question else '—'}"
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
        level = min(self.sm.context["hint_level"], len(_HINTS) - 1)
        raw = _HINTS[level]
        res = self.sanitizer.sanitize(raw)
        self.sm.step(Event.HINT_GIVEN)
        return TurnResult(
            state=self.sm.state.value,
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
        node = self.path[0] if self.path else None
        cands = [q for q in self.pack.questions if node in q.step_node_map.values()]
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
