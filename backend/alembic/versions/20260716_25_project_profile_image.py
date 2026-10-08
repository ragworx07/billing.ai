"""add project profile image

Revision ID: 20260716_25
Revises: 20260716_24
Create Date: 2026-07-16 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260716_25"
down_revision = "20260716_24"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("profile_image_url", sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column("projects", "profile_image_url")
