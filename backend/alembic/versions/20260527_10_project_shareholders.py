"""add project shareholders and project share counts

Revision ID: 20260527_10
Revises: 20260527_09
Create Date: 2026-05-27
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260527_10"
down_revision: str | Sequence[str] | None = "20260527_09"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("existing_shareholders_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("projects", sa.Column("new_shareholders_count", sa.Integer(), nullable=False, server_default="0"))
    op.alter_column("projects", "existing_shareholders_count", server_default=None)
    op.alter_column("projects", "new_shareholders_count", server_default=None)

    op.create_table(
        "project_shareholders",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("company_name", sa.String(length=150), nullable=True),
        sa.Column("phone", sa.String(length=20), nullable=False),
        sa.Column("address", sa.String(length=255), nullable=True),
        sa.Column("is_existing_shareholder", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("share_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_project_shareholders_id"), "project_shareholders", ["id"], unique=False)
    op.create_index(op.f("ix_project_shareholders_project_id"), "project_shareholders", ["project_id"], unique=False)
    op.alter_column("project_shareholders", "is_existing_shareholder", server_default=None)
    op.alter_column("project_shareholders", "share_count", server_default=None)


def downgrade() -> None:
    op.drop_index(op.f("ix_project_shareholders_project_id"), table_name="project_shareholders")
    op.drop_index(op.f("ix_project_shareholders_id"), table_name="project_shareholders")
    op.drop_table("project_shareholders")
    op.drop_column("projects", "new_shareholders_count")
    op.drop_column("projects", "existing_shareholders_count")
