"""add roof details module for kkr workflow

Revision ID: 20260527_08
Revises: 20260527_07
Create Date: 2026-05-27
"""

from alembic import op
import sqlalchemy as sa


revision = "20260527_08"
down_revision = "20260527_07"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "roof_details",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("roof_type", sa.String(length=150), nullable=False),
        sa.Column("total_cft", sa.Numeric(precision=12, scale=2), nullable=False, server_default="0"),
        sa.Column("cement_bags", sa.Numeric(precision=10, scale=2), nullable=False, server_default="0"),
        sa.Column("sand_units", sa.Numeric(precision=10, scale=2), nullable=False, server_default="0"),
        sa.Column("aggregate_units", sa.Numeric(precision=10, scale=2), nullable=False, server_default="0"),
        sa.Column("cement_cost", sa.Numeric(precision=12, scale=2), nullable=False, server_default="0"),
        sa.Column("sand_cost", sa.Numeric(precision=12, scale=2), nullable=False, server_default="0"),
        sa.Column("aggregate_cost", sa.Numeric(precision=12, scale=2), nullable=False, server_default="0"),
        sa.Column("total_cost", sa.Numeric(precision=12, scale=2), nullable=False, server_default="0"),
        sa.Column("remarks", sa.String(length=255), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_roof_details_id"), "roof_details", ["id"], unique=False)
    op.create_index(op.f("ix_roof_details_project_id"), "roof_details", ["project_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_roof_details_project_id"), table_name="roof_details")
    op.drop_index(op.f("ix_roof_details_id"), table_name="roof_details")
    op.drop_table("roof_details")
