"""initial schema

Revision ID: 20260511_01
Revises:
Create Date: 2026-05-11 00:00:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ENUM


revision = "20260511_01"
down_revision = None
branch_labels = None
depends_on = None


user_role = ENUM("owner", "supervisor", "accountant", name="user_role", create_type=False)
project_status = ENUM("upcoming", "ongoing", "completed", name="project_status", create_type=False)
attendance_status = ENUM("present", "absent", "half_day", name="attendance_status", create_type=False)
payment_type = ENUM("advance", "running", "final", name="payment_type", create_type=False)
payment_status = ENUM("pending", "received", "overdue", name="payment_status", create_type=False)


def upgrade() -> None:
    bind = op.get_bind()
    user_role.create(bind, checkfirst=True)
    project_status.create(bind, checkfirst=True)
    attendance_status.create(bind, checkfirst=True)
    payment_type.create(bind, checkfirst=True)
    payment_status.create(bind, checkfirst=True)

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", user_role, nullable=True),
        sa.Column("phone", sa.String(length=20), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("email"),
    )
    op.create_index("ix_users_id", "users", ["id"])
    op.create_index("ix_users_email", "users", ["email"])

    op.create_table(
        "clients",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("company_name", sa.String(length=150), nullable=False),
        sa.Column("phone", sa.String(length=20), nullable=False),
        sa.Column("alternate_phone", sa.String(length=20), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("address_line1", sa.String(length=255), nullable=False),
        sa.Column("address_line2", sa.String(length=255), nullable=True),
        sa.Column("city", sa.String(length=120), nullable=False),
        sa.Column("state", sa.String(length=120), nullable=False),
        sa.Column("pincode", sa.String(length=12), nullable=False),
        sa.Column("gst_number", sa.String(length=30), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_clients_id", "clients", ["id"])

    op.create_table(
        "workers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("phone", sa.String(length=20), nullable=False),
        sa.Column("role", sa.String(length=80), nullable=False),
        sa.Column("daily_wage", sa.Numeric(10, 2), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.create_index("ix_workers_id", "workers", ["id"])

    op.create_table(
        "projects",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("client_id", sa.Integer(), nullable=False),
        sa.Column("project_name", sa.String(length=150), nullable=False),
        sa.Column("location", sa.String(length=255), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("expected_end_date", sa.Date(), nullable=True),
        sa.Column("quoted_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("estimated_cost", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("status", project_status, nullable=False, server_default="ongoing"),
        sa.Column("supervisor_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"]),
        sa.ForeignKeyConstraint(["supervisor_id"], ["users.id"]),
    )
    op.create_index("ix_projects_id", "projects", ["id"])
    op.create_index("ix_projects_client_id", "projects", ["client_id"])
    op.create_index("ix_projects_supervisor_id", "projects", ["supervisor_id"])

    op.create_table(
        "attendance_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("worker_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("status", attendance_status, nullable=False),
        sa.Column("overtime_hours", sa.Numeric(5, 2), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.ForeignKeyConstraint(["worker_id"], ["workers.id"]),
        sa.UniqueConstraint("worker_id", "project_id", "date", name="uq_attendance_worker_project_date"),
    )
    op.create_index("ix_attendance_logs_id", "attendance_logs", ["id"])
    op.create_index("ix_attendance_logs_worker_id", "attendance_logs", ["worker_id"])
    op.create_index("ix_attendance_logs_project_id", "attendance_logs", ["project_id"])

    op.create_table(
        "material_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("material_name", sa.String(length=120), nullable=False),
        sa.Column("quantity", sa.Numeric(10, 2), nullable=False),
        sa.Column("unit", sa.String(length=30), nullable=False),
        sa.Column("unit_cost", sa.Numeric(10, 2), nullable=False),
        sa.Column("supplier", sa.String(length=120), nullable=True),
        sa.Column("transport_cost", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("bill_url", sa.String(length=500), nullable=True),
        sa.Column("date", sa.Date(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
    )
    op.create_index("ix_material_logs_id", "material_logs", ["id"])
    op.create_index("ix_material_logs_project_id", "material_logs", ["project_id"])

    op.create_table(
        "expense_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("category", sa.String(length=80), nullable=False),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("bill_url", sa.String(length=500), nullable=True),
        sa.Column("date", sa.Date(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
    )
    op.create_index("ix_expense_logs_id", "expense_logs", ["id"])
    op.create_index("ix_expense_logs_project_id", "expense_logs", ["project_id"])

    op.create_table(
        "payment_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("payment_type", payment_type, nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("received_date", sa.Date(), nullable=True),
        sa.Column("status", payment_status, nullable=False, server_default="pending"),
        sa.Column("notes", sa.String(length=500), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
    )
    op.create_index("ix_payment_logs_id", "payment_logs", ["id"])
    op.create_index("ix_payment_logs_project_id", "payment_logs", ["project_id"])

    op.create_table(
        "work_reports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("report_date", sa.Date(), nullable=False),
        sa.Column("work_done", sa.Text(), nullable=False),
        sa.Column("issues", sa.Text(), nullable=True),
        sa.Column("next_plan", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
    )
    op.create_index("ix_work_reports_id", "work_reports", ["id"])
    op.create_index("ix_work_reports_project_id", "work_reports", ["project_id"])

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(length=50), nullable=False),
        sa.Column("table_name", sa.String(length=100), nullable=False),
        sa.Column("record_id", sa.Integer(), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
    )
    op.create_index("ix_audit_logs_id", "audit_logs", ["id"])
    op.create_index("ix_audit_logs_user_id", "audit_logs", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_audit_logs_user_id", table_name="audit_logs")
    op.drop_index("ix_audit_logs_id", table_name="audit_logs")
    op.drop_table("audit_logs")
    op.drop_index("ix_work_reports_project_id", table_name="work_reports")
    op.drop_index("ix_work_reports_id", table_name="work_reports")
    op.drop_table("work_reports")
    op.drop_index("ix_payment_logs_project_id", table_name="payment_logs")
    op.drop_index("ix_payment_logs_id", table_name="payment_logs")
    op.drop_table("payment_logs")
    op.drop_index("ix_expense_logs_project_id", table_name="expense_logs")
    op.drop_index("ix_expense_logs_id", table_name="expense_logs")
    op.drop_table("expense_logs")
    op.drop_index("ix_material_logs_project_id", table_name="material_logs")
    op.drop_index("ix_material_logs_id", table_name="material_logs")
    op.drop_table("material_logs")
    op.drop_index("ix_attendance_logs_project_id", table_name="attendance_logs")
    op.drop_index("ix_attendance_logs_worker_id", table_name="attendance_logs")
    op.drop_index("ix_attendance_logs_id", table_name="attendance_logs")
    op.drop_table("attendance_logs")
    op.drop_index("ix_projects_supervisor_id", table_name="projects")
    op.drop_index("ix_projects_client_id", table_name="projects")
    op.drop_index("ix_projects_id", table_name="projects")
    op.drop_table("projects")
    op.drop_index("ix_workers_id", table_name="workers")
    op.drop_table("workers")
    op.drop_index("ix_clients_id", table_name="clients")
    op.drop_table("clients")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_index("ix_users_id", table_name="users")
    op.drop_table("users")

    bind = op.get_bind()
    payment_status.drop(bind, checkfirst=True)
    payment_type.drop(bind, checkfirst=True)
    attendance_status.drop(bind, checkfirst=True)
    project_status.drop(bind, checkfirst=True)
    user_role.drop(bind, checkfirst=True)
