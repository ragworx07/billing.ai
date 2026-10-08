"""separate existing/new government GST and registration slabs

Revision ID: 20260911_41
Revises: 20260911_40
Create Date: 2026-09-11 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260911_41"
down_revision = "20260911_40"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("govt_new_slab1_upto", sa.Numeric(14, 2), nullable=False, server_default="5000000"),
    )
    op.add_column(
        "projects",
        sa.Column("govt_new_slab2_upto", sa.Numeric(14, 2), nullable=False, server_default="30000000"),
    )
    op.add_column(
        "projects",
        sa.Column("govt_new_slab1_gst_percent", sa.Numeric(6, 2), nullable=False, server_default="6"),
    )
    op.add_column(
        "projects",
        sa.Column("govt_new_slab2_gst_percent", sa.Numeric(6, 2), nullable=False, server_default="7"),
    )
    op.add_column(
        "projects",
        sa.Column("govt_new_slab1_registration_percent", sa.Numeric(6, 2), nullable=False, server_default="6"),
    )
    op.add_column(
        "projects",
        sa.Column("govt_new_slab2_registration_percent", sa.Numeric(6, 2), nullable=False, server_default="7"),
    )
    op.add_column(
        "projects",
        sa.Column("govt_new_legal_charges", sa.Numeric(12, 2), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("projects", "govt_new_legal_charges")
    op.drop_column("projects", "govt_new_slab2_registration_percent")
    op.drop_column("projects", "govt_new_slab1_registration_percent")
    op.drop_column("projects", "govt_new_slab2_gst_percent")
    op.drop_column("projects", "govt_new_slab1_gst_percent")
    op.drop_column("projects", "govt_new_slab2_upto")
    op.drop_column("projects", "govt_new_slab1_upto")
