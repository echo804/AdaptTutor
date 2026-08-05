"""判题服务测试（M4r1：AI 判题）。"""

from app.domain.schemas import Question
from app.engine.evaluator import (
    JudgeResult,
    judge,
    judge_by_rule,
    judge_choice,
    judge_open,
)


def _q(qid: str, qtype: str, content: str, answer: str) -> Question:
    return Question(
        id=qid,
        type=qtype,
        content=content,
        difficulty=0.5,
        options=["A", "B", "C", "D"] if qtype == "choice" else [],
        answer=answer,
        step_node_map={"step1": "a01"},
    )


# ---- 选择题 ----

def test_judge_choice_correct():
    q = _q("c1", "choice", "1+1=?", "B")
    r = judge_choice("B", q)
    assert r.correct and r.method == "choice"
    assert r.feedback


def test_judge_choice_case_insensitive():
    q = _q("c2", "choice", "1+1=?", "B")
    assert judge_choice("b", q).correct
    assert not judge_choice("A", q).correct


# ---- 规则兜底 ----

def test_rule_numeric_tolerance():
    q = _q("n1", "blank", "x=?", "3")
    assert judge_by_rule("3", q).correct
    assert judge_by_rule("3.0", q).correct  # 浮点容差
    assert not judge_by_rule("5", q).correct


def test_rule_keyword_match():
    q = _q("k1", "blank", "结果？", "移项变号")
    assert judge_by_rule("应该移项变号", q).correct
    assert not judge_by_rule("合并同类项", q).correct


def test_rule_cannot_judge_returns_none():
    q = _q("u1", "open", "思路？", "x")  # 单字符答案无法规则判定
    assert judge_by_rule("任意思路", q) is None


# ---- 统一入口 ----

def test_judge_dispatches_by_type():
    qc = _q("d1", "choice", "?", "A")
    assert judge("A", qc).method == "choice"
    qo = _q("d2", "blank", "x=?", "5")
    r = judge("5", qo)  # 规则兜底（无 key → mock）
    assert r.method == "rule"


def test_judge_open_rule_positive_skips_llm():
    """规则已判对 → 直接返回，不调 LLM。"""
    q = _q("p1", "blank", "x=?", "7")
    r = judge_open("答案是 7", q)  # 无 gateway → 默认 mock，但规则判对提前返回
    assert r.correct and r.method == "rule"


def test_judge_open_mock_degraded_when_rule_negative():
    """规则判错 + 无 key（mock）→ degraded 规则结果。"""
    q = _q("m1", "blank", "x=?", "7")
    r = judge_open("答案是 5", q)
    assert not r.correct
    assert r.degraded
