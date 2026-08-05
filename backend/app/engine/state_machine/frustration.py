"""挫败感检测（对齐 docs/03-项目架构.md 第 4 节）。

触发条件（任一）：
1. 连续答错 ≥ 3 次（context.consecutive_wrong）
2. 学生回复长度骤降（相对近期均值 < 40%）
3. 负面情绪词命中（"不会/太难/算了/不想/放弃/好烦" 等）

动作建议：lower_hint（降提示层级）/ switch_explain（切讲解模式）。
供编排层在产出事件前调用，以决定是否把 HINT_GIVEN 改为 GIVE_UP 等。
"""

from __future__ import annotations

from dataclasses import dataclass

NEGATIVE_WORDS = (
    "不会", "太难", "不懂", "算了", "不想", "放弃", "好烦",
    "没意思", "看不懂", "学不会", "帮帮我", "直接告诉我",
)

# 与近期回复均值相比低于该比例视为"回复骤降"
LENGTH_DROP_RATIO = 0.4


@dataclass
class FrustrationAssessment:
    frustrated: bool
    reasons: list[str]      # 触发的条件说明
    action: str | None      # "lower_hint" | "switch_explain" | None


def _negativity(text: str) -> bool:
    return any(w in text for w in NEGATIVE_WORDS)


def assess_frustration(
    context: dict,
    last_reply: str,
    recent_replies: list[str] | None = None,
) -> FrustrationAssessment:
    """综合评估挫败感。

    context: 状态机上下文（至少含 consecutive_wrong）
    last_reply: 学生最近一条回复
    recent_replies: 学生近几轮回复（用于长度骤降判定，可省略）
    """
    reasons: list[str] = []
    action: str | None = None

    # 1. 连续答错
    wrongs = context.get("consecutive_wrong", 0)
    if wrongs >= 3:
        reasons.append(f"连续答错 {wrongs} 次")

    # 2. 回复长度骤降
    if recent_replies:
        lengths = [len(r) for r in recent_replies]
        avg = sum(lengths) / len(lengths) if lengths else 0
        if avg > 0 and len(last_reply) < avg * LENGTH_DROP_RATIO:
            reasons.append(f"回复骤降（{len(last_reply)} < 均值 {avg:.0f}×{LENGTH_DROP_RATIO}）")

    # 3. 负面情绪词
    if _negativity(last_reply):
        reasons.append("负面情绪词命中")

    if not reasons:
        return FrustrationAssessment(frustrated=False, reasons=[], action=None)

    # 动作决策：明确放弃/负面词+连错 → 切讲解；其余 → 降提示层级
    if "负面情绪词命中" in reasons and wrongs >= 2:
        action = "switch_explain"
    elif "连续答错" in reasons:
        action = "switch_explain" if wrongs >= 4 else "lower_hint"
    else:
        action = "lower_hint"

    return FrustrationAssessment(frustrated=True, reasons=reasons, action=action)
