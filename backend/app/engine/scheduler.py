"""遗忘调度器（对齐 docs/03-项目架构.md 2.1 scheduler）。

- 间隔复习：掌握度越高，下次复习间隔越长
- decay_state（JSONB，存 mastery_states 表）：{"stage": n, "interval_days": d, "last_review_at": iso}
- 间隔序列 [1, 3, 7, 14, 30] 天，答对 stage+1，答错回退（最少 1 天）
- due_reviews(student)：到期（应复习）节点；schedule_next(lesson)：计算下次复习时间
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

# 间隔序列（天）：stage 0-4
INTERVALS_DAYS = [1, 3, 7, 14, 30]

# 掌握度阈值：p >= 0.85 视为高掌握，可跳到更长间隔
HIGH_MASTERY = 0.85


@dataclass
class ReviewState:
    """某节点的复习调度状态（对应 mastery_states.decay_state）。"""

    stage: int = 0
    interval_days: int = 1
    last_review_at: datetime | None = None

    def to_dict(self) -> dict:
        return {
            "stage": self.stage,
            "interval_days": self.interval_days,
            "last_review_at": self.last_review_at.isoformat()
            if self.last_review_at
            else None,
        }

    @classmethod
    def from_dict(cls, data: dict | None) -> "ReviewState":
        if not data:
            return cls()
        last = None
        if data.get("last_review_at"):
            last = datetime.fromisoformat(data["last_review_at"])
        return cls(
            stage=int(data.get("stage", 0)),
            interval_days=int(data.get("interval_days", 1)),
            last_review_at=last,
        )


def schedule_next(
    mastery_p: float,
    current: ReviewState | None = None,
    answered_correct: bool = True,
    now: datetime | None = None,
) -> ReviewState:
    """计算下次复习调度（答对进阶，答错回退；高掌握跳过中间档）。"""
    now = now or datetime.now(timezone.utc)
    cur = current or ReviewState()

    if not answered_correct:
        # 答错：回退到最短间隔（stage 0）
        return ReviewState(stage=0, interval_days=1, last_review_at=now)

    # 答对：stage 进阶（高掌握可跳 2 档）
    step = 2 if mastery_p >= HIGH_MASTERY else 1
    stage = min(cur.stage + step, len(INTERVALS_DAYS) - 1)
    return ReviewState(
        stage=stage,
        interval_days=INTERVALS_DAYS[stage],
        last_review_at=now,
    )


def is_due(
    review: ReviewState,
    now: datetime | None = None,
    grace_hours: int = 0,
) -> bool:
    """节点是否到期复习（从未复习即到期；间隔已过 + 宽限期内算到期）。"""
    now = now or datetime.now(timezone.utc)
    if review.last_review_at is None:
        return True
    next_at = review.last_review_at + timedelta(days=review.interval_days)
    return now >= next_at - timedelta(hours=grace_hours)


def due_reviews(
    mastery_rows: dict[str, ReviewState],
    now: datetime | None = None,
    grace_hours: int = 0,
) -> list[str]:
    """返回到期复习的节点列表（按掌握度升序，薄弱优先）。"""
    now = now or datetime.now(timezone.utc)
    due = [nid for nid, r in mastery_rows.items() if is_due(r, now, grace_hours)]
    return sorted(due)
