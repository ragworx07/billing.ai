"""add vendor transaction round_off adjustment

Revision ID: 20260901_35
Revises: 20260728_34
Create Date: 2026-09-01 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260901_35"
down_revision = "20260728_34"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "vendor_transactions",
        sa.Column("round_off", sa.Numeric(precision=12, scale=2), nullable=False, server_default="0"),
    )
    op.alter_column("vendor_transactions", "round_off", server_default=None)


def downgrade() -> None:
    op.drop_column("vendor_transactions", "round_off")
