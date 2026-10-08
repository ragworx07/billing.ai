"""allow pending users and accountant role

Revision ID: 20260511_02
Revises: 20260511_01
Create Date: 2026-05-11 15:25:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260511_02'
down_revision = '20260511_01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == 'postgresql':
        op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'accountant'")
        op.alter_column(
            'users',
            'role',
            existing_type=sa.Enum('owner', 'supervisor', 'accountant', name='user_role'),
            nullable=True,
        )
    else:
        with op.batch_alter_table('users') as batch_op:
            batch_op.alter_column('role', existing_type=sa.String(length=10), nullable=True)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == 'postgresql':
        op.alter_column(
            'users',
            'role',
            existing_type=sa.Enum('owner', 'supervisor', 'accountant', name='user_role'),
            nullable=False,
        )
    else:
        with op.batch_alter_table('users') as batch_op:
            batch_op.alter_column('role', existing_type=sa.String(length=10), nullable=False)
