"""add context to sessions

Revision ID: a1b2c3d4e5f6
Revises: f9ab32d5d177
Create Date: 2026-08-05

sessions.context：状态机快照 + 掌握度 + 路径（M3 会话恢复 100% 依据）。
对齐 docs/03-项目架构.md 第 4 节"状态存于 sessions.status + 上下文"。
"""

from alembic import op
import sqlalchemy as sa

revision = "a1b2c3d4e5f6"
down_revision = "f9ab32d5d177"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sessions", sa.Column("context", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("sessions", "context")
