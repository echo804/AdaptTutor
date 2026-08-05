"""判题服务（M4r1：AI 判题，对齐 03 2.1 evaluator 扩展）。

- judge_choice：选择题选项比对（字母 A/B/C/D）
- judge_open：填空/解答题——LLM 判题（gateway generate role=judge）+ 规则兜底
  （无 key / LLM 失败时：数字容差比较、关键词匹配），体验不中断
- 判题反馈：正确/错误 + 一句 AI 反馈（LLM 或模板）
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

from app.domain.schemas import Question
from app.engine.llm_gateway.gateway import LLMGateway, GatewayResponse

_NUM = re.compile(r"-?\d+(?:\.\d+)?")

# 规则兜底反馈模板
_FEEDBACK_CORRECT = "思路正确，这一步掌握了。"
_FEEDBACK_WRONG = "答案不太对，我们回到这一步再看一遍依据。"


@dataclass
class JudgeResult:
    correct: bool
    feedback: str
    method: str = "rule"  # choice | rule | llm | mock
    degraded: bool = False


# ---------- 选择题 ----------

def judge_choice(user_choice: str, question: Question) -> JudgeResult:
    """选择题：比对选项字母（A/B/C/D，容错小写/空格）。"""
    u = user_choice.strip().upper()
    correct = u == question.answer.strip().upper()
    return JudgeResult(
        correct=correct,
        feedback=_FEEDBACK_CORRECT if correct else _FEEDBACK_WRONG,
        method="choice",
    )


# ---------- 规则兜底（填空/解答） ----------

def _extract_numbers(text: str) -> list[float]:
    return [float(m) for m in _NUM.findall(text)]


def judge_by_rule(user_text: str, question: Question) -> JudgeResult | None:
    """规则兜底：数字容差比较 / 关键词匹配。无法判定返回 None。"""
    ans = question.answer.strip()
    user = user_text.strip()

    # 1. 数字比较（题目答案含数字时）
    ans_nums = _extract_numbers(ans)
    user_nums = _extract_numbers(user)
    if ans_nums:
        # 答案所有数字都在学生回答中出现（浮点容差）
        matched = all(any(abs(a - u) < 0.01 for u in user_nums) for a in ans_nums)
        return JudgeResult(
            correct=matched,
            feedback=_FEEDBACK_CORRECT if matched else _FEEDBACK_WRONG,
            method="rule",
        )

    # 2. 关键词匹配（答案文本出现在学生回答中，忽略空白）
    if len(ans) >= 2:
        norm = lambda s: re.sub(r"\s+", "", s)  # noqa: E731
        if norm(ans) in norm(user):
            return JudgeResult(correct=True, feedback=_FEEDBACK_CORRECT, method="rule")
        return JudgeResult(correct=False, feedback=_FEEDBACK_WRONG, method="rule")

    return None  # 无法判定（交给 LLM）


# ---------- LLM 判题（填空/解答） ----------

_JUDGE_PROMPT = """你是数学辅导判题器。根据题目、标准答案与学生答案，判断学生答案是否正确，并给一句不超过 30 字的引导式反馈（不直接给完整答案）。

题目：{content}
标准答案：{answer}
学生答案：{student}

只输出 JSON：{{"correct": true/false, "feedback": "一句话反馈"}}
"""


def _parse_judge_json(text: str) -> dict | None:
    try:
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            return None
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None


def judge_open(
    user_text: str,
    question: Question,
    gateway: LLMGateway | None = None,
    ctx: dict | None = None,
) -> JudgeResult:
    """填空/解答题判题：LLM 优先，规则兜底（无 key/LLM 失败）。"""
    rule = judge_by_rule(user_text, question)
    if rule is not None and rule.correct:
        # 规则已判对 → 直接通过（避免无谓 LLM 调用）
        return rule

    gateway = gateway or LLMGateway()
    prompt = _JUDGE_PROMPT.format(
        content=question.content, answer=question.answer, student=user_text
    )
    resp: GatewayResponse = gateway.generate("judge", prompt, ctx)
    if resp.mock or resp.level >= 2:
        # 无 key 或降级 → 规则兜底结果
        base = rule or JudgeResult(correct=False, feedback=_FEEDBACK_WRONG, method="rule")
        return JudgeResult(
            correct=base.correct, feedback=base.feedback, method=base.method, degraded=True
        )

    parsed = _parse_judge_json(resp.text)
    if parsed is None or "correct" not in parsed:
        # LLM 输出不可解析 → 规则兜底
        base = rule or JudgeResult(correct=False, feedback=_FEEDBACK_WRONG, method="rule")
        return JudgeResult(
            correct=base.correct, feedback=base.feedback, method=base.method, degraded=True
        )

    feedback = str(parsed.get("feedback") or (_FEEDBACK_CORRECT if parsed["correct"] else _FEEDBACK_WRONG))
    return JudgeResult(
        correct=bool(parsed["correct"]),
        feedback=feedback,
        method="llm",
    )


def judge(
    user_answer: str,
    question: Question,
    gateway: LLMGateway | None = None,
    ctx: dict | None = None,
) -> JudgeResult:
    """统一入口：按题型分发判题。"""
    if question.type == "choice":
        return judge_choice(user_answer, question)
    return judge_open(user_answer, question, gateway, ctx)
