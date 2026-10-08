"""drop unused roof details module

Revision ID: 20260603_15
Revises: 20260603_14
Create Date: 2026-06-03 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260603_15"
down_revision = "20260603_14"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "roof_details" not in inspector.get_table_names():
        return

    existing_indexes = {index["name"] for index in inspector.get_indexes("roof_details")}
    if "ix_roof_details_project_id" in existing_indexes:
        op.drop_index("ix_roof_details_project_id", table_name="roof_details")
    if "ix_roof_details_id" in existing_indexes:
        op.drop_index("ix_roof_details_id", table_name="roof_details")
    op.drop_table("roof_details")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "roof_details" in inspector.get_table_names():
        return

    op.create_table(
        "roof_details",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("roof_type", sa.String(length=150), nullable=False),
        sa.Column("total_cft", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("cement_bags", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("sand_units", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("aggregate_units", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("cement_cost", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("sand_cost", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("aggregate_cost", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("total_cost", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("remarks", sa.String(length=255), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
    )
    op.create_index("ix_roof_details_id", "roof_details", ["id"], unique=False)
    op.create_index("ix_roof_details_project_id", "roof_details", ["project_id"], unique=False)

