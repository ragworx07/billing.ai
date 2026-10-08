"""add notes board table

Revision ID: 20260604_16
Revises: 20260603_15
Create Date: 2026-06-04 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260604_16"
down_revision = "20260603_15"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notes",
        sa.Column("id", sa.String(length=80), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("x", sa.Integer(), nullable=False),
        sa.Column("y", sa.Integer(), nullable=False),
        sa.Column("topic", sa.String(length=200), nullable=False),
        sa.Column("important_info", sa.String(length=255), nullable=False),
        sa.Column("reminder_when", sa.DateTime(timezone=True), nullable=True),
        sa.Column("details", sa.Text(), nullable=False),
        sa.Column("reminder_label", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("color", sa.String(length=32), nullable=False, server_default="amber"),
        sa.Column("priority", sa.String(length=16), nullable=False, server_default="medium"),
        sa.Column("attachments", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_notes_user_id", "notes", ["user_id"])
    op.create_index("ix_notes_sort_order", "notes", ["sort_order"])
    op.create_index("ix_notes_archived_at", "notes", ["archived_at"])


def downgrade() -> None:
    op.drop_index("ix_notes_archived_at", table_name="notes")
    op.drop_index("ix_notes_sort_order", table_name="notes")
    op.drop_index("ix_notes_user_id", table_name="notes")
    op.drop_table("notes")
