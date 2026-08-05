"""输出自检层 + 拒答检测测试。"""

from app.domain.schemas import Question
from app.engine.state_machine.output_sanitizer import OutputSanitizer
from app.engine.state_machine.refusal_detector import check_refusal


def _q(qtype: str = "choice") -> Question:
    return Question(
        id="t1",
        type=qtype,
        content="题干",
        difficulty=0.5,
        answer="A",
        step_node_map={"step1": "a01"},
    )


# ---- 自检通过 ----

def test_clean_text_passes():
    s = OutputSanitizer()
    r = s.sanitize("想一想：移项时符号要变号，你检查一下这一步。", _q())
    assert not r.leaked and not r.degraded
    assert r.text == "想一想：移项时符号要变号，你检查一下这一步。"


# ---- 泄露检测 ----

def test_final_answer_phrase_leak():
    s = OutputSanitizer()
    r = s.sanitize("答案是 B。", _q())
    assert r.degraded and r.leaked
    assert "最终答案句式" in r.reasons


def test_full_steps_leak():
    s = OutputSanitizer()
    r = s.sanitize("第一步移项，第二步合并，第三步系数化为 1。", _q())
    assert r.degraded
    assert "完整解题步骤" in r.reasons


def test_choice_letter_leak():
    s = OutputSanitizer()
    r = s.sanitize("选 A 就对了。", _q("choice"))
    assert r.degraded
    assert "选项字母泄露" in r.reasons


def test_value_leak():
    s = OutputSanitizer()
    r = s.sanitize("所以 x = 3，你明白了吗", _q("blank"))
    assert r.degraded
    assert "数值答案泄露" in r.reasons


# ---- 重生成与降级路径 ----

def test_regenerate_until_clean():
    """第一次泄露，重生成返回干净文本 → 用重生成结果，不降级。"""
    s = OutputSanitizer(generator=lambda n: "再想一想：注意符号变化。")
    r = s.sanitize("答案是 B。", _q())
    assert r.attempts == 1
    assert not r.degraded and not r.leaked
    assert "注意符号变化" in r.text


def test_degrade_after_max_regenerations():
    """连续泄露超过上限 → 降级为模糊提示。"""
    s = OutputSanitizer(generator=lambda n: f"答案还是 B（第{n}次）")
    r = s.sanitize("答案是 B。", _q())
    assert r.attempts == 2
    assert r.degraded and r.leaked
    assert "再想想" in r.text


def test_no_generator_degrades_immediately():
    s = OutputSanitizer()
    r = s.sanitize("正确答案是 3。", _q("blank"))
    assert r.attempts == 1  # 自检 1 次后无重生成能力即降级
    assert r.degraded


def test_custom_fallback():
    s = OutputSanitizer()
    r = s.sanitize("答案是 A。", _q(), fallback="自定义模糊提示")
    assert r.text == "自定义模糊提示"


# ---- 拒答检测 ----

def test_refusal_ai_phrase():
    r = check_refusal("作为 AI，我不能直接告诉你答案。")
    assert r.refused and r.reason == "拒答句式"


def test_refusal_sorry():
    r = check_refusal("抱歉，我无法帮你完成这道题。")
    assert r.refused


def test_evasion_short():
    r = check_refusal("嗯嗯")
    assert r.refused and r.reason == "消极敷衍"


def test_normal_reply_not_refusal():
    r = check_refusal("你再看看第二步：移项的时候，等号两边要同时操作。")
    assert not r.refused
