"""add labor logs for kkr role-based labour tracking

Revision ID: 20260527_09
Revises: 20260527_08
Create Date: 2026-05-27
"""

from alembic import op
import sqlalchemy as sa


revision = "20260527_09"
down_revision = "20260527_08"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "labor_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("labour_type", sa.String(length=120), nullable=False),
        sa.Column("labour_count", sa.Numeric(precision=10, scale=2), nullable=False, server_default="0"),
        sa.Column("wage_per_head", sa.Numeric(precision=10, scale=2), nullable=False, server_default="0"),
        sa.Column("overtime_cost", sa.Numeric(precision=10, scale=2), nullable=False, server_default="0"),
        sa.Column("total_wage", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("remarks", sa.String(length=255), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_labor_logs_id"), "labor_logs", ["id"], unique=False)
    op.create_index(op.f("ix_labor_logs_project_id"), "labor_logs", ["project_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_labor_logs_project_id"), table_name="labor_logs")
    op.drop_index(op.f("ix_labor_logs_id"), table_name="labor_logs")
    op.drop_table("labor_logs")
