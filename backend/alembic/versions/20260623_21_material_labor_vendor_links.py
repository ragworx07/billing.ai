"""add vendor links to material and labor logs

Revision ID: 20260623_21
Revises: 20260622_20
Create Date: 2026-06-23 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260623_21"
down_revision = "20260622_20"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("material_logs", sa.Column("vendor_id", sa.Integer(), nullable=True))
    op.add_column("labor_logs", sa.Column("vendor_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_material_logs_vendor_id_vendor_master", "material_logs", "vendor_master", ["vendor_id"], ["id"], ondelete="SET NULL")
    op.create_foreign_key("fk_labor_logs_vendor_id_vendor_master", "labor_logs", "vendor_master", ["vendor_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_material_logs_vendor_id", "material_logs", ["vendor_id"])
    op.create_index("ix_labor_logs_vendor_id", "labor_logs", ["vendor_id"])


def downgrade() -> None:
    op.drop_index("ix_labor_logs_vendor_id", table_name="labor_logs")
    op.drop_index("ix_material_logs_vendor_id", table_name="material_logs")
    op.drop_constraint("fk_labor_logs_vendor_id_vendor_master", "labor_logs", type_="foreignkey")
    op.drop_constraint("fk_material_logs_vendor_id_vendor_master", "material_logs", type_="foreignkey")
    op.drop_column("labor_logs", "vendor_id")
    op.drop_column("material_logs", "vendor_id")
