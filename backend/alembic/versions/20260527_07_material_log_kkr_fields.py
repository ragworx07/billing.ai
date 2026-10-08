"""add kkr-specific material log fields

Revision ID: 20260527_07
Revises: 20260522_06
Create Date: 2026-05-27
"""

from alembic import op
import sqlalchemy as sa


revision = "20260527_07"
down_revision = "20260522_06"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("material_logs", sa.Column("work_remarks", sa.String(length=255), nullable=True))
    op.add_column("material_logs", sa.Column("total_cft", sa.Numeric(precision=12, scale=2), nullable=True))
    op.add_column("material_logs", sa.Column("rate_per_cft", sa.Numeric(precision=12, scale=2), nullable=True))
    op.add_column("material_logs", sa.Column("no_of_loads", sa.Numeric(precision=10, scale=2), nullable=True))
    op.add_column("material_logs", sa.Column("gst_percent", sa.Numeric(precision=5, scale=2), nullable=True))
    op.add_column("material_logs", sa.Column("template_meta", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("material_logs", "template_meta")
    op.drop_column("material_logs", "gst_percent")
    op.drop_column("material_logs", "no_of_loads")
    op.drop_column("material_logs", "rate_per_cft")
    op.drop_column("material_logs", "total_cft")
    op.drop_column("material_logs", "work_remarks")
