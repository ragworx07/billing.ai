"""add gst invoice signature image

Revision ID: 20260907_36
Revises: 20260901_35
Create Date: 2026-09-07 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260907_36"
down_revision = "20260901_35"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("bills", sa.Column("signature_image", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("bills", "signature_image")
