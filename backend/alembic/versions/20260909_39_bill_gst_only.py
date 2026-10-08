"""add gst_only flag to bills so GST invoices can skip construction

Revision ID: 20260909_39
Revises: 20260908_38
Create Date: 2026-09-09 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260909_39"
down_revision = "20260908_38"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "bills",
        sa.Column("gst_only", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("bills", "gst_only")
