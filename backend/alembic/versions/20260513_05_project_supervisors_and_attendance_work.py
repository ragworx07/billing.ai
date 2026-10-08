"""project supervisors m2m and attendance work_done

Revision ID: 20260513_05
Revises: 20260511_04
Create Date: 2026-05-13 18:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = '20260513_05'
down_revision = '20260511_04'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'project_supervisors',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('supervisor_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['supervisor_id'], ['users.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('project_id', 'supervisor_id', name='uq_project_supervisor'),
    )
    op.create_index('ix_project_supervisors_id', 'project_supervisors', ['id'])
    op.create_index('ix_project_supervisors_project_id', 'project_supervisors', ['project_id'])
    op.create_index('ix_project_supervisors_supervisor_id', 'project_supervisors', ['supervisor_id'])

    op.add_column('attendance_logs', sa.Column('work_done', sa.String(length=255), nullable=True))
    op.execute("UPDATE attendance_logs SET work_done = 'General labour' WHERE work_done IS NULL")
    op.alter_column('attendance_logs', 'work_done', nullable=False)

    op.execute(
        """
        INSERT INTO project_supervisors (project_id, supervisor_id)
        SELECT id, supervisor_id FROM projects WHERE supervisor_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_column('attendance_logs', 'work_done')
    op.drop_index('ix_project_supervisors_supervisor_id', table_name='project_supervisors')
    op.drop_index('ix_project_supervisors_project_id', table_name='project_supervisors')
    op.drop_index('ix_project_supervisors_id', table_name='project_supervisors')
    op.drop_table('project_supervisors')
