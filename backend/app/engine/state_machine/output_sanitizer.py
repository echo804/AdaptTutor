"""输出自检层（对齐 docs/03-项目架构.md 第 4 节）。

核心铁律"不直接给答案"的机器防线：
1. 规则自检：禁止最终答案句式 / 完整解题步骤 / 选项字母泄露
2. 泄露则重生成（最多 max_regenerations 次，回调由编排层注入——真实 LLM 场景
   即"轻量模型双重判定"的生成路径；mock 场景用模板）
3. 仍泄露 → 降级为更模糊的提示（degraded=True）

规则命中即视为泄露；轻量模型双重判定留接口（编排层可注入 LLMJudge）。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Callable

from app.domain.schemas import Question

# 禁止最终答案句式（命中即泄露）
FINAL_ANSWER_PATTERNS: list[re.Pattern] = [
    re.compile(r"答案\s*(?:是|为|：|:)"),
    re.compile(r"最终答案"),
    re.compile(r"正确\s*答案"),
    re.compile(r"结果\s*(?:是|为|等于)"),
]

# 完整解题步骤检测（"首先…然后…最后" / 连续两步罗列 / "解：+多行"）。
# 注意：单独"第一步"是引导语常用词（如"第一步是什么"），不算泄露；
# 只有连续步骤序列（"第一步…第二步"）才判定为完整步骤泄露。
STEP_PATTERNS: list[re.Pattern] = [
    re.compile(r"第[一二三四五六123456]步.{0,24}第[一二三四五六123456]步"),
    re.compile(r"首先.*然后.*最后", re.S),
    re.compile(r"解[:：]\s*\n.+\n.+", re.S),
    re.compile(r"(?:一步|二步|三步).*(?:得|算出|得到)", re.S),
]

# 选项字母泄露（choice 题：正文出现独立选项字母）
CHOICE_LEAK: re.Pattern = re.compile(r"选\s*([ABCD])\s*$|答案?[为是]\s*([ABCD])\b")
CHOICE_BARE: re.Pattern = re.compile(r"(?<![\w])\b[ABCD]\b(?![\w])")

# 数值答案泄露（粗匹配：= 后跟数字 / "等于 数字"）
VALUE_LEAK: re.Pattern = re.compile(r"(?:等于|=\s*)[-+]?\d+(?:\.\d+)?")

# 降级默认话术（更模糊的提示）
DEFAULT_FALLBACK = "再想想：检查一下这一步的依据，能不能换一种说法？"


@dataclass
class SanitizedResult:
    text: str            # 最终对外文本
    leaked: bool         # 最终是否仍泄露（degraded=True 时为 True）
    attempts: int        # 重生成尝试次数
    degraded: bool       # 是否降级为模糊提示
    reasons: list[str] = field(default_factory=list)


Generator = Callable[[int], str]


class OutputSanitizer:
    def __init__(self, generator: Generator | None = None, max_regenerations: int = 2) -> None:
        self.generator = generator
        self.max_regenerations = max_regenerations

    def check_leak(self, text: str, question: Question | None = None) -> list[str]:
        """规则自检，返回命中的泄露原因列表（空 = 通过）。"""
        reasons: list[str] = []
        for p in FINAL_ANSWER_PATTERNS:
            if p.search(text):
                reasons.append("最终答案句式")
                break
        for p in STEP_PATTERNS:
            if p.search(text):
                reasons.append("完整解题步骤")
                break
        if question is not None and question.type == "choice":
            if CHOICE_BARE.search(text):
                reasons.append("选项字母泄露")
        if VALUE_LEAK.search(text):
            reasons.append("数值答案泄露")
        return reasons

    def sanitize(
        self,
        text: str,
        question: Question | None = None,
        fallback: str | None = None,
    ) -> SanitizedResult:
        """自检 + 重生成 + 降级。"""
        fallback = fallback or DEFAULT_FALLBACK
        attempts = 0
        current = text
        reasons: list[str] = []

        for _ in range(self.max_regenerations):
            reasons = self.check_leak(current, question)
            if not reasons:
                return SanitizedResult(
                    text=current, leaked=False, attempts=attempts, degraded=False
                )
            attempts += 1
            if self.generator is None:
                break
            current = self.generator(attempts)

        # 仍泄露 → 降级
        return SanitizedResult(
            text=fallback, leaked=True, attempts=attempts, degraded=True, reasons=reasons
        )
