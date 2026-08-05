"""状态机测试：转移矩阵全覆盖、非法跳转拒绝、上下文维护、序列化、挫败感检测。"""

import pytest

from app.engine.state_machine.frustration import assess_frustration
from app.engine.state_machine.state_machine import TutorStateMachine
from app.engine.state_machine.states import (
    TRANSITION_TABLE,
    Event,
    State,
    allowed_events,
    validate_transition,
)


# ---- 转移矩阵 ----

def test_transition_table_all_entries_valid():
    """矩阵中每条记录 validate_transition 均应返回表中目标态。"""
    for (st, ev), target in TRANSITION_TABLE.items():
        assert validate_transition(st, ev) == target


def test_illegal_transition_rejected():
    """非法跳转必须抛 ValueError。"""
    illegal = [
        (State.ELICIT, Event.HINT_GIVEN),     # 未探明不得直接给提示
        (State.ELICIT, Event.VERIFY_PASS),
        (State.IDENTIFY, Event.VERIFY_PASS),  # 未分类不得直接验证
        (State.VERIFY, Event.HINT_GIVEN),
        (State.DONE, Event.CLASSIFIED),
    ]
    for st, ev in illegal:
        with pytest.raises(ValueError):
            validate_transition(st, ev)


def test_allowed_events_subset():
    """allowed_events 返回的事件必须都能合法转移。"""
    for st in State:
        for ev in allowed_events(st):
            assert (st, ev) in TRANSITION_TABLE


# ---- 状态机运行时 ----

def test_happy_path_full_cycle():
    """探明→识别→提示→变式验证→完成 全流程。"""
    sm = TutorStateMachine()
    assert sm.step(Event.LOCATED).state == State.IDENTIFY
    assert sm.step(Event.CLASSIFIED).state == State.HINT
    r = sm.step(Event.HINT_GIVEN)
    assert r.state == State.VERIFY
    assert r.context["hint_level"] == 1
    assert sm.step(Event.VERIFY_PASS).state == State.DONE


def test_wrong_loop_escalates_hint_level():
    """提示→变式失败→重识别→再提示：hint_level 递增、连续错误累积。"""
    sm = TutorStateMachine()
    sm.step(Event.LOCATED)
    sm.step(Event.CLASSIFIED)
    r1 = sm.step(Event.HINT_GIVEN)          # → VERIFY，提示层级 1
    assert r1.state == State.VERIFY
    assert r1.context["hint_level"] == 1
    r2 = sm.step(Event.VERIFY_FAIL)         # 变式未过 → IDENTIFY
    assert r2.state == State.IDENTIFY
    assert r2.context["consecutive_wrong"] == 1
    sm.step(Event.CLASSIFIED)
    r3 = sm.step(Event.HINT_GIVEN)          # 再给更深入提示
    assert r3.state == State.VERIFY
    assert r3.context["hint_level"] == 2


def test_identify_fallback_to_elicit():
    """识别失败回退探明。"""
    sm = TutorStateMachine()
    sm.step(Event.LOCATED)
    assert sm.step(Event.NOT_LOCATED).state == State.ELICIT


def test_verify_fail_back_to_identify():
    """变式未通过回到识别。"""
    sm = TutorStateMachine()
    sm.step(Event.LOCATED)
    sm.step(Event.CLASSIFIED)
    sm.step(Event.HINT_GIVEN)
    assert sm.step(Event.VERIFY_FAIL).state == State.IDENTIFY


def test_consecutive_wrong_reset_on_correct():
    """答对后连续错误计数清零。"""
    sm = TutorStateMachine()
    sm.step(Event.LOCATED)
    sm.step(Event.CLASSIFIED)
    sm.step(Event.HINT_GIVEN)
    sm.step(Event.VERIFY_FAIL)
    assert sm.context["consecutive_wrong"] == 1
    # 新的直接答对路径：ELICIT 答对 → VERIFY，计数清零
    sm2 = TutorStateMachine()
    sm2.step(Event.ANSWER_CORRECT)
    assert sm2.context["consecutive_wrong"] == 0


def test_serialization_roundtrip():
    """to_dict/from_dict 往返一致（M3 持久化钩子）。"""
    sm = TutorStateMachine()
    sm.step(Event.LOCATED)
    sm.step(Event.CLASSIFIED, error_category="operation")
    data = sm.to_dict()
    restored = TutorStateMachine.from_dict(data)
    assert restored.state == sm.state
    assert restored.context == sm.context


def test_reset_returns_initial():
    sm = TutorStateMachine()
    sm.step(Event.LOCATED)
    sm.reset()
    assert sm.state == State.ELICIT
    assert sm.context["hint_level"] == 0


def test_guidance_per_state():
    """每个状态都有编排指令。"""
    sm = TutorStateMachine()
    r = sm.step(Event.LOCATED)
    assert r.guidance and "识别错误" in r.guidance


# ---- 挫败感检测 ----

def test_frustration_consecutive_wrong():
    ctx = {"consecutive_wrong": 3}
    a = assess_frustration(ctx, "我再试试")
    assert a.frustrated
    assert "连续答错" in a.reasons[0]
    assert a.action == "lower_hint"


def test_frustration_switch_explain_on_negative():
    ctx = {"consecutive_wrong": 2}
    a = assess_frustration(ctx, "太难了，我不想学了")
    assert a.frustrated
    assert a.action == "switch_explain"


def test_frustration_reply_drop():
    ctx = {"consecutive_wrong": 0}
    a = assess_frustration(ctx, "嗯", recent_replies=["我的思路是先化简，再移项，然后合并同类项", "好，那我继续"])
    assert a.frustrated
    assert any("骤降" in r for r in a.reasons)


def test_no_frustration_normal():
    ctx = {"consecutive_wrong": 0}
    a = assess_frustration(ctx, "我觉得应该先移项，把含 x 的放一边", recent_replies=["好，那我继续"])
    assert not a.frustrated
    assert a.action is None
