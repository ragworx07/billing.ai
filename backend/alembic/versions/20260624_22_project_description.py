"""add project description

Revision ID: 20260624_22
Revises: 20260623_21
Create Date: 2026-06-24 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260624_22"
down_revision = "20260623_21"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("description", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("projects", "description")
