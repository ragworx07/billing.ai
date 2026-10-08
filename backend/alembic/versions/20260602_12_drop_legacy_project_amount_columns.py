"""drop legacy project amount columns

Revision ID: 20260602_12
Revises: 20260602_11
Create Date: 2026-06-02
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260602_12"
down_revision: str | Sequence[str] | None = "20260602_11"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("projects", "quoted_amount")
    op.drop_column("project_shareholders", "share_count")


def downgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("quoted_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
    )
    op.alter_column("projects", "quoted_amount", server_default=None)

    op.add_column(
        "project_shareholders",
        sa.Column("share_count", sa.Integer(), nullable=False, server_default="1"),
    )
    op.alter_column("project_shareholders", "share_count", server_default=None)
