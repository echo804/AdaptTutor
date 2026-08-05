"""苏格拉底四态状态机（对齐 docs/03-项目架构.md 第 4 节）。

四态：
- ELICIT（探明卡点）：学生不会/答错 → 引导说出思路与卡点
- IDENTIFY（识别错误）：已定位 → 引导学生自己发现错误（概念/运算/方法分类）
- HINT（最小提示）：已分类 → 给最小提示（不直接给答案）
- VERIFY（变式验证）：提示后 → 变式题验证是否真正掌握

事件驱动转移；转移矩阵为唯一合法路径，非法跳转硬拒绝
（如"未探明卡点不得直接给提示"）。DONE 为终止态。
"""

from __future__ import annotations

from enum import Enum


class State(str, Enum):
    ELICIT = "elicit"          # 探明卡点
    IDENTIFY = "identify"      # 识别错误
    HINT = "hint"              # 最小提示
    VERIFY = "verify"          # 变式验证
    DONE = "done"              # 完成/下一题


class Event(str, Enum):
    ANSWER_CORRECT = "answer_correct"   # 学生答对
    ANSWER_WRONG = "answer_wrong"       # 学生答错
    LOCATED = "located"                 # 卡点已定位
    NOT_LOCATED = "not_located"         # 定位失败，需继续探明
    CLASSIFIED = "classified"           # 错误已分类
    HINT_GIVEN = "hint_given"           # 提示已给出
    VERIFY_PASS = "verify_pass"         # 变式验证通过
    VERIFY_FAIL = "verify_fail"         # 变式验证未通过
    GIVE_UP = "give_up"                 # 学生放弃/超出能力，切讲解模式
    OFF_THEME = "off_theme"             # 跑题，拉回当前任务


# 合法转移矩阵：(当前状态, 事件) → 下一状态。
# 未列出的组合一律视为非法跳转，由 state_machine 硬拒绝。
TRANSITION_TABLE: dict[tuple[State, Event], State] = {
    # 探明卡点
    (State.ELICIT, Event.LOCATED): State.IDENTIFY,          # 学生回答暴露卡点
    (State.ELICIT, Event.ANSWER_CORRECT): State.VERIFY,     # 直接答对 → 变式验证是否真会
    (State.ELICIT, Event.ANSWER_WRONG): State.ELICIT,       # 仍说不清 → 继续探明（带挫败感约束）
    (State.ELICIT, Event.NOT_LOCATED): State.ELICIT,
    (State.ELICIT, Event.GIVE_UP): State.DONE,              # 放弃 → 讲解模式（DONE 承载）
    (State.ELICIT, Event.OFF_THEME): State.ELICIT,

    # 识别错误
    (State.IDENTIFY, Event.CLASSIFIED): State.HINT,         # 已分类 → 最小提示
    (State.IDENTIFY, Event.ANSWER_WRONG): State.IDENTIFY,   # 追问仍错 → 继续识别
    (State.IDENTIFY, Event.NOT_LOCATED): State.ELICIT,      # 分类失败 → 回退探明
    (State.IDENTIFY, Event.GIVE_UP): State.DONE,
    (State.IDENTIFY, Event.OFF_THEME): State.IDENTIFY,

    # 最小提示
    (State.HINT, Event.HINT_GIVEN): State.VERIFY,           # 提示给出 → 变式验证
    (State.HINT, Event.ANSWER_WRONG): State.HINT,           # 提示层级再降（受挫败感约束）
    (State.HINT, Event.NOT_LOCATED): State.ELICIT,          # 提示无效 → 重新探明更深卡点
    (State.HINT, Event.GIVE_UP): State.DONE,
    (State.HINT, Event.OFF_THEME): State.HINT,

    # 变式验证
    (State.VERIFY, Event.VERIFY_PASS): State.DONE,          # 通过 → 完成/下一题
    (State.VERIFY, Event.VERIFY_FAIL): State.IDENTIFY,      # 未通过 → 回到识别
    (State.VERIFY, Event.GIVE_UP): State.DONE,
    (State.VERIFY, Event.OFF_THEME): State.VERIFY,

    # 终止态
    (State.DONE, Event.OFF_THEME): State.DONE,
}

# 非法跳转示例（供测试与文档）：
# (ELICIT, HINT_GIVEN)  —— 未探明卡点不得直接给提示
# (IDENTIFY, VERIFY_PASS) —— 未分类直接验证


def allowed_events(state: State) -> list[Event]:
    """当前状态下所有合法事件（用于前端/CLI 提示）。"""
    return [ev for (st, ev) in TRANSITION_TABLE if st == state]


def validate_transition(state: State, event: Event) -> State:
    """查转移矩阵；非法跳转抛 ValueError。"""
    try:
        return TRANSITION_TABLE[(state, event)]
    except KeyError:
        raise ValueError(
            f"非法跳转: {state.value} + {event.value}（状态转移矩阵硬约束）"
        ) from None
