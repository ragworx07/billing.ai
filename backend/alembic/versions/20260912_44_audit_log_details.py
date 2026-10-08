"""store readable summaries on user history audit logs

Revision ID: 20260912_44
Revises: 20260911_43
Create Date: 2026-09-12 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260912_44"
down_revision = "20260911_43"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("audit_logs", sa.Column("details", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("audit_logs", "details")
