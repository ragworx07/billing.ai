"""add new-client GST and registration percent columns

Revision ID: 20260911_42
Revises: 20260911_41
Create Date: 2026-09-11 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260911_42"
down_revision = "20260911_41"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("govt_new_gst_percent", sa.Numeric(6, 2), nullable=False, server_default="6"),
    )
    op.add_column(
        "projects",
        sa.Column("govt_new_registration_percent", sa.Numeric(6, 2), nullable=False, server_default="6"),
    )


def downgrade() -> None:
    op.drop_column("projects", "govt_new_registration_percent")
    op.drop_column("projects", "govt_new_gst_percent")
