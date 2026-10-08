"""add material bundle conversion columns

Revision ID: 20260721_30
Revises: 20260720_29
Create Date: 2026-07-21 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260721_30"
down_revision = "20260720_29"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "material_master",
        sa.Column("has_bundle_conversion", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "material_master",
        sa.Column("default_bundle_weight", sa.Numeric(precision=10, scale=2), nullable=True),
    )
    op.alter_column("material_master", "has_bundle_conversion", server_default=None)


def downgrade() -> None:
    op.drop_column("material_master", "default_bundle_weight")
    op.drop_column("material_master", "has_bundle_conversion")
