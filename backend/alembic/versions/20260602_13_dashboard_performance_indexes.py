"""add dashboard performance indexes

Revision ID: 20260602_13
Revises: 20260602_12
Create Date: 2026-06-02
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260602_13"
down_revision: str | Sequence[str] | None = "20260602_12"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(op.f("ix_projects_status"), "projects", ["status"], unique=False)
    op.create_index(op.f("ix_projects_created_at"), "projects", ["created_at"], unique=False)

    op.create_index(op.f("ix_payment_logs_status"), "payment_logs", ["status"], unique=False)
    op.create_index(op.f("ix_payment_logs_due_date"), "payment_logs", ["due_date"], unique=False)
    op.create_index(op.f("ix_payment_logs_received_date"), "payment_logs", ["received_date"], unique=False)
    op.create_index(
        "ix_payment_logs_overdue_lookup",
        "payment_logs",
        ["due_date", "status"],
        unique=False,
        postgresql_where=sa.text("received_date IS NULL AND due_date IS NOT NULL"),
    )

    op.create_index(op.f("ix_expense_logs_date"), "expense_logs", ["date"], unique=False)
    op.create_index(op.f("ix_material_logs_date"), "material_logs", ["date"], unique=False)
    op.create_index(op.f("ix_labor_logs_date"), "labor_logs", ["date"], unique=False)
    op.create_index(op.f("ix_shareholder_payments_payment_date"), "shareholder_payments", ["payment_date"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_shareholder_payments_payment_date"), table_name="shareholder_payments")
    op.drop_index(op.f("ix_labor_logs_date"), table_name="labor_logs")
    op.drop_index(op.f("ix_material_logs_date"), table_name="material_logs")
    op.drop_index(op.f("ix_expense_logs_date"), table_name="expense_logs")
    op.drop_index("ix_payment_logs_overdue_lookup", table_name="payment_logs")
    op.drop_index(op.f("ix_payment_logs_received_date"), table_name="payment_logs")
    op.drop_index(op.f("ix_payment_logs_due_date"), table_name="payment_logs")
    op.drop_index(op.f("ix_payment_logs_status"), table_name="payment_logs")
    op.drop_index(op.f("ix_projects_created_at"), table_name="projects")
    op.drop_index(op.f("ix_projects_status"), table_name="projects")
