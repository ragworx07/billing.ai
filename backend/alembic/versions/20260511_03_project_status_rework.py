"""project status values and defaults

Revision ID: 20260511_03
Revises: 20260511_02
Create Date: 2026-05-11 16:30:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260511_03'
down_revision = '20260511_02'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == 'postgresql':
        op.execute(
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM pg_enum e
                    JOIN pg_type t ON t.oid = e.enumtypid
                    WHERE t.typname = 'project_status' AND e.enumlabel = 'on_hold'
                ) THEN
                    UPDATE projects SET status = 'planning' WHERE status::text = 'on_hold';
                END IF;

                IF EXISTS (
                    SELECT 1
                    FROM pg_enum e
                    JOIN pg_type t ON t.oid = e.enumtypid
                    WHERE t.typname = 'project_status' AND e.enumlabel = 'planning'
                ) THEN
                    ALTER TYPE project_status RENAME VALUE 'planning' TO 'upcoming';
                END IF;

                IF EXISTS (
                    SELECT 1
                    FROM pg_enum e
                    JOIN pg_type t ON t.oid = e.enumtypid
                    WHERE t.typname = 'project_status' AND e.enumlabel = 'active'
                ) THEN
                    ALTER TYPE project_status RENAME VALUE 'active' TO 'ongoing';
                END IF;
            END $$;
            """
        )

    op.alter_column('projects', 'estimated_cost', server_default='0')
    op.execute("UPDATE projects SET estimated_cost = 0 WHERE estimated_cost IS NULL")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == 'postgresql':
        op.execute(
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM pg_enum e
                    JOIN pg_type t ON t.oid = e.enumtypid
                    WHERE t.typname = 'project_status' AND e.enumlabel = 'upcoming'
                ) THEN
                    ALTER TYPE project_status RENAME VALUE 'upcoming' TO 'planning';
                END IF;

                IF EXISTS (
                    SELECT 1
                    FROM pg_enum e
                    JOIN pg_type t ON t.oid = e.enumtypid
                    WHERE t.typname = 'project_status' AND e.enumlabel = 'ongoing'
                ) THEN
                    ALTER TYPE project_status RENAME VALUE 'ongoing' TO 'active';
                END IF;
            END $$;
            """
        )

    op.alter_column('projects', 'estimated_cost', server_default=None)
