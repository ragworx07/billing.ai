"""add jv shareholder development fields

Revision ID: 20260716_24
Revises: 20260624_23
Create Date: 2026-07-16 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260716_24"
down_revision = "20260624_23"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for column_name in (
        "existing_area",
        "existing_uds",
        "free_cost_area",
        "new_area",
        "new_uds",
        "additional_sqft",
        "rate_per_sqft",
    ):
        op.add_column(
            "project_shareholders",
            sa.Column(column_name, sa.Numeric(12, 2), nullable=False, server_default="0"),
        )
        op.alter_column("project_shareholders", column_name, server_default=None)


def downgrade() -> None:
    for column_name in (
        "rate_per_sqft",
        "additional_sqft",
        "new_uds",
        "new_area",
        "free_cost_area",
        "existing_uds",
        "existing_area",
    ):
        op.drop_column("project_shareholders", column_name)
