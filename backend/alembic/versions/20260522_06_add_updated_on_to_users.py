"""add updated_on column to users

Revision ID: 20260522_06
Revises: 20260513_05
Create Date: 2026-05-22 10:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260522_06"
down_revision = "20260513_05"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("updated_on", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute("UPDATE users SET updated_on = NOW() WHERE updated_on IS NULL")
    op.alter_column("users", "updated_on", nullable=False)


def downgrade() -> None:
    op.drop_column("users", "updated_on")
