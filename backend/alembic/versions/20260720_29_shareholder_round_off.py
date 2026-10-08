"""add shareholder round_off adjustment

Revision ID: 20260720_29
Revises: 20260717_28
Create Date: 2026-07-20 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260720_29"
down_revision = "20260717_28"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "project_shareholders",
        sa.Column("round_off", sa.Numeric(precision=12, scale=2), nullable=False, server_default="0"),
    )
    op.alter_column("project_shareholders", "round_off", server_default=None)


def downgrade() -> None:
    op.drop_column("project_shareholders", "round_off")
