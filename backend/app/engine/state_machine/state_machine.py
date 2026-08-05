"""四态状态机运行时：状态持有 + 事件驱动转移 + 上下文携带。

对齐 docs/03-项目架构.md 第 4 节：
- 状态存于内存（M3 起持久化到 sessions.status，本模块预留序列化接口）
- 非法跳转由 states.validate_transition 硬拒绝
- TransitionResult 携带 guidance 供编排层（tutor_orchestrator）执行下一步
"""

from __future__ import annotations

from dataclasses import dataclass

from app.engine.state_machine.states import (
    Event,
    State,
    validate_transition,
)

# 各状态对应的编排指令（辅导闭环的"下一步做什么"）
_GUIDANCE: dict[State, str] = {
    State.ELICIT: "继续探明卡点：引导学生描述思路或卡在哪里",
    State.IDENTIFY: "识别错误：追问定位错误类型（概念/运算/方法）",
    State.HINT: "给出最小提示（不直接给答案，层级 hint_level）",
    State.VERIFY: "出变式题验证是否真正掌握",
    State.DONE: "本题完成：判定下一题或结束本轮",
}


@dataclass
class TransitionResult:
    state: State          # 转移后的状态
    event: Event          # 触发事件
    context: dict         # 上下文快照（含 hint_level/连续错误/卡点等）
    guidance: str         # 给编排层的下一步指令


class TutorStateMachine:
    """苏格拉底四态状态机（单轮会话实例）。"""

    def __init__(self, initial: State = State.ELICIT) -> None:
        self.state: State = initial
        self.context: dict = {}
        self.context.update(
            {
                "stuck_node": None,        # 当前卡点（图节点 id）
                "error_category": None,    # 错误分类：concept|operation|method
                "hint_level": 0,           # 提示层级（最小→更深）
                "hints_given": 0,
                "consecutive_wrong": 0,    # 连续答错次数（挫败感检测用）
                "turns": 0,
            }
        )

    # ---- 序列化（M3 持久化钩子）----
    def to_dict(self) -> dict:
        return {"state": self.state.value, "context": dict(self.context)}

    @classmethod
    def from_dict(cls, data: dict) -> "TutorStateMachine":
        sm = cls(initial=State(data["state"]))
        sm.context.update(data.get("context", {}))
        return sm

    # ---- 主入口 ----
    def step(self, event: Event, **ctx_update) -> TransitionResult:
        """事件驱动转移；非法跳转抛 ValueError。"""
        next_state = validate_transition(self.state, event)
        self.state = next_state
        self.context["turns"] += 1

        # 上下文维护
        if event in (Event.ANSWER_WRONG, Event.VERIFY_FAIL):
            self.context["consecutive_wrong"] += 1
        elif event in (Event.ANSWER_CORRECT, Event.VERIFY_PASS):
            self.context["consecutive_wrong"] = 0
        if event == Event.HINT_GIVEN:
            self.context["hint_level"] += 1
            self.context["hints_given"] += 1
        if event == Event.CLASSIFIED and "error_category" not in ctx_update:
            # 未显式指定分类时保持默认概念错误
            self.context["error_category"] = self.context.get(
                "error_category", "concept"
            )
        self.context.update(ctx_update)

        return TransitionResult(
            state=self.state,
            event=event,
            context=dict(self.context),
            guidance=_GUIDANCE[self.state],
        )

    def reset(self) -> None:
        """重置到初始态（新一题/新一轮辅导）。"""
        self.__init__()

    def current(self) -> State:
        return self.state
