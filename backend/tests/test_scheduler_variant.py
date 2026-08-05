"""遗忘调度 + 变式题生成测试（M3：变式可用率 ≥ 80%）。"""

from datetime import datetime, timedelta, timezone

from app.domain.loader import load_pack
from app.domain.schemas import Question
from app.engine.scheduler import INTERVALS_DAYS, ReviewState, due_reviews, is_due, schedule_next
from app.engine.variant_generator import generate_batch, generate_variant, usability_rate


# ---- 遗忘调度 ----

def test_schedule_next_progress():
    r = schedule_next(0.5, answered_correct=True)
    assert r.stage == 1
    assert r.interval_days == INTERVALS_DAYS[1] == 3


def test_schedule_next_high_mastery_skips():
    r = schedule_next(0.9, answered_correct=True)
    assert r.stage == 2  # 高掌握跳 2 档
    assert r.interval_days == 7


def test_schedule_next_wrong_regress():
    cur = ReviewState(stage=3, interval_days=14)
    r = schedule_next(0.4, current=cur, answered_correct=False)
    assert r.stage == 0 and r.interval_days == 1


def test_is_due_never_reviewed():
    assert is_due(ReviewState())


def test_is_due_after_interval():
    now = datetime.now(timezone.utc)
    past = ReviewState(stage=1, interval_days=3, last_review_at=now - timedelta(days=4))
    assert is_due(past)
    future = ReviewState(stage=1, interval_days=3, last_review_at=now - timedelta(days=1))
    assert not is_due(future)


def test_due_reviews_sorted():
    now = datetime.now(timezone.utc)
    rows = {
        "a": ReviewState(stage=0, interval_days=1, last_review_at=now - timedelta(days=2)),
        "b": ReviewState(stage=2, interval_days=7, last_review_at=now - timedelta(days=1)),
        "c": ReviewState(),  # 从未复习 → 到期
    }
    due = due_reviews(rows)
    assert "a" in due and "c" in due and "b" not in due


# ---- 变式题生成 ----

def _q() -> Question:
    return Question(
        id="q001",
        type="choice",
        content="计算：$-3 - 5 = ?$",
        difficulty=0.3,
        options=["2", "-8", "8", "-2"],
        answer="B",
        step_node_map={"step1": "a01"},
    )


def test_variant_choice_shifts_numbers_keeps_answer():
    v = generate_variant(_q(), seed=1, delta=2)
    assert v.ok
    assert "7" in v.question.content  # -3-5 → -5-7（数值偏移）
    assert v.question.answer == "B"  # 答案字母不变
    assert v.question.id == "q001v1"


def test_variant_blank_answer_synced():
    q = Question(
        id="q008", type="blank", content="当 $x = 2$ 时，代数式 $3x + 1$ 的值为？",
        difficulty=0.4, answer="7", step_node_map={"step1": "a05"},
    )
    v = generate_variant(q, seed=2, delta=1)
    assert v.ok
    assert "3" in v.question.content
    assert v.question.answer == "8"  # 7+1


def test_variant_deterministic():
    v1 = generate_variant(_q(), seed=7)
    v2 = generate_variant(_q(), seed=7)
    assert v1.question.content == v2.question.content


def test_batch_usability_rate_over_80():
    """领域包 47 题 × 5 个 seed 的可用率 ≥ 80%（M3 验收项）。"""
    pack = load_pack("junior_math_eq_ineq")
    seeds = list(range(5))
    results = []
    for q in pack.questions:
        results.extend(generate_batch([q], seeds))
    rate = usability_rate(results)
    assert rate >= 0.8, f"变式可用率 {rate:.0%} < 80%"


def test_batch_all_ids_unique():
    pack = load_pack("junior_math_eq_ineq")
    results = generate_batch(pack.questions, list(range(3)))
    ids = [r.question.id for r in results]
    assert len(ids) == len(set(ids))
