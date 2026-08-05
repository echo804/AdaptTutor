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
_FEEDBACK_INDETERMINATE = "请直接输入你的答案（数字或关键步骤），我来判断对不对。"


@dataclass
class JudgeResult:
    correct: bool
    feedback: str
    method: str = "rule"  # choice | rule | llm | mock
    degraded: bool = False
    correct_answer: str | None = None  # M4r5：判错时展示正确答案（用户需求 1d）
    explanation: str | None = None     # 简短解析（有则附）
    indeterminate: bool = False        # M4r7f：无法判定（非答案输入）→ 温和提示重答，不推进状态机


# ---------- 选择题 ----------

def judge_choice(user_choice: str, question: Question) -> JudgeResult:
    """选择题：比对选项字母（A/B/C/D，容错小写/空格/选项内容）。

    M4r7f：兼容直接输入选项内容（如答案"10"而非字母"C"）。
    """
    u = user_choice.strip().upper()
    # M4r7g：用户输入含过程（"-3-5=-8"）→ 取等号后作为答案再比对
    if "=" in u:
        u = u.split("=")[-1].strip().upper() or u
    ans = question.answer.strip().upper()
    correct = u == ans
    if not correct:
        # 按选项内容匹配（去空白/LaTeX 包裹）——兼容直接输入选项内容
        norm = lambda s: s.replace(" ", "").strip("$").upper()  # noqa: E731
        for i, o in enumerate(question.options):
            if norm(o) == norm(u):
                correct = chr(65 + i) == ans
                break
        else:
            # 不匹配任何选项内容：单个字母且在选项范围内 → 判错（选错选项）；
            # 其余（中文/消息文本）→ indeterminate，温和提示重答（M4r7f）
            if not (len(u) == 1 and u.isalpha() and ord(u) - 65 < len(question.options)):
                return JudgeResult(
                    correct=False,
                    feedback=_FEEDBACK_INDETERMINATE,
                    method="choice",
                    indeterminate=True,
                )
    idx = ord(ans) - 65 if len(ans) == 1 and ans.isalpha() else -1
    opt = question.options[idx] if 0 <= idx < len(question.options) else None
    return JudgeResult(
        correct=correct,
        feedback=_FEEDBACK_CORRECT if correct else _FEEDBACK_WRONG,
        method="choice",
        correct_answer=None if correct else f"{ans}（{opt}）" if opt else ans,
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
        if not user_nums:
            return None  # M4r7f：学生输入不含数字 → 无法判定（非答案）
        # 答案所有数字都在学生回答中出现（浮点容差）
        matched = all(any(abs(a - u) < 0.01 for u in user_nums) for a in ans_nums)
        return JudgeResult(
            correct=matched,
            feedback=_FEEDBACK_CORRECT if matched else _FEEDBACK_WRONG,
            method="rule",
            correct_answer=None if matched else ans,
        )

    # 2. 关键词匹配（答案文本出现在学生回答中，忽略空白）
    if len(ans) >= 2:
        norm = lambda s: re.sub(r"\s+", "", s)  # noqa: E731
        if norm(ans) in norm(user):
            return JudgeResult(correct=True, feedback=_FEEDBACK_CORRECT, method="rule")
        return JudgeResult(
            correct=False, feedback=_FEEDBACK_WRONG, method="rule", correct_answer=ans
        )

    return None  # 无法判定（交给 LLM）


# ---------- LLM 判题（填空/解答） ----------

_JUDGE_PROMPT = """你是数学辅导判题器。根据题目、标准答案与学生答案，判断学生答案是否正确，给一句不超过 30 字的引导式反馈；若学生答错，在 correct_answer 中给出标准答案（简洁，含选项字母或数值/结论）。

题目：{content}
标准答案：{answer}
学生答案：{student}

只输出 JSON：{{"correct": true/false, "feedback": "一句话反馈", "correct_answer": "标准答案（仅答错时）"}}
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
        # M4r7f：无 key/降级且规则无法判定 → indeterminate（非答案输入，温和提示重答）
        if rule is None:
            return JudgeResult(
                correct=False,
                feedback=_FEEDBACK_INDETERMINATE,
                method="rule",
                degraded=True,
                indeterminate=True,
            )
        # 规则兜底结果
        return JudgeResult(
            correct=rule.correct,
            feedback=rule.feedback,
            method=rule.method,
            degraded=True,
            correct_answer=rule.correct_answer,
        )

    parsed = _parse_judge_json(resp.text)
    if parsed is None or "correct" not in parsed:
        # LLM 输出不可解析 → 规则兜底（含 indeterminate）
        base = rule or JudgeResult(
            correct=False, feedback=_FEEDBACK_INDETERMINATE, method="rule", indeterminate=True
        )
        return JudgeResult(
            correct=base.correct,
            feedback=base.feedback,
            method=base.method,
            degraded=True,
            correct_answer=base.correct_answer,
            indeterminate=base.indeterminate,
        )

    feedback = str(parsed.get("feedback") or (_FEEDBACK_CORRECT if parsed["correct"] else _FEEDBACK_WRONG))
    return JudgeResult(
        correct=bool(parsed["correct"]),
        feedback=feedback,
        method="llm",
        correct_answer=str(parsed["correct_answer"]) if parsed.get("correct_answer") else None,
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
