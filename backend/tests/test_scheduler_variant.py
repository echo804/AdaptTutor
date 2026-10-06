"""遗忘调度 + 变式题生成测试（M3：变式题必须**有解**）。

P1-7/P1-8 修正了这里的核心判据：变式的验收标准从"schema 校验通过"
改成"答案值 == 题干真值"。旧断言"选项跟着平移、答案字母不变"恰恰是在
断言那个 bug（`-4-6=?` 真值 -10，答案字母却指 -9，选项里没有正确答案）。
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.domain.loader import load_pack
from app.domain.schemas import Question
from app.engine.scheduler import INTERVALS_DAYS, ReviewState, due_reviews, is_due, schedule_next
from app.engine.variant_generator import (
    generate_batch,
    generate_variant,
    parse_number,
    solve_math,
    usability_rate,
    verify_variant,
)


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


# ---- P1-7：变式题必须有解 ----


@pytest.mark.parametrize("seed", [1, 2, 3, 4, 5, 6, 7, 8])
def test_variant_choice_is_self_consistent(seed):
    """任何 seed 生成的变式，答案值都必须等于变式题干的真值。"""
    v = generate_variant(_q(), seed=seed, delta=3)
    assert v.ok, v.error
    good, why = verify_variant(v.question)
    assert good, f"变式不自洽：{why}（{v.question.content} {v.question.options}）"
    # 显式把这条不变量写出来：答案值 == 真值
    assert parse_number(v.question.options[ord(v.question.answer) - 65]) == solve_math(v.question.content)


def test_variant_did_not_keep_stale_answer_value():
    """回归：旧实现平移选项却不动答案，答案字母会指向一个不等于真值的选项。"""
    v = generate_variant(_q(), seed=1, delta=2)
    assert v.ok, v.error
    # delta=2 → 变式题干 $-5 - 7 = ?$，真值 -12。旧实现会把原答案 -8 平移成 -10，
    # 于是 B 指向 -10 而真值是 -12 —— 选项里没有正确答案。
    assert solve_math(v.question.content) == -12
    assert parse_number(v.question.options[ord(v.question.answer) - 65]) == -12


def test_variant_blank_recomputed_from_content():
    """blank 分支同样不能"答案跟着 +delta"—— 必须按新题干重算。"""
    q = Question(
        id="q020", type="blank", content="计算：$6 \\times 7 = ?$",
        difficulty=0.4, answer="42", step_node_map={"step1": "a01"},
    )
    v = generate_variant(q, seed=2, delta=3)
    assert v.ok, v.error
    # 变式题干是 9 × 10，真值 90；旧实现会把 42 平移成 45
    assert solve_math(v.question.content) == 90
    assert str(v.question.answer).strip("$") == "90"


def test_variant_rejects_unsolvable_instead_of_guessing():
    """解不出真值的题必须拒发，不能给一道无解题下去。"""
    q = Question(
        id="q_eq", type="blank", content="解方程 $2x + 3 = 7$，$x = ?$",
        difficulty=0.5, answer="2", step_node_map={"step1": "a02"},
    )
    v = generate_variant(q, seed=1)
    assert not v.ok
    assert v.error


def test_variant_rejects_open_question():
    """解答题答案不是单一数值，无唯一真值可校验 → 拒发。"""
    q = Question(
        id="q_open", type="open", content="列方程并求解：小明比小红大 3 岁，两人年龄和为 15。",
        difficulty=0.6, answer="小明 9 岁，小红 6 岁", step_node_map={"step1": "a03"},
    )
    v = generate_variant(q, seed=1)
    assert not v.ok


def test_variant_deterministic():
    v1 = generate_variant(_q(), seed=7)
    v2 = generate_variant(_q(), seed=7)
    assert v1.question.content == v2.question.content


def test_variant_different_seeds_differ():
    """delta 空间不能太小 —— 否则不同 seed 撞出同一道"变式"。"""
    outs = {generate_variant(_q(), seed=s).question.content for s in range(1, 9)}
    assert len(outs) >= 5, f"8 个 seed 只产出 {len(outs)} 道不同变式：{outs}"


def test_verify_variant_catches_stale_answer():
    """verify_variant 必须能识破"答案字母指错值"的题（它就是 P1-7 的判据）。"""
    bad = Question(
        id="bad", type="choice", content="计算：$-4 - 6 = ?$",
        difficulty=0.3, options=["3", "-9", "9", "-3"], answer="B",
        step_node_map={"step1": "a01"},
    )
    good, why = verify_variant(bad)
    assert not good
    assert "真值" in why


# ---- P4-10：generate_batch 静默截断 ----


def test_batch_single_seed_broadcasts():
    """传 1 个 seed 要广播到每道题，而不是 zip 静默截断成 1 个。"""
    pack = load_pack("junior_math_eq_ineq")
    results = generate_batch(pack.questions, [3])
    assert len(results) == len(pack.questions)


def test_batch_mismatched_seeds_raises():
    """长度不匹配必须报错 —— 旧实现 zip 静默截断，文档里的 235/235 因此产生不了。"""
    pack = load_pack("junior_math_eq_ineq")
    with pytest.raises(ValueError):
        generate_batch(pack.questions, [1, 2, 3])


def test_batch_all_ids_unique():
    pack = load_pack("junior_math_eq_ineq")
    results = generate_batch(pack.questions, list(range(len(pack.questions))))
    ids = [r.question.id for r in results]
    assert len(ids) == len(set(ids))


# ---- P1-8：口径改为"答案自洽率" ----


def test_answered_variants_are_all_self_consistent():
    """口径：凡是通过生成的变式（ok=True），必须 100% 自洽。

    不再断言"可用率 ≥ 80%" —— 平移法对方程/不等式/解答题本就无解，
    硬凑数字只会把无解题算进分母。分母里保留拒发，是诚实的生成能力。
    """
    pack = load_pack("junior_math_eq_ineq")
    results = []
    for q in pack.questions:
        for seed in (1, 2, 3, 4, 5):
            results.extend(generate_batch([q], [seed]))
    produced = [r for r in results if r.ok]
    assert produced, "领域包应至少能生成一些变式"
    for r in produced:
        good, why = verify_variant(r.question)
        assert good, f"{r.question.id} 不自洽：{why}"
    rate = usability_rate(results)
    assert 0.0 < rate < 1.0, f"自洽率 {rate:.0%} —— 期望是「有一部分能生成、一部分拒发」"
