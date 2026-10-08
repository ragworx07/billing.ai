from fastapi import APIRouter

from src.api.rest.routes import (
    attendance,
    auth,
    audit,
    billing,
    chat,
    chatbot,
    clients,
    dashboard,
    expense_master,
    expenses,
    health,
    labor_logs,
    labour_incharge_limits,
    material_master,
    materials,
    milestones,
    notes,
    office,
    payments,
    projects,
    project_files,
    reports,
    site,
    workers,
    vendor_master,
    vendor_transactions,
    settings,
    backups,
)

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(audit.router, prefix="/audit", tags=["audit"])
api_router.include_router(settings.router, prefix="/settings", tags=["settings"])
api_router.include_router(billing.router, prefix="/billing", tags=["billing"])
api_router.include_router(clients.router, prefix="/clients", tags=["clients"])
api_router.include_router(projects.router, prefix="/projects", tags=["projects"])
api_router.include_router(project_files.router, prefix="/projects", tags=["project-files"])
api_router.include_router(labour_incharge_limits.router, prefix="/projects", tags=["labour-incharge-limits"])
api_router.include_router(workers.router, prefix="/workers", tags=["workers"])
api_router.include_router(attendance.router, prefix="/attendance", tags=["attendance"])
api_router.include_router(materials.router, prefix="/materials", tags=["materials"])
api_router.include_router(labor_logs.router, prefix="/labor-logs", tags=["labor-logs"])
api_router.include_router(expenses.router, prefix="/expenses", tags=["expenses"])
api_router.include_router(material_master.router, prefix="/material-master", tags=["material-master"])
api_router.include_router(expense_master.router, prefix="/expense-master", tags=["expense-master"])
api_router.include_router(payments.router, prefix="/payments", tags=["payments"])
api_router.include_router(reports.router, prefix="/reports", tags=["reports"])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])
api_router.include_router(health.router)
api_router.include_router(milestones.router, prefix="/milestones", tags=["milestones"])
api_router.include_router(notes.router, prefix="/notes", tags=["notes"])
api_router.include_router(office.router, prefix="/office", tags=["office"])
api_router.include_router(site.router, prefix="/site", tags=["site"])
api_router.include_router(chat.router)
api_router.include_router(chatbot.router)
api_router.include_router(vendor_master.router, prefix="/vendor-master", tags=["vendor-master"])
api_router.include_router(vendor_transactions.router, prefix="/vendor-transactions", tags=["vendor-transactions"])
api_router.include_router(backups.router, prefix="/backups", tags=["backups"])
