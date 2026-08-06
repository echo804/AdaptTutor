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


def test_diagnose_qcount_limits_questions():
    """M4r5：用户自选题量上限（qcount）生效。"""
    t = _tutor()
    st = t.start_diagnosis({"qcount": 3, "qtypes": ["choice"]})
    assert st.get("qcount") == 3 and st.get("answered") == 0
    for i in range(1, 4):
        st = t.diagnose(True)
        if i < 3:
            assert st.get("done") is False, f"第 {i} 轮不应提前结束"
            assert st.get("answered") == i
        else:
            assert st.get("done") is True, "第 3 轮后应结束（qcount=3）"


def test_diagnose_config_filters_types():
    """M4r5：题型过滤——只出指定题型。"""
    t = _tutor()
    st = t.start_diagnosis({"qtypes": ["open"]})
    q = st.get("question")
    assert q is not None and q.type == "open"


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
    """elicit → identify → hint（停留）→ 回应 → verify → done（提示→变式答对）。"""
    t = _tutor()
    r = t.tutor_start()
    assert r.state == State.ELICIT.value

    r = t.tutor_step("我算出来是 7。", correct=False)
    assert r.state == State.IDENTIFY.value

    r = t.tutor_step("我不确定第一步做什么。", correct=False)
    assert r.state == State.HINT.value  # M4r7f：提示停留，不瞬移

    r = t.tutor_step("好，我按提示想想。", correct=None)
    assert r.state == State.VERIFY.value  # 回应 → 变式验证

    r = t.tutor_step(t.verify_question.answer, correct=True)
    assert r.state == State.DONE.value


def test_tutor_config_rounds_advances_path():
    """M4r7h：辅导配置 qcount=3（练习轮数）→ 答对后进入下一知识点，满 3 轮才完成。"""
    t = _tutor()
    r = t.tutor_start({"qcount": 3, "qtypes": ["choice"], "difficulty": "auto"})
    assert r.state == State.ELICIT.value
    rounds_done = 0
    for _ in range(40):  # 安全上限
        if t.verify_question is None:
            break
        # 直接答对变式题（每轮：ELICIT 答对 → VERIFY 答对）
        ans = t.verify_question.answer
        r1 = t.tutor_step(ans, correct=True)  # ELICIT 答对 → 变式
        r2 = t.tutor_step(ans, correct=True)  # VERIFY 答对 → 下一轮/完成
        if r2.state == State.DONE.value:
            rounds_done = t.practice_rounds
            break
    assert rounds_done == 3  # 3 轮练习完成
    assert t.max_rounds == 3


def test_tutor_messages_never_leak():
    """辅导过程中所有消息过自检：不泄露答案/步骤。"""
    t = _tutor()
    r = t.tutor_start()
    msgs = [r.message]
    msgs.append(t.tutor_step("我算出来是 7。", correct=False).message)
    msgs.append(t.tutor_step("我不确定第一步做什么。", correct=False).message)
    msgs.append(t.tutor_step("好，我按提示想想。", correct=None).message)
    msgs.append(t.tutor_step("答案是 x=6。", correct=True).message)
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


# ---- M4r20 辅导出题优化 ----

def test_verify_excludes_current_question():
    """M4r20 T2：变式题排除当前题，避免重复。"""
    t = _tutor()
    t.tutor_start()
    first = t.verify_question
    t.tutor_step("我的思路是代入公式。", correct=True)  # ELICIT 答对 → 变式
    v = t.verify_question
    if v is not None:
        assert v.id != first.id


def test_frustration_sets_ease_flag():
    """M4r20 T3：挫败切讲解后设置降档标记。"""
    t = _tutor()
    t.tutor_start()
    t.tutor_step("不会。", correct=False)
    r = t.tutor_step("太难了。", correct=False)  # switch_explain
    assert r.state == State.DONE.value
    assert t._ease_verify is True


def test_ease_flag_roundtrips_in_snapshot():
    """M4r20 T3：降档标记随会话快照保存/恢复。"""
    t = _tutor()
    t._ease_verify = True
    st = t.save_state()
    t2 = _tutor()
    t2.restore_state(st)
    assert t2._ease_verify is True
