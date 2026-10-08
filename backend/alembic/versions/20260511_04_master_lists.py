"""add material and expense master lists

Revision ID: 20260511_04
Revises: 20260511_03
Create Date: 2026-05-11 18:05:00
"""

from alembic import op
import sqlalchemy as sa

revision = '20260511_04'
down_revision = '20260511_03'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'material_master',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('unit', sa.String(length=30), nullable=False),
        sa.Column('default_unit_cost', sa.Numeric(10, 2), nullable=False),
        sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.UniqueConstraint('name'),
    )
    op.create_index('ix_material_master_id', 'material_master', ['id'])

    op.create_table(
        'expense_master',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.UniqueConstraint('name'),
    )
    op.create_index('ix_expense_master_id', 'expense_master', ['id'])


def downgrade() -> None:
    op.drop_index('ix_expense_master_id', table_name='expense_master')
    op.drop_table('expense_master')
    op.drop_index('ix_material_master_id', table_name='material_master')
    op.drop_table('material_master')
