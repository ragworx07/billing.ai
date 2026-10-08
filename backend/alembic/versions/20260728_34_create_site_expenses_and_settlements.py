"""create site_expenses and site_settlements tables

Revision ID: 20260728_34
Revises: 20260728_33
Create Date: 2026-07-28 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260728_34"
down_revision = "20260728_33"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS site_expenses (
            id SERIAL PRIMARY KEY,
            item_name VARCHAR(120),
            category VARCHAR(80) NOT NULL,
            amount NUMERIC(12, 2) NOT NULL,
            rate NUMERIC(12, 2),
            quantity NUMERIC(12, 3),
            description TEXT,
            bill_url VARCHAR(500),
            date DATE NOT NULL,
            week_start DATE NOT NULL,
            closed_at TIMESTAMP WITH TIME ZONE,
            created_by_id INTEGER REFERENCES users(id),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS site_settlements (
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
    op.drop_table("site_settlements")
    op.drop_table("site_expenses")
