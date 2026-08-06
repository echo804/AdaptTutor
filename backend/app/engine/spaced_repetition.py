"""SM-2 间隔重复调度（M6 遗忘调度升级）。

简化版 SM-2（单质量分）：
- 答错：repetitions=0、interval=1 天、ease 衰减（-0.2，下限 1.3）
- 答对：repetitions+1；interval = 1（首对）→ 3 → round(interval * ease)；
        ease 微调（+0.1，上限 2.8）；重复学习（repetitions==0 后首对）interval=1
- due_at = now + interval
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

EASE_MIN = 1.3
EASE_MAX = 2.8
EASE_DECAY = 0.2  # 答错衰减
EASE_BOOST = 0.1  # 答对增益


@dataclass(frozen=True)
class ScheduleState:
    interval_days: int
    ease: float
    repetitions: int


def next_interval(repetitions: int, ease: float) -> int:
    """SM-2 间隔计算：0→1，1→3，之后按 ease 倍增。"""
    if repetitions <= 0:
        return 1
    if repetitions == 1:
        return 3
    return max(1, round(3 * (ease ** (repetitions - 1))))


def on_answered(
    correct: bool,
    *,
    interval_days: int = 1,
    ease: float = 2.5,
    repetitions: int = 0,
    now: datetime | None = None,
) -> tuple[ScheduleState, datetime]:
    """根据本次作答结果推进调度，返回 (新状态, 下次 due_at)。"""
    now = now or datetime.now(timezone.utc)
    if correct:
        rep = repetitions + 1
        interval = next_interval(rep, ease)
        new_ease = min(EASE_MAX, ease + EASE_BOOST)
        due_at = now + timedelta(days=interval)
    else:
        rep = 0
        interval = 1
        new_ease = max(EASE_MIN, ease - EASE_DECAY)
        due_at = now  # 答错 → 立即可复习
    return ScheduleState(interval, new_ease, rep), due_at
