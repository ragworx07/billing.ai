export type UserRole = 'owner' | 'administrator' | 'client_manager' | 'project_manager' | 'project_coordinator' | 'supervisor' | 'accountant';
export type ProjectStatus = 'upcoming' | 'ongoing' | 'completed';
export type PaymentStatus = 'pending' | 'received' | 'overdue';
export type PaymentType = 'advance' | 'running' | 'final';
export type NotePriority = 'urgent' | 'high' | 'medium' | 'low';

export interface User {
  id: number;
  name: string;
  email: string;
  role: UserRole | null;
  is_active: boolean;
  phone?: string | null;
  created_at?: string;
}

export interface AuditActor {
  initials: string;
  name: string;
  email: string;
  action: string;
  timestamp: string;
}

export interface AuditHistoryItem {
  id: number;
  user_id: number;
  user_name: string;
  user_email: string;
  user_role: string;
  user_initials: string;
  action: string;
  table_name: string;
  category_label: string;
  tab_label: string;
  record_id: number;
  project_name?: string | null;
  subject?: string | null;
  details?: string | null;
  timestamp: string;
}

export interface SignupPayload {
  name: string;
  email: string;
  password: string;
  phone?: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface Client {
  id: number;
  name: string;
  company_name: string;
  pan_no?: string | null;
  phone: string;
  alternate_phone?: string | null;
  email?: string | null;
  address_line1: string;
  address_line2?: string | null;
  city: string;
  state: string;
  pincode: string;
  gst_number?: string | null;
  created_at: string;
}

export interface Project {
  id: number;
  client_id?: number | null;
  project_name: string;
  description?: string | null;
  profile_image_url?: string | null;
  location: string;
  start_date: string;
  expected_end_date?: string | null;
  total_amount: number;
  estimated_cost: number;
  construction_sqft: number;
  construction_rate_per_sqft: number;
  status: ProjectStatus;
  existing_shareholders_count: number;
  new_shareholders_count: number;
  created_at: string;
}

export interface ProjectShareholder {
  id: number;
  project_id: number;
  name: string;
  company_name?: string | null;
  pan_no?: string | null;
  phone: string;
  address?: string | null;
  city?: string | null;
  pincode?: string | null;
  is_existing_shareholder: boolean;
  existing_area: number;
  existing_uds: number;
  free_cost_area: number;
  new_area: number;
  new_uds: number;
  additional_sqft: number;
  rate_per_sqft: number;
    round_off: number;
    legal_charges?: number;
    due_amount: number;
}

export interface Worker {
  id: number;
  name: string;
  role: string;
  daily_wage: number;
  wage_options: number[];
}

export interface JVProjectSummaryItem {
  project_id: number;
  project_name: string;
  location: string;
  client_name: string;
  construction_rate_per_sqft: number;
  total_budget?: number;
  total_due: number;
  total_paid: number;
  total_balance: number;
}

export interface JVShareholderPaymentEntry {
  id: number;
  project_id: number;
  project_name: string;
  client_name: string;
  shareholder_id: number;
  shareholder_name: string;
  company_name?: string | null;
  pan_no?: string | null;
  payment_date: string;
  amount: number;
  payment_mode?: string | null;
  purpose?: string | null;
  notes?: string | null;
}

export interface JVShareholderPayment {
  id: number;
  project_id: number;
  shareholder_id: number;
  payment_date: string;
  amount: number;
  payment_mode?: string | null;
  purpose?: string | null;
  notes?: string | null;
}

export interface JVPaymentSchedule {
  id: number;
  project_id: number;
  shareholder_id: number;
  installment_no: number;
  amount: number;
  percentage: number;
  due_date: string;
  remarks?: string | null;
  paid_amount: number;
  balance_amount: number;
  status: string;
  days_overdue: number;
}

export interface JVPaymentScheduleInput {
  installment_no: number;
  amount: number;
  percentage: number;
  due_date: string;
  remarks?: string | null;
}

export interface JVShareholderLedgerItem {
  shareholder_id: number;
  name: string;
  company_name?: string | null;
  pan_no?: string | null;
  address?: string | null;
  city?: string | null;
  pincode?: string | null;
  is_existing_shareholder: boolean;
  existing_area: number;
  existing_uds: number;
  free_cost_area: number;
  new_area: number;
  new_uds: number;
  additional_sqft: number;
  rate_per_sqft: number;
  round_off: number;
  client_subtotal: number;
  legal_charges?: number;
  due_amount: number;
  due_percentage: number;
  paid_amount: number;
  balance_amount: number;
  gst_payable?: number;
  gst_paid?: number;
  gst_balance?: number;
  registration_payable?: number;
  registration_paid?: number;
  registration_balance?: number;
  legal_payable?: number;
  legal_paid?: number;
  legal_balance?: number;
}

export interface JVGovernmentCharges {
  composite_value_per_sqft: number;
  land_factor: number;
  gst_percent: number;
  registration_value_percent: number;
  construction_cost_per_sqft: number;
  new_gst_percent?: number;
  new_reg_upto_50l_percent?: number;
  new_reg_upto_3cr_percent?: number;
  new_reg_above_3cr_percent?: number;
  new_legal_charges?: number;
}

export interface JVProjectLedger {
  project_id: number;
  project_name: string;
  construction_rate_per_sqft: number;
  total_due: number;
  total_paid: number;
  total_balance: number;
  total_gst_payable?: number;
  total_gst_paid?: number;
  total_gst_balance?: number;
  total_registration_payable?: number;
  total_registration_paid?: number;
  total_registration_balance?: number;
  total_legal_payable?: number;
  total_legal_paid?: number;
  total_legal_balance?: number;
  government_charges?: JVGovernmentCharges;
  shareholders: JVShareholderLedgerItem[];
  payments: JVShareholderPayment[];
  payment_schedules: JVPaymentSchedule[];
}

export interface BillItem {
  id?: number;
  bill_id?: number;
  description: string;
  hsn_code?: string | null;
  cgst_rate?: number;
  sgst_rate?: number;
  cgst_amount?: number;
  sgst_amount?: number;
  quantity: number;
  rate: number;
  amount: number;
}

export interface BillItemInput {
  description: string;
  hsn_code?: string | null;
  cgst_rate?: number;
  sgst_rate?: number;
  cgst_amount?: number;
  sgst_amount?: number;
  quantity: number;
  rate: number;
  amount: number;
}

export interface Bill {
  id: number;
  bill_number: string;
  project_id?: number | null;
  custom_project_name?: string | null;
  project_name?: string | null;
  shareholder_id?: number | null;
  bill_date: string;
  due_date: string;
  client_name: string;
  company_name?: string | null;
  billing_address?: string | null;
  billing_city?: string | null;
  billing_pincode?: string | null;
  seal_type: string;
  subtotal: number;
  cgst_amount?: number;
  sgst_amount?: number;
  tax_amount: number;
  discount_amount: number;
  total_amount: number;
  paid_amount: number;
  balance_amount: number;
  status: 'unpaid' | 'partial' | 'paid' | 'cancelled' | string;
  notes?: string | null;
  signature_image?: string | null;
  gst_only?: boolean;
  items: BillItem[];
  created_at: string;
}

export interface BillInput {
  bill_number?: string | null;
  project_id?: number | null;
  custom_project_name?: string | null;
  shareholder_id?: number | null;
  bill_date: string;
  due_date: string;
  client_name: string;
  company_name?: string | null;
  billing_address?: string | null;
  billing_city?: string | null;
  billing_pincode?: string | null;
  seal_type?: string;
  subtotal: number;
  cgst_amount?: number;
  sgst_amount?: number;
  tax_amount: number;
  discount_amount: number;
  total_amount: number;
  notes?: string | null;
  signature_image?: string | null;
  gst_only?: boolean;
  items: BillItemInput[];
}

export interface BillRecordPaymentInput {
  payment_date: string;
  amount: number;
  payment_mode: string;
  notes?: string | null;
}

export interface Payment {
  id: number;
  project_id: number;
  payment_type: PaymentType;
  amount: number;
  payment_mode?: string | null;
  due_date?: string | null;
  received_date?: string | null;
  status: PaymentStatus;
  notes?: string | null;
}

export interface MaterialLog {
  id: number;
  project_id: number;
  vendor_id?: number | null;
  material_name: string;
  quantity: number;
  unit: string;
  unit_cost: number;
  supplier?: string | null;
  work_remarks?: string | null;
  total_cft?: number | null;
  rate_per_cft?: number | null;
  no_of_loads?: number | null;
  gst_percent?: number | null;
  template_meta?: Record<string, unknown> | null;
  transport_cost: number;
  bill_url?: string | null;
  bill_no?: string | null;
  date: string;
}

export interface MaterialMaster {
  id: number;
  name: string;
  supplier: string;
  unit: string;
  default_unit_cost: number;
  active: boolean;
  has_bundle_conversion?: boolean;
  default_bundle_weight?: number | null;
}

export interface ExpenseLog {
  id: number;
  project_id: number;
  category: string;
  amount: number;
  description?: string | null;
  bill_url?: string | null;
  date: string;
}

export interface OfficeExpense {
  id: number;
  item_name?: string | null;
  category: string;
  amount: number;
  rate?: number | null;
  quantity?: number | null;
  description?: string | null;
  bill_url?: string | null;
  date: string;
  week_start: string;
  closed_at?: string | null;
  created_at: string;
}

export interface OfficeSettlementInput {
  amount: number;
  date: string;
  payment_mode?: string | null;
  notes?: string | null;
}

export interface OfficeSettlement {
  id: number;
  amount: number;
  date: string;
  payment_mode?: string | null;
  notes?: string | null;
  created_by_id?: number | null;
  created_at: string;
}

export interface OfficeExpenseInput {
  item_name: string;
  category: string;
  rate: number;
  quantity: number;
  description?: string | null;
  date: string;
}

export type SiteExpenseAllocation = 'project' | 'office' | 'other';

export interface SiteExpense {
  id: number;
  item_name?: string | null;
  category: string;
  amount: number;
  rate?: number | null;
  quantity?: number | null;
  description?: string | null;
  bill_url?: string | null;
  date: string;
  week_start: string;
  closed_at?: string | null;
  allocation: SiteExpenseAllocation;
  project_id?: number | null;
}

export interface SiteExpenseInput {
  item_name: string;
  category: string;
  rate: number;
  quantity: number;
  description?: string | null;
  date: string;
  allocation: SiteExpenseAllocation;
  project_id?: number | null;
}

export interface ExpenseMaster {
  id: number;
  name: string;
  active: boolean;
}

export interface NoteAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl: string;
  storageBucket?: string | null;
  storagePath?: string | null;
}

export interface NoteRecord {
  id: string;
  order: number;
  x: number;
  y: number;
  topic: string;
  importantInfo: string;
  reminderWhen: string;
  details: string;
  createdAt: string;
  updatedAt: string;
  reminderLabel: string;
  color: string;
  priority: NotePriority;
  attachments: NoteAttachment[];
  archivedAt?: string | null;
}

export interface StoredNotes {
  active: NoteRecord[];
  archived: NoteRecord[];
}

export type MilestoneStatus = 'pending' | 'completed';

export interface ProjectMilestone {
  id: number;
  project_id: number;
  project_name?: string | null;
  project_status?: ProjectStatus | string | null;
  project_location?: string | null;
  title: string;
  milestone_date: string;
  details?: string | null;
  status: MilestoneStatus;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectFileFolder {
  id: number;
  project_id: number;
  parent_id?: number | null;
  name: string;
  created_by_id?: number | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectFile {
  id: number;
  project_id: number;
  folder_id?: number | null;
  original_filename: string;
  stored_filename: string;
  content_type: string;
  original_size: number;
  compressed_size: number;
  uploaded_by_id?: number | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectFileBoard {
  folders: ProjectFileFolder[];
  files: ProjectFile[];
}

export interface DashboardCard {
  label: string;
  value: number;
}

export interface DashboardResponse {
  cards: DashboardCard[];
  monthly_cashflow: Array<{
    month: string;
    inflow: number;
    outflow: number;
    net: number;
  }>;
  monthly_cashflow_by_project: Array<{
    project_id: number;
    project_name: string;
    month: string;
    inflow: number;
    outflow: number;
    net: number;
  }>;
  cost_breakdown: Array<{
    category: string;
    amount: number;
    share_pct: number;
  }>;
  status_distribution: Array<{
    status: string;
    count: number;
  }>;
  overdue_aging: Array<{
    bucket: string;
    count: number;
    amount: number;
  }>;
  overdue_payments: Array<{
    payment_id: number;
    project_id: number;
    project_name: string;
    payment_type: string;
    due_date?: string | null;
    amount: number;
    status: string;
    days_overdue: number;
  }>;
  project_health: Array<{
    project_id: number;
    project_name: string;
    status: string;
    construction_sqft: number;
    construction_rate_per_sqft: number;
    estimated_cost: number;
    total_amount: number;
    total_cost: number;
    total_received: number;
    outstanding: number;
    profit_projection: number;
    profit_margin_pct: number;
    collection_efficiency_pct: number;
    cost_to_quote_pct: number;
  }>;
  shareholder_risks: Array<{
    shareholder_id: number;
    project_id: number;
    project_name: string;
    shareholder_name: string;
    company_name?: string | null;
    phone?: string | null;
    address?: string | null;
    due_amount: number;
    paid_amount: number;
    balance_amount: number;
    collection_efficiency_pct: number;
  }>;
  alerts: Array<{
    severity: string;
    title: string;
    detail: string;
    project_id?: number | null;
    route?: string | null;
  }>;
}

export interface CalendarTransactionItem {
  id: string;
  project_id: number;
  project_name: string;
  date: string;
  direction: 'spent' | 'received';
  type: 'Material' | 'Labour' | 'Expense' | 'Client Receipt' | 'Shareholder Receipt' | 'Vendor Payment';
  title: string;
  amount: number;
  detail: string;
}

export interface CalendarDaySummary {
  date: string;
  spent: number;
  received: number;
  transactions: CalendarTransactionItem[];
}

export interface DashboardCalendarResponse {
  month: string;
  days: CalendarDaySummary[];
  totals: {
    spent: number;
    received: number;
    balance: number;
  };
}


export interface ProjectStatementEvent {
  date: string;
  type: 'project' | 'material' | 'attendance' | 'expense' | 'payment';
  title: string;
  detail: string;
  amount?: number | null;
}

export interface ProjectMetrics {
  material_cost: number;
  labour_cost: number;
  other_expenses: number;
  total_cost: number;
  total_received: number;
  outstanding: number;
  profit: number;
  profit_percentage: number;
}

export interface ProjectStatement {
  project: Project;
  timeline: ProjectStatementEvent[];
  metrics: ProjectMetrics;
}

export type AIResponseType = 'table' | 'chart' | 'card' | 'text' | 'summary' | 'clarification';

export interface AICardItem {
  label: string;
  value: string | number;
  tone?: string;
  detail?: string;
}

export interface AIChatAction {
  label: string;
  url: string;
  type?: 'navigate' | 'external' | 'copy';
  variant?: 'primary' | 'secondary' | 'outline';
  description?: string | null;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AIChatClarification {
  question: string;
  field?: string | null;
  options: string[];
  allow_free_text?: boolean;
}

export interface AIChatResponse {
  type: AIResponseType;
  title: string;
  summary?: string | null;
  columns?: string[] | null;
  rows?: Array<Array<string | number | boolean | null>> | null;
  cards?: AICardItem[] | null;
  chart_type?: 'bar' | 'line' | 'pie' | null;
  x_key?: string | null;
  y_keys?: string[] | null;
  data?: Array<Record<string, string | number | null>> | null;
  text?: string | null;
  intent?: string | null;
  filters?: Record<string, unknown>;
  actions?: AIChatAction[] | null;
  sample_prompts?: string[] | null;
  clarification?: AIChatClarification | null;
  sql?: string | null;
}

export interface AISamplePromptsResponse {
  sample_prompts: string[];
}

export interface AIChatHealthCheckItem {
  name: string;
  ok: boolean;
  detail: string;
}

export interface AIChatHealthResponse {
  ok: boolean;
  groq_configured: boolean;
  model: string;
  checks: AIChatHealthCheckItem[];
}

export interface LaborLog {
  id: number;
  project_id: number;
  vendor_id?: number | null;
  date: string;
  labour_type: string;
  labour_count: number;
  wage_per_head: number;
  overtime_cost: number;
  total_wage?: number | null;
  remarks?: string | null;
}

export interface VendorMaster {
  id: number;
  name: string;
  party_type: 'material_vendor' | 'labour_incharge';
  work_field?: string | null;
  phone?: string | null;
  address?: string | null;
  active: boolean;
}

export interface VendorPaymentHistoryItem {
  id: number;
  source: string;
  project_id: number;
  project_name: string;
  payment_date: string;
  work_detail: string;
  quantity?: number | null;
  rate?: number | null;
  amount: number;
  payment_mode?: string | null;
  notes?: string | null;
}

export interface VendorRecordBookItem extends VendorPaymentHistoryItem {
  vendor_id: number;
  vendor_name: string;
  party_type: 'material_vendor' | 'labour_incharge' | string;
}

export interface VendorTransaction {
  id: number;
  project_id: number;
  vendor_id: number;
  amount: number;
  round_off: number;
  payment_date: string;
  payment_mode?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface LabourInchargeLimit {
  id: number;
  project_id: number;
  vendor_id: number;
  limit_amount: number;
  created_at: string;
  updated_at: string;
}
