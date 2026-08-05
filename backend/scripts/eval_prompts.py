"""引导语质量评估（对齐 02 M2 验收：引导语质量 ≥ 90%）。

用法（backend 目录）：.venv\\Scripts\\python.exe scripts/eval_prompts.py
判定：每条样本需同时满足
  1) OutputSanitizer.check_leak 不命中（不泄露答案/步骤/选项）
  2) 命中引导式句式词（想一想/检查/依据/为什么/卡在哪 等）
通过率 = 通过样本数 / 总数，需 ≥ 0.90。
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.domain.loader import load_pack
from app.engine.state_machine.output_sanitizer import OutputSanitizer
from tests.evaluation.prompt_regression import GUIDING_WORDS, REGRESSION_SAMPLES


def evaluate(pack_id: str = "junior_math_eq_ineq") -> tuple[float, list[str]]:
    pack = load_pack(pack_id)
    by_id = {q.id: q for q in pack.questions}
    sanitizer = OutputSanitizer()
    passed: list[str] = []
    failed: list[str] = []

    for qid, prompt in REGRESSION_SAMPLES:
        q = by_id.get(qid)
        if q is None:
            failed.append(f"{qid}: 题库中不存在")
            continue
        leaks = sanitizer.check_leak(prompt, q)
        guiding = any(w in prompt for w in GUIDING_WORDS)
        if not leaks and guiding:
            passed.append(qid)
        else:
            reasons = leaks or (["非引导式"] if not guiding else [])
            failed.append(f"{qid}: {','.join(reasons)}")

    quality = len(passed) / len(REGRESSION_SAMPLES)
    return quality, failed


def main() -> None:
    quality, failed = evaluate()
    total = len(REGRESSION_SAMPLES)
    print(f"引导语质量: {quality:.0%}（{total - len(failed)}/{total} 通过）")
    if failed:
        print("未通过样本:")
        for f in failed:
            print("  -", f)
    ok = quality >= 0.9
    print("验收:", "达标（≥90%）" if ok else "未达标（<90%）")
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
