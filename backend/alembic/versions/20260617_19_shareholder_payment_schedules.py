"""add shareholder payment schedules

Revision ID: 20260617_19
Revises: 20260617_18
Create Date: 2026-06-17 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260617_19"
down_revision = "20260617_18"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "shareholder_payment_schedules",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("shareholder_id", sa.Integer(), nullable=False),
        sa.Column("installment_no", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("percentage", sa.Numeric(7, 2), nullable=False, server_default="0"),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("remarks", sa.String(length=255), nullable=True),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["shareholder_id"], ["project_shareholders.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_shareholder_payment_schedules_id"), "shareholder_payment_schedules", ["id"], unique=False)
    op.create_index(
        op.f("ix_shareholder_payment_schedules_project_id"),
        "shareholder_payment_schedules",
        ["project_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_shareholder_payment_schedules_shareholder_id"),
        "shareholder_payment_schedules",
        ["shareholder_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_shareholder_payment_schedules_due_date"),
        "shareholder_payment_schedules",
        ["due_date"],
        unique=False,
    )
    op.create_index(
        "ix_shareholder_payment_schedules_overdue_lookup",
        "shareholder_payment_schedules",
        ["due_date", "shareholder_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_shareholder_payment_schedules_overdue_lookup", table_name="shareholder_payment_schedules")
    op.drop_index(op.f("ix_shareholder_payment_schedules_due_date"), table_name="shareholder_payment_schedules")
    op.drop_index(op.f("ix_shareholder_payment_schedules_shareholder_id"), table_name="shareholder_payment_schedules")
    op.drop_index(op.f("ix_shareholder_payment_schedules_project_id"), table_name="shareholder_payment_schedules")
    op.drop_index(op.f("ix_shareholder_payment_schedules_id"), table_name="shareholder_payment_schedules")
    op.drop_table("shareholder_payment_schedules")
