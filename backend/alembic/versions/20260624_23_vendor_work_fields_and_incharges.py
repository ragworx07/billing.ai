"""add vendor work fields and labour incharge type

Revision ID: 20260624_23
Revises: 20260624_22
Create Date: 2026-06-24 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260624_23"
down_revision = "20260624_22"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "vendor_master",
        sa.Column("party_type", sa.String(length=30), nullable=False, server_default="material_vendor"),
    )
    op.add_column("vendor_master", sa.Column("work_field", sa.String(length=120), nullable=True))
    op.create_index("ix_vendor_master_party_type", "vendor_master", ["party_type"])
    op.create_index("ix_vendor_master_work_field", "vendor_master", ["work_field"])
    op.execute(
        """
        UPDATE vendor_master
        SET party_type = 'labour_incharge'
        WHERE id IN (
            SELECT DISTINCT vendor_id
            FROM labor_logs
            WHERE vendor_id IS NOT NULL
        )
        AND id NOT IN (
            SELECT DISTINCT vendor_id
            FROM material_logs
            WHERE vendor_id IS NOT NULL
            UNION
            SELECT DISTINCT vendor_id
            FROM vendor_transactions
            WHERE vendor_id IS NOT NULL
        )
        """
    )
    op.alter_column("vendor_master", "party_type", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_vendor_master_work_field", table_name="vendor_master")
    op.drop_index("ix_vendor_master_party_type", table_name="vendor_master")
    op.drop_column("vendor_master", "work_field")
    op.drop_column("vendor_master", "party_type")
