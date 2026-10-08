import { http } from './http';
import type {
  Bill,
  BillInput,
  BillRecordPaymentInput,
  AIChatHealthResponse,
  AIChatClarification,
  AIChatResponse,
  AISamplePromptsResponse,
  ChatMessage,
  Client,
  DashboardResponse,
  DashboardCalendarResponse,
  ExpenseLog,
  OfficeExpense,
  OfficeExpenseInput,
  OfficeSettlement,
  OfficeSettlementInput,
  SiteExpense,
  SiteExpenseAllocation,
  SiteExpenseInput,
  ExpenseMaster,
  LaborLog,
  MaterialLog,
  MaterialMaster,
  NoteAttachment,
  ProjectMilestone,
  Payment,
  Project,
  ProjectFile,
  ProjectFileBoard,
  ProjectFileFolder,
  ProjectShareholder,
  ProjectStatement,
  JVShareholderPaymentEntry,
  JVShareholderPayment,
  JVPaymentSchedule,
  JVPaymentScheduleInput,
  StoredNotes,
  Worker,
  JVProjectLedger,
  JVGovernmentCharges,
  JVProjectSummaryItem,
  AuditHistoryItem,
  VendorMaster,
  VendorPaymentHistoryItem,
  VendorRecordBookItem,
  VendorTransaction,
  LabourInchargeLimit,
} from '../types/api';

export const api = {
  getAuditActors: async (records: Array<{ table_name: string; record_id: number | string }>) => {
    if (!Array.isArray(records) || records.length === 0) return {};
    const sanitized = records
      .filter((r) => r && r.table_name && r.record_id != null)
      .map((r) => ({
        table_name: String(r.table_name).trim(),
        record_id: Number(r.record_id),
      }))
      .filter((r) => r.table_name.length > 0 && Number.isInteger(r.record_id) && r.record_id > 0);

    if (sanitized.length === 0) return {};

    const dedupedMap = new Map<string, { table_name: string; record_id: number }>();
    for (const r of sanitized) {
      dedupedMap.set(`${r.table_name}:${r.record_id}`, r);
    }
    const payload = Array.from(dedupedMap.values()).slice(0, 2000);

    return (await http.post<Record<string, import('../types/api').AuditActor>>('/audit/actors', { records: payload })).data;
  },
  getAuditHistory: async (params?: {
    user_id?: number | null;
    action?: string | null;
    table_name?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    search?: string | null;
  }) =>
    (await http.get<AuditHistoryItem[]>('/audit/history', { params })).data,
  recordAuditEvent: async (payload: { action: string; table_name: string; record_id?: number; details?: string | null }) =>
    (await http.post('/audit/event', payload)).data,
  getDashboard: async () => (await http.get<DashboardResponse>('/dashboard/')).data,
  getDashboardCalendar: async (month?: string) =>
    (await http.get<DashboardCalendarResponse>('/dashboard/calendar', { params: month ? { month } : undefined })).data,
  getClients: async () => (await http.get<Client[]>('/clients/')).data,
  getJVProjects: async () => (await http.get<JVProjectSummaryItem[]>('/clients/jv-projects')).data,
  getJVShareholderPayments: async () => (await http.get<JVShareholderPaymentEntry[]>('/clients/jv-payments')).data,
  getJVProjectLedger: async (projectId: number) =>
    (await http.get<JVProjectLedger>(`/clients/jv-projects/${projectId}/ledger`)).data,
  updateJVGovernmentCharges: async (projectId: number, payload: JVGovernmentCharges) =>
    (await http.put<JVProjectLedger>(`/clients/jv-projects/${projectId}/government-charges`, payload)).data,
  createJVShareholderPayment: async (
    projectId: number,
    payload: { shareholder_id: number; payment_date: string; amount: number; payment_mode?: string | null; purpose?: string | null; notes?: string | null }
  ) => (await http.post(`/clients/jv-projects/${projectId}/payments`, payload)).data,
  updateJVShareholderPayment: async (
    projectId: number,
    paymentId: number,
    payload: { shareholder_id: number; payment_date: string; amount: number; payment_mode?: string | null; purpose?: string | null; notes?: string | null }
  ) => (await http.put(`/clients/jv-projects/${projectId}/payments/${paymentId}`, payload)).data,
  deleteJVShareholderPayment: async (projectId: number, paymentId: number) =>
    (await http.delete(`/clients/jv-projects/${projectId}/payments/${paymentId}`)).data,
  saveJVPaymentSchedule: async (projectId: number, shareholderId: number, installments: JVPaymentScheduleInput[]) =>
    (await http.put<JVPaymentSchedule[]>(
      `/clients/jv-projects/${projectId}/shareholders/${shareholderId}/payment-schedule`,
      { installments },
    )).data,
  deleteJVPaymentSchedule: async (projectId: number, shareholderId: number) =>
    (await http.delete(`/clients/jv-projects/${projectId}/shareholders/${shareholderId}/payment-schedule`)).data,
  getBills: async (params?: { project_id?: number; shareholder_id?: number; status?: string }) =>
    (await http.get<Bill[]>('/billing/bills', { params })).data,
  getNextBillNumber: async () => (await http.get<{ bill_number: string }>('/billing/bills/next-number')).data,
  createBill: async (payload: BillInput) => (await http.post<Bill>('/billing/bills', payload)).data,
  updateBill: async (billId: number, payload: BillInput) => (await http.put<Bill>(`/billing/bills/${billId}`, payload)).data,
  deleteBill: async (billId: number) => (await http.delete(`/billing/bills/${billId}`)).data,
  recordBillPayment: async (billId: number, payload: BillRecordPaymentInput) =>
    (await http.post<JVShareholderPayment>(`/billing/bills/${billId}/record-payment`, payload)).data,
  getProjects: async () => (await http.get<Project[]>('/projects/')).data,
  createProject: async (payload: Partial<Project>) => (await http.post<Project>('/projects/', payload)).data,
  updateProject: async (projectId: number, payload: Partial<Project>) =>
    (await http.put<Project>(`/projects/${projectId}`, payload)).data,
  uploadProjectImage: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return (await http.post<{ url: string }>('/projects/upload-image', formData)).data;
  },
  updateProjectStatus: async (projectId: number, status: string) =>
    (await http.patch<Project>(`/projects/${projectId}/status`, null, { params: { status_value: status } })).data,
  deleteProject: async (projectId: number, confirmationName: string) =>
    (await http.delete(`/projects/${projectId}`, { params: { confirmation_name: confirmationName } })).data,
  getProjectStatement: async (projectId: number) =>
    (await http.get<ProjectStatement>(`/projects/${projectId}/statement`)).data,
  getProjectShareholders: async (projectId: number) =>
    (await http.get<ProjectShareholder[]>(`/projects/${projectId}/shareholders`)).data,
  createProjectShareholder: async (projectId: number, payload: Partial<ProjectShareholder>) =>
    (await http.post<ProjectShareholder>(`/projects/${projectId}/shareholders`, payload)).data,
  updateProjectShareholder: async (projectId: number, shareholderId: number, payload: Partial<ProjectShareholder>) =>
    (await http.put<ProjectShareholder>(`/projects/${projectId}/shareholders/${shareholderId}`, payload)).data,
  deleteProjectShareholder: async (projectId: number, shareholderId: number) =>
    (await http.delete(`/projects/${projectId}/shareholders/${shareholderId}`)).data,
  getProjectFiles: async (projectId: number) =>
    (await http.get<ProjectFileBoard>(`/projects/${projectId}/files`)).data,
  createProjectFileFolder: async (projectId: number, payload: { name: string; parent_id?: number | null }) =>
    (await http.post<ProjectFileFolder>(`/projects/${projectId}/file-folders`, payload)).data,
  renameProjectFileFolder: async (projectId: number, folderId: number, payload: { name: string }) =>
    (await http.put<ProjectFileFolder>(`/projects/${projectId}/file-folders/${folderId}`, payload)).data,
  deleteProjectFileFolder: async (projectId: number, folderId: number) =>
    (await http.delete(`/projects/${projectId}/file-folders/${folderId}`)).data,
  uploadProjectFile: async (projectId: number, folderId: number | null, file: File) => {
    const formData = new FormData();
    if (folderId !== null) formData.append('folder_id', String(folderId));
    formData.append('file', file);
    return (await http.post<ProjectFile>(`/projects/${projectId}/files`, formData)).data;
  },
  renameProjectFile: async (projectId: number, fileId: number, payload: { name: string }) =>
    (await http.put<ProjectFile>(`/projects/${projectId}/files/${fileId}`, payload)).data,
  deleteProjectFile: async (projectId: number, fileId: number) =>
    (await http.delete(`/projects/${projectId}/files/${fileId}`)).data,
  downloadProjectFile: async (projectId: number, fileId: number) => {
    const response = await http.get<Blob>(`/projects/${projectId}/files/${fileId}/download`, { responseType: 'blob' });
    const rawType = response.headers['content-type'];
    const type = typeof rawType === 'string' ? rawType : 'application/octet-stream';
    return new Blob([response.data], { type });
  },
  viewProjectFile: async (projectId: number, fileId: number) => {
    const response = await http.get<Blob>(`/projects/${projectId}/files/${fileId}/view`, { responseType: 'blob' });
    const rawType = response.headers['content-type'];
    const type = typeof rawType === 'string' ? rawType : 'application/pdf';
    return new Blob([response.data], { type });
  },
  getWorkers: async () => (await http.get<Worker[]>('/workers/')).data,
  createWorker: async (payload: Partial<Worker>) => (await http.post<Worker>('/workers/', payload)).data,
  updateWorker: async (workerId: number, payload: Partial<Worker>) => (await http.put<Worker>(`/workers/${workerId}`, payload)).data,
  deleteWorker: async (workerId: number) => (await http.delete(`/workers/${workerId}`)).data,
  getPayments: async (projectId?: number) =>
    (await http.get<Payment[]>('/payments/', { params: projectId ? { project_id: projectId } : undefined })).data,
  getNotesBoard: async () => (await http.get<StoredNotes>('/notes/board')).data,
  saveNotesBoard: async (payload: StoredNotes) => (await http.put<StoredNotes>('/notes/board', payload)).data,
  uploadNoteAttachment: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return (await http.post<NoteAttachment>('/notes/attachments', formData)).data;
  },
  getMilestones: async () => (await http.get<ProjectMilestone[]>('/milestones/')).data,
  createMilestone: async (payload: Partial<ProjectMilestone>) =>
    (await http.post<ProjectMilestone>('/milestones/', payload)).data,
  updateMilestone: async (milestoneId: number, payload: Partial<ProjectMilestone>) =>
    (await http.put<ProjectMilestone>(`/milestones/${milestoneId}`, payload)).data,
  completeMilestone: async (milestoneId: number) =>
    (await http.patch<ProjectMilestone>(`/milestones/${milestoneId}/complete`)).data,
  deleteMilestone: async (milestoneId: number) => (await http.delete(`/milestones/${milestoneId}`)).data,
  createMaterial: async (payload: Partial<MaterialLog>) =>
    (await http.post<MaterialLog>('/materials/', payload)).data,
  updateMaterial: async (materialId: number, payload: Partial<MaterialLog>) =>
    (await http.put<MaterialLog>(`/materials/${materialId}`, payload)).data,
  deleteMaterial: async (materialId: number) => (await http.delete(`/materials/${materialId}`)).data,
  getMaterials: async (projectId?: number) =>
    (await http.get<MaterialLog[]>('/materials/', { params: projectId ? { project_id: projectId } : undefined })).data,
  createExpense: async (payload: Partial<ExpenseLog>) =>
    (await http.post<ExpenseLog>('/expenses/', payload)).data,
  updateExpense: async (expenseId: number, payload: Partial<ExpenseLog>) =>
    (await http.put<ExpenseLog>(`/expenses/${expenseId}`, payload)).data,
  deleteExpense: async (expenseId: number) => (await http.delete(`/expenses/${expenseId}`)).data,
  getExpenses: async (projectId?: number) =>
    (await http.get<ExpenseLog[]>('/expenses/', { params: projectId ? { project_id: projectId } : undefined })).data,
  getOfficeExpenses: async () => (await http.get<OfficeExpense[]>('/office')).data,
  createOfficeExpense: async (payload: OfficeExpenseInput) => (await http.post<OfficeExpense>('/office', payload)).data,
  deleteOfficeExpense: async (expenseId: number) => (await http.delete(`/office/${expenseId}`)).data,
  getOfficeSettlements: async () => (await http.get<OfficeSettlement[]>('/office/settlements')).data,
  createOfficeSettlement: async (payload: OfficeSettlementInput) =>
    (await http.post<OfficeSettlement>('/office/settlements', payload)).data,
  deleteOfficeSettlement: async (settlementId: number) => (await http.delete(`/office/settlements/${settlementId}`)).data,
  getSiteExpenses: async (params?: { allocation?: SiteExpenseAllocation; project_id?: number }) =>
    (await http.get<SiteExpense[]>('/site', { params })).data,
  createSiteExpense: async (payload: SiteExpenseInput) => (await http.post<SiteExpense>('/site', payload)).data,
  updateSiteExpense: async (expenseId: number, payload: SiteExpenseInput) =>
    (await http.put<SiteExpense>(`/site/${expenseId}`, payload)).data,
  deleteSiteExpense: async (expenseId: number) => (await http.delete(`/site/${expenseId}`)).data,
  getMaterialMaster: async () => (await http.get<MaterialMaster[]>('/material-master/')).data,
  createMaterialMaster: async (payload: Partial<MaterialMaster>) =>
    (await http.post<MaterialMaster>('/material-master/', payload)).data,
  updateMaterialMaster: async (itemId: number, payload: Partial<MaterialMaster>) =>
    (await http.put<MaterialMaster>(`/material-master/${itemId}`, payload)).data,
  deleteMaterialMaster: async (itemId: number) => (await http.delete(`/material-master/${itemId}`)).data,
  getExpenseMaster: async () => (await http.get<ExpenseMaster[]>('/expense-master/')).data,
  createExpenseMaster: async (payload: Partial<ExpenseMaster>) =>
    (await http.post<ExpenseMaster>('/expense-master/', payload)).data,
  askAI: async (
    question: string,
    history: ChatMessage[] = [],
    pendingClarification: AIChatClarification | null = null,
  ) =>
    (
      await http.post<AIChatResponse>('/chat/query', {
        question,
        history,
        pending_clarification: pendingClarification,
      })
    ).data,
  getAISamplePrompts: async () => (await http.get<AISamplePromptsResponse>('/chat/sample-prompts')).data,
  getAIHealth: async () => (await http.get<AIChatHealthResponse>('/chat/health')).data,
  getLaborLogs: async (projectId?: number) =>
    (await http.get<LaborLog[]>('/labor-logs/', { params: projectId ? { project_id: projectId } : undefined })).data,
  createLaborLog: async (payload: Partial<LaborLog>) => (await http.post<LaborLog>('/labor-logs/', payload)).data,
  updateLaborLog: async (laborLogId: number, payload: Partial<LaborLog>) =>
    (await http.put<LaborLog>(`/labor-logs/${laborLogId}`, payload)).data,
  deleteLaborLog: async (laborLogId: number) => (await http.delete(`/labor-logs/${laborLogId}`)).data,
  getVendorMaster: async (partyType?: 'material_vendor' | 'labour_incharge') =>
    (await http.get<VendorMaster[]>('/vendor-master/', { params: partyType ? { party_type: partyType } : undefined })).data,
  getVendorWorkFields: async (partyType?: 'material_vendor' | 'labour_incharge') =>
    (await http.get<string[]>('/vendor-master/work-fields', { params: partyType ? { party_type: partyType } : undefined })).data,
  getVendorPaymentHistory: async (vendorId: number) =>
    (await http.get<VendorPaymentHistoryItem[]>(`/vendor-master/${vendorId}/payment-history`)).data,
  getVendorRecordBook: async () =>
    (await http.get<VendorRecordBookItem[]>('/vendor-master/record-book')).data,
  createVendorMaster: async (payload: Partial<VendorMaster>) =>
    (await http.post<VendorMaster>('/vendor-master/', payload)).data,
  updateVendorMaster: async (vendorId: number, payload: Partial<VendorMaster>) =>
    (await http.put<VendorMaster>(`/vendor-master/${vendorId}`, payload)).data,
  deleteVendorMaster: async (vendorId: number) => (await http.delete(`/vendor-master/${vendorId}`)).data,
  getVendorTransactions: async (projectId: number) =>
    (await http.get<VendorTransaction[]>(`/vendor-transactions/project/${projectId}`)).data,
  createVendorTransaction: async (payload: Partial<VendorTransaction>) =>
    (await http.post<VendorTransaction>('/vendor-transactions/', payload)).data,
  updateVendorTransaction: async (transactionId: number, payload: Partial<VendorTransaction>) =>
    (await http.put<VendorTransaction>(`/vendor-transactions/${transactionId}`, payload)).data,
  deleteVendorTransaction: async (transactionId: number) => (await http.delete(`/vendor-transactions/${transactionId}`)).data,
  getLabourInchargeLimits: async (projectId: number) =>
    (await http.get<LabourInchargeLimit[]>(`/projects/${projectId}/labour-incharge-limits`)).data,
  upsertLabourInchargeLimit: async (projectId: number, vendorId: number, limitAmount: number) =>
    (await http.put<LabourInchargeLimit>(`/projects/${projectId}/labour-incharge-limits/${vendorId}`, { limit_amount: limitAmount })).data,
  deleteLabourInchargeLimit: async (projectId: number, vendorId: number) =>
    (await http.delete(`/projects/${projectId}/labour-incharge-limits/${vendorId}`)).data,
  getPermissionsSettings: async () =>
    (await http.get<{ role_permissions: Record<string, string[]>; custom_user_roles: any[] }>('/settings/permissions')).data,
  updatePermissionsSettings: async (payload: { role_permissions?: Record<string, string[]>; custom_user_roles?: any[] }) =>
    (await http.put<{ role_permissions: Record<string, string[]>; custom_user_roles: any[] }>('/settings/permissions', payload)).data,
  getBackupConfig: async () =>
    (await http.get<{ config: any; last_status: any; is_gdrive_connected: boolean; default_gdrive_root_id: string }>('/backups/config')).data,
  updateBackupConfig: async (payload: any) =>
    (await http.put<{ config: any; message: string }>('/backups/config', payload)).data,
  exportLocalBackup: async (payload: { include_database: boolean; include_financials: boolean; include_manifest: boolean }) =>
    (await http.post('/backups/export-local', payload, { responseType: 'blob' })),
  exportGdriveBackup: async (payload: { include_database: boolean; include_financials: boolean; include_manifest: boolean; custom_folder_id?: string }) =>
    (await http.post<{ status: string; filename: string; size_mb: number; view_url: string }>('/backups/export-gdrive', payload)).data,
  getBackupHistory: async (customFolderId?: string) =>
    (await http.get<{ backups: Array<{ id: string; name: string; size_formatted: string; created_at: string; view_url: string; destination: string }> }>('/backups/history', { params: customFolderId ? { custom_folder_id: customFolderId } : undefined })).data,
  deleteBackup: async (fileId: string) =>
    (await http.delete(`/backups/history/${fileId}`)).data,
  downloadGdriveBackup: async (fileId: string) =>
    (await http.get(`/backups/download/${fileId}`, { responseType: 'blob' })),
};
