"""add bill_no to material_logs

Revision ID: 20260728_32
Revises: 20260722_31
Create Date: 2026-07-28 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260728_32"
down_revision = "20260722_31"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE material_logs ADD COLUMN IF NOT EXISTS bill_no VARCHAR(100);")


def downgrade() -> None:
    op.drop_column("material_logs", "bill_no")
