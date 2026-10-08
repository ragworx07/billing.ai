"""new-client GST default 5% and registration slabs 6/7/9

Revision ID: 20260911_43
Revises: 20260911_42
Create Date: 2026-09-11 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260911_43"
down_revision = "20260911_42"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "projects",
        "govt_new_gst_percent",
        server_default="5",
        existing_type=sa.Numeric(6, 2),
        existing_nullable=False,
    )
    op.add_column(
        "projects",
        sa.Column("govt_new_reg_upto_50l_percent", sa.Numeric(6, 2), nullable=False, server_default="6"),
    )
    op.add_column(
        "projects",
        sa.Column("govt_new_reg_upto_3cr_percent", sa.Numeric(6, 2), nullable=False, server_default="7"),
    )
    op.add_column(
        "projects",
        sa.Column("govt_new_reg_above_3cr_percent", sa.Numeric(6, 2), nullable=False, server_default="9"),
    )


def downgrade() -> None:
    op.drop_column("projects", "govt_new_reg_above_3cr_percent")
    op.drop_column("projects", "govt_new_reg_upto_3cr_percent")
    op.drop_column("projects", "govt_new_reg_upto_50l_percent")
    op.alter_column(
        "projects",
        "govt_new_gst_percent",
        server_default="6",
        existing_type=sa.Numeric(6, 2),
        existing_nullable=False,
    )
