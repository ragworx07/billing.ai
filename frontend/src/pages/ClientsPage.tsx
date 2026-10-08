import type { FormEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { AlertTriangle, CalendarClock, CheckCircle2, ChevronDown, ChevronRight, Coins, CreditCard, DollarSign, Download, FileText, History, Landmark, MoreVertical, Printer, Ruler, Scale, Share2, Trash2, User, UserCheck, UserPlus, Wallet, X } from 'lucide-react';

import { DataTable } from '../components/DataTable';
import { ESignImageUpload } from '../components/ESignImageUpload';
import { JVReceipt, type JVReceiptData } from '../components/JVReceipt';
import { RequiredLabel } from '../components/RequiredLabel';
import { SectionCard } from '../components/SectionCard';
import { useAuth } from '../contexts/AuthContext';
import { useAuditHover } from '../contexts/AuditHoverContext';
import { useNotify } from '../contexts/NotificationContext';
import { api } from '../services/api';
import type { BillInput, JVGovernmentCharges, JVPaymentSchedule, JVPaymentScheduleInput, JVProjectLedger, JVShareholderLedgerItem } from '../types/api';
import { hasPermission } from '../utils/access';
import { getApiErrorMessage } from '../utils/errors';
import { formatCurrency, formatDate, slugify, localDateKey } from '../utils/format';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

import { SearchableCreatableSelect, type SelectOption } from '../components/SearchableCreatableSelect';
import { TableSkeleton } from '../components/Skeleton';

const paymentModeOptions = ['cash', 'online', 'upi', 'card', 'cheque', 'other'] as const;

const paymentModeSelectOptions: SelectOption[] = [
  { id: 'Cash', name: 'Cash' },
  { id: 'Cheque', name: 'Cheque' },
  { id: 'DD', name: 'DD' },
  { id: 'NEFT', name: 'NEFT' },
  { id: 'RTGS', name: 'RTGS' },
  { id: 'UPI', name: 'UPI' },
  { id: 'Online', name: 'Online' },
  { id: 'Net Banking', name: 'Net Banking' },
  { id: 'GPay', name: 'GPay' },
  { id: 'PhonePe', name: 'PhonePe' },
  { id: 'Paytm', name: 'Paytm' },
  { id: 'Bank Transfer', name: 'Bank Transfer' },
  { id: 'Others', name: 'Others' },
];

function formatMeasure(value: number) {
  const numeric = Number(value || 0);
  if (!numeric) return '-';
  return numeric.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function calculateAdditionalSqft(newArea: number, freeCostArea: number) {
  return Number(Math.max(Number(newArea || 0) - Number(freeCostArea || 0), 0).toFixed(2));
}

const defaultGovernmentCharges: JVGovernmentCharges = {
  composite_value_per_sqft: 0,
  land_factor: 1,
  gst_percent: 5,
  registration_value_percent: 4,
  construction_cost_per_sqft: 0,
  new_gst_percent: 5,
  new_reg_upto_50l_percent: 6,
  new_reg_upto_3cr_percent: 7,
  new_reg_above_3cr_percent: 9,
  new_legal_charges: 0,
};

const NEW_CLIENT_REG_UPTO_50L = 5_000_000;
const NEW_CLIENT_REG_UPTO_3CR = 30_000_000;

function gstPercentForClient(charges: JVGovernmentCharges, isExisting: boolean) {
  return isExisting ? Number(charges.gst_percent || 0) : Number(charges.new_gst_percent ?? 5);
}

function registrationPercentForClient(charges: JVGovernmentCharges, isExisting: boolean, payableAmount = 0) {
  if (isExisting) return Number(charges.registration_value_percent || 0);
  const amount = Number(payableAmount || 0);
  if (amount <= NEW_CLIENT_REG_UPTO_50L) return Number(charges.new_reg_upto_50l_percent ?? 6);
  if (amount <= NEW_CLIENT_REG_UPTO_3CR) return Number(charges.new_reg_upto_3cr_percent ?? 7);
  return Number(charges.new_reg_above_3cr_percent ?? 9);
}

function gstPayableForClient(charges: JVGovernmentCharges, isExisting: boolean, saleableArea: number, payableAmount: number) {
  const percent = gstPercentForClient(charges, isExisting);
  if (isExisting) {
    return roundMoney(Number(charges.composite_value_per_sqft || 0) * Number(charges.land_factor || 0) * Number(saleableArea || 0) * (percent / 100));
  }
  return roundMoney(Number(payableAmount || 0) * (percent / 100));
}

function registrationPayableForClient(charges: JVGovernmentCharges, isExisting: boolean, saleableArea: number, payableAmount: number) {
  const percent = registrationPercentForClient(charges, isExisting, payableAmount);
  if (isExisting) {
    return roundMoney(Number(charges.construction_cost_per_sqft || 0) * Number(saleableArea || 0) * (percent / 100));
  }
  return roundMoney(Number(payableAmount || 0) * (percent / 100));
}

const paymentKindOptions = [
  { id: 'construction', name: 'Without GST', hint: 'Construction receipt. Appears in payment history and you can print a receipt.' },
  { id: 'construction_gst', name: 'With GST', hint: 'Creates a GST invoice in GST Invoices and applies taxable + GST to this client.' },
  { id: 'registration', name: 'Registration', hint: 'Counts toward registration charges. Appears in payment history with a receipt.' },
  { id: 'legal', name: 'Legal charges', hint: 'Counts toward legal charges. Appears in payment history with a receipt.' },
] as const;

function paymentPurposeLabel(purpose?: string | null) {
  if (purpose === 'construction_gst' || purpose === 'gst' || purpose === 'gst_invoice') return 'With GST';
  const match = paymentKindOptions.find((item) => item.id === purpose);
  if (match) return match.name;
  return 'Without GST';
}

function roundMoney(value: number) {
  return Number((Number(value || 0)).toFixed(2));
}

function ChargeStack({
  title,
  payable,
  paid,
  balance,
  tone,
  formula,
}: {
  title: string;
  payable: number;
  paid: number;
  balance: number;
  tone: 'slate' | 'indigo' | 'amber' | 'violet';
  formula?: string;
}) {
  const tones = {
    slate: 'border-slate-200 bg-slate-50',
    indigo: 'border-indigo-200 bg-indigo-50/70',
    amber: 'border-amber-200 bg-amber-50/70',
    violet: 'border-violet-200 bg-violet-50/70',
  };
  return (
    <div className={`rounded-xl border px-2.5 py-2 ${tones[tone]}`} title={formula}>
      <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">{title}</p>
      <p className="mt-0.5 text-sm font-black text-slate-900">{formatCurrency(payable)}</p>
      <p className="text-[11px] font-semibold text-emerald-700">Paid {formatCurrency(paid)}</p>
      <p className={`text-[11px] font-black ${balance > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>Bal {formatCurrency(balance)}</p>
    </div>
  );
}

const initialDueForm = {
  name: '',
  company_name: '',
  phone: '',
  address: '',
  city: '',
  pincode: '',
  is_existing_shareholder: true,
  existing_area: 0,
  existing_uds: 0,
  free_cost_area: 0,
  new_area: 0,
  new_uds: 0,
  additional_sqft: 0,
  rate_per_sqft: 0,
  round_off: 0,
  legal_charges: 0,
  due_amount: 0,
};

const initialPaymentForm = {
  shareholder_id: 0,
  payment_date: localDateKey(),
  amount: 0,
  payment_mode: 'cash',
  payment_mode_custom: '',
  notes: '',
  seal_type: 'developers',
  purpose: 'construction',
  gst_only: false,
};

const initialScheduleForm = {
  shareholder_id: 0,
  installment_count: 1,
  installments: [] as JVPaymentScheduleInput[],
};

type EntryPanel = 'due' | 'payment' | 'schedule' | 'govt' | null;

function ClientDrawer({
  open,
  title,
  subtitle,
  icon,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex justify-end bg-slate-950/45 backdrop-blur-xs transition-opacity duration-200 animate-in fade-in">
      <div className="relative z-10 flex h-full max-h-full w-full min-w-0 flex-col overflow-hidden max-w-xl sm:max-w-2xl lg:max-w-3xl bg-white shadow-2xl animate-in slide-in-from-right duration-200 border-l border-slate-200">
        <div className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-100 bg-white/95 px-6 py-4 backdrop-blur-md">
          <div className="flex items-center gap-3">
            {icon ? <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700 font-extrabold">{icon}</div> : null}
            <div>
              <h3 className="text-lg font-black tracking-tight text-slate-900">{title}</h3>
              {subtitle ? <p className="text-xs font-semibold text-slate-500">{subtitle}</p> : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">{children}</div>

        {footer ? (
          <div className="sticky bottom-0 z-20 flex min-w-0 flex-wrap items-center justify-end gap-3 border-t border-slate-100 bg-slate-50/90 px-6 py-4 backdrop-blur-md">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ClientsPage() {
  const { user } = useAuth();
  const canPaymentEntry = hasPermission(user?.role, 'client_payment_entry');
  const canDueSchedule = hasPermission(user?.role, 'client_due_schedule');
  const canAddEditClient = hasPermission(user?.role, 'client_add_edit');
  const canDeleteClient = hasPermission(user?.role, 'client_delete');
  const canGstBilling = hasPermission(user?.role, 'client_gst_billing');
  const canGovernmentCharges = hasPermission(user?.role, 'client_government_charges');

  const { showAudit, hideAudit } = useAuditHover();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { projectId: urlProjectId, projectSlug: urlProjectSlug } = useParams();
  const navigate = useNavigate();
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [activePanel, setActivePanel] = useState<EntryPanel>(null);
  const [editingShareholderId, setEditingShareholderId] = useState<number | null>(null);
  const [editingPaymentId, setEditingPaymentId] = useState<number | null>(null);
  const [receiptPaymentId, setReceiptPaymentId] = useState<number | null>(null);
  const [editableReceiptData, setEditableReceiptData] = useState<JVReceiptData | null>(null);
  const [dueForm, setDueForm] = useState(initialDueForm);
  const [govtForm, setGovtForm] = useState<JVGovernmentCharges>(defaultGovernmentCharges);
  const [paymentForm, setPaymentForm] = useState(initialPaymentForm);
  const [scheduleForm, setScheduleForm] = useState(initialScheduleForm);
  const [showDevelopmentDetails, setShowDevelopmentDetails] = useState(false);
  const [expandedDueGroups, setExpandedDueGroups] = useState<Record<number, boolean>>({});
  const [selectedPaymentScheduleId, setSelectedPaymentScheduleId] = useState<number | null>(null);
  const [selectedClientHistoryId, setSelectedClientHistoryId] = useState<number | null>(null);
  const [rowMenu, setRowMenu] = useState<{ shareholderId: number; top: number; left: number } | null>(null);
  const receiptPrintRef = useRef<HTMLDivElement | null>(null);
  const rowMenuRef = useRef<HTMLDivElement | null>(null);

  const { data: projects = [] } = useQuery({
    queryKey: ['jv-projects'],
    queryFn: api.getJVProjects,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const { data: allProjects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: api.getProjects,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const routeProjectId = urlProjectId ? Number(urlProjectId) : Number(searchParams.get('projectId') || 0);
  const routeShareholderId = Number(searchParams.get('shareholderId') || 0);
  const selectedProjectSummary = useMemo(
    () => projects.find((project) => project.project_id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );
  const { data: ledgerResponse, error: ledgerError, isFetching: ledgerFetching } = useQuery({
    queryKey: ['jv-ledger', selectedProjectId],
    queryFn: () => api.getJVProjectLedger(selectedProjectId as number),
    enabled: Boolean(selectedProjectId),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
  const ledger = useMemo<JVProjectLedger | null>(() => {
    if (!ledgerResponse) return null;
    const response = ledgerResponse as Partial<JVProjectLedger>;
    return {
      project_id: Number(response.project_id || selectedProjectId || 0),
      project_name: response.project_name || selectedProjectSummary?.project_name || 'JV Project',
      construction_rate_per_sqft: Number(response.construction_rate_per_sqft || selectedProjectSummary?.construction_rate_per_sqft || 0),
      total_due: Number(response.total_due || 0),
      total_paid: Number(response.total_paid || 0),
      total_balance: Number(response.total_balance || 0),
      total_gst_payable: Number(response.total_gst_payable || 0),
      total_gst_paid: Number(response.total_gst_paid || 0),
      total_gst_balance: Number(response.total_gst_balance || 0),
      total_registration_payable: Number(response.total_registration_payable || 0),
      total_registration_paid: Number(response.total_registration_paid || 0),
      total_registration_balance: Number(response.total_registration_balance || 0),
      total_legal_payable: Number(response.total_legal_payable || 0),
      total_legal_paid: Number(response.total_legal_paid || 0),
      total_legal_balance: Number(response.total_legal_balance || 0),
      government_charges: {
        ...defaultGovernmentCharges,
        ...(response.government_charges || {}),
      },
      shareholders: Array.isArray(response.shareholders) ? response.shareholders : [],
      payments: Array.isArray(response.payments) ? response.payments : [],
      payment_schedules: Array.isArray(response.payment_schedules) ? response.payment_schedules : [],
    };
  }, [ledgerResponse, selectedProjectId, selectedProjectSummary]);
  const clientAuditRecords = useMemo(() => ledger ? [
    ...ledger.shareholders.map((row) => ({ table_name: 'project_shareholders', record_id: row.shareholder_id })),
    ...ledger.shareholders.map((row) => ({ table_name: 'shareholder_payment_schedules', record_id: row.shareholder_id })),
    ...ledger.payments.map((row) => ({ table_name: 'shareholder_payments', record_id: row.id })),
  ] : [], [ledger]);
  const { data: clientAuditActors = {} } = useQuery({
    queryKey: ['audit-actors', 'client-ledger', selectedProjectId, clientAuditRecords.map((row) => `${row.table_name}:${row.record_id}`)],
    queryFn: () => api.getAuditActors(clientAuditRecords),
    enabled: clientAuditRecords.length > 0,
  });
  const selectedProject = useMemo(
    () => allProjects.find((project) => project.id === selectedProjectId) || null,
    [allProjects, selectedProjectId],
  );
  const projectRatePerSqft = Number(
    selectedProject?.construction_rate_per_sqft
      || ledger?.construction_rate_per_sqft
      || selectedProjectSummary?.construction_rate_per_sqft
      || 0,
  );
  const calculatedAdditionalSqft = useMemo(
    () => calculateAdditionalSqft(dueForm.new_area, dueForm.free_cost_area),
    [dueForm.free_cost_area, dueForm.new_area],
  );
  const clientRatePerSqft = Number(dueForm.rate_per_sqft || 0);
  const calculatedClientSubtotal = useMemo(
    () => Number((calculatedAdditionalSqft * clientRatePerSqft).toFixed(2)),
    [calculatedAdditionalSqft, clientRatePerSqft],
  );
  const calculatedDueAmount = useMemo(
    () => Number((calculatedClientSubtotal + Number(dueForm.round_off || 0)).toFixed(2)),
    [calculatedClientSubtotal, dueForm.round_off],
  );
  const { data: projectShareholders = [] } = useQuery({
    queryKey: ['project-shareholders', selectedProjectId],
    queryFn: () => api.getProjectShareholders(selectedProjectId as number),
    enabled: Boolean(selectedProjectId),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!routeProjectId || selectedProjectId === routeProjectId) return;
    if (projects.length && !projects.some((project) => project.project_id === routeProjectId)) return;
    setSelectedProjectId(routeProjectId);
  }, [projects, routeProjectId, selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId || !selectedProjectSummary) return;
    const expectedSlug = slugify(selectedProjectSummary.project_name);
    if (urlProjectId && urlProjectSlug !== expectedSlug) {
      navigate(`/clients/${selectedProjectId}/${expectedSlug}`, { replace: true });
    }
  }, [selectedProjectId, selectedProjectSummary, urlProjectId, urlProjectSlug, navigate]);

  useEffect(() => {
    if (!routeShareholderId || !ledger?.shareholders.some((item) => item.shareholder_id === routeShareholderId)) return;
    setExpandedDueGroups((current) => ({ ...current, [routeShareholderId]: true }));
  }, [ledger, routeShareholderId]);

  useEffect(() => {
    if (!rowMenu) return;
    function handlePointer(event: MouseEvent) {
      if (rowMenuRef.current?.contains(event.target as Node)) return;
      setRowMenu(null);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setRowMenu(null);
    }
    function handleScroll() {
      setRowMenu(null);
    }
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [rowMenu]);

  useEffect(() => {
    setRowMenu(null);
  }, [activePanel, selectedClientHistoryId]);
  const selectedReceiptPayment = useMemo(
    () => ledger?.payments.find((item) => item.id === receiptPaymentId) || null,
    [ledger, receiptPaymentId],
  );
  const selectedReceiptShareholder = useMemo(
    () => ledger?.shareholders.find((item) => item.shareholder_id === selectedReceiptPayment?.shareholder_id) || null,
    [ledger, selectedReceiptPayment],
  );
  const duePercentages = useMemo(() => {
    if (!ledger?.shareholders.length) return [];
    const totalDue = ledger.shareholders.reduce((sum, row) => sum + Number(row.due_amount || 0), 0);
    if (totalDue <= 0) return ledger.shareholders.map(() => 0);
    const rounded = ledger.shareholders.map((row) => Number(((Number(row.due_amount || 0) / totalDue) * 100).toFixed(2)));
    const prefixTotal = rounded.slice(0, -1).reduce((sum, value) => sum + value, 0);
    rounded[rounded.length - 1] = Number((100 - prefixTotal).toFixed(2));
    return rounded;
  }, [ledger]);
  const selectedScheduleShareholder = useMemo(
    () => ledger?.shareholders.find((item) => item.shareholder_id === scheduleForm.shareholder_id) || null,
    [ledger, scheduleForm.shareholder_id],
  );
  const scheduleTotals = useMemo(() => {
    const amount = scheduleForm.installments.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const percentage = scheduleForm.installments.reduce((sum, row) => sum + Number(row.percentage || 0), 0);
    return { amount, percentage };
  }, [scheduleForm.installments]);
  const dueScheduleGroups = useMemo(() => {
    if (!ledger) return [];
    return ledger.shareholders
      .map((shareholder) => {
        const schedules = ledger.payment_schedules
          .filter((item) => item.shareholder_id === shareholder.shareholder_id)
          .slice()
          .sort((left, right) => left.installment_no - right.installment_no);
        const dueAmount = schedules.reduce((sum, item) => sum + Number(item.amount || 0), 0);
        const paidAmount = schedules.reduce((sum, item) => sum + Number(item.paid_amount || 0), 0);
        const balanceAmount = schedules.reduce((sum, item) => sum + Number(item.balance_amount || 0), 0);
        const overdueCount = schedules.filter((item) => item.days_overdue > 0 && Number(item.balance_amount || 0) > 0).length;
        const status = balanceAmount <= 0 && schedules.length ? 'paid' : overdueCount > 0 ? 'overdue' : 'unpaid';
        return { shareholder, schedules, dueAmount, paidAmount, balanceAmount, overdueCount, status };
      })
      .filter((group) => group.schedules.length > 0);
  }, [ledger]);
  const pendingSchedulesForPayment = useMemo(() => {
    if (!ledger || paymentForm.shareholder_id <= 0) return [];
    return ledger.payment_schedules
      .filter((item) => item.shareholder_id === paymentForm.shareholder_id && Number(item.balance_amount || 0) > 0)
      .slice()
      .sort((left, right) => {
        const dateSort = new Date(left.due_date).getTime() - new Date(right.due_date).getTime();
        return dateSort || left.installment_no - right.installment_no;
      });
  }, [ledger, paymentForm.shareholder_id]);
  const selectedPaymentClient = useMemo(
    () => ledger?.shareholders.find((item) => item.shareholder_id === paymentForm.shareholder_id) || null,
    [ledger, paymentForm.shareholder_id],
  );
  const selectedPaymentSource = useMemo(
    () => projectShareholders.find((item) => item.id === paymentForm.shareholder_id) || null,
    [projectShareholders, paymentForm.shareholder_id],
  );
  const paymentGstPercent = gstPercentForClient(
    ledger?.government_charges || defaultGovernmentCharges,
    Boolean(selectedPaymentClient?.is_existing_shareholder),
  );
  const paymentTaxableAmount = roundMoney(paymentForm.amount);
  const paymentGstAmount = paymentForm.purpose === 'construction_gst'
    ? roundMoney(paymentTaxableAmount * (paymentGstPercent / 100))
    : 0;
  const paymentCgstAmount = roundMoney(paymentGstAmount / 2);
  const paymentSgstAmount = roundMoney(paymentGstAmount - paymentCgstAmount);
  const paymentTotalWithGst = roundMoney(paymentTaxableAmount + paymentGstAmount);
  const receiptData: JVReceiptData | null = selectedReceiptPayment && selectedReceiptShareholder && selectedProjectSummary
    ? {
        receiptNumber: String(selectedReceiptPayment.id),
        date: selectedReceiptPayment.payment_date,
        projectName: selectedProjectSummary.project_name,
        projectLocation: selectedProjectSummary.location,
        shareholderName: selectedReceiptShareholder.name,
        companyName: selectedReceiptShareholder.company_name,
        clientAddress: selectedReceiptShareholder.address || null,
        clientCity: selectedReceiptShareholder.city || null,
        clientPincode: selectedReceiptShareholder.pincode || null,
        amount: Number(selectedReceiptPayment.amount || 0),
        paymentMode: selectedReceiptPayment.payment_mode,
        notes: selectedReceiptPayment.notes || null,
      }
    : null;
  const selectedClientHistory = useMemo(() => {
    if (!ledger || !selectedClientHistoryId) return null;
    const shareholder = ledger.shareholders.find((item) => item.shareholder_id === selectedClientHistoryId) || null;
    if (!shareholder) return null;
    const schedules = ledger.payment_schedules
      .filter((item) => item.shareholder_id === shareholder.shareholder_id)
      .slice()
      .sort((left, right) => left.installment_no - right.installment_no);
    const payments = ledger.payments
      .filter((item) => item.shareholder_id === shareholder.shareholder_id)
      .slice()
      .sort((left, right) => new Date(left.payment_date).getTime() - new Date(right.payment_date).getTime());
    const source = projectShareholders.find((item) => item.id === shareholder.shareholder_id) || null;
    const shareholderIndex = ledger.shareholders.findIndex((item) => item.shareholder_id === shareholder.shareholder_id);
    const duePercent = duePercentages[shareholderIndex] ?? shareholder.due_percentage;
    const overdueCount = schedules.filter((item) => item.days_overdue > 0 && Number(item.balance_amount || 0) > 0).length;
    const status = Number(shareholder.balance_amount || 0) <= 0 ? 'paid' : overdueCount > 0 ? 'overdue' : 'unpaid';
    return { shareholder, schedules, payments, source, duePercent, overdueCount, status };
  }, [duePercentages, ledger, projectShareholders, selectedClientHistoryId]);

  const dueMutation = useMutation({
    mutationFn: async ({
      projectId,
      shareholderId,
      payload,
    }: {
      projectId: number;
      shareholderId: number | null;
      payload: {
        name: string;
        company_name?: string | null;
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
        legal_charges: number;
        due_amount: number;
      };
    }) => {
      if (shareholderId) return api.updateProjectShareholder(projectId, shareholderId, payload);
      return api.createProjectShareholder(projectId, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jv-projects'] });
      queryClient.invalidateQueries({ queryKey: ['jv-ledger', selectedProjectId] });
      queryClient.invalidateQueries({ queryKey: ['project-shareholders', selectedProjectId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setDueForm(initialDueForm);
      setEditingShareholderId(null);
      setEditingPaymentId(null);
      setActivePanel(null);
      notify.success('Amount to pay saved successfully.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to save amount to pay entry.')),
  });

  const governmentChargesMutation = useMutation({
    mutationFn: ({ projectId, payload }: { projectId: number; payload: JVGovernmentCharges }) =>
      api.updateJVGovernmentCharges(projectId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jv-projects'] });
      queryClient.invalidateQueries({ queryKey: ['jv-ledger', selectedProjectId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setActivePanel(null);
      notify.success('Government charges saved. GST and registration amounts updated for every client.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to save government charges.')),
  });

  const paymentMutation = useMutation({
    mutationFn: ({
      projectId,
      paymentId,
      payload,
    }: {
      projectId: number;
      paymentId: number | null;
      payload: { shareholder_id: number; payment_date: string; amount: number; payment_mode?: string | null; purpose?: string; notes?: string | null };
    }) => paymentId
      ? api.updateJVShareholderPayment(projectId, paymentId, payload)
      : api.createJVShareholderPayment(projectId, payload),
    onSuccess: (row, variables) => {
      queryClient.invalidateQueries({ queryKey: ['jv-projects'] });
      queryClient.invalidateQueries({ queryKey: ['jv-ledger', selectedProjectId] });
      queryClient.invalidateQueries({ queryKey: ['project-shareholders', selectedProjectId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      const createdId = Number(row?.id || 0);
      setPaymentForm(initialPaymentForm);
      setEditingPaymentId(null);
      setSelectedPaymentScheduleId(null);
      setActivePanel(null);
      notify.success(variables.paymentId ? 'Payment updated.' : 'Payment saved. Receipt is ready.');
      if (!variables.paymentId && createdId) setReceiptPaymentId(createdId);
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to save payment.')),
  });

  const gstInvoicePaymentMutation = useMutation({
    mutationFn: async ({
      payload,
      payment,
    }: {
      projectId: number;
      payload: BillInput;
      payment: { payment_date: string; amount: number; payment_mode: string; notes?: string | null };
    }) => {
      const bill = await api.createBill(payload);
      const recorded = await api.recordBillPayment(bill.id, {
        payment_date: payment.payment_date,
        amount: payment.amount,
        payment_mode: payment.payment_mode,
        notes: payment.notes || `Payment for Bill ${bill.bill_number}`,
      });
      return { bill, payment: recorded };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['bills'] });
      queryClient.invalidateQueries({ queryKey: ['jv-projects'] });
      queryClient.invalidateQueries({ queryKey: ['jv-ledger', selectedProjectId] });
      queryClient.invalidateQueries({ queryKey: ['project-shareholders', selectedProjectId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setPaymentForm(initialPaymentForm);
      setEditingPaymentId(null);
      setSelectedPaymentScheduleId(null);
      setActivePanel(null);
      notify.success(`GST invoice ${result.bill.bill_number} created and marked paid.`);
      const createdId = Number(result.payment?.id || 0);
      if (createdId) setReceiptPaymentId(createdId);
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to create the GST invoice payment.')),
  });

  const deleteShareholderMutation = useMutation({
    mutationFn: (shareholderId: number) => api.deleteProjectShareholder(selectedProjectId as number, shareholderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jv-projects'] });
      queryClient.invalidateQueries({ queryKey: ['jv-ledger', selectedProjectId] });
      queryClient.invalidateQueries({ queryKey: ['project-shareholders', selectedProjectId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setEditingShareholderId(null);
      setActivePanel(null);
      notify.success('Amount to pay deleted.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to delete amount to pay entry.')),
  });

  const deletePaymentMutation = useMutation({
    mutationFn: (paymentId: number) => api.deleteJVShareholderPayment(selectedProjectId as number, paymentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jv-projects'] });
      queryClient.invalidateQueries({ queryKey: ['jv-ledger', selectedProjectId] });
      setEditingPaymentId(null);
      setReceiptPaymentId(null);
      setSelectedPaymentScheduleId(null);
      setActivePanel(null);
      notify.success('Payment entry deleted.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to delete payment entry.')),
  });

  const scheduleMutation = useMutation({
    mutationFn: ({
      projectId,
      shareholderId,
      installments,
    }: {
      projectId: number;
      shareholderId: number;
      installments: JVPaymentScheduleInput[];
    }) => api.saveJVPaymentSchedule(projectId, shareholderId, installments),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jv-projects'] });
      queryClient.invalidateQueries({ queryKey: ['jv-ledger', selectedProjectId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setScheduleForm(initialScheduleForm);
      setActivePanel(null);
      notify.success('Payment dues schedule saved successfully.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to save payment dues schedule.')),
  });

  const deleteScheduleMutation = useMutation({
    mutationFn: (shareholderId: number) => api.deleteJVPaymentSchedule(selectedProjectId as number, shareholderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jv-ledger', selectedProjectId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setScheduleForm(initialScheduleForm);
      notify.success('Payment dues schedule deleted.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to delete payment dues schedule.')),
  });

  function openNewDueForm() {
    if (!canAddEditClient) {
      notify.error('You do not have permission to add client profiles.');
      return;
    }
    if (activePanel === 'due') {
      setActivePanel(null);
      setEditingShareholderId(null);
      setEditingPaymentId(null);
      setDueForm(initialDueForm);
      return;
    }
    setEditingShareholderId(null);
    setEditingPaymentId(null);
    setDueForm({
      ...initialDueForm,
      rate_per_sqft: projectRatePerSqft || 0,
      round_off: 0,
    });
    setActivePanel('due');
    setPaymentForm(initialPaymentForm);
  }

  function openEditDueForm(row: JVShareholderLedgerItem) {
    if (!canAddEditClient) {
      notify.error('You do not have permission to edit client profiles.');
      return;
    }
    const source = projectShareholders.find((item) => item.id === row.shareholder_id);
    if (!source) return;
    setEditingShareholderId(source.id);
    setDueForm({
      name: source.name,
      company_name: source.company_name || '',
      phone: source.phone || '',
      address: source.address || '',
      city: source.city || '',
      pincode: source.pincode || '',
      is_existing_shareholder: source.is_existing_shareholder,
      existing_area: Number(source.existing_area || 0),
      existing_uds: Number(source.existing_uds || 0),
      free_cost_area: Number(source.free_cost_area || 0),
      new_area: Number(source.new_area || 0),
      new_uds: Number(source.new_uds || 0),
      additional_sqft: calculateAdditionalSqft(Number(source.new_area || 0), Number(source.free_cost_area || 0)),
      rate_per_sqft: Number(source.rate_per_sqft || projectRatePerSqft || 0),
      round_off: Number(source.round_off || 0),
      legal_charges: Number(source.legal_charges || row.legal_charges || row.legal_payable || 0),
      due_amount: Number(source.due_amount || 0),
    });
    setActivePanel('due');
  }

  function toggleRowMenu(event: ReactMouseEvent<HTMLButtonElement>, shareholderId: number) {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 224;
    const menuHeight = 248;
    const gap = 6;
    const left = Math.min(
      Math.max(8, rect.right - menuWidth),
      window.innerWidth - menuWidth - 8,
    );
    const fitsBelow = rect.bottom + gap + menuHeight <= window.innerHeight - 8;
    const top = fitsBelow
      ? rect.bottom + gap
      : Math.max(8, rect.top - menuHeight - gap);
    setRowMenu((current) => (
      current?.shareholderId === shareholderId
        ? null
        : { shareholderId, top, left }
    ));
  }

  function deleteClient(row: JVShareholderLedgerItem) {
    if (!canDeleteClient) {
      notify.error('You do not have permission to delete client records.');
      return;
    }
    if (!selectedProjectId) return;
    const hasPaidAmount = Number(row.paid_amount || 0) > 0;
    const label = hasPaidAmount
      ? `client ${row.name} and their due schedule/payment history`
      : `client ${row.name}`;
    if (!confirmTypedDelete(label)) return;
    deleteShareholderMutation.mutate(row.shareholder_id);
  }

  function suggestedPaymentAmount(kind: string, shareholder?: JVShareholderLedgerItem | null) {
    if (!shareholder) return 0;
    if (kind === 'construction_gst') {
      const constructionBal = roundMoney(shareholder.balance_amount);
      if (constructionBal > 0) return constructionBal;
      const gstBal = roundMoney(Number(shareholder.gst_balance || 0));
      if (gstBal > 0 && paymentGstPercent > 0) return roundMoney(gstBal / (paymentGstPercent / 100));
      return 0;
    }
    if (kind === 'construction') return roundMoney(shareholder.balance_amount);
    if (kind === 'registration') return roundMoney(Number(shareholder.registration_balance || 0));
    if (kind === 'legal') return roundMoney(Number(shareholder.legal_balance || 0));
    return 0;
  }

  function togglePaymentForm() {
    if (!canPaymentEntry) {
      notify.error('You do not have permission for Client Payment Entry.');
      return;
    }
    if (activePanel === 'payment') {
      setActivePanel(null);
      setEditingPaymentId(null);
      setPaymentForm(initialPaymentForm);
      setSelectedPaymentScheduleId(null);
      return;
    }
    setEditingShareholderId(null);
    setEditingPaymentId(null);
    setDueForm(initialDueForm);
    setPaymentForm(initialPaymentForm);
    setSelectedPaymentScheduleId(null);
    setActivePanel('payment');
  }

  function scheduleStatusClasses(status: string) {
    if (status === 'paid') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    if (status.includes('overdue')) return 'border-rose-200 bg-rose-50 text-rose-800';
    if (status.includes('partial')) return 'border-amber-200 bg-amber-50 text-amber-800';
    return 'border-slate-200 bg-white text-slate-700';
  }

  function getInstallmentPaymentDates(item: JVPaymentSchedule, payments: Array<{ payment_date: string; notes?: string | null }>) {
    const installmentTag = `Installment #${item.installment_no}`.toLowerCase();
    const rawDueDate = item.due_date.toLowerCase();
    const formattedDueDate = formatDate(item.due_date).toLowerCase();
    const matched = payments.filter((payment) => {
      const notes = (payment.notes || '').toLowerCase();
      return notes.includes(installmentTag) || notes.includes(rawDueDate) || notes.includes(formattedDueDate);
    });
    if (!matched.length && payments.length === 1 && Number(item.paid_amount || 0) > 0) return [formatDate(payments[0].payment_date)];
    return matched.map((payment) => formatDate(payment.payment_date));
  }

  function selectScheduleForPayment(item: JVPaymentSchedule) {
    if (!canPaymentEntry) {
      notify.error('You do not have permission for Client Payment Entry.');
      return;
    }
    const shareholder = ledger?.shareholders.find((row) => row.shareholder_id === item.shareholder_id);
    setEditingShareholderId(null);
    setEditingPaymentId(null);
    setSelectedPaymentScheduleId(item.id);
    setPaymentForm({
      ...initialPaymentForm,
      shareholder_id: item.shareholder_id,
      amount: Number(item.balance_amount || item.amount || 0),
      notes: `Installment #${item.installment_no}${item.due_date ? ` due ${formatDate(item.due_date)}` : ''}${shareholder ? ` - ${shareholder.name}` : ''}`,
      purpose: paymentForm.purpose === 'construction_gst' ? 'construction_gst' : 'construction',
    });
    setActivePanel('payment');
  }

  function buildInstallmentRows(count: number, shareholderId = scheduleForm.shareholder_id) {
    const normalizedCount = Math.max(1, Math.floor(Number(count || 1)));
    const shareholder = ledger?.shareholders.find((item) => item.shareholder_id === shareholderId) || null;
    const totalDue = Number(shareholder?.due_amount || 0);
    const percentage = Number((100 / normalizedCount).toFixed(2));
    return Array.from({ length: normalizedCount }, (_, index) => {
      const isLast = index === normalizedCount - 1;
      const usedPercentage = isLast ? Number((100 - percentage * (normalizedCount - 1)).toFixed(2)) : percentage;
      return {
        installment_no: index + 1,
        amount: Number(((totalDue * usedPercentage) / 100).toFixed(2)),
        percentage: usedPercentage,
        due_date: '',
        remarks: '',
      };
    });
  }

  function openScheduleForm(shareholderId?: number) {
    if (!canDueSchedule) {
      notify.error('You do not have permission for Client Due Schedule.');
      return;
    }
    const nextShareholderId = shareholderId || ledger?.shareholders[0]?.shareholder_id || 0;
    const existingRows = ledger?.payment_schedules
      .filter((item) => item.shareholder_id === nextShareholderId)
      .sort((left, right) => left.installment_no - right.installment_no) || [];
    setEditingShareholderId(null);
    setEditingPaymentId(null);
    setDueForm(initialDueForm);
    setPaymentForm(initialPaymentForm);
    setScheduleForm({
      shareholder_id: nextShareholderId,
      installment_count: existingRows.length || 1,
      installments: existingRows.length
        ? existingRows.map((item) => ({
            installment_no: item.installment_no,
            amount: Number(item.amount || 0),
            percentage: Number(item.percentage || 0),
            due_date: item.due_date,
            remarks: item.remarks || '',
          }))
        : buildInstallmentRows(1, nextShareholderId),
    });
    setActivePanel('schedule');
  }

  function updateScheduleShareholder(shareholderId: number) {
    const existingRows = ledger?.payment_schedules
      .filter((item) => item.shareholder_id === shareholderId)
      .sort((left, right) => left.installment_no - right.installment_no) || [];
    setScheduleForm({
      shareholder_id: shareholderId,
      installment_count: existingRows.length || 1,
      installments: existingRows.length
        ? existingRows.map((item) => ({
            installment_no: item.installment_no,
            amount: Number(item.amount || 0),
            percentage: Number(item.percentage || 0),
            due_date: item.due_date,
            remarks: item.remarks || '',
          }))
        : buildInstallmentRows(1, shareholderId),
    });
  }

  function updateInstallmentCount(count: number) {
    const normalizedCount = Math.max(1, Math.floor(Number(count || 1)));
    setScheduleForm((current) => ({
      ...current,
      installment_count: normalizedCount,
      installments: buildInstallmentRows(normalizedCount, current.shareholder_id),
    }));
  }

  function updateInstallment(index: number, patch: Partial<JVPaymentScheduleInput>) {
    setScheduleForm((current) => {
      const shareholder = ledger?.shareholders.find((item) => item.shareholder_id === current.shareholder_id) || null;
      const totalDue = Number(shareholder?.due_amount || 0);
      return {
        ...current,
        installments: current.installments.map((row, rowIndex) => {
          if (rowIndex !== index) return row;
          const next = { ...row, ...patch };
          if (patch.percentage !== undefined && totalDue > 0) {
            next.amount = Number(((totalDue * Number(patch.percentage || 0)) / 100).toFixed(2));
          }
          return next;
        }),
      };
    });
  }

  function closeActivePanel() {
    setActivePanel(null);
    setEditingShareholderId(null);
    setEditingPaymentId(null);
    setDueForm(initialDueForm);
    setPaymentForm(initialPaymentForm);
    setScheduleForm(initialScheduleForm);
    setSelectedPaymentScheduleId(null);
  }

  function openReceipt(paymentId: number) {
    setReceiptPaymentId(paymentId);
    const payment = ledger?.payments.find((item) => item.id === paymentId) || null;
    const shareholder = ledger?.shareholders.find((item) => item.shareholder_id === payment?.shareholder_id) || null;
    if (payment && shareholder && selectedProjectSummary) {
      let baseNotes = payment.notes || '';
      let sealType = 'developers';
      if (baseNotes.includes('[Seal: KKR Foundations]')) {
        sealType = 'foundations';
        baseNotes = baseNotes.replace('[Seal: KKR Foundations]', '').trim();
      } else if (baseNotes.includes('[Seal: KKR Developers]')) {
        sealType = 'developers';
        baseNotes = baseNotes.replace('[Seal: KKR Developers]', '').trim();
      }

      setEditableReceiptData({
        receiptNumber: String(payment.id),
        date: payment.payment_date,
        projectName: selectedProjectSummary.project_name,
        projectLocation: selectedProjectSummary.location,
        shareholderName: shareholder.name,
        companyName: shareholder.company_name,
        amount: Number(payment.amount || 0),
        paymentMode: payment.payment_mode,
        notes: baseNotes || null,
        drawnOn: '',
        signatureImage: null,
        sealType: sealType,
      });
    }
  }

  function confirmTypedDelete(label: string) {
    const confirmation = window.prompt(`Type CONFIRM to delete ${label}.`);
    return confirmation?.trim().toLowerCase() === 'confirm';
  }

  function openEditPaymentForm(item: { id: number; shareholder_id: number; payment_date: string; amount: number; payment_mode?: string | null; purpose?: string | null; notes?: string | null }) {
    if (!canPaymentEntry) {
      notify.error('You do not have permission for Client Payment Entry.');
      return;
    }
    const knownPaymentMode = item.payment_mode && paymentModeOptions.includes(item.payment_mode as (typeof paymentModeOptions)[number]);
    
    let baseNotes = item.notes || '';
    let sealType = 'developers';
    if (baseNotes.includes('[Seal: KKR Foundations]')) {
      sealType = 'foundations';
      baseNotes = baseNotes.replace('[Seal: KKR Foundations]', '').trim();
    } else if (baseNotes.includes('[Seal: KKR Developers]')) {
      sealType = 'developers';
      baseNotes = baseNotes.replace('[Seal: KKR Developers]', '').trim();
    }

    const isGstInvoice = item.purpose === 'gst_invoice';
    const taxableAmount = isGstInvoice && paymentGstPercent > 0
      ? roundMoney(Number(item.amount || 0) / (1 + paymentGstPercent / 100))
      : Number(item.amount || 0);

    setEditingPaymentId(item.id);
    setPaymentForm({
      shareholder_id: item.shareholder_id,
      payment_date: item.payment_date,
      amount: taxableAmount,
      payment_mode: knownPaymentMode ? (item.payment_mode as (typeof paymentModeOptions)[number]) : item.payment_mode ? 'other' : 'cash',
      payment_mode_custom: knownPaymentMode ? '' : item.payment_mode || '',
      notes: baseNotes,
      seal_type: sealType,
      purpose: isGstInvoice ? 'construction_gst' : (item.purpose || 'construction'),
      gst_only: false,
    });
    setEditingShareholderId(null);
    setActivePanel('payment');
  }

  function openGovernmentCharges() {
    if (!canAddEditClient) {
      notify.error('You do not have permission to edit government charges.');
      return;
    }
    setGovtForm({
      ...defaultGovernmentCharges,
      ...(ledger?.government_charges || {}),
    });
    setEditingShareholderId(null);
    setEditingPaymentId(null);
    setActivePanel('govt');
  }

  function submitGovernmentCharges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProjectId) return;
    const landFactor = Number(govtForm.land_factor || 0);
    if (landFactor < 0 || landFactor > 2) {
      notify.error('Land factor must be between 0 and 2.');
      return;
    }
    governmentChargesMutation.mutate({
      projectId: selectedProjectId,
      payload: {
        composite_value_per_sqft: Number(govtForm.composite_value_per_sqft || 0),
        land_factor: landFactor,
        gst_percent: Number(govtForm.gst_percent || 0),
        registration_value_percent: Number(govtForm.registration_value_percent || 0),
        construction_cost_per_sqft: Number(govtForm.construction_cost_per_sqft || 0),
        new_gst_percent: Number(govtForm.new_gst_percent ?? 5),
        new_reg_upto_50l_percent: Number(govtForm.new_reg_upto_50l_percent ?? 6),
        new_reg_upto_3cr_percent: Number(govtForm.new_reg_upto_3cr_percent ?? 7),
        new_reg_above_3cr_percent: Number(govtForm.new_reg_above_3cr_percent ?? 9),
        new_legal_charges: Number(govtForm.new_legal_charges || 0),
      },
    });
  }

  function closeReceipt() {
    setReceiptPaymentId(null);
    setEditableReceiptData(null);
  }

  async function exportReceipt(format: 'jpg' | 'pdf', action: 'share' | 'download') {
    if (!receiptPrintRef.current || !editableReceiptData) return;
    const canvas = await html2canvas(receiptPrintRef.current, {
      backgroundColor: '#ffffff',
      scale: 2,
    });
    const rawDate = new Date(editableReceiptData.date);
    let dateStr = '';
    if (!Number.isNaN(rawDate.getTime())) {
      const dd = String(rawDate.getDate()).padStart(2, '0');
      const mm = String(rawDate.getMonth() + 1).padStart(2, '0');
      const yyyy = rawDate.getFullYear();
      dateStr = `${dd}-${mm}-${yyyy}`;
    } else {
      dateStr = 'unknown-date';
    }
    const clientNameClean = editableReceiptData.shareholderName.trim().replace(/[/\\?%*:|"<>\s]+/g, '_');
    const filename = `${clientNameClean}_${dateStr}`;

    if (format === 'jpg') {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.98));
      if (!blob) return;
      const file = new File([blob], `${filename}.jpg`, { type: 'image/jpeg' });
      if (action === 'share') {
        if (navigator.canShare?.({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: `Receipt ${editableReceiptData.shareholderName} - ${dateStr}` });
            return;
          } catch (err) {
            console.error("Error sharing JPG:", err);
          }
        } else {
          notify.error('Sharing is not supported on this browser/device.');
          return;
        }
      }
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${filename}.jpg`;
      link.click();
      URL.revokeObjectURL(link.href);
      return;
    }

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const imageData = canvas.toDataURL('image/jpeg', 0.98);
    const imageWidth = 210;
    const imageHeight = (canvas.height / canvas.width) * imageWidth;
    pdf.addImage(imageData, 'JPEG', 0, 0, imageWidth, imageHeight);
    const blob = pdf.output('blob');
    const file = new File([blob], `${filename}.pdf`, { type: 'application/pdf' });
    if (action === 'share') {
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: `Receipt ${editableReceiptData.shareholderName} - ${dateStr}` });
          return;
        } catch (err) {
          console.error("Error sharing PDF:", err);
        }
      } else {
        notify.error('Sharing is not supported on this browser/device.');
        return;
      }
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}.pdf`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function printReceipt() {
    const cleanup = () => document.body.classList.remove('receipt-print-mode');
    document.body.classList.add('receipt-print-mode');
    window.addEventListener('afterprint', cleanup, { once: true });
    window.print();
    window.setTimeout(cleanup, 1000);
  }

  function submitDue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProjectId) return;
    if (!dueForm.name.trim() || !dueForm.phone.trim() || !dueForm.address.trim() || !dueForm.city.trim() || !dueForm.pincode.trim()) {
      notify.error('Client Name, Phone Number, Street Address, District/City, and Pincode are required.');
      return;
    }
    if (calculatedDueAmount < 0) {
      notify.error('Final client cost cannot be negative. Check area, rate, and round off.');
      return;
    }
    dueMutation.mutate({
      projectId: selectedProjectId,
      shareholderId: editingShareholderId,
      payload: {
        name: dueForm.name.trim(),
        company_name: dueForm.company_name.trim() || null,
        phone: dueForm.phone.trim(),
        address: dueForm.address.trim(),
        city: dueForm.city.trim(),
        pincode: dueForm.pincode.trim(),
        is_existing_shareholder: dueForm.is_existing_shareholder,
        existing_area: dueForm.existing_area,
        existing_uds: dueForm.existing_uds,
        free_cost_area: dueForm.free_cost_area,
        new_area: dueForm.new_area,
        new_uds: dueForm.new_uds,
        additional_sqft: calculatedAdditionalSqft,
        rate_per_sqft: clientRatePerSqft,
        round_off: Number(dueForm.round_off || 0),
        legal_charges: Number(dueForm.legal_charges || 0),
        due_amount: calculatedDueAmount,
      },
    });
  }

  function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canPaymentEntry) {
      notify.error('You do not have permission to create payments.');
      return;
    }
    if (!selectedProjectId || paymentForm.shareholder_id <= 0 || paymentForm.amount <= 0) {
      notify.error('Select a client and enter the payment amount.');
      return;
    }
    if (!paymentForm.purpose) {
      notify.error('Choose whether this payment is with GST, without GST, registration, or legal charges.');
      return;
    }
    const paymentMode = paymentForm.payment_mode === 'other' ? paymentForm.payment_mode_custom.trim() : paymentForm.payment_mode;
    const sealSuffix = paymentForm.seal_type === 'foundations' ? ' [Seal: KKR Foundations]' : ' [Seal: KKR Developers]';
    const finalNotes = `${(paymentForm.notes || '').trim()}${sealSuffix}`.trim();
    const backendPurpose = paymentForm.purpose === 'construction_gst'
      ? (editingPaymentId ? 'gst_invoice' : 'construction')
      : paymentForm.purpose;

    if (!editingPaymentId && paymentForm.purpose === 'construction_gst') {
      const client = selectedPaymentClient;
      const source = selectedPaymentSource;
      if (!client) {
        notify.error('Select a client for the GST invoice.');
        return;
      }
      if (paymentTotalWithGst <= 0) {
        notify.error('GST payment total must be greater than zero.');
        return;
      }
      const billPayload: BillInput = {
        project_id: selectedProjectId,
        shareholder_id: client.shareholder_id,
        bill_date: paymentForm.payment_date,
        due_date: paymentForm.payment_date,
        client_name: client.name,
        company_name: client.company_name || source?.company_name || null,
        billing_address: client.address || source?.address || null,
        billing_city: client.city || source?.city || null,
        billing_pincode: client.pincode || source?.pincode || null,
        seal_type: paymentForm.seal_type,
        subtotal: paymentTaxableAmount,
        cgst_amount: paymentCgstAmount,
        sgst_amount: paymentSgstAmount,
        tax_amount: paymentGstAmount,
        discount_amount: 0,
        total_amount: paymentTotalWithGst,
        gst_only: Boolean(paymentForm.gst_only),
        notes: finalNotes || `Construction payment with GST @ ${paymentGstPercent}%`,
        items: [{
          description: `Construction / development charges${finalNotes ? ` - ${finalNotes}` : ''}`,
          hsn_code: '995411',
          cgst_rate: paymentGstPercent / 2,
          sgst_rate: paymentGstPercent / 2,
          cgst_amount: paymentCgstAmount,
          sgst_amount: paymentSgstAmount,
          quantity: 1,
          rate: paymentTaxableAmount,
          amount: paymentTaxableAmount,
        }],
      };
      gstInvoicePaymentMutation.mutate({
        projectId: selectedProjectId,
        payload: billPayload,
        payment: {
          payment_date: paymentForm.payment_date,
          amount: paymentTotalWithGst,
          payment_mode: paymentMode || 'cash',
          notes: finalNotes || null,
        },
      });
      return;
    }

    paymentMutation.mutate({
      projectId: selectedProjectId,
      paymentId: editingPaymentId,
      payload: {
        shareholder_id: paymentForm.shareholder_id,
        payment_date: paymentForm.payment_date,
        amount: editingPaymentId && paymentForm.purpose === 'construction_gst' ? paymentTotalWithGst : paymentForm.amount,
        payment_mode: paymentMode || null,
        purpose: backendPurpose,
        notes: finalNotes || null,
      },
    });
  }

  function submitSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProjectId || scheduleForm.shareholder_id <= 0) return;
    const installments = scheduleForm.installments
      .map((item, index) => ({
        installment_no: index + 1,
        amount: Number(item.amount || 0),
        percentage: Number(item.percentage || 0),
        due_date: item.due_date,
        remarks: item.remarks?.trim() || null,
      }))
      .filter((item) => item.amount > 0 && item.due_date);
    if (installments.length !== scheduleForm.installments.length) {
      notify.error('Please enter amount and due date for every installment.');
      return;
    }
    scheduleMutation.mutate({
      projectId: selectedProjectId,
      shareholderId: scheduleForm.shareholder_id,
      installments,
    });
  }

  return (
      <div className="min-w-0 space-y-6">
      <h1 className="font-display text-3xl text-graphite">Clients - JV Redevelopment</h1>
      {!selectedProjectId ? (
        <SectionCard title="Project-wise Client Ledger">
          <DataTable
            auditTableName="projects"
            auditRecordIds={projects.map((item) => item.project_id)}
            auditRecordLabel="Project"
            size="roomy"
            printTitle="Project-wise Client Ledger"
            printMetadata={{
              Module: 'Clients - JV Redevelopment',
              Scope: 'All projects',
              Projects: projects.length,
            }}
            headers={['Project', 'Location', 'Client', 'Total Budget', 'Total Due', 'Total Paid', 'Balance', 'Action']}
            rows={projects.map((item) => {
              const projectObj = allProjects.find((p) => p.id === item.project_id);
              const totalBudget = Number(item.total_budget || projectObj?.total_amount || projectObj?.estimated_cost || 0);

              return [
                <span key="name" className="font-extrabold text-slate-900">{item.project_name}</span>,
                <span key="loc" className="font-medium text-slate-600">{item.location}</span>,
                <span key="client" className="font-bold text-slate-800">{item.client_name}</span>,
                <span key="budget" className="font-black text-indigo-950">{formatCurrency(totalBudget)}</span>,
                <span key="due" className="font-extrabold text-slate-900">{formatCurrency(item.total_due)}</span>,
                <span key="paid" className="font-extrabold text-emerald-600">{formatCurrency(item.total_paid)}</span>,
                <span key="balance" className={`font-extrabold ${item.total_balance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {formatCurrency(item.total_balance)}
                </span>,
                <button
                  key="action"
                  className="rounded-xl bg-graphite px-3.5 py-1.5 text-xs font-extrabold text-white shadow-xs transition hover:bg-black"
                  onClick={() => {
                    const slug = slugify(item.project_name);
                    navigate(`/clients/${item.project_id}/${slug}`);
                  }}
                >
                  Open
                </button>,
              ];
            })}
          />
        </SectionCard>
      ) : null}

      {selectedProjectId && !ledger ? (
        <SectionCard title={selectedProjectSummary?.project_name || 'JV Ledger'}>
          {ledgerError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
              {getApiErrorMessage(ledgerError, 'Unable to load the client JV ledger for this project.')}
            </div>
          ) : ledgerFetching ? (
            <TableSkeleton rows={6} columns={6} />
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-600">
              Select a project to load the client JV ledger.
            </div>
          )}
          <button
            type="button"
            className="mt-4 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400"
            onClick={() => {
              setSearchParams({});
              navigate('/clients');
            }}
          >
            Back to Projects
          </button>
        </SectionCard>
      ) : null}

      {selectedProjectId && ledger ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            {canAddEditClient ? (
              <button
                className="rounded-xl bg-graphite px-7 py-3.5 text-sm font-semibold text-white shadow-md transition hover:-translate-y-0.5 hover:bg-black"
                onClick={openNewDueForm}
              >
                Add New Client
              </button>
            ) : null}
            {canPaymentEntry ? (
              <button
                className="rounded-xl border border-graphite bg-white px-7 py-3.5 text-sm font-semibold text-graphite shadow-md transition hover:-translate-y-0.5 hover:bg-slate-50"
                onClick={togglePaymentForm}
              >
                Create Payment
              </button>
            ) : null}
            {canDueSchedule ? (
              <button
                className="inline-flex items-center gap-2 rounded-xl border border-indigo-300 bg-indigo-50 px-7 py-3.5 text-sm font-semibold text-indigo-700 shadow-md transition hover:-translate-y-0.5 hover:bg-indigo-100"
                onClick={() => openScheduleForm()}
              >
                <CalendarClock className="h-4 w-4" />
                Add Due Schedule
              </button>
            ) : null}
            {canGovernmentCharges ? (
              <button
                className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-7 py-3.5 text-sm font-semibold text-amber-800 shadow-md transition hover:-translate-y-0.5 hover:bg-amber-100"
                onClick={openGovernmentCharges}
              >
                <Landmark className="h-4 w-4" />
                Government Charges
              </button>
            ) : null}
            <button
              className="rounded-xl border border-slate-300 bg-white px-7 py-3.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-400"
              onClick={() => {
                setSearchParams({});
                navigate('/clients');
              }}
            >
              Back
            </button>
          </div>

          <ClientDrawer
            open={activePanel === 'due'}
            title={editingShareholderId ? 'Edit Client Details' : 'Add New Client'}
            subtitle={editingShareholderId ? 'Update JV client profile, area measurements, and rate calculation.' : 'Register a new JV client with area measurements and cost breakdown.'}
            icon={editingShareholderId ? <UserCheck className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
            onClose={closeActivePanel}
            footer={(
              <>
                <button
                  type="button"
                  className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                  onClick={closeActivePanel}
                  disabled={dueMutation.isPending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="client-due-form"
                  className="rounded-xl bg-graphite px-6 py-2.5 text-sm font-extrabold text-white shadow-md transition hover:bg-black disabled:opacity-50"
                  disabled={dueMutation.isPending}
                >
                  {dueMutation.isPending ? 'Saving…' : editingShareholderId ? 'Update Client' : 'Save Client'}
                </button>
              </>
            )}
          >
            <form id="client-due-form" className="space-y-5" onSubmit={submitDue}>
              {/* Profile Card */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-200/80 pb-2">
                  <User className="h-4 w-4 text-indigo-600" />
                  <span className="text-xs font-black uppercase tracking-wider text-slate-700">Client Profile</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <RequiredLabel label="Client Name" required filled={Boolean(dueForm.name.trim())} />
                    <input
                      value={dueForm.name}
                      onChange={(e) => setDueForm((c) => ({ ...c, name: e.target.value }))}
                      placeholder="Client / shareholder name"
                      required
                    />
                  </div>
                  <div>
                    <RequiredLabel label="Shareholder Type" required filled={Boolean(dueForm.is_existing_shareholder)} />
                    <select
                      value={dueForm.is_existing_shareholder ? 'existing' : 'kkr'}
                      onChange={(e) => {
                        const isExisting = e.target.value === 'existing';
                        const defaultLegal = Number(ledger?.government_charges?.new_legal_charges || 0);
                        setDueForm((c) => ({
                          ...c,
                          is_existing_shareholder: isExisting,
                          legal_charges: !isExisting && Number(c.legal_charges || 0) === 0
                            ? defaultLegal
                            : c.legal_charges,
                        }));
                      }}
                    >
                      <option value="existing">Existing Shareholder</option>
                      <option value="kkr">KKR Shareholder</option>
                    </select>
                  </div>
                  <div>
                    <RequiredLabel label="Phone Number" required filled={Boolean(dueForm.phone.trim())} />
                    <input
                      value={dueForm.phone}
                      onChange={(e) => setDueForm((c) => ({ ...c, phone: e.target.value }))}
                      placeholder="Phone number"
                      required
                    />
                  </div>
                  <div>
                    <RequiredLabel label="PAN No" filled={Boolean(dueForm.company_name.trim())} />
                    <input
                      value={dueForm.company_name}
                      onChange={(e) => setDueForm((c) => ({ ...c, company_name: e.target.value }))}
                      placeholder="PAN No (optional)"
                    />
                  </div>
                  <div className="sm:col-span-2 lg:col-span-1">
                    <RequiredLabel label="Billing Street Address" required filled={Boolean(dueForm.address.trim())} />
                    <input
                      value={dueForm.address}
                      onChange={(e) => setDueForm((c) => ({ ...c, address: e.target.value }))}
                      placeholder="Billing street address (required)"
                      required
                    />
                  </div>
                  <div>
                    <RequiredLabel label="Billing District / City" required filled={Boolean(dueForm.city.trim())} />
                    <input
                      value={dueForm.city}
                      onChange={(e) => setDueForm((c) => ({ ...c, city: e.target.value }))}
                      placeholder="Billing district or city (required)"
                      required
                    />
                  </div>
                  <div>
                    <RequiredLabel label="Billing Pincode" required filled={Boolean(dueForm.pincode.trim())} />
                    <input
                      value={dueForm.pincode}
                      onChange={(e) => setDueForm((c) => ({ ...c, pincode: e.target.value }))}
                      placeholder="Billing pincode e.g. 600061 (required)"
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Area Measurements Card */}
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4 space-y-4">
                <div className="flex items-center justify-between border-b border-indigo-100 pb-2">
                  <div className="flex items-center gap-2">
                    <Ruler className="h-4 w-4 text-indigo-600" />
                    <span className="text-xs font-black uppercase tracking-wider text-indigo-950">JV Area Measurements (Sq.ft)</span>
                  </div>
                  <span className="text-xs font-bold text-indigo-700 bg-indigo-100/80 px-2.5 py-0.5 rounded-full">
                    Addl: {formatMeasure(calculatedAdditionalSqft)} sq.ft
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <RequiredLabel label="Existing Area" filled={dueForm.existing_area > 0} />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={dueForm.existing_area || ''}
                      onChange={(e) => setDueForm((c) => ({ ...c, existing_area: Number(e.target.value || 0) }))}
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <RequiredLabel label="Existing UDS" filled={dueForm.existing_uds > 0} />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={dueForm.existing_uds || ''}
                      onChange={(e) => setDueForm((c) => ({ ...c, existing_uds: Number(e.target.value || 0) }))}
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <RequiredLabel label="Free Cost Area" filled={dueForm.free_cost_area > 0} />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={dueForm.free_cost_area || ''}
                      onChange={(e) => setDueForm((c) => ({ ...c, free_cost_area: Number(e.target.value || 0) }))}
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <RequiredLabel label="New Saleable Area" filled={dueForm.new_area > 0} />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={dueForm.new_area || ''}
                      onChange={(e) => setDueForm((c) => ({ ...c, new_area: Number(e.target.value || 0) }))}
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <RequiredLabel label="New UDS" filled={dueForm.new_uds > 0} />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={dueForm.new_uds || ''}
                      onChange={(e) => setDueForm((c) => ({ ...c, new_uds: Number(e.target.value || 0) }))}
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <RequiredLabel label="Additional Area (Sq.ft)" filled={calculatedAdditionalSqft > 0} />
                    <div className="rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm font-black text-indigo-950 shadow-xs">
                      {formatMeasure(calculatedAdditionalSqft)} sq.ft
                    </div>
                  </div>
                </div>
              </div>

              {/* Pricing Card */}
              <div className="rounded-2xl border border-emerald-200/90 bg-emerald-50/40 p-4 space-y-4">
                <div className="flex items-center justify-between border-b border-emerald-200/80 pb-2">
                  <div className="flex items-center gap-2">
                    <Coins className="h-4 w-4 text-emerald-700" />
                    <span className="text-xs font-black uppercase tracking-wider text-emerald-950">Pricing & Cost Calculation</span>
                  </div>
                  {projectRatePerSqft ? (
                    <span className="text-[11px] font-bold text-slate-600 bg-white px-2 py-0.5 rounded-md border border-slate-200">
                      Project Rate: {formatCurrency(projectRatePerSqft)}/sq.ft
                    </span>
                  ) : null}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <RequiredLabel label="Client Rate per Sq.ft" required filled={clientRatePerSqft > 0} />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={dueForm.rate_per_sqft || ''}
                      onChange={(e) => setDueForm((c) => ({ ...c, rate_per_sqft: Number(e.target.value || 0) }))}
                      placeholder={projectRatePerSqft ? String(projectRatePerSqft) : 'Rate per sq.ft'}
                      required
                    />
                  </div>
                  <div>
                    <RequiredLabel label="Calculated Subtotal" filled={calculatedClientSubtotal > 0} />
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-extrabold text-slate-800 shadow-xs">
                      {calculatedClientSubtotal ? formatCurrency(calculatedClientSubtotal) : '₹0'}
                    </div>
                  </div>
                  <div>
                    <RequiredLabel label="Round Off (+/-)" filled={Number(dueForm.round_off || 0) !== 0} />
                    <input
                      type="number"
                      step="0.01"
                      value={dueForm.round_off === 0 ? '' : dueForm.round_off}
                      onChange={(e) => setDueForm((c) => ({ ...c, round_off: Number(e.target.value || 0) }))}
                      placeholder="e.g. -500 or +1000"
                    />
                  </div>
                  <div>
                    <RequiredLabel label="Final Amount to Pay" required filled={calculatedDueAmount > 0} />
                    <div className="rounded-xl border border-emerald-300 bg-emerald-100/80 px-3 py-2 text-base font-black text-emerald-950 shadow-xs">
                      {calculatedDueAmount ? formatCurrency(calculatedDueAmount) : '₹0'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-violet-200 bg-violet-50/40 p-4 space-y-4">
                <div className="flex items-center gap-2 border-b border-violet-200/80 pb-2">
                  <Scale className="h-4 w-4 text-violet-700" />
                  <span className="text-xs font-black uppercase tracking-wider text-violet-950">Legal Charges</span>
                </div>
                <p className="text-xs font-semibold text-violet-800">
                  {dueForm.is_existing_shareholder
                    ? 'Collected per client. Shown in the ledger as Legal — to pay, paid, and balance.'
                    : `New-client default from Government Charges is ${formatCurrency(Number(ledger?.government_charges?.new_legal_charges || 0))}. You can change it for this client.`}
                </p>
                <div>
                  <RequiredLabel label="Legal Charges Amount" filled={dueForm.legal_charges > 0} />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={dueForm.legal_charges || ''}
                    onChange={(e) => setDueForm((c) => ({ ...c, legal_charges: Number(e.target.value || 0) }))}
                    placeholder="0.00"
                  />
                </div>
              </div>
            </form>
          </ClientDrawer>

          <ClientDrawer
            open={activePanel === 'govt' && canGovernmentCharges}
            title="Government Charges Details"
            subtitle="These rates apply to every client in this project. GST and registration to-pay amounts update immediately."
            icon={<Landmark className="h-5 w-5" />}
            onClose={closeActivePanel}
            footer={(
              <>
                <button
                  type="button"
                  className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                  onClick={closeActivePanel}
                  disabled={governmentChargesMutation.isPending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="govt-charges-form"
                  className="rounded-xl bg-graphite px-6 py-2.5 text-sm font-extrabold text-white shadow-md transition hover:bg-black disabled:opacity-50"
                  disabled={governmentChargesMutation.isPending}
                >
                  {governmentChargesMutation.isPending ? 'Saving…' : 'Save Government Charges'}
                </button>
              </>
            )}
          >
            <form id="govt-charges-form" className="space-y-5" onSubmit={submitGovernmentCharges}>
              <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 text-xs font-semibold leading-relaxed text-amber-950">
                <p>Existing clients: GST = Composite × Land factor × New saleable area × GST%. Registration = Construction cost × New saleable area × Registration %.</p>
                <p className="mt-1">New clients: GST and registration are a simple % of that client’s total amount to pay.</p>
                <p className="mt-2 text-amber-800">GST paid is taken from GST invoices.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <RequiredLabel label="Composite Value (per sqft)" filled={Number(govtForm.composite_value_per_sqft) > 0} />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={govtForm.composite_value_per_sqft || ''}
                    onChange={(e) => setGovtForm((c) => ({ ...c, composite_value_per_sqft: Number(e.target.value || 0) }))}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <RequiredLabel label="Land Factor (default 1)" filled={Number(govtForm.land_factor) !== 1} />
                  <input
                    type="number"
                    min="0"
                    max="2"
                    step="0.01"
                    value={govtForm.land_factor}
                    onChange={(e) => setGovtForm((c) => ({ ...c, land_factor: Number(e.target.value || 0) }))}
                    placeholder="1.00"
                  />
                  <p className="mt-1 text-[11px] font-semibold text-slate-500">Decimal from 0 to 2. Typical value is 0.67.</p>
                </div>
                <div className="sm:col-span-2">
                  <RequiredLabel label="Construction Cost (per sqft)" filled={Number(govtForm.construction_cost_per_sqft) > 0} />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={govtForm.construction_cost_per_sqft || ''}
                    onChange={(e) => setGovtForm((c) => ({ ...c, construction_cost_per_sqft: Number(e.target.value || 0) }))}
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                <p className="text-xs font-black uppercase tracking-wider text-slate-700">Existing clients</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <RequiredLabel label="GST %" filled={Number(govtForm.gst_percent) > 0} />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={govtForm.gst_percent}
                      onChange={(e) => setGovtForm((c) => ({ ...c, gst_percent: Number(e.target.value || 0) }))}
                      placeholder="5"
                    />
                  </div>
                  <div>
                    <RequiredLabel label="Registration Value %" filled={Number(govtForm.registration_value_percent) > 0} />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={govtForm.registration_value_percent}
                      onChange={(e) => setGovtForm((c) => ({ ...c, registration_value_percent: Number(e.target.value || 0) }))}
                      placeholder="4"
                    />
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4 space-y-3">
                <p className="text-xs font-black uppercase tracking-wider text-indigo-900">New clients</p>
                <p className="text-[11px] font-semibold text-indigo-800">
                  Charged on the client’s total amount to pay. GST default 5%. Registration: 6% up to ₹50 lakhs, 7% up to ₹3 crores, 9% above that. Percentages can be edited.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <RequiredLabel label="GST %" filled={Number(govtForm.new_gst_percent) > 0} />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={govtForm.new_gst_percent ?? 5}
                      onChange={(e) => setGovtForm((c) => ({ ...c, new_gst_percent: Number(e.target.value || 0) }))}
                    />
                  </div>
                  <div>
                    <RequiredLabel label="Registration % up to ₹50 lakhs" filled={Number(govtForm.new_reg_upto_50l_percent) > 0} />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={govtForm.new_reg_upto_50l_percent ?? 6}
                      onChange={(e) => setGovtForm((c) => ({ ...c, new_reg_upto_50l_percent: Number(e.target.value || 0) }))}
                    />
                  </div>
                  <div>
                    <RequiredLabel label="Registration % up to ₹3 crores" filled={Number(govtForm.new_reg_upto_3cr_percent) > 0} />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={govtForm.new_reg_upto_3cr_percent ?? 7}
                      onChange={(e) => setGovtForm((c) => ({ ...c, new_reg_upto_3cr_percent: Number(e.target.value || 0) }))}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <RequiredLabel label="Registration % above ₹3 crores" filled={Number(govtForm.new_reg_above_3cr_percent) > 0} />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={govtForm.new_reg_above_3cr_percent ?? 9}
                      onChange={(e) => setGovtForm((c) => ({ ...c, new_reg_above_3cr_percent: Number(e.target.value || 0) }))}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <RequiredLabel label="Default legal charges (₹)" filled={Number(govtForm.new_legal_charges) > 0} />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={govtForm.new_legal_charges || ''}
                      onChange={(e) => setGovtForm((c) => ({ ...c, new_legal_charges: Number(e.target.value || 0) }))}
                      placeholder="0.00"
                    />
                    <p className="mt-1 text-[11px] font-semibold text-indigo-700">Filled when adding a new (KKR) client. You can still change it on that client.</p>
                  </div>
                </div>
              </div>
              {ledger?.shareholders.length ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-3.5 sm:p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-black uppercase tracking-wider text-slate-500">
                      Preview using existing-client area formula and new-client amount to pay
                    </p>
                    <span className="text-[11px] font-bold text-slate-400">
                      {ledger.shareholders.length} client{ledger.shareholders.length === 1 ? '' : 's'}
                    </span>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
                    <table className="min-w-full divide-y divide-slate-200 text-xs">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider">Client</th>
                          <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider">Type</th>
                          <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wider">Base</th>
                          <th className="px-3 py-2 text-right text-[11px] font-black uppercase tracking-wider text-indigo-900 bg-indigo-50/50">GST</th>
                          <th className="px-3 py-2 text-right text-[11px] font-black uppercase tracking-wider text-amber-900 bg-amber-50/50">Registration</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {ledger.shareholders.map((item) => {
                          const area = Number(item.new_area || 0);
                          const payable = Number(item.due_amount || 0);
                          const isExisting = Boolean(item.is_existing_shareholder);
                          const gst = gstPayableForClient(govtForm, isExisting, area, payable);
                          const registration = registrationPayableForClient(govtForm, isExisting, area, payable);
                          const gstPct = gstPercentForClient(govtForm, isExisting);
                          const registrationPct = registrationPercentForClient(govtForm, isExisting, payable);
                          return (
                            <tr key={item.shareholder_id} className="transition-colors hover:bg-slate-50/80">
                              <td className="px-3 py-2 font-bold text-slate-800">
                                {item.name}
                              </td>
                              <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                                {isExisting ? 'Existing' : 'New'}
                                <span className="mt-0.5 block text-[10px] font-semibold text-slate-500">
                                  GST {gstPct}% · Reg {registrationPct}%
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right font-semibold text-slate-600 whitespace-nowrap">
                                {isExisting ? `${formatMeasure(area)} sq.ft` : formatCurrency(payable)}
                              </td>
                              <td className="px-3 py-2 text-right font-bold text-indigo-800 whitespace-nowrap bg-indigo-50/20">
                                {formatCurrency(gst)}
                              </td>
                              <td className="px-3 py-2 text-right font-bold text-amber-800 whitespace-nowrap bg-amber-50/20">
                                {formatCurrency(registration)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {(() => {
                        const totalGst = ledger.shareholders.reduce((sum, item) => {
                          return sum + gstPayableForClient(govtForm, Boolean(item.is_existing_shareholder), Number(item.new_area || 0), Number(item.due_amount || 0));
                        }, 0);
                        const totalRegistration = ledger.shareholders.reduce((sum, item) => {
                          return sum + registrationPayableForClient(govtForm, Boolean(item.is_existing_shareholder), Number(item.new_area || 0), Number(item.due_amount || 0));
                        }, 0);
                        return (
                          <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-black text-slate-900">
                            <tr>
                              <td className="px-3 py-2 text-left text-[11px] font-black uppercase text-slate-800" colSpan={3}>Total</td>
                              <td className="px-3 py-2 text-right font-black text-indigo-950 whitespace-nowrap bg-indigo-50/60">{formatCurrency(totalGst)}</td>
                              <td className="px-3 py-2 text-right font-black text-amber-950 whitespace-nowrap bg-amber-50/60">{formatCurrency(totalRegistration)}</td>
                            </tr>
                          </tfoot>
                        );
                      })()}
                    </table>
                  </div>
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-sm font-semibold text-slate-500">Add clients first to preview GST and registration per saleable area.</p>
              )}
            </form>
          </ClientDrawer>

          <ClientDrawer
            open={activePanel === 'payment'}
            title={editingPaymentId ? 'Edit Payment' : 'Create Payment'}
            subtitle={editingPaymentId ? 'Update this payment. GST invoices already created stay in the GST Invoices tab.' : 'Choose the client and payment type. With GST creates an invoice; other types go to payment history with a receipt.'}
            icon={<Wallet className="h-5 w-5" />}
            onClose={closeActivePanel}
            footer={(
              <>
                <button
                  type="button"
                  className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                  onClick={closeActivePanel}
                  disabled={paymentMutation.isPending || gstInvoicePaymentMutation.isPending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="client-payment-form"
                  className="rounded-xl bg-graphite px-6 py-2.5 text-sm font-extrabold text-white shadow-md transition hover:bg-black disabled:opacity-50"
                  disabled={paymentMutation.isPending || gstInvoicePaymentMutation.isPending}
                >
                  {paymentMutation.isPending || gstInvoicePaymentMutation.isPending
                    ? 'Saving…'
                    : editingPaymentId
                      ? 'Update Payment'
                      : paymentForm.purpose === 'construction_gst'
                        ? 'Create GST Invoice & Payment'
                        : 'Save Payment'}
                </button>
              </>
            )}
          >
            <form id="client-payment-form" className="space-y-4" onSubmit={submitPayment}>
              <div>
                <RequiredLabel label="Which client?" required filled={paymentForm.shareholder_id > 0} />
                <SearchableCreatableSelect
                  options={ledger ? ledger.shareholders.map((item) => ({
                    id: item.shareholder_id,
                    name: item.name,
                    subtext: `Construction bal ${formatCurrency(item.balance_amount)} · GST ${formatCurrency(Number(item.gst_balance || 0))}`,
                  })) : []}
                  value={paymentForm.shareholder_id}
                  onChange={(val) => {
                    const selectedId = Number(val) || 0;
                    const selected = ledger?.shareholders.find((item) => item.shareholder_id === selectedId) || null;
                    setSelectedPaymentScheduleId(null);
                    setPaymentForm((c) => ({
                      ...c,
                      shareholder_id: selectedId,
                      amount: suggestedPaymentAmount(c.purpose, selected),
                      notes: '',
                    }));
                  }}
                  placeholder="Search client by name..."
                  allowCreate={false}
                />
              </div>
              <div>
                <RequiredLabel label="Payment type" required filled={Boolean(paymentForm.purpose)} />
                <div className="grid gap-2 sm:grid-cols-2">
                  {paymentKindOptions
                    .filter((option) => option.id !== 'construction_gst' || canGstBilling || paymentForm.purpose === 'construction_gst')
                    .map((option) => {
                    const selected = paymentForm.purpose === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        disabled={Boolean(editingPaymentId)}
                        className={`rounded-xl border p-3 text-left transition ${selected ? 'border-graphite bg-slate-900 text-white shadow-sm' : 'border-slate-200 bg-white hover:border-slate-400'} disabled:cursor-not-allowed disabled:opacity-60`}
                        onClick={() => {
                          const selectedClient = ledger?.shareholders.find((item) => item.shareholder_id === paymentForm.shareholder_id) || null;
                          setSelectedPaymentScheduleId(null);
                          setPaymentForm((c) => ({
                            ...c,
                            purpose: option.id,
                            gst_only: option.id === 'construction_gst' ? c.gst_only : false,
                            amount: suggestedPaymentAmount(option.id, selectedClient),
                          }));
                        }}
                      >
                        <p className="text-sm font-black">{option.name}</p>
                        <p className={`mt-1 text-[11px] font-semibold ${selected ? 'text-slate-200' : 'text-slate-500'}`}>{option.hint}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
              {selectedPaymentClient ? (
                <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-600 sm:grid-cols-4">
                  <span>Construction bal {formatCurrency(selectedPaymentClient.balance_amount)}</span>
                  <span>GST bal {formatCurrency(Number(selectedPaymentClient.gst_balance || 0))}</span>
                  <span>Registration bal {formatCurrency(Number(selectedPaymentClient.registration_balance || 0))}</span>
                  <span>Legal bal {formatCurrency(Number(selectedPaymentClient.legal_balance || 0))}</span>
                </div>
              ) : null}
              {paymentForm.shareholder_id > 0 && (paymentForm.purpose === 'construction' || paymentForm.purpose === 'construction_gst') ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-bold text-slate-800">Pending installment dues</p>
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
                      {pendingSchedulesForPayment.length} due{pendingSchedulesForPayment.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {pendingSchedulesForPayment.length ? (
                    <div className="grid gap-2 md:grid-cols-2">
                      {pendingSchedulesForPayment.map((item) => {
                        const selected = selectedPaymentScheduleId === item.id;
                        const overdue = item.days_overdue > 0;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            className={`rounded-lg border p-3 text-left transition ${selected ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-100' : overdue ? 'border-rose-200 bg-rose-50 hover:border-rose-300' : 'border-slate-200 bg-white hover:border-indigo-300'}`}
                            onClick={() => selectScheduleForPayment(item)}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="text-sm font-black text-slate-900">Installment #{item.installment_no}</p>
                                <p className="mt-1 text-xs font-semibold text-slate-600">Due: {formatDate(item.due_date)}</p>
                              </div>
                              <span className={`rounded-full px-2 py-1 text-xs font-bold ${overdue ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                                {overdue ? `${item.days_overdue}d overdue` : 'unpaid'}
                              </span>
                            </div>
                            <p className="mt-2 text-base font-black text-graphite">{formatCurrency(item.balance_amount)}</p>
                            {item.remarks ? <p className="mt-1 text-xs text-slate-500">{item.remarks}</p> : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="rounded-lg border border-dashed border-slate-300 bg-white p-3 text-sm font-semibold text-slate-500">
                      No pending dues for this client.
                    </p>
                  )}
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <RequiredLabel label="Payment Date" required filled={Boolean(paymentForm.payment_date)} />
                  <input type="date" value={paymentForm.payment_date} onChange={(e) => setPaymentForm((c) => ({ ...c, payment_date: e.target.value }))} required />
                </div>
                <div>
                  <RequiredLabel label="Mode of Payment" filled={Boolean(paymentForm.payment_mode)} />
                  <SearchableCreatableSelect
                    options={paymentModeSelectOptions}
                    value={paymentForm.payment_mode}
                    onChange={(val) =>
                      setPaymentForm((c) => ({
                        ...c,
                        payment_mode: String(val),
                      }))
                    }
                    placeholder="Search or type payment mode..."
                    createLabelPrefix="Use mode"
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <RequiredLabel
                    label={paymentForm.purpose === 'construction_gst'
                      ? 'Taxable amount'
                      : paymentForm.purpose === 'registration'
                        ? 'Registration amount'
                        : paymentForm.purpose === 'legal'
                          ? 'Legal charges amount'
                          : 'Amount paid'}
                    required
                    filled={paymentForm.amount > 0}
                  />
                  <input type="number" min="0" step="0.01" value={paymentForm.amount || ''} onChange={(e) => setPaymentForm((c) => ({ ...c, amount: Number(e.target.value || 0) }))} required />
                </div>
                <div>
                  <RequiredLabel label="Bill / receipt seal" filled={Boolean(paymentForm.seal_type)} />
                  <select
                    value={paymentForm.seal_type}
                    onChange={(e) => setPaymentForm((c) => ({ ...c, seal_type: e.target.value }))}
                  >
                    <option value="developers">KKR Developers</option>
                    <option value="foundations">KKR Foundations</option>
                  </select>
                </div>
              </div>
              {paymentForm.purpose === 'construction_gst' ? (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 text-sm">
                  <div className="mb-2 flex items-center gap-2 text-indigo-900">
                    <FileText className="h-4 w-4" />
                    <span className="text-xs font-black uppercase tracking-wider">GST invoice preview</span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-4">
                    <div>
                      <p className="text-[11px] font-semibold text-indigo-700">GST %</p>
                      <p className="font-black text-indigo-950">{paymentGstPercent}%</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-indigo-700">CGST / SGST</p>
                      <p className="font-black text-indigo-950">{formatCurrency(paymentCgstAmount)} + {formatCurrency(paymentSgstAmount)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-indigo-700">GST amount</p>
                      <p className="font-black text-indigo-950">{formatCurrency(paymentGstAmount)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-indigo-700">Total collected</p>
                      <p className="font-black text-indigo-950">{formatCurrency(paymentTotalWithGst)}</p>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] font-semibold text-indigo-800">
                    {paymentForm.gst_only
                      ? 'GST amount reduces GST balance only. Construction / taxable balance is left unchanged.'
                      : 'Taxable amount reduces construction balance. GST amount reduces GST balance. A paid invoice is added to GST Invoices.'}
                  </p>
                  {canGstBilling ? (
                  <label className="mt-3 flex items-start gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-semibold text-indigo-950">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={Boolean(paymentForm.gst_only)}
                      onChange={(e) => setPaymentForm((c) => ({ ...c, gst_only: e.target.checked }))}
                    />
                    <span>
                      Count this payment toward GST only
                      <span className="mt-0.5 block text-[11px] font-semibold text-indigo-700">
                        Use this when construction was already collected without GST. The invoice still shows taxable value, but it will not reduce construction to-pay.
                      </span>
                    </span>
                  </label>
                  ) : null}
                </div>
              ) : null}
              <div>
                <RequiredLabel label="Notes" filled={Boolean((paymentForm.notes || '').trim())} />
                <input value={paymentForm.notes} onChange={(e) => setPaymentForm((c) => ({ ...c, notes: e.target.value }))} placeholder="Payment remarks / notes" />
              </div>
            </form>
          </ClientDrawer>

          <ClientDrawer
            open={activePanel === 'schedule'}
            title="Create Payment Dues Schedule"
            subtitle="Break down client amount to pay into customized installment dues."
            icon={<CalendarClock className="h-5 w-5" />}
            onClose={closeActivePanel}
            footer={(
              <>
                {scheduleForm.shareholder_id > 0 && ledger.payment_schedules.some((item) => item.shareholder_id === scheduleForm.shareholder_id) ? (
                  <button
                    type="button"
                    className="rounded-xl border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-bold text-red-700 transition hover:bg-red-100 mr-auto"
                    onClick={() => {
                      if (!confirm('Delete all payment dues for this client?')) return;
                      deleteScheduleMutation.mutate(scheduleForm.shareholder_id);
                    }}
                  >
                    Delete Schedule
                  </button>
                ) : null}
                <button
                  type="button"
                  className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                  onClick={closeActivePanel}
                  disabled={scheduleMutation.isPending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="client-schedule-form"
                  className="rounded-xl bg-graphite px-6 py-2.5 text-sm font-extrabold text-white shadow-md transition hover:bg-black disabled:opacity-50"
                  disabled={scheduleMutation.isPending}
                >
                  {scheduleMutation.isPending ? 'Saving…' : 'Save Payment Dues'}
                </button>
              </>
            )}
          >
            <form id="client-schedule-form" className="space-y-4" onSubmit={submitSchedule}>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_220px]">
                <div>
                  <RequiredLabel label="Select Client" required filled={scheduleForm.shareholder_id > 0} />
                  <select
                    value={scheduleForm.shareholder_id}
                    onChange={(event) => updateScheduleShareholder(Number(event.target.value))}
                    required
                  >
                    <option value={0}>Select client</option>
                    {ledger.shareholders.map((item) => (
                      <option key={item.shareholder_id} value={item.shareholder_id}>
                        {item.name} - Amount to Pay {formatCurrency(item.due_amount)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <RequiredLabel label="No. of Installments" required filled={scheduleForm.installment_count > 0} />
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={scheduleForm.installment_count || ''}
                    onChange={(event) => updateInstallmentCount(Number(event.target.value || 1))}
                    required
                  />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-semibold text-slate-700">
                    Client Amount to Pay: {formatCurrency(selectedScheduleShareholder?.due_amount || 0)}
                  </span>
                  <span className="font-semibold text-slate-700">
                    Schedule Total: {formatCurrency(scheduleTotals.amount)} / {scheduleTotals.percentage.toFixed(2)}%
                  </span>
                </div>
                <div className="overflow-auto rounded-lg border border-slate-200 bg-white">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr>
                        <th className="px-3 py-2 text-left">Installment</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                        <th className="px-3 py-2 text-right">Percentage</th>
                        <th className="px-3 py-2 text-left">Due Date</th>
                        <th className="px-3 py-2 text-left">Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scheduleForm.installments.map((row, index) => (
                        <tr key={row.installment_no} className="border-t border-slate-100">
                          <td className="px-3 py-2 font-semibold text-slate-700">#{index + 1}</td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              className="text-right"
                              value={row.amount || ''}
                              onChange={(event) => updateInstallment(index, { amount: Number(event.target.value || 0) })}
                              required
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              className="text-right"
                              value={row.percentage || ''}
                              onChange={(event) => updateInstallment(index, { percentage: Number(event.target.value || 0) })}
                              required
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="date"
                              value={row.due_date}
                              onChange={(event) => updateInstallment(index, { due_date: event.target.value })}
                              required
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              value={row.remarks || ''}
                              onChange={(event) => updateInstallment(index, { remarks: event.target.value })}
                              placeholder="Remarks"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </form>
          </ClientDrawer>

          <SectionCard title={`JV Ledger - ${ledger.project_name}`}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2 text-sm">
                <span className="rounded-lg bg-slate-100 px-2 py-1 font-semibold">Construction due {formatCurrency(ledger.total_due)}</span>
                <span className="rounded-lg bg-emerald-50 px-2 py-1 font-semibold">Paid {formatCurrency(ledger.total_paid)}</span>
                <span className="rounded-lg bg-rose-50 px-2 py-1 font-semibold">Balance {formatCurrency(ledger.total_balance)}</span>
                <span className="rounded-lg bg-indigo-50 px-2 py-1 font-semibold">GST bal {formatCurrency(Number(ledger.total_gst_balance || 0))}</span>
                <span className="rounded-lg bg-amber-50 px-2 py-1 font-semibold">Reg bal {formatCurrency(Number(ledger.total_registration_balance || 0))}</span>
                <span className="rounded-lg bg-violet-50 px-2 py-1 font-semibold">Legal bal {formatCurrency(Number(ledger.total_legal_balance || 0))}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="rounded-xl border border-graphite bg-white px-4 py-2 text-xs font-bold text-graphite shadow-sm transition hover:bg-slate-50"
                  onClick={() => setShowDevelopmentDetails((current) => !current)}
                >
                  {showDevelopmentDetails ? 'Hide More Details' : 'View More Details'}
                </button>
              </div>
            </div>

            {ledger.shareholders.length ? (
              <div
                className="overflow-x-auto rounded-xl border border-slate-200"
                onScroll={() => setRowMenu(null)}
              >
                <p className="border-b border-slate-100 bg-white px-4 py-2 text-[11px] font-semibold text-slate-500">
                  Each money card shows <span className="text-slate-700">to pay</span>, <span className="text-emerald-700">paid</span>, and <span className="text-rose-600">balance</span>. Construction paid includes GST-invoice taxable collections. GST paid comes from GST invoices.
                </p>
                <div
                  className={showDevelopmentDetails
                    ? 'grid min-w-[2040px] gap-x-2 bg-slate-100 px-3 py-3 text-xs font-bold leading-tight text-slate-700'
                    : 'grid min-w-[1420px] gap-x-2 bg-slate-100 px-4 py-3 text-sm font-bold text-slate-700'}
                  style={{
                    gridTemplateColumns: showDevelopmentDetails
                      ? 'minmax(160px,1fr) 64px 60px 80px 72px 88px 90px 72px 90px 96px 100px 88px minmax(128px,1fr) minmax(128px,1fr) minmax(128px,1fr) minmax(128px,1fr) 80px 52px'
                      : 'minmax(180px,1.2fr) 72px 70px 90px 90px 100px minmax(132px,1fr) minmax(132px,1fr) minmax(132px,1fr) minmax(132px,1fr) 88px 52px',
                  }}
                >
                  <span>Client</span>
                  <span>Type</span>
                  <span className="text-right">Pay %</span>
                  {showDevelopmentDetails ? (
                    <>
                      <span className="text-right">Existing Area</span>
                      <span className="text-right">Existing UDS</span>
                      <span className="text-right">Free Cost Area</span>
                      <span className="text-right">New Saleable Area</span>
                      <span className="text-right">New UDS</span>
                      <span className="text-right">Addl. Area (sq.ft)</span>
                      <span className="text-right">Client Rate</span>
                      <span className="text-right">Subtotal</span>
                      <span className="text-right">Round Off</span>
                    </>
                  ) : (
                    <>
                      <span className="text-right">New Saleable Area</span>
                      <span className="text-right">Addl. Area (sq.ft)</span>
                      <span className="text-right">Client Rate</span>
                    </>
                  )}
                  <span>Construction</span>
                  <span>GST</span>
                  <span>Registration</span>
                  <span>Legal</span>
                  <span className="text-center">Status</span>
                  <span className="text-center" />
                </div>
                <div className="divide-y divide-slate-100 bg-white">
                  {ledger.shareholders.map((shareholder, index) => {
                    const group = dueScheduleGroups.find((item) => item.shareholder.shareholder_id === shareholder.shareholder_id);
                    const schedules = group?.schedules || [];
                    const shareholderPayments = ledger.payments
                      .filter((item) => item.shareholder_id === shareholder.shareholder_id)
                      .slice()
                      .sort((left, right) => new Date(right.payment_date).getTime() - new Date(left.payment_date).getTime());
                    const shareholderSource = projectShareholders.find((item) => item.id === shareholder.shareholder_id) || null;
                    const hasOverdue = schedules.some((item) => item.days_overdue > 0 && Number(item.balance_amount || 0) > 0);
                    const ledgerStatus = Number(shareholder.balance_amount || 0) <= 0 ? 'paid' : hasOverdue ? 'overdue' : 'unpaid';
                    const duePercent = duePercentages[index] ?? shareholder.due_percentage;
                    const expanded = expandedDueGroups[shareholder.shareholder_id] ?? false;
                    return (
                      <div
                        key={shareholder.shareholder_id}
                        className={`relative ${ledgerStatus === 'overdue' ? 'bg-rose-50/70' : ledgerStatus === 'paid' ? 'bg-emerald-50/60' : 'bg-white'}`}
                        onMouseEnter={() => showAudit(clientAuditActors[`project_shareholders:${shareholder.shareholder_id}`] || null, 'Client')}
                        onMouseLeave={hideAudit}
                      >
                        <div
                          className={showDevelopmentDetails
                            ? 'grid min-w-[2040px] items-center gap-x-2 px-3 py-3 text-left transition hover:bg-slate-50/70'
                            : 'grid min-w-[1420px] items-center gap-x-2 px-4 py-3 text-left transition hover:bg-slate-50/70'}
                          style={{
                            gridTemplateColumns: showDevelopmentDetails
                              ? 'minmax(160px,1fr) 64px 60px 80px 72px 88px 90px 72px 90px 96px 100px 88px minmax(128px,1fr) minmax(128px,1fr) minmax(128px,1fr) minmax(128px,1fr) 80px 52px'
                              : 'minmax(180px,1.2fr) 72px 70px 90px 90px 100px minmax(132px,1fr) minmax(132px,1fr) minmax(132px,1fr) minmax(132px,1fr) 88px 52px',
                          }}
                        >
                          <button
                            type="button"
                            className="flex min-w-0 items-center gap-2 text-left"
                            onClick={() => setExpandedDueGroups((current) => ({ ...current, [shareholder.shareholder_id]: !expanded }))}
                          >
                            {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />}
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-black text-slate-900">{shareholder.name}</span>
                              <span className="block truncate text-xs font-semibold text-slate-500">
                                {shareholder.company_name || (schedules.length ? `${schedules.length} due schedule item${schedules.length !== 1 ? 's' : ''}` : 'No due schedule')}
                              </span>
                            </span>
                          </button>
                          <span className="text-sm font-semibold text-slate-700">{shareholder.is_existing_shareholder ? 'Existing' : 'KKR'}</span>
                          <span className="text-right text-sm font-bold text-slate-800">{duePercent.toFixed(2)}%</span>
                          {showDevelopmentDetails ? (
                            <>
                              <span className="text-right text-sm font-semibold text-slate-700">{formatMeasure(shareholder.existing_area)}</span>
                              <span className="text-right text-sm font-semibold text-slate-700">{formatMeasure(shareholder.existing_uds)}</span>
                              <span className="text-right text-sm font-semibold text-slate-700">{formatMeasure(shareholder.free_cost_area)}</span>
                              <span className="text-right text-sm font-semibold text-slate-700">{formatMeasure(shareholder.new_area)}</span>
                              <span className="text-right text-sm font-semibold text-slate-700">{formatMeasure(shareholder.new_uds)}</span>
                              <span className="text-right text-sm font-semibold text-slate-700">{formatMeasure(shareholder.additional_sqft)}</span>
                              <span className="text-right text-sm font-semibold text-slate-700">
                                {shareholder.rate_per_sqft ? formatCurrency(shareholder.rate_per_sqft) : '-'}
                              </span>
                              <span className="text-right text-sm font-semibold text-slate-700">
                                {formatCurrency(Number(shareholder.client_subtotal || (shareholder.additional_sqft * shareholder.rate_per_sqft) || 0))}
                              </span>
                              <span className={`text-right text-sm font-bold ${Number(shareholder.round_off || 0) < 0 ? 'text-rose-700' : Number(shareholder.round_off || 0) > 0 ? 'text-emerald-700' : 'text-slate-700'}`}>
                                {formatCurrency(Number(shareholder.round_off || 0))}
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="text-right text-sm font-extrabold text-slate-900">{formatMeasure(shareholder.new_area)}</span>
                              <span className="text-right text-sm font-semibold text-slate-700">{formatMeasure(shareholder.additional_sqft)}</span>
                              <span className="text-right text-sm font-semibold text-slate-700">
                                {shareholder.rate_per_sqft ? formatCurrency(shareholder.rate_per_sqft) : '-'}
                              </span>
                            </>
                          )}
                          <ChargeStack
                            title="Construction"
                            payable={shareholder.due_amount}
                            paid={shareholder.paid_amount}
                            balance={shareholder.balance_amount}
                            tone="slate"
                            formula="To pay is client final cost. Paid includes payment entries plus taxable value collected on GST invoices."
                          />
                          <ChargeStack
                            title="GST"
                            payable={Number(shareholder.gst_payable || 0)}
                            paid={Number(shareholder.gst_paid || 0)}
                            balance={Number(shareholder.gst_balance || 0)}
                            tone="indigo"
                            formula="Composite value × land factor × new saleable area × GST%. Paid from GST invoices."
                          />
                          <ChargeStack
                            title="Registration"
                            payable={Number(shareholder.registration_payable || 0)}
                            paid={Number(shareholder.registration_paid || 0)}
                            balance={Number(shareholder.registration_balance || 0)}
                            tone="amber"
                            formula="Construction cost × new saleable area × registration value %."
                          />
                          <ChargeStack
                            title="Legal"
                            payable={Number(shareholder.legal_payable || 0)}
                            paid={Number(shareholder.legal_paid || 0)}
                            balance={Number(shareholder.legal_balance || 0)}
                            tone="violet"
                            formula="Legal charges entered when adding the client. Record payments with Payment Towards = Legal charges."
                          />
                          <span className="text-center">
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-bold ${scheduleStatusClasses(ledgerStatus)}`}>
                              {ledgerStatus === 'paid' ? <CheckCircle2 className="h-3.5 w-3.5" /> : ledgerStatus === 'overdue' ? <AlertTriangle className="h-3.5 w-3.5" /> : null}
                              {ledgerStatus}
                            </span>
                          </span>
                          <span className="flex justify-center">
                            <button
                              type="button"
                              className={`flex h-8 w-8 items-center justify-center rounded-lg border text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 ${rowMenu?.shareholderId === shareholder.shareholder_id ? 'border-slate-400 bg-slate-100 text-slate-800' : 'border-slate-200 bg-white'}`}
                              onClick={(event) => toggleRowMenu(event, shareholder.shareholder_id)}
                              aria-label={`Actions for ${shareholder.name}`}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>
                          </span>
                        </div>
                        {expanded ? (
                          <div className="border-t border-slate-200 bg-white/80 px-4 py-3">
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Due Schedule For {shareholder.name}</p>
                              <div className="flex flex-wrap gap-2">
                                <button className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700" onClick={() => openScheduleForm(shareholder.shareholder_id)}>
                                  {schedules.length ? 'Edit Schedule' : 'Add Due Schedule'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setSelectedClientHistoryId(shareholder.shareholder_id)}
                                  className="rounded border border-navy bg-navy px-2 py-1 text-xs font-semibold text-white hover:bg-navy-deep"
                                >
                                  Payment History
                                </button>
                              </div>
                            </div>
                            {schedules.length ? (
                              <div className="overflow-auto rounded-lg border border-slate-200">
                                <table className="w-full min-w-[860px] text-sm">
                                  <thead className="bg-slate-50 text-slate-600">
                                    <tr>
                                      <th className="px-3 py-2 text-left">Installment</th>
                                      <th className="px-3 py-2 text-left">Due Date</th>
                                      <th className="px-3 py-2 text-right">Amount</th>
                                      <th className="px-3 py-2 text-right">Paid</th>
                                      <th className="px-3 py-2 text-right">Balance</th>
                                      <th className="px-3 py-2 text-left">Remarks</th>
                                      <th className="px-3 py-2 text-center">Action</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                  {schedules.map((item) => {
                                    const itemPaid = Number(item.balance_amount || 0) <= 0;
                                    const itemOverdue = item.days_overdue > 0 && !itemPaid;
                                    return (
                                      <tr
                                        key={item.id}
                                        className={`border-t border-slate-100 ${itemPaid ? 'bg-emerald-50/70' : itemOverdue ? 'bg-rose-50/70' : 'bg-white'}`}
                                        onMouseEnter={(event) => {
                                          event.stopPropagation();
                                          showAudit(clientAuditActors[`shareholder_payment_schedules:${shareholder.shareholder_id}`] || null, 'Installment');
                                        }}
                                        onMouseLeave={hideAudit}
                                      >
                                        <td className="px-3 py-2 font-semibold">#{item.installment_no} ({Number(item.percentage || 0).toFixed(2)}%)</td>
                                        <td className="px-3 py-2">{formatDate(item.due_date)}</td>
                                        <td className="px-3 py-2 text-right font-semibold">{formatCurrency(item.amount)}</td>
                                        <td className="px-3 py-2 text-right font-semibold text-emerald-700">{formatCurrency(item.paid_amount)}</td>
                                        <td className="px-3 py-2 text-right font-semibold text-rose-700">{formatCurrency(item.balance_amount)}</td>
                                        <td className="px-3 py-2">{item.remarks || '-'}</td>
                                        <td className="px-3 py-2 text-center">
                                          {itemPaid ? (
                                            <Link to={`/payments?projectId=${ledger.project_id}&shareholderId=${item.shareholder_id}`} className="rounded bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">
                                              Paid
                                            </Link>
                                          ) : (
                                            <button className="rounded bg-emerald-600 px-2 py-1 text-xs font-bold text-white hover:bg-emerald-700" onClick={() => selectScheduleForPayment(item)}>
                                              Pay
                                            </button>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <div className="rounded-lg border border-dashed border-indigo-200 bg-indigo-50/60 p-4">
                                <p className="text-sm font-black text-indigo-900">No due schedule added for this client.</p>
                                <p className="mt-1 text-xs font-semibold text-indigo-700">Create installments to track due dates, pending amounts, and payment reminders.</p>
                                <button
                                  type="button"
                                  className="mt-3 rounded bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-700"
                                  onClick={() => openScheduleForm(shareholder.shareholder_id)}
                                >
                                  Add Due Schedule
                                </button>
                              </div>
                            )}
                            <div className="mt-3 rounded-lg border border-slate-200">
                              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2">
                                <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Payment History</p>
                                <span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-slate-600">{shareholderPayments.length} payment{shareholderPayments.length !== 1 ? 's' : ''}</span>
                              </div>
                              <DataTable
                                auditTableName="shareholder_payments"
                                auditRecordIds={shareholderPayments.map((payment) => payment.id)}
                                auditRecordLabel="Client payment"
                                size="compact"
                                printTitle={`Client Statement - ${shareholder.name}`}
                                printMetadata={{
                                  Client: shareholder.name,
                                  Project: ledger.project_name,
                                }}
                                printSummarySections={[
                                  {
                                    title: 'Client Details',
                                    items: [
                                      { label: 'Client Name', value: shareholder.name },
                                      { label: 'PAN No', value: shareholder.pan_no || shareholder.company_name || '-' },
                                      { label: 'Type', value: shareholder.is_existing_shareholder ? 'Existing' : 'KKR' },
                                      { label: 'Phone', value: shareholderSource?.phone || '-' },
                                      { label: 'Address', value: shareholderSource?.address || '-' },
                                      { label: 'Project', value: ledger.project_name },
                                    ],
                                  },
                                  {
                                    title: 'Financial Summary',
                                    items: [
                                      { label: 'Total To Pay', value: formatCurrency(shareholder.due_amount) },
                                      { label: 'Total Paid', value: formatCurrency(shareholder.paid_amount) },
                                      { label: 'Balance', value: formatCurrency(shareholder.balance_amount) },
                                      { label: 'GST Payable', value: formatCurrency(Number(shareholder.gst_payable || 0)) },
                                      { label: 'GST Paid', value: formatCurrency(Number(shareholder.gst_paid || 0)) },
                                      { label: 'GST Balance', value: formatCurrency(Number(shareholder.gst_balance || 0)) },
                                      { label: 'Registration To Pay', value: formatCurrency(Number(shareholder.registration_payable || 0)) },
                                      { label: 'Legal To Pay', value: formatCurrency(Number(shareholder.legal_payable || 0)) },
                                      { label: 'Pay Share', value: `${duePercent.toFixed(2)}%` },
                                      { label: 'Due Schedule Items', value: schedules.length },
                                      { label: 'Payments', value: shareholderPayments.length },
                                      { label: 'Overdue Items', value: schedules.filter((item) => item.days_overdue > 0 && Number(item.balance_amount || 0) > 0).length },
                                      { label: 'Status', value: ledgerStatus },
                                    ],
                                  },
                                ]}
                                printOmitColumns={[5]}
                                headers={['Date', 'Mode', 'Towards', 'Amount Paid', 'Notes', 'Action']}
                                rows={shareholderPayments.length ? shareholderPayments.map((payment) => [
                                  formatDate(payment.payment_date),
                                  payment.payment_mode || '-',
                                  paymentPurposeLabel(payment.purpose),
                                  formatCurrency(payment.amount),
                                  payment.notes || '-',
                                  <button
                                    type="button"
                                    className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                                    disabled={deletePaymentMutation.isPending}
                                    onClick={() => {
                                      if (!confirmTypedDelete(`payment entry ${payment.id}`)) return;
                                      deletePaymentMutation.mutate(payment.id);
                                    }}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    Delete
                                  </button>,
                                ]) : [['-', '-', '-', '-', 'No payments recorded for this client yet.', '']]}
                                footerRows={[['', '', 'Total', formatCurrency(shareholder.paid_amount), '', '']]}
                              />
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                <CalendarClock className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-2 text-sm font-semibold text-slate-600">No clients created yet.</p>
                <p className="mt-1 text-xs text-slate-500">Use Add New Client to create a JV ledger row.</p>
              </div>
            )}
            {rowMenu ? createPortal((() => {
              const shareholder = ledger.shareholders.find((item) => item.shareholder_id === rowMenu.shareholderId);
              if (!shareholder) return null;
              const group = dueScheduleGroups.find((item) => item.shareholder.shareholder_id === shareholder.shareholder_id);
              const schedules = group?.schedules || [];
              const firstPending = schedules.find((item) => Number(item.balance_amount || 0) > 0);
              return (
                <div
                  ref={rowMenuRef}
                  className="fixed z-[200] w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
                  style={{ top: rowMenu.top, left: rowMenu.left }}
                >
                  {canAddEditClient ? (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      onClick={() => {
                        setRowMenu(null);
                        openEditDueForm(shareholder);
                      }}
                    >
                      <UserCheck className="h-4 w-4 text-slate-500" />
                      Edit Client
                    </button>
                  ) : null}
                  {canPaymentEntry && firstPending ? (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
                      onClick={() => {
                        setRowMenu(null);
                        selectScheduleForPayment(firstPending);
                      }}
                    >
                      <Wallet className="h-4 w-4" />
                      Pay Due
                    </button>
                  ) : null}
                  {canDueSchedule ? (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      onClick={() => {
                        setRowMenu(null);
                        openScheduleForm(shareholder.shareholder_id);
                      }}
                    >
                      <CalendarClock className="h-4 w-4 text-slate-500" />
                      {schedules.length ? 'Edit Schedule' : 'Add Due Schedule'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    onClick={() => {
                      setRowMenu(null);
                      setSelectedClientHistoryId(shareholder.shareholder_id);
                    }}
                  >
                    <History className="h-4 w-4 text-slate-500" />
                    Payment History
                  </button>
                  {canDeleteClient ? (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                      disabled={deleteShareholderMutation.isPending}
                      onClick={() => {
                        setRowMenu(null);
                        deleteClient(shareholder);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </button>
                  ) : null}
                </div>
              );
            })(), document.body) : null}
          </SectionCard>

          <SectionCard title="Payment History">
            <DataTable
              auditTableName="shareholder_payments"
              auditRecordIds={ledger.payments.map((payment) => payment.id)}
              auditRecordLabel="Client payment"
              size="roomy"
              printTitle={`Payment History - ${ledger.project_name}`}
              printMetadata={{
                Project: ledger.project_name,
              }}
              printSummarySections={[
                {
                  title: 'Project Client Ledger Summary',
                  items: [
                    { label: 'Project', value: ledger.project_name },
                    { label: 'Total To Pay', value: formatCurrency(ledger.total_due) },
                    { label: 'Total Paid', value: formatCurrency(ledger.total_paid) },
                    { label: 'Balance', value: formatCurrency(ledger.total_balance) },
                    { label: 'GST Balance', value: formatCurrency(Number(ledger.total_gst_balance || 0)) },
                    { label: 'Registration Balance', value: formatCurrency(Number(ledger.total_registration_balance || 0)) },
                    { label: 'Legal Balance', value: formatCurrency(Number(ledger.total_legal_balance || 0)) },
                    { label: 'Payments', value: ledger.payments.length },
                    { label: 'Due Schedule Items', value: ledger.payment_schedules.length },
                    { label: 'Overdue Items', value: ledger.payment_schedules.filter((item) => item.days_overdue > 0 && Number(item.balance_amount || 0) > 0).length },
                  ],
                },
              ]}
              printOmitColumns={[6]}
              headers={['Date', 'Shareholder', 'Mode', 'Towards', 'Amount', 'Notes', 'Actions']}
              onRowContextMenu={(index, event) => {
                event.preventDefault();
                const row = ledger.payments[index];
                if (!row) return;
                if (!confirmTypedDelete(`payment entry ${row.id}`)) return;
                deletePaymentMutation.mutate(row.id);
              }}
              rows={ledger.payments.map((item) => {
                const shareholderName = ledger.shareholders.find((s) => s.shareholder_id === item.shareholder_id)?.name || `#${item.shareholder_id}`;
                return [
                  formatDate(item.payment_date),
                  shareholderName,
                  item.payment_mode || '-',
                  paymentPurposeLabel(item.purpose),
                  formatCurrency(item.amount),
                  item.notes
                    ? item.notes.replace(/\[Seal: KKR (Foundations|Developers)\]/g, '').trim() || '-'
                    : '-',
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                      onClick={() => openEditPaymentForm(item)}
                    >
                      Edit
                    </button>
                    <button
                      className="rounded-xl border border-graphite px-3 py-1.5 text-xs font-semibold text-graphite transition hover:bg-slate-50"
                      onClick={() => openReceipt(item.id)}
                    >
                      Receipt
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={deletePaymentMutation.isPending}
                      onClick={() => {
                        if (!confirmTypedDelete(`payment entry ${item.id}`)) return;
                        deletePaymentMutation.mutate(item.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  </div>,
                ];
              })}
            />
          </SectionCard>
        </div>
      ) : null}

      {selectedClientHistory && ledger ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/45 px-2 py-4 sm:px-4 sm:py-6" onClick={() => setSelectedClientHistoryId(null)}>
          <div className="max-h-[88vh] w-full max-w-6xl overflow-auto rounded-2xl bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Client payment history</p>
                <h2 className="mt-1 text-xl font-bold text-graphite">{selectedClientHistory.shareholder.name}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {selectedClientHistory.shareholder.pan_no || selectedClientHistory.shareholder.company_name || 'No PAN No'} | {ledger.project_name}
                </p>
              </div>
              <button type="button" className="rounded bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700" onClick={() => setSelectedClientHistoryId(null)}>Close</button>
            </div>

            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Construction To Pay</p>
                <p className="mt-1 text-lg font-black text-slate-900">{formatCurrency(selectedClientHistory.shareholder.due_amount)}</p>
                <p className="mt-1 text-xs font-semibold text-emerald-700">Paid {formatCurrency(selectedClientHistory.shareholder.paid_amount)}</p>
                <p className="text-xs font-semibold text-rose-700">Bal {formatCurrency(selectedClientHistory.shareholder.balance_amount)}</p>
              </div>
              <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wider text-indigo-700">GST Payable</p>
                <p className="mt-1 text-lg font-black text-indigo-950">{formatCurrency(Number(selectedClientHistory.shareholder.gst_payable || 0))}</p>
                <p className="mt-1 text-xs font-semibold text-emerald-700">Paid {formatCurrency(Number(selectedClientHistory.shareholder.gst_paid || 0))}</p>
                <p className="text-xs font-semibold text-rose-700">Bal {formatCurrency(Number(selectedClientHistory.shareholder.gst_balance || 0))}</p>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wider text-amber-800">Registration</p>
                <p className="mt-1 text-lg font-black text-amber-950">{formatCurrency(Number(selectedClientHistory.shareholder.registration_payable || 0))}</p>
                <p className="mt-1 text-xs font-semibold text-emerald-700">Paid {formatCurrency(Number(selectedClientHistory.shareholder.registration_paid || 0))}</p>
                <p className="text-xs font-semibold text-rose-700">Bal {formatCurrency(Number(selectedClientHistory.shareholder.registration_balance || 0))}</p>
              </div>
              <div className="rounded-xl border border-violet-200 bg-violet-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wider text-violet-800">Legal Charges</p>
                <p className="mt-1 text-lg font-black text-violet-950">{formatCurrency(Number(selectedClientHistory.shareholder.legal_payable || 0))}</p>
                <p className="mt-1 text-xs font-semibold text-emerald-700">Paid {formatCurrency(Number(selectedClientHistory.shareholder.legal_paid || 0))}</p>
                <p className="text-xs font-semibold text-rose-700">Bal {formatCurrency(Number(selectedClientHistory.shareholder.legal_balance || 0))}</p>
              </div>
            </div>
            <div className="mb-4">
              <span className="inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-black uppercase tracking-wider text-indigo-800">
                Status: {selectedClientHistory.status}
              </span>
            </div>

            <div className="space-y-4">
              <DataTable
                auditTableName="shareholder_payment_schedules"
                auditRecordIds={selectedClientHistory.schedules.map(() => selectedClientHistory.shareholder.shareholder_id)}
                auditRecordLabel="Installment"
                size="compact"
                printTitle={`Client Installment Statement - ${selectedClientHistory.shareholder.name}`}
                printMetadata={{
                  Client: selectedClientHistory.shareholder.name,
                  Project: ledger.project_name,
                }}
                printSummarySections={[
                  {
                    title: 'Client Details',
                    items: [
                      { label: 'Client Name', value: selectedClientHistory.shareholder.name },
                      { label: 'PAN No', value: selectedClientHistory.shareholder.pan_no || selectedClientHistory.shareholder.company_name || '-' },
                      { label: 'Type', value: selectedClientHistory.shareholder.is_existing_shareholder ? 'Existing' : 'KKR' },
                      { label: 'Phone', value: selectedClientHistory.source?.phone || '-' },
                      { label: 'Address', value: selectedClientHistory.source?.address || '-' },
                      { label: 'Project', value: ledger.project_name },
                    ],
                  },
                  {
                    title: 'Financial Summary',
                    items: [
                      { label: 'Total To Pay', value: formatCurrency(selectedClientHistory.shareholder.due_amount) },
                      { label: 'Paid Amount', value: formatCurrency(selectedClientHistory.shareholder.paid_amount) },
                      { label: 'Balance', value: formatCurrency(selectedClientHistory.shareholder.balance_amount) },
                      { label: 'Pay Share', value: `${Number(selectedClientHistory.duePercent || 0).toFixed(2)}%` },
                      { label: 'Installments', value: selectedClientHistory.schedules.length },
                      { label: 'Payments', value: selectedClientHistory.payments.length },
                      { label: 'Overdue Installments', value: selectedClientHistory.overdueCount },
                      { label: 'Status', value: selectedClientHistory.status },
                    ],
                  },
                ]}
                headers={['Installment', 'Due Date', 'Amount', 'Paid', 'Balance', 'Status', 'Payment Date(s)', 'Remarks']}
                rows={selectedClientHistory.schedules.length ? selectedClientHistory.schedules.map((item) => {
                  const isPaid = Number(item.balance_amount || 0) <= 0;
                  const isOverdue = item.days_overdue > 0 && !isPaid;
                  const status = isPaid ? 'Paid' : isOverdue ? `Due overdue by ${item.days_overdue} day${item.days_overdue === 1 ? '' : 's'}` : 'Due';
                  const paymentDates = getInstallmentPaymentDates(item, selectedClientHistory.payments);
                  return [
                    `#${item.installment_no} (${Number(item.percentage || 0).toFixed(2)}%)`,
                    formatDate(item.due_date),
                    formatCurrency(item.amount),
                    formatCurrency(item.paid_amount),
                    formatCurrency(item.balance_amount),
                    status,
                    paymentDates.length ? paymentDates.join(', ') : '-',
                    item.remarks || '-',
                  ];
                }) : [['-', '-', '-', '-', '-', 'No installments added', '-', '-']]}
                footerRows={[['', 'Total', formatCurrency(selectedClientHistory.shareholder.due_amount), formatCurrency(selectedClientHistory.shareholder.paid_amount), formatCurrency(selectedClientHistory.shareholder.balance_amount), '', '', '']]}
              />

              <DataTable
                auditTableName="shareholder_payments"
                auditRecordIds={selectedClientHistory.payments.map((payment) => payment.id)}
                auditRecordLabel="Client payment"
                size="compact"
                printTitle={`Client Payment Transactions - ${selectedClientHistory.shareholder.name}`}
                printMetadata={{
                  Client: selectedClientHistory.shareholder.name,
                  Project: ledger.project_name,
                }}
                printSummarySections={[
                  {
                    title: 'Payment Summary',
                    items: [
                      { label: 'Client Name', value: selectedClientHistory.shareholder.name },
                      { label: 'Total To Pay', value: formatCurrency(selectedClientHistory.shareholder.due_amount) },
                      { label: 'Paid Amount', value: formatCurrency(selectedClientHistory.shareholder.paid_amount) },
                      { label: 'Balance', value: formatCurrency(selectedClientHistory.shareholder.balance_amount) },
                      { label: 'Payment Entries', value: selectedClientHistory.payments.length },
                    ],
                  },
                ]}
                headers={['Payment Date', 'Mode', 'Towards', 'Amount Paid', 'Notes']}
                rows={selectedClientHistory.payments.length ? selectedClientHistory.payments.map((payment) => [
                  formatDate(payment.payment_date),
                  payment.payment_mode || '-',
                  paymentPurposeLabel(payment.purpose),
                  formatCurrency(payment.amount),
                  payment.notes || '-',
                ]) : [['-', '-', '-', '-', 'No payments recorded for this client yet.']]}
                footerRows={[['', '', 'Total', formatCurrency(selectedClientHistory.shareholder.paid_amount), '']]}
              />
            </div>
          </div>
        </div>
      ) : null}

      {editableReceiptData ? (
        <>
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4 py-8"
            onClick={closeReceipt}
          >
            <div
              className="relative max-h-[95vh] w-[95vw] max-w-[1340px] overflow-auto rounded-[28px] bg-white p-6 md:p-8 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Receipt Preview</p>
                  <h3 className="mt-1 font-display text-2xl text-graphite">Payment Receipt</h3>
                  <p className="text-sm text-slate-600">Preview, edit details, print, or share the receipt.</p>
                </div>
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 text-slate-600 transition hover:bg-slate-100"
                  onClick={closeReceipt}
                  aria-label="Close receipt preview"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Editable Fields Grid */}
              <div className="mb-5 p-4 rounded-2xl border border-slate-200 bg-slate-50 flex flex-col md:flex-row gap-5 text-xs">
                {/* Left Side: Inputs Grid with generous field spaces */}
                <div className="flex-1 grid gap-3.5 grid-cols-12">
                  <div className="col-span-6 sm:col-span-2">
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Receipt No (S.No)</label>
                    <input
                      type="text"
                      className="w-full !rounded-xl !px-3 !py-2 !text-sm border border-slate-300 bg-white text-graphite outline-none focus:border-slate-400"
                      value={editableReceiptData.receiptNumber}
                      onChange={(e) => setEditableReceiptData(c => c ? { ...c, receiptNumber: e.target.value } : null)}
                    />
                  </div>
                  <div className="col-span-6 sm:col-span-3">
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Date</label>
                    <input
                      type="date"
                      className="w-full !rounded-xl !px-3 !py-2 !text-sm border border-slate-300 bg-white text-graphite outline-none focus:border-slate-400"
                      value={editableReceiptData.date}
                      onChange={(e) => setEditableReceiptData(c => c ? { ...c, date: e.target.value } : null)}
                    />
                  </div>
                  <div className="col-span-6 sm:col-span-3">
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Amount (Rs.)</label>
                    <input
                      type="number"
                      className="w-full !rounded-xl !px-3 !py-2 !text-sm border border-slate-300 bg-white text-graphite outline-none focus:border-slate-400"
                      value={editableReceiptData.amount}
                      onChange={(e) => setEditableReceiptData(c => c ? { ...c, amount: Number(e.target.value || 0) } : null)}
                    />
                  </div>
                  <div className="col-span-6 sm:col-span-4">
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Bill Name</label>
                    <select
                      className="w-full !rounded-xl !px-3 !py-2 !text-sm border border-slate-300 bg-white text-graphite outline-none focus:border-slate-400"
                      value={editableReceiptData.sealType || 'developers'}
                      onChange={(e) => setEditableReceiptData(c => c ? { ...c, sealType: e.target.value } : null)}
                    >
                      <option value="developers">KKR Developers</option>
                      <option value="foundations">KKR Foundations</option>
                    </select>
                  </div>

                  <div className="col-span-12 sm:col-span-6">
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Client Name</label>
                    <SearchableCreatableSelect
                      options={ledger ? ledger.shareholders.map((sh) => ({
                        id: sh.name,
                        name: sh.name,
                        subtext: sh.company_name ? `@ ${sh.company_name}` : undefined,
                      })) : []}
                      value={editableReceiptData.shareholderName}
                      onChange={(val) => setEditableReceiptData(c => c ? { ...c, shareholderName: String(val) } : null)}
                      placeholder="Search or type client name..."
                      createLabelPrefix="Add client"
                    />
                  </div>
                  <div className="col-span-12 sm:col-span-6">
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Company Name</label>
                    <input
                      type="text"
                      className="w-full !rounded-xl !px-3 !py-2 !text-sm border border-slate-300 bg-white text-graphite outline-none focus:border-slate-400"
                      value={editableReceiptData.companyName || ''}
                      placeholder="e.g. F.H., Ist Floor"
                      onChange={(e) => setEditableReceiptData(c => c ? { ...c, companyName: e.target.value || null } : null)}
                    />
                  </div>

                  <div className="col-span-12 sm:col-span-6">
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Billing Address</label>
                    <input
                      type="text"
                      className="w-full !rounded-xl !px-3 !py-2 !text-sm border border-slate-300 bg-white text-graphite outline-none focus:border-slate-400"
                      value={editableReceiptData.clientAddress || ''}
                      placeholder="e.g. 12/44th Street"
                      onChange={(e) => setEditableReceiptData(c => c ? { ...c, clientAddress: e.target.value || null } : null)}
                    />
                  </div>
                  <div className="col-span-6 sm:col-span-3">
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Billing City / District</label>
                    <input
                      type="text"
                      className="w-full !rounded-xl !px-3 !py-2 !text-sm border border-slate-300 bg-white text-graphite outline-none focus:border-slate-400"
                      value={editableReceiptData.clientCity || ''}
                      placeholder="e.g. Chennai"
                      onChange={(e) => setEditableReceiptData(c => c ? { ...c, clientCity: e.target.value || null } : null)}
                    />
                  </div>
                  <div className="col-span-6 sm:col-span-3">
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Billing Pincode</label>
                    <input
                      type="text"
                      className="w-full !rounded-xl !px-3 !py-2 !text-sm border border-slate-300 bg-white text-graphite outline-none focus:border-slate-400"
                      value={editableReceiptData.clientPincode || ''}
                      placeholder="e.g. 600061"
                      onChange={(e) => setEditableReceiptData(c => c ? { ...c, clientPincode: e.target.value || null } : null)}
                    />
                  </div>

                  <div className="col-span-12">
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Project Location</label>
                    <input
                      type="text"
                      className="w-full !rounded-xl !px-3 !py-2 !text-sm border border-slate-300 bg-white text-graphite outline-none focus:border-slate-400"
                      placeholder="e.g. 3rd Main Road, Nanganallur, Chennai"
                      value={editableReceiptData.projectLocation}
                      onChange={(e) => setEditableReceiptData(c => c ? { ...c, projectLocation: e.target.value } : null)}
                    />
                  </div>

                  <div className="col-span-12 sm:col-span-4">
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Payment Mode</label>
                    <SearchableCreatableSelect
                      options={paymentModeSelectOptions}
                      value={editableReceiptData.paymentMode || 'Cash'}
                      onChange={(val) => setEditableReceiptData(c => c ? { ...c, paymentMode: String(val) } : null)}
                      placeholder="Search or type mode..."
                      createLabelPrefix="Use mode"
                    />
                  </div>
                  <div className="col-span-12 sm:col-span-8">
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Drawn on</label>
                    <input
                      type="text"
                      className="w-full !rounded-xl !px-3 !py-2 !text-sm border border-slate-300 bg-white text-graphite outline-none focus:border-slate-400"
                      value={editableReceiptData.drawnOn || ''}
                      placeholder="e.g. State Bank of India, Nanganallur Branch"
                      onChange={(e) => setEditableReceiptData(c => c ? { ...c, drawnOn: e.target.value || null } : null)}
                    />
                  </div>

                  <div className="col-span-12">
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Towards / Notes</label>
                    <input
                      type="text"
                      className="w-full !rounded-xl !px-3 !py-2 !text-sm border border-slate-300 bg-white text-graphite outline-none focus:border-slate-400"
                      placeholder="e.g. Part payment towards JV redevelopment construction stage 2"
                      value={editableReceiptData.notes || ''}
                      onChange={(e) => setEditableReceiptData(c => c ? { ...c, notes: e.target.value || null } : null)}
                    />
                  </div>
                </div>

                {/* Right Side: Digital Signature Canvas */}
                <div className="flex flex-col items-center justify-center border-t md:border-t-0 md:border-l border-slate-200 pt-4 md:pt-0 md:pl-5 shrink-0">
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">E-Sign Image</label>
                  <ESignImageUpload
                    label="Upload E-Sign Image"
                    initialValue={editableReceiptData.signatureImage}
                    onChange={(dataUrl) => setEditableReceiptData(c => c ? { ...c, signatureImage: dataUrl } : null)}
                    onClear={() => setEditableReceiptData(c => c ? { ...c, signatureImage: null } : null)}
                  />
                </div>
              </div>

              <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)]">
                <div className="min-w-0 overflow-auto rounded-[24px] border border-slate-200 bg-slate-100 p-4">
                  <div className="w-max min-w-full">
                    <div className="overflow-hidden rounded-xl bg-white shadow-md">
                      <JVReceipt data={editableReceiptData} compact />
                    </div>
                  </div>
                </div>
                <div className="space-y-3 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                  {/* Download & Share JPG */}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-graphite px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-black"
                      onClick={() => void exportReceipt('jpg', 'download')}
                    >
                      <Download className="h-4 w-4" />
                      Download JPG
                    </button>
                    <button
                      type="button"
                      className="flex w-12 items-center justify-center rounded-xl border border-graphite bg-white text-graphite shadow-sm transition hover:bg-slate-50 shrink-0"
                      title="Share JPG"
                      onClick={() => void exportReceipt('jpg', 'share')}
                    >
                      <Share2 className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Download & Share PDF */}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-graphite bg-white px-4 py-3 text-sm font-semibold text-graphite shadow-sm transition hover:bg-slate-50"
                      onClick={() => void exportReceipt('pdf', 'download')}
                    >
                      <Download className="h-4 w-4" />
                      Download PDF
                    </button>
                    <button
                      type="button"
                      className="flex w-12 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 shrink-0"
                      title="Share PDF"
                      onClick={() => void exportReceipt('pdf', 'share')}
                    >
                      <Share2 className="h-4 w-4" />
                    </button>
                  </div>

                  <button
                    type="button"
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                    onClick={printReceipt}
                  >
                    <Printer className="h-4 w-4" />
                    Print
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 shadow-sm transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={!receiptPaymentId || deletePaymentMutation.isPending}
                    onClick={() => {
                      if (!receiptPaymentId) return;
                      if (!confirmTypedDelete(`receipt ${editableReceiptData.receiptNumber}`)) return;
                      deletePaymentMutation.mutate(receiptPaymentId);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete Receipt
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="receipt-print-only absolute -left-[99999px] top-0 w-[1000px] bg-white">
            <JVReceipt ref={receiptPrintRef} data={editableReceiptData} compact />
          </div>
        </>
      ) : null}
    </div>
  );
}
