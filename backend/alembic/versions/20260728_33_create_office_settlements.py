"""create office_settlements table

Revision ID: 20260728_33
Revises: 20260728_32
Create Date: 2026-07-28 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260728_33"
down_revision = "20260728_32"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS office_settlements (
            id SERIAL PRIMARY KEY,
            amount NUMERIC(12, 2) NOT NULL,
            date DATE NOT NULL,
            payment_mode VARCHAR(50),
            notes TEXT,
            created_by_id INTEGER REFERENCES users(id),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
        """
    )


def downgrade() -> None:
    op.drop_table("office_settlements")
