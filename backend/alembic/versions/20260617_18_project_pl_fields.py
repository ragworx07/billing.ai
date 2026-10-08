"""add project p and l construction fields

Revision ID: 20260617_18
Revises: 20260617_17
Create Date: 2026-06-17 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260617_18"
down_revision = "20260617_17"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("construction_sqft", sa.Numeric(12, 2), nullable=False, server_default="0"))
    op.add_column("projects", sa.Column("construction_rate_per_sqft", sa.Numeric(12, 2), nullable=False, server_default="4500"))


def downgrade() -> None:
    op.drop_column("projects", "construction_rate_per_sqft")
    op.drop_column("projects", "construction_sqft")
