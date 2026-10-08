"""add per-project labour incharge payment limits

Revision ID: 20260911_40
Revises: 20260909_39
Create Date: 2026-09-11 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260911_40"
down_revision = "20260909_39"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "labour_incharge_limits",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("vendor_id", sa.Integer(), sa.ForeignKey("vendor_master.id", ondelete="CASCADE"), nullable=False),
        sa.Column("limit_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("project_id", "vendor_id", name="uq_labour_incharge_limits_project_vendor"),
    )
    op.create_index("ix_labour_incharge_limits_project_id", "labour_incharge_limits", ["project_id"])
    op.create_index("ix_labour_incharge_limits_vendor_id", "labour_incharge_limits", ["vendor_id"])


def downgrade() -> None:
    op.drop_index("ix_labour_incharge_limits_vendor_id", table_name="labour_incharge_limits")
    op.drop_index("ix_labour_incharge_limits_project_id", table_name="labour_incharge_limits")
    op.drop_table("labour_incharge_limits")
