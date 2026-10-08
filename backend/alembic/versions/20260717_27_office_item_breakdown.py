"""add item breakdown fields to office expenses

Revision ID: 20260717_27
Revises: 20260716_26
Create Date: 2026-07-17 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260717_27"
down_revision = "20260716_26"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("office_expenses", sa.Column("item_name", sa.String(length=120), nullable=True))
    op.add_column("office_expenses", sa.Column("rate", sa.Numeric(12, 2), nullable=True))
    op.add_column("office_expenses", sa.Column("quantity", sa.Numeric(12, 3), nullable=True))


def downgrade() -> None:
    op.drop_column("office_expenses", "quantity")
    op.drop_column("office_expenses", "rate")
    op.drop_column("office_expenses", "item_name")
