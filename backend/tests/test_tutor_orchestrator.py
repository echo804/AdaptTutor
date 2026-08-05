"""辅导编排器测试：诊断推进、路径生成、四态辅导闭环、挫败感切讲解、小结。"""

from app.engine.tutor_orchestrator import TutorOrchestrator
from app.engine.state_machine.states import State


def _tutor() -> TutorOrchestrator:
    return TutorOrchestrator("junior_math_eq_ineq")


# ---- 诊断推进 ----

def test_diagnose_updates_mastery():
    t = _tutor()
    st = t.diagnose(True)
    assert st["stage"] == "diagnose"
    assert st["question"] is not None
    # 答对后薄弱点掌握度应 ≥ 初始（P(L0)=0.3 或更高）
    weak = st["weakest"]
    assert t.mastery[weak] >= 0.3


def test_diagnose_terminates_on_confidence():
    t = _tutor()
    terminated = False
    for _ in range(10):
        st = t.diagnose(False)  # 全错 → 置信度快速上升
        if st.get("terminated"):
            terminated = True
            break
        if st.get("done"):
            break
    assert terminated or st.get("done")


# ---- 路径 ----

def test_build_path_topological():
    t = _tutor()
    path = t.build_path()
    assert path
    # 路径任意前置必须在后继之前（拓扑序检查）
    order = {nid: i for i, nid in enumerate(t.graph.topological_order())}
    for i in range(len(path) - 1):
        assert order[path[i]] <= order[path[i + 1]]


# ---- 四态辅导闭环 ----

def test_tutor_full_cycle():
    """elicit → identify → hint → verify → done（答错暴露→提示→变式答对）。"""
    t = _tutor()
    r = t.tutor_start()
    assert r.state == State.ELICIT.value

    r = t.tutor_step("我算出来是 7。", correct=False)
    assert r.state == State.IDENTIFY.value

    r = t.tutor_step("我不确定第一步做什么。", correct=False)
    assert r.state in (State.HINT.value, State.VERIFY.value)  # 提示给出即转验证

    r = t.tutor_step("我再试试。", correct=True)
    assert r.state == State.DONE.value


def test_tutor_messages_never_leak():
    """辅导过程中所有消息过自检：不泄露答案/步骤。"""
    t = _tutor()
    r = t.tutor_start()
    msgs = [r.message]
    msgs.append(t.tutor_step("我算出来是 7。", correct=False).message)
    msgs.append(t.tutor_step("我不确定第一步做什么。", correct=False).message)
    msgs.append(t.tutor_step("我再试试。", correct=True).message)
    for m in msgs:
        assert not t.sanitizer.check_leak(m)


def test_frustration_switch_explain():
    """连续答错累积 + 负面情绪 → 切讲解模式（DONE）。"""
    t = _tutor()
    t.tutor_start()
    t.tutor_step("不会。", correct=False)          # 连错 1
    r = t.tutor_step("太难了。", correct=False)    # 连错 2 + 负面词 → switch_explain
    assert r.state == State.DONE.value
    assert "换个方式" in r.message


# ---- 小结 ----

def test_summary_contains_weak_nodes():
    t = _tutor()
    t.diagnose(False)
    s = t.summary()
    assert "薄弱点" in s
    assert "路径" in s
