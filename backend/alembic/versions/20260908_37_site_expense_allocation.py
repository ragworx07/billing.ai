"""add allocation and project link to site expenses

Revision ID: 20260908_37
Revises: 20260907_36
Create Date: 2026-09-08 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260908_37"
down_revision = "20260907_36"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "site_expenses",
        sa.Column("allocation", sa.String(length=20), nullable=False, server_default="other"),
    )
    op.add_column("site_expenses", sa.Column("project_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_site_expenses_project_id_projects",
        "site_expenses",
        "projects",
        ["project_id"],
        ["id"],
    )
    op.create_index("ix_site_expenses_project_id", "site_expenses", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_site_expenses_project_id", table_name="site_expenses")
    op.drop_constraint("fk_site_expenses_project_id_projects", "site_expenses", type_="foreignkey")
    op.drop_column("site_expenses", "project_id")
    op.drop_column("site_expenses", "allocation")
