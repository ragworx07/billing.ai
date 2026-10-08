"""add administrator user role

Revision ID: 20260717_28
Revises: 20260717_27
Create Date: 2026-07-17 00:00:00
"""

from alembic import op


revision = "20260717_28"
down_revision = "20260717_27"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'administrator'")


def downgrade() -> None:
    # PostgreSQL enum values cannot be removed safely in-place. The role is
    # intentionally retained on downgrade so existing administrator accounts
    # remain readable.
    pass
