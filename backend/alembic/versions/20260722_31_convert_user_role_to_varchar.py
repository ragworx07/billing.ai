"""convert user role to varchar

Revision ID: 20260722_31
Revises: 20260721_30
Create Date: 2026-07-22 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260722_31"
down_revision = "20260721_30"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.alter_column(
            "users",
            "role",
            type_=sa.String(length=50),
            existing_nullable=True,
            postgresql_using="role::text",
        )
    else:
        op.alter_column(
            "users",
            "role",
            type_=sa.String(length=50),
            existing_nullable=True,
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.alter_column(
            "users",
            "role",
            type_=sa.Enum(
                "owner",
                "administrator",
                "client_manager",
                "project_manager",
                "project_coordinator",
                "supervisor",
                "accountant",
                name="user_role",
            ),
            existing_nullable=True,
            postgresql_using="role::user_role",
        )
