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
    """M5 新流程：elicit 答错 → identify 定位 → hint 提示 → 结束本题（记错题）→ done（不再进变式验证）。"""
    t = _tutor()
    r = t.tutor_start({"qcount": 1})
    assert r.state == State.ELICIT.value

    r = t.tutor_step("我算出来是 7。", correct=False)
    assert r.state == State.IDENTIFY.value

    r = t.tutor_step("我不确定第一步做什么。", correct=False)
    assert r.state == State.HINT.value  # M4r7f：提示停留，不瞬移

    r = t.tutor_step("好，我按提示想想。", correct=None)
    assert r.state == State.DONE.value  # M5：引导结束 → 本题结束（不再进变式验证）
    assert t.review_queue  # 答错的题已记入复习队列


def test_tutor_config_rounds_advances_path():
    """M4r7h/M5：辅导配置 qcount=3（题量）→ 3 个知识点完成后才结束。"""
    t = _tutor()
    r = t.tutor_start({"qcount": 3, "qtypes": ["choice"], "difficulty": "auto"})
    assert r.state == State.ELICIT.value
    for _ in range(40):  # 安全上限
        if t.verify_question is None:
            break
        ans = t.verify_question.answer
        r1 = t.tutor_step(ans, correct=True)  # ELICIT 答对
        if r1.state == State.VERIFY.value:
            t.tutor_step(ans, correct=True)  # 有真变式：变式答对 → 完成
    assert t.practice_rounds == 3  # 3 题（知识点）完成
    assert t.max_rounds == 3
    assert t.verify_question is None


def test_tutor_difficulty_easy_widens_when_pool_empty():
    """M5：所选难度题库为空（llm_app_dev 最低难度 0.4，easy<0.34 无题）→ 自动放宽到更高难度，
    辅导不产生空会话（此前 verify_question 为 None → 前端空白"本轮辅导完成"）。"""
    t = TutorOrchestrator("llm_app_dev")
    r = t.tutor_start(
        {"qtypes": ["choice", "blank", "open", "multi"], "difficulty": "easy", "qcount": 1}
    )
    assert t.verify_question is not None, "easy 无题应放宽并选出题"
    assert t.diag_config.get("_actual_difficulty", "").startswith("easy")
    assert r.state == State.ELICIT.value


def test_tutor_qcount_10_covers_10_nodes_without_repeat():
    """M5：辅导 qcount=10（自定义题量）→ 完整巩固 10 个知识点；路径耗尽后从全图补足，
    且已巩固节点不重复（此前路径耗尽 len(path)<=1 提前结束，题量形同虚设）。"""
    t = TutorOrchestrator("llm_app_dev")
    t.tutor_start({"qtypes": ["choice"], "difficulty": "auto", "qcount": 10})
    assert t.max_rounds == 10
    nodes: list[str] = []
    for _ in range(100):  # 安全上限
        if t.verify_question is None:
            break
        node = t.current_node
        ans = t.verify_question.answer
        r = t.tutor_step(ans, correct=True)  # ELICIT 答对
        if r.state == State.VERIFY.value:
            # 有真变式：变式答对 → 完成该知识点
            t.tutor_step(ans, correct=True)
        nodes.append(node)
        if t.verify_question is None:
            break
    assert len(nodes) == 10  # 题量 = 巩固的知识点数
    assert len(set(nodes)) == 10  # 已巩固节点不重复
    assert t.practice_rounds == 10


def test_tutor_wrong_question_recorded_dedup():
    """M5：答错 → 记入错题复习队列（去重）；引导结束下一题不紧跟原题。"""
    import unittest.mock as mock

    t = TutorOrchestrator("llm_app_dev")
    t.tutor_start({"qcount": 3, "qtypes": ["choice"], "difficulty": "auto"})
    wrong = t.verify_question
    r = t.tutor_step("X", correct=False)  # 答错 → IDENTIFY
    assert r.state == State.IDENTIFY.value
    assert wrong.id in t.review_queue
    # 多次答错去重
    t.tutor_step("X", correct=False)
    assert t.review_queue.count(wrong.id) == 1
    # 引导结束 → 下一题：复习队列非空但刚做完该题 → 必须出新题（不紧跟原题）
    r = t.tutor_step("好，我按提示想想。", correct=None)
    assert r.state == State.ELICIT.value
    assert t.verify_question.id != wrong.id


def test_tutor_review_question_selected_and_cleared():
    """M5：复习题从队列选择（排除刚做完的题）且标记 is_review；答对后移出队列。"""
    import unittest.mock as mock

    t = TutorOrchestrator("llm_app_dev")
    t.tutor_start({"qcount": 3, "qtypes": ["choice"], "difficulty": "auto"})
    q1 = t.pack.questions[0]
    q2 = t.pack.questions[1]
    t._record_wrong(q1.id)
    t._record_wrong(q2.id)
    t.verify_question = q1  # 模拟刚做完 q1
    # 命中复习（random()<0.5）→ 应从队列排除 q1 选 q2
    with mock.patch("random.random", return_value=0.1):
        node, q = t._next_question()
    assert q.id == q2.id
    assert t.is_review is True
    # 复习答对 → 移出队列
    t.current_node = node
    t.verify_question = q2
    t.tutor_step(q2.answer, correct=True)
    assert q2.id not in t.review_queue
    assert q1.id in t.review_queue  # 另一道错题保留


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


def test_variant_question_roundtrips_in_snapshot():
    """M4r21c：变式题（动态生成、不在题库）随快照保存/恢复。

    变式题 id 带 "v" 前缀，题库中不存在——restore 需用快照的 verify_question_data 重建。
    """
    t = _tutor()
    # 模拟一个变式题（id 带 v，不在 pack.questions）
    from app.domain.schemas import Question

    base = t.pack.questions[0]
    variant = Question(
        id=f"{base.id}v99999",
        type=base.type,
        content=f"变式：{base.content}",
        difficulty=base.difficulty,
        options=base.options,
        answer=base.answer,
        step_node_map=base.step_node_map,
    )
    t.verify_question = variant
    st = t.save_state()
    t2 = _tutor()
    t2.restore_state(st)
    assert t2.verify_question is not None
    assert t2.verify_question.id == f"{base.id}v99999"
    assert t2.verify_question.content.startswith("变式")
