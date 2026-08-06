"""诊断引擎测试：BKT 更新、选题、终止条件。"""

from app.domain.schemas import BktParams, DiagnosticRules, Question
from app.engine.diagnostic import bkt_update, select_next_question, should_terminate


def _q(qid: str, difficulty: float, nodes: list[str]) -> Question:
    return Question(
        id=qid,
        type="choice",
        content=f"题目 {qid}",
        difficulty=difficulty,
        answer="A",
        step_node_map={f"step1": nodes[0]} if nodes else {},
    )


def test_bkt_correct_increases():
    p = BktParams()
    after = bkt_update(0.3, correct=True, params=p)
    assert after > 0.3


def test_bkt_wrong_decreases():
    p = BktParams()
    after = bkt_update(0.7, correct=False, params=p)
    assert after < 0.7


def test_bkt_bounds():
    p = BktParams()
    for correct in (True, False):
        for p0 in (0.05, 0.5, 0.95):
            v = bkt_update(p0, correct, p)
            assert 0.0 <= v <= 1.0


def test_select_prefers_weak_node():
    mastery = {"k1": 0.9, "k2": 0.1}
    q_weak = _q("q1", 0.6, ["k2"])
    q_strong = _q("q2", 0.6, ["k1"])
    chosen = select_next_question(mastery, [q_strong, q_weak], DiagnosticRules())
    assert chosen.id == "q1"


def test_select_prefers_mid_difficulty():
    mastery = {"k1": 0.2}
    q_mid = _q("q1", 0.6, ["k1"])
    q_extreme = _q("q2", 0.05, ["k1"])
    chosen = select_next_question(mastery, [q_extreme, q_mid], DiagnosticRules())
    assert chosen.id == "q1"


def test_terminate_on_question_cap():
    rules = DiagnosticRules()
    assert should_terminate({"k1": 0.4}, rules.termination.max_questions, rules)


def test_terminate_on_confidence():
    rules = DiagnosticRules()
    assert should_terminate({"k1": 0.05}, 3, rules)  # 置信度 0.95 ≥ 0.8


def test_no_terminate_early():
    rules = DiagnosticRules()
    assert not should_terminate({"k1": 0.6}, 2, rules)


def test_select_rotates_recent_nodes():
    """M4r20 D1：连续作答节点降权，出题轮换到其他节点。"""
    mastery = {"k1": 0.2, "k2": 0.25}
    q1 = _q("q1", 0.6, ["k1"])
    q2 = _q("q2", 0.6, ["k2"])
    # k1 已连续答 3 次 → 应轮到 k2
    chosen = select_next_question(mastery, [q1, q2], DiagnosticRules(), recent={"k1": 3})
    assert chosen.id == "q2"
    # 无 recent 时仍优先薄弱 k1
    chosen0 = select_next_question(mastery, [q1, q2], DiagnosticRules())
    assert chosen0.id == "q1"
