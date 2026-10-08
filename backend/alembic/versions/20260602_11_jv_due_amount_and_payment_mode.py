"""add jv due amounts and payment modes

Revision ID: 20260602_11
Revises: 20260527_10
Create Date: 2026-06-02
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "20260602_11"
down_revision: str | Sequence[str] | None = "20260527_10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    table_names = set(inspect(bind).get_table_names())

    op.add_column(
        "project_shareholders",
        sa.Column("due_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
    )
    op.alter_column("project_shareholders", "due_amount", server_default=None)

    if "shareholder_payments" not in table_names:
        op.create_table(
            "shareholder_payments",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("project_id", sa.Integer(), nullable=False),
            sa.Column("shareholder_id", sa.Integer(), nullable=False),
            sa.Column("payment_date", sa.Date(), nullable=False),
            sa.Column("amount", sa.Numeric(12, 2), nullable=False),
            sa.Column("payment_mode", sa.String(length=50), nullable=True),
            sa.Column("notes", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["shareholder_id"], ["project_shareholders.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_shareholder_payments_id"), "shareholder_payments", ["id"], unique=False)
        op.create_index(op.f("ix_shareholder_payments_project_id"), "shareholder_payments", ["project_id"], unique=False)
        op.create_index(
            op.f("ix_shareholder_payments_shareholder_id"),
            "shareholder_payments",
            ["shareholder_id"],
            unique=False,
        )
    else:
        op.add_column("shareholder_payments", sa.Column("payment_mode", sa.String(length=50), nullable=True))

    op.add_column("payment_logs", sa.Column("payment_mode", sa.String(length=50), nullable=True))


def downgrade() -> None:
    op.drop_column("payment_logs", "payment_mode")
    op.drop_column("shareholder_payments", "payment_mode")
    op.drop_column("project_shareholders", "due_amount")
