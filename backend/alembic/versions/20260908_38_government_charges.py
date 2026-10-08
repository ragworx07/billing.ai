"""add government charges, legal charges, and payment purpose

Revision ID: 20260908_38
Revises: 20260908_37
Create Date: 2026-09-08 18:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260908_38"
down_revision = "20260908_37"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("govt_composite_value_per_sqft", sa.Numeric(12, 2), nullable=False, server_default="0"),
    )
    op.add_column(
        "projects",
        sa.Column("govt_land_factor", sa.Numeric(8, 4), nullable=False, server_default="1"),
    )
    op.add_column(
        "projects",
        sa.Column("govt_gst_percent", sa.Numeric(6, 2), nullable=False, server_default="5"),
    )
    op.add_column(
        "projects",
        sa.Column("govt_registration_value_percent", sa.Numeric(6, 2), nullable=False, server_default="4"),
    )
    op.add_column(
        "projects",
        sa.Column("govt_construction_cost_per_sqft", sa.Numeric(12, 2), nullable=False, server_default="0"),
    )
    op.add_column(
        "project_shareholders",
        sa.Column("legal_charges", sa.Numeric(12, 2), nullable=False, server_default="0"),
    )
    op.add_column(
        "shareholder_payments",
        sa.Column("purpose", sa.String(length=30), nullable=False, server_default="construction"),
    )


def downgrade() -> None:
    op.drop_column("shareholder_payments", "purpose")
    op.drop_column("project_shareholders", "legal_charges")
    op.drop_column("projects", "govt_construction_cost_per_sqft")
    op.drop_column("projects", "govt_registration_value_percent")
    op.drop_column("projects", "govt_gst_percent")
    op.drop_column("projects", "govt_land_factor")
    op.drop_column("projects", "govt_composite_value_per_sqft")
