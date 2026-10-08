"""drop unused worker phone column

Revision ID: 20260603_14
Revises: 20260602_13
Create Date: 2026-06-03 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260603_14"
down_revision = "20260602_13"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("workers") as batch_op:
        batch_op.drop_column("phone")


def downgrade() -> None:
    with op.batch_alter_table("workers") as batch_op:
        batch_op.add_column(sa.Column("phone", sa.String(length=20), nullable=False, server_default="N/A"))

