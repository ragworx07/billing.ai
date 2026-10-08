"""add project file storage metadata

Revision ID: 20260617_17
Revises: 6f2514424ce7
Create Date: 2026-06-17 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260617_17"
down_revision = "6f2514424ce7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_file_folders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("parent_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["parent_id"], ["project_file_folders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_project_file_folders_project_id", "project_file_folders", ["project_id"])
    op.create_index("ix_project_file_folders_parent_id", "project_file_folders", ["parent_id"])
    op.create_unique_constraint(
        "uq_project_file_folders_project_parent_name",
        "project_file_folders",
        ["project_id", "parent_id", "name"],
    )

    op.create_table(
        "project_files",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("folder_id", sa.Integer(), nullable=True),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("stored_filename", sa.String(length=255), nullable=False),
        sa.Column("storage_bucket", sa.String(length=120), nullable=False),
        sa.Column("storage_path", sa.String(length=600), nullable=False),
        sa.Column("content_type", sa.String(length=160), nullable=False, server_default="application/octet-stream"),
        sa.Column("original_size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("compressed_size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("uploaded_by_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["folder_id"], ["project_file_folders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_project_files_project_id", "project_files", ["project_id"])
    op.create_index("ix_project_files_folder_id", "project_files", ["folder_id"])
    op.create_unique_constraint("uq_project_files_storage_path", "project_files", ["storage_path"])


def downgrade() -> None:
    op.drop_constraint("uq_project_files_storage_path", "project_files", type_="unique")
    op.drop_index("ix_project_files_folder_id", table_name="project_files")
    op.drop_index("ix_project_files_project_id", table_name="project_files")
    op.drop_table("project_files")
    op.drop_constraint("uq_project_file_folders_project_parent_name", "project_file_folders", type_="unique")
    op.drop_index("ix_project_file_folders_parent_id", table_name="project_file_folders")
    op.drop_index("ix_project_file_folders_project_id", table_name="project_file_folders")
    op.drop_table("project_file_folders")
