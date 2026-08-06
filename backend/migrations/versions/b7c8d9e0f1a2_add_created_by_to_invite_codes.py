"""add created_by to invite_codes

Revision ID: b7c8d9e0f1a2
Revises: a1b2c3d4e5f6
Create Date: 2026-08-06

invite_codes.created_by：邀请码生成者（M4r19「我的邀请码」列表/持有上限）。
可空——早期 CLI 生成的旧码无生成者。
"""

from alembic import op
import sqlalchemy as sa

revision = "b7c8d9e0f1a2"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("invite_codes", sa.Column("created_by", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("invite_codes", "created_by")
