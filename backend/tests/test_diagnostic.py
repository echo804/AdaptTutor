"""诊断引擎测试：BKT 更新、选题、终止条件。"""

import random

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
    # 固定 rng → 确定性：薄弱 k1 的 q1 权重远高，应选中
    chosen = select_next_question(mastery, [q_strong, q_weak], DiagnosticRules(), rng=random.Random(1))
    assert chosen.id == "q1"


def test_select_prefers_mid_difficulty():
    mastery = {"k1": 0.2}
    q_mid = _q("q1", 0.6, ["k1"])
    q_extreme = _q("q2", 0.05, ["k1"])
    # 固定 rng：难度贴近 0.6 的 q1 权重更高
    chosen = select_next_question(mastery, [q_extreme, q_mid], DiagnosticRules(), rng=random.Random(2))
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
    # k1 已连续答 3 次 → 降权后 q2 权重更高；固定 rng 保证选中 q2
    chosen = select_next_question(mastery, [q1, q2], DiagnosticRules(), recent={"k1": 3}, rng=random.Random(3))
    assert chosen.id == "q2"
    # 无 recent 时仍优先薄弱 k1（固定 rng）
    chosen0 = select_next_question(mastery, [q1, q2], DiagnosticRules(), rng=random.Random(4))
    assert chosen0.id == "q1"


def test_select_random_diversity():
    """M4r23：同状态下多次选题应产生多种结果（加权随机，非固定）。"""
    mastery = {"k1": 0.2, "k2": 0.25, "k3": 0.3}
    qs = [_q(f"q{i}", 0.6, [f"k{i}"]) for i in (1, 2, 3)]
    seen = {select_next_question(mastery, qs, DiagnosticRules(), rng=random.Random(s)).id for s in range(40)}
    # 40 个不同种子应产生 ≥2 种不同结果（证明不是固定选题）
    assert len(seen) >= 2
