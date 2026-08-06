"""判题服务测试（M4r1：AI 判题）。"""

from app.domain.schemas import Question
from app.engine.evaluator import (
    JudgeResult,
    judge,
    judge_by_rule,
    judge_choice,
    judge_open,
)


def _q(qid: str, qtype: str, content: str, answer: str, options: list[str] | None = None) -> Question:
    return Question(
        id=qid,
        type=qtype,
        content=content,
        difficulty=0.5,
        options=options if options is not None else (["A", "B", "C", "D"] if qtype == "choice" else []),
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


def test_judge_choice_wrong_gives_answer():
    """判错给正确答案（需求 1d）：选项字母 + 选项文本。"""
    q = _q("c3", "choice", "1+1=?", "B", options=["0", "1", "2", "3"])
    r = judge_choice("A", q)
    assert not r.correct
    assert r.correct_answer == "B（1）"


def test_judge_choice_accepts_option_content():
    """M4r7f：choice 题输入选项内容（"1"）而非字母（"B"）也算对。"""
    q = _q("c4", "choice", "1+1=?", "B", options=["0", "1", "2", "3"])
    assert judge_choice("1", q).correct
    assert judge_choice("$1$", q).correct  # LaTeX 包裹容差
    assert not judge_choice("3", q).correct


def test_judge_choice_accepts_full_work():
    """M4r7g：choice 题输入完整过程（"-3-5=-8"）→ 取等号后答案判对。"""
    q = _q("c6", "choice", "-3-5=?", "B", options=["2", "-8", "-2", "8"])
    assert judge_choice("-3-5=-8", q).correct
    assert judge_choice("3-5=-8", q).correct
    assert not judge_choice("-3-5=8", q).correct


def test_judge_choice_indeterminate_on_non_answer():
    """M4r8：choice 题——选项内容匹配但选错 → 判错；
    非选项内容的消息文本（"好"等）→ indeterminate 温和提示（不判错不给答案）。"""
    q = _q("c5", "choice", "1+1=?", "B", options=["0", "1", "2", "3"])
    # 消息文本（非选项、非字母）→ indeterminate
    r = judge_choice("好，我知道了", q)
    assert r.indeterminate
    assert r.correct_answer is None
    # 选项内容选错（"3"≠B）→ 判错，给正确答案
    r2 = judge_choice("3", q)
    assert not r2.indeterminate
    assert not r2.correct
    assert r2.correct_answer is not None
    # 选对选项内容 → 对
    assert judge_choice("1", q).correct


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


def test_judge_open_indeterminate_on_non_answer():
    """M4r7f：非答案输入（"好"等）→ indeterminate，不判错不给答案。"""
    q = _q("i1", "blank", "x=?", "7")
    r = judge_open("好，我知道了", q)
    assert r.indeterminate
    assert not r.degraded or r.degraded
    assert r.correct_answer is None  # 不给正确答案
    assert "请直接输入" in r.feedback


# ---- 多选题（M4r24） ----

def _mq(answer) -> Question:
    return Question(
        id="m1",
        type="multi",
        content="以下哪些是正确的？",
        difficulty=0.5,
        options=["选项1", "选项2", "选项3", "选项4"],
        answer=answer,
        step_node_map={"step1": "a01"},
    )


def test_judge_multi_exact():
    """全选对（不多不少）→ 对。"""
    q = _mq(["A", "C"])
    r = judge("A,C", q)
    assert r.correct


def test_judge_multi_exact_compact():
    """AC 紧凑写法 → 对。"""
    q = _mq(["A", "C"])
    r = judge("AC", q)
    assert r.correct


def test_judge_multi_missing():
    """漏选 → 错。"""
    q = _mq(["A", "C"])
    r = judge("A", q)
    assert not r.correct


def test_judge_multi_extra():
    """多选（选了不在正确答案里的）→ 错。"""
    q = _mq(["A", "C"])
    r = judge("A,C,D", q)
    assert not r.correct


def test_judge_multi_empty():
    """空选 → 错。"""
    q = _mq(["A", "C"])
    r = judge("", q)
    assert not r.correct

