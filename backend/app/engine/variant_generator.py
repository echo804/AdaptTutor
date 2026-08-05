"""变式题生成器（M3：变式题可用 ≥ 80%）。

实现：模板参数化——抽取题干中的整数，按种子确定性加偏移生成新题干；
blank/open 题的数值答案同步变换；choice 题选项数值同步变换（答案字母不变）。
LLM 生成预留：调用方可改用 llm_gateway.generate("generate", ...) 产出变式
（04 决策：LLM 初稿 + 人工校验），本模块为确定性兜底（mock 无 key 场景）。
生成结果必须通过 Question schema 校验（可用性判据）。
"""

from __future__ import annotations

import random
import re
from dataclasses import dataclass

from app.domain.schemas import Question

_NUM = re.compile(r"(?<![\w.])(-?\d+)(?![\w.])")


@dataclass
class VariantResult:
    question: Question
    seed: int
    ok: bool          # 是否通过 schema 校验
    error: str | None = None


def _shift_numbers(text: str, delta: int) -> str:
    """题干中所有整数 +delta（0 与负号规则保持）。"""
    def repl(m):
        v = int(m.group(1))
        if v == 0:
            return "0"
        return str(v + delta if v > 0 else v - delta)

    return _NUM.sub(repl, text)


def generate_variant(q: Question, seed: int, delta: int | None = None) -> VariantResult:
    """生成变式题（确定性）。

    delta 未指定时由 seed 派生（1-5，保证非 0 变化）。
    """
    rng = random.Random(seed)
    d = delta if delta is not None else rng.randint(1, 5)

    try:
        new_content = _shift_numbers(q.content, d)
        new_answer = q.answer
        if q.type in ("blank", "open"):
            new_answer = _shift_numbers(q.answer, d)
        elif q.type == "choice":
            # 选项数值同步变换；答案字母保持不变
            new_options = [_shift_numbers(o, d) for o in q.options]

        variant = Question(
            id=f"{q.id}v{seed}",
            type=q.type,
            content=new_content,
            difficulty=min(1.0, max(0.0, q.difficulty + rng.uniform(-0.05, 0.05))),
            options=new_options if q.type == "choice" else q.options,
            answer=new_answer,
            step_node_map=q.step_node_map,
        )
        return VariantResult(question=variant, seed=seed, ok=True)
    except Exception as e:  # schema 校验失败等
        return VariantResult(question=q, seed=seed, ok=False, error=str(e))


def generate_batch(
    questions: list[Question], seeds: list[int]
) -> list[VariantResult]:
    """批量生成并统计可用率（验收：≥ 80%）。"""
    results = [generate_variant(q, s) for q, s in zip(questions, seeds)]
    return results


def usability_rate(results: list[VariantResult]) -> float:
    if not results:
        return 0.0
    return sum(1 for r in results if r.ok) / len(results)
