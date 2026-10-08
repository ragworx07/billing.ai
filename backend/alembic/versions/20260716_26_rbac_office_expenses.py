"""add named RBAC categories and office expenses

Revision ID: 20260716_26
Revises: 20260716_25
Create Date: 2026-07-16 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260716_26"
down_revision = "20260716_25"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for value in ("client_manager", "project_manager", "project_coordinator"):
            op.execute(f"ALTER TYPE user_role ADD VALUE IF NOT EXISTS '{value}'")

    op.add_column("users", sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()))

    op.create_table(
        "office_expenses",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("category", sa.String(length=80), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("bill_url", sa.String(length=500), nullable=True),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
    )
    op.create_index("ix_office_expenses_id", "office_expenses", ["id"])
    op.create_index("ix_office_expenses_date", "office_expenses", ["date"])
    op.create_index("ix_office_expenses_week_start", "office_expenses", ["week_start"])


def downgrade() -> None:
    op.drop_index("ix_office_expenses_week_start", table_name="office_expenses")
    op.drop_index("ix_office_expenses_date", table_name="office_expenses")
    op.drop_index("ix_office_expenses_id", table_name="office_expenses")
    op.drop_table("office_expenses")
    op.drop_column("users", "is_active")
