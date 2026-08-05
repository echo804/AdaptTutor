"""拒答检测规则引擎（对齐 02 M2：拒答检测规则引擎）。

LLM 可能直接拒答（"作为 AI 我不能…"）或消极敷衍（"我无法帮助你"）。
编排层在拿到 LLM 回复后先过拒答检测：命中则重试（换提示措辞）或降级模板话术。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

REFUSAL_PATTERNS: list[re.Pattern] = [
    re.compile(r"作为\s*(?:一个)?\s*(?:AI|人工智能|助手|模型)"),
    re.compile(r"(?:抱歉|对不起)[，,。\s]*(?:我)?(?:不能|无法|不会|帮不了)"),
    re.compile(r"我[还]?不能(?:直接|现在)"),
    re.compile(r"无法(?:帮助|回答|协助|处理)"),
    re.compile(r"帮不了(?:你|您)"),
    re.compile(r"(?:超出|不在).{0,12}(?:能力|范围|职责)"),
]

# 消极敷衍（回答不含实质内容）
EVASION_WORDS = ("嗯嗯", "好的好的", "随便", "我不知道怎么说", "你说了算")


@dataclass
class RefusalCheck:
    refused: bool
    reason: str | None      # 命中的拒答类型
    matched: list[str] = field(default_factory=list)


def check_refusal(text: str) -> RefusalCheck:
    """检测 LLM 回复是否为拒答/敷衍。返回 RefusalCheck。"""
    matched = [p.pattern for p in REFUSAL_PATTERNS if p.search(text)]
    if matched:
        return RefusalCheck(refused=True, reason="拒答句式", matched=matched)
    if any(w in text for w in EVASION_WORDS) and len(text) < 20:
        return RefusalCheck(refused=True, reason="消极敷衍", matched=[])
    return RefusalCheck(refused=False, reason=None, matched=[])
