"""add project milestones

Revision ID: 20260622_20
Revises: 20260617_19
Create Date: 2026-06-22 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260622_20"
down_revision = "20260617_19"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_milestones",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("milestone_date", sa.Date(), nullable=False),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="pending"),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_project_milestones_project_id", "project_milestones", ["project_id"])
    op.create_index("ix_project_milestones_milestone_date", "project_milestones", ["milestone_date"])
    op.create_index("ix_project_milestones_status", "project_milestones", ["status"])


def downgrade() -> None:
    op.drop_index("ix_project_milestones_status", table_name="project_milestones")
    op.drop_index("ix_project_milestones_milestone_date", table_name="project_milestones")
    op.drop_index("ix_project_milestones_project_id", table_name="project_milestones")
    op.drop_table("project_milestones")
