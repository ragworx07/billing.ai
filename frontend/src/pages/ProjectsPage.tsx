import type { ClipboardEvent, Dispatch, DragEvent, FormEvent, KeyboardEvent, ReactNode, SetStateAction } from 'react';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Banknote,
  BarChart3,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  CircleDollarSign,
  Clipboard,
  Download,
  ExternalLink,
  Eye,
  FileArchive,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Gauge,
  Hammer,
  HardHat,
  Home,
  Info,
  MoreVertical,
  Package,
  Pencil,
  Plus,
  Printer,
  Receipt,
  Search,
  Trash2,
  UploadCloud,
  Users,
  X,
} from 'lucide-react';

import { BuildingLoader } from '../components/BuildingLoader';
import { DataTable } from '../components/DataTable';
import {
  LabourInchargeLimitDialog,
  LabourInchargeLimitMeter,
  labourLimitStatus,
  labourLimitSuggestionLabel,
  labourLimitWarningMessage,
  type LabourLimitStatus,
} from '../components/LabourInchargeLimit';
import { RequiredLabel } from '../components/RequiredLabel';
import { SectionCard } from '../components/SectionCard';
import { useAuth } from '../contexts/AuthContext';
import { useAuditHover } from '../contexts/AuditHoverContext';
import { ProjectViewSkeleton } from '../components/Skeleton';
import { ProjectImage } from '../components/ProjectImage';
import { useNotify } from '../contexts/NotificationContext';
import { api } from '../services/api';
import type { Client, ProjectFile, ProjectFileFolder, ProjectStatus } from '../types/api';
import { getApiErrorMessage, parseBlobErrorMessage } from '../utils/errors';
import { downloadBlob, openBlob, printHtmlDocument } from '../utils/fileActions';
import { formatCurrency, formatDate, calculateMaterialTotal, vendorPaymentTotal, slugify, localDateKey, addDaysToDateKey } from '../utils/format';
import { hasPermission, normalizedRole } from '../utils/access';

const initialProject = {
  client_id: null as number | null,
  project_name: '',
  description: '',
  profile_image_url: '',
  location: '',
  start_date: '',
  expected_end_date: '',
  construction_sqft: 0,
  construction_rate_per_sqft: 4500,
  status: 'upcoming' as ProjectStatus,
};

const API_ORIGIN = (import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1').replace(/\/api\/v1\/?$/, '');

const statusStyle: Record<ProjectStatus, string> = {
  completed: 'bg-emerald-100 text-emerald-800',
  ongoing: 'bg-amber-100 text-amber-900',
  upcoming: 'bg-sky-100 text-sky-800',
};

function formatTimelineDate(value: string) {
  return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
}

function toDateOnly(value: string) {
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value.slice(0, 10) : localDateKey(parsed);
}

function formatLocalDateKey(date: Date) {
  return localDateKey(date);
}

function parseNumberInput(value: string) {
  if (value.trim() === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function numberFieldValue(value: number) {
  return value === 0 ? '' : String(value);
}

function emptyVendorTransactionForm() {
  return {
    vendor_id: 0,
    amount: 0,
    round_off: 0,
    payment_date: localDateKey(),
    payment_mode: '',
    notes: '',
  };
}

function roundOffTextClass(value: number) {
  if (value < 0) return 'text-rose-700';
  if (value > 0) return 'text-emerald-700';
  return 'text-slate-500';
}

function getLabourLimitRemainingClass(status: LabourLimitStatus) {
  if (!status.hasLimit) return 'text-slate-400';
  if (status.remaining < 0) return 'text-rose-700 font-bold';
  const remainingPct = (status.remaining / status.limit) * 100;
  if (remainingPct <= 5) return 'text-rose-700 font-bold';
  if (remainingPct <= 30) return 'text-amber-800 font-bold';
  return 'text-emerald-700 font-bold';
}

type SortState = { column: string; direction: 'asc' | 'desc' } | null;

function toggleColumnSort(currentSort: SortState, columnKey: string): SortState {
  if (!currentSort || currentSort.column !== columnKey) {
    return { column: columnKey, direction: 'asc' };
  }
  if (currentSort.direction === 'asc') {
    return { column: columnKey, direction: 'desc' };
  }
  return null;
}

function compareSortValues(leftVal: unknown, rightVal: unknown, direction: 'asc' | 'desc'): number {
  if (leftVal === rightVal) return 0;
  if (leftVal === null || leftVal === undefined || leftVal === '') return 1;
  if (rightVal === null || rightVal === undefined || rightVal === '') return -1;

  let result = 0;
  const leftClean = typeof leftVal === 'string' ? leftVal.replace(/[₹,\s%]/g, '') : '';
  const rightClean = typeof rightVal === 'string' ? rightVal.replace(/[₹,\s%]/g, '') : '';

  const leftNum = typeof leftVal === 'number' ? leftVal : (leftClean && !isNaN(Number(leftClean)) ? Number(leftClean) : NaN);
  const rightNum = typeof rightVal === 'number' ? rightVal : (rightClean && !isNaN(Number(rightClean)) ? Number(rightClean) : NaN);

  if (!isNaN(leftNum) && !isNaN(rightNum)) {
    result = leftNum - rightNum;
  } else {
    const leftDate = Date.parse(String(leftVal));
    const rightDate = Date.parse(String(rightVal));
    if (!isNaN(leftDate) && !isNaN(rightDate) && String(leftVal).length >= 8 && String(rightVal).length >= 8) {
      result = leftDate - rightDate;
    } else {
      result = String(leftVal).localeCompare(String(rightVal), undefined, { numeric: true, sensitivity: 'base' });
    }
  }

  return direction === 'asc' ? result : -result;
}

function SortableHeader({
  label,
  columnKey,
  sortState,
  onSort,
  align = 'left',
  widthClass = '',
}: {
  label: string;
  columnKey: string;
  sortState: SortState;
  onSort: (key: string) => void;
  align?: 'left' | 'center' | 'right';
  widthClass?: string;
}) {
  const isActive = sortState?.column === columnKey;
  const isAsc = sortState?.direction === 'asc';

  return (
    <th
      className={`sticky top-0 z-20 px-3.5 py-2.5 text-${align} ${widthClass} bg-slate-100 text-slate-700 border-b border-slate-200 select-none`}
    >
      <button
        type="button"
        className={`group inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 transition-colors ${
          align === 'right' ? 'ml-auto flex-row-reverse text-right' : align === 'center' ? 'mx-auto text-center' : 'text-left'
        }`}
        onClick={() => onSort(columnKey)}
        title={`Sort by ${label} (${isActive ? (isAsc ? 'Ascending' : 'Descending') : 'Click to sort'})`}
      >
        <span className="whitespace-nowrap">{label}</span>
        {isActive ? (
          <span className="text-slate-900 text-xs font-bold leading-none">
            {isAsc ? '↑' : '↓'}
          </span>
        ) : (
          <span className="text-slate-300 group-hover:text-slate-500 text-xs leading-none transition-colors">↕</span>
        )}
      </button>
    </th>
  );
}

function formatDateRange(start: string, end: string) {
  if (start === end) return formatDate(start);
  return `${formatDate(start)} - ${formatDate(end)}`;
}

function labourGroupDateRange(rows: Array<{ dateKey: string }>) {
  if (!rows.length) return '-';
  const dates = rows.map((row) => row.dateKey).sort();
  return formatDateRange(dates[0], dates[dates.length - 1]);
}

function getMonthKey(date: string) {
  return date.slice(0, 7);
}

function getWeekKey(date: string) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const offset = (firstOfMonth.getDay() + 6) % 7; // Monday-first week offset
  const weekIndex = Math.floor((d.getDate() + offset - 1) / 7) + 1;
  return `${date.slice(0, 7)}-W${String(weekIndex).padStart(2, '0')}`;
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split('-');
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

function shiftMonth(monthKey: string, offset: number) {
  const [year, month] = monthKey.split('-').map(Number);
  const shifted = new Date(year, month - 1 + offset, 1);
  return formatLocalDateKey(shifted).slice(0, 7);
}

function clampMonthKey(monthKey: string, minMonthKey: string, maxMonthKey: string) {
  if (monthKey < minMonthKey) return minMonthKey;
  if (monthKey > maxMonthKey) return maxMonthKey;
  return monthKey;
}

function formatCompactCurrency(value: number) {
  const abs = Math.abs(value);
  if (abs >= 10000000) return `₹${(value / 10000000).toFixed(abs >= 100000000 ? 0 : 1)}Cr`;
  if (abs >= 100000) return `₹${(value / 100000).toFixed(abs >= 1000000 ? 0 : 1)}L`;
  if (abs >= 1000) return `₹${(value / 1000).toFixed(abs >= 10000 ? 0 : 1)}K`;
  return formatCurrency(value);
}

function getProjectCalendarEndDate(project: { status: ProjectStatus; start_date: string; expected_end_date?: string | null }) {
  const today = localDateKey();
  if (project.expected_end_date) return project.expected_end_date;
  return today > project.start_date ? today : project.start_date;
}

function resolveProjectImageUrl(value?: string | null) {
  if (!value) return '';
  if (/^https?:\/\//i.test(value) || value.startsWith('data:') || value.startsWith('blob:')) return value;
  return `${API_ORIGIN}${value.startsWith('/') ? value : `/${value}`}`;
}

function formatWeekLabel(weekKey: string) {
  const parts = weekKey.split('-W');
  return parts.length === 2 ? `Week ${Number(parts[1])}` : weekKey;
}

function escapePrintHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

type SectionKey = 'materials' | 'labour' | 'expenses' | 'transactions' | 'files';
type CalendarTransaction = {
  id: string;
  date: string;
  direction: 'spent' | 'received' | 'cash_out';
  type: string;
  title: string;
  amount: number;
  detail: string;
};

function ProjectEntryModal({
  open,
  title,
  icon,
  onClose,
  children,
  footer,
  maxWidthClass = 'max-w-xl sm:max-w-2xl lg:max-w-3xl',
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  icon: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  maxWidthClass?: string;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex justify-end bg-slate-950/45 backdrop-blur-xs transition-opacity animate-in fade-in duration-200">
      <div className="absolute inset-0" onClick={onClose} aria-label="Close modal overlay" />

      <div
        className={clsx(
          'relative z-10 flex h-full max-h-full w-full min-w-0 flex-col overflow-hidden border-l border-slate-200 bg-white shadow-[-20px_0_60px_rgba(15,23,42,0.22)] animate-in slide-in-from-right duration-300',
          maxWidthClass,
        )}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-slate-50 via-white to-indigo-50/30 px-6 py-5 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-graphite shadow-xs">
              {icon}
            </div>
            <div>
              <h3 className="font-display text-2xl text-graphite">{title}</h3>
            </div>
          </div>
          <button
            type="button"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">{children}</div>

        <div className="flex min-h-0 flex-wrap items-center justify-end gap-3 border-t border-slate-100 bg-slate-50/80 px-6 py-4 shrink-0">
          {footer}
        </div>
      </div>
    </div>
  );
}

function EntrySection({
  title,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200/90 bg-slate-50/60 p-4 space-y-3">
      <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">{title}</p>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function EntrySummary({
  rows,
  totalLabel,
  totalValue,
}: {
  rows: Array<{ label: string; value: string }>;
  totalLabel: string;
  totalValue: string;
}) {
  return (
    <div className="rounded-2xl border border-graphite/15 bg-gradient-to-br from-slate-900 to-slate-800 px-4 py-3 text-white shadow-sm">
      <p className="text-[11px] font-black uppercase tracking-[0.2em] text-white/55">Summary</p>
      <div className="mt-2 space-y-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-white/70">{row.label}</span>
            <span className="font-semibold text-white/90">{row.value}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/15 pt-3">
        <span className="text-sm font-bold text-white/80">{totalLabel}</span>
        <span className="text-xl font-black tracking-tight">{totalValue}</span>
      </div>
    </div>
  );
}

function EntryGhostButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function EntryPrimaryButton({
  children,
  type = 'button',
  disabled,
  onClick,
  form,
}: {
  children: ReactNode;
  type?: 'button' | 'submit';
  disabled?: boolean;
  onClick?: () => void;
  form?: string;
}) {
  return (
    <button
      type={type}
      form={form}
      className="rounded-2xl bg-graphite px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function ProjectsPage() {
  const { user } = useAuth();
  const { showAudit, hideAudit } = useAuditHover();
  const currentRole = normalizedRole(user?.role);
  const canCreateEditProject = hasPermission(user?.role, 'project_create_edit');
  const canDeleteProject = hasPermission(user?.role, 'project_delete');
  const isOwner = currentRole === 'owner' || currentRole === 'administrator';
  const canViewProjectMaterials = hasPermission(user?.role, 'project_tab_materials');
  const canViewProjectLabour = hasPermission(user?.role, 'project_tab_labour');
  const canViewProjectExpenses = hasPermission(user?.role, 'project_tab_expenses');
  const canViewProjectTransactions = hasPermission(user?.role, 'project_tab_transactions');
  const canViewProjectFiles = hasPermission(user?.role, 'project_tab_files');
  const canManageInchargeLimits = hasPermission(user?.role, 'labour_incharge_limit');
  const canManageVendorTransactions = hasPermission(user?.role, 'vendor_transaction_manage');
  const canEditVendorMaster = hasPermission(user?.role, 'tab_vendors');
  const canEditInchargeMaster = hasPermission(user?.role, 'labour_incharge_detail');
  const hideExpenseAmounts = user?.role === 'supervisor';
  const [searchParams] = useSearchParams();
  const { projectId: urlProjectId, projectSlug: urlProjectSlug, tab: urlTab } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState(initialProject);
  const selectedProjectId = urlProjectId ? Number(urlProjectId) : (Number(searchParams.get('projectId') || 0) || null);
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<{
    project_name: string;
    description: string;
    profile_image_url: string;
    location: string;
    start_date: string;
    expected_end_date: string;
    construction_sqft: number;
    construction_rate_per_sqft: number;
    status: ProjectStatus;
  }>({
    project_name: '',
    description: '',
    profile_image_url: '',
    location: '',
    start_date: '',
    expected_end_date: '',
    construction_sqft: 0,
    construction_rate_per_sqft: 4500,
    status: 'upcoming',
  });
  const [statusFilter, setStatusFilter] = useState<'all' | ProjectStatus>('all');
  const [search, setSearch] = useState('');
  const [projectImageFile, setProjectImageFile] = useState<File | null>(null);
  const [projectImagePreview, setProjectImagePreview] = useState('');
  const [editProjectImageFile, setEditProjectImageFile] = useState<File | null>(null);
  const [editProjectImagePreview, setEditProjectImagePreview] = useState('');
  const [showPrintOptions, setShowPrintOptions] = useState(false);
  const [projectHeaderMenuOpen, setProjectHeaderMenuOpen] = useState(false);
  const projectHeaderMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!projectHeaderMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (projectHeaderMenuRef.current && !projectHeaderMenuRef.current.contains(event.target as Node)) {
        setProjectHeaderMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [projectHeaderMenuOpen]);

  const [leftTimelineOpen, setLeftTimelineOpen] = useState(false);
  const [showCalendarDrawer, setShowCalendarDrawer] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => localDateKey().slice(0, 7));
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);
  const [printOptions, setPrintOptions] = useState({
    summary: true,
    materials: true,
    labour: true,
    expenses: true,
    transactions: true,
    files: true,
    timeline: true,
  });
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [showMaterialModal, setShowMaterialModal] = useState(false);
  const [showLabourModal, setShowLabourModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [labourSubmitting, setLabourSubmitting] = useState(false);
  const [showMaterialEditModal, setShowMaterialEditModal] = useState(false);
  const [showLabourEditModal, setShowLabourEditModal] = useState(false);
  const [showExpenseEditModal, setShowExpenseEditModal] = useState(false);
  const [showPaymentsModal, setShowPaymentsModal] = useState(false);
  const [showDescriptionModal, setShowDescriptionModal] = useState(false);
  const [projectPendingDeletion, setProjectPendingDeletion] = useState<{ id: number; name: string } | null>(null);
  const [deleteProjectName, setDeleteProjectName] = useState('');
  const [isDescriptionEditing, setIsDescriptionEditing] = useState(false);
  const [projectDescriptionDraft, setProjectDescriptionDraft] = useState('');
  const [previewingFile, setPreviewingFile] = useState<{ file: ProjectFile; url: string } | null>(null);
  const [activeProjectSection, setActiveProjectSection] = useState<SectionKey | null>(null);
  const [materialGroupMode, setMaterialGroupMode] = useState<'none' | 'date' | 'material' | 'vendor'>('date');
  const [expandedMaterialGroups, setExpandedMaterialGroups] = useState<Record<string, boolean>>({});
  const [expandedSupplierGroups, setExpandedSupplierGroups] = useState<Record<string, boolean>>({});
  const [labourGroupMode, setLabourGroupMode] = useState<'none' | 'date' | 'month' | 'labour' | 'incharge'>('date');
  const [expandedLabourGroups, setExpandedLabourGroups] = useState<Record<string, boolean>>({});
  const [expandedLabourSubGroups, setExpandedLabourSubGroups] = useState<Record<string, boolean>>({});
  const [vendorTransactionGroupMode, setVendorTransactionGroupMode] = useState<'date' | 'vendor'>('date');
  const [expandedVendorTransactionGroups, setExpandedVendorTransactionGroups] = useState<Record<string, boolean>>({});
  const [expenseGroupMode, setExpenseGroupMode] = useState<'date' | 'none' | 'category'>('date');
  const [expandedExpenseGroups, setExpandedExpenseGroups] = useState<Record<string, boolean>>({});
  const [expensesView, setExpensesView] = useState<'project' | 'site'>('project');
  const [selectedVendorId, setSelectedVendorId] = useState<number | null>(null);
  const [selectedVendorDetailType, setSelectedVendorDetailType] = useState<'material' | 'labour'>('material');
  const [showVendorDetailModal, setShowVendorDetailModal] = useState(false);
  const [labourLimitDialog, setLabourLimitDialog] = useState<{ vendorId: number | null; vendorName: string } | null>(null);
  const [showAllVendorPayments, setShowAllVendorPayments] = useState(false);
  const [showClientDetailModal, setShowClientDetailModal] = useState(false);
  const [currentFileFolderId, setCurrentFileFolderId] = useState<number | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingFolderId, setRenamingFolderId] = useState<number | null>(null);
  const [renameFolderName, setRenameFolderName] = useState('');
  const [renamingFileId, setRenamingFileId] = useState<number | null>(null);
  const [renameFileName, setRenameFileName] = useState('');
  const [isFileDropActive, setIsFileDropActive] = useState(false);

  const notify = useNotify();
  const queryClient = useQueryClient();

  const { data: statement, isLoading: statementLoading } = useQuery({
    queryKey: ['project-statement', selectedProjectId],
    queryFn: () => api.getProjectStatement(selectedProjectId as number),
    enabled: Boolean(selectedProjectId),
  });

  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: () => api.getProjects() });
  const { data: clients = [] } = useQuery({ queryKey: ['clients'], queryFn: () => api.getClients() });
  const { data: materials = [] } = useQuery({ queryKey: ['materials'], queryFn: () => api.getMaterials() });
  const { data: materialMaster = [] } = useQuery({ queryKey: ['material-master'], queryFn: () => api.getMaterialMaster() });
  const { data: expenses = [] } = useQuery({
    queryKey: ['expenses'],
    queryFn: () => api.getExpenses(),
    enabled: !selectedProjectId || activeProjectSection === 'expenses' || Boolean(statement),
  });
  const { data: siteExpenses = [] } = useQuery({
    queryKey: ['site-expenses'],
    queryFn: () => api.getSiteExpenses(),
    enabled: !selectedProjectId || activeProjectSection === 'expenses' || Boolean(statement),
  });
  const { data: payments = [] } = useQuery({ queryKey: ['payments'], queryFn: () => api.getPayments() });
  const { data: expenseMaster = [] } = useQuery({ queryKey: ['expense-master'], queryFn: () => api.getExpenseMaster() });
  const { data: labourMaster = [] } = useQuery({ queryKey: ['workers'], queryFn: () => api.getWorkers() });

  const { data: laborLogs = [] } = useQuery({
    queryKey: ['labor-logs', selectedProjectId],
    queryFn: () => api.getLaborLogs(selectedProjectId as number),
    enabled: Boolean(selectedProjectId) && (activeProjectSection === 'labour' || activeProjectSection === 'transactions' || Boolean(statement)),
  });
  const { data: jvLedger = null } = useQuery({
    queryKey: ['jv-project-ledger', selectedProjectId],
    queryFn: () => api.getJVProjectLedger(selectedProjectId as number),
    enabled: Boolean(selectedProjectId) && (activeProjectSection === 'transactions' || Boolean(statement)),
  });
  const { data: vendorMaster = [] } = useQuery({ queryKey: ['vendor-master'], queryFn: () => api.getVendorMaster() });
  const materialVendors = useMemo(
    () => vendorMaster.filter((vendor) => vendor.active && vendor.party_type !== 'labour_incharge'),
    [vendorMaster],
  );
  const labourIncharges = useMemo(
    () => vendorMaster.filter((vendor) => vendor.active && vendor.party_type === 'labour_incharge'),
    [vendorMaster],
  );
  const { data: vendorTransactions = [] } = useQuery({
    queryKey: ['vendor-transactions', selectedProjectId],
    queryFn: () => api.getVendorTransactions(selectedProjectId as number),
    enabled: Boolean(selectedProjectId) && (activeProjectSection === 'transactions' || Boolean(statement)),
  });
  const { data: labourInchargeLimits = [] } = useQuery({
    queryKey: ['labour-incharge-limits', selectedProjectId],
    queryFn: () => api.getLabourInchargeLimits(selectedProjectId as number),
    enabled: Boolean(selectedProjectId),
  });
  const labourLimitByVendorId = useMemo(() => {
    const map = new Map<number, number>();
    labourInchargeLimits.forEach((row) => map.set(row.vendor_id, Number(row.limit_amount || 0)));
    return map;
  }, [labourInchargeLimits]);
  const { data: projectFileBoard = { folders: [], files: [] } } = useQuery({
    queryKey: ['project-files', selectedProjectId],
    queryFn: () => api.getProjectFiles(selectedProjectId as number),
    enabled: Boolean(selectedProjectId) && activeProjectSection === 'files',
  });
  const auditRecords = useMemo(() => [
    ...projects.map((row) => ({ table_name: 'projects', record_id: row.id })),
    ...materials.filter((row) => row.project_id === selectedProjectId).map((row) => ({ table_name: 'material_logs', record_id: row.id })),
    ...expenses.filter((row) => row.project_id === selectedProjectId).map((row) => ({ table_name: 'expense_logs', record_id: row.id })),
    ...laborLogs.map((row) => ({ table_name: 'labor_logs', record_id: row.id })),
    ...payments.filter((row) => row.project_id === selectedProjectId).map((row) => ({ table_name: 'payment_logs', record_id: row.id })),
    ...vendorTransactions.map((row) => ({ table_name: 'vendor_transactions', record_id: row.id })),
    ...projectFileBoard.folders.map((row) => ({ table_name: 'project_file_folders', record_id: row.id })),
    ...projectFileBoard.files.map((row) => ({ table_name: 'project_files', record_id: row.id })),
  ], [expenses, laborLogs, materials, payments, projectFileBoard.files, projectFileBoard.folders, projects, selectedProjectId, vendorTransactions]);
  const auditRecordKey = auditRecords.map((row) => `${row.table_name}:${row.record_id}`).join('|');
  const { data: auditActors = {} } = useQuery({
    queryKey: ['audit-actors', auditRecordKey],
    queryFn: () => api.getAuditActors(auditRecords),
    enabled: auditRecords.length > 0,
  });

  function showRecordAudit(tableName: string, recordId: number, label: string) {
    showAudit(auditActors[`${tableName}:${recordId}`] || null, label);
  }

  const [showVendorTransactionModal, setShowVendorTransactionModal] = useState(false);
  const [editingVendorTransactionId, setEditingVendorTransactionId] = useState<number | null>(null);
  const [showVendorEditModal, setShowVendorEditModal] = useState(false);
  const [vendorEditForm, setVendorEditForm] = useState({ id: 0, name: '', phone: '', address: '' });
  const [vendorTransactionForm, setVendorTransactionForm] = useState(emptyVendorTransactionForm);
  const workers = useMemo(() => {
    const map = new Map<string, { id: number; name: string; daily_wage: number }>();
    let i = 1;
    laborLogs.forEach((row) => {
      const key = row.labour_type.trim().toLowerCase();
      if (!key || map.has(key)) return;
      map.set(key, { id: i++, name: row.labour_type, daily_wage: Number(row.wage_per_head || 0) });
    });
    return Array.from(map.values());
  }, [laborLogs]);

  async function resolveVendorId(vendorName: string, currentVendorId = 0, partyType: 'material_vendor' | 'labour_incharge' = 'material_vendor') {
    const cleanName = vendorName.trim();
    if (!cleanName) return currentVendorId || null;
    const existing = vendorMaster.find(
      (vendor) => vendor.party_type === partyType && vendor.name.trim().toLowerCase() === cleanName.toLowerCase(),
    );
    if (existing) return existing.id;
    const created = await api.createVendorMaster({ name: cleanName, party_type: partyType, phone: null, address: null, active: true });
    queryClient.invalidateQueries({ queryKey: ['vendor-master'] });
    return created.id;
  }

  function getVendorName(vendorId?: number | null) {
    if (!vendorId) return '-';
    return vendorMaster.find((vendor) => vendor.id === vendorId)?.name || `Vendor #${vendorId}`;
  }

  function openNewVendorPayment(vendorId = selectedVendorId || 0) {
    if (!canManageVendorTransactions) return;
    setEditingVendorTransactionId(null);
    setVendorTransactionForm({
      ...emptyVendorTransactionForm(),
      vendor_id: vendorId,
    });
    setShowVendorTransactionModal(true);
  }

  function openEditVendorPayment(transactionId: number) {
    if (!canManageVendorTransactions) return;
    const transaction = vendorTransactions.find((item) => item.id === transactionId);
    if (!transaction) return;
    setEditingVendorTransactionId(transaction.id);
    setVendorTransactionForm({
      vendor_id: transaction.vendor_id,
      amount: Number(transaction.amount || 0),
      round_off: Number(transaction.round_off || 0),
      payment_date: transaction.payment_date,
      payment_mode: transaction.payment_mode || '',
      notes: transaction.notes || '',
    });
    setShowVendorTransactionModal(true);
  }

  function openEditLatestVendorPayment(vendorId: number) {
    const latest = vendorTransactions
      .filter((item) => item.vendor_id === vendorId)
      .slice()
      .sort((left, right) => {
        const dateDiff = new Date(right.payment_date).getTime() - new Date(left.payment_date).getTime();
        return dateDiff || right.id - left.id;
      })[0];
    if (!latest) {
      notify.error('No payment recorded yet. Use Pay to add a transaction.');
      return;
    }
    openEditVendorPayment(latest.id);
  }

  function openEditVendor(vendorId: number) {
    const vendor = vendorMaster.find((item) => item.id === vendorId);
    if (!vendor) return;
    setVendorEditForm({
      id: vendor.id,
      name: vendor.name,
      phone: vendor.phone || '',
      address: vendor.address || '',
    });
    setShowVendorEditModal(true);
  }
  const laborCategoryOptions = useMemo(() => {
    const map = new Map<string, string>();
    labourMaster.forEach((row) => {
      const fromRole = (row.role || '').trim();
      const fromName = (row.name || '').trim();
      if (fromRole) map.set(fromRole.toLowerCase(), fromRole);
      if (fromName) map.set(fromName.toLowerCase(), fromName);
    });
    laborLogs.forEach((row) => {
      const trimmed = row.labour_type.trim();
      if (!trimmed) return;
      map.set(trimmed.toLowerCase(), trimmed);
    });
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
  }, [laborLogs, labourMaster]);

  const [projectMaterialForm, setProjectMaterialForm] = useState({
    date: localDateKey(),
    material_name: '',
    vendor_id: 0,
    vendor_name: '',
    unit: '',
    quantity: 0,
    unit_cost: 0,
    supplier: '',
    work_remarks: '',
    bill_no: '',
    gst_percent: 0,
    has_bundle_conversion: false,
    no_of_bundles: 0,
    weight_per_bundle: 0,
    cost_per_kg: 0,
  });
  const [materialsTabSearch, setMaterialsTabSearch] = useState('');
  const [showMaterialsTabSearch, setShowMaterialsTabSearch] = useState(false);
  const [labourTabSearch, setLabourTabSearch] = useState('');
  const [showLabourTabSearch, setShowLabourTabSearch] = useState(false);
  const [expensesTabSearch, setExpensesTabSearch] = useState('');
  const [showExpensesTabSearch, setShowExpensesTabSearch] = useState(false);
  const [transactionsTabSearch, setTransactionsTabSearch] = useState('');
  const [showTransactionsTabSearch, setShowTransactionsTabSearch] = useState(false);

  const [materialsSort, setMaterialsSort] = useState<SortState>({ column: 'date', direction: 'desc' });
  const [labourSort, setLabourSort] = useState<SortState>({ column: 'date', direction: 'desc' });
  const [expensesSort, setExpensesSort] = useState<SortState>({ column: 'date', direction: 'desc' });
  const [transactionsSort, setTransactionsSort] = useState<SortState>({ column: 'date', direction: 'desc' });

  const [materialSearchText, setMaterialSearchText] = useState('');
  const [showMaterialSuggestions, setShowMaterialSuggestions] = useState(false);
  const [showMaterialVendorSuggestions, setShowMaterialVendorSuggestions] = useState(false);
  const [showMaterialEditVendorSuggestions, setShowMaterialEditVendorSuggestions] = useState(false);
  const [showLabourVendorSuggestions, setShowLabourVendorSuggestions] = useState(false);
  const [showLabourEditVendorSuggestions, setShowLabourEditVendorSuggestions] = useState(false);
  const [projectExpenseForm, setProjectExpenseForm] = useState({ date: localDateKey(), category: '', amount: 0, description: '' });
  const [expenseSearchText, setExpenseSearchText] = useState('');
  const [showExpenseSuggestions, setShowExpenseSuggestions] = useState(false);
  const [editingMaterialId, setEditingMaterialId] = useState<number | null>(null);
  const [editingExpenseId, setEditingExpenseId] = useState<number | null>(null);
  const [editingLaborId, setEditingLaborId] = useState<number | null>(null);
  const [selectedMaterialId, setSelectedMaterialId] = useState<number | null>(null);
  const [selectedExpenseId, setSelectedExpenseId] = useState<number | null>(null);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<number[]>([]);
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<number[]>([]);
  const [selectedAttendanceIds, setSelectedAttendanceIds] = useState<number[]>([]);
  const [materialDragSelecting, setMaterialDragSelecting] = useState(false);
  const [labourDragSelecting, setLabourDragSelecting] = useState(false);
  const [expenseDragSelecting, setExpenseDragSelecting] = useState(false);
  const [selectedLaborId, setSelectedLaborId] = useState<number | null>(null);
  const [expandedMaterialId, setExpandedMaterialId] = useState<number | null>(null);
  const [expandedLaborId, setExpandedLaborId] = useState<number | null>(null);
  const [expandedExpenseId, setExpandedExpenseId] = useState<number | null>(null);
  const [materialEditForm, setMaterialEditForm] = useState({
    vendor_id: 0,
    vendor_name: '',
    quantity: 0,
    unit_cost: 0,
    transport_cost: 0,
    supplier: '',
    work_remarks: '',
    bill_no: '',
    total_cft: 0,
    rate_per_cft: 0,
    no_of_loads: 0,
    gst_percent: 0,
    date: '',
    has_bundle_conversion: false,
    no_of_bundles: 0,
    weight_per_bundle: 0,
    cost_per_kg: 0,
  });
  const [expenseEditForm, setExpenseEditForm] = useState({ category: '', amount: 0, description: '', date: '' });
  const [laborEditForm, setLaborEditForm] = useState({
    date: '',
    vendor_id: 0,
    vendor_name: '',
    labour_type: '',
    labour_count: 0,
    wage_per_head: 0,
    overtime_cost: 0,
    overtime_count: 0,
    total_wage: 0,
    remarks: '',
    worker_id: 0,
    status: 'present',
    work_done: '',
    overtime_hours: 0,
  });
  const selectedAttendanceId = selectedLaborId;
  const setSelectedAttendanceId = setSelectedLaborId;
  const editingAttendanceId = editingLaborId;
  const setEditingAttendanceId = setEditingLaborId;
  const expandedAttendanceId = expandedLaborId;
  const setExpandedAttendanceId = setExpandedLaborId;
  const attendanceEditForm = laborEditForm;
  const setAttendanceEditForm = setLaborEditForm;
  const [laborForm, setLaborForm] = useState({
    date: localDateKey(),
    no_of_days: 1,
    vendor_id: 0,
    vendor_name: '',
    labour_type: '',
    labour_count: 0,
    wage_per_head: 0,
    overtime_cost: 0,
    overtime_count: 0,
    total_wage: 0,
    remarks: '',
  });
  const [laborSearchText, setLaborSearchText] = useState('');
  const [showLaborSuggestions, setShowLaborSuggestions] = useState(false);
  const [laborWageSearchText, setLaborWageSearchText] = useState('');
  const [showLaborWageSuggestions, setShowLaborWageSuggestions] = useState(false);

  const combinedMaterialSuggestions = useMemo(() => {
    const map = new Map<string, { id: string | number; name: string; supplier: string; unit: string; default_unit_cost: number; has_bundle_conversion: boolean; default_bundle_weight: number }>();

    const defaultPresets = [
      { name: 'Steel 8mm', unit: 'kg', supplier: 'Steel Supplier', default_unit_cost: 65, has_bundle_conversion: true, default_bundle_weight: 50 },
      { name: 'Steel 10mm', unit: 'kg', supplier: 'Steel Supplier', default_unit_cost: 65, has_bundle_conversion: true, default_bundle_weight: 50 },
      { name: 'Steel 12mm', unit: 'kg', supplier: 'Steel Supplier', default_unit_cost: 65, has_bundle_conversion: true, default_bundle_weight: 50 },
      { name: 'Steel 16mm', unit: 'kg', supplier: 'Steel Supplier', default_unit_cost: 65, has_bundle_conversion: true, default_bundle_weight: 50 },
      { name: 'Cement 53 Grade', unit: 'bags', supplier: 'Cement Supplier', default_unit_cost: 380, has_bundle_conversion: false, default_bundle_weight: 0 },
      { name: 'M-Sand', unit: 'cft', supplier: 'Quarry Supplier', default_unit_cost: 45, has_bundle_conversion: false, default_bundle_weight: 0 },
      { name: 'P-Sand', unit: 'cft', supplier: 'Quarry Supplier', default_unit_cost: 55, has_bundle_conversion: false, default_bundle_weight: 0 },
      { name: 'Red Bricks', unit: 'nos', supplier: 'Brick Kiln', default_unit_cost: 10, has_bundle_conversion: false, default_bundle_weight: 0 },
      { name: 'Blue Metal 20mm', unit: 'cft', supplier: 'Quarry', default_unit_cost: 40, has_bundle_conversion: false, default_bundle_weight: 0 },
    ];

    defaultPresets.forEach((p) => {
      map.set(p.name.toLowerCase().trim(), { id: `preset-${p.name}`, ...p });
    });

    materialMaster.forEach((m) => {
      if (m.name) {
        map.set(m.name.toLowerCase().trim(), {
          id: m.id,
          name: m.name,
          supplier: m.supplier || '',
          unit: m.unit || '',
          default_unit_cost: Number(m.default_unit_cost || 0),
          has_bundle_conversion: Boolean(m.has_bundle_conversion),
          default_bundle_weight: Number(m.default_bundle_weight || 0),
        });
      }
    });

    materials.forEach((m) => {
      if (m.material_name) {
        const key = m.material_name.toLowerCase().trim();
        if (!map.has(key)) {
          map.set(key, {
            id: `log-${m.id}`,
            name: m.material_name,
            supplier: m.supplier || '',
            unit: m.unit || '',
            default_unit_cost: Number(m.unit_cost || 0),
            has_bundle_conversion: Boolean(m.template_meta?.has_bundle_conversion),
            default_bundle_weight: Number(m.template_meta?.weight_per_bundle || 0),
          });
        }
      }
    });

    return Array.from(map.values());
  }, [materialMaster, materials]);
  const wageOptionsForSelectedLabour = useMemo(() => {
    const selected = laborSearchText.trim().toLowerCase();
    if (!selected) return [] as number[];
    const wages = new Set<number>();
    labourMaster.forEach((item) => {
      const role = (item.role || '').trim().toLowerCase();
      const name = (item.name || '').trim().toLowerCase();
      if (role === selected || name === selected) {
        wages.add(Number(item.daily_wage || 0));
        (item.wage_options || []).forEach((w) => wages.add(Number(w || 0)));
      }
    });
    laborLogs.forEach((item) => {
      if ((item.labour_type || '').trim().toLowerCase() === selected) {
        wages.add(Number(item.wage_per_head || 0));
      }
    });
    return Array.from(wages)
      .filter((w) => Number.isFinite(w) && w >= 0)
      .sort((a, b) => b - a);
  }, [laborSearchText, laborLogs, labourMaster]);
  const filteredWageOptions = useMemo(() => {
    const query = laborWageSearchText.trim().toLowerCase();
    if (!query) return wageOptionsForSelectedLabour;
    return wageOptionsForSelectedLabour.filter((w) => String(w).toLowerCase().includes(query));
  }, [wageOptionsForSelectedLabour, laborWageSearchText]);

  const getHighestWageForLabel = (label: string): number => {
    const selected = label.trim().toLowerCase();
    if (!selected) return 0;
    const wages = new Set<number>();
    labourMaster.forEach((item) => {
      const role = (item.role || '').trim().toLowerCase();
      const name = (item.name || '').trim().toLowerCase();
      if (role === selected || name === selected) {
        wages.add(Number(item.daily_wage || 0));
        (item.wage_options || []).forEach((w) => wages.add(Number(w || 0)));
      }
    });
    laborLogs.forEach((item) => {
      if ((item.labour_type || '').trim().toLowerCase() === selected) wages.add(Number(item.wage_per_head || 0));
    });
    const values = Array.from(wages).filter((w) => Number.isFinite(w) && w >= 0);
    return values.length ? Math.max(...values) : 0;
  };
  const createProject = useMutation({
    mutationFn: api.createProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setForm(initialProject);
      setProjectImageFile(null);
      setShowProjectModal(false);
      notify.success('Project created successfully.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to create project.')),
  });


  const updateProjectMutation = useMutation({
    mutationFn: ({ projectId, payload }: { projectId: number; payload: Record<string, unknown> }) => api.updateProject(projectId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project-statement', selectedProjectId] });
      notify.success('Project updated.');
      setEditingProjectId(null);
      setEditProjectImageFile(null);
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to update project.')),
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ projectId, status }: { projectId: number; status: ProjectStatus }) => api.updateProjectStatus(projectId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project-statement', selectedProjectId] });
      notify.success('Project status updated.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to update project status.')),
  });

  const deleteProjectMutation = useMutation({
    mutationFn: ({ projectId, confirmationName }: { projectId: number; confirmationName: string }) => api.deleteProject(projectId, confirmationName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      navigate('/projects');
      setEditingProjectId(null);
      setProjectPendingDeletion(null);
      setDeleteProjectName('');
      notify.success('Project deleted.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to delete project.')),
  });

  const addMaterial = useMutation({
    mutationFn: api.createMaterial,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      queryClient.invalidateQueries({ queryKey: ['project-statement', selectedProjectId] });
      setShowMaterialModal(false);
      notify.success('Material added to project.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to add material.')),
  });

  const addExpense = useMutation({
    mutationFn: api.createExpense,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['project-statement', selectedProjectId] });
      setShowExpenseModal(false);
      notify.success('Expense added to project.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to add expense.')),
  });

  const addLabour = useMutation({
    mutationFn: api.createLaborLog,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['labor-logs', selectedProjectId] });
      queryClient.invalidateQueries({ queryKey: ['project-statement', selectedProjectId] });
      setShowLabourModal(false);
      setLaborSearchText('');
      setLaborWageSearchText('');
      setShowLaborWageSuggestions(false);
      notify.success('Labour entry added to project.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to add labour entry.')),
  });

  const updateMaterial = useMutation({
    mutationFn: ({ materialId, payload }: { materialId: number; payload: Record<string, unknown> }) => api.updateMaterial(materialId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      queryClient.invalidateQueries({ queryKey: ['project-statement', selectedProjectId] });
      setEditingMaterialId(null);
      notify.success('Material updated.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to update material.')),
  });

  const updateExpense = useMutation({
    mutationFn: ({ expenseId, payload }: { expenseId: number; payload: Record<string, unknown> }) => api.updateExpense(expenseId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['project-statement', selectedProjectId] });
      setEditingExpenseId(null);
      notify.success('Expense updated.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to update expense.')),
  });

  const updateAttendance = useMutation({
    mutationFn: ({ attendanceId, payload }: { attendanceId: number; payload: Record<string, unknown> }) => api.updateLaborLog(attendanceId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['labor-logs', selectedProjectId] });
      queryClient.invalidateQueries({ queryKey: ['project-statement', selectedProjectId] });
      setEditingLaborId(null);
      notify.success('Labour entry updated.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to update labour entry.')),
  });
  const deleteMaterial = useMutation({
    mutationFn: api.deleteMaterial,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      queryClient.invalidateQueries({ queryKey: ['project-statement', selectedProjectId] });
      setSelectedMaterialId(null);
      notify.success('Material deleted.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to delete material.')),
  });
  const deleteExpense = useMutation({
    mutationFn: api.deleteExpense,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['project-statement', selectedProjectId] });
      setSelectedExpenseId(null);
      notify.success('Expense deleted.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to delete expense.')),
  });

  const createVendorTransactionMutation = useMutation({
    mutationFn: api.createVendorTransaction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-transactions'] });
      setShowVendorTransactionModal(false);
      setEditingVendorTransactionId(null);
      setVendorTransactionForm(emptyVendorTransactionForm());
      notify.success('Vendor transaction recorded.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to record vendor transaction.')),
  });

  const updateVendorTransactionMutation = useMutation({
    mutationFn: ({ transactionId, payload }: { transactionId: number; payload: Parameters<typeof api.updateVendorTransaction>[1] }) =>
      api.updateVendorTransaction(transactionId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-transactions'] });
      setShowVendorTransactionModal(false);
      setEditingVendorTransactionId(null);
      setVendorTransactionForm(emptyVendorTransactionForm());
      notify.success('Vendor transaction updated.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to update vendor transaction.')),
  });

  const deleteVendorTransactionMutation = useMutation({
    mutationFn: api.deleteVendorTransaction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-transactions'] });
      notify.success('Vendor transaction deleted.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to delete vendor transaction.')),
  });

  const updateVendorMutation = useMutation({
    mutationFn: ({ vendorId, payload }: { vendorId: number; payload: Parameters<typeof api.updateVendorMaster>[1] }) =>
      api.updateVendorMaster(vendorId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-master'] });
      setShowVendorEditModal(false);
      notify.success('Vendor updated.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to update vendor.')),
  });

  const deleteVendorMutation = useMutation({
    mutationFn: api.deleteVendorMaster,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-master'] });
      setSelectedVendorId(null);
      notify.success('Vendor removed from active list.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to delete vendor.')),
  });
  const createProjectFolderMutation = useMutation({
    mutationFn: ({ projectId, name, parentId }: { projectId: number; name: string; parentId: number | null }) =>
      api.createProjectFileFolder(projectId, { name, parent_id: parentId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-files', selectedProjectId] });
      setNewFolderName('');
      notify.success('Folder created.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to create folder.')),
  });
  const renameProjectFolderMutation = useMutation({
    mutationFn: ({ projectId, folderId, name }: { projectId: number; folderId: number; name: string }) =>
      api.renameProjectFileFolder(projectId, folderId, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-files', selectedProjectId] });
      setRenamingFolderId(null);
      setRenameFolderName('');
      notify.success('Folder renamed.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to rename folder.')),
  });
  const deleteProjectFolderMutation = useMutation({
    mutationFn: ({ projectId, folderId }: { projectId: number; folderId: number }) => api.deleteProjectFileFolder(projectId, folderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-files', selectedProjectId] });
      setCurrentFileFolderId(null);
      notify.success('Folder deleted.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to delete folder.')),
  });
  const uploadProjectFileMutation = useMutation({
    mutationFn: ({ projectId, folderId, file }: { projectId: number; folderId: number | null; file: File }) =>
      api.uploadProjectFile(projectId, folderId, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-files', selectedProjectId] });
      notify.success('File uploaded to Supabase Storage.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to upload file.')),
  });
  const deleteProjectFileMutation = useMutation({
    mutationFn: ({ projectId, fileId }: { projectId: number; fileId: number }) => api.deleteProjectFile(projectId, fileId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-files', selectedProjectId] });
      notify.success('File deleted.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to delete file.')),
  });
  const renameProjectFileMutation = useMutation({
    mutationFn: ({ projectId, fileId, name }: { projectId: number; fileId: number; name: string }) =>
      api.renameProjectFile(projectId, fileId, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-files', selectedProjectId] });
      setRenamingFileId(null);
      setRenameFileName('');
      notify.success('File renamed successfully.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to rename file.')),
  });
  const deleteAttendance = useMutation({
    mutationFn: api.deleteLaborLog,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['labor-logs', selectedProjectId] });
      queryClient.invalidateQueries({ queryKey: ['project-statement', selectedProjectId] });
      setSelectedLaborId(null);
      notify.success('Labour entry deleted.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to delete labour entry.')),
  });
  const addLaborLog = useMutation({
    mutationFn: api.createLaborLog,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['labor-logs', selectedProjectId] });
      queryClient.invalidateQueries({ queryKey: ['project-statement', selectedProjectId] });
      notify.success('Labor log added.');
      setLaborForm({
        date: localDateKey(),
        no_of_days: 1,
        vendor_id: 0,
        vendor_name: '',
        labour_type: '',
        labour_count: 0,
        wage_per_head: 0,
        overtime_cost: 0,
        overtime_count: 0,
        total_wage: 0,
        remarks: '',
      });
      setLaborSearchText('');
      setLaborWageSearchText('');
      setShowLaborWageSuggestions(false);
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to add labor log.')),
  });

  useEffect(() => {
    if (!projectImageFile) {
      setProjectImagePreview('');
      return;
    }
    const objectUrl = URL.createObjectURL(projectImageFile);
    setProjectImagePreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [projectImageFile]);

  useEffect(() => {
    if (!editProjectImageFile) {
      setEditProjectImagePreview('');
      return;
    }
    const objectUrl = URL.createObjectURL(editProjectImageFile);
    setEditProjectImagePreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [editProjectImageFile]);

  useEffect(() => {
    setSelectedMaterialId(null);
    setSelectedExpenseId(null);
    setSelectedLaborId(null);
    setSelectedCalendarDate(null);
    setShowCalendarDrawer(false);
    setEditingMaterialId(null);
    setEditingExpenseId(null);
    setEditingLaborId(null);
    setExpandedMaterialId(null);
    setExpandedExpenseId(null);
    setExpandedLaborId(null);
    setCurrentFileFolderId(null);
    setNewFolderName('');
    setRenamingFolderId(null);
    setRenameFolderName('');
    const validSections: SectionKey[] = ['materials', 'labour', 'expenses', 'transactions', 'files'];
    if (selectedProjectId) {
      if (urlTab && validSections.includes(urlTab as SectionKey)) {
        setActiveProjectSection(urlTab as SectionKey);
      } else {
        setActiveProjectSection('materials');
      }
    } else {
      setActiveProjectSection(null);
    }
  }, [selectedProjectId, urlTab]);


  useEffect(() => {
    if (!statement?.project) return;
    setCalendarMonth(getMonthKey(getProjectCalendarEndDate(statement.project)));
  }, [statement?.project.id, statement?.project.start_date, statement?.project.expected_end_date, statement?.project.status]);

  useEffect(() => {
    const count = Number(laborForm.labour_count || 0);
    const wage = Number(laborForm.wage_per_head || 0);
    const days = Math.max(1, Number(laborForm.no_of_days || 1));
    const overtimeCost = Number(laborForm.overtime_count || 0) * wage;
    const total = count * wage * days + overtimeCost;
    if (laborForm.total_wage !== total) {
      setLaborForm((curr) => ({ ...curr, overtime_cost: overtimeCost, total_wage: total }));
    }
  }, [laborForm.labour_count, laborForm.no_of_days, laborForm.overtime_count, laborForm.wage_per_head]);

  useEffect(() => {
    const count = Number(laborEditForm.labour_count || 0);
    const wage = Number(laborEditForm.wage_per_head || 0);
    const overtimeCost = Number(laborEditForm.overtime_count || 0) * wage;
    const total = count * wage + overtimeCost;
    if (laborEditForm.total_wage !== total) {
      setLaborEditForm((curr) => ({ ...curr, overtime_cost: overtimeCost, total_wage: total }));
    }
  }, [laborEditForm.labour_count, laborEditForm.overtime_count, laborEditForm.wage_per_head]);

  const materialEntrySubtotal = projectMaterialForm.has_bundle_conversion
    ? Number(projectMaterialForm.no_of_bundles || 0) * Number(projectMaterialForm.weight_per_bundle || 0) * Number(projectMaterialForm.cost_per_kg || 0)
    : Number(projectMaterialForm.quantity || 0) * Number(projectMaterialForm.unit_cost || 0);
  const materialEntryGst = materialEntrySubtotal * (Number(projectMaterialForm.gst_percent || 0) / 100);
  const materialEntryTotal = materialEntrySubtotal + materialEntryGst;
  const labourEntryNormalWage = Number(laborForm.labour_count || 0) * Number(laborForm.wage_per_head || 0) * Math.max(1, Number(laborForm.no_of_days || 1));
  const labourEntryOtCost = Number(laborForm.overtime_count || 0) * Number(laborForm.wage_per_head || 0);
  const labourEditNormalWage = Number(laborEditForm.labour_count || 0) * Number(laborEditForm.wage_per_head || 0);
  const labourEditOtCost = Number(laborEditForm.overtime_count || 0) * Number(laborEditForm.wage_per_head || 0);
  const materialEditSubtotal = materialEditForm.has_bundle_conversion
    ? Number(materialEditForm.no_of_bundles || 0) * Number(materialEditForm.weight_per_bundle || 0) * Number(materialEditForm.cost_per_kg || 0)
    : Number(materialEditForm.quantity || 0) * Number(materialEditForm.unit_cost || 0);
  const materialEditGst = materialEditSubtotal * (Number(materialEditForm.gst_percent || 0) / 100);
  const materialEditTransport = Number(materialEditForm.transport_cost || 0);
  const materialEditTotal = materialEditSubtotal + materialEditGst + materialEditTransport;

  const filteredProjects = useMemo(() => {
    return projects.filter((project) => {
      const statusOk = statusFilter === 'all' || project.status === statusFilter;
      const searchText = `${project.project_name} ${project.location}`.toLowerCase();
      const searchOk = searchText.includes(search.trim().toLowerCase());
      return statusOk && searchOk;
    });
  }, [projects, search, statusFilter]);

  const selectedMaterials = materials
    .filter((item) => item.project_id === selectedProjectId)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.id - b.id);
  const selectedExpenses = expenses
    .filter((item) => item.project_id === selectedProjectId)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.id - b.id);
  const selectedSiteExpenses = siteExpenses
    .filter((item) => item.allocation === 'project' && item.project_id === selectedProjectId)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.id - b.id);
  const selectedAttendance = laborLogs
    .filter((item) => item.project_id === selectedProjectId)
    .map((item, idx) => ({
      id: item.id,
      project_id: item.project_id,
      vendor_id: item.vendor_id || null,
      worker_id: idx + 1,
      date: item.date,
      status: 'present',
      work_done: item.labour_type,
      overtime_hours: Number(item.overtime_cost || 0),
      total_wage: Number(
        item.total_wage != null
          ? item.total_wage
          : Number(item.labour_count || 0) * Number(item.wage_per_head || 0) + Number(item.overtime_cost || 0)
      ),
      labour_count: Number(item.labour_count || 0),
      wage_per_head: Number(item.wage_per_head || 0),
      remarks: item.remarks || '',
      labour_type: item.labour_type,
    }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.id - b.id);
  const selectedPayments = payments
    .filter((item) => item.project_id === selectedProjectId)
    .sort((a, b) => new Date((a.received_date || a.due_date || '').toString()).getTime() - new Date((b.received_date || b.due_date || '').toString()).getTime() || a.id - b.id);
  const selectedClient = useMemo<Client | null>(() => {
    if (!statement?.project.client_id) return null;
    return clients.find((client) => client.id === statement.project.client_id) || null;
  }, [clients, statement?.project.client_id]);
  const sortedTimeline = (statement?.timeline || []).slice().sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const fileFolders = projectFileBoard.folders;
  const projectFiles = projectFileBoard.files;
  const currentFileFolder = currentFileFolderId ? fileFolders.find((folder) => folder.id === currentFileFolderId) || null : null;
  const visibleFileFolders = fileFolders
    .filter((folder) => (folder.parent_id || null) === currentFileFolderId)
    .sort((a, b) => a.id - b.id);
  const visibleProjectFiles = projectFiles
    .filter((file) => (file.folder_id || null) === currentFileFolderId)
    .sort((a, b) => a.id - b.id);
  const fileBreadcrumbs = useMemo(() => {
    const breadcrumbs: ProjectFileFolder[] = [];
    let cursor = currentFileFolder;
    const guard = new Set<number>();
    while (cursor && !guard.has(cursor.id)) {
      breadcrumbs.unshift(cursor);
      guard.add(cursor.id);
      cursor = cursor.parent_id ? fileFolders.find((folder) => folder.id === cursor?.parent_id) || null : null;
    }
    return breadcrumbs;
  }, [currentFileFolder, fileFolders]);

  const materialSubtotal = selectedMaterials.reduce((sum, item) => sum + calculateMaterialTotal(item), 0);
  const projectExpenseSubtotal = selectedExpenses.reduce((sum, item) => sum + item.amount, 0);
  const siteExpenseSubtotal = selectedSiteExpenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const expenseSubtotal = projectExpenseSubtotal + siteExpenseSubtotal;
  const labourSubtotal = selectedAttendance.reduce((sum, item) => {
    return sum + Number(item.total_wage || 0);
  }, 0);
  const grandTotal = materialSubtotal + labourSubtotal + expenseSubtotal;
  const vendorPaymentsTotal = vendorTransactions.reduce((sum, t) => sum + vendorPaymentTotal(t), 0);
  const vendorRoundOffTotal = vendorTransactions.reduce((sum, t) => sum + Number(t.round_off || 0), 0);
  const vendorBalanceRows = useMemo(() => {
    const map = new Map<
      number,
      { vendorId: number; vendorName: string; materialDue: number; labourDue: number; paid: number; materialCount: number; labourCount: number; paymentCount: number }
    >();

    const ensure = (vendorId: number) => {
      const existing = map.get(vendorId);
      if (existing) return existing;
      const row = {
        vendorId,
        vendorName: vendorId === 0 ? 'Unassigned vendor' : getVendorName(vendorId),
        materialDue: 0,
        labourDue: 0,
        paid: 0,
        materialCount: 0,
        labourCount: 0,
        paymentCount: 0,
      };
      map.set(vendorId, row);
      return row;
    };

    vendorMaster.filter((vendor) => vendor.active).forEach((vendor) => ensure(vendor.id));
    selectedMaterials.forEach((item) => {
      const row = ensure(item.vendor_id || 0);
      row.materialDue += calculateMaterialTotal(item);
      row.materialCount += 1;
    });
    selectedAttendance.forEach((item) => {
      const row = ensure(item.vendor_id || 0);
      row.labourDue += Number(item.total_wage || 0);
      row.labourCount += 1;
    });
    vendorTransactions.forEach((transaction) => {
      const row = ensure(transaction.vendor_id);
      row.paid += vendorPaymentTotal(transaction);
      row.paymentCount += 1;
    });

    return Array.from(map.values())
      .map((row) => {
        const due = row.materialDue + row.labourDue;
        return { ...row, due, difference: row.paid - due };
      })
      .filter((row) => row.due > 0 || row.paid > 0 || row.materialCount > 0 || row.labourCount > 0 || row.paymentCount > 0)
      .sort((a, b) => {
        if (a.vendorId === 0) return 1;
        if (b.vendorId === 0) return -1;
        return a.vendorName.localeCompare(b.vendorName);
      });
  }, [selectedAttendance, selectedMaterials, vendorMaster, vendorTransactions]);
  const labourDueByVendorId = useMemo(() => {
    const map = new Map<number, number>();
    vendorBalanceRows.forEach((row) => map.set(row.vendorId, row.labourDue));
    return map;
  }, [vendorBalanceRows]);
  const labourAddLimitStatus = labourLimitStatus(
    laborForm.vendor_id ? labourLimitByVendorId.get(laborForm.vendor_id) : undefined,
    labourDueByVendorId.get(laborForm.vendor_id) || 0,
    Number(laborForm.total_wage || 0),
  );
  const labourEditOriginal = selectedAttendance.find((item) => item.id === editingLaborId);
  const labourEditBooked = (labourDueByVendorId.get(laborEditForm.vendor_id) || 0) - (
    labourEditOriginal && (labourEditOriginal.vendor_id || 0) === laborEditForm.vendor_id
      ? Number(labourEditOriginal.total_wage || 0)
      : 0
  );
  const labourEditLimitStatus = labourLimitStatus(
    laborEditForm.vendor_id ? labourLimitByVendorId.get(laborEditForm.vendor_id) : undefined,
    labourEditBooked,
    Number(laborEditForm.total_wage || 0),
  );
  const selectedVendorDetail = useMemo(() => {
    if (selectedVendorId === null) return null;
    const vendor = selectedVendorId === 0 ? null : vendorMaster.find((item) => item.id === selectedVendorId) || null;
    const materialsForVendor = selectedMaterials
      .filter((item) => (item.vendor_id || 0) === selectedVendorId)
      .map((item) => ({
        id: item.id,
        date: item.date,
        type: 'Material',
        item: item.material_name,
        quantity: `${Number(item.quantity || 0)} ${item.unit || ''}`.trim(),
        amount: calculateMaterialTotal(item),
        remarks: item.work_remarks || '-',
      }));
    const labourForVendor = selectedAttendance
      .filter((item) => (item.vendor_id || 0) === selectedVendorId)
      .map((item) => ({
        id: item.id,
        date: item.date,
        type: 'Labour',
        item: item.labour_type,
        quantity: `${Number(item.labour_count || 0)} worker${Number(item.labour_count || 0) === 1 ? '' : 's'}`,
        amount: Number(item.total_wage || 0),
        remarks: item.remarks || item.work_done || '-',
      }));
    const paymentsForVendor = vendorTransactions
      .filter((item) => item.vendor_id === selectedVendorId)
      .slice()
      .sort((a, b) => new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime());
    const balance = vendorBalanceRows.find((row) => row.vendorId === selectedVendorId) || null;
    const responsibilityRows = selectedVendorDetailType === 'material' ? materialsForVendor : labourForVendor;
    return {
      vendorId: selectedVendorId,
      vendorName: selectedVendorId === 0 ? 'Unassigned vendor' : vendor?.name || `Vendor #${selectedVendorId}`,
      phone: vendor?.phone || '',
      address: vendor?.address || '',
      detailType: selectedVendorDetailType,
      responsibilityRows: responsibilityRows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
      payments: paymentsForVendor,
      balance,
    };
  }, [selectedVendorId, selectedVendorDetailType, selectedMaterials, selectedAttendance, vendorTransactions, vendorBalanceRows, vendorMaster]);
  function printVendorDetail() {
    if (!selectedVendorDetail || !statement) return;
    const due = selectedVendorDetail.detailType === 'material'
      ? selectedVendorDetail.balance?.materialDue || 0
      : selectedVendorDetail.balance?.labourDue || 0;
    const paid = selectedVendorDetail.balance?.paid || 0;
    const responsibilityRows = selectedVendorDetail.responsibilityRows
      .map((row) => `
        <tr>
          <td>${escapePrintHtml(formatDate(row.date))}</td>
          <td>${escapePrintHtml(row.type)}</td>
          <td>${escapePrintHtml(row.item)}</td>
          <td>${escapePrintHtml(row.quantity)}</td>
          <td class="right">${escapePrintHtml(formatCurrency(row.amount))}</td>
          <td>${escapePrintHtml(row.remarks)}</td>
        </tr>
      `)
      .join('');
    const paymentRows = selectedVendorDetail.payments
      .map((payment) => `
        <tr>
          <td>${escapePrintHtml(formatDate(payment.payment_date))}</td>
          <td>${escapePrintHtml(payment.payment_mode || '-')}</td>
          <td class="right">${escapePrintHtml(formatCurrency(Number(payment.round_off || 0)))}</td>
          <td class="right">${escapePrintHtml(formatCurrency(vendorPaymentTotal(payment)))}</td>
          <td>${escapePrintHtml(payment.notes || '-')}</td>
        </tr>
      `)
      .join('');

    printHtmlDocument(`
      <!doctype html>
      <html>
        <head>
          <title>${escapePrintHtml(selectedVendorDetail.vendorName)}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 10mm; color: #111827; background: #ffffff; }
            * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            h1 { margin: 0 0 4px; font-size: 22px; }
            h1 + .meta { border-top: 3px solid #1f2937; padding-top: 10px; }
            h2 { margin: 18px 0 8px; border-bottom: 2px solid #94a3b8; padding-bottom: 4px; font-size: 15px; text-transform: uppercase; letter-spacing: 0.04em; }
            .meta, .summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 12px 0; }
            .card { border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; background: #f8fafc; }
            .summary .card:nth-child(1) { background: #fff7ed; border-color: #fed7aa; }
            .summary .card:nth-child(2) { background: #f0fdf4; border-color: #bbf7d0; }
            .summary .card:nth-child(3) { background: #fff1f2; border-color: #fecdd3; }
            .summary .card:nth-child(4) { background: #eff6ff; border-color: #bfdbfe; }
            .label { display: block; color: #64748b; font-size: 10px; font-weight: 700; text-transform: uppercase; }
            .value { display: block; margin-top: 3px; font-size: 13px; font-weight: 700; overflow-wrap: anywhere; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 12px; }
            th, td { border: 1px solid #cbd5e1; padding: 6px; text-align: left; vertical-align: top; line-height: 1.3; overflow-wrap: anywhere; }
            th { background: #1f2937; color: #ffffff; }
            tbody tr:nth-child(even) td { background: #f8fafc; }
            .right { text-align: right; }
            @page { size: landscape; margin: 12mm; }
          </style>
        </head>
        <body>
          <h1>${escapePrintHtml(selectedVendorDetail.vendorName)}</h1>
          <div class="meta">
            <div class="card"><span class="label">Project</span><span class="value">${escapePrintHtml(statement.project.project_name)}</span></div>
            <div class="card"><span class="label">Type</span><span class="value">${selectedVendorDetail.detailType === 'material' ? 'Material Vendor' : 'Labour Incharge'}</span></div>
            <div class="card"><span class="label">Phone</span><span class="value">${escapePrintHtml(selectedVendorDetail.phone || '-')}</span></div>
            <div class="card"><span class="label">Address</span><span class="value">${escapePrintHtml(selectedVendorDetail.address || '-')}</span></div>
          </div>
          <div class="summary">
            <div class="card"><span class="label">Due</span><span class="value">${escapePrintHtml(formatCurrency(due))}</span></div>
            <div class="card"><span class="label">Paid</span><span class="value">${escapePrintHtml(formatCurrency(paid))}</span></div>
            <div class="card"><span class="label">Balance</span><span class="value">${escapePrintHtml(formatCurrency(Math.max(due - paid, 0)))}</span></div>
            <div class="card"><span class="label">Payments</span><span class="value">${selectedVendorDetail.payments.length}</span></div>
          </div>
          <h2>${selectedVendorDetail.detailType === 'material' ? 'Material Entries' : 'Labour Entries'}</h2>
          <table>
            <thead><tr><th>Date</th><th>Type</th><th>Item</th><th>Qty</th><th class="right">Amount</th><th>Remarks</th></tr></thead>
            <tbody>${responsibilityRows || '<tr><td colspan="6">No entries found</td></tr>'}</tbody>
          </table>
          <h2>Payments</h2>
          <table>
            <thead><tr><th>Date</th><th>Mode</th><th class="right">Round Off</th><th class="right">Paid</th><th>Remarks</th></tr></thead>
            <tbody>${paymentRows || '<tr><td colspan="5">No payments recorded</td></tr>'}</tbody>
          </table>
        </body>
      </html>
    `);
  }

  function printClientDetail() {
    if (!statement) return;
    const clientName = selectedClient?.name ? `${selectedClient.name}${selectedClient.pan_no || selectedClient.company_name ? ` (${selectedClient.pan_no || selectedClient.company_name})` : ''}` : 'Client';
    const paymentRows = selectedPayments
      .map((payment) => `
        <tr>
          <td>${escapePrintHtml(payment.payment_type)}</td>
          <td class="right">${escapePrintHtml(formatCurrency(payment.amount))}</td>
          <td>${escapePrintHtml(payment.status)}</td>
          <td>${escapePrintHtml(payment.received_date ? formatDate(payment.received_date) : '-')}</td>
          <td>${escapePrintHtml(payment.due_date ? formatDate(payment.due_date) : '-')}</td>
          <td>${escapePrintHtml(payment.notes || '-')}</td>
        </tr>
      `)
      .join('');

    printHtmlDocument(`
      <!doctype html>
      <html>
        <head>
          <title>${escapePrintHtml(clientName)} - Payment Details</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 10mm; color: #111827; background: #ffffff; }
            * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            h1 { margin: 0 0 4px; font-size: 22px; }
            h1 + .meta { border-top: 3px solid #1f2937; padding-top: 10px; }
            .meta, .summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 12px 0; }
            .card { border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; background: #f8fafc; }
            .summary .card:nth-child(1), .summary .card:nth-child(4) { background: #eff6ff; border-color: #bfdbfe; }
            .summary .card:nth-child(2) { background: #f0fdf4; border-color: #bbf7d0; }
            .summary .card:nth-child(3) { background: #fff1f2; border-color: #fecdd3; }
            .label { display: block; color: #64748b; font-size: 10px; font-weight: 700; text-transform: uppercase; }
            .value { display: block; margin-top: 3px; font-size: 13px; font-weight: 700; overflow-wrap: anywhere; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 12px; }
            th, td { border: 1px solid #cbd5e1; padding: 6px; text-align: left; vertical-align: top; line-height: 1.3; overflow-wrap: anywhere; }
            th { background: #1f2937; color: #ffffff; }
            tbody tr:nth-child(even) td { background: #f8fafc; }
            .right { text-align: right; }
            @page { size: landscape; margin: 12mm; }
          </style>
        </head>
        <body>
          <h1>${escapePrintHtml(clientName)}</h1>
          <div class="meta">
            <div class="card"><span class="label">Project</span><span class="value">${escapePrintHtml(statement.project.project_name)}</span></div>
            <div class="card"><span class="label">Phone</span><span class="value">${escapePrintHtml(selectedClient?.phone || '-')}</span></div>
            <div class="card"><span class="label">Email</span><span class="value">${escapePrintHtml(selectedClient?.email || '-')}</span></div>
            <div class="card"><span class="label">GST</span><span class="value">${escapePrintHtml(selectedClient?.gst_number || '-')}</span></div>
          </div>
          <div class="summary">
            <div class="card"><span class="label">Project Amount</span><span class="value">${escapePrintHtml(formatCurrency(statement.project.total_amount || 0))}</span></div>
            <div class="card"><span class="label">Received</span><span class="value">${escapePrintHtml(formatCurrency(statement.metrics.total_received || 0))}</span></div>
            <div class="card"><span class="label">Outstanding</span><span class="value">${escapePrintHtml(formatCurrency(statement.metrics.outstanding || 0))}</span></div>
            <div class="card"><span class="label">Payments</span><span class="value">${selectedPayments.length}</span></div>
          </div>
          <table>
            <thead><tr><th>Type</th><th class="right">Amount</th><th>Status</th><th>Received Date</th><th>Due Date</th><th>Notes</th></tr></thead>
            <tbody>${paymentRows || '<tr><td colspan="6">No payments found</td></tr>'}</tbody>
          </table>
        </body>
      </html>
    `);
  }

  const filteredSelectedExpenses = useMemo(() => {
    if (!expensesTabSearch.trim()) return selectedExpenses;
    const q = expensesTabSearch.trim().toLowerCase();
    return selectedExpenses.filter((item) =>
      (item.category || '').toLowerCase().includes(q) ||
      (item.description || '').toLowerCase().includes(q) ||
      (item.date || '').toLowerCase().includes(q) ||
      String(item.amount || '').includes(q)
    );
  }, [selectedExpenses, expensesTabSearch]);

  const materialVendorRows = vendorBalanceRows.filter((row) => row.materialDue > 0 || row.materialCount > 0);
  const labourInchargeRows = vendorBalanceRows.filter((row) => row.labourDue > 0 || row.labourCount > 0);
  const labourLimitIncharges = useMemo(() => {
    const map = new Map<number, { vendorId: number; vendorName: string; labourDue: number }>();
    labourIncharges.forEach((vendor) => {
      map.set(vendor.id, { vendorId: vendor.id, vendorName: vendor.name, labourDue: labourDueByVendorId.get(vendor.id) || 0 });
    });
    labourInchargeRows.forEach((row) => {
      if (row.vendorId > 0) {
        map.set(row.vendorId, { vendorId: row.vendorId, vendorName: row.vendorName, labourDue: row.labourDue });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.vendorName.localeCompare(b.vendorName));
  }, [labourIncharges, labourInchargeRows, labourDueByVendorId]);

  const filteredMaterialVendorRows = useMemo(() => {
    if (!transactionsTabSearch.trim()) return materialVendorRows;
    const q = transactionsTabSearch.trim().toLowerCase();
    return materialVendorRows.filter((r) =>
      (r.vendorName || '').toLowerCase().includes(q) ||
      formatCurrency(r.materialDue).toLowerCase().includes(q) ||
      formatCurrency(r.paid).toLowerCase().includes(q)
    );
  }, [materialVendorRows, transactionsTabSearch]);

  const filteredLabourInchargeRows = useMemo(() => {
    if (!transactionsTabSearch.trim()) return labourInchargeRows;
    const q = transactionsTabSearch.trim().toLowerCase();
    return labourInchargeRows.filter((r) => {
      const limit = labourLimitByVendorId.get(r.vendorId);
      const status = labourLimitStatus(limit, r.labourDue);
      return (
        (r.vendorName || '').toLowerCase().includes(q) ||
        formatCurrency(r.labourDue).toLowerCase().includes(q) ||
        formatCurrency(r.paid).toLowerCase().includes(q) ||
        (status.hasLimit && (
          formatCurrency(status.limit).toLowerCase().includes(q) ||
          formatCurrency(status.remaining).toLowerCase().includes(q) ||
          q === 'limit' ||
          q === 'over'
        ))
      );
    });
  }, [labourInchargeRows, transactionsTabSearch, labourLimitByVendorId]);

  const sortedSelectedExpenses = useMemo(() => {
    if (!expensesSort) return filteredSelectedExpenses;
    const { column, direction } = expensesSort;
    return filteredSelectedExpenses.slice().sort((a, b) => {
      let left: unknown;
      let right: unknown;
      if (column === 'date') { left = a.date; right = b.date; }
      else if (column === 'category') { left = a.category; right = b.category; }
      else if (column === 'details') { left = a.description; right = b.description; }
      else if (column === 'amount') { left = Number(a.amount || 0); right = Number(b.amount || 0); }
      return compareSortValues(left, right, direction);
    });
  }, [filteredSelectedExpenses, expensesSort]);

  const sortedMaterialVendorRows = useMemo(() => {
    if (!transactionsSort) return filteredMaterialVendorRows;
    const { column, direction } = transactionsSort;
    return filteredMaterialVendorRows.slice().sort((a, b) => {
      let left: unknown;
      let right: unknown;
      if (column === 'vendor') { left = a.vendorName; right = b.vendorName; }
      else if (column === 'paid') { left = a.paid; right = b.paid; }
      else if (column === 'due') { left = a.materialDue; right = b.materialDue; }
      return compareSortValues(left, right, direction);
    });
  }, [filteredMaterialVendorRows, transactionsSort]);

  const sortedLabourInchargeRows = useMemo(() => {
    if (!transactionsSort) return filteredLabourInchargeRows;
    const { column, direction } = transactionsSort;
    return filteredLabourInchargeRows.slice().sort((a, b) => {
      let left: unknown;
      let right: unknown;
      if (column === 'vendor') { left = a.vendorName; right = b.vendorName; }
      else if (column === 'paid') { left = a.paid; right = b.paid; }
      else if (column === 'due') { left = a.labourDue; right = b.labourDue; }
      else if (column === 'limit') { left = labourLimitByVendorId.get(a.vendorId) || 0; right = labourLimitByVendorId.get(b.vendorId) || 0; }
      else if (column === 'balance') {
        left = labourLimitStatus(labourLimitByVendorId.get(a.vendorId), a.labourDue).remaining;
        right = labourLimitStatus(labourLimitByVendorId.get(b.vendorId), b.labourDue).remaining;
      }
      return compareSortValues(left, right, direction);
    });
  }, [filteredLabourInchargeRows, transactionsSort, labourLimitByVendorId]);
  const materialVendorPaymentsTotal = materialVendorRows.reduce((sum, row) => sum + row.paid, 0);
  const labourInchargePaymentsTotal = labourInchargeRows.reduce((sum, row) => sum + row.paid, 0);
  const transactionTotalCost = materialSubtotal + labourSubtotal;
  const transactionTotalPayments = materialVendorPaymentsTotal + labourInchargePaymentsTotal;
  const materialYetToPay = Math.max(materialSubtotal - materialVendorPaymentsTotal, 0);
  const labourYetToPay = Math.max(labourSubtotal - labourInchargePaymentsTotal, 0);
  const transactionYetToPay = Math.max(transactionTotalCost - transactionTotalPayments, 0);
  const vendorDueTotal = vendorBalanceRows.reduce((sum, row) => sum + row.due, 0);
  const vendorMaterialDueTotal = vendorBalanceRows.reduce((sum, row) => sum + row.materialDue, 0);
  const vendorLabourDueTotal = vendorBalanceRows.reduce((sum, row) => sum + row.labourDue, 0);
  const vendorDifferenceTotal = vendorPaymentsTotal - vendorDueTotal;
  const tableSummaryRowClass = 'rounded-md bg-amber-50 px-2 py-1 font-bold text-amber-900';
  const tableGrandRowClass = 'rounded-md bg-indigo-100 px-2 py-1 font-black text-indigo-900';
  const projectCalendar = useMemo(() => {
    if (!statement?.project) {
      return {
        startDate: '',
        endDate: '',
        minMonth: calendarMonth,
        maxMonth: calendarMonth,
        monthKey: calendarMonth,
        monthLabel: formatMonthLabel(calendarMonth),
        days: [] as Array<{ key: string; day: number | null; inRange: boolean; isToday: boolean; isSelected: boolean; isStart: boolean; isEnd: boolean; spent: number; received: number; transactions: CalendarTransaction[] }>,
        selectedDay: null as null | { key: string; spent: number; received: number; transactions: CalendarTransaction[] },
        totals: { spent: 0, received: 0, balance: 0 },
      };
    }

    const startDate = statement.project.start_date;
    const endDate = getProjectCalendarEndDate(statement.project);
    const minMonth = getMonthKey(startDate);
    const maxMonth = getMonthKey(endDate);
    const monthKey = clampMonthKey(calendarMonth, minMonth, maxMonth);
    const [year, month] = monthKey.split('-').map(Number);
    const firstOfMonth = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const leadingBlanks = firstOfMonth.getDay();
    const todayKey = localDateKey();
    const transactions: CalendarTransaction[] = [];

    selectedMaterials.forEach((item) => {
      const amount = calculateMaterialTotal(item);
      transactions.push({
        id: `material-${item.id}`,
        date: item.date,
        direction: 'spent',
        type: 'Material',
        title: item.material_name,
        amount,
        detail: `${Number(item.quantity || 0)} ${item.unit || ''} @ ${formatCurrency(Number(item.unit_cost || 0))}${item.vendor_id ? ` | ${getVendorName(item.vendor_id)}` : ''}`,
      });
    });
    selectedAttendance.forEach((item) => {
      transactions.push({
        id: `labour-${item.id}`,
        date: item.date,
        direction: 'spent',
        type: 'Labour',
        title: item.labour_type,
        amount: Number(item.total_wage || 0),
        detail: `${Number(item.labour_count || 0)} head @ ${formatCurrency(Number(item.wage_per_head || 0))}${item.remarks ? ` | ${item.remarks}` : ''}`,
      });
    });
    selectedExpenses.forEach((item) => {
      transactions.push({
        id: `expense-${item.id}`,
        date: item.date,
        direction: 'spent',
        type: 'Expense',
        title: item.category,
        amount: Number(item.amount || 0),
        detail: item.description || 'Site expense',
      });
    });
    selectedPayments
      .filter((item) => item.status === 'received' && item.received_date)
      .forEach((item) => {
        transactions.push({
          id: `payment-${item.id}`,
          date: item.received_date as string,
          direction: 'received',
          type: 'Client Receipt',
          title: `${item.payment_type} payment`,
          amount: Number(item.amount || 0),
          detail: item.payment_mode || item.notes || 'Received payment',
        });
      });
    (jvLedger?.payments || []).forEach((item) => {
      const shareholder = jvLedger?.shareholders.find((row) => row.shareholder_id === item.shareholder_id);
      transactions.push({
        id: `shareholder-payment-${item.id}`,
        date: item.payment_date,
        direction: 'received',
        type: 'Shareholder Receipt',
        title: shareholder?.name || `Shareholder #${item.shareholder_id}`,
        amount: Number(item.amount || 0),
        detail: item.payment_mode || item.notes || 'JV shareholder payment',
      });
    });
    vendorTransactions.forEach((item) => {
      transactions.push({
        id: `vendor-payment-${item.id}`,
        date: item.payment_date,
        direction: 'cash_out',
        type: 'Vendor Payment',
        title: getVendorName(item.vendor_id),
        amount: vendorPaymentTotal(item),
        detail: item.payment_mode || item.notes || 'Vendor payment recorded',
      });
    });

    const byDate = new Map<string, CalendarTransaction[]>();
    transactions.forEach((item) => {
      const key = item.date.slice(0, 10);
      const list = byDate.get(key) || [];
      list.push(item);
      byDate.set(key, list);
    });

    const days: Array<{ key: string; day: number | null; inRange: boolean; isToday: boolean; isSelected: boolean; isStart: boolean; isEnd: boolean; spent: number; received: number; transactions: CalendarTransaction[] }> = [];
    for (let index = 0; index < leadingBlanks; index += 1) {
      days.push({ key: `blank-start-${index}`, day: null, inRange: false, isToday: false, isSelected: false, isStart: false, isEnd: false, spent: 0, received: 0, transactions: [] });
    }
    for (let dayNumber = 1; dayNumber <= daysInMonth; dayNumber += 1) {
      const key = formatLocalDateKey(new Date(year, month - 1, dayNumber));
      const dayTransactions = (byDate.get(key) || []).sort((a, b) => a.type.localeCompare(b.type));
      const spent = dayTransactions.filter((item) => item.direction === 'spent').reduce((sum, item) => sum + item.amount, 0);
      const received = dayTransactions.filter((item) => item.direction === 'received').reduce((sum, item) => sum + item.amount, 0);
      days.push({
        key,
        day: dayNumber,
        inRange: key >= startDate && key <= endDate,
        isToday: key === todayKey,
        isSelected: key === selectedCalendarDate,
        isStart: key === startDate,
        isEnd: key === endDate,
        spent,
        received,
        transactions: dayTransactions,
      });
    }
    while (days.length % 7 !== 0) {
      days.push({ key: `blank-end-${days.length}`, day: null, inRange: false, isToday: false, isSelected: false, isStart: false, isEnd: false, spent: 0, received: 0, transactions: [] });
    }

    const selectedDayData = selectedCalendarDate
      ? days.find((day) => day.key === selectedCalendarDate && day.day !== null) || null
      : null;
    const rangeTransactions = transactions.filter((item) => item.date.slice(0, 10) >= startDate && item.date.slice(0, 10) <= endDate);
    const totalSpent = rangeTransactions.filter((item) => item.direction === 'spent').reduce((sum, item) => sum + item.amount, 0);
    const totalReceived = rangeTransactions.filter((item) => item.direction === 'received').reduce((sum, item) => sum + item.amount, 0);

    return {
      startDate,
      endDate,
      minMonth,
      maxMonth,
      monthKey,
      monthLabel: formatMonthLabel(monthKey),
      days,
      selectedDay: selectedDayData
        ? { key: selectedDayData.key, spent: selectedDayData.spent, received: selectedDayData.received, transactions: selectedDayData.transactions }
        : null,
      totals: { spent: totalSpent, received: totalReceived, balance: totalReceived - totalSpent },
    };
  }, [
    calendarMonth,
    jvLedger,
    selectedAttendance,
    selectedCalendarDate,
    selectedExpenses,
    selectedMaterials,
    selectedPayments,
    statement?.project,
    vendorMaster,
  ]);

  // Arrow key date navigation when a calendar date is selected
  useEffect(() => {
    if (!selectedCalendarDate) return;

    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.getAttribute('contenteditable') === 'true')
      ) {
        return;
      }

      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        const current = new Date(`${selectedCalendarDate}T00:00:00`);
        if (isNaN(current.getTime())) return;

        let deltaDays = 0;
        if (e.key === 'ArrowLeft') deltaDays = -1;
        if (e.key === 'ArrowRight') deltaDays = 1;
        if (e.key === 'ArrowUp') deltaDays = -7;
        if (e.key === 'ArrowDown') deltaDays = 7;

        current.setDate(current.getDate() + deltaDays);
        const year = current.getFullYear();
        const month = String(current.getMonth() + 1).padStart(2, '0');
        const day = String(current.getDate()).padStart(2, '0');

        const nextDateStr = `${year}-${month}-${day}`;
        const nextMonthStr = `${year}-${month}`;

        if (nextMonthStr !== calendarMonth) {
          setCalendarMonth(nextMonthStr);
        }
        setSelectedCalendarDate(nextDateStr);
      } else if (e.key === 'Escape') {
        setSelectedCalendarDate(null);
        setShowCalendarDrawer(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedCalendarDate, calendarMonth]);

  const dailyTimeline = useMemo(() => {
    if (!statement) return [];

    const timelineByDate = new Map<string, typeof sortedTimeline>();
    sortedTimeline.forEach((item) => {
      const dayKey = toDateOnly(item.date);
      const list = timelineByDate.get(dayKey) || [];
      list.push(item);
      timelineByDate.set(dayKey, list);
    });

    const eventDates = sortedTimeline.map((item) => toDateOnly(item.date));
    const startBoundary = toDateOnly(statement.project.start_date);
    const endBoundaryBase = statement.project.expected_end_date || eventDates[eventDates.length - 1] || startBoundary;
    const endBoundary = toDateOnly(endBoundaryBase);

    if (endBoundary < startBoundary) return [];

    const grouped: Array<{ date: string; isStart: boolean; isEnd: boolean; events: typeof sortedTimeline }> = [];
    let key = startBoundary;
    while (key <= endBoundary) {
      grouped.push({
        date: key,
        isStart: key === startBoundary,
        isEnd: key === endBoundary,
        events: timelineByDate.get(key) || [],
      });
      if (key === endBoundary) break;
      key = addDaysToDateKey(key, 1);
    }

    return grouped;
  }, [sortedTimeline, statement]);

  const timelineSegments = useMemo(() => {
    if (dailyTimeline.length === 0) return [];
    const startIndex = dailyTimeline.findIndex((day) => day.isStart);
    const endIndex = dailyTimeline.findIndex((day) => day.isEnd);
    const first = startIndex >= 0 ? startIndex : 0;
    const last = endIndex >= 0 ? endIndex : dailyTimeline.length - 1;
    const segments: Array<
      | { type: 'boundary'; date: string; label: 'Start' | 'End' | 'Start / End' }
      | { type: 'work'; date: string; events: typeof sortedTimeline }
      | { type: 'gap'; from: string; to: string }
    > = [];

    if (first === last) {
      segments.push({ type: 'boundary', date: dailyTimeline[first].date, label: 'Start / End' });
      return segments;
    }

    segments.push({ type: 'boundary', date: dailyTimeline[first].date, label: 'Start' });

    let i = first + 1;
    while (i < last) {
      const day = dailyTimeline[i];
      if (day.events.length > 0) {
        segments.push({ type: 'work', date: day.date, events: day.events });
        i += 1;
        continue;
      }

      const gapStart = i;
      while (i < last && dailyTimeline[i].events.length === 0) i += 1;
      segments.push({
        type: 'gap',
        from: dailyTimeline[gapStart].date,
        to: dailyTimeline[i - 1].date,
      });
    }

    segments.push({ type: 'boundary', date: dailyTimeline[last].date, label: 'End' });
    return segments;
  }, [dailyTimeline, sortedTimeline]);

  const labourFlatRows = useMemo(() => {
    const rows = selectedAttendance.slice().sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    let previousDate = '';
    return rows.map((item) => {
      const dateKey = item.date.slice(0, 10);
      const showDate = dateKey !== previousDate ? formatDate(dateKey) : '';
      previousDate = dateKey;
      const amount = Number(item.total_wage || 0);
      return {
        id: item.id,
        dateKey,
        showDate,
        labourType: item.labour_type,
        labourCount: Number(item.labour_count || 0),
        wagePerHead: Number(item.wage_per_head || 0),
        otPerHead: Number(item.overtime_hours || 0),
        amount,
        remarks: item.remarks || '-',
        vendorId: item.vendor_id || null,
        vendorName: getVendorName(item.vendor_id),
      };
    });
  }, [selectedAttendance, vendorMaster]);

  function toggleSelectMaterial(id: number) {
    setSelectedMaterialId((current) => current === id ? null : id);
  }
  function toggleSelectAttendance(id: number) {
    setSelectedAttendanceId((current) => current === id ? null : id);
  }
  function toggleSelectExpense(id: number) {
    setSelectedExpenseId((current) => current === id ? null : id);
  }
  function toggleExpandMaterial(id: number) {
    setExpandedMaterialId((current) => current === id ? null : id);
  }
  function toggleExpandAttendance(id: number) {
    setExpandedAttendanceId((current) => current === id ? null : id);
  }
  function toggleExpandExpense(id: number) {
    setExpandedExpenseId((current) => current === id ? null : id);
  }

  const materialInfoRow = selectedMaterials.find((m) => m.id === expandedMaterialId) || null;
  const labourInfoRow = selectedAttendance.find((m) => m.id === expandedLaborId) || null;
  const expenseInfoRow = selectedExpenses.find((m) => m.id === expandedExpenseId) || null;

  const materialAnalytics = useMemo(() => {
    const grouped = new Map<string, { quantity: number; amount: number; unit: string }>();
    selectedMaterials.forEach((item) => {
      const current = grouped.get(item.material_name) || { quantity: 0, amount: 0, unit: item.unit };
      current.quantity += item.quantity;
      current.amount += calculateMaterialTotal(item);
      grouped.set(item.material_name, current);
    });
    return Array.from(grouped.entries()).map(([name, value]) => ({
      name,
      unit: value.unit,
      quantity: value.quantity,
      avgRate: value.quantity > 0 ? value.amount / value.quantity : 0,
      amount: value.amount,
    }));
  }, [selectedMaterials]);

  const labourAnalytics = useMemo(() => {
    const grouped = new Map<number, { name: string; wage: number; shifts: number; overtime: number; amount: number }>();
    selectedAttendance.forEach((item) => {
      const amount = Number(item.total_wage || 0);
      const current = grouped.get(item.worker_id) || { name: item.labour_type || item.work_done || `#${item.worker_id}`, wage: Number(item.wage_per_head || 0), shifts: 0, overtime: 0, amount: 0 };
      current.wage = Number(item.wage_per_head || 0);
      current.shifts += 1;
      current.overtime += item.overtime_hours || 0;
      current.amount += amount;
      grouped.set(item.worker_id, current);
    });
    return Array.from(grouped.values());
  }, [selectedAttendance, workers]);

  const expenseAnalytics = useMemo(() => {
    const grouped = new Map<string, { amount: number; count: number }>();
    selectedExpenses.forEach((item) => {
      const current = grouped.get(item.category) || { amount: 0, count: 0 };
      current.amount += item.amount;
      current.count += 1;
      grouped.set(item.category, current);
    });
    return Array.from(grouped.entries()).map(([category, value]) => ({ category, ...value }));
  }, [selectedExpenses]);

  const expenseGroupsByCategory = useMemo(() => {
    const map = new Map<string, typeof sortedSelectedExpenses>();
    sortedSelectedExpenses.forEach((row) => {
      const key = row.category || 'Uncategorized';
      map.set(key, [...(map.get(key) || []), row]);
    });
    return Array.from(map.entries())
      .map(([categoryKey, rows]) => {
        const totalAmount = rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
        const avgAmount = rows.length > 0 ? totalAmount / rows.length : 0;
        const sortedDates = rows.map((r) => r.date).sort();
        return {
          categoryKey,
          rows,
          totalAmount,
          avgAmount,
          count: rows.length,
          startDate: sortedDates[0] || '',
          endDate: sortedDates[sortedDates.length - 1] || '',
        };
      })
      .sort((a, b) => {
        if (!expensesSort) return a.categoryKey.localeCompare(b.categoryKey);
        const { column, direction } = expensesSort;
        let left: unknown;
        let right: unknown;
        if (column === 'category') { left = a.categoryKey; right = b.categoryKey; }
        else if (column === 'amount') { left = a.totalAmount; right = b.totalAmount; }
        else if (column === 'date') { left = a.startDate; right = b.startDate; }
        return compareSortValues(left, right, direction);
      });
  }, [sortedSelectedExpenses, expensesSort]);

  const expenseGroupsByDate = useMemo(() => {
    const map = new Map<string, typeof sortedSelectedExpenses>();
    sortedSelectedExpenses.forEach((row) => {
      const key = row.date ? formatDate(row.date) : 'Unspecified Date';
      map.set(key, [...(map.get(key) || []), row]);
    });
    return Array.from(map.entries())
      .map(([dateKey, rows]) => {
        const totalAmount = rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
        const avgAmount = rows.length > 0 ? totalAmount / rows.length : 0;
        const primaryCategory = rows[0]?.category || '';
        return {
          dateKey,
          rows,
          totalAmount,
          avgAmount,
          count: rows.length,
          primaryCategory,
        };
      })
      .sort((a, b) => {
        if (!expensesSort) return b.dateKey.localeCompare(a.dateKey);
        const { column, direction } = expensesSort;
        let left: unknown;
        let right: unknown;
        if (column === 'date') { left = a.dateKey; right = b.dateKey; }
        else if (column === 'amount') { left = a.totalAmount; right = b.totalAmount; }
        else if (column === 'category') { left = a.primaryCategory; right = b.primaryCategory; }
        return compareSortValues(left, right, direction);
      });
  }, [sortedSelectedExpenses, expensesSort]);

  const orderedGroupedExpenses = useMemo(() => {
    return expenseGroupsByCategory.flatMap((group) => group.rows);
  }, [expenseGroupsByCategory]);

  const filteredSelectedMaterials = useMemo(() => {
    if (!materialsTabSearch.trim()) return selectedMaterials;
    const q = materialsTabSearch.trim().toLowerCase();
    return selectedMaterials.filter((m) =>
      (m.material_name || '').toLowerCase().includes(q) ||
      (m.bill_no || '').toLowerCase().includes(q) ||
      (m.work_remarks || '').toLowerCase().includes(q) ||
      (m.unit || '').toLowerCase().includes(q) ||
      (m.date || '').toLowerCase().includes(q) ||
      getVendorName(m.vendor_id || 0).toLowerCase().includes(q)
    );
  }, [selectedMaterials, materialsTabSearch, vendorMaster]);

  const sortedFilteredSelectedMaterials = useMemo(() => {
    if (!materialsSort) return filteredSelectedMaterials;
    const { column, direction } = materialsSort;
    return filteredSelectedMaterials.slice().sort((a, b) => {
      let left: unknown;
      let right: unknown;
      if (column === 'date') { left = a.date; right = b.date; }
      else if (column === 'bill_no') { left = a.bill_no; right = b.bill_no; }
      else if (column === 'material') { left = a.material_name; right = b.material_name; }
      else if (column === 'vendor') { left = getVendorName(a.vendor_id || 0); right = getVendorName(b.vendor_id || 0); }
      else if (column === 'qty') { left = Number(a.quantity || 0); right = Number(b.quantity || 0); }
      else if (column === 'rate') { left = Number(a.unit_cost || 0); right = Number(b.unit_cost || 0); }
      else if (column === 'amount') { left = calculateMaterialTotal(a); right = calculateMaterialTotal(b); }
      return compareSortValues(left, right, direction);
    });
  }, [filteredSelectedMaterials, materialsSort, vendorMaster]);

  const materialGroupsByDate = useMemo(() => {
    const map = new Map<string, typeof sortedFilteredSelectedMaterials>();
    sortedFilteredSelectedMaterials.forEach((row) => {
      const key = row.date.slice(0, 10);
      map.set(key, [...(map.get(key) || []), row]);
    });
    return Array.from(map.entries())
      .map(([dateKey, rows]) => {
        const totalQty = rows.reduce((sum, r) => sum + Number(r.quantity || 0), 0);
        const totalAmount = rows.reduce((sum, r) => sum + calculateMaterialTotal(r), 0);
        const avgRate = totalQty > 0 ? totalAmount / totalQty : 0;
        const distinctBills = Array.from(new Set(rows.map((r) => r.bill_no?.trim()).filter(Boolean)));
        const billsCount = distinctBills.length;
        const billSummary = billsCount === 0 ? '-' : billsCount === 1 ? distinctBills[0] : `${billsCount} bills`;
        const distinctMaterials = Array.from(new Set(rows.map((r) => r.material_name?.trim()).filter(Boolean)));
        const materialSummary = distinctMaterials.length === 1 ? distinctMaterials[0] : `${distinctMaterials.length} materials`;
        const distinctVendors = Array.from(new Set(rows.map((r) => getVendorName(r.vendor_id || 0)?.trim()).filter(Boolean)));
        const vendorSummary = distinctVendors.length === 1 ? distinctVendors[0] : `${distinctVendors.length} vendors`;
        const primaryMaterial = rows[0]?.material_name || '';
        const primaryVendor = getVendorName(rows[0]?.vendor_id || 0);
        return {
          dateKey,
          rows,
          totalQty,
          totalAmount,
          avgRate,
          billsCount,
          billSummary,
          materialSummary,
          vendorSummary,
          primaryMaterial,
          primaryVendor,
        };
      })
      .sort((a, b) => {
        if (!materialsSort) return new Date(a.dateKey).getTime() - new Date(b.dateKey).getTime();
        const { column, direction } = materialsSort;
        let left: unknown;
        let right: unknown;
        if (column === 'date') { left = a.dateKey; right = b.dateKey; }
        else if (column === 'qty') { left = a.totalQty; right = b.totalQty; }
        else if (column === 'rate') { left = a.avgRate; right = b.avgRate; }
        else if (column === 'amount') { left = a.totalAmount; right = b.totalAmount; }
        else if (column === 'material') { left = a.primaryMaterial; right = b.primaryMaterial; }
        else if (column === 'vendor') { left = a.primaryVendor; right = b.primaryVendor; }
        else if (column === 'bill_no') { left = a.billsCount; right = b.billsCount; }
        return compareSortValues(left, right, direction);
      });
  }, [sortedFilteredSelectedMaterials, materialsSort, vendorMaster]);

  const materialGroupsByMaterial = useMemo(() => {
    const map = new Map<string, typeof sortedFilteredSelectedMaterials>();
    sortedFilteredSelectedMaterials.forEach((row) => {
      const key = (row.material_name || 'Unspecified').trim().toLowerCase();
      map.set(key, [...(map.get(key) || []), row]);
    });
    return Array.from(map.entries())
      .map(([materialKey, rows]) => {
        const materialName = rows[0]?.material_name || 'Unspecified';
        const totalQty = rows.reduce((sum, r) => sum + Number(r.quantity || 0), 0);
        const totalAmount = rows.reduce((sum, r) => sum + calculateMaterialTotal(r), 0);
        const avgRate = totalQty > 0 ? totalAmount / totalQty : 0;
        const distinctBills = Array.from(new Set(rows.map((r) => r.bill_no?.trim()).filter(Boolean)));
        const billsCount = distinctBills.length;
        const billSummary = billsCount === 0 ? '-' : billsCount === 1 ? distinctBills[0] : `${billsCount} bills`;
        const distinctVendors = Array.from(new Set(rows.map((r) => getVendorName(r.vendor_id || 0)?.trim()).filter(Boolean)));
        const vendorSummary = distinctVendors.length === 1 ? distinctVendors[0] : `${distinctVendors.length} vendors`;
        const sortedDates = rows.map((r) => r.date.slice(0, 10)).sort();
        const startDate = sortedDates[0] || '';
        const endDate = sortedDates[sortedDates.length - 1] || '';
        const dateSummary = startDate === endDate ? (startDate ? formatDate(startDate) : '-') : formatDateRange(startDate, endDate);
        const distinctUnits = Array.from(new Set(rows.map((r) => r.unit?.trim()).filter(Boolean)));
        const unitSummary = distinctUnits.length === 1 ? distinctUnits[0] : '';
        return {
          materialKey,
          materialName,
          rows,
          totalQty,
          totalAmount,
          avgRate,
          billsCount,
          billSummary,
          vendorSummary,
          dateSummary,
          startDate,
          endDate,
          unitSummary,
        };
      })
      .sort((a, b) => {
        if (!materialsSort) return a.materialName.localeCompare(b.materialName);
        const { column, direction } = materialsSort;
        let left: unknown;
        let right: unknown;
        if (column === 'material') { left = a.materialName; right = b.materialName; }
        else if (column === 'date') { left = a.startDate; right = b.startDate; }
        else if (column === 'qty') { left = a.totalQty; right = b.totalQty; }
        else if (column === 'rate') { left = a.avgRate; right = b.avgRate; }
        else if (column === 'amount') { left = a.totalAmount; right = b.totalAmount; }
        else if (column === 'bill_no') { left = a.billsCount; right = b.billsCount; }
        else if (column === 'vendor') { left = a.vendorSummary; right = b.vendorSummary; }
        return compareSortValues(left, right, direction);
      });
  }, [sortedFilteredSelectedMaterials, materialsSort, vendorMaster]);

  const materialGroupsByVendor = useMemo(() => {
    const map = new Map<number, typeof sortedFilteredSelectedMaterials>();
    sortedFilteredSelectedMaterials.forEach((row) => {
      const vendorId = row.vendor_id || 0;
      map.set(vendorId, [...(map.get(vendorId) || []), row]);
    });
    return Array.from(map.entries())
      .map(([vendorId, rows]) => {
        const vendorName = vendorId === 0 ? 'Unassigned vendor' : getVendorName(vendorId);
        const totalQty = rows.reduce((sum, r) => sum + Number(r.quantity || 0), 0);
        const totalAmount = rows.reduce((sum, r) => sum + calculateMaterialTotal(r), 0);
        const avgRate = totalQty > 0 ? totalAmount / totalQty : 0;
        const distinctBills = Array.from(new Set(rows.map((r) => r.bill_no?.trim()).filter(Boolean)));
        const billsCount = distinctBills.length;
        const billSummary = billsCount === 0 ? '-' : billsCount === 1 ? distinctBills[0] : `${billsCount} bills`;
        const distinctMaterials = Array.from(new Set(rows.map((r) => r.material_name?.trim()).filter(Boolean)));
        const materialSummary = distinctMaterials.length === 1 ? distinctMaterials[0] : `${distinctMaterials.length} materials`;
        const sortedDates = rows.map((r) => r.date.slice(0, 10)).sort();
        const startDate = sortedDates[0] || '';
        const endDate = sortedDates[sortedDates.length - 1] || '';
        const dateSummary = startDate === endDate ? (startDate ? formatDate(startDate) : '-') : formatDateRange(startDate, endDate);
        return {
          vendorKey: String(vendorId),
          vendorId,
          vendorName,
          rows,
          totalQty,
          totalAmount,
          avgRate,
          billsCount,
          billSummary,
          materialSummary,
          dateSummary,
          startDate,
          endDate,
        };
      })
      .sort((a, b) => {
        if (!materialsSort) {
          if (a.vendorId === 0) return 1;
          if (b.vendorId === 0) return -1;
          return a.vendorName.localeCompare(b.vendorName);
        }
        const { column, direction } = materialsSort;
        let left: unknown;
        let right: unknown;
        if (column === 'vendor') { left = a.vendorName; right = b.vendorName; }
        else if (column === 'date') { left = a.startDate; right = b.startDate; }
        else if (column === 'qty') { left = a.totalQty; right = b.totalQty; }
        else if (column === 'rate') { left = a.avgRate; right = b.avgRate; }
        else if (column === 'amount') { left = a.totalAmount; right = b.totalAmount; }
        else if (column === 'bill_no') { left = a.billsCount; right = b.billsCount; }
        else if (column === 'material') { left = a.materialSummary; right = b.materialSummary; }
        return compareSortValues(left, right, direction);
      });
  }, [sortedFilteredSelectedMaterials, vendorMaster, materialsSort]);

  const vendorTransactionGroupsByDate = useMemo(() => {
    const map = new Map<string, typeof vendorTransactions>();
    vendorTransactions.forEach((row) => {
      const key = row.payment_date ? row.payment_date.slice(0, 10) : '';
      map.set(key, [...(map.get(key) || []), row]);
    });
    return Array.from(map.entries()).sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime());
  }, [vendorTransactions]);

  const vendorTransactionGroupsByVendor = useMemo(() => {
    const map = new Map<number, typeof vendorTransactions>();
    vendorTransactions.forEach((row) => {
      map.set(row.vendor_id, [...(map.get(row.vendor_id) || []), row]);
    });
    return Array.from(map.entries())
      .map(([vendorId, rows]) => {
        const vendor = vendorMaster.find((item) => item.id === vendorId);
        const sortedRows = rows.slice().sort((a, b) => new Date(a.payment_date).getTime() - new Date(b.payment_date).getTime() || a.id - b.id);
        return {
          vendorKey: String(vendorId),
          vendorName: vendor?.name || `Vendor #${vendorId}`,
          rows: sortedRows,
          totalAmount: sortedRows.reduce((sum, row) => sum + vendorPaymentTotal(row), 0),
          totalRoundOff: sortedRows.reduce((sum, row) => sum + Number(row.round_off || 0), 0),
          startDate: sortedRows[0]?.payment_date?.slice(0, 10) || '',
          endDate: sortedRows[sortedRows.length - 1]?.payment_date?.slice(0, 10) || '',
        };
      })
      .sort((a, b) => a.vendorName.localeCompare(b.vendorName));
  }, [vendorMaster, vendorTransactions]);

  const filteredVendorTransactionGroupsByDate = useMemo(() => {
    if (!transactionsTabSearch.trim()) return vendorTransactionGroupsByDate;
    const q = transactionsTabSearch.trim().toLowerCase();
    return vendorTransactionGroupsByDate
      .map(([dateKey, rows]) => {
        const matchingRows = rows.filter((txn) => {
          const vendor = vendorMaster.find((v) => v.id === txn.vendor_id);
          const vendorName = vendor?.name || `Vendor #${txn.vendor_id}`;
          return (
            (dateKey || '').toLowerCase().includes(q) ||
            vendorName.toLowerCase().includes(q) ||
            (txn.payment_mode || '').toLowerCase().includes(q) ||
            (txn.notes || '').toLowerCase().includes(q) ||
            String(txn.amount || 0).includes(q) ||
            String(txn.round_off || 0).includes(q)
          );
        });
        return [dateKey, matchingRows] as [string, typeof rows];
      })
      .filter(([, rows]) => rows.length > 0);
  }, [transactionsTabSearch, vendorTransactionGroupsByDate, vendorMaster]);

  const filteredVendorTransactionGroupsByVendor = useMemo(() => {
    if (!transactionsTabSearch.trim()) return vendorTransactionGroupsByVendor;
    const q = transactionsTabSearch.trim().toLowerCase();
    return vendorTransactionGroupsByVendor
      .map((group) => {
        const matchingRows = group.rows.filter((txn) => {
          return (
            group.vendorName.toLowerCase().includes(q) ||
            (txn.payment_date || '').toLowerCase().includes(q) ||
            (txn.payment_mode || '').toLowerCase().includes(q) ||
            (txn.notes || '').toLowerCase().includes(q) ||
            String(txn.amount || 0).includes(q) ||
            String(txn.round_off || 0).includes(q)
          );
        });
        return {
          ...group,
          rows: matchingRows,
          totalAmount: matchingRows.reduce((sum, row) => sum + vendorPaymentTotal(row), 0),
          totalRoundOff: matchingRows.reduce((sum, row) => sum + Number(row.round_off || 0), 0),
        };
      })
      .filter((group) => group.rows.length > 0);
  }, [transactionsTabSearch, vendorTransactionGroupsByVendor]);

  const filteredLabourFlatRows = useMemo(() => {
    if (!labourTabSearch.trim()) return labourFlatRows;
    const q = labourTabSearch.trim().toLowerCase();
    return labourFlatRows.filter((r) =>
      (r.labourType || '').toLowerCase().includes(q) ||
      (r.vendorName || '').toLowerCase().includes(q) ||
      (r.remarks || '').toLowerCase().includes(q) ||
      (r.dateKey || '').toLowerCase().includes(q) ||
      (r.showDate || '').toLowerCase().includes(q)
    );
  }, [labourFlatRows, labourTabSearch]);

  const sortedFilteredLabourFlatRows = useMemo(() => {
    if (!labourSort) return filteredLabourFlatRows;
    const { column, direction } = labourSort;
    return filteredLabourFlatRows.slice().sort((a, b) => {
      let left: unknown;
      let right: unknown;
      if (column === 'date') { left = a.dateKey; right = b.dateKey; }
      else if (column === 'worker') { left = a.vendorName; right = b.vendorName; }
      else if (column === 'type') { left = a.labourType; right = b.labourType; }
      else if (column === 'rate') { left = Number(a.wagePerHead || 0); right = Number(a.wagePerHead || 0); }
      else if (column === 'amount') { left = Number(a.amount || 0); right = Number(a.amount || 0); }
      return compareSortValues(left, right, direction);
    });
  }, [filteredLabourFlatRows, labourSort]);

  const labourGroupsByDate = useMemo(() => {
    const map = new Map<string, typeof sortedFilteredLabourFlatRows>();
    sortedFilteredLabourFlatRows.forEach((row) => {
      map.set(row.dateKey, [...(map.get(row.dateKey) || []), row]);
    });
    return Array.from(map.entries())
      .map(([dateKey, rows]) => {
        const totalCount = rows.reduce((sum, r) => sum + Number(r.labourCount || 0), 0);
        const totalAmount = rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
        const avgWage = totalCount > 0 ? totalAmount / totalCount : 0;
        const totalOT = rows.reduce((sum, r) => sum + Number(r.otPerHead || 0), 0);
        const primaryCategory = rows[0]?.labourType || '';
        const primaryIncharge = rows[0]?.vendorName || '';
        return {
          dateKey,
          rows,
          totalCount,
          totalAmount,
          avgWage,
          totalOT,
          primaryCategory,
          primaryIncharge,
        };
      })
      .sort((a, b) => {
        if (!labourSort) return new Date(a.dateKey).getTime() - new Date(b.dateKey).getTime();
        const { column, direction } = labourSort;
        let left: unknown;
        let right: unknown;
        if (column === 'date') { left = a.dateKey; right = b.dateKey; }
        else if (column === 'type') { left = a.primaryCategory; right = b.primaryCategory; }
        else if (column === 'rate') { left = a.avgWage; right = b.avgWage; }
        else if (column === 'amount') { left = a.totalAmount; right = b.totalAmount; }
        else if (column === 'worker') { left = a.primaryIncharge; right = b.primaryIncharge; }
        return compareSortValues(left, right, direction);
      });
  }, [sortedFilteredLabourFlatRows, labourSort]);

  const labourGroupsByMonth = useMemo(() => {
    const monthMap = new Map<string, {
      monthKey: string;
      monthLabel: string;
      totalAmount: number;
      totalCount: number;
      weeks: Map<string, {
        weekKey: string;
        weekLabel: string;
        totalAmount: number;
        totalCount: number;
        dates: Map<string, typeof filteredLabourFlatRows>;
        startDate: string;
        endDate: string;
      }>;
    }>();

    filteredLabourFlatRows.forEach((row) => {
      const monthKey = getMonthKey(row.dateKey);
      const weekKey = getWeekKey(row.dateKey);
      const monthEntry = monthMap.get(monthKey) || {
        monthKey,
        monthLabel: formatMonthLabel(monthKey),
        totalAmount: 0,
        totalCount: 0,
        weeks: new Map(),
      };
      const weekEntry = monthEntry.weeks.get(weekKey) || {
        weekKey,
        weekLabel: formatWeekLabel(weekKey),
        totalAmount: 0,
        totalCount: 0,
        dates: new Map(),
        startDate: row.dateKey,
        endDate: row.dateKey,
      };

      monthEntry.totalAmount += row.amount;
      monthEntry.totalCount += row.labourCount;
      weekEntry.totalAmount += row.amount;
      weekEntry.totalCount += row.labourCount;
      weekEntry.dates.set(row.dateKey, [...(weekEntry.dates.get(row.dateKey) || []), row]);
      weekEntry.startDate = weekEntry.startDate === '' ? row.dateKey : weekEntry.startDate < row.dateKey ? weekEntry.startDate : row.dateKey;
      weekEntry.endDate = weekEntry.endDate === '' ? row.dateKey : weekEntry.endDate > row.dateKey ? weekEntry.endDate : row.dateKey;
      monthEntry.weeks.set(weekKey, weekEntry);
      monthMap.set(monthKey, monthEntry);
    });

    return Array.from(monthMap.values())
      .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
      .map((monthEntry) => ({
        ...monthEntry,
        weeks: Array.from(monthEntry.weeks.values())
          .sort((a, b) => a.weekKey.localeCompare(b.weekKey))
          .map((weekEntry) => ({
            ...weekEntry,
            dates: Array.from(weekEntry.dates.entries()).sort((a, b) => a[0].localeCompare(b[0])),
          })),
      }));
  }, [labourFlatRows]);

  const labourGroupsByLabour = useMemo(() => {
    const labourMap = new Map<string, {
      labourType: string;
      totalAmount: number;
      totalCount: number;
      rows: typeof labourFlatRows;
    }>();

    labourFlatRows.forEach((row) => {
      const key = row.labourType.trim() || 'Unknown';
      const labourEntry = labourMap.get(key) || {
        labourType: key,
        totalAmount: 0,
        totalCount: 0,
        rows: [],
      };
      labourEntry.totalAmount += row.amount;
      labourEntry.totalCount += row.labourCount;
      labourEntry.rows.push(row);
      labourMap.set(key, labourEntry);
    });

    return Array.from(labourMap.values())
      .map((entry) => ({
        ...entry,
        rows: entry.rows.sort((a, b) => new Date(a.dateKey).getTime() - new Date(b.dateKey).getTime() || a.id - b.id),
      }))
      .sort((a, b) => a.labourType.localeCompare(b.labourType));
  }, [filteredLabourFlatRows]);

  const labourGroupsByIncharge = useMemo(() => {
    const map = new Map<string, typeof filteredLabourFlatRows>();
    filteredLabourFlatRows.forEach((row) => {
      const key = String(row.vendorId || 0);
      map.set(key, [...(map.get(key) || []), row]);
    });
    return Array.from(map.entries())
      .map(([inchargeKey, rows]) => {
        const sortedRows = rows.slice().sort((a, b) => new Date(a.dateKey).getTime() - new Date(b.dateKey).getTime() || a.id - b.id);
        const inchargeId = Number(inchargeKey);
        return {
          inchargeKey,
          inchargeName: inchargeId === 0 ? 'Unassigned incharge' : getVendorName(inchargeId),
          rows: sortedRows,
          totalCount: sortedRows.reduce((sum, row) => sum + row.labourCount, 0),
          totalAmount: sortedRows.reduce((sum, row) => sum + row.amount, 0),
        };
      })
      .sort((a, b) => {
        if (a.inchargeKey === '0') return 1;
        if (b.inchargeKey === '0') return -1;
        return a.inchargeName.localeCompare(b.inchargeName);
      });
  }, [filteredLabourFlatRows, vendorMaster]);

  const overallProjectInsights = useMemo(() => {
    const totalShifts = selectedAttendance.length;
    const uniqueLabours = new Set(selectedAttendance.map((entry) => entry.worker_id)).size;
    const totalMaterialQty = selectedMaterials.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const avgMaterialRate = totalMaterialQty > 0
      ? selectedMaterials.reduce((sum, item) => sum + calculateMaterialTotal(item), 0) / totalMaterialQty
      : 0;
    const spendVsQuotePct = statement?.project.total_amount
      ? (grandTotal / Number(statement.project.total_amount)) * 100
      : 0;
    const receivedVsQuotePct = statement?.project.total_amount
      ? (Number(statement.metrics.total_received || 0) / Number(statement.project.total_amount)) * 100
      : 0;
    const topExpense = expenseAnalytics.slice().sort((a, b) => b.amount - a.amount)[0] || null;
    const topMaterial = materialAnalytics.slice().sort((a, b) => b.amount - a.amount)[0] || null;
    const labourShare = grandTotal > 0 ? (labourSubtotal / grandTotal) * 100 : 0;
    const materialShare = grandTotal > 0 ? (materialSubtotal / grandTotal) * 100 : 0;
    const expenseShare = grandTotal > 0 ? (expenseSubtotal / grandTotal) * 100 : 0;
    return {
      totalShifts,
      uniqueLabours,
      totalMaterialQty,
      avgMaterialRate,
      spendVsQuotePct,
      receivedVsQuotePct,
      topExpense,
      topMaterial,
      labourShare,
      materialShare,
      expenseShare,
    };
  }, [
    selectedAttendance,
    selectedMaterials,
    statement,
    grandTotal,
    expenseAnalytics,
    materialAnalytics,
    labourSubtotal,
    materialSubtotal,
    expenseSubtotal,
  ]);
  const summaryRows = useMemo(() => {
    const items = [
      { key: 'materials', label: 'Material Subtotal', value: materialSubtotal },
      { key: 'labour', label: 'Labour Subtotal', value: labourSubtotal },
      { key: 'expenses', label: 'Expense Subtotal', value: expenseSubtotal },
    ];
    const currentKey = activeProjectSection || 'materials';
    const ordered = [
      ...items.filter((item) => item.key === currentKey),
      ...items.filter((item) => item.key !== currentKey),
      { key: 'grand-total', label: 'Grand Total', value: grandTotal },
    ];
    return ordered;
  }, [activeProjectSection, materialSubtotal, labourSubtotal, expenseSubtotal, grandTotal]);

  useEffect(() => {
    const stopDragging = () => {
      setMaterialDragSelecting(false);
      setLabourDragSelecting(false);
      setExpenseDragSelecting(false);
    };
    window.addEventListener('mouseup', stopDragging);
    return () => window.removeEventListener('mouseup', stopDragging);
  }, []);

  useEffect(() => {
    setSelectedMaterialIds((current) => current.filter((id) => selectedMaterials.some((item) => item.id === id)));
    if (selectedMaterialId && !selectedMaterials.some((item) => item.id === selectedMaterialId)) {
      setSelectedMaterialId(null);
    }
  }, [selectedMaterials, selectedMaterialId]);

  useEffect(() => {
    setSelectedAttendanceIds((current) => current.filter((id) => selectedAttendance.some((item) => item.id === id)));
    if (selectedAttendanceId && !selectedAttendance.some((item) => item.id === selectedAttendanceId)) {
      setSelectedAttendanceId(null);
    }
  }, [selectedAttendance, selectedAttendanceId]);

  useEffect(() => {
    setSelectedExpenseIds((current) => current.filter((id) => selectedExpenses.some((item) => item.id === id)));
    if (selectedExpenseId && !selectedExpenses.some((item) => item.id === selectedExpenseId)) {
      setSelectedExpenseId(null);
    }
  }, [selectedExpenses, selectedExpenseId]);

  function addUniqueSelection(setter: Dispatch<SetStateAction<number[]>>, id: number) {
    setter((current) => (current.includes(id) ? current : [...current, id]));
  }

  function beginMaterialSelection(id: number, additive: boolean) {
    setSelectedMaterialId(id);
    if (additive) addUniqueSelection(setSelectedMaterialIds, id);
    else setSelectedMaterialIds([id]);
    setMaterialDragSelecting(true);
  }

  function beginLabourSelection(id: number, additive: boolean) {
    setSelectedAttendanceId(id);
    if (additive) addUniqueSelection(setSelectedAttendanceIds, id);
    else setSelectedAttendanceIds([id]);
    setLabourDragSelecting(true);
  }

  function beginExpenseSelection(id: number, additive: boolean) {
    setSelectedExpenseId(id);
    if (additive) addUniqueSelection(setSelectedExpenseIds, id);
    else setSelectedExpenseIds([id]);
    setExpenseDragSelecting(true);
  }

  function handleMaterialArrowNavigation(direction: 'up' | 'down', event: KeyboardEvent<HTMLDivElement>) {
    const ordered = selectedMaterials.slice().sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    if (!ordered.length) return;
    const currentIndex = ordered.findIndex((item) => item.id === selectedMaterialId);
    const fallbackIndex = direction === 'down' ? 0 : ordered.length - 1;
    const nextIndex = currentIndex === -1
      ? fallbackIndex
      : direction === 'down'
        ? Math.min(ordered.length - 1, currentIndex + 1)
        : Math.max(0, currentIndex - 1);
    const nextId = ordered[nextIndex]?.id;
    if (!nextId) return;
    setSelectedMaterialId(nextId);
    if (event.shiftKey) addUniqueSelection(setSelectedMaterialIds, nextId);
    else setSelectedMaterialIds([nextId]);
  }

  function handleLabourArrowNavigation(direction: 'up' | 'down', event: KeyboardEvent<HTMLDivElement>) {
    const ordered = selectedAttendance.slice().sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    if (!ordered.length) return;
    const currentIndex = ordered.findIndex((item) => item.id === selectedAttendanceId);
    const fallbackIndex = direction === 'down' ? 0 : ordered.length - 1;
    const nextIndex = currentIndex === -1
      ? fallbackIndex
      : direction === 'down'
        ? Math.min(ordered.length - 1, currentIndex + 1)
        : Math.max(0, currentIndex - 1);
    const nextId = ordered[nextIndex]?.id;
    if (!nextId) return;
    setSelectedAttendanceId(nextId);
    if (event.shiftKey) addUniqueSelection(setSelectedAttendanceIds, nextId);
    else setSelectedAttendanceIds([nextId]);
  }

  function handleExpenseArrowNavigation(direction: 'up' | 'down', event: KeyboardEvent<HTMLDivElement>) {
    const list = expenseGroupMode === 'category' ? orderedGroupedExpenses : filteredSelectedExpenses;
    if (!list.length) return;
    const currentIndex = list.findIndex((item) => item.id === selectedExpenseId);
    const fallbackIndex = direction === 'down' ? 0 : list.length - 1;
    const nextIndex = currentIndex === -1
      ? fallbackIndex
      : direction === 'down'
        ? Math.min(list.length - 1, currentIndex + 1)
        : Math.max(0, currentIndex - 1);
    const nextId = list[nextIndex]?.id;
    if (!nextId) return;
    setSelectedExpenseId(nextId);
    if (event.shiftKey) addUniqueSelection(setSelectedExpenseIds, nextId);
    else setSelectedExpenseIds([nextId]);
  }

  function handleProjectSectionClick(section: SectionKey) {
    if (section === 'materials' && !canViewProjectMaterials) return;
    if (section === 'labour' && !canViewProjectLabour) return;
    if (section === 'expenses' && !canViewProjectExpenses) return;
    if (section === 'transactions' && !canViewProjectTransactions) return;
    if (section === 'files' && !canViewProjectFiles) return;

    setActiveProjectSection(section);
    if (selectedProjectId) {
      const slug = urlProjectSlug || slugify(statement?.project?.project_name);
      navigate(`/projects/${selectedProjectId}/${slug}/${section}`);
    }
  }

  function openDescriptionModal() {
    setProjectDescriptionDraft(statement?.project.description || '');
    setIsDescriptionEditing(false);
    setShowDescriptionModal(true);
  }

  async function saveProjectDescription() {
    if (!statement) return;
    try {
      await updateProjectMutation.mutateAsync({
        projectId: statement.project.id,
        payload: {
          client_id: statement.project.client_id || null,
          project_name: statement.project.project_name,
          description: projectDescriptionDraft.trim() || null,
          profile_image_url: statement.project.profile_image_url || null,
          location: statement.project.location,
          start_date: statement.project.start_date,
          expected_end_date: statement.project.expected_end_date || null,
          estimated_cost: statement.project.estimated_cost || 0,
          construction_sqft: statement.project.construction_sqft || 0,
          construction_rate_per_sqft: statement.project.construction_rate_per_sqft || 0,
          status: statement.project.status,
          existing_shareholders_count: statement.project.existing_shareholders_count || 0,
          new_shareholders_count: statement.project.new_shareholders_count || 0,
        },
      });
      setIsDescriptionEditing(false);
      setShowDescriptionModal(false);
    } catch {
      // The mutation's onError notification handles the user-facing message.
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const upload = projectImageFile ? await api.uploadProjectImage(projectImageFile) : null;
    await createProject.mutateAsync({
      ...form,
      client_id: null,
      description: form.description.trim() || null,
      profile_image_url: upload?.url || form.profile_image_url || null,
      estimated_cost: Number((Number(form.construction_sqft || 0) * Number(form.construction_rate_per_sqft || 0)).toFixed(2)),
      construction_sqft: Number(form.construction_sqft || 0),
      construction_rate_per_sqft: Number(form.construction_rate_per_sqft || 0),
      expected_end_date: form.expected_end_date || null,
    });
  }

  function openPrintableStatement() {
    if (!statement) return;
    const params = new URLSearchParams();
    Object.entries(printOptions).forEach(([key, value]) => {
      if (value) params.set(key, '1');
    });
    if (user?.role === 'supervisor') params.set('role', 'supervisor');
    navigate(`/projects/${statement.project.id}/statement-document?${params.toString()}`);
  }

  function formatFileSize(value: number) {
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  function compressionLabel(file: ProjectFile) {
    if (!file.original_size) return 'Compressed';
    const ratio = Math.max(0, Math.round((1 - file.compressed_size / file.original_size) * 100));
    return ratio > 0 ? `${ratio}% smaller` : 'Stored compressed';
  }

  function formatFileBytes(bytes?: number) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  }

  async function handleViewProjectFile(file: ProjectFile) {
    const projectId = file.project_id || selectedProjectId;
    if (!projectId) return;
    try {
      const blob = await api.viewProjectFile(projectId, file.id);
      const url = URL.createObjectURL(blob);
      setPreviewingFile({ file, url });
    } catch (error) {
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosErr = error as any;
        const detail = await parseBlobErrorMessage(axiosErr.response?.data);
        if (detail) {
          notify.error(detail);
          return;
        }
      }
      notify.error(getApiErrorMessage(error, 'Unable to open file preview.'));
    }
  }

  async function handleDownloadProjectFile(file: ProjectFile) {
    const projectId = file.project_id || selectedProjectId;
    if (!projectId) return;
    try {
      const blob = await api.downloadProjectFile(projectId, file.id);
      const savedPath = await downloadBlob(blob, file.original_filename);
      if (savedPath) notify.success(`Downloaded to ${savedPath}`);
      else notify.success(`Downloaded "${file.original_filename}"`);
    } catch (error) {
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosErr = error as any;
        const detail = await parseBlobErrorMessage(axiosErr.response?.data);
        if (detail) {
          notify.error(detail);
          return;
        }
      }
      notify.error(getApiErrorMessage(error, 'Unable to download file.'));
    }
  }

  async function handlePrintProjectFile(file: ProjectFile) {
    const projectId = file.project_id || selectedProjectId;
    if (!projectId) return;
    try {
      const blob = await api.viewProjectFile(projectId, file.id);
      const url = URL.createObjectURL(blob);
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.src = url;
      document.body.appendChild(iframe);
      iframe.onload = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          openBlob(blob, file.original_filename);
        }
        setTimeout(() => {
          iframe.remove();
          URL.revokeObjectURL(url);
        }, 60000);
      };
      notify.success(`Preparing "${file.original_filename}" for printing...`);
    } catch (error) {
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosErr = error as any;
        const detail = await parseBlobErrorMessage(axiosErr.response?.data);
        if (detail) {
          notify.error(detail);
          return;
        }
      }
      notify.error(getApiErrorMessage(error, 'Unable to print file.'));
    }
  }

  function uploadProjectFiles(files: File[] | FileList | null) {
    if (!selectedProjectId || !files?.length) return;
    Array.from(files).forEach((file) => {
      uploadProjectFileMutation.mutate({ projectId: selectedProjectId, folderId: currentFileFolderId, file });
    });
  }

  function handleProjectFileInput(files: FileList | null) {
    uploadProjectFiles(files);
  }

  function handleProjectFilePaste(event: ClipboardEvent<HTMLDivElement>) {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return;
    event.preventDefault();
    uploadProjectFiles(files);
  }

  function handleProjectFileDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsFileDropActive(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;
    uploadProjectFiles(files);
  }

  async function submitLabourEntries() {
    if (!selectedProjectId || !laborForm.labour_type.trim() || labourSubmitting) return;
    const days = Math.max(1, Math.floor(Number(laborForm.no_of_days || 1)));
    const count = Number(laborForm.labour_count || 0);
    const wage = Number(laborForm.wage_per_head || 0);
    const overtimeCost = Number(laborForm.overtime_count || 0) * wage;
    const totalOvertime = overtimeCost;
    const perDayOvertime = days > 0 ? totalOvertime / days : 0;
    const perDayTotal = count * wage + perDayOvertime;

    setLabourSubmitting(true);
    try {
      const vendorId = await resolveVendorId(laborForm.vendor_name, laborForm.vendor_id, 'labour_incharge');
      const limitVendorId = vendorId || 0;
      const warning = labourLimitWarningMessage(
        laborForm.vendor_name,
        labourLimitStatus(labourLimitByVendorId.get(limitVendorId), labourDueByVendorId.get(limitVendorId) || 0, Number(laborForm.total_wage || 0)),
      );
      if (warning) notify.warning(warning);
      for (let index = 0; index < days; index += 1) {
        await api.createLaborLog({
          project_id: selectedProjectId,
          vendor_id: vendorId,
          date: addDaysToDateKey(laborForm.date, index),
          labour_type: laborForm.labour_type.trim(),
          labour_count: count,
          wage_per_head: wage,
          overtime_cost: perDayOvertime,
          total_wage: perDayTotal > 0 ? perDayTotal : null,
          remarks: laborForm.remarks || null,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['labor-logs', selectedProjectId] });
      queryClient.invalidateQueries({ queryKey: ['project-statement', selectedProjectId] });
      setShowLabourModal(false);
      setLaborForm({
        date: localDateKey(),
        no_of_days: 1,
        vendor_id: 0,
        vendor_name: '',
        labour_type: '',
        labour_count: 0,
        wage_per_head: 0,
        overtime_cost: 0,
        overtime_count: 0,
        total_wage: 0,
        remarks: '',
      });
      setLaborSearchText('');
      setLaborWageSearchText('');
      setShowLaborWageSuggestions(false);
      notify.success(days === 1 ? 'Labour entry added to project.' : `${days} labour entries added to project.`);
    } catch (error) {
      notify.error(getApiErrorMessage(error, 'Unable to add labour entries.'));
    } finally {
      setLabourSubmitting(false);
    }
  }

  function startMaterialEdit(item: typeof selectedMaterials[number]) {
    setEditingMaterialId(item.id);
    const meta = (item.template_meta || {}) as Record<string, unknown>;
    const hasBundle = Boolean(meta.has_bundle_conversion);
    setMaterialEditForm({
      vendor_id: item.vendor_id || 0,
      vendor_name: getVendorName(item.vendor_id) === '-' ? '' : getVendorName(item.vendor_id),
      quantity: Number(item.quantity),
      unit_cost: Number(item.unit_cost),
      transport_cost: Number(item.transport_cost || 0),
      supplier: item.supplier || '',
      work_remarks: item.work_remarks || '',
      bill_no: item.bill_no || '',
      total_cft: Number(item.total_cft || 0),
      rate_per_cft: Number(item.rate_per_cft || 0),
      no_of_loads: Number(item.no_of_loads || 0),
      gst_percent: Number(item.gst_percent || 0),
      date: item.date.slice(0, 10),
      has_bundle_conversion: hasBundle,
      no_of_bundles: Number(meta.no_of_bundles || 0),
      weight_per_bundle: Number(meta.weight_per_bundle || 0),
      cost_per_kg: Number(meta.cost_per_kg || item.unit_cost || 0),
    });
    setShowMaterialEditModal(true);
  }

  function startExpenseEdit(item: typeof selectedExpenses[number]) {
    setEditingExpenseId(item.id);
    setExpenseEditForm({
      category: item.category,
      amount: Number(item.amount),
      description: item.description || '',
      date: item.date.slice(0, 10),
    });
    setShowExpenseEditModal(true);
  }

  function startAttendanceEdit(item: typeof selectedAttendance[number]) {
    setEditingLaborId(item.id);
    setLaborEditForm({
      date: item.date.slice(0, 10),
      vendor_id: item.vendor_id || 0,
      vendor_name: getVendorName(item.vendor_id) === '-' ? '' : getVendorName(item.vendor_id),
      labour_type: item.labour_type || item.work_done || '',
      labour_count: Number(item.labour_count || 0),
      wage_per_head: Number(item.wage_per_head || 0),
      overtime_cost: Number(item.overtime_hours || 0),
      overtime_count: Number(item.wage_per_head || 0) > 0 ? Number(item.overtime_hours || 0) / Number(item.wage_per_head || 0) : 0,
      total_wage: Number(item.total_wage || 0),
      remarks: item.remarks || '',
      worker_id: item.worker_id || 0,
      status: 'present',
      work_done: item.work_done || '',
      overtime_hours: Number(item.overtime_hours || 0),
    });
    setShowLabourEditModal(true);
  }

  return (
    <div className="min-w-0 space-y-3 pb-2">
      {!selectedProjectId ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-clay">Reports & Masters · Cost Centers</p>
            <h1 className="mt-1 font-display text-3xl text-graphite">Cost Centers / Jobs</h1>
            <p className="mt-1 text-sm font-medium text-slate-500">
              Track job costing, project-level budgets, inventory allocations, workforce registers, and profitability.
            </p>
          </div>
          {canCreateEditProject ? (
            <button
              type="button"
              className="rounded-xl bg-graphite px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-black"
              onClick={() => setShowProjectModal(true)}
            >
              + New Cost Center / Job
            </button>
          ) : null}
        </div>
      ) : null}

      {!selectedProjectId ? (
        <SectionCard title="Cost Centers & Jobs Directory">
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <input placeholder="Search by project or location" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | ProjectStatus)}>
              <option value="all">All statuses</option>
              <option value="upcoming">Upcoming</option>
              <option value="ongoing">Ongoing</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          <div className="grid gap-3">
            {filteredProjects.map((project) => (
              <button
                key={project.id}
                type="button"
                className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md"
                onClick={() => {
                  const slug = slugify(project.project_name);
                  navigate(`/projects/${project.id}/${slug}/materials`);
                }}
                onMouseEnter={() => showRecordAudit('projects', project.id, 'Project')}
                onMouseLeave={hideAudit}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <ProjectImage
                      src={resolveProjectImageUrl(project.profile_image_url)}
                      alt={project.project_name}
                      containerClassName="flex h-24 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 relative"
                      iconClassName="h-10 w-10 text-slate-400"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-xl font-bold text-graphite">{project.project_name}</p>
                      <p className="mt-1 text-base text-slate-600">{project.location}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                        <span className="rounded-md bg-slate-100 px-2.5 py-1 font-semibold">Start: {formatDate(project.start_date)}</span>
                        {isOwner ? <span className="rounded-md bg-indigo-50 px-2.5 py-1 font-semibold text-indigo-700">Total Project Budget: {formatCurrency(project.total_amount)}</span> : null}
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyle[project.status]}`}>{project.status}</span>
                      </div>
                    </div>
                  </div>
                  {canCreateEditProject ? (
                    <div className="flex flex-col items-end gap-2">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100"
                        onClick={(event) => {
                          event.stopPropagation();
                          navigate(`/projects/${project.id}/analytics`);
                        }}
                      >
                        <BarChart3 className="h-4 w-4" />
                        Analytics
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-graphite px-3 py-1.5 text-sm font-semibold text-graphite hover:bg-slate-50"
                        onClick={(event) => {
                          event.stopPropagation();
                          setEditingProjectId(project.id);
                          setEditForm({
                            project_name: project.project_name,
                            description: project.description || '',
                            profile_image_url: project.profile_image_url || '',
                            location: project.location,
                            start_date: project.start_date,
                            expected_end_date: project.expected_end_date || '',
                            construction_sqft: Number(project.construction_sqft || 0),
                            construction_rate_per_sqft: Number(project.construction_rate_per_sqft || 0),
                            status: project.status,
                          });
                          setEditProjectImageFile(null);
                        }}
                      >
                        Edit
                      </button>
                    </div>
                  ) : null}
                </div>
              </button>
            ))}
          </div>

        </SectionCard>
      ) : null}

      <ProjectEntryModal
        open={Boolean(editingProjectId)}
        title="Edit Project Details"
        subtitle="Update project specifications, timeline, area measurements, or 3D plan image."
        icon={<Pencil className="h-6 w-6 text-indigo-600" />}
        onClose={() => setEditingProjectId(null)}
        footer={(
          <>
            {canDeleteProject ? (
              <button
                type="button"
                className="rounded-xl border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-bold text-red-700 transition hover:bg-red-100 mr-auto"
                onClick={() => {
                  const project = projects.find((item) => item.id === editingProjectId);
                  if (!project) return;
                  setDeleteProjectName('');
                  setProjectPendingDeletion({ id: project.id, name: project.project_name });
                }}
              >
                Delete Project
              </button>
            ) : null}
            <button
              type="button"
              className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
              onClick={() => setEditingProjectId(null)}
              disabled={updateProjectMutation.isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="edit-project-form"
              className="rounded-xl bg-graphite px-6 py-2.5 text-sm font-extrabold text-white shadow-md transition hover:bg-black disabled:opacity-50"
              disabled={updateProjectMutation.isPending}
            >
              {updateProjectMutation.isPending ? 'Updating…' : 'Save Changes'}
            </button>
          </>
        )}
      >
        <form id="edit-project-form" className="space-y-5" onSubmit={async (e) => {
          e.preventDefault();
          const base = projects.find((p) => p.id === editingProjectId);
          if (!base) return;
          const upload = editProjectImageFile ? await api.uploadProjectImage(editProjectImageFile) : null;
          updateProjectMutation.mutate({
            projectId: editingProjectId as number,
            payload: {
              client_id: base.client_id,
              project_name: editForm.project_name,
              description: editForm.description.trim() || null,
              profile_image_url: upload?.url || editForm.profile_image_url || null,
              location: editForm.location,
              start_date: editForm.start_date,
              expected_end_date: editForm.expected_end_date || null,
              estimated_cost: Number((Number(editForm.construction_sqft || 0) * Number(editForm.construction_rate_per_sqft || 0)).toFixed(2)),
              construction_sqft: Number(editForm.construction_sqft || 0),
              construction_rate_per_sqft: Number(editForm.construction_rate_per_sqft || 0),
              status: editForm.status,
              existing_shareholders_count: base.existing_shareholders_count || 0,
              new_shareholders_count: base.new_shareholders_count || 0,
            },
          });
        }}>
          {/* Project Profile */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-200/80 pb-2">
              <Building2 className="h-4 w-4 text-indigo-600" />
              <span className="text-xs font-black uppercase tracking-wider text-slate-700">Project Information</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <RequiredLabel label="Project Name" required filled={Boolean(editForm.project_name.trim())} />
                <input
                  value={editForm.project_name}
                  onChange={(e) => setEditForm((c) => ({ ...c, project_name: e.target.value }))}
                  placeholder="Project name"
                  required
                />
              </div>
              <div>
                <RequiredLabel label="Location" required filled={Boolean(editForm.location.trim())} />
                <input
                  value={editForm.location}
                  onChange={(e) => setEditForm((c) => ({ ...c, location: e.target.value }))}
                  placeholder="Location / Address"
                  required
                />
              </div>
              <div className="sm:col-span-2">
                <RequiredLabel label="Description" filled={Boolean(editForm.description.trim())} />
                <textarea
                  rows={2}
                  value={editForm.description}
                  onChange={(e) => setEditForm((c) => ({ ...c, description: e.target.value }))}
                  placeholder="Project scope or notes"
                />
              </div>
            </div>
          </div>

          {/* Project Image */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
            <div className="flex items-center gap-2 border-b border-slate-200/80 pb-2">
              <UploadCloud className="h-4 w-4 text-indigo-600" />
              <span className="text-xs font-black uppercase tracking-wider text-slate-700">Building Image (3D Render)</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-[130px_1fr] items-center">
              <ProjectImage
                src={editProjectImagePreview || resolveProjectImageUrl(editForm.profile_image_url)}
                alt="Project preview"
                containerClassName="flex h-24 w-full items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs relative"
                iconClassName="h-10 w-10 text-slate-300"
              />
              <div className="space-y-2">
                <input
                  type="file"
                  accept="image/*"
                  className="text-xs text-slate-600 file:mr-3 file:rounded-xl file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-indigo-700 hover:file:bg-indigo-100"
                  onChange={(event) => setEditProjectImageFile(event.target.files?.[0] || null)}
                />
                <div className="flex flex-wrap gap-2">
                  {editProjectImageFile ? (
                    <button type="button" className="text-xs font-bold text-slate-700 hover:underline" onClick={() => setEditProjectImageFile(null)}>Clear Selected</button>
                  ) : null}
                  {editForm.profile_image_url ? (
                    <button type="button" className="text-xs font-bold text-red-600 hover:underline" onClick={() => { setEditProjectImageFile(null); setEditForm((c) => ({ ...c, profile_image_url: '' })); }}>Remove Image</button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          {/* Timeline & Status */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-200/80 pb-2">
              <CalendarDays className="h-4 w-4 text-indigo-600" />
              <span className="text-xs font-black uppercase tracking-wider text-slate-700">Timeline & Status</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <RequiredLabel label="Start Date" required filled={Boolean(editForm.start_date)} />
                <input
                  type="date"
                  value={editForm.start_date}
                  max={editForm.expected_end_date || undefined}
                  onChange={(e) => setEditForm((c) => ({ ...c, start_date: e.target.value }))}
                  required
                />
              </div>
              <div>
                <RequiredLabel label="Expected End Date" filled={Boolean(editForm.expected_end_date)} />
                <input
                  type="date"
                  value={editForm.expected_end_date}
                  min={editForm.start_date || undefined}
                  onChange={(e) => setEditForm((c) => ({ ...c, expected_end_date: e.target.value }))}
                />
              </div>
              <div>
                <RequiredLabel label="Status" required filled={Boolean(editForm.status)} />
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm((c) => ({ ...c, status: e.target.value as ProjectStatus }))}
                >
                  <option value="upcoming">Upcoming</option>
                  <option value="ongoing">Ongoing</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
            </div>
          </div>

          {/* Budget Setup */}
          <div className="rounded-2xl border border-emerald-200/90 bg-emerald-50/40 p-4 space-y-4">
            <div className="flex items-center justify-between border-b border-emerald-200/80 pb-2">
              <div className="flex items-center gap-2">
                <Banknote className="h-4 w-4 text-emerald-700" />
                <span className="text-xs font-black uppercase tracking-wider text-emerald-950">Area & Budget Calculation</span>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <RequiredLabel label="Total Area (Sq.ft)" required filled={editForm.construction_sqft > 0} />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={numberFieldValue(editForm.construction_sqft)}
                  onChange={(e) => setEditForm((c) => ({ ...c, construction_sqft: parseNumberInput(e.target.value) }))}
                  placeholder="0.00"
                  required
                />
              </div>
              <div>
                <RequiredLabel label="Project Rate per Sq.ft" required filled={editForm.construction_rate_per_sqft > 0} />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={numberFieldValue(editForm.construction_rate_per_sqft)}
                  onChange={(e) => setEditForm((c) => ({ ...c, construction_rate_per_sqft: parseNumberInput(e.target.value) }))}
                  placeholder="4500"
                  required
                />
              </div>
              <div className="sm:col-span-2 rounded-xl border border-emerald-300 bg-emerald-100/80 p-3 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-900">Total Project Budget:</span>
                <span className="text-lg font-black text-emerald-950">
                  {formatCurrency(Number(editForm.construction_sqft || 0) * Number(editForm.construction_rate_per_sqft || 0))}
                </span>
              </div>
            </div>
          </div>
        </form>
      </ProjectEntryModal>

      {selectedProjectId && statementLoading ? (
        <BuildingLoader label="Loading Project Workspace..." sublabel="Fetching materials, labour, expenses and project ledger..." />
      ) : null}

      {statement ? (
        <div className="animate-fade-in flex min-h-0 min-w-0 flex-col gap-3">
          {/* Main Header & Workspace Setup */}
          <div className="flex flex-col gap-2 rounded-2xl border border-slate-100 bg-white p-3 sm:p-3.5 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Left: Back + Title + Status + Description Icon */}
              <div className="flex items-center gap-3 min-w-0 flex-wrap" onMouseEnter={() => showRecordAudit('projects', statement.project.id, 'Project')} onMouseLeave={hideAudit}>
                <button
                  className="group flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition-all hover:bg-graphite hover:text-white shrink-0 shadow-2xs active:scale-95"
                  onClick={() => { navigate('/projects'); }}
                  title="Back to Projects"
                  aria-label="Back to Projects"
                >
                  <span className="text-xl leading-none transition-transform group-hover:-translate-x-0.5">←</span>
                </button>

                <h2 className="text-xl sm:text-2xl font-black tracking-tight text-graphite truncate max-w-md">
                  {statement.project.project_name}
                </h2>

                {/* Enhanced Status Selector Component */}
                <div
                  className={clsx(
                    "relative inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 transition-all shadow-xs shrink-0 cursor-pointer group",
                    statement.project.status === 'ongoing' && "border-amber-300 bg-amber-50/90 text-amber-950 hover:bg-amber-100/90 hover:border-amber-400",
                    statement.project.status === 'completed' && "border-emerald-300 bg-emerald-50/90 text-emerald-950 hover:bg-emerald-100/90 hover:border-emerald-400",
                    statement.project.status === 'upcoming' && "border-sky-300 bg-sky-50/90 text-sky-950 hover:bg-sky-100/90 hover:border-sky-400",
                  )}
                >
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span
                      className={clsx(
                        "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
                        statement.project.status === 'ongoing' ? 'bg-amber-400' : statement.project.status === 'completed' ? 'bg-emerald-400' : 'bg-sky-400'
                      )}
                    />
                    <span
                      className={clsx(
                        "relative inline-flex h-2 w-2 rounded-full",
                        statement.project.status === 'ongoing' ? 'bg-amber-500' : statement.project.status === 'completed' ? 'bg-emerald-500' : 'bg-sky-500'
                      )}
                    />
                  </span>

                  <select
                    className="h-auto !w-auto min-w-0 cursor-pointer appearance-none !border-0 !bg-transparent !p-0 pr-4 text-xs font-black uppercase tracking-wider text-inherit !shadow-none outline-none !ring-0 focus:!border-transparent focus:outline-none focus:!ring-0"
                    value={statement.project.status}
                    onChange={(e) => updateStatusMutation.mutate({ projectId: statement.project.id, status: e.target.value as ProjectStatus })}
                    title="Click to update project status"
                  >
                    <option value="upcoming" className="bg-white text-slate-800 font-bold">Upcoming</option>
                    <option value="ongoing" className="bg-white text-slate-800 font-bold">Ongoing</option>
                    <option value="completed" className="bg-white text-slate-800 font-bold">Completed</option>
                  </select>

                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 opacity-60 group-hover:opacity-100 transition-opacity" />
                </div>

                {/* Description Icon Button */}
                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50/90 text-indigo-700 transition-all hover:bg-indigo-100 hover:border-indigo-300 hover:text-indigo-900 shadow-xs active:scale-95 shrink-0"
                  onClick={openDescriptionModal}
                  title="Project Description"
                  aria-label="Project Description"
                >
                  <FileText className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Right: Action Buttons & 3-Dots Menu */}
              <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
                {isOwner ? (
                  <button
                    className="inline-flex h-9 sm:h-10 items-center gap-2 rounded-xl bg-clay px-3.5 sm:px-4 text-xs sm:text-sm font-extrabold text-[color:var(--on-accent)] shadow-xs ring-1 ring-white/60 transition-all hover:bg-brand active:scale-95"
                    onClick={() => navigate(`/projects/${statement.project.id}/analytics`)}
                  >
                    <BarChart3 className="h-4 w-4" />
                    Analytics
                  </button>
                ) : null}
                {isOwner ? (
                  <button
                    className="inline-flex h-9 sm:h-10 items-center gap-2 rounded-xl border border-amber-300/90 bg-amber-50 px-3.5 sm:px-4 text-xs sm:text-sm font-extrabold text-amber-900 shadow-xs transition-all hover:bg-amber-100/90 active:scale-95"
                    onClick={() => setShowCalendarDrawer(true)}
                  >
                    <CalendarDays className="h-4 w-4 text-amber-700" />
                    Calendar
                  </button>
                ) : null}
                <button
                  className="inline-flex h-9 sm:h-10 items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/90 px-3.5 sm:px-4 text-xs sm:text-sm font-extrabold text-indigo-700 shadow-xs transition-all hover:bg-indigo-100 hover:border-indigo-300 active:scale-95"
                  onClick={() => setShowPrintOptions((v) => !v)}
                >
                  <Printer className="h-4 w-4 text-indigo-600" />
                  Print Report
                </button>

                {/* 3-dots Menu for Edit & Delete */}
                <div className="relative" ref={projectHeaderMenuRef}>
                  <button
                    type="button"
                    className={`flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl border transition shadow-xs active:scale-95 ${
                      projectHeaderMenuOpen
                        ? 'border-indigo-400 bg-indigo-50/60 text-indigo-950 ring-2 ring-indigo-500/20'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                    onClick={() => setProjectHeaderMenuOpen((v) => !v)}
                    aria-label="More options"
                    title="More options"
                  >
                    <MoreVertical className="h-4.5 w-4.5" />
                  </button>

                  {projectHeaderMenuOpen && (
                    <div className="absolute right-0 top-11 z-[120] w-48 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1.5 text-slate-900 shadow-2xl animate-in fade-in zoom-in-95 duration-100">
                      <button
                        type="button"
                        className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
                        onClick={() => {
                          setProjectHeaderMenuOpen(false);
                          setEditingProjectId(statement.project.id);
                          setEditForm({
                            project_name: statement.project.project_name,
                            description: statement.project.description || '',
                            profile_image_url: statement.project.profile_image_url || '',
                            location: statement.project.location,
                            start_date: statement.project.start_date,
                            expected_end_date: statement.project.expected_end_date || '',
                            construction_sqft: Number(statement.project.construction_sqft || 0),
                            construction_rate_per_sqft: Number(statement.project.construction_rate_per_sqft || 0),
                            status: statement.project.status,
                          });
                          setEditProjectImageFile(null);
                        }}
                      >
                        <Pencil className="h-4 w-4 text-slate-500" />
                        Edit Project Details
                      </button>

                      {canDeleteProject && (
                        <>
                          <div className="my-1 border-t border-slate-100" />
                          <button
                            type="button"
                            className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-xs font-bold text-rose-600 hover:bg-rose-50 transition"
                            onClick={() => {
                              setProjectHeaderMenuOpen(false);
                              setDeleteProjectName('');
                              setProjectPendingDeletion({ id: statement.project.id, name: statement.project.project_name });
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-rose-500" />
                            Delete Project
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Sub-row: Location, Dates, Financials */}
            <div className="flex flex-wrap items-center gap-2 text-xs border-t border-slate-100/80 pt-2">
              {statement.project.location ? (
                <p className="font-semibold text-slate-500">{statement.project.location}</p>
              ) : null}
              <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                <CalendarDays className="h-3.5 w-3.5 text-slate-500" />Start: {formatDate(statement.project.start_date)}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                <CalendarDays className="h-3.5 w-3.5 text-slate-500" />End: {formatDate(statement.project.expected_end_date)}
              </span>
              {isOwner ? (
                <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                  Total Amount: {formatCurrency(statement.project.total_amount)}
                </span>
              ) : null}
              {isOwner ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition"
                  onClick={() => setShowPaymentsModal(true)}
                >
                  <CircleDollarSign className="h-3.5 w-3.5" /> Received: {formatCurrency(statement.metrics.total_received)}
                </button>
              ) : null}
            </div>

            {showPrintOptions && (
              <div className="animate-fade-in mt-2 rounded-xl border border-indigo-100 bg-indigo-50/50 p-4 shadow-sm">
                <p className="mb-2.5 text-xs font-bold uppercase tracking-wider text-indigo-900">Configure Print Report</p>
                <div className="flex flex-wrap items-center gap-5">
                  {Object.entries(printOptions).map(([key, value]) => (
                    <label key={key} className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700 hover:text-indigo-600">
                      <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" checked={value} onChange={(e) => setPrintOptions((curr) => ({ ...curr, [key]: e.target.checked }))} />
                      <span className="capitalize">{key}</span>
                    </label>
                  ))}
                  <button className="ml-auto rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-md transition-all hover:bg-indigo-700 hover:shadow-lg active:scale-95" onClick={openPrintableStatement}>Generate PDF Statement</button>
                </div>
              </div>
            )}
          </div>

          <div className="relative flex flex-1 flex-col gap-3 lg:flex-row lg:items-stretch">
            <div className="w-full min-w-0">
              <div className="flex h-full min-h-0 min-w-0 flex-col rounded-2xl border border-slate-100 bg-white p-3 shadow-[0_4px_20px_rgb(0,0,0,0.03)]">
                <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                  {canViewProjectMaterials ? <button className={`rounded-md px-3 py-2.5 text-base font-semibold ${activeProjectSection === 'materials' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'}`} onClick={() => handleProjectSectionClick('materials')}>Materials</button> : null}
                  {canViewProjectLabour ? <button className={`rounded-md px-3 py-2.5 text-base font-semibold ${activeProjectSection === 'labour' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'}`} onClick={() => handleProjectSectionClick('labour')}>Labour</button> : null}
                  {canViewProjectExpenses ? <button className={`rounded-md px-3 py-2.5 text-base font-semibold ${activeProjectSection === 'expenses' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'}`} onClick={() => handleProjectSectionClick('expenses')}>Expenses</button> : null}
                  {canViewProjectTransactions ? <button className={`rounded-md px-3 py-2.5 text-base font-semibold ${activeProjectSection === 'transactions' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'}`} onClick={() => handleProjectSectionClick('transactions')}>Transactions</button> : null}
                  {canViewProjectFiles ? <button className={`rounded-md px-3 py-2.5 text-base font-semibold ${activeProjectSection === 'files' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'}`} onClick={() => handleProjectSectionClick('files')}>Files</button> : null}
                </div>

                {activeProjectSection === null ? <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-slate-200 text-base font-medium text-slate-500">Choose Materials, Labour, Expenses, Transactions, or Files to view details.</div> : null}

                {activeProjectSection === 'materials' && canViewProjectMaterials ? (
                  <div className="flex h-full flex-1 flex-col min-h-0 pr-1">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                      <div className="flex flex-1 items-center gap-2">
                        <Package className="h-4 w-4 text-slate-500" />
                        <h3 className="text-base font-bold uppercase tracking-wider text-slate-700">Materials</h3>
                        <button type="button" className="rounded-md bg-graphite px-3 py-1.5 text-sm font-bold text-white hover:bg-black" onClick={() => setShowMaterialModal(true)}>+ Material</button>
                        <button
                          type="button"
                          className={`rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 ${showMaterialsTabSearch ? 'bg-indigo-50 text-indigo-600' : ''}`}
                          onClick={() => {
                            setShowMaterialsTabSearch((prev) => !prev);
                            if (showMaterialsTabSearch) setMaterialsTabSearch('');
                          }}
                          title="Search materials"
                        >
                          <Search className="h-4 w-4" />
                        </button>
                        {showMaterialsTabSearch ? (
                          <label className="relative min-w-0 w-full max-w-xs flex-1">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <input
                              type="search"
                              placeholder="Search materials..."
                              value={materialsTabSearch}
                              onChange={(e) => setMaterialsTabSearch(e.target.value)}
                              className="w-full rounded-2xl border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                              autoFocus
                            />
                          </label>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <label htmlFor="material-group-select" className="text-sm font-bold text-slate-700 whitespace-nowrap">
                          Group By:
                        </label>
                        <select
                          id="material-group-select"
                          value={materialGroupMode}
                          onChange={(e) => {
                            setMaterialGroupMode(e.target.value as 'none' | 'date' | 'material' | 'vendor');
                            setExpandedMaterialGroups({});
                          }}
                          className="h-10 min-w-[140px] px-3.5 py-1.5 rounded-xl border-2 border-indigo-200 bg-white text-sm font-bold text-indigo-950 shadow-sm transition hover:border-indigo-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 cursor-pointer"
                        >
                          <option value="date">Date</option>
                          <option value="none">None</option>
                          <option value="material">Material</option>
                          <option value="vendor">Vendor</option>
                        </select>
                        {selectedMaterialId ? <button className="rounded bg-slate-100 px-2.5 py-1.5 text-sm font-semibold text-slate-700" onClick={() => { const row = selectedMaterials.find((m) => m.id === selectedMaterialId); if (row) startMaterialEdit(row); }}>Edit</button> : null}
                        {selectedMaterialId ? <button className="rounded bg-red-50 px-2.5 py-1.5 text-sm font-semibold text-red-700" onClick={() => { if (selectedMaterialId && confirm('Delete selected material?')) deleteMaterial.mutate(selectedMaterialId); }}>Delete</button> : null}
                        {selectedMaterialId ? <button className="rounded bg-indigo-50 px-2.5 py-1.5 text-sm font-semibold text-indigo-700" onClick={() => toggleExpandMaterial(selectedMaterialId)}>Info</button> : null}
                      </div>
                    </div>
                    {materialInfoRow ? <div className="mb-2 rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-sm text-indigo-900"><p className="font-semibold">{materialInfoRow.material_name}</p><p>Vendor: {getVendorName(materialInfoRow.vendor_id)} | Bill No: {materialInfoRow.bill_no || '-'} | Unit: {materialInfoRow.unit}</p></div> : null}
                    {materialGroupMode === 'none' ? (
                      <div
                        className="project-entry-table flex-1 min-h-0 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm outline-none"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === 'ArrowDown') {
                            event.preventDefault();
                            handleMaterialArrowNavigation('down', event);
                          } else if (event.key === 'ArrowUp') {
                            event.preventDefault();
                            handleMaterialArrowNavigation('up', event);
                          }
                        }}
                      >
                        <table className="w-full table-fixed text-sm sm:text-base border-collapse">
                          <thead>
                            <tr>
                              <SortableHeader label="Date" columnKey="date" sortState={materialsSort} onSort={(k) => setMaterialsSort((c) => toggleColumnSort(c, k))} widthClass="w-[12%]" />
                              <SortableHeader label="Bill No" columnKey="bill_no" sortState={materialsSort} onSort={(k) => setMaterialsSort((c) => toggleColumnSort(c, k))} widthClass="w-[11%]" />
                              <SortableHeader label="Material" columnKey="material" sortState={materialsSort} onSort={(k) => setMaterialsSort((c) => toggleColumnSort(c, k))} widthClass="w-[29%]" />
                              <SortableHeader label="Vendor" columnKey="vendor" sortState={materialsSort} onSort={(k) => setMaterialsSort((c) => toggleColumnSort(c, k))} widthClass="w-[19%]" />
                              <SortableHeader label="Qty" columnKey="qty" sortState={materialsSort} onSort={(k) => setMaterialsSort((c) => toggleColumnSort(c, k))} align="right" widthClass="w-[9%]" />
                              <SortableHeader label="Rate" columnKey="rate" sortState={materialsSort} onSort={(k) => setMaterialsSort((c) => toggleColumnSort(c, k))} align="right" widthClass="w-[9%]" />
                              <SortableHeader label="Amount" columnKey="amount" sortState={materialsSort} onSort={(k) => setMaterialsSort((c) => toggleColumnSort(c, k))} align="right" widthClass="w-[11%]" />
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {sortedFilteredSelectedMaterials.map((r, idx) => (
                              <tr
                                key={r.id}
                                className={`transition-colors cursor-pointer select-none ${
                                  selectedMaterialIds.includes(r.id)
                                    ? 'bg-indigo-50/90 outline outline-2 -outline-offset-1 outline-indigo-500'
                                    : idx % 2 === 0
                                      ? 'bg-white hover:bg-slate-50/80'
                                      : 'bg-slate-50/40 hover:bg-slate-100/60'
                                }`}
                                onMouseDown={(event) => beginMaterialSelection(r.id, event.shiftKey || event.metaKey)}
                                onMouseEnter={() => {
                                  showRecordAudit('material_logs', r.id, 'Material entry');
                                  if (!materialDragSelecting) return;
                                  addUniqueSelection(setSelectedMaterialIds, r.id);
                                  setSelectedMaterialId(r.id);
                                }}
                                onMouseLeave={hideAudit}
                              >
                                <td className="px-3.5 py-2.5 text-left font-medium text-slate-600 whitespace-normal leading-snug">{formatDate(r.date)}</td>
                                <td className="px-3.5 py-2.5 text-left whitespace-normal leading-snug">
                                  {r.bill_no ? (
                                    <span className="font-mono text-xs text-slate-700">{r.bill_no}</span>
                                  ) : (
                                    <span className="text-slate-400 text-xs font-mono">-</span>
                                  )}
                                </td>
                                <td className="px-3.5 py-2.5 text-left whitespace-normal leading-snug">
                                  <div className="font-semibold text-slate-900">{r.material_name}</div>
                                  {r.template_meta && typeof r.template_meta === 'object' && (r.template_meta as Record<string, unknown>).has_bundle_conversion ? (
                                    <div className="mt-1 inline-flex items-center gap-1.5 rounded bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 border border-amber-200">
                                      📦 {String((r.template_meta as Record<string, unknown>).no_of_bundles || 0)} bdl × {String((r.template_meta as Record<string, unknown>).weight_per_bundle || 0)} kg @ {formatCurrency(Number((r.template_meta as Record<string, unknown>).cost_per_kg || r.unit_cost))}/kg
                                    </div>
                                  ) : null}
                                </td>
                                <td className="px-3.5 py-2.5 text-left text-slate-700 font-medium whitespace-normal leading-snug">{getVendorName(r.vendor_id)}</td>
                                <td className="px-3.5 py-2.5 text-right text-slate-800 font-medium tabular-nums whitespace-normal leading-snug">
                                  {r.quantity} <span className="text-slate-500 text-xs font-normal">{r.unit}</span>
                                </td>
                                <td className="px-3.5 py-2.5 text-right text-slate-600 font-normal tabular-nums whitespace-normal leading-snug">{formatCurrency(r.unit_cost)}</td>
                                <td className="px-3.5 py-2.5 text-right font-semibold text-slate-900 tabular-nums whitespace-normal leading-snug">{formatCurrency(calculateMaterialTotal(r))}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : materialGroupMode === 'date' ? (
                      <div
                        className="project-entry-table flex-1 min-h-0 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm outline-none"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === 'ArrowDown') {
                            event.preventDefault();
                            handleMaterialArrowNavigation('down', event);
                          } else if (event.key === 'ArrowUp') {
                            event.preventDefault();
                            handleMaterialArrowNavigation('up', event);
                          }
                        }}
                      >
                        <table className="w-full table-fixed text-sm sm:text-base border-collapse">
                          <thead>
                            <tr>
                              <SortableHeader label="Date" columnKey="date" sortState={materialsSort} onSort={(k) => setMaterialsSort((c) => toggleColumnSort(c, k))} widthClass="w-[15%]" />
                              <SortableHeader label="Bill No" columnKey="bill_no" sortState={materialsSort} onSort={(k) => setMaterialsSort((c) => toggleColumnSort(c, k))} widthClass="w-[11%]" />
                              <SortableHeader label="Material" columnKey="material" sortState={materialsSort} onSort={(k) => setMaterialsSort((c) => toggleColumnSort(c, k))} widthClass="w-[28%]" />
                              <SortableHeader label="Vendor" columnKey="vendor" sortState={materialsSort} onSort={(k) => setMaterialsSort((c) => toggleColumnSort(c, k))} widthClass="w-[18%]" />
                              <SortableHeader label="Qty" columnKey="qty" sortState={materialsSort} onSort={(k) => setMaterialsSort((c) => toggleColumnSort(c, k))} align="right" widthClass="w-[9%]" />
                              <SortableHeader label="Rate" columnKey="rate" sortState={materialsSort} onSort={(k) => setMaterialsSort((c) => toggleColumnSort(c, k))} align="right" widthClass="w-[9%]" />
                              <SortableHeader label="Amount" columnKey="amount" sortState={materialsSort} onSort={(k) => setMaterialsSort((c) => toggleColumnSort(c, k))} align="right" widthClass="w-[10%]" />
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {materialGroupsByDate.flatMap((group) => {
                              const expanded = expandedMaterialGroups[group.dateKey] ?? false;
                              if (!expanded) {
                                return [
                                  <tr
                                    key={`material-date-summary-${group.dateKey}`}
                                    className="group bg-slate-50/70 hover:bg-slate-100/80 cursor-pointer select-none transition-colors border-b border-slate-200/80"
                                    onClick={() => setExpandedMaterialGroups((current) => ({ ...current, [group.dateKey]: true }))}
                                  >
                                    <td className="px-3.5 py-2.5 text-left whitespace-nowrap leading-snug">
                                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                                        <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-slate-600 shrink-0 transition-colors" />
                                        <span className="font-semibold text-slate-800 text-sm whitespace-nowrap">{formatDate(group.dateKey)}</span>
                                        <span className="inline-flex items-center text-xs text-slate-500 font-semibold shrink-0 whitespace-nowrap">({group.rows.length})</span>
                                      </div>
                                    </td>
                                    <td className="px-3.5 py-2.5 text-left text-xs font-mono text-slate-600 whitespace-normal leading-snug">{group.billSummary}</td>
                                    <td className="px-3.5 py-2.5 text-left font-medium text-slate-700 whitespace-normal leading-snug">{group.materialSummary}</td>
                                    <td className="px-3.5 py-2.5 text-left text-slate-600 font-normal whitespace-normal leading-snug">{group.vendorSummary}</td>
                                    <td className="px-3.5 py-2.5 text-right font-semibold text-slate-800 tabular-nums whitespace-normal leading-snug">{group.totalQty.toFixed(2)}</td>
                                    <td className="px-3.5 py-2.5 text-right text-slate-500 tabular-nums text-xs whitespace-normal leading-snug">{formatCurrency(group.avgRate)}</td>
                                    <td className="px-3.5 py-2.5 text-right font-semibold text-slate-900 tabular-nums text-sm whitespace-normal leading-snug">
                                      {formatCurrency(group.totalAmount)}
                                    </td>
                                  </tr>,
                                ];
                              }

                              return group.rows.map((r, rowIdx) => (
                                <tr
                                  key={`material-date-${group.dateKey}-${r.id}`}
                                  className={`transition-colors cursor-pointer select-none ${
                                    selectedMaterialIds.includes(r.id)
                                      ? 'bg-indigo-50/90 outline outline-2 -outline-offset-1 outline-indigo-500'
                                      : rowIdx % 2 === 0
                                        ? 'bg-white hover:bg-slate-50/80'
                                        : 'bg-slate-50/40 hover:bg-slate-100/60'
                                  }`}
                                  onMouseDown={(event) => beginMaterialSelection(r.id, event.shiftKey || event.metaKey)}
                                  onMouseEnter={() => {
                                    showRecordAudit('material_logs', r.id, 'Material entry');
                                    if (!materialDragSelecting) return;
                                    addUniqueSelection(setSelectedMaterialIds, r.id);
                                    setSelectedMaterialId(r.id);
                                  }}
                                  onMouseLeave={hideAudit}
                                >
                                  {rowIdx === 0 ? (
                                    <td
                                      rowSpan={group.rows.length}
                                      className="group px-3.5 py-2.5 align-top border-r border-slate-200 bg-slate-50/50 hover:bg-slate-100/50 transition-colors cursor-pointer"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setExpandedMaterialGroups((current) => ({ ...current, [group.dateKey]: false }));
                                      }}
                                      title="Click to collapse group"
                                    >
                                      <div className="sticky top-10 flex items-center gap-1.5 py-0.5 whitespace-nowrap">
                                        <ChevronDown className="h-4 w-4 text-slate-500 group-hover:text-slate-700 shrink-0 transition-colors" />
                                        <span className="font-semibold text-slate-800 text-sm whitespace-nowrap">{formatDate(group.dateKey)}</span>
                                        <span className="inline-flex items-center text-xs text-slate-500 font-semibold shrink-0 whitespace-nowrap">({group.rows.length})</span>
                                      </div>
                                    </td>
                                  ) : null}
                                  <td className="px-3.5 py-2.5 text-left whitespace-normal leading-snug">
                                    {r.bill_no ? (
                                      <span className="font-mono text-xs text-slate-700">{r.bill_no}</span>
                                    ) : (
                                      <span className="text-slate-400 text-xs font-mono">-</span>
                                    )}
                                  </td>
                                  <td className="px-3.5 py-2.5 text-left whitespace-normal leading-snug">
                                    <div className="font-semibold text-slate-900">{r.material_name}</div>
                                    {r.template_meta && typeof r.template_meta === 'object' && (r.template_meta as Record<string, unknown>).has_bundle_conversion ? (
                                      <div className="mt-1 inline-flex items-center gap-1.5 rounded bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 border border-amber-200">
                                        📦 {String((r.template_meta as Record<string, unknown>).no_of_bundles || 0)} bdl × {String((r.template_meta as Record<string, unknown>).weight_per_bundle || 0)} kg @ {formatCurrency(Number((r.template_meta as Record<string, unknown>).cost_per_kg || r.unit_cost))}/kg
                                      </div>
                                    ) : null}
                                  </td>
                                  <td className="px-3.5 py-2.5 text-left text-slate-700 font-medium whitespace-normal leading-snug">{getVendorName(r.vendor_id)}</td>
                                  <td className="px-3.5 py-2.5 text-right text-slate-800 font-medium tabular-nums whitespace-normal leading-snug">
                                    {r.quantity} <span className="text-slate-500 text-xs font-normal">{r.unit}</span>
                                  </td>
                                  <td className="px-3.5 py-2.5 text-right text-slate-600 font-normal tabular-nums whitespace-normal leading-snug">{formatCurrency(r.unit_cost)}</td>
                                  <td className="px-3.5 py-2.5 text-right font-semibold text-slate-900 tabular-nums whitespace-normal leading-snug">{formatCurrency(calculateMaterialTotal(r))}</td>
                                </tr>
                              ));
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : materialGroupMode === 'vendor' ? (
                      <div
                        className="project-entry-table flex-1 min-h-0 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm outline-none"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === 'ArrowDown') {
                            event.preventDefault();
                            handleMaterialArrowNavigation('down', event);
                          } else if (event.key === 'ArrowUp') {
                            event.preventDefault();
                            handleMaterialArrowNavigation('up', event);
                          }
                        }}
                      >
                        <table className="w-full table-fixed text-sm sm:text-base border-collapse">
                          <thead>
                            <tr>
                              <SortableHeader label="Vendor" columnKey="vendor" sortState={materialsSort} onSort={(k) => setMaterialsSort((c) => toggleColumnSort(c, k))} widthClass="w-[22%]" />
                              <SortableHeader label="Bill No" columnKey="bill_no" sortState={materialsSort} onSort={(k) => setMaterialsSort((c) => toggleColumnSort(c, k))} widthClass="w-[11%]" />
                              <SortableHeader label="Date" columnKey="date" sortState={materialsSort} onSort={(k) => setMaterialsSort((c) => toggleColumnSort(c, k))} widthClass="w-[12%]" />
                              <SortableHeader label="Material" columnKey="material" sortState={materialsSort} onSort={(k) => setMaterialsSort((c) => toggleColumnSort(c, k))} widthClass="w-[27%]" />
                              <SortableHeader label="Qty" columnKey="qty" sortState={materialsSort} onSort={(k) => setMaterialsSort((c) => toggleColumnSort(c, k))} align="right" widthClass="w-[9%]" />
                              <SortableHeader label="Rate" columnKey="rate" sortState={materialsSort} onSort={(k) => setMaterialsSort((c) => toggleColumnSort(c, k))} align="right" widthClass="w-[9%]" />
                              <SortableHeader label="Amount" columnKey="amount" sortState={materialsSort} onSort={(k) => setMaterialsSort((c) => toggleColumnSort(c, k))} align="right" widthClass="w-[10%]" />
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {materialGroupsByVendor.flatMap((group) => {
                              const expanded = expandedMaterialGroups[group.vendorKey] ?? false;
                              if (!expanded) {
                                return [
                                  <tr
                                    key={`material-vendor-summary-${group.vendorKey}`}
                                    className="group bg-slate-50/70 hover:bg-slate-100/80 cursor-pointer select-none transition-colors border-b border-slate-200/80"
                                    onClick={() => setExpandedMaterialGroups((current) => ({ ...current, [group.vendorKey]: true }))}
                                  >
                                    <td className="px-3.5 py-2.5 text-left whitespace-normal leading-snug">
                                      <div className="flex items-center gap-1.5">
                                        <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-slate-600 shrink-0 transition-colors" />
                                        <span className="font-semibold text-slate-800 text-sm">{group.vendorName}</span>
                                        <span className="text-xs text-slate-500 font-normal">({group.rows.length})</span>
                                      </div>
                                    </td>
                                    <td className="px-3.5 py-2.5 text-left text-xs font-mono text-slate-600 whitespace-normal leading-snug">{group.billSummary}</td>
                                    <td className="px-3.5 py-2.5 text-left text-slate-600 text-xs whitespace-normal leading-snug">{group.dateSummary}</td>
                                    <td className="px-3.5 py-2.5 text-left font-medium text-slate-700 whitespace-normal leading-snug">{group.materialSummary}</td>
                                    <td className="px-3.5 py-2.5 text-right font-semibold text-slate-800 tabular-nums whitespace-normal leading-snug">{group.totalQty.toFixed(2)}</td>
                                    <td className="px-3.5 py-2.5 text-right text-slate-500 tabular-nums text-xs whitespace-normal leading-snug">{formatCurrency(group.avgRate)}</td>
                                    <td className="px-3.5 py-2.5 text-right font-semibold text-slate-900 tabular-nums text-sm whitespace-normal leading-snug">
                                      {formatCurrency(group.totalAmount)}
                                    </td>
                                  </tr>,
                                ];
                              }

                              return group.rows.map((r, rowIdx) => (
                                <tr
                                  key={`material-vendor-${group.vendorKey}-${r.id}`}
                                  className={`transition-colors cursor-pointer select-none ${
                                    selectedMaterialIds.includes(r.id)
                                      ? 'bg-indigo-50/90 outline outline-2 -outline-offset-1 outline-indigo-500'
                                      : rowIdx % 2 === 0
                                        ? 'bg-white hover:bg-slate-50/80'
                                        : 'bg-slate-50/40 hover:bg-slate-100/60'
                                  }`}
                                  onMouseDown={(event) => beginMaterialSelection(r.id, event.shiftKey || event.metaKey)}
                                  onMouseEnter={() => {
                                    showRecordAudit('material_logs', r.id, 'Material entry');
                                    if (!materialDragSelecting) return;
                                    addUniqueSelection(setSelectedMaterialIds, r.id);
                                    setSelectedMaterialId(r.id);
                                  }}
                                  onMouseLeave={hideAudit}
                                >
                                  {rowIdx === 0 ? (
                                    <td
                                      rowSpan={group.rows.length}
                                      className="group px-3.5 py-2.5 align-top border-r border-slate-200 bg-slate-50/50 hover:bg-slate-100/50 transition-colors cursor-pointer"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setExpandedMaterialGroups((current) => ({ ...current, [group.vendorKey]: false }));
                                      }}
                                      title="Click to collapse group"
                                    >
                                      <div className="sticky top-10 flex items-center gap-1.5 py-0.5">
                                        <ChevronDown className="h-4 w-4 text-slate-500 group-hover:text-slate-700 shrink-0 transition-colors" />
                                        <span className="font-semibold text-slate-800 text-sm">{group.vendorName}</span>
                                        <span className="text-xs text-slate-500 font-normal">({group.rows.length})</span>
                                      </div>
                                    </td>
                                  ) : null}
                                  <td className="px-3.5 py-2.5 text-left whitespace-normal leading-snug">
                                    {r.bill_no ? (
                                      <span className="font-mono text-xs text-slate-700">{r.bill_no}</span>
                                    ) : (
                                      <span className="text-slate-400 text-xs font-mono">-</span>
                                    )}
                                  </td>
                                  <td className="px-3.5 py-2.5 text-left text-slate-600 font-medium whitespace-normal leading-snug">{formatDate(r.date)}</td>
                                  <td className="px-3.5 py-2.5 text-left whitespace-normal leading-snug">
                                    <div className="font-semibold text-slate-900">{r.material_name}</div>
                                    {r.template_meta && typeof r.template_meta === 'object' && (r.template_meta as Record<string, unknown>).has_bundle_conversion ? (
                                      <div className="mt-1 inline-flex items-center gap-1.5 rounded bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 border border-amber-200">
                                        📦 {String((r.template_meta as Record<string, unknown>).no_of_bundles || 0)} bdl × {String((r.template_meta as Record<string, unknown>).weight_per_bundle || 0)} kg @ {formatCurrency(Number((r.template_meta as Record<string, unknown>).cost_per_kg || r.unit_cost))}/kg
                                      </div>
                                    ) : null}
                                  </td>
                                  <td className="px-3.5 py-2.5 text-right text-slate-800 font-medium tabular-nums whitespace-normal leading-snug">
                                    {r.quantity} <span className="text-slate-500 text-xs font-normal">{r.unit}</span>
                                  </td>
                                  <td className="px-3.5 py-2.5 text-right text-slate-600 font-normal tabular-nums whitespace-normal leading-snug">{formatCurrency(r.unit_cost)}</td>
                                  <td className="px-3.5 py-2.5 text-right font-semibold text-slate-900 tabular-nums whitespace-normal leading-snug">{formatCurrency(calculateMaterialTotal(r))}</td>
                                </tr>
                              ));
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div
                        className="project-entry-table flex-1 min-h-0 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm outline-none"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === 'ArrowDown') {
                            event.preventDefault();
                            handleMaterialArrowNavigation('down', event);
                          } else if (event.key === 'ArrowUp') {
                            event.preventDefault();
                            handleMaterialArrowNavigation('up', event);
                          }
                        }}
                      >
                        <table className="w-full table-fixed text-sm sm:text-base border-collapse">
                          <thead>
                            <tr>
                              <SortableHeader label="Material" columnKey="material" sortState={materialsSort} onSort={(k) => setMaterialsSort((c) => toggleColumnSort(c, k))} widthClass="w-[26%]" />
                              <SortableHeader label="Bill No" columnKey="bill_no" sortState={materialsSort} onSort={(k) => setMaterialsSort((c) => toggleColumnSort(c, k))} widthClass="w-[11%]" />
                              <SortableHeader label="Vendor" columnKey="vendor" sortState={materialsSort} onSort={(k) => setMaterialsSort((c) => toggleColumnSort(c, k))} widthClass="w-[20%]" />
                              <SortableHeader label="Date" columnKey="date" sortState={materialsSort} onSort={(k) => setMaterialsSort((c) => toggleColumnSort(c, k))} widthClass="w-[12%]" />
                              <SortableHeader label="Qty" columnKey="qty" sortState={materialsSort} onSort={(k) => setMaterialsSort((c) => toggleColumnSort(c, k))} align="right" widthClass="w-[9%]" />
                              <SortableHeader label="Rate" columnKey="rate" sortState={materialsSort} onSort={(k) => setMaterialsSort((c) => toggleColumnSort(c, k))} align="right" widthClass="w-[10%]" />
                              <SortableHeader label="Amount" columnKey="amount" sortState={materialsSort} onSort={(k) => setMaterialsSort((c) => toggleColumnSort(c, k))} align="right" widthClass="w-[12%]" />
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {materialGroupsByMaterial.flatMap((group) => {
                              const expanded = expandedMaterialGroups[group.materialKey] ?? false;
                              if (!expanded) {
                                return [
                                  <tr
                                    key={`material-summary-${group.materialKey}`}
                                    className="group bg-slate-50/70 hover:bg-slate-100/80 cursor-pointer select-none transition-colors border-b border-slate-200/80"
                                    onClick={() =>
                                      setExpandedMaterialGroups((current) => ({
                                        ...current,
                                        [group.materialKey]: true,
                                      }))
                                    }
                                  >
                                    <td className="px-3.5 py-2.5 text-left whitespace-normal leading-snug">
                                      <div className="flex items-center gap-1.5">
                                        <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-slate-600 shrink-0 transition-colors" />
                                        <span className="font-semibold text-slate-800 text-sm">{group.materialName}</span>
                                        <span className="text-xs text-slate-500 font-normal">({group.rows.length})</span>
                                      </div>
                                    </td>
                                    <td className="px-3.5 py-2.5 text-left text-xs font-mono text-slate-600 whitespace-normal leading-snug">{group.billSummary}</td>
                                    <td className="px-3.5 py-2.5 text-left font-medium text-slate-700 whitespace-normal leading-snug">{group.vendorSummary}</td>
                                    <td className="px-3.5 py-2.5 text-left text-slate-600 text-xs whitespace-normal leading-snug">{group.dateSummary}</td>
                                    <td className="px-3.5 py-2.5 text-right font-semibold text-slate-800 tabular-nums whitespace-normal leading-snug">
                                      {group.totalQty.toFixed(2)} <span className="text-slate-500 text-xs font-normal">{group.unitSummary}</span>
                                    </td>
                                    <td className="px-3.5 py-2.5 text-right text-slate-500 tabular-nums text-xs whitespace-normal leading-snug">{formatCurrency(group.avgRate)}</td>
                                    <td className="px-3.5 py-2.5 text-right font-semibold text-slate-900 tabular-nums text-sm whitespace-normal leading-snug">
                                      {formatCurrency(group.totalAmount)}
                                    </td>
                                  </tr>,
                                ];
                              }

                              return group.rows.map((r, rowIdx) => (
                                <tr
                                  key={`material-entry-${group.materialKey}-${r.id}`}
                                  className={`transition-colors cursor-pointer select-none ${
                                    selectedMaterialIds.includes(r.id)
                                      ? 'bg-indigo-50/90 outline outline-2 -outline-offset-1 outline-indigo-500'
                                      : rowIdx % 2 === 0
                                        ? 'bg-white hover:bg-slate-50/80'
                                        : 'bg-slate-50/40 hover:bg-slate-100/60'
                                  }`}
                                  onMouseDown={(event) => beginMaterialSelection(r.id, event.shiftKey || event.metaKey)}
                                  onMouseEnter={() => {
                                    showRecordAudit('material_logs', r.id, 'Material entry');
                                    if (!materialDragSelecting) return;
                                    addUniqueSelection(setSelectedMaterialIds, r.id);
                                    setSelectedMaterialId(r.id);
                                  }}
                                  onMouseLeave={hideAudit}
                                >
                                  {rowIdx === 0 ? (
                                    <td
                                      rowSpan={group.rows.length}
                                      className="group px-3.5 py-2.5 align-top border-r border-slate-200 bg-slate-50/50 hover:bg-slate-100/50 transition-colors cursor-pointer"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setExpandedMaterialGroups((current) => ({
                                          ...current,
                                          [group.materialKey]: false,
                                        }));
                                      }}
                                      title="Click to collapse group"
                                    >
                                      <div className="sticky top-10 flex items-center gap-1.5 py-0.5">
                                        <ChevronDown className="h-4 w-4 text-slate-500 group-hover:text-slate-700 shrink-0 transition-colors" />
                                        <span className="font-semibold text-slate-800 text-sm">{group.materialName}</span>
                                        <span className="text-xs text-slate-500 font-normal">({group.rows.length})</span>
                                      </div>
                                    </td>
                                  ) : null}
                                  <td className="px-3.5 py-2.5 text-left whitespace-normal leading-snug">
                                    {r.bill_no ? (
                                      <span className="font-mono text-xs text-slate-700">{r.bill_no}</span>
                                    ) : (
                                      <span className="text-slate-400 text-xs font-mono">-</span>
                                    )}
                                  </td>
                                  <td className="px-3.5 py-2.5 text-left text-slate-700 font-medium whitespace-normal leading-snug">{getVendorName(r.vendor_id)}</td>
                                  <td className="px-3.5 py-2.5 text-left text-slate-600 font-medium whitespace-normal leading-snug">{formatDate(r.date)}</td>
                                  <td className="px-3.5 py-2.5 text-right text-slate-800 font-medium tabular-nums whitespace-normal leading-snug">
                                    {r.quantity} <span className="text-slate-500 text-xs font-normal">{r.unit}</span>
                                  </td>
                                  <td className="px-3.5 py-2.5 text-right text-slate-600 font-normal tabular-nums whitespace-normal leading-snug">{formatCurrency(r.unit_cost)}</td>
                                  <td className="px-3.5 py-2.5 text-right font-semibold text-slate-900 tabular-nums whitespace-normal leading-snug">{formatCurrency(calculateMaterialTotal(r))}</td>
                                </tr>
                              ));
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ) : null}
                {activeProjectSection === 'labour' && canViewProjectLabour ? (
                  <div className="flex h-full flex-1 flex-col min-h-0 pr-1">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                      <div className="flex flex-1 items-center gap-2">
                        <Hammer className="h-4 w-4 text-slate-500" />
                        <h3 className="text-base font-bold uppercase tracking-wider text-slate-700">Labour</h3>
                        <button type="button" className="rounded-md bg-graphite px-3 py-1.5 text-sm font-bold text-white hover:bg-black" onClick={() => setShowLabourModal(true)}>+ Labour</button>
                        <button
                          type="button"
                          className={`rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 ${showLabourTabSearch ? 'bg-indigo-50 text-indigo-600' : ''}`}
                          onClick={() => {
                            setShowLabourTabSearch((prev) => !prev);
                            if (showLabourTabSearch) setLabourTabSearch('');
                          }}
                          title="Search labour"
                        >
                          <Search className="h-4 w-4" />
                        </button>
                        {showLabourTabSearch ? (
                          <label className="relative min-w-0 w-full max-w-xs flex-1">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <input
                              type="search"
                              placeholder="Search labour..."
                              value={labourTabSearch}
                              onChange={(e) => setLabourTabSearch(e.target.value)}
                              className="w-full rounded-2xl border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                              autoFocus
                            />
                          </label>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <label htmlFor="labour-group-select" className="text-sm font-bold text-slate-700 whitespace-nowrap">
                          Group By:
                        </label>
                        <select
                          id="labour-group-select"
                          value={labourGroupMode}
                          onChange={(e) => {
                            setLabourGroupMode(e.target.value as 'none' | 'date' | 'month' | 'labour' | 'incharge');
                            setExpandedLabourGroups({});
                            setExpandedLabourSubGroups({});
                          }}
                          className="h-9 min-w-[130px] px-3 py-1 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-200 cursor-pointer"
                        >
                          <option value="date">Date</option>
                          <option value="none">None</option>
                          <option value="month">Month</option>
                          <option value="labour">Labour Category</option>
                          <option value="incharge">Incharge</option>
                        </select>
                        {selectedAttendanceId ? <button className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition-colors" onClick={() => { const row = selectedAttendance.find((m) => m.id === selectedAttendanceId); if (row) startAttendanceEdit(row); }}>Edit</button> : null}
                        {selectedAttendanceId ? <button className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 transition-colors" onClick={() => { if (selectedAttendanceId && confirm('Delete selected labour entry?')) deleteAttendance.mutate(selectedAttendanceId); }}>Delete</button> : null}
                        {selectedAttendanceId ? <button className="rounded-lg bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors" onClick={() => toggleExpandAttendance(selectedAttendanceId)}>Info</button> : null}
                      </div>
                    </div>
                    {labourInfoRow ? <div className="mb-2 rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-sm text-indigo-900"><p className="font-semibold">{labourInfoRow.labour_type || '-'}</p><p>Vendor: {getVendorName(labourInfoRow.vendor_id)} | Count: {labourInfoRow.labour_count} | Wage/Head: {formatCurrency(labourInfoRow.wage_per_head)} | OT Total: {formatCurrency(labourInfoRow.overtime_hours)}</p></div> : null}
                    <div
                      className="project-entry-table flex-1 min-h-0 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm outline-none"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowDown') {
                          event.preventDefault();
                          handleLabourArrowNavigation('down', event);
                        } else if (event.key === 'ArrowUp') {
                          event.preventDefault();
                          handleLabourArrowNavigation('up', event);
                        }
                      }}
                    >
                      <table className="w-full table-fixed text-sm sm:text-base border-collapse">
                        <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
                          {labourGroupMode === 'labour' ? (
                            <tr>
                              <SortableHeader label="Labour Category" columnKey="type" sortState={labourSort} onSort={(k) => setLabourSort((c) => toggleColumnSort(c, k))} widthClass="w-[18%]" />
                              <SortableHeader label="Date" columnKey="date" sortState={labourSort} onSort={(k) => setLabourSort((c) => toggleColumnSort(c, k))} widthClass="w-[14%]" />
                              <SortableHeader label="Wage / Head" columnKey="rate" sortState={labourSort} onSort={(k) => setLabourSort((c) => toggleColumnSort(c, k))} align="right" widthClass="w-[10%]" />
                              <th className="sticky top-0 z-20 w-[8%] bg-slate-100 px-3.5 py-2.5 text-right font-semibold text-xs text-slate-700 border-b border-slate-200">OT Total</th>
                              <th className="sticky top-0 z-20 w-[6%] bg-slate-100 px-3.5 py-2.5 text-right font-semibold text-xs text-slate-700 border-b border-slate-200">Count</th>
                              <SortableHeader label="Amount" columnKey="amount" sortState={labourSort} onSort={(k) => setLabourSort((c) => toggleColumnSort(c, k))} align="right" widthClass="w-[10%]" />
                              <SortableHeader label="Incharge" columnKey="worker" sortState={labourSort} onSort={(k) => setLabourSort((c) => toggleColumnSort(c, k))} widthClass="w-[16%]" />
                              <th className="sticky top-0 z-20 w-[18%] bg-slate-100 px-3.5 py-2.5 text-left font-semibold text-xs text-slate-700 border-b border-slate-200">Remarks</th>
                            </tr>
                          ) : labourGroupMode === 'incharge' ? (
                            <tr>
                              <SortableHeader label="Incharge" columnKey="worker" sortState={labourSort} onSort={(k) => setLabourSort((c) => toggleColumnSort(c, k))} widthClass="w-[16%]" />
                              <SortableHeader label="Date" columnKey="date" sortState={labourSort} onSort={(k) => setLabourSort((c) => toggleColumnSort(c, k))} widthClass="w-[14%]" />
                              <SortableHeader label="Labour Category" columnKey="type" sortState={labourSort} onSort={(k) => setLabourSort((c) => toggleColumnSort(c, k))} widthClass="w-[18%]" />
                              <SortableHeader label="Wage / Head" columnKey="rate" sortState={labourSort} onSort={(k) => setLabourSort((c) => toggleColumnSort(c, k))} align="right" widthClass="w-[10%]" />
                              <th className="sticky top-0 z-20 w-[8%] bg-slate-100 px-3.5 py-2.5 text-right font-semibold text-xs text-slate-700 border-b border-slate-200">OT Total</th>
                              <th className="sticky top-0 z-20 w-[6%] bg-slate-100 px-3.5 py-2.5 text-right font-semibold text-xs text-slate-700 border-b border-slate-200">Count</th>
                              <SortableHeader label="Amount" columnKey="amount" sortState={labourSort} onSort={(k) => setLabourSort((c) => toggleColumnSort(c, k))} align="right" widthClass="w-[10%]" />
                              <th className="sticky top-0 z-20 w-[18%] bg-slate-100 px-3.5 py-2.5 text-left font-semibold text-xs text-slate-700 border-b border-slate-200">Remarks</th>
                            </tr>
                          ) : (
                            <tr>
                              <SortableHeader label={labourGroupMode === 'month' ? 'Month' : 'Date'} columnKey="date" sortState={labourSort} onSort={(k) => setLabourSort((c) => toggleColumnSort(c, k))} widthClass="w-[14%]" />
                              <SortableHeader label="Labour Category" columnKey="type" sortState={labourSort} onSort={(k) => setLabourSort((c) => toggleColumnSort(c, k))} widthClass="w-[18%]" />
                              <SortableHeader label="Wage / Head" columnKey="rate" sortState={labourSort} onSort={(k) => setLabourSort((c) => toggleColumnSort(c, k))} align="right" widthClass="w-[10%]" />
                              <th className="sticky top-0 z-20 w-[8%] bg-slate-100 px-3.5 py-2.5 text-right font-semibold text-xs text-slate-700 border-b border-slate-200">OT Total</th>
                              <th className="sticky top-0 z-20 w-[6%] bg-slate-100 px-3.5 py-2.5 text-right font-semibold text-xs text-slate-700 border-b border-slate-200">Count</th>
                              <SortableHeader label="Amount" columnKey="amount" sortState={labourSort} onSort={(k) => setLabourSort((c) => toggleColumnSort(c, k))} align="right" widthClass="w-[10%]" />
                              <SortableHeader label="Incharge" columnKey="worker" sortState={labourSort} onSort={(k) => setLabourSort((c) => toggleColumnSort(c, k))} widthClass="w-[16%]" />
                              <th className="sticky top-0 z-20 w-[18%] bg-slate-100 px-3.5 py-2.5 text-left font-semibold text-xs text-slate-700 border-b border-slate-200">Remarks</th>
                            </tr>
                          )}
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {labourGroupMode === 'none' ? (
                            sortedFilteredLabourFlatRows.map((item, idx) => (
                              <tr
                                key={`labour-flat-${item.id}`}
                                className={`transition-colors cursor-pointer select-none ${
                                  selectedAttendanceIds.includes(item.id)
                                    ? 'bg-indigo-50/90 outline outline-2 -outline-offset-1 outline-indigo-500'
                                    : idx % 2 === 0
                                      ? 'bg-white hover:bg-slate-50/80'
                                      : 'bg-slate-50/40 hover:bg-slate-100/60'
                                }`}
                                onMouseDown={(event) => beginLabourSelection(item.id, event.shiftKey || event.metaKey)}
                                onMouseEnter={() => {
                                  showRecordAudit('labor_logs', item.id, 'Labour entry');
                                  if (!labourDragSelecting) return;
                                  addUniqueSelection(setSelectedAttendanceIds, item.id);
                                  setSelectedAttendanceId(item.id);
                                }}
                                onMouseLeave={hideAudit}
                              >
                                <td className="px-3.5 py-2.5 font-medium text-slate-600 text-left whitespace-normal leading-snug">{formatDate(item.dateKey)}</td>
                                <td className="px-3.5 py-2.5 font-semibold text-slate-800 text-left whitespace-normal leading-snug">{item.labourType}</td>
                                <td className="px-3.5 py-2.5 text-right text-slate-700 font-normal tabular-nums whitespace-normal leading-snug">{formatCurrency(item.wagePerHead)}</td>
                                <td className="px-3.5 py-2.5 text-right text-slate-600 font-normal tabular-nums whitespace-normal leading-snug">{formatCurrency(item.otPerHead)}</td>
                                <td className="px-3.5 py-2.5 text-right font-medium text-slate-800 tabular-nums whitespace-normal leading-snug">{item.labourCount}</td>
                                <td className="px-3.5 py-2.5 text-right font-semibold text-slate-900 tabular-nums whitespace-normal leading-snug">{formatCurrency(item.amount)}</td>
                                <td className="px-3.5 py-2.5 text-left text-slate-700 font-medium whitespace-normal leading-snug">{item.vendorName}</td>
                                <td className="px-3.5 py-2.5 text-left text-slate-500 text-xs whitespace-normal leading-snug">{item.remarks || '-'}</td>
                              </tr>
                            ))
                          ) : labourGroupMode === 'date' ? (
                            labourGroupsByDate.flatMap<ReactNode>((group) => {
                              const expanded = expandedLabourGroups[group.dateKey] ?? false;

                              if (!expanded) {
                                return [
                                  <tr
                                    key={`labour-date-collapsed-${group.dateKey}`}
                                    className="group bg-slate-50/70 hover:bg-slate-100/80 cursor-pointer select-none transition-colors border-b border-slate-200/80"
                                    onClick={() => setExpandedLabourGroups((current) => ({ ...current, [group.dateKey]: true }))}
                                  >
                                    <td className="px-3.5 py-2.5 text-left whitespace-nowrap leading-snug">
                                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                                        <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-slate-600 shrink-0 transition-colors" />
                                        <span className="font-semibold text-slate-800 text-sm whitespace-nowrap">{formatDate(group.dateKey)}</span>
                                        <span className="inline-flex items-center text-xs text-slate-500 font-semibold shrink-0 whitespace-nowrap">({group.rows.length})</span>
                                      </div>
                                    </td>
                                    <td className="px-3.5 py-2.5 font-medium text-slate-700 text-left whitespace-normal leading-snug">
                                      {group.primaryCategory}
                                    </td>
                                    <td className="px-3.5 py-2.5 text-right text-slate-600 tabular-nums text-xs whitespace-normal leading-snug">{formatCurrency(group.avgWage)}</td>
                                    <td className="px-3.5 py-2.5 text-right text-slate-600 tabular-nums text-xs whitespace-normal leading-snug">{group.totalOT > 0 ? formatCurrency(group.totalOT) : '-'}</td>
                                    <td className="px-3.5 py-2.5 text-right font-medium text-slate-800 tabular-nums whitespace-normal leading-snug">{group.totalCount}</td>
                                    <td className="px-3.5 py-2.5 text-right font-semibold text-slate-900 tabular-nums text-sm whitespace-normal leading-snug">{formatCurrency(group.totalAmount)}</td>
                                    <td className="px-3.5 py-2.5 text-left text-slate-600 font-normal whitespace-normal leading-snug">{group.primaryIncharge || 'Multiple'}</td>
                                    <td className="px-3.5 py-2.5 text-left text-slate-500 text-xs whitespace-normal leading-snug">{group.rows.length} entries</td>
                                  </tr>,
                                ];
                              }

                              return [
                                <tr
                                  key={`labour-date-header-${group.dateKey}`}
                                  className="group bg-slate-50/90 hover:bg-slate-100 cursor-pointer select-none transition-colors border-b border-slate-200"
                                  onClick={() => setExpandedLabourGroups((current) => ({ ...current, [group.dateKey]: false }))}
                                >
                                  <td className="px-3.5 py-2 text-left whitespace-nowrap leading-snug">
                                    <div className="flex items-center gap-1.5 whitespace-nowrap">
                                      <ChevronDown className="h-4 w-4 text-slate-500 group-hover:text-slate-700 shrink-0 transition-colors" />
                                      <span className="font-semibold text-slate-800 text-sm whitespace-nowrap">{formatDate(group.dateKey)}</span>
                                      <span className="inline-flex items-center text-xs text-slate-500 font-semibold shrink-0 whitespace-nowrap">({group.rows.length})</span>
                                    </div>
                                  </td>
                                  <td className="px-3.5 py-2 text-slate-700 font-medium text-xs">{group.primaryCategory}</td>
                                  <td className="px-3.5 py-2 text-right text-slate-500 tabular-nums text-xs">{formatCurrency(group.avgWage)}</td>
                                  <td className="px-3.5 py-2 text-right text-slate-500 tabular-nums text-xs">{group.totalOT > 0 ? formatCurrency(group.totalOT) : '-'}</td>
                                  <td className="px-3.5 py-2 text-right font-medium text-slate-800 tabular-nums text-xs">{group.totalCount}</td>
                                  <td className="px-3.5 py-2 text-right font-semibold text-slate-900 tabular-nums text-xs">{formatCurrency(group.totalAmount)}</td>
                                  <td className="px-3.5 py-2 text-slate-600 text-xs">{group.primaryIncharge}</td>
                                  <td className="px-3.5 py-2 text-slate-400 text-xs">Summary</td>
                                </tr>,
                                ...group.rows.map((item, rowIdx) => (
                                  <tr
                                    key={`labour-date-entry-${group.dateKey}-${item.id}`}
                                    className={`transition-colors cursor-pointer select-none ${
                                      selectedAttendanceIds.includes(item.id)
                                        ? 'bg-indigo-50/90 outline outline-2 -outline-offset-1 outline-indigo-500'
                                        : rowIdx % 2 === 0
                                          ? 'bg-white hover:bg-slate-50/80'
                                          : 'bg-slate-50/40 hover:bg-slate-100/60'
                                    }`}
                                    onMouseDown={(event) => beginLabourSelection(item.id, event.shiftKey || event.metaKey)}
                                    onMouseEnter={() => {
                                      showRecordAudit('labor_logs', item.id, 'Labour entry');
                                      if (!labourDragSelecting) return;
                                      addUniqueSelection(setSelectedAttendanceIds, item.id);
                                      setSelectedAttendanceId(item.id);
                                    }}
                                    onMouseLeave={hideAudit}
                                  >
                                    <td className="px-3.5 py-2.5 pl-8 text-xs text-slate-500 text-left whitespace-normal leading-snug">{formatDate(item.dateKey)}</td>
                                    <td className="px-3.5 py-2.5 font-semibold text-slate-800 text-left whitespace-normal leading-snug">{item.labourType}</td>
                                    <td className="px-3.5 py-2.5 text-right text-slate-700 font-normal tabular-nums whitespace-normal leading-snug">{formatCurrency(item.wagePerHead)}</td>
                                    <td className="px-3.5 py-2.5 text-right text-slate-600 font-normal tabular-nums whitespace-normal leading-snug">{formatCurrency(item.otPerHead)}</td>
                                    <td className="px-3.5 py-2.5 text-right font-medium text-slate-800 tabular-nums whitespace-normal leading-snug">{item.labourCount}</td>
                                    <td className="px-3.5 py-2.5 text-right font-semibold text-slate-900 tabular-nums whitespace-normal leading-snug">{formatCurrency(item.amount)}</td>
                                    <td className="px-3.5 py-2.5 text-left text-slate-700 font-medium whitespace-normal leading-snug">{item.vendorName}</td>
                                    <td className="px-3.5 py-2.5 text-left text-slate-500 text-xs whitespace-normal leading-snug">{item.remarks || '-'}</td>
                                  </tr>
                                )),
                              ];
                            })
                          ) : labourGroupMode === 'month' ? (
                            labourGroupsByMonth.flatMap<ReactNode>((month) => {
                              const monthExpanded = expandedLabourGroups[month.monthKey] ?? false;
                              if (!monthExpanded) {
                                return [
                                  <tr
                                    key={`labour-month-${month.monthKey}`}
                                    className="group bg-slate-50/70 hover:bg-slate-100/80 cursor-pointer select-none transition-colors border-b border-slate-200/80 font-medium text-slate-800"
                                    onClick={() => setExpandedLabourGroups((current) => ({ ...current, [month.monthKey]: true }))}
                                  >
                                    <td className="px-3.5 py-2.5 text-left whitespace-normal leading-snug">
                                      <div className="flex items-center gap-1.5">
                                        <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-slate-600 shrink-0 transition-colors" />
                                        <span className="font-semibold text-slate-800 text-sm">{month.monthLabel}</span>
                                      </div>
                                    </td>
                                    <td className="px-3.5 py-2.5 text-slate-600 text-xs">All Labour Types</td>
                                    <td className="px-3.5 py-2.5 text-right text-slate-400">-</td>
                                    <td className="px-3.5 py-2.5 text-right text-slate-400">-</td>
                                    <td className="px-3.5 py-2.5 text-right font-medium text-slate-800 tabular-nums">{month.totalCount}</td>
                                    <td className="px-3.5 py-2.5 text-right font-semibold text-slate-900 tabular-nums">{formatCurrency(month.totalAmount)}</td>
                                    <td className="px-3.5 py-2.5 text-slate-600 text-xs">All Incharges</td>
                                    <td className="px-3.5 py-2.5 text-slate-500 text-xs">{month.weeks.length} weeks</td>
                                  </tr>,
                                ];
                              }

                              const rows: ReactNode[] = [];
                              let monthLabelRendered = false;

                              month.weeks.forEach((week) => {
                                const weekExpanded = expandedLabourSubGroups[week.weekKey] ?? false;
                                if (!weekExpanded) {
                                  rows.push(
                                    <tr
                                      key={`labour-week-${week.weekKey}`}
                                      className="group bg-slate-50/50 hover:bg-slate-100/70 cursor-pointer select-none transition-colors border-b border-slate-200/80 text-slate-700"
                                      onClick={() => setExpandedLabourSubGroups((current) => ({ ...current, [week.weekKey]: true }))}
                                    >
                                      {monthLabelRendered ? <td className="px-3.5 py-2.5" /> : (
                                        <td
                                          className="px-3.5 py-2.5 font-semibold text-slate-900 cursor-pointer"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setExpandedLabourGroups((current) => ({ ...current, [month.monthKey]: false }));
                                          }}
                                        >
                                          <div className="flex items-center gap-1.5">
                                            <ChevronDown className="h-4 w-4 text-slate-500 shrink-0" />
                                            <span>{month.monthLabel}</span>
                                          </div>
                                        </td>
                                      )}
                                      <td className="px-3.5 py-2.5 pl-6 text-xs font-medium text-slate-700">{week.weekLabel} • {formatDate(week.startDate)} - {formatDate(week.endDate)}</td>
                                      <td className="px-3.5 py-2.5 text-right text-slate-400">-</td>
                                      <td className="px-3.5 py-2.5 text-right text-slate-400">-</td>
                                      <td className="px-3.5 py-2.5 text-right font-medium text-slate-800 tabular-nums">{week.totalCount}</td>
                                      <td className="px-3.5 py-2.5 text-right font-semibold text-slate-900 tabular-nums">{formatCurrency(week.totalAmount)}</td>
                                      <td className="px-3.5 py-2.5 text-slate-600 text-xs">All Incharges</td>
                                      <td className="px-3.5 py-2.5 text-slate-500 text-xs">{week.dates.length} days</td>
                                    </tr>,
                                  );
                                  monthLabelRendered = true;
                                  return;
                                }

                                let weekLabelRendered = false;
                                week.dates.forEach(([dateKey, dayRows]) => {
                                  dayRows.forEach((row, rowIdx) => {
                                    rows.push(
                                      <tr
                                        key={`labour-entry-${week.weekKey}-${dateKey}-${row.id}`}
                                        className={`transition-colors cursor-pointer select-none ${
                                          selectedAttendanceIds.includes(row.id)
                                            ? 'bg-indigo-50/90 outline outline-2 -outline-offset-1 outline-indigo-500'
                                            : rowIdx % 2 === 0
                                              ? 'bg-white hover:bg-slate-50/80'
                                              : 'bg-slate-50/40 hover:bg-slate-100/60'
                                        }`}
                                        onMouseDown={(event) => beginLabourSelection(row.id, event.shiftKey || event.metaKey)}
                                        onMouseEnter={() => {
                                          showRecordAudit('labor_logs', row.id, 'Labour entry');
                                          if (!labourDragSelecting) return;
                                          addUniqueSelection(setSelectedAttendanceIds, row.id);
                                          setSelectedAttendanceId(row.id);
                                        }}
                                        onMouseLeave={hideAudit}
                                      >
                                        {monthLabelRendered ? <td className="px-3.5 py-2.5" /> : (
                                          <td
                                            className="px-3.5 py-2.5 font-semibold text-slate-900 cursor-pointer"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              setExpandedLabourGroups((current) => ({ ...current, [month.monthKey]: false }));
                                            }}
                                          >
                                            <div className="flex items-center gap-1.5">
                                              <ChevronDown className="h-4 w-4 text-slate-500 shrink-0" />
                                              <span>{month.monthLabel}</span>
                                            </div>
                                          </td>
                                        )}
                                        {rowIdx === 0 ? (
                                          <td className="px-3.5 py-2.5 pl-6">
                                            <div className="flex items-center justify-between gap-2">
                                              <span className="font-semibold text-slate-800">{row.labourType}</span>
                                              {!weekLabelRendered ? (
                                                <button
                                                  type="button"
                                                  className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-200"
                                                  onClick={(event) => {
                                                    event.stopPropagation();
                                                    setExpandedLabourSubGroups((current) => ({ ...current, [week.weekKey]: false }));
                                                  }}
                                                >
                                                  Collapse week
                                                </button>
                                              ) : null}
                                            </div>
                                          </td>
                                        ) : (
                                          <td className="px-3.5 py-2.5 pl-8 font-medium text-slate-700">{row.labourType}</td>
                                        )}
                                        <td className="px-3.5 py-2.5 text-right text-slate-700 font-normal tabular-nums">{formatCurrency(row.wagePerHead)}</td>
                                        <td className="px-3.5 py-2.5 text-right text-slate-600 font-normal tabular-nums">{formatCurrency(row.otPerHead)}</td>
                                        <td className="px-3.5 py-2.5 text-right font-medium text-slate-800 tabular-nums">{row.labourCount}</td>
                                        <td className="px-3.5 py-2.5 text-right font-semibold text-slate-900 tabular-nums">{formatCurrency(row.amount)}</td>
                                        <td className="px-3.5 py-2.5 text-slate-700 text-xs">{row.vendorName}</td>
                                        <td className="px-3.5 py-2.5 text-slate-500 text-xs">{row.remarks}</td>
                                      </tr>,
                                    );
                                    monthLabelRendered = true;
                                    if (rowIdx === 0) weekLabelRendered = true;
                                  });
                                });
                              });
                              return rows;
                            })
                          ) : (
                            labourGroupMode === 'incharge' ? (
                              labourGroupsByIncharge.flatMap<ReactNode>((group) => {
                                const expanded = expandedLabourGroups[group.inchargeKey] ?? false;
                                if (!expanded) {
                                  return [
                                    <tr
                                      key={`labour-incharge-${group.inchargeKey}`}
                                      className="group bg-slate-50/70 hover:bg-slate-100/80 cursor-pointer select-none transition-colors border-b border-slate-200/80 font-medium text-slate-800"
                                      onClick={() => setExpandedLabourGroups((current) => ({ ...current, [group.inchargeKey]: true }))}
                                    >
                                      <td className="px-3.5 py-2.5 text-left whitespace-nowrap leading-snug">
                                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                                          <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-slate-600 shrink-0 transition-colors" />
                                          <span className="font-semibold text-slate-800 text-sm whitespace-nowrap">{group.inchargeName}</span>
                                          <span className="inline-flex items-center text-xs text-slate-500 font-semibold shrink-0 whitespace-nowrap">({group.rows.length})</span>
                                        </div>
                                      </td>
                                      <td className="px-3.5 py-2.5 text-left text-slate-600 text-xs whitespace-normal leading-snug">{labourGroupDateRange(group.rows)}</td>
                                      <td className="px-3.5 py-2.5 text-left text-slate-600 text-xs whitespace-normal leading-snug">All Labour Types</td>
                                      <td className="px-3.5 py-2.5 text-right text-slate-400">-</td>
                                      <td className="px-3.5 py-2.5 text-right text-slate-400">-</td>
                                      <td className="px-3.5 py-2.5 text-right font-medium text-slate-800 tabular-nums">{group.totalCount}</td>
                                      <td className="px-3.5 py-2.5 text-right font-semibold text-slate-900 tabular-nums">{formatCurrency(group.totalAmount)}</td>
                                      <td className="px-3.5 py-2.5 text-slate-500 text-xs">{group.rows.length} entries</td>
                                    </tr>,
                                  ];
                                }
                                return group.rows.map((row, rowIdx) => (
                                  <tr
                                    key={`labour-incharge-detail-${group.inchargeKey}-${row.id}`}
                                    className={`transition-colors cursor-pointer select-none ${
                                      selectedAttendanceIds.includes(row.id)
                                        ? 'bg-indigo-50/90 outline outline-2 -outline-offset-1 outline-indigo-500'
                                        : rowIdx % 2 === 0
                                          ? 'bg-white hover:bg-slate-50/80'
                                          : 'bg-slate-50/40 hover:bg-slate-100/60'
                                    }`}
                                    onMouseDown={(event) => beginLabourSelection(row.id, event.shiftKey || event.metaKey)}
                                    onMouseEnter={() => {
                                      if (!labourDragSelecting) return;
                                      addUniqueSelection(setSelectedAttendanceIds, row.id);
                                      setSelectedAttendanceId(row.id);
                                    }}
                                  >
                                    {rowIdx === 0 ? (
                                      <td
                                        rowSpan={group.rows.length}
                                        className="group px-3.5 py-2.5 align-top border-r border-slate-200 bg-slate-50/50 hover:bg-slate-100/50 transition-colors cursor-pointer font-semibold text-slate-800"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setExpandedLabourGroups((current) => ({ ...current, [group.inchargeKey]: false }));
                                        }}
                                      >
                                        <div className="sticky top-10 flex items-center gap-1.5 py-0.5 whitespace-nowrap">
                                          <ChevronDown className="h-4 w-4 text-slate-500 group-hover:text-slate-700 shrink-0 transition-colors" />
                                          <span className="whitespace-nowrap">{group.inchargeName}</span>
                                          <span className="inline-flex items-center text-xs text-slate-500 font-semibold shrink-0 whitespace-nowrap">({group.rows.length})</span>
                                        </div>
                                      </td>
                                    ) : null}
                                    <td className="px-3.5 py-2.5 text-slate-600 text-xs">{formatDate(row.dateKey)}</td>
                                    <td className="px-3.5 py-2.5 font-semibold text-slate-800">{row.labourType}</td>
                                    <td className="px-3.5 py-2.5 text-right text-slate-700 font-normal tabular-nums">{formatCurrency(row.wagePerHead)}</td>
                                    <td className="px-3.5 py-2.5 text-right text-slate-600 font-normal tabular-nums">{formatCurrency(row.otPerHead)}</td>
                                    <td className="px-3.5 py-2.5 text-right font-medium text-slate-800 tabular-nums">{row.labourCount}</td>
                                    <td className="px-3.5 py-2.5 text-right font-semibold text-slate-900 tabular-nums">{formatCurrency(row.amount)}</td>
                                    <td className="px-3.5 py-2.5 text-slate-500 text-xs">{row.remarks || '-'}</td>
                                  </tr>
                                ));
                              })
                            ) : (
                              labourGroupsByLabour.flatMap<ReactNode>((group) => {
                                const labourExpanded = expandedLabourGroups[group.labourType] ?? false;
                                if (!labourExpanded) {
                                  return [
                                    <tr
                                      key={`labour-group-${group.labourType}`}
                                      className="group bg-slate-50/70 hover:bg-slate-100/80 cursor-pointer select-none transition-colors border-b border-slate-200/80 font-medium text-slate-800"
                                      onClick={() => setExpandedLabourGroups((current) => ({ ...current, [group.labourType]: true }))}
                                    >
                                      <td className="px-3.5 py-2.5 text-left whitespace-nowrap leading-snug">
                                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                                          <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-slate-600 shrink-0 transition-colors" />
                                          <span className="font-semibold text-slate-800 text-sm whitespace-nowrap">{group.labourType}</span>
                                          <span className="inline-flex items-center text-xs text-slate-500 font-semibold shrink-0 whitespace-nowrap">({group.rows.length})</span>
                                        </div>
                                      </td>
                                      <td className="px-3.5 py-2.5 text-left text-slate-600 text-xs whitespace-normal leading-snug">{labourGroupDateRange(group.rows)}</td>
                                      <td className="px-3.5 py-2.5 text-right text-slate-400">-</td>
                                      <td className="px-3.5 py-2.5 text-right text-slate-400">-</td>
                                      <td className="px-3.5 py-2.5 text-right font-medium text-slate-800 tabular-nums">{group.totalCount}</td>
                                      <td className="px-3.5 py-2.5 text-right font-semibold text-slate-900 tabular-nums">{formatCurrency(group.totalAmount)}</td>
                                      <td className="px-3.5 py-2.5 text-slate-600 text-xs">All Incharges</td>
                                      <td className="px-3.5 py-2.5 text-slate-500 text-xs">{group.rows.length} entries</td>
                                    </tr>,
                                  ];
                                }

                                return group.rows.map((row, rowIdx) => (
                                  <tr
                                    key={`labour-detail-${group.labourType}-${row.id}`}
                                    className={`transition-colors cursor-pointer select-none ${
                                      selectedAttendanceIds.includes(row.id)
                                        ? 'bg-indigo-50/90 outline outline-2 -outline-offset-1 outline-indigo-500'
                                        : rowIdx % 2 === 0
                                          ? 'bg-white hover:bg-slate-50/80'
                                          : 'bg-slate-50/40 hover:bg-slate-100/60'
                                    }`}
                                    onMouseDown={(event) => beginLabourSelection(row.id, event.shiftKey || event.metaKey)}
                                    onMouseEnter={() => {
                                      showRecordAudit('labor_logs', row.id, 'Labour entry');
                                      if (!labourDragSelecting) return;
                                      addUniqueSelection(setSelectedAttendanceIds, row.id);
                                      setSelectedAttendanceId(row.id);
                                    }}
                                    onMouseLeave={hideAudit}
                                  >
                                    {rowIdx === 0 ? (
                                      <td
                                        rowSpan={group.rows.length}
                                        className="group px-3.5 py-2.5 align-top border-r border-slate-200 bg-slate-50/50 hover:bg-slate-100/50 transition-colors cursor-pointer font-semibold text-slate-800"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setExpandedLabourGroups((current) => ({ ...current, [group.labourType]: false }));
                                        }}
                                      >
                                        <div className="sticky top-10 flex items-center gap-1.5 py-0.5 whitespace-nowrap">
                                          <ChevronDown className="h-4 w-4 text-slate-500 group-hover:text-slate-700 shrink-0 transition-colors" />
                                          <span className="whitespace-nowrap">{group.labourType}</span>
                                          <span className="inline-flex items-center text-xs text-slate-500 font-semibold shrink-0 whitespace-nowrap">({group.rows.length})</span>
                                        </div>
                                      </td>
                                    ) : null}
                                    <td className="px-3.5 py-2.5 text-slate-600 text-xs">{formatDate(row.dateKey)}</td>
                                    <td className="px-3.5 py-2.5 text-right text-slate-700 font-normal tabular-nums">{formatCurrency(row.wagePerHead)}</td>
                                    <td className="px-3.5 py-2.5 text-right text-slate-600 font-normal tabular-nums">{formatCurrency(row.otPerHead)}</td>
                                    <td className="px-3.5 py-2.5 text-right font-medium text-slate-800 tabular-nums">{row.labourCount}</td>
                                    <td className="px-3.5 py-2.5 text-right font-semibold text-slate-900 tabular-nums">{formatCurrency(row.amount)}</td>
                                    <td className="px-3.5 py-2.5 text-slate-700 text-xs">{row.vendorName}</td>
                                    <td className="px-3.5 py-2.5 text-slate-500 text-xs">{row.remarks || '-'}</td>
                                  </tr>
                                ));
                              })
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
                {activeProjectSection === 'expenses' && canViewProjectExpenses ? (
                  <div className="flex h-full flex-1 flex-col min-h-0 pr-1">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                      <div className="flex flex-1 items-center gap-2">
                        <Receipt className="h-4 w-4 text-slate-500" />
                        <h3 className="text-base font-bold uppercase tracking-wider text-slate-700">Expenses</h3>
                        <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1 shadow-inner">
                          <button
                            type="button"
                            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold transition ${expensesView === 'project' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'}`}
                            onClick={() => setExpensesView('project')}
                          >
                            <Receipt className="h-4 w-4" />
                            Project Expenses
                            <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-black ${expensesView === 'project' ? 'bg-white/25 text-white' : 'bg-slate-200 text-slate-700'}`}>{selectedExpenses.length}</span>
                          </button>
                          <button
                            type="button"
                            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold transition ${expensesView === 'site' ? 'bg-amber-700 text-white shadow-sm' : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'}`}
                            onClick={() => setExpensesView('site')}
                          >
                            <HardHat className="h-4 w-4" />
                            Site Expenses
                            <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-black ${expensesView === 'site' ? 'bg-white/25 text-white' : 'bg-slate-200 text-slate-700'}`}>{selectedSiteExpenses.length}</span>
                          </button>
                        </div>
                        {expensesView === 'project' ? <button type="button" className="rounded-md bg-graphite px-3 py-1.5 text-sm font-bold text-white hover:bg-black" onClick={() => setShowExpenseModal(true)}>+ Expense</button> : null}
                        {expensesView === 'project' ? (
                        <button
                          type="button"
                          className={`rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 ${showExpensesTabSearch ? 'bg-indigo-50 text-indigo-600' : ''}`}
                          onClick={() => {
                            setShowExpensesTabSearch((prev) => !prev);
                            if (showExpensesTabSearch) setExpensesTabSearch('');
                          }}
                          title="Search expenses"
                        >
                          <Search className="h-4 w-4" />
                        </button>
                        ) : null}
                        {showExpensesTabSearch && expensesView === 'project' ? (
                          <label className="relative min-w-0 w-full max-w-xs flex-1">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <input
                              type="search"
                              placeholder="Search expenses..."
                              value={expensesTabSearch}
                              onChange={(e) => setExpensesTabSearch(e.target.value)}
                              className="w-full rounded-2xl border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                              autoFocus
                            />
                          </label>
                        ) : null}
                      </div>
                      <div className={`flex items-center gap-2 ${expensesView === 'site' ? 'hidden' : ''}`}>
                        <label htmlFor="expense-group-select" className="text-sm font-bold text-slate-700 whitespace-nowrap">
                          Group By:
                        </label>
                        <select
                          id="expense-group-select"
                          value={expenseGroupMode}
                          onChange={(e) => {
                            setExpenseGroupMode(e.target.value as 'date' | 'none' | 'category');
                            setExpandedExpenseGroups({});
                          }}
                          className="h-9 min-w-[130px] px-3 py-1 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-200 cursor-pointer"
                        >
                          <option value="date">Date</option>
                          <option value="none">None</option>
                          <option value="category">Expense Name</option>
                        </select>
                        {selectedExpenseId ? <button className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition-colors" onClick={() => { const row = selectedExpenses.find((m) => m.id === selectedExpenseId); if (row) startExpenseEdit(row); }}>Edit</button> : null}
                        {selectedExpenseId ? <button className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 transition-colors" onClick={() => { if (selectedExpenseId && confirm('Delete selected expense?')) deleteExpense.mutate(selectedExpenseId); }}>Delete</button> : null}
                        {selectedExpenseId ? <button className="rounded-lg bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors" onClick={() => toggleExpandExpense(selectedExpenseId)}>Info</button> : null}
                      </div>
                    </div>
                    {!hideExpenseAmounts ? (
                      <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <button
                          type="button"
                          onClick={() => setExpensesView('project')}
                          className={`rounded-xl border p-3 text-left transition ${expensesView === 'project' ? 'border-indigo-300 bg-indigo-50 ring-1 ring-indigo-200' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                        >
                          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Project Expenses</p>
                          <p className="mt-1 text-xl font-black text-indigo-800 tabular-nums">{formatCurrency(projectExpenseSubtotal)}</p>
                          <p className="text-xs text-slate-500">{selectedExpenses.length} entries</p>
                        </button>
                        <button
                          type="button"
                          onClick={() => setExpensesView('site')}
                          className={`rounded-xl border p-3 text-left transition ${expensesView === 'site' ? 'border-amber-300 bg-amber-50 ring-1 ring-amber-200' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                        >
                          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Site Expenses</p>
                          <p className="mt-1 text-xl font-black text-amber-800 tabular-nums">{formatCurrency(siteExpenseSubtotal)}</p>
                          <p className="text-xs text-slate-500">{selectedSiteExpenses.length} entries tagged to this project</p>
                        </button>
                        <div className="rounded-xl border border-slate-800 bg-graphite p-3 text-white">
                          <p className="text-xs font-bold uppercase tracking-wider text-white/70">Total Expenses</p>
                          <p className="mt-1 text-xl font-black tabular-nums">{formatCurrency(expenseSubtotal)}</p>
                          <p className="text-xs text-white/60">Project + Site</p>
                        </div>
                      </div>
                    ) : null}
                    {expenseInfoRow && expensesView === 'project' ? <div className="mb-2 rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-sm text-indigo-900"><p className="font-semibold">{expenseInfoRow.category}</p><p>{expenseInfoRow.description || '-'}</p></div> : null}
                    {expensesView === 'site' ? (
                      <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                        <table className="w-full table-fixed text-sm sm:text-base border-collapse">
                          <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
                            <tr>
                              <th className="px-3.5 py-2.5 text-left font-bold w-[13%]">Date</th>
                              <th className="px-3.5 py-2.5 text-left font-bold w-[24%]">Item</th>
                              <th className="px-3.5 py-2.5 text-left font-bold w-[20%]">Category</th>
                              <th className="px-3.5 py-2.5 text-left font-bold w-[25%]">Description</th>
                              {!hideExpenseAmounts ? <th className="px-3.5 py-2.5 text-right font-bold w-[18%]">Amount</th> : null}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {selectedSiteExpenses.length === 0 ? (
                              <tr>
                                <td colSpan={hideExpenseAmounts ? 4 : 5} className="px-3.5 py-10 text-center text-sm text-slate-500">
                                  No site expenses have been tagged to this project yet. Tag them from the Site Expenses tab.
                                </td>
                              </tr>
                            ) : (
                              selectedSiteExpenses.map((item) => (
                                <tr key={`site-expense-${item.id}`} className="hover:bg-slate-50">
                                  <td className="px-3.5 py-2.5 text-left font-medium text-slate-600 whitespace-normal leading-snug">{formatDate(item.date)}</td>
                                  <td className="px-3.5 py-2.5 font-semibold text-slate-800 text-left whitespace-normal leading-snug">{item.item_name || '-'}</td>
                                  <td className="px-3.5 py-2.5 text-slate-700 text-left whitespace-normal leading-snug">{item.category}</td>
                                  <td className="px-3.5 py-2.5 text-slate-600 text-left whitespace-normal leading-snug">{item.description || '-'}</td>
                                  {!hideExpenseAmounts ? <td className="px-3.5 py-2.5 text-right font-semibold text-slate-900 tabular-nums whitespace-normal leading-snug">{formatCurrency(item.amount)}</td> : null}
                                </tr>
                              ))
                            )}
                          </tbody>
                          {selectedSiteExpenses.length > 0 && !hideExpenseAmounts ? (
                            <tfoot className="sticky bottom-0 bg-slate-50">
                              <tr className="border-t border-slate-200">
                                <td colSpan={4} className="px-3.5 py-2.5 text-right text-sm font-bold text-slate-700">Site expenses total</td>
                                <td className="px-3.5 py-2.5 text-right font-black text-slate-900 tabular-nums">{formatCurrency(siteExpenseSubtotal)}</td>
                              </tr>
                            </tfoot>
                          ) : null}
                        </table>
                      </div>
                    ) : null}
                    <div
                      className={`project-entry-table flex-1 min-h-0 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm outline-none ${expensesView === 'site' ? 'hidden' : ''}`}
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowDown') {
                          event.preventDefault();
                          handleExpenseArrowNavigation('down', event);
                        } else if (event.key === 'ArrowUp') {
                          event.preventDefault();
                          handleExpenseArrowNavigation('up', event);
                        }
                      }}
                    >
                      <table className="w-full table-fixed text-sm sm:text-base border-collapse">
                        <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
                          <tr>
                            <SortableHeader label="Date" columnKey="date" sortState={expensesSort} onSort={(k) => setExpensesSort((c) => toggleColumnSort(c, k))} widthClass="w-[11%]" />
                            <SortableHeader label="Expense" columnKey="category" sortState={expensesSort} onSort={(k) => setExpensesSort((c) => toggleColumnSort(c, k))} widthClass={hideExpenseAmounts ? 'w-[30%]' : 'w-[22%]'} />
                            <SortableHeader label="Description" columnKey="details" sortState={expensesSort} onSort={(k) => setExpensesSort((c) => toggleColumnSort(c, k))} widthClass={hideExpenseAmounts ? 'w-[59%]' : 'w-[49%]'} />
                            {!hideExpenseAmounts ? <SortableHeader label="Amount" columnKey="amount" sortState={expensesSort} onSort={(k) => setExpensesSort((c) => toggleColumnSort(c, k))} align="right" widthClass="w-[18%]" /> : null}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {expenseGroupMode === 'date' ? (
                            expenseGroupsByDate.flatMap((group) => {
                              const expanded = expandedExpenseGroups[group.dateKey] ?? false;
                              if (!expanded) {
                                return [
                                  <tr
                                    key={`expense-date-summary-${group.dateKey}`}
                                    className="group bg-slate-50/70 hover:bg-slate-100/80 cursor-pointer select-none transition-colors border-b border-slate-200/80"
                                    onClick={() => setExpandedExpenseGroups((current) => ({ ...current, [group.dateKey]: true }))}
                                  >
                                    <td className="px-3.5 py-2.5 text-left whitespace-normal leading-snug">
                                      <div className="flex items-center gap-1.5">
                                        <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-slate-600 shrink-0 transition-colors" />
                                        <span className="font-semibold text-slate-800 text-sm">{group.dateKey}</span>
                                      </div>
                                    </td>
                                    <td className="px-3.5 py-2.5 font-medium text-slate-800 text-left whitespace-normal leading-snug">
                                      {group.primaryCategory}
                                      <span className="ml-1 text-xs text-slate-500 font-normal">({group.count} items)</span>
                                    </td>
                                    <td className="px-3.5 py-2.5 text-slate-600 text-xs text-left whitespace-normal leading-snug">
                                      {group.count} expense entries (Avg: {formatCurrency(group.avgAmount)})
                                    </td>
                                    {!hideExpenseAmounts ? (
                                      <td className="px-3.5 py-2.5 text-right font-semibold text-slate-900 tabular-nums whitespace-normal leading-snug">{formatCurrency(group.totalAmount)}</td>
                                    ) : null}
                                  </tr>,
                                ];
                              }
                              return [
                                <tr
                                  key={`expense-date-header-${group.dateKey}`}
                                  className="group bg-slate-50/90 hover:bg-slate-100 cursor-pointer select-none transition-colors border-b border-slate-200"
                                  onClick={() => setExpandedExpenseGroups((current) => ({ ...current, [group.dateKey]: false }))}
                                >
                                  <td className="px-3.5 py-2 text-left whitespace-normal leading-snug">
                                    <div className="flex items-center gap-1.5">
                                      <ChevronDown className="h-4 w-4 text-slate-500 group-hover:text-slate-700 shrink-0 transition-colors" />
                                      <span className="font-semibold text-slate-800 text-sm">{group.dateKey}</span>
                                    </div>
                                  </td>
                                  <td className="px-3.5 py-2 text-slate-800 text-xs text-left whitespace-normal leading-snug">{group.primaryCategory} ({group.count} items)</td>
                                  <td className="px-3.5 py-2 text-slate-600 text-xs text-left whitespace-normal leading-snug">Avg: {formatCurrency(group.avgAmount)}</td>
                                  {!hideExpenseAmounts ? <td className="px-3.5 py-2 text-right font-semibold text-slate-900 tabular-nums text-xs whitespace-normal leading-snug">{formatCurrency(group.totalAmount)}</td> : null}
                                </tr>,
                                ...group.rows.map((item, rowIdx) => (
                                  <tr
                                    key={`expense-date-entry-${item.id}`}
                                    className={`transition-colors cursor-pointer select-none ${
                                      selectedExpenseIds.includes(item.id)
                                        ? 'bg-indigo-50/90 outline outline-2 -outline-offset-1 outline-indigo-500'
                                        : rowIdx % 2 === 0
                                          ? 'bg-white hover:bg-slate-50/80'
                                          : 'bg-slate-50/40 hover:bg-slate-100/60'
                                    }`}
                                    onMouseDown={(event) => beginExpenseSelection(item.id, event.shiftKey || event.metaKey)}
                                    onMouseEnter={() => {
                                      showRecordAudit('expense_logs', item.id, 'Expense entry');
                                      if (!expenseDragSelecting) return;
                                      addUniqueSelection(setSelectedExpenseIds, item.id);
                                      setSelectedExpenseId(item.id);
                                    }}
                                    onMouseLeave={hideAudit}
                                  >
                                    <td className="px-3.5 py-2.5 pl-8 text-xs text-slate-500 text-left whitespace-normal leading-snug">{formatDate(item.date)}</td>
                                    <td className="px-3.5 py-2.5 font-semibold text-slate-700 text-left whitespace-normal leading-snug">{item.category}</td>
                                    <td className="px-3.5 py-2.5 text-slate-600 text-left whitespace-normal leading-snug">{item.description || '-'}</td>
                                    {!hideExpenseAmounts ? <td className="px-3.5 py-2.5 text-right font-semibold text-slate-900 tabular-nums whitespace-normal leading-snug">{formatCurrency(item.amount)}</td> : null}
                                  </tr>
                                )),
                              ];
                            })
                          ) : expenseGroupMode === 'category' ? (
                            expenseGroupsByCategory.flatMap((group) => {
                              const expanded = expandedExpenseGroups[group.categoryKey] ?? false;
                              if (!expanded) {
                                return [
                                  <tr
                                    key={`expense-cat-summary-${group.categoryKey}`}
                                    className="group bg-slate-50/70 hover:bg-slate-100/80 cursor-pointer select-none transition-colors border-b border-slate-200/80"
                                    onClick={() => setExpandedExpenseGroups((current) => ({ ...current, [group.categoryKey]: true }))}
                                  >
                                    <td className="px-3.5 py-2.5 text-xs text-slate-600 text-left whitespace-normal leading-snug">{formatDateRange(group.startDate, group.endDate)}</td>
                                    <td className="px-3.5 py-2.5 text-left whitespace-normal leading-snug">
                                      <div className="flex items-center gap-1.5">
                                        <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-slate-600 shrink-0 transition-colors" />
                                        <span className="font-semibold text-slate-800 text-sm">{group.categoryKey}</span>
                                        <span className="text-xs text-slate-500 font-normal">({group.count} items)</span>
                                      </div>
                                    </td>
                                    <td className="px-3.5 py-2.5 text-slate-600 text-xs text-left whitespace-normal leading-snug">
                                      Avg per entry: {formatCurrency(group.avgAmount)}
                                    </td>
                                    {!hideExpenseAmounts ? (
                                      <td className="px-3.5 py-2.5 text-right font-semibold text-slate-900 tabular-nums whitespace-normal leading-snug">{formatCurrency(group.totalAmount)}</td>
                                    ) : null}
                                  </tr>,
                                ];
                              }
                              return [
                                <tr
                                  key={`expense-cat-header-${group.categoryKey}`}
                                  className="group bg-slate-50/90 hover:bg-slate-100 cursor-pointer select-none transition-colors border-b border-slate-200"
                                  onClick={() => setExpandedExpenseGroups((current) => ({ ...current, [group.categoryKey]: false }))}
                                >
                                  <td className="px-3.5 py-2 text-xs text-slate-600 text-left whitespace-normal leading-snug">{formatDateRange(group.startDate, group.endDate)}</td>
                                  <td className="px-3.5 py-2 text-left whitespace-normal leading-snug">
                                    <div className="flex items-center gap-1.5">
                                      <ChevronDown className="h-4 w-4 text-slate-500 group-hover:text-slate-700 shrink-0 transition-colors" />
                                      <span className="font-semibold text-slate-800 text-sm">{group.categoryKey}</span>
                                      <span className="text-xs text-slate-500 font-normal">({group.count} items)</span>
                                    </div>
                                  </td>
                                  <td className="px-3.5 py-2 text-slate-600 text-xs text-left whitespace-normal leading-snug">Avg per entry: {formatCurrency(group.avgAmount)}</td>
                                  {!hideExpenseAmounts ? <td className="px-3.5 py-2 text-right font-semibold text-slate-900 tabular-nums text-xs whitespace-normal leading-snug">{formatCurrency(group.totalAmount)}</td> : null}
                                </tr>,
                                ...group.rows.map((item, rowIdx) => (
                                  <tr
                                    key={`expense-cat-entry-${item.id}`}
                                    className={`transition-colors cursor-pointer select-none ${
                                      selectedExpenseIds.includes(item.id)
                                        ? 'bg-indigo-50/90 outline outline-2 -outline-offset-1 outline-indigo-500'
                                        : rowIdx % 2 === 0
                                          ? 'bg-white hover:bg-slate-50/80'
                                          : 'bg-slate-50/40 hover:bg-slate-100/60'
                                    }`}
                                    onMouseDown={(event) => beginExpenseSelection(item.id, event.shiftKey || event.metaKey)}
                                    onMouseEnter={() => {
                                      showRecordAudit('expense_logs', item.id, 'Expense entry');
                                      if (!expenseDragSelecting) return;
                                      addUniqueSelection(setSelectedExpenseIds, item.id);
                                      setSelectedExpenseId(item.id);
                                    }}
                                    onMouseLeave={hideAudit}
                                  >
                                    <td className="px-3.5 py-2.5 text-left text-xs text-slate-600 whitespace-normal leading-snug">{formatDate(item.date)}</td>
                                    <td className="px-3.5 py-2.5 font-semibold text-slate-700 text-left pl-8 whitespace-normal leading-snug">{item.category}</td>
                                    <td className="px-3.5 py-2.5 text-slate-600 text-left whitespace-normal leading-snug">{item.description || '-'}</td>
                                    {!hideExpenseAmounts ? <td className="px-3.5 py-2.5 text-right font-semibold text-slate-900 tabular-nums whitespace-normal leading-snug">{formatCurrency(item.amount)}</td> : null}
                                  </tr>
                                )),
                              ];
                            })
                          ) : (
                            sortedSelectedExpenses.map((item, idx) => (
                              <tr
                                key={item.id}
                                className={`transition-colors cursor-pointer select-none ${
                                  selectedExpenseIds.includes(item.id)
                                    ? 'bg-indigo-50/90 outline outline-2 -outline-offset-1 outline-indigo-500'
                                    : idx % 2 === 0
                                      ? 'bg-white hover:bg-slate-50/80'
                                      : 'bg-slate-50/40 hover:bg-slate-100/60'
                                }`}
                                onMouseDown={(event) => beginExpenseSelection(item.id, event.shiftKey || event.metaKey)}
                                onMouseEnter={() => {
                                  showRecordAudit('expense_logs', item.id, 'Expense entry');
                                  if (!expenseDragSelecting) return;
                                  addUniqueSelection(setSelectedExpenseIds, item.id);
                                  setSelectedExpenseId(item.id);
                                }}
                                onMouseLeave={hideAudit}
                              >
                                <td className="px-3.5 py-2.5 text-left font-medium text-slate-600 whitespace-normal leading-snug">{formatDate(item.date)}</td>
                                <td className="px-3.5 py-2.5 font-semibold text-slate-800 text-left whitespace-normal leading-snug">{item.category}</td>
                                <td className="px-3.5 py-2.5 text-slate-600 text-left whitespace-normal leading-snug">{item.description || '-'}</td>
                                {!hideExpenseAmounts ? <td className="px-3.5 py-2.5 text-right font-semibold text-slate-900 tabular-nums whitespace-normal leading-snug">{formatCurrency(item.amount)}</td> : null}
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
                {isOwner && ['materials', 'labour', 'expenses'].includes(activeProjectSection || '') ? (
                  <div className="mt-3 flex justify-end">
                    <div className="w-full max-w-sm space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      {summaryRows.map((row) => (
                        <div key={row.key} className="flex items-center justify-between text-base">
                          <span className="font-semibold text-slate-700">{row.label}</span>
                          <span className="font-bold text-slate-900">{formatCurrency(row.value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {activeProjectSection === 'transactions' && canViewProjectTransactions ? (
                  <div className="flex h-full flex-1 flex-col min-h-0 gap-3">
                    <div className="grid gap-3 xl:grid-cols-3">
                      <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-black uppercase tracking-wider text-yellow-800">Total Cost</p>
                            <p className="mt-1 text-2xl font-black text-yellow-950">{formatCurrency(transactionTotalCost)}</p>
                          </div>
                          <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-bold text-yellow-800">Material + Labour</span>
                        </div>
                        <div className="mt-3 grid gap-2 text-sm font-semibold text-yellow-900 sm:grid-cols-2">
                          <div className="rounded-lg bg-white/70 px-3 py-2">
                            <span className="block text-xs uppercase tracking-wider text-yellow-700">Material Cost</span>
                            {formatCurrency(materialSubtotal)}
                          </div>
                          <div className="rounded-lg bg-white/70 px-3 py-2">
                            <span className="block text-xs uppercase tracking-wider text-yellow-700">Labour Cost</span>
                            {formatCurrency(labourSubtotal)}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-black uppercase tracking-wider text-emerald-800">Total Payments</p>
                            <p className="mt-1 text-2xl font-black text-emerald-950">{formatCurrency(transactionTotalPayments)}</p>
                          </div>
                          <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-bold text-emerald-800">Vendor + Incharge</span>
                        </div>
                        <div className="mt-3 grid gap-2 text-sm font-semibold text-emerald-900 sm:grid-cols-2">
                          <div className="rounded-lg bg-white/70 px-3 py-2">
                            <span className="block text-xs uppercase tracking-wider text-emerald-700">Vendors Payment</span>
                            {formatCurrency(materialVendorPaymentsTotal)}
                          </div>
                          <div className="rounded-lg bg-white/70 px-3 py-2">
                            <span className="block text-xs uppercase tracking-wider text-emerald-700">Incharge Payment</span>
                            {formatCurrency(labourInchargePaymentsTotal)}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-black uppercase tracking-wider text-rose-800">Yet To Pay</p>
                            <p className="mt-1 text-2xl font-black text-rose-950">{formatCurrency(transactionYetToPay)}</p>
                          </div>
                          <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-bold text-rose-800">Pending</span>
                        </div>
                        <div className="mt-3 grid gap-2 text-sm font-semibold text-rose-900 sm:grid-cols-2">
                          <div className="rounded-lg bg-white/70 px-3 py-2">
                            <span className="block text-xs uppercase tracking-wider text-rose-700">Vendor Yet To Pay</span>
                            {formatCurrency(materialYetToPay)}
                          </div>
                          <div className="rounded-lg bg-white/70 px-3 py-2">
                            <span className="block text-xs uppercase tracking-wider text-rose-700">Incharge Yet To Pay</span>
                            {formatCurrency(labourYetToPay)}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-600">
                        <span className="rounded-lg bg-yellow-50 px-3 py-1.5 text-yellow-800">Cost: {formatCurrency(transactionTotalCost)}</span>
                        <span className="rounded-lg bg-emerald-50 px-3 py-1.5 text-emerald-800">Paid: {formatCurrency(transactionTotalPayments)}</span>
                        <span className="rounded-lg bg-rose-50 px-3 py-1.5 text-rose-800">Pending: {formatCurrency(transactionYetToPay)}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className={`rounded-xl p-2.5 transition ${showTransactionsTabSearch ? 'bg-indigo-100 text-indigo-700 ring-2 ring-indigo-300' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                          onClick={() => {
                            setShowTransactionsTabSearch((prev) => !prev);
                            if (showTransactionsTabSearch) setTransactionsTabSearch('');
                          }}
                          title="Search transactions"
                        >
                          <Search className="h-4 w-4" />
                        </button>
                        {showTransactionsTabSearch ? (
                          <label className="relative min-w-0 w-full max-w-xs flex-1">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <input
                              type="search"
                              placeholder="Search transactions..."
                              value={transactionsTabSearch}
                              onChange={(e) => setTransactionsTabSearch(e.target.value)}
                              className="w-full rounded-2xl border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                              autoFocus
                            />
                          </label>
                        ) : null}
                        <button
                          type="button"
                          className={`inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-black shadow-md ring-2 ring-white transition hover:-translate-y-0.5 ${showAllVendorPayments ? 'bg-emerald-700 text-white shadow-emerald-200' : 'bg-graphite text-white shadow-slate-300 hover:bg-black'}`}
                          onClick={() => setShowAllVendorPayments((current) => !current)}
                          title="Show all vendor and incharge payments"
                        >
                          <Receipt className="h-4 w-4" />
                          All Payments
                        </button>
                      </div>
                    </div>
                    <div className="grid gap-4 xl:grid-cols-2">
                      <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 bg-slate-50/50">
                          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">Vendors For Materials</h3>
                          <span className="rounded-full bg-slate-200/70 px-2.5 py-0.5 text-xs font-semibold text-slate-700">{filteredMaterialVendorRows.length}</span>
                        </div>
                        <table className="w-full table-fixed text-sm">
                          <thead className="bg-slate-100 text-slate-700">
                            <tr>
                              <SortableHeader label="Vendor" columnKey="vendor" sortState={transactionsSort} onSort={(k) => setTransactionsSort((c) => toggleColumnSort(c, k))} widthClass="w-[28%]" />
                              <SortableHeader label="Material Due" columnKey="due" sortState={transactionsSort} onSort={(k) => setTransactionsSort((c) => toggleColumnSort(c, k))} align="right" widthClass="w-[20%]" />
                              <SortableHeader label="Paid" columnKey="paid" sortState={transactionsSort} onSort={(k) => setTransactionsSort((c) => toggleColumnSort(c, k))} align="right" widthClass="w-[18%]" />
                              <th className="w-[18%] px-3 py-2.5 text-right font-semibold text-xs uppercase tracking-wider text-slate-700 border-b border-slate-200">Difference</th>
                              <th className="w-[16%] px-3 py-2.5 text-center font-semibold text-xs uppercase tracking-wider text-slate-700 border-b border-slate-200">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sortedMaterialVendorRows.length ? sortedMaterialVendorRows.map((row, idx) => (
                              <tr
                                key={`material-vendor-${row.vendorId}`}
                                className={clsx(
                                  'border-t border-slate-100 cursor-pointer transition',
                                  selectedVendorId === row.vendorId && selectedVendorDetailType === 'material'
                                    ? 'bg-indigo-50/80 outline outline-2 -outline-offset-1 outline-indigo-300'
                                    : idx % 2 === 0 ? 'bg-white hover:bg-slate-50/80' : 'bg-slate-50/40 hover:bg-slate-100/60'
                                )}
                                onClick={() => {
                                  setSelectedVendorId(row.vendorId);
                                  setSelectedVendorDetailType('material');
                                  setShowVendorDetailModal(true);
                                }}
                              >
                                <td className="px-3 py-2.5 font-semibold text-indigo-700 text-left break-words whitespace-normal leading-snug">{row.vendorName}</td>
                                <td className="px-3 py-2.5 text-right font-semibold text-slate-800 tabular-nums break-words whitespace-normal leading-snug">{formatCurrency(row.materialDue)}</td>
                                <td className="px-3 py-2.5 text-right text-slate-800 tabular-nums break-words whitespace-normal leading-snug">{formatCurrency(row.paid)}</td>
                                <td className={clsx('px-3 py-2.5 text-right font-bold tabular-nums break-words whitespace-normal leading-snug', row.paid - row.materialDue > 0 ? 'text-emerald-700' : row.paid - row.materialDue < 0 ? 'text-rose-700' : 'text-slate-500')}>
                                  {row.paid - row.materialDue === 0 ? formatCurrency(0) : row.paid - row.materialDue > 0 ? `+${formatCurrency(row.paid - row.materialDue)}` : `-${formatCurrency(Math.abs(row.paid - row.materialDue))}`}
                                </td>
                                <td className="px-3 py-2.5 text-center">
                                  {row.vendorId > 0 && canManageVendorTransactions ? (
                                    <div className="flex flex-wrap justify-center gap-1.5" onClick={(event) => event.stopPropagation()}>
                                      <button type="button" className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 transition" onClick={() => openNewVendorPayment(row.vendorId)}>Pay</button>
                                      <button type="button" className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition" title="Edit latest payment" onClick={() => openEditLatestVendorPayment(row.vendorId)}>Edit</button>
                                    </div>
                                  ) : '-'}
                                </td>
                              </tr>
                            )) : (
                              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No material vendors mapped yet.</td></tr>
                            )}
                          </tbody>
                          {sortedMaterialVendorRows.length ? (
                            <tfoot>
                              <tr className="border-t border-slate-200 bg-slate-50 font-bold text-slate-900">
                                <td className="px-3 py-2.5 text-left">Total</td>
                                <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(vendorMaterialDueTotal)}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(sortedMaterialVendorRows.reduce((sum, row) => sum + row.paid, 0))}</td>
                                <td colSpan={2} />
                              </tr>
                            </tfoot>
                          ) : null}
                        </table>
                      </div>

                      <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 bg-slate-50/50">
                          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">Labour Incharges</h3>
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-slate-200/70 px-2.5 py-0.5 text-xs font-semibold text-slate-700">{sortedLabourInchargeRows.length}</span>
                            {canManageInchargeLimits ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-2.5 py-1 text-xs font-bold text-indigo-700 shadow-sm transition hover:bg-indigo-50"
                              onClick={() => setLabourLimitDialog({ vendorId: null, vendorName: '' })}
                            >
                              <Gauge className="h-3.5 w-3.5" />
                              Set limit
                            </button>
                            ) : null}
                          </div>
                        </div>
                        <table className="w-full table-fixed text-sm">
                          <thead className="bg-slate-100 text-slate-700">
                            <tr>
                              <SortableHeader label="Incharge" columnKey="vendor" sortState={transactionsSort} onSort={(k) => setTransactionsSort((c) => toggleColumnSort(c, k))} widthClass="w-[28%]" />
                              <SortableHeader label="Labour Cost" columnKey="due" sortState={transactionsSort} onSort={(k) => setTransactionsSort((c) => toggleColumnSort(c, k))} align="right" widthClass="w-[18%]" />
                              <SortableHeader label="Paid / Balance" columnKey="paid" sortState={transactionsSort} onSort={(k) => setTransactionsSort((c) => toggleColumnSort(c, k))} align="right" widthClass="w-[24%]" />
                              <SortableHeader label="Limit & Balance" columnKey="limit" sortState={transactionsSort} onSort={(k) => setTransactionsSort((c) => toggleColumnSort(c, k))} align="right" widthClass="w-[20%]" />
                              <th className="w-[10%] px-3 py-2.5 text-center font-semibold text-xs uppercase tracking-wider text-slate-700 border-b border-slate-200">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sortedLabourInchargeRows.length ? sortedLabourInchargeRows.map((row, idx) => {
                              const limitStatus = labourLimitStatus(labourLimitByVendorId.get(row.vendorId), row.labourDue);
                              const remainingPct = limitStatus.hasLimit && limitStatus.limit > 0
                                ? (limitStatus.remaining / limitStatus.limit) * 100
                                : 0;
                              return (
                              <tr
                                key={`labour-incharge-${row.vendorId}`}
                                className={clsx(
                                  'border-t border-slate-100 cursor-pointer transition',
                                  selectedVendorId === row.vendorId && selectedVendorDetailType === 'labour'
                                    ? 'bg-indigo-50/80 outline outline-2 -outline-offset-1 outline-indigo-300'
                                    : limitStatus.tone === 'over'
                                      ? 'bg-rose-50/70 hover:bg-rose-50'
                                      : limitStatus.tone === 'limit' || limitStatus.tone === 'watch'
                                        ? 'bg-amber-50/60 hover:bg-amber-50'
                                        : idx % 2 === 0 ? 'bg-white hover:bg-slate-50/80' : 'bg-slate-50/40 hover:bg-slate-100/60'
                                )}
                                onClick={() => {
                                  setSelectedVendorId(row.vendorId);
                                  setSelectedVendorDetailType('labour');
                                  setShowVendorDetailModal(true);
                                }}
                              >
                                <td className="px-3 py-2.5 font-semibold text-indigo-700 text-left break-words whitespace-normal leading-snug">{row.vendorId === 0 ? 'Unassigned incharge' : row.vendorName}</td>
                                <td className="px-3 py-2.5 text-right font-bold text-slate-800 tabular-nums break-words whitespace-normal leading-snug">{formatCurrency(row.labourDue)}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap leading-tight">
                                  <div className="flex flex-col items-end gap-0.5">
                                    <span className="text-xs font-bold text-slate-900">{formatCurrency(row.paid)}</span>
                                    <span
                                      className={clsx(
                                        'text-[11px] font-semibold',
                                        row.paid - row.labourDue > 0
                                          ? 'text-emerald-700'
                                          : row.paid - row.labourDue < 0
                                            ? 'text-rose-700'
                                            : 'text-slate-500'
                                      )}
                                    >
                                      {row.paid - row.labourDue === 0
                                        ? 'Cleared'
                                        : row.paid - row.labourDue > 0
                                          ? `+${formatCurrency(row.paid - row.labourDue)} (Adv)`
                                          : `-${formatCurrency(Math.abs(row.paid - row.labourDue))} (Pending)`}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap leading-tight">
                                  {limitStatus.hasLimit ? (
                                    <div className="flex flex-col items-end gap-0.5">
                                      <span className="text-xs font-semibold text-slate-700">
                                        {formatCurrency(limitStatus.limit)}
                                      </span>
                                      <span className={clsx('text-[11px]', getLabourLimitRemainingClass(limitStatus))}>
                                        {limitStatus.remaining >= 0
                                          ? formatCurrency(limitStatus.remaining)
                                          : `-${formatCurrency(Math.abs(limitStatus.remaining))}`}
                                        <span className="ml-1 text-[10px] font-normal opacity-85">
                                          ({limitStatus.remaining < 0 ? 'Over' : `${remainingPct.toFixed(0)}% rem.`})
                                        </span>
                                      </span>
                                    </div>
                                  ) : (
                                    <span className="text-xs text-slate-400">—</span>
                                  )}
                                </td>
                                <td className="px-3 py-2.5 text-center">
                                  {row.vendorId > 0 && canManageVendorTransactions ? (
                                    <div className="flex flex-wrap justify-center gap-1.5" onClick={(event) => event.stopPropagation()}>
                                      <button type="button" className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 transition" onClick={() => openNewVendorPayment(row.vendorId)}>Pay</button>
                                      <button type="button" className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition" title="Edit latest payment" onClick={() => openEditLatestVendorPayment(row.vendorId)}>Edit</button>
                                    </div>
                                  ) : '-'}
                                </td>
                              </tr>
                            ); }) : (
                              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No labour incharges mapped yet.</td></tr>
                            )}
                          </tbody>
                          {labourInchargeRows.length ? (
                            <tfoot>
                              <tr className="border-t border-slate-200 bg-slate-50 font-bold text-slate-900">
                                <td className="px-3 py-2.5 text-left">Total</td>
                                <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(vendorLabourDueTotal)}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(labourInchargeRows.reduce((sum, row) => sum + row.paid, 0))}</td>
                                <td colSpan={2} />
                              </tr>
                            </tfoot>
                          ) : null}
                        </table>
                      </div>
                    </div>
                    {showVendorDetailModal && selectedVendorDetail ? (
                      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/45 px-2 py-5 sm:px-3" onClick={() => setShowVendorDetailModal(false)}>
                        <div className="w-[calc(100vw-1rem)] max-w-[96rem] rounded-xl border border-indigo-200 bg-white p-4 shadow-2xl sm:w-[calc(100vw-1.5rem)] sm:p-5" onClick={(event) => event.stopPropagation()}>
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-600">
                                {selectedVendorDetail.detailType === 'material' ? 'Material Vendor' : 'Labour Incharge'}
                              </p>
                              <h3 className="mt-1 text-lg font-black text-graphite">{selectedVendorDetail.vendorName}</h3>
                              <p className="mt-1 text-sm font-semibold text-slate-600">
                                Phone: {selectedVendorDetail.phone || '-'} | Address: {selectedVendorDetail.address || '-'}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {canManageVendorTransactions ? (
                              <button type="button" className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-700" onClick={() => openNewVendorPayment(selectedVendorDetail.vendorId)}>
                                Add Payment
                              </button>
                              ) : null}
                              <button type="button" className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100" onClick={printVendorDetail}>
                                <Printer className="h-3.5 w-3.5" />
                                Print
                              </button>
                              {selectedVendorDetail.vendorId > 0 && (selectedVendorDetail.detailType === 'material' ? canEditVendorMaster : canEditInchargeMaster) ? (
                                <button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50" onClick={() => openEditVendor(selectedVendorDetail.vendorId)}>
                                  {selectedVendorDetail.detailType === 'material' ? 'Edit Vendor' : 'Edit Incharge'}
                                </button>
                              ) : null}
                              <button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50" onClick={() => setShowVendorDetailModal(false)}>
                                Close
                              </button>
                            </div>
                          </div>
                          <div className="mt-3 grid gap-2 md:grid-cols-4">
                            <div className="rounded-lg bg-amber-50 p-3">
                              <p className="text-xs font-bold text-amber-700">{selectedVendorDetail.detailType === 'material' ? 'Material Due' : 'Labour Due'}</p>
                              <p className="text-base font-black text-amber-900">{formatCurrency(selectedVendorDetail.detailType === 'material' ? selectedVendorDetail.balance?.materialDue || 0 : selectedVendorDetail.balance?.labourDue || 0)}</p>
                            </div>
                            <div className="rounded-lg bg-emerald-50 p-3"><p className="text-xs font-bold text-emerald-700">Paid</p><p className="text-base font-black text-emerald-900">{formatCurrency(selectedVendorDetail.balance?.paid || 0)}</p></div>
                            <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs font-bold text-slate-600">Material Rows</p><p className="text-base font-black text-slate-900">{selectedVendorDetail.balance?.materialCount || 0}</p></div>
                            <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs font-bold text-slate-600">Labour Rows</p><p className="text-base font-black text-slate-900">{selectedVendorDetail.balance?.labourCount || 0}</p></div>
                          </div>
                          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                            <div className="min-w-0 overflow-auto rounded-xl border border-slate-200">
                              <table className="w-full text-sm">
                                <colgroup>
                                  <col className="w-[7rem]" />
                                  <col className="w-[5rem]" />
                                  <col className="w-[8rem]" />
                                  <col className="w-[5.5rem]" />
                                  <col className="w-[6.5rem]" />
                                  <col />
                                </colgroup>
                                <thead className="bg-slate-100 text-slate-700">
                                  <tr>
                                    <th className="px-3 py-2 text-left font-semibold text-xs uppercase tracking-wider border-b border-slate-200">Date</th>
                                    <th className="px-3 py-2 text-left font-semibold text-xs uppercase tracking-wider border-b border-slate-200">Type</th>
                                    <th className="px-3 py-2 text-left font-semibold text-xs uppercase tracking-wider border-b border-slate-200">{selectedVendorDetail.detailType === 'material' ? 'Material' : 'Labour'}</th>
                                    <th className="px-3 py-2 text-left font-semibold text-xs uppercase tracking-wider border-b border-slate-200">Qty</th>
                                    <th className="px-3 py-2 text-right font-semibold text-xs uppercase tracking-wider border-b border-slate-200">Amount</th>
                                    <th className="px-3 py-2 text-left font-semibold text-xs uppercase tracking-wider border-b border-slate-200">Remarks</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {selectedVendorDetail.responsibilityRows.length ? selectedVendorDetail.responsibilityRows.map((row, idx) => (
                                    <tr key={`${row.type}-${row.id}`} className={clsx('border-t border-slate-100 transition', idx % 2 === 0 ? 'bg-white hover:bg-slate-50/80' : 'bg-slate-50/40 hover:bg-slate-100/60')} onMouseEnter={() => showRecordAudit(row.type === 'Labour' ? 'labor_logs' : 'material_logs', row.id, `${row.type} entry`)} onMouseLeave={hideAudit}>
                                      <td className="px-3 py-2 whitespace-nowrap align-top">{formatDate(row.date)}</td>
                                      <td className="px-3 py-2 whitespace-nowrap align-top font-semibold">{row.type}</td>
                                      <td className="px-3 py-2 align-top break-words leading-snug">{row.item}</td>
                                      <td className="px-3 py-2 whitespace-nowrap align-top tabular-nums">{row.quantity}</td>
                                      <td className="px-3 py-2 whitespace-nowrap align-top text-right font-semibold tabular-nums">{formatCurrency(row.amount)}</td>
                                      <td className="px-3 py-2 align-top leading-snug text-slate-600">{row.remarks}</td>
                                    </tr>
                                  )) : (
                                    <tr><td colSpan={6} className="px-3 py-5 text-center text-slate-400">No responsibility mapped here yet.</td></tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                            <div className="min-w-0 overflow-auto rounded-xl border border-slate-200">
                              <table className="w-full text-sm">
                                <colgroup>
                                  <col className="w-[7rem]" />
                                  <col className="w-[5rem]" />
                                  <col className="w-[6rem]" />
                                  <col className="w-[6rem]" />
                                  <col />
                                  <col className="w-[7.5rem]" />
                                </colgroup>
                                <thead className="bg-slate-100 text-slate-700">
                                  <tr>
                                    <th className="px-3 py-2 text-left font-semibold text-xs uppercase tracking-wider border-b border-slate-200">Date</th>
                                    <th className="px-3 py-2 text-left font-semibold text-xs uppercase tracking-wider border-b border-slate-200">Mode</th>
                                    <th className="px-3 py-2 text-right font-semibold text-xs uppercase tracking-wider border-b border-slate-200">Round Off</th>
                                    <th className="px-3 py-2 text-right font-semibold text-xs uppercase tracking-wider border-b border-slate-200">Paid</th>
                                    <th className="px-3 py-2 text-left font-semibold text-xs uppercase tracking-wider border-b border-slate-200">Remarks</th>
                                    <th className="px-3 py-2 text-center font-semibold text-xs uppercase tracking-wider border-b border-slate-200">Actions</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {selectedVendorDetail.payments.length ? selectedVendorDetail.payments.map((payment, idx) => (
                                    <tr key={payment.id} className={clsx('border-t border-slate-100 transition', idx % 2 === 0 ? 'bg-white hover:bg-slate-50/80' : 'bg-slate-50/40 hover:bg-slate-100/60')} onMouseEnter={() => showRecordAudit('vendor_transactions', payment.id, 'Vendor payment')} onMouseLeave={hideAudit}>
                                      <td className="px-3 py-2 whitespace-nowrap align-top">{formatDate(payment.payment_date)}</td>
                                      <td className="px-3 py-2 whitespace-nowrap align-top">{payment.payment_mode || '-'}</td>
                                      <td className={`px-3 py-2 whitespace-nowrap align-top text-right font-semibold tabular-nums ${roundOffTextClass(Number(payment.round_off || 0))}`}>{formatCurrency(Number(payment.round_off || 0))}</td>
                                      <td className="px-3 py-2 whitespace-nowrap align-top text-right font-semibold tabular-nums text-slate-900">{formatCurrency(vendorPaymentTotal(payment))}</td>
                                      <td className="px-3 py-2 align-top leading-snug text-slate-600">{payment.notes || '-'}</td>
                                      <td className="px-3 py-2 text-center align-top">
                                        {canManageVendorTransactions ? (
                                        <div className="flex flex-wrap justify-center gap-1.5">
                                          <button type="button" className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-sm" onClick={() => openEditVendorPayment(payment.id)}>Edit</button>
                                          <button type="button" className="rounded-lg bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100" onClick={() => { if (confirm('Delete this transaction?')) deleteVendorTransactionMutation.mutate(payment.id); }}>Delete</button>
                                        </div>
                                        ) : '-'}
                                      </td>
                                    </tr>
                                  )) : (
                                    <tr><td colSpan={6} className="px-3 py-5 text-center text-slate-400">No payments recorded for this vendor.</td></tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                    {showAllVendorPayments ? (
                      <div className="flex-1 min-h-0 min-w-0 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/50 px-4 py-3">
                          <div>
                            <p className="text-xs font-bold uppercase tracking-wider text-slate-800">All Payments</p>
                            <p className="text-xs font-semibold text-slate-500">{vendorTransactions.length} payment{vendorTransactions.length !== 1 ? 's' : ''}</p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <label htmlFor="txn-group-select" className="text-xs font-bold uppercase tracking-wider text-slate-600 whitespace-nowrap">
                              Group By:
                            </label>
                            <select
                              id="txn-group-select"
                              value={vendorTransactionGroupMode}
                              onChange={(e) => {
                                setVendorTransactionGroupMode(e.target.value as 'date' | 'vendor');
                                setExpandedVendorTransactionGroups({});
                              }}
                              className="h-9 min-w-[120px] px-3 py-1 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-800 shadow-sm transition hover:border-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 cursor-pointer"
                            >
                              <option value="date">Date</option>
                              <option value="vendor">Vendor</option>
                            </select>
                            {canManageVendorTransactions ? (
                            <button
                              className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 transition"
                              onClick={() => openNewVendorPayment()}
                            >+ Record Payment</button>
                            ) : null}
                          </div>
                        </div>
                        <div className="min-h-0 overflow-auto">
                          <table className="w-full table-fixed text-sm sm:text-base border-collapse">
                            <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
                              <tr>
                                <th className={`${vendorTransactionGroupMode === 'vendor' ? 'w-[22%]' : 'w-[12%]'} bg-slate-100 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider border-b border-slate-200`}>{vendorTransactionGroupMode === 'vendor' ? 'Vendor' : 'Date'}</th>
                                <th className={`${vendorTransactionGroupMode === 'vendor' ? 'w-[12%]' : 'w-[20%]'} bg-slate-100 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider border-b border-slate-200`}>{vendorTransactionGroupMode === 'vendor' ? 'Date' : 'Vendor'}</th>
                                <th className="w-[10%] bg-slate-100 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider border-b border-slate-200">Mode</th>
                                <th className="w-[20%] bg-slate-100 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider border-b border-slate-200">Remarks</th>
                                <th className="w-[12%] bg-slate-100 px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider border-b border-slate-200">Round Off</th>
                                <th className="w-[14%] bg-slate-100 px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider border-b border-slate-200">Amount Paid</th>
                                <th className="w-[10%] bg-slate-100 px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wider border-b border-slate-200">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {vendorTransactions.length === 0 ? (
                                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No transactions yet. Click &ldquo;+ Record Payment&rdquo; to add one.</td></tr>
                              ) : null}
                              {vendorTransactionGroupMode === 'date' ? (
                                filteredVendorTransactionGroupsByDate.flatMap(([dateKey, rows], groupIdx) => {
                                  return rows.map((txn, idx) => {
                                    const vendor = vendorMaster.find((v) => v.id === txn.vendor_id);
                                    return (
                                      <tr key={txn.id} className={clsx('border-t border-slate-100 transition', idx % 2 === 0 ? 'bg-white hover:bg-slate-50/80' : 'bg-slate-50/40 hover:bg-slate-100/60')} onMouseEnter={() => showRecordAudit('vendor_transactions', txn.id, 'Vendor payment')} onMouseLeave={hideAudit}>
                                        {idx === 0 ? <td rowSpan={rows.length} className="px-4 py-3 align-top text-left font-semibold border-r border-slate-100 bg-slate-50/30 text-slate-800">{formatDate(dateKey)}</td> : null}
                                        <td className="px-4 py-3 font-semibold text-slate-800 break-words whitespace-normal leading-snug">{vendor?.name ?? `Vendor #${txn.vendor_id}`}</td>
                                        <td className="px-4 py-3 text-slate-500">{txn.payment_mode || '-'}</td>
                                        <td className="px-4 py-3 text-slate-600 break-words whitespace-normal leading-snug">{txn.notes || '-'}</td>
                                        <td className={`px-4 py-3 text-right font-semibold tabular-nums ${roundOffTextClass(Number(txn.round_off || 0))}`}>{formatCurrency(Number(txn.round_off || 0))}</td>
                                        <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-900">{formatCurrency(vendorPaymentTotal(txn))}</td>
                                        <td className="px-4 py-3 text-center">
                                          {canManageVendorTransactions ? (
                                          <div className="flex justify-center gap-1.5">
                                            <button className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-sm" onClick={() => openEditVendorPayment(txn.id)}>Edit</button>
                                            <button className="rounded-lg bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100" onClick={() => { if (confirm('Delete this transaction?')) deleteVendorTransactionMutation.mutate(txn.id); }}>Delete</button>
                                          </div>
                                          ) : '-'}
                                        </td>
                                      </tr>
                                    );
                                  });
                                })
                              ) : (
                                filteredVendorTransactionGroupsByVendor.flatMap<React.ReactNode>((group, groupIdx) => {
                                  const expanded = expandedVendorTransactionGroups[group.vendorKey] ?? false;
                                  if (!expanded) {
                                    return [
                                      <tr
                                        key={`vendor-transaction-summary-${group.vendorKey}`}
                                        className={clsx(
                                          'border-t border-slate-200 cursor-pointer select-none font-semibold text-slate-900 transition group',
                                          groupIdx % 2 === 0 ? 'bg-white hover:bg-slate-50' : 'bg-slate-50/40 hover:bg-slate-100/70'
                                        )}
                                        onClick={() => {
                                          setSelectedVendorId(Number(group.vendorKey));
                                          setExpandedVendorTransactionGroups((current) => ({ ...current, [group.vendorKey]: true }));
                                        }}
                                      >
                                        <td className="px-4 py-3 text-left font-bold text-indigo-700 break-words whitespace-normal leading-snug flex items-center gap-1.5">
                                          <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-indigo-600 shrink-0 transition-transform" />
                                          <span>{group.vendorName}</span>
                                        </td>
                                        <td className="px-4 py-3 text-left text-slate-600 break-words whitespace-normal leading-snug">{formatDateRange(group.startDate, group.endDate)}</td>
                                        <td className="px-4 py-3 text-left text-slate-600 break-words whitespace-normal leading-snug">Various modes</td>
                                        <td className="px-4 py-3 text-left text-slate-600 text-xs break-words whitespace-normal leading-snug">{group.rows.length} payment{group.rows.length !== 1 ? 's' : ''}</td>
                                        <td className={`px-4 py-3 text-right font-bold tabular-nums break-words whitespace-normal leading-snug ${roundOffTextClass(group.totalRoundOff)}`}>{formatCurrency(group.totalRoundOff)}</td>
                                        <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-900 break-words whitespace-normal leading-snug">{formatCurrency(group.totalAmount)}</td>
                                        <td className="px-4 py-3 text-center text-xs text-indigo-600 font-semibold">Expand</td>
                                      </tr>,
                                    ];
                                  }

                                  return [
                                    <tr
                                      key={`vendor-transaction-header-${group.vendorKey}`}
                                      className="border-t border-b border-slate-200 cursor-pointer select-none font-bold text-slate-900 bg-slate-100/80 hover:bg-slate-100 transition group"
                                      onClick={() => setExpandedVendorTransactionGroups((current) => ({ ...current, [group.vendorKey]: false }))}
                                    >
                                      <td className="px-4 py-2.5 font-bold text-indigo-700 text-left break-words whitespace-normal leading-snug flex items-center gap-1.5">
                                        <ChevronDown className="h-4 w-4 text-slate-500 shrink-0" />
                                        <span>{group.vendorName}</span>
                                      </td>
                                      <td className="px-4 py-2.5 text-slate-700 text-left break-words whitespace-normal leading-snug">{formatDateRange(group.startDate, group.endDate)}</td>
                                      <td className="px-4 py-2.5 text-slate-600 text-left break-words whitespace-normal leading-snug">Various modes</td>
                                      <td className="px-4 py-2.5 text-slate-600 text-left text-xs break-words whitespace-normal leading-snug">{group.rows.length} payments</td>
                                      <td className={`px-4 py-2.5 text-right font-bold tabular-nums break-words whitespace-normal leading-snug ${roundOffTextClass(group.totalRoundOff)}`}>{formatCurrency(group.totalRoundOff)}</td>
                                      <td className="px-4 py-2.5 text-right font-bold tabular-nums text-slate-900 break-words whitespace-normal leading-snug">{formatCurrency(group.totalAmount)}</td>
                                      <td className="px-4 py-2.5 text-center text-xs text-indigo-600 font-semibold">Collapse</td>
                                    </tr>,
                                    ...group.rows.map((txn, idx) => (
                                      <tr key={`vendor-transaction-${group.vendorKey}-${txn.id}`} className={clsx('border-t border-slate-100 transition', idx % 2 === 0 ? 'bg-white hover:bg-slate-50' : 'bg-slate-50/40 hover:bg-slate-100/60')} onMouseEnter={() => showRecordAudit('vendor_transactions', txn.id, 'Vendor payment')} onMouseLeave={hideAudit}>
                                        <td className="px-4 py-3 font-semibold text-slate-800 text-left pl-8 break-words whitespace-normal leading-snug">{group.vendorName}</td>
                                        <td className="px-4 py-3 text-left text-slate-700 break-words whitespace-normal leading-snug">{formatDate(txn.payment_date)}</td>
                                        <td className="px-4 py-3 text-left text-slate-600 break-words whitespace-normal leading-snug">{txn.payment_mode || '-'}</td>
                                        <td className="px-4 py-3 text-left text-slate-600 break-words whitespace-normal leading-snug">{txn.notes || '-'}</td>
                                        <td className={`px-4 py-3 text-right font-semibold tabular-nums break-words whitespace-normal leading-snug ${roundOffTextClass(Number(txn.round_off || 0))}`}>{formatCurrency(Number(txn.round_off || 0))}</td>
                                        <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-900 break-words whitespace-normal leading-snug">{formatCurrency(vendorPaymentTotal(txn))}</td>
                                        <td className="px-4 py-3 text-center">
                                          {canManageVendorTransactions ? (
                                          <div className="flex justify-center gap-1.5">
                                            <button className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-sm" onClick={() => openEditVendorPayment(txn.id)}>Edit</button>
                                            <button className="rounded-lg bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100" onClick={() => { if (confirm('Delete this transaction?')) deleteVendorTransactionMutation.mutate(txn.id); }}>Delete</button>
                                          </div>
                                          ) : '-'}
                                        </td>
                                      </tr>
                                    )),
                                  ];
                                })
                              )}
                            </tbody>
                            {vendorTransactions.length > 0 ? (
                              <tfoot>
                                <tr className="border-t border-slate-200 bg-slate-50">
                                  <td colSpan={4} className="px-4 py-3 font-bold text-slate-900">Total Paid to Vendors</td>
                                  <td className={`px-4 py-3 text-right font-bold tabular-nums ${roundOffTextClass(vendorRoundOffTotal)}`}>{formatCurrency(vendorRoundOffTotal)}</td>
                                  <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-900">{formatCurrency(vendorPaymentsTotal)}</td>
                                  <td />
                                </tr>
                              </tfoot>
                            ) : null}
                          </table>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {activeProjectSection === 'files' && canViewProjectFiles ? (
                  <div className="flex h-full min-h-0 flex-1 flex-col gap-4">
                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <FileArchive className="h-5 w-5 text-indigo-600" />
                            <h3 className="text-base font-bold uppercase tracking-wider text-slate-800">Project Files</h3>
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                              {projectFiles.length} file{projectFiles.length !== 1 ? 's' : ''}
                            </span>
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                              {fileFolders.length} folder{fileFolders.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-1 text-sm font-semibold text-slate-600">
                            <button
                              type="button"
                              className={clsx(
                                'inline-flex items-center gap-1 rounded-md px-2.5 py-1.5',
                                currentFileFolderId === null ? 'bg-graphite text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
                              )}
                              onClick={() => setCurrentFileFolderId(null)}
                              title="Open root folder"
                            >
                              <Home className="h-4 w-4" />
                              Root
                            </button>
                            {fileBreadcrumbs.map((folder) => (
                              <div key={folder.id} className="flex items-center gap-1">
                                <ChevronRight className="h-4 w-4 text-slate-300" />
                                <button
                                  type="button"
                                  className={clsx(
                                    'max-w-[180px] truncate rounded-md px-2.5 py-1.5',
                                    currentFileFolderId === folder.id ? 'bg-graphite text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
                                  )}
                                  onClick={() => setCurrentFileFolderId(folder.id)}
                                  title={`Open ${folder.name}`}
                                >
                                  {folder.name}
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <form
                            className="flex min-w-0 w-full max-w-md flex-1 items-center gap-2"
                            onSubmit={(event) => {
                              event.preventDefault();
                              if (!selectedProjectId || !newFolderName.trim()) return;
                              createProjectFolderMutation.mutate({
                                projectId: selectedProjectId,
                                name: newFolderName.trim(),
                                parentId: currentFileFolderId,
                              });
                            }}
                          >
                            <div className="relative min-w-0 flex-1">
                              <FolderPlus className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                              <input
                                className="h-10 min-w-0 rounded-lg border-slate-300 pl-9 text-sm"
                                value={newFolderName}
                                onChange={(event) => setNewFolderName(event.target.value)}
                                placeholder="New folder name"
                              />
                            </div>
                            <button
                              type="submit"
                              className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-graphite px-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={createProjectFolderMutation.isPending}
                              title="Create folder"
                            >
                              <Plus className="h-4 w-4" />
                              Folder
                            </button>
                          </form>
                          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-indigo-600 px-3 text-sm font-bold text-white shadow-sm hover:bg-indigo-700">
                            <UploadCloud className="h-4 w-4" />
                            Upload files
                            <input
                              type="file"
                              className="hidden"
                              multiple
                              onChange={(event) => {
                                handleProjectFileInput(event.target.files);
                                event.currentTarget.value = '';
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    </div>

                    <div className="grid flex-1 min-h-0 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
                      <div className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
                        <div className="border-b border-slate-100 px-4 py-3">
                          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Folders in {currentFileFolder?.name || 'Root'}</p>
                          <p className="mt-1 text-sm text-slate-500">{visibleFileFolders.length} folder{visibleFileFolders.length !== 1 ? 's' : ''} available</p>
                        </div>
                        <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
                          <div className="space-y-2">
                            {visibleFileFolders.length === 0 ? (
                              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-center">
                                <FolderOpen className="mx-auto h-8 w-8 text-slate-300" />
                                <p className="mt-2 text-sm font-semibold text-slate-500">No folders here</p>
                                <p className="mt-1 text-xs text-slate-400">Create one above to group drawings, bills, or approvals.</p>
                              </div>
                            ) : null}
                            {visibleFileFolders.map((folder) => (
                              <div key={folder.id} className="rounded-lg border border-slate-200 bg-white p-2 transition hover:border-indigo-300 hover:bg-indigo-50">
                                {renamingFolderId === folder.id ? (
                                  <form
                                    className="flex gap-2"
                                    onSubmit={(event) => {
                                      event.preventDefault();
                                      if (!selectedProjectId || !renameFolderName.trim()) return;
                                      renameProjectFolderMutation.mutate({
                                        projectId: selectedProjectId,
                                        folderId: folder.id,
                                        name: renameFolderName.trim(),
                                      });
                                    }}
                                  >
                                    <input className="h-9 flex-1 rounded-md border-slate-300 text-sm" value={renameFolderName} onChange={(event) => setRenameFolderName(event.target.value)} autoFocus />
                                    <button className="rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white">Save</button>
                                  </form>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-2.5 text-left"
                                      onClick={() => setCurrentFileFolderId(folder.id)}
                                      onDoubleClick={() => setCurrentFileFolderId(folder.id)}
                                      title={`Open ${folder.name}`}
                                    >
                                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                                        <FolderOpen className="h-5 w-5" />
                                      </span>
                                      <span className="min-w-0">
                                        <span className="block truncate text-sm font-bold text-slate-800">{folder.name}</span>
                                        <span className="block text-xs font-semibold text-indigo-600">Open folder</span>
                                      </span>
                                    </button>
                                    <button
                                      type="button"
                                      className="rounded-md bg-slate-50 p-2 text-slate-500 hover:bg-white hover:text-indigo-700"
                                      title="Rename folder"
                                      onClick={() => {
                                        setRenamingFolderId(folder.id);
                                        setRenameFolderName(folder.name);
                                      }}
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </button>
                                    <button
                                      type="button"
                                      className="rounded-md bg-slate-50 p-2 text-slate-500 hover:bg-white hover:text-red-700"
                                      title="Delete folder"
                                      onClick={() => {
                                        if (!selectedProjectId || !confirm(`Delete folder "${folder.name}" and all files inside it?`)) return;
                                        deleteProjectFolderMutation.mutate({ projectId: selectedProjectId, folderId: folder.id });
                                      }}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div
                        className={clsx(
                          'flex min-h-0 flex-col rounded-xl border bg-white shadow-sm outline-none transition',
                          isFileDropActive ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-slate-200',
                        )}
                        tabIndex={0}
                        onPaste={handleProjectFilePaste}
                        onDragOver={(event) => {
                          event.preventDefault();
                          setIsFileDropActive(true);
                        }}
                        onDragLeave={() => setIsFileDropActive(false)}
                        onDrop={handleProjectFileDrop}
                        aria-label={`Files in ${currentFileFolder?.name || 'root folder'}`}
                      >
                        <div className="border-b border-slate-100 px-4 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Current Folder</p>
                              <p className="mt-1 flex items-center gap-2 text-base font-bold text-slate-900">
                                <Folder className="h-4 w-4 text-indigo-600" />
                                {currentFileFolder?.name || 'Root'}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                              <FileText className="h-4 w-4" />
                              {visibleProjectFiles.length} file{visibleProjectFiles.length !== 1 ? 's' : ''} here
                            </div>
                          </div>
                          <div
                            className={clsx(
                              'mt-3 rounded-lg border-2 border-dashed p-4 transition',
                              isFileDropActive ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-slate-50',
                            )}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="flex items-center gap-3">
                                <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-white text-indigo-600 shadow-sm">
                                  <UploadCloud className="h-5 w-5" />
                                </span>
                                <div>
                                  <p className="text-sm font-bold text-slate-800">Drop files here or paste copied files</p>
                                  <p className="mt-1 text-xs font-semibold text-slate-500">
                                    Uploading to {currentFileFolder?.name || 'Root'} folder
                                  </p>
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600">
                                  <Clipboard className="h-3.5 w-3.5" />
                                  Paste works here
                                </span>
                                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-700">
                                  <UploadCloud className="h-4 w-4" />
                                  Choose files
                                  <input
                                    type="file"
                                    className="hidden"
                                    multiple
                                    onChange={(event) => {
                                      handleProjectFileInput(event.target.files);
                                      event.currentTarget.value = '';
                                    }}
                                  />
                                </label>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="min-h-0 flex-1 overflow-auto">
                          <table className="w-full table-fixed text-sm">
                            <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
                              <tr>
                                <th className="w-[32%] px-4 py-2.5 text-left font-semibold text-xs uppercase tracking-wider border-b border-slate-200">File</th>
                                <th className="w-[14%] px-4 py-2.5 text-left font-semibold text-xs uppercase tracking-wider border-b border-slate-200">Type</th>
                                <th className="w-[15%] px-4 py-2.5 text-right font-semibold text-xs uppercase tracking-wider border-b border-slate-200">Size</th>
                                <th className="w-[17%] px-4 py-2.5 text-right font-semibold text-xs uppercase tracking-wider border-b border-slate-200">Storage</th>
                                <th className="w-[22%] px-4 py-2.5 text-center font-semibold text-xs uppercase tracking-wider border-b border-slate-200">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {visibleProjectFiles.length === 0 ? (
                                <tr>
                                  <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                                    <FileArchive className="mx-auto h-9 w-9 text-slate-300" />
                                    <p className="mt-2 font-semibold text-slate-500">No files in this folder yet</p>
                                    <p className="mt-1 text-xs text-slate-400">Choose files, drag them in, or paste copied files to upload here.</p>
                                  </td>
                                </tr>
                              ) : null}
                              {visibleProjectFiles.map((file, idx) => (
                                <tr key={file.id} className={clsx('border-t border-slate-100 transition', idx % 2 === 0 ? 'bg-white hover:bg-slate-50/80' : 'bg-slate-50/40 hover:bg-slate-100/60')} onMouseEnter={() => showRecordAudit('project_files', file.id, 'Project file')} onMouseLeave={hideAudit}>
                                  <td className="px-4 py-3">
                                    {renamingFileId === file.id ? (
                                      <form
                                        className="flex items-center gap-2"
                                        onSubmit={(event) => {
                                          event.preventDefault();
                                          if (!selectedProjectId || !renameFileName.trim()) return;
                                          renameProjectFileMutation.mutate({
                                            projectId: selectedProjectId,
                                            fileId: file.id,
                                            name: renameFileName.trim(),
                                          });
                                        }}
                                      >
                                        <input
                                          className="h-8 min-w-0 flex-1 rounded-md border border-indigo-300 px-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                          value={renameFileName}
                                          onChange={(event) => setRenameFileName(event.target.value)}
                                          autoFocus
                                        />
                                        <button type="submit" className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700">Save</button>
                                        <button type="button" className="rounded-md bg-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-300" onClick={() => setRenamingFileId(null)}>Cancel</button>
                                      </form>
                                    ) : (
                                      <>
                                        <div className="flex items-center gap-2">
                                          <FileArchive className="h-4 w-4 shrink-0 text-slate-400" />
                                          <span className="truncate font-semibold text-slate-800">{file.original_filename}</span>
                                        </div>
                                        <p className="mt-0.5 text-xs text-slate-400">Uploaded {formatDate(file.created_at)}</p>
                                      </>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-slate-600">{file.content_type.split('/').pop() || 'file'}</td>
                                  <td className="px-4 py-3 text-right font-semibold text-slate-700 tabular-nums">{formatFileSize(file.original_size)}</td>
                                  <td className="px-4 py-3 text-right">
                                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                                      {formatFileSize(file.compressed_size)} · {compressionLabel(file)}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3">
                                    <div className="flex justify-center gap-1.5">
                                      <button
                                        type="button"
                                        className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:border-indigo-300 hover:text-indigo-600 shadow-sm transition"
                                        title="Rename file"
                                        onClick={() => {
                                          setRenamingFileId(file.id);
                                          setRenameFileName(file.original_filename);
                                        }}
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </button>
                                      <button type="button" className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:border-indigo-300 hover:text-indigo-600 shadow-sm transition" title="View" onClick={() => void handleViewProjectFile(file)}>
                                        <Eye className="h-4 w-4" />
                                      </button>
                                      <button type="button" className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:border-emerald-300 hover:text-emerald-600 shadow-sm transition" title="Download" onClick={() => void handleDownloadProjectFile(file)}>
                                        <Download className="h-4 w-4" />
                                      </button>
                                      <button type="button" className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:border-amber-300 hover:text-amber-600 shadow-sm transition" title="Print" onClick={() => void handlePrintProjectFile(file)}>
                                        <Printer className="h-4 w-4" />
                                      </button>
                                      <button
                                        type="button"
                                        className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:border-rose-300 hover:text-rose-600 shadow-sm transition"
                                        title="Delete"
                                        onClick={() => {
                                          if (!selectedProjectId || !confirm(`Delete "${file.original_filename}"?`)) return;
                                          deleteProjectFileMutation.mutate({ projectId: selectedProjectId, fileId: file.id });
                                        }}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

              </div>
            </div>
            <div className="relative shrink-0 lg:w-14">
              <div
                className="flex h-full min-h-[min(70dvh,calc(100dvh-10rem))] w-full cursor-pointer flex-col items-center justify-center rounded-2xl border border-slate-100 bg-white shadow-[0_4px_20px_rgb(0,0,0,0.03)] transition-colors hover:bg-slate-50"
                onClick={() => setLeftTimelineOpen(true)}
              >
                <span className="text-sm font-bold tracking-[0.3em] text-slate-400" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>TIMELINE</span>
                <div className="mt-6 flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-600">{dailyTimeline.length}</div>
              </div>
              {leftTimelineOpen ? (
                <div className="absolute right-full top-0 z-20 mr-3 h-full max-h-[min(70dvh,calc(100dvh-10rem))] w-[min(360px,calc(100vw-2rem))] overflow-auto rounded-2xl border border-slate-100 bg-white shadow-xl">
                  <div className="flex h-full flex-col">
                    <div className="flex items-center justify-between border-b border-slate-100 p-4">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-base font-bold text-indigo-600">{dailyTimeline.length}</span>
                        <h3 className="text-base font-bold uppercase tracking-wider text-graphite">Daily Timeline</h3>
                      </div>
                      <button className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-50 text-slate-500 hover:bg-slate-200" onClick={() => setLeftTimelineOpen(false)}>
                        <span className="text-xl leading-none">×</span>
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto bg-slate-50/50 p-4">
                      <div className="space-y-2">
                        {timelineSegments.map((segment, idx) => (
                          <div key={`${segment.type}-${idx}`} className="flex gap-3">
                            <div className="flex w-5 flex-col items-center">
                              <div className="mt-1 h-2.5 w-2.5 rounded-full bg-indigo-500" />
                              {idx < timelineSegments.length - 1 ? (
                                <div className={`mt-1 w-[2px] flex-1 ${segment.type === 'gap' ? 'bg-[radial-gradient(circle,_#94a3b8_1px,_transparent_1px)] bg-[length:2px_6px]' : 'bg-slate-300'}`} />
                              ) : null}
                            </div>
                            <div className="flex-1 pb-2">
                              {segment.type === 'boundary' ? (
                                <div className={`rounded-xl border p-3 shadow-sm ${segment.label === 'End' ? 'border-rose-200 bg-rose-50' : segment.label === 'Start / End' ? 'border-violet-200 bg-violet-50' : 'border-emerald-200 bg-emerald-50'}`}>
                                  <p className={`text-sm font-bold tracking-wider ${segment.label === 'End' ? 'text-rose-700' : segment.label === 'Start / End' ? 'text-violet-700' : 'text-emerald-700'}`}>{formatTimelineDate(segment.date)}</p>
                                  <p className={`mt-1 text-[11px] font-bold uppercase ${segment.label === 'End' ? 'text-rose-800' : segment.label === 'Start / End' ? 'text-violet-800' : 'text-emerald-800'}`}>{segment.label}</p>
                                </div>
                              ) : null}
                              {segment.type === 'gap' ? (
                                <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-3 shadow-sm">
                                  <p className="text-sm font-bold tracking-wider text-amber-700">{formatTimelineDate(segment.from)}</p>
                                  <p className="text-center text-sm font-bold text-amber-500">...</p>
                                  <p className="text-sm font-bold tracking-wider text-amber-700">{formatTimelineDate(segment.to)}</p>
                                  <p className="mt-1 text-[11px] font-semibold uppercase text-amber-700">No Work</p>
                                </div>
                              ) : null}
                              {segment.type === 'work' ? (
                                <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 shadow-sm">
                                  <p className="mb-2 text-sm font-bold tracking-wider text-sky-700">{formatTimelineDate(segment.date)}</p>
                                  <div className="space-y-2">
                                    {segment.events.map((item, eventIdx) => (
                                      <div key={`${segment.date}-${item.type}-${eventIdx}`} className="rounded-lg border border-sky-100 bg-white p-2">
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-sky-600">{item.type}</p>
                                        <p className="text-sm font-semibold text-graphite">{item.title}</p>
                                        <p className="text-xs text-slate-500">{item.detail}</p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                      {timelineSegments.length === 0 ? <div className="mt-10 text-center text-base font-medium text-slate-400">No events yet.</div> : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

        </div>
      ) : null}

      {projectPendingDeletion ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-graphite/60 p-4 backdrop-blur-sm" onMouseDown={() => {
          if (!deleteProjectMutation.isPending) {
            setProjectPendingDeletion(null);
            setDeleteProjectName('');
          }
        }}>
          <div className="w-full max-w-lg overflow-hidden rounded-[28px] border border-red-100 bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="delete-project-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="border-b border-red-100 bg-red-50/70 px-6 py-5">
              <div className="flex items-start gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-red-100 text-red-700">
                  <AlertTriangle className="h-6 w-6" />
                </span>
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-red-600">Owner confirmation required</p>
                  <h2 id="delete-project-title" className="mt-1 font-display text-2xl text-graphite">Delete project?</h2>
                  <p className="mt-2 text-sm leading-6 text-slate">This project will be removed from the active workspace. This action is restricted to the owner.</p>
                </div>
              </div>
            </div>

            <div className="space-y-5 px-6 py-6">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-wide text-slate/70">Project to delete</p>
                <p className="mt-1 break-words text-lg font-bold text-graphite">{projectPendingDeletion.name}</p>
              </div>

              <div>
                <label htmlFor="delete-project-confirmation" className="mb-2 block text-sm font-bold text-graphite">
                  Type the project name exactly to confirm
                </label>
                <input
                  id="delete-project-confirmation"
                  autoFocus
                  value={deleteProjectName}
                  onChange={(event) => setDeleteProjectName(event.target.value)}
                  placeholder={projectPendingDeletion.name}
                  className="border-2 border-slate-300 bg-white text-base font-semibold focus:border-red-500 focus:ring-red-500/15"
                  disabled={deleteProjectMutation.isPending}
                />
                {deleteProjectName && deleteProjectName !== projectPendingDeletion.name ? <p className="mt-2 text-xs font-semibold text-red-600">The project name does not match.</p> : null}
              </div>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-bold text-graphite hover:bg-slate-50 disabled:opacity-60"
                  disabled={deleteProjectMutation.isPending}
                  onClick={() => {
                    setProjectPendingDeletion(null);
                    setDeleteProjectName('');
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-red-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-200"
                  disabled={deleteProjectName !== projectPendingDeletion.name || deleteProjectMutation.isPending}
                  onClick={() => deleteProjectMutation.mutate({ projectId: projectPendingDeletion.id, confirmationName: deleteProjectName })}
                >
                  <Trash2 className="h-4 w-4" />
                  {deleteProjectMutation.isPending ? 'Deleting project...' : 'Delete project'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <ProjectEntryModal
        open={showProjectModal}
        title="Create New Project"
        subtitle="Register a new construction site, set budget parameters, and upload 3D plan image."
        icon={<Building2 className="h-6 w-6 text-indigo-600" />}
        onClose={() => setShowProjectModal(false)}
        footer={(
          <>
            <button
              type="button"
              className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
              onClick={() => setShowProjectModal(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="create-project-form"
              className="rounded-xl bg-graphite px-6 py-2.5 text-sm font-extrabold text-white shadow-md transition hover:bg-black"
            >
              Create Project
            </button>
          </>
        )}
      >
        <form id="create-project-form" className="space-y-5" onSubmit={handleSubmit}>
          {/* Project Profile */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-200/80 pb-2">
              <Building2 className="h-4 w-4 text-indigo-600" />
              <span className="text-xs font-black uppercase tracking-wider text-slate-700">Project Information</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <RequiredLabel label="Project Name" required filled={Boolean(form.project_name.trim())} />
                <input
                  value={form.project_name}
                  onChange={(e) => setForm((c) => ({ ...c, project_name: e.target.value }))}
                  placeholder="e.g. KKR Grand Residence"
                  required
                />
              </div>
              <div>
                <RequiredLabel label="Location" required filled={Boolean(form.location.trim())} />
                <input
                  value={form.location}
                  onChange={(e) => setForm((c) => ({ ...c, location: e.target.value }))}
                  placeholder="e.g. Velachery, Chennai"
                  required
                />
              </div>
              <div className="sm:col-span-2">
                <RequiredLabel label="Description" filled={Boolean(form.description.trim())} />
                <textarea
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm((c) => ({ ...c, description: e.target.value }))}
                  placeholder="Project notes or scope details"
                />
              </div>
            </div>
          </div>

          {/* Project Image */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
            <div className="flex items-center gap-2 border-b border-slate-200/80 pb-2">
              <UploadCloud className="h-4 w-4 text-indigo-600" />
              <span className="text-xs font-black uppercase tracking-wider text-slate-700">Building Image (3D Render)</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-[130px_1fr] items-center">
              <ProjectImage
                src={projectImagePreview}
                alt="Project preview"
                containerClassName="flex h-24 w-full items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs relative"
                iconClassName="h-10 w-10 text-slate-300"
              />
              <div className="space-y-2">
                <input
                  type="file"
                  accept="image/*"
                  className="text-xs text-slate-600 file:mr-3 file:rounded-xl file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-indigo-700 hover:file:bg-indigo-100"
                  onChange={(event) => setProjectImageFile(event.target.files?.[0] || null)}
                />
                {projectImageFile ? (
                  <button
                    type="button"
                    className="text-xs font-bold text-slate-700 hover:underline"
                    onClick={() => setProjectImageFile(null)}
                  >
                    Clear Selected
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {/* Timeline & Status */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-200/80 pb-2">
              <CalendarDays className="h-4 w-4 text-indigo-600" />
              <span className="text-xs font-black uppercase tracking-wider text-slate-700">Timeline & Status</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <RequiredLabel label="Start Date" required filled={Boolean(form.start_date)} />
                <input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm((c) => ({ ...c, start_date: e.target.value }))}
                  required
                />
              </div>
              <div>
                <RequiredLabel label="Expected End Date" filled={Boolean(form.expected_end_date)} />
                <input
                  type="date"
                  value={form.expected_end_date}
                  min={form.start_date || undefined}
                  onChange={(e) => setForm((c) => ({ ...c, expected_end_date: e.target.value }))}
                />
              </div>
              <div>
                <RequiredLabel label="Status" required filled={Boolean(form.status)} />
                <select
                  value={form.status}
                  onChange={(e) => setForm((c) => ({ ...c, status: e.target.value as ProjectStatus }))}
                >
                  <option value="upcoming">Upcoming</option>
                  <option value="ongoing">Ongoing</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
            </div>
          </div>

          {/* Area & Budget Calculation */}
          <div className="rounded-2xl border border-emerald-200/90 bg-emerald-50/40 p-4 space-y-4">
            <div className="flex items-center justify-between border-b border-emerald-200/80 pb-2">
              <div className="flex items-center gap-2">
                <Banknote className="h-4 w-4 text-emerald-700" />
                <span className="text-xs font-black uppercase tracking-wider text-emerald-950">Area & Budget Calculation</span>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <RequiredLabel label="Total Area (Sq.ft)" required filled={form.construction_sqft > 0} />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={numberFieldValue(form.construction_sqft)}
                  onChange={(e) => setForm((c) => ({ ...c, construction_sqft: parseNumberInput(e.target.value) }))}
                  placeholder="0.00"
                  required
                />
              </div>
              <div>
                <RequiredLabel label="Project Rate per Sq.ft" required filled={form.construction_rate_per_sqft > 0} />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={numberFieldValue(form.construction_rate_per_sqft)}
                  onChange={(e) => setForm((c) => ({ ...c, construction_rate_per_sqft: parseNumberInput(e.target.value) }))}
                  placeholder="4500"
                  required
                />
              </div>
              <div className="sm:col-span-2 rounded-xl border border-emerald-300 bg-emerald-100/80 p-3 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-900">Total Project Budget:</span>
                <span className="text-lg font-black text-emerald-950">
                  {formatCurrency(Number(form.construction_sqft || 0) * Number(form.construction_rate_per_sqft || 0))}
                </span>
              </div>
            </div>
          </div>
        </form>
      </ProjectEntryModal>

      <ProjectEntryModal
        open={showMaterialModal}
        title="Add Material"
        subtitle="Record a purchase against this project with clear qty, rate, and GST."
        icon={<Package className="h-5 w-5" />}
        onClose={() => setShowMaterialModal(false)}
        footer={(
          <>
            <EntryGhostButton onClick={() => setShowMaterialModal(false)} disabled={addMaterial.isPending}>Cancel</EntryGhostButton>
            <EntryPrimaryButton type="submit" form="add-material-form" disabled={addMaterial.isPending}>
              {addMaterial.isPending ? 'Saving…' : 'Save material'}
            </EntryPrimaryButton>
          </>
        )}
      >
        <form
          id="add-material-form"
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!selectedProjectId) return;
            const selectedMaster = materialMaster.find(
              (m) =>
                m.name.toLowerCase() === projectMaterialForm.material_name.trim().toLowerCase() &&
                (m.supplier || '').toLowerCase() === (projectMaterialForm.vendor_name || '').trim().toLowerCase()
            );
            if (!selectedMaster && projectMaterialForm.material_name.trim() && projectMaterialForm.unit.trim()) {
              try {
                await api.createMaterialMaster({
                  name: projectMaterialForm.material_name.trim(),
                  supplier: projectMaterialForm.vendor_name.trim() || 'General',
                  unit: projectMaterialForm.unit.trim(),
                  default_unit_cost: Number(projectMaterialForm.unit_cost || 0),
                  active: true,
                  has_bundle_conversion: projectMaterialForm.has_bundle_conversion,
                  default_bundle_weight: projectMaterialForm.weight_per_bundle || 0,
                });
                queryClient.invalidateQueries({ queryKey: ['material-master'] });
              } catch {
                // Ignore duplicate races; material log should still save.
              }
            }
            const vendorId = await resolveVendorId(projectMaterialForm.vendor_name, projectMaterialForm.vendor_id, 'material_vendor');
            const isBundle = Boolean(projectMaterialForm.has_bundle_conversion);
            const calcQty = isBundle
              ? Number(projectMaterialForm.no_of_bundles || 0) * Number(projectMaterialForm.weight_per_bundle || 0)
              : Number(projectMaterialForm.quantity || 0);
            const calcCost = isBundle
              ? Number(projectMaterialForm.cost_per_kg || 0)
              : Number(projectMaterialForm.unit_cost || 0);
            const calcUnit = isBundle
              ? (projectMaterialForm.unit.trim() || 'kg')
              : projectMaterialForm.unit.trim();
            const bundleMeta = isBundle
              ? {
                has_bundle_conversion: true,
                no_of_bundles: Number(projectMaterialForm.no_of_bundles || 0),
                weight_per_bundle: Number(projectMaterialForm.weight_per_bundle || 0),
                cost_per_kg: Number(projectMaterialForm.cost_per_kg || 0),
                total_weight_kg: calcQty,
              }
              : null;

            addMaterial.mutate({
              project_id: selectedProjectId,
              vendor_id: vendorId,
              material_name: projectMaterialForm.material_name.trim(),
              quantity: calcQty,
              unit: calcUnit,
              unit_cost: calcCost,
              supplier: projectMaterialForm.vendor_name || null,
              work_remarks: projectMaterialForm.work_remarks || null,
              bill_no: projectMaterialForm.bill_no.trim() || null,
              gst_percent: projectMaterialForm.gst_percent || null,
              template_meta: bundleMeta,
              transport_cost: 0,
              date: projectMaterialForm.date,
            });
            setProjectMaterialForm({
              date: localDateKey(),
              material_name: '',
              vendor_id: 0,
              vendor_name: '',
              unit: '',
              quantity: 0,
              unit_cost: 0,
              supplier: '',
              work_remarks: '',
              bill_no: '',
              gst_percent: 0,
              has_bundle_conversion: false,
              no_of_bundles: 0,
              weight_per_bundle: 0,
              cost_per_kg: 0,
            });
            setMaterialSearchText('');
            setShowMaterialSuggestions(false);
          }}
        >
          <EntrySection title="When" hint="Date this material was purchased or received.">
            <div>
              <RequiredLabel label="Date" required filled={Boolean(projectMaterialForm.date)} />
              <input type="date" value={projectMaterialForm.date} onChange={(e) => setProjectMaterialForm((c) => ({ ...c, date: e.target.value }))} required />
            </div>
          </EntrySection>

          <div className="relative z-30">
            <EntrySection title="What">
              <div className="relative">
                <RequiredLabel label="Material Name" required filled={Boolean(materialSearchText.trim())} />
                <input
                  value={materialSearchText}
                  onFocus={() => setShowMaterialSuggestions(true)}
                  onChange={(e) => {
                    const value = e.target.value;
                    setMaterialSearchText(value);
                    setProjectMaterialForm((c) => ({ ...c, material_name: value }));
                    setShowMaterialSuggestions(true);
                  }}
                  onBlur={() => setTimeout(() => setShowMaterialSuggestions(false), 150)}
                  placeholder="Select or type material name..."
                  required
                />
                {showMaterialSuggestions ? (
                  <div className="absolute left-0 top-full z-50 mt-1.5 max-h-64 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl ring-1 ring-black/10 animate-in fade-in duration-150">
                    {combinedMaterialSuggestions
                      .filter((m) => !materialSearchText.trim() || m.name.toLowerCase().includes(materialSearchText.trim().toLowerCase()))
                      .slice(0, 35)
                      .map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition hover:bg-indigo-50/80 hover:text-indigo-950"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            const hasBundle = Boolean(m.has_bundle_conversion);
                            setMaterialSearchText(m.name);
                            setProjectMaterialForm((c) => ({
                              ...c,
                              material_name: m.name,
                              supplier: m.supplier || c.supplier,
                              unit: m.unit || c.unit,
                              unit_cost: Number(m.default_unit_cost || c.unit_cost),
                              has_bundle_conversion: hasBundle,
                              weight_per_bundle: m.default_bundle_weight || 0,
                              cost_per_kg: Number(m.default_unit_cost || c.cost_per_kg),
                            }));
                            setShowMaterialSuggestions(false);
                          }}
                        >
                          <div className="min-w-0 flex-1">
                            <span className="block text-sm font-extrabold text-slate-900 truncate">{m.name}</span>
                            <span className="block text-xs font-semibold text-slate-500">
                              {m.unit || 'nos'}
                            </span>
                          </div>
                          <div className="text-right shrink-0 ml-2">
                            <span className="block text-xs font-extrabold text-emerald-700">{formatCurrency(m.default_unit_cost)}</span>
                            {m.has_bundle_conversion ? (
                              <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800 font-black">📦 Bundle</span>
                            ) : null}
                          </div>
                        </button>
                      ))}
                  </div>
                ) : null}
              </div>
            </EntrySection>
          </div>

          <div className="relative z-20">
            <EntrySection title="Who">
              <div className="relative">
                <RequiredLabel label="Vendor" filled={Boolean(projectMaterialForm.vendor_name.trim())} />
                <input
                  value={projectMaterialForm.vendor_name}
                  onFocus={() => setShowMaterialVendorSuggestions(true)}
                  onChange={(e) => {
                    const value = e.target.value;
                    const vendor = materialVendors.find((item) => item.name.trim().toLowerCase() === value.trim().toLowerCase());
                    setProjectMaterialForm((c) => ({ ...c, vendor_name: value, vendor_id: vendor?.id || 0 }));
                    setShowMaterialVendorSuggestions(true);
                  }}
                  onBlur={() => setTimeout(() => setShowMaterialVendorSuggestions(false), 150)}
                  placeholder="Select or type vendor..."
                />
                {showMaterialVendorSuggestions ? (
                  <div className="absolute left-0 top-full z-50 mt-1.5 max-h-60 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl ring-1 ring-black/10 animate-in fade-in duration-150">
                    {materialVendors
                      .filter((v) => !projectMaterialForm.vendor_name.trim() || v.name.toLowerCase().includes(projectMaterialForm.vendor_name.trim().toLowerCase()))
                      .slice(0, 25)
                      .map((vendor) => (
                        <button
                          key={vendor.id}
                          type="button"
                          className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition hover:bg-indigo-50/80 hover:text-indigo-950"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setProjectMaterialForm((c) => ({ ...c, vendor_name: vendor.name, vendor_id: vendor.id }));
                            setShowMaterialVendorSuggestions(false);
                          }}
                        >
                          <span className="block text-sm font-extrabold text-slate-900 truncate">{vendor.name}</span>
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Vendor</span>
                        </button>
                      ))}
                  </div>
                ) : null}
              </div>
            </EntrySection>
          </div>

          <EntrySection title="How much" hint="Quantity and rate drive the cost. Standard or bundle calculation.">
            <div className="rounded-xl border border-amber-200/80 bg-gradient-to-r from-amber-50/70 to-orange-50/50 p-3 mb-3">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={projectMaterialForm.has_bundle_conversion}
                  onChange={(e) => setProjectMaterialForm((c) => ({ ...c, has_bundle_conversion: e.target.checked }))}
                  className="h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                />
                <span className="text-sm font-bold text-amber-950">📦 Enable Bundle Conversion (Steel / Bundled Material)</span>
              </label>
              <p className="mt-1 text-xs text-amber-800/80">
                Calculate by: No. of Bundles × Weight per Bundle (kg) × Cost per kg.
              </p>
            </div>

            {projectMaterialForm.has_bundle_conversion ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <RequiredLabel label="No. of Bundles" required filled={projectMaterialForm.no_of_bundles > 0} />
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="e.g. 10"
                      value={numberFieldValue(projectMaterialForm.no_of_bundles)}
                      onChange={(e) => setProjectMaterialForm((c) => ({ ...c, no_of_bundles: parseNumberInput(e.target.value) }))}
                      required
                    />
                  </div>
                  <div>
                    <RequiredLabel label="Weight / Bundle (kg)" required filled={projectMaterialForm.weight_per_bundle > 0} />
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="e.g. 50"
                      value={numberFieldValue(projectMaterialForm.weight_per_bundle)}
                      onChange={(e) => setProjectMaterialForm((c) => ({ ...c, weight_per_bundle: parseNumberInput(e.target.value) }))}
                      required
                    />
                  </div>
                  <div>
                    <RequiredLabel label="Cost / kg" required filled={projectMaterialForm.cost_per_kg > 0} />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="e.g. 65"
                      value={numberFieldValue(projectMaterialForm.cost_per_kg)}
                      onChange={(e) => setProjectMaterialForm((c) => ({ ...c, cost_per_kg: parseNumberInput(e.target.value) }))}
                      required
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <RequiredLabel label="Unit" required filled={Boolean(projectMaterialForm.unit.trim())} />
                    <input
                      value={projectMaterialForm.unit || 'kg'}
                      onChange={(e) => setProjectMaterialForm((c) => ({ ...c, unit: e.target.value }))}
                      placeholder="kg, ton, bundles…"
                    />
                  </div>
                  <div>
                    <RequiredLabel label="GST (%)" filled={projectMaterialForm.gst_percent > 0} />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={numberFieldValue(projectMaterialForm.gst_percent)}
                      onChange={(e) => setProjectMaterialForm((c) => ({ ...c, gst_percent: parseNumberInput(e.target.value) }))}
                    />
                  </div>
                </div>

                <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 text-xs space-y-1.5 font-medium text-indigo-950">
                  <div className="flex justify-between items-center">
                    <span>Total Weight Formula:</span>
                    <span className="font-bold">{projectMaterialForm.no_of_bundles || 0} bdl × {projectMaterialForm.weight_per_bundle || 0} kg = <span className="text-indigo-700 font-extrabold">{((projectMaterialForm.no_of_bundles || 0) * (projectMaterialForm.weight_per_bundle || 0)).toLocaleString()} kg</span></span>
                  </div>
                  <div className="flex justify-between items-center border-t border-indigo-100 pt-1.5">
                    <span>Bundle Subtotal:</span>
                    <span className="font-extrabold text-sm text-emerald-700">{formatCurrency(materialEntrySubtotal)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <RequiredLabel label="Unit" required filled={Boolean(projectMaterialForm.unit.trim())} />
                  <input value={projectMaterialForm.unit} onChange={(e) => setProjectMaterialForm((c) => ({ ...c, unit: e.target.value }))} required placeholder="bags, ton, nos…" />
                </div>
                <div>
                  <RequiredLabel label="Quantity" required filled={projectMaterialForm.quantity > 0} />
                  <input type="number" min="0.01" step="0.01" value={numberFieldValue(projectMaterialForm.quantity)} onChange={(e) => setProjectMaterialForm((c) => ({ ...c, quantity: parseNumberInput(e.target.value) }))} required />
                </div>
                <div>
                  <RequiredLabel label="Rate" required filled={projectMaterialForm.unit_cost > 0} />
                  <input type="number" min="0" step="0.01" value={numberFieldValue(projectMaterialForm.unit_cost)} onChange={(e) => setProjectMaterialForm((c) => ({ ...c, unit_cost: parseNumberInput(e.target.value) }))} required />
                </div>
                <div>
                  <RequiredLabel label="GST (%)" filled={projectMaterialForm.gst_percent > 0} />
                  <input type="number" min="0" step="0.01" value={numberFieldValue(projectMaterialForm.gst_percent)} onChange={(e) => setProjectMaterialForm((c) => ({ ...c, gst_percent: parseNumberInput(e.target.value) }))} />
                </div>
              </div>
            )}
          </EntrySection>

          <EntrySection title="Bill & Notes">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <RequiredLabel label="Bill No" filled={Boolean(projectMaterialForm.bill_no.trim())} />
                <input
                  value={projectMaterialForm.bill_no}
                  onChange={(e) => setProjectMaterialForm((c) => ({ ...c, bill_no: e.target.value }))}
                  placeholder="e.g. INV-1002"
                />
              </div>
              <div>
                <RequiredLabel label="Remarks" filled={Boolean(projectMaterialForm.work_remarks.trim())} />
                <input value={projectMaterialForm.work_remarks} onChange={(e) => setProjectMaterialForm((c) => ({ ...c, work_remarks: e.target.value }))} placeholder="Optional site note" />
              </div>
            </div>
          </EntrySection>

          <EntrySummary
            rows={[
              { label: 'Qty × Rate', value: formatCurrency(materialEntrySubtotal) },
              { label: 'GST', value: formatCurrency(materialEntryGst) },
            ]}
            totalLabel="Grand total"
            totalValue={formatCurrency(materialEntryTotal)}
          />
        </form>
      </ProjectEntryModal>

      <ProjectEntryModal
        open={showExpenseModal}
        title="Add Expense"
        subtitle="Log a project cost that is not material or labour."
        icon={<Banknote className="h-5 w-5" />}
        maxWidthClass="max-w-xl"
        onClose={() => setShowExpenseModal(false)}
        footer={(
          <>
            <EntryGhostButton onClick={() => setShowExpenseModal(false)} disabled={addExpense.isPending}>Cancel</EntryGhostButton>
            <EntryPrimaryButton type="submit" form="add-expense-form" disabled={addExpense.isPending}>
              {addExpense.isPending ? 'Saving…' : 'Save expense'}
            </EntryPrimaryButton>
          </>
        )}
      >
        <form
          id="add-expense-form"
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!selectedProjectId || !projectExpenseForm.category.trim()) return;
            const existingMaster = expenseMaster.find((x) => x.name.toLowerCase() === projectExpenseForm.category.trim().toLowerCase());
            if (!existingMaster) {
              try {
                await api.createExpenseMaster({ name: projectExpenseForm.category.trim(), active: true });
                queryClient.invalidateQueries({ queryKey: ['expense-master'] });
              } catch {
                // Ignore duplicate race and continue adding log.
              }
            }
            addExpense.mutate({
              project_id: selectedProjectId,
              category: projectExpenseForm.category.trim(),
              amount: projectExpenseForm.amount,
              description: projectExpenseForm.description || null,
              date: projectExpenseForm.date,
            });
            setProjectExpenseForm({ date: localDateKey(), category: '', amount: 0, description: '' });
            setExpenseSearchText('');
            setShowExpenseSuggestions(false);
          }}
        >
          <EntrySection title="When">
            <div>
              <RequiredLabel label="Date" required filled={Boolean(projectExpenseForm.date)} />
              <input type="date" value={projectExpenseForm.date} onChange={(e) => setProjectExpenseForm((c) => ({ ...c, date: e.target.value }))} required />
            </div>
          </EntrySection>

          <EntrySection title="What">
            <div className="relative">
              <RequiredLabel label="Expense Type" required filled={Boolean(expenseSearchText.trim())} />
              <input
                value={expenseSearchText}
                onFocus={() => setShowExpenseSuggestions(true)}
                onChange={(e) => {
                  const value = e.target.value;
                  setExpenseSearchText(value);
                  setProjectExpenseForm((c) => ({ ...c, category: value }));
                  setShowExpenseSuggestions(true);
                }}
                onBlur={() => setTimeout(() => setShowExpenseSuggestions(false), 150)}
                placeholder="Approval / Documentation / Legal..."
                required
              />
              {showExpenseSuggestions ? (
                <div className="absolute left-0 top-full z-50 mt-1.5 max-h-60 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl ring-1 ring-black/10 animate-in fade-in duration-150">
                  {expenseMaster
                    .filter((item) => item.active && (!expenseSearchText.trim() || item.name.toLowerCase().includes(expenseSearchText.toLowerCase())))
                    .slice(0, 25)
                    .map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="block w-full rounded-xl px-3 py-2.5 text-left text-sm font-extrabold text-slate-900 transition hover:bg-indigo-50/80 hover:text-indigo-950"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setExpenseSearchText(item.name);
                          setProjectExpenseForm((c) => ({ ...c, category: item.name }));
                          setShowExpenseSuggestions(false);
                        }}
                      >
                        {item.name}
                      </button>
                    ))}
                </div>
              ) : null}
            </div>
          </EntrySection>

          <EntrySection title="Amount">
            <div>
              <RequiredLabel label="Amount" required filled={projectExpenseForm.amount > 0} />
              <input
                type="number"
                min="0"
                className="text-lg font-black"
                value={numberFieldValue(projectExpenseForm.amount)}
                onChange={(e) => setProjectExpenseForm((c) => ({ ...c, amount: parseNumberInput(e.target.value) }))}
                required
              />
            </div>
          </EntrySection>

          <EntrySection title="Notes">
            <div>
              <RequiredLabel label="Description" filled={Boolean(projectExpenseForm.description.trim())} />
              <input value={projectExpenseForm.description} onChange={(e) => setProjectExpenseForm((c) => ({ ...c, description: e.target.value }))} placeholder="Optional details" />
            </div>
          </EntrySection>

          <EntrySummary
            rows={[{ label: 'Expense type', value: projectExpenseForm.category.trim() || '—' }]}
            totalLabel="Amount to record"
            totalValue={formatCurrency(Number(projectExpenseForm.amount || 0))}
          />
        </form>
      </ProjectEntryModal>

      <ProjectEntryModal
        open={showLabourModal}
        title="Add Labour"
        icon={<Users className="h-5 w-5" />}
        onClose={() => setShowLabourModal(false)}
        footer={(
          <>
            <EntryGhostButton onClick={() => setShowLabourModal(false)} disabled={labourSubmitting}>Cancel</EntryGhostButton>
            <EntryPrimaryButton type="submit" form="add-labour-form" disabled={labourSubmitting}>
              {labourSubmitting ? 'Saving…' : 'Save labour'}
            </EntryPrimaryButton>
          </>
        )}
      >
        <form
          id="add-labour-form"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submitLabourEntries();
          }}
        >
          <EntrySection title="When">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <RequiredLabel label="Start Date" required filled={Boolean(laborForm.date)} />
                <input type="date" value={laborForm.date} onChange={(e) => setLaborForm((c) => ({ ...c, date: e.target.value }))} />
              </div>
              <div>
                <RequiredLabel label="No. of Days" required filled={laborForm.no_of_days > 0} />
                <input type="number" min="1" step="1" value={numberFieldValue(laborForm.no_of_days)} onChange={(e) => setLaborForm((c) => ({ ...c, no_of_days: Math.max(1, Math.floor(parseNumberInput(e.target.value) || 1)) }))} />
              </div>
            </div>
          </EntrySection>

          <EntrySection title="Who">
            <div className="relative">
              <RequiredLabel label="Labour Incharge" filled={Boolean(laborForm.vendor_name.trim())} />
              <input
                value={laborForm.vendor_name}
                onFocus={() => setShowLabourVendorSuggestions(true)}
                onChange={(e) => {
                  const value = e.target.value;
                  const vendor = labourIncharges.find((item) => item.name.trim().toLowerCase() === value.trim().toLowerCase());
                  setLaborForm((c) => ({ ...c, vendor_name: value, vendor_id: vendor?.id || 0 }));
                  setShowLabourVendorSuggestions(true);
                }}
                onBlur={() => setTimeout(() => setShowLabourVendorSuggestions(false), 150)}
                placeholder="Select or type labour incharge..."
              />
              {showLabourVendorSuggestions ? (
                <div className="absolute left-0 top-full z-50 mt-1.5 max-h-60 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl ring-1 ring-black/10 animate-in fade-in duration-150">
                  {labourIncharges
                    .filter((v) => !laborForm.vendor_name.trim() || v.name.toLowerCase().includes(laborForm.vendor_name.trim().toLowerCase()))
                    .slice(0, 25)
                    .map((vendor) => (
                      <button
                        key={vendor.id}
                        type="button"
                        className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-indigo-50/80 hover:text-indigo-950"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setLaborForm((c) => ({ ...c, vendor_name: vendor.name, vendor_id: vendor.id }));
                          setShowLabourVendorSuggestions(false);
                        }}
                      >
                        <span className="block text-sm font-extrabold text-slate-900 truncate">{vendor.name}</span>
                        {(() => {
                          const hint = labourLimitSuggestionLabel(labourLimitStatus(labourLimitByVendorId.get(vendor.id), labourDueByVendorId.get(vendor.id) || 0));
                          return hint ? (
                            <span className="shrink-0 text-[10px] font-bold tabular-nums text-indigo-600">{hint}</span>
                          ) : (
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Incharge</span>
                          );
                        })()}
                      </button>
                    ))}
                </div>
              ) : null}
            </div>
            {laborForm.vendor_id && labourAddLimitStatus.hasLimit ? (
              <p className={clsx('text-xs font-bold tabular-nums', labourAddLimitStatus.tone === 'over' || labourAddLimitStatus.tone === 'limit' ? 'text-rose-700' : labourAddLimitStatus.tone === 'watch' ? 'text-amber-800' : 'text-emerald-700')}>
                {labourLimitSuggestionLabel(labourAddLimitStatus)} of {formatCurrency(labourAddLimitStatus.limit)}
              </p>
            ) : null}
          </EntrySection>

          <EntrySection title="Work">
            <div className="relative">
              <RequiredLabel label="Labour Category" required filled={Boolean(laborSearchText.trim())} />
              <input
                value={laborSearchText}
                onFocus={() => setShowLaborSuggestions(true)}
                onChange={(e) => {
                  const value = e.target.value;
                  setLaborSearchText(value);
                  setLaborForm((c) => {
                    const highest = getHighestWageForLabel(value);
                    if (highest > 0) setLaborWageSearchText(String(highest));
                    return { ...c, labour_type: value, wage_per_head: highest > 0 ? highest : c.wage_per_head };
                  });
                  setShowLaborSuggestions(true);
                }}
                onBlur={() => setTimeout(() => setShowLaborSuggestions(false), 150)}
                placeholder="Select or type labour category..."
                required
              />
              {showLaborSuggestions ? (
                <div className="absolute left-0 top-full z-50 mt-1.5 max-h-60 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl ring-1 ring-black/10 animate-in fade-in duration-150">
                  {laborCategoryOptions
                    .filter((name) => !laborSearchText.trim() || name.toLowerCase().includes(laborSearchText.toLowerCase()))
                    .slice(0, 25)
                    .map((name) => (
                      <button
                        key={name}
                        type="button"
                        className="block w-full rounded-xl px-3 py-2.5 text-left text-sm font-extrabold text-slate-900 transition hover:bg-indigo-50/80 hover:text-indigo-950"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          const highest = getHighestWageForLabel(name);
                          setLaborSearchText(name);
                          setLaborForm((c) => ({ ...c, labour_type: name, wage_per_head: highest }));
                          setLaborWageSearchText(String(highest || ''));
                          setShowLaborSuggestions(false);
                        }}
                      >
                        {name}
                      </button>
                    ))}
                </div>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <RequiredLabel label="Count" required filled={laborForm.labour_count > 0} />
                <input type="number" min="0" step="1" value={numberFieldValue(laborForm.labour_count)} onChange={(e) => setLaborForm((c) => ({ ...c, labour_count: parseNumberInput(e.target.value) }))} />
              </div>
              <div>
                <RequiredLabel label="Wage / Head" required filled={laborForm.wage_per_head > 0} />
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={laborWageSearchText}
                    onFocus={() => setShowLaborWageSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowLaborWageSuggestions(false), 150)}
                    onChange={(e) => {
                      const value = e.target.value;
                      setLaborWageSearchText(value);
                      setLaborForm((c) => ({ ...c, wage_per_head: parseNumberInput(value) }));
                      setShowLaborWageSuggestions(true);
                    }}
                    placeholder="Select or type wage..."
                  />
                  {showLaborWageSuggestions ? (
                    <div className="absolute left-0 top-full z-50 mt-1.5 max-h-60 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl ring-1 ring-black/10 animate-in fade-in duration-150">
                      {filteredWageOptions.slice(0, 20).map((wage) => (
                        <button
                          key={wage}
                          type="button"
                          className="block w-full rounded-xl px-3 py-2.5 text-left text-sm font-extrabold text-slate-900 transition hover:bg-indigo-50/80 hover:text-indigo-950"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setLaborWageSearchText(String(wage));
                            setLaborForm((c) => ({ ...c, wage_per_head: wage }));
                            setShowLaborWageSuggestions(false);
                          }}
                        >
                          {formatCurrency(wage)}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </EntrySection>

          <EntrySection title="Extras">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <RequiredLabel label="No. of OTs" filled={laborForm.overtime_count > 0} />
                <input type="number" min="0" step="0.01" value={numberFieldValue(laborForm.overtime_count)} onChange={(e) => setLaborForm((c) => ({ ...c, overtime_count: parseNumberInput(e.target.value) }))} />
              </div>
              <div>
                <RequiredLabel label="Remarks" filled={Boolean(laborForm.remarks.trim())} />
                <input value={laborForm.remarks} onChange={(e) => setLaborForm((c) => ({ ...c, remarks: e.target.value }))} placeholder="Optional note" />
              </div>
            </div>
          </EntrySection>

          {laborForm.vendor_id && labourAddLimitStatus.hasLimit ? (
            <LabourInchargeLimitMeter status={labourAddLimitStatus} />
          ) : null}

          <EntrySummary
            rows={[
              { label: 'Normal wage', value: formatCurrency(labourEntryNormalWage) },
              { label: 'OT cost', value: formatCurrency(labourEntryOtCost) },
              { label: 'Days', value: String(Math.max(1, Number(laborForm.no_of_days || 1))) },
            ]}
            totalLabel="Total amount"
            totalValue={formatCurrency(Number(laborForm.total_wage || 0))}
          />
        </form>
      </ProjectEntryModal>

      {/* Edit Material Sidebar Drawer */}
      <ProjectEntryModal
        open={showMaterialEditModal && Boolean(editingMaterialId)}
        title="Edit Material"
        icon={<Package className="h-5 w-5" />}
        onClose={() => setShowMaterialEditModal(false)}
        footer={(
          <>
            <EntryGhostButton onClick={() => setShowMaterialEditModal(false)}>Cancel</EntryGhostButton>
            <EntryPrimaryButton
              type="button"
              onClick={async () => {
                const item = selectedMaterials.find((m) => m.id === editingMaterialId);
                if (!item) return;
                const vendorId = await resolveVendorId(materialEditForm.vendor_name, materialEditForm.vendor_id, 'material_vendor');
                const isBundle = Boolean(materialEditForm.has_bundle_conversion);
                const calcQty = isBundle
                  ? Number(materialEditForm.no_of_bundles || 0) * Number(materialEditForm.weight_per_bundle || 0)
                  : materialEditForm.quantity;
                const calcCost = isBundle
                  ? Number(materialEditForm.cost_per_kg || 0)
                  : materialEditForm.unit_cost;
                const bundleMeta = isBundle
                  ? {
                    has_bundle_conversion: true,
                    no_of_bundles: Number(materialEditForm.no_of_bundles || 0),
                    weight_per_bundle: Number(materialEditForm.weight_per_bundle || 0),
                    cost_per_kg: Number(materialEditForm.cost_per_kg || 0),
                    total_weight_kg: calcQty,
                  }
                  : null;

                updateMaterial.mutate({
                  materialId: item.id,
                  payload: {
                    project_id: item.project_id,
                    vendor_id: vendorId,
                    material_name: item.material_name,
                    quantity: calcQty,
                    unit: isBundle ? 'kg' : item.unit,
                    unit_cost: calcCost,
                    supplier: materialEditForm.supplier || null,
                    work_remarks: materialEditForm.work_remarks || null,
                    bill_no: materialEditForm.bill_no.trim() || null,
                    gst_percent: materialEditForm.gst_percent || null,
                    template_meta: bundleMeta,
                    transport_cost: 0,
                    date: materialEditForm.date,
                  },
                });
                setShowMaterialEditModal(false);
              }}
            >
              Update Material
            </EntryPrimaryButton>
          </>
        )}
      >
        <div className="space-y-4">
          <EntrySection title="When">
            <div>
              <RequiredLabel label="Date" required filled={Boolean(materialEditForm.date)} />
              <input type="date" value={materialEditForm.date} onChange={(e) => setMaterialEditForm((c) => ({ ...c, date: e.target.value }))} required />
            </div>
          </EntrySection>

          <EntrySection title="Calculation Mode">
            <div className="rounded-xl border border-amber-200/80 bg-gradient-to-r from-amber-50/70 to-orange-50/50 p-3">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={materialEditForm.has_bundle_conversion}
                  onChange={(e) => setMaterialEditForm((c) => ({ ...c, has_bundle_conversion: e.target.checked }))}
                  className="h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                />
                <span className="text-sm font-bold text-amber-950">📦 Enable Bundle Conversion (Steel / Bundled Material)</span>
              </label>
            </div>
          </EntrySection>

          <EntrySection title="Quantity & Rate">
            {materialEditForm.has_bundle_conversion ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <RequiredLabel label="No. of Bundles" required filled={materialEditForm.no_of_bundles > 0} />
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="Bundles"
                      value={numberFieldValue(materialEditForm.no_of_bundles)}
                      onChange={(e) => setMaterialEditForm((c) => ({ ...c, no_of_bundles: parseNumberInput(e.target.value) }))}
                    />
                  </div>
                  <div>
                    <RequiredLabel label="Weight / Bundle (kg)" required filled={materialEditForm.weight_per_bundle > 0} />
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="kg/bundle"
                      value={numberFieldValue(materialEditForm.weight_per_bundle)}
                      onChange={(e) => setMaterialEditForm((c) => ({ ...c, weight_per_bundle: parseNumberInput(e.target.value) }))}
                    />
                  </div>
                  <div>
                    <RequiredLabel label="Cost / kg" required filled={materialEditForm.cost_per_kg > 0} />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="₹/kg"
                      value={numberFieldValue(materialEditForm.cost_per_kg)}
                      onChange={(e) => setMaterialEditForm((c) => ({ ...c, cost_per_kg: parseNumberInput(e.target.value) }))}
                    />
                  </div>
                </div>
                <div className="text-xs font-semibold text-indigo-900 bg-indigo-50 p-2.5 rounded-xl flex justify-between">
                  <span>Total Weight: {((materialEditForm.no_of_bundles || 0) * (materialEditForm.weight_per_bundle || 0)).toLocaleString()} kg</span>
                  <span>Subtotal: {formatCurrency(materialEditSubtotal)}</span>
                </div>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <RequiredLabel label="Quantity" required filled={materialEditForm.quantity > 0} />
                  <input type="number" min="0.01" step="0.01" value={numberFieldValue(materialEditForm.quantity)} onChange={(e) => setMaterialEditForm((c) => ({ ...c, quantity: parseNumberInput(e.target.value) }))} placeholder="Quantity" />
                </div>
                <div>
                  <RequiredLabel label="Rate" required filled={materialEditForm.unit_cost > 0} />
                  <input type="number" min="0" step="0.01" value={numberFieldValue(materialEditForm.unit_cost)} onChange={(e) => setMaterialEditForm((c) => ({ ...c, unit_cost: parseNumberInput(e.target.value) }))} placeholder="Rate" />
                </div>
              </div>
            )}
          </EntrySection>

          <EntrySection title="Who & Tax">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="relative">
                <RequiredLabel label="Vendor" filled={Boolean(materialEditForm.vendor_name.trim())} />
                <input
                  value={materialEditForm.vendor_name}
                  onFocus={() => setShowMaterialEditVendorSuggestions(true)}
                  onChange={(e) => {
                    const value = e.target.value;
                    const vendor = materialVendors.find((item) => item.name.trim().toLowerCase() === value.trim().toLowerCase());
                    setMaterialEditForm((c) => ({ ...c, vendor_name: value, vendor_id: vendor?.id || 0 }));
                    setShowMaterialEditVendorSuggestions(true);
                  }}
                  onBlur={() => setTimeout(() => setShowMaterialEditVendorSuggestions(false), 150)}
                  placeholder="Select or type vendor..."
                />
                {showMaterialEditVendorSuggestions ? (
                  <div className="absolute left-0 top-full z-50 mt-1.5 max-h-60 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl ring-1 ring-black/10 animate-in fade-in duration-150">
                    {materialVendors
                      .filter((v) => !materialEditForm.vendor_name.trim() || v.name.toLowerCase().includes(materialEditForm.vendor_name.trim().toLowerCase()))
                      .slice(0, 25)
                      .map((vendor) => (
                        <button
                          key={vendor.id}
                          type="button"
                          className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition hover:bg-indigo-50/80 hover:text-indigo-950"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setMaterialEditForm((c) => ({ ...c, vendor_name: vendor.name, vendor_id: vendor.id }));
                            setShowMaterialEditVendorSuggestions(false);
                          }}
                        >
                          <span className="block text-sm font-extrabold text-slate-900 truncate">{vendor.name}</span>
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Vendor</span>
                        </button>
                      ))}
                  </div>
                ) : null}
              </div>
              <div>
                <RequiredLabel label="GST (%)" filled={materialEditForm.gst_percent > 0} />
                <input type="number" min="0" step="0.01" value={numberFieldValue(materialEditForm.gst_percent)} onChange={(e) => setMaterialEditForm((c) => ({ ...c, gst_percent: parseNumberInput(e.target.value) }))} placeholder="GST %" />
              </div>
            </div>
          </EntrySection>

          <EntrySection title="Bill & Notes">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <RequiredLabel label="Bill No" filled={Boolean(materialEditForm.bill_no.trim())} />
                <input
                  value={materialEditForm.bill_no}
                  onChange={(e) => setMaterialEditForm((c) => ({ ...c, bill_no: e.target.value }))}
                  placeholder="e.g. INV-1002"
                />
              </div>
              <div>
                <RequiredLabel label="Remarks" filled={Boolean(materialEditForm.work_remarks.trim())} />
                <input value={materialEditForm.work_remarks} onChange={(e) => setMaterialEditForm((c) => ({ ...c, work_remarks: e.target.value }))} placeholder="Work / remarks" />
              </div>
            </div>
          </EntrySection>

          <EntrySummary
            rows={[
              { label: 'Subtotal', value: formatCurrency(materialEditSubtotal) },
              { label: 'GST', value: formatCurrency(materialEditGst) },
            ]}
            totalLabel="Grand total"
            totalValue={formatCurrency(materialEditTotal)}
          />
        </div>
      </ProjectEntryModal>

      {/* Edit Labour Sidebar Drawer */}
      <ProjectEntryModal
        open={showLabourEditModal && Boolean(editingLaborId)}
        title="Edit Labour"
        icon={<Users className="h-5 w-5" />}
        onClose={() => setShowLabourEditModal(false)}
        footer={(
          <>
            <EntryGhostButton onClick={() => setShowLabourEditModal(false)}>Cancel</EntryGhostButton>
            <EntryPrimaryButton
              type="button"
              onClick={async () => {
                const item = selectedAttendance.find((m) => m.id === editingLaborId);
                if (!item) return;
                const vendorId = await resolveVendorId(laborEditForm.vendor_name, laborEditForm.vendor_id, 'labour_incharge');
                const limitVendorId = vendorId || 0;
                const booked = (labourDueByVendorId.get(limitVendorId) || 0) - (
                  (item.vendor_id || 0) === limitVendorId ? Number(item.total_wage || 0) : 0
                );
                const warning = labourLimitWarningMessage(
                  laborEditForm.vendor_name,
                  labourLimitStatus(labourLimitByVendorId.get(limitVendorId), booked, Number(laborEditForm.total_wage || 0)),
                );
                if (warning) notify.warning(warning);
                updateAttendance.mutate({
                  attendanceId: item.id,
                  payload: {
                    project_id: item.project_id,
                    vendor_id: vendorId,
                    date: laborEditForm.date,
                    labour_type: laborEditForm.labour_type,
                    labour_count: laborEditForm.labour_count,
                    wage_per_head: laborEditForm.wage_per_head,
                    overtime_cost: laborEditForm.overtime_cost,
                    total_wage: Number(laborEditForm.total_wage || 0) > 0 ? laborEditForm.total_wage : null,
                    remarks: laborEditForm.remarks || null,
                  },
                });
                setShowLabourEditModal(false);
              }}
            >
              Update Labour
            </EntryPrimaryButton>
          </>
        )}
      >
        <div className="space-y-4">
          <EntrySection title="When">
            <div>
              <RequiredLabel label="Date" required filled={Boolean(laborEditForm.date)} />
              <input type="date" value={laborEditForm.date} onChange={(e) => setLaborEditForm((c) => ({ ...c, date: e.target.value }))} required />
            </div>
          </EntrySection>

          <EntrySection title="Who">
            <div className="relative">
              <RequiredLabel label="Labour Incharge" filled={Boolean(laborEditForm.vendor_name.trim())} />
              <input
                value={laborEditForm.vendor_name}
                onFocus={() => setShowLabourEditVendorSuggestions(true)}
                onChange={(e) => {
                  const value = e.target.value;
                  const vendor = labourIncharges.find((item) => item.name.trim().toLowerCase() === value.trim().toLowerCase());
                  setLaborEditForm((c) => ({ ...c, vendor_name: value, vendor_id: vendor?.id || 0 }));
                  setShowLabourEditVendorSuggestions(true);
                }}
                onBlur={() => setTimeout(() => setShowLabourEditVendorSuggestions(false), 150)}
                placeholder="Select or type vendor / contractor..."
              />
              {showLabourEditVendorSuggestions ? (
                <div className="absolute left-0 top-full z-50 mt-1.5 max-h-60 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl ring-1 ring-black/10 animate-in fade-in duration-150">
                  {labourIncharges
                    .filter((v) => !laborEditForm.vendor_name.trim() || v.name.toLowerCase().includes(laborEditForm.vendor_name.trim().toLowerCase()))
                    .slice(0, 25)
                    .map((vendor) => (
                      <button
                        key={vendor.id}
                        type="button"
                        className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-indigo-50/80 hover:text-indigo-950"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setLaborEditForm((c) => ({ ...c, vendor_name: vendor.name, vendor_id: vendor.id }));
                          setShowLabourEditVendorSuggestions(false);
                        }}
                      >
                        <span className="block text-sm font-extrabold text-slate-900 truncate">{vendor.name}</span>
                        {(() => {
                          const hint = labourLimitSuggestionLabel(labourLimitStatus(labourLimitByVendorId.get(vendor.id), labourDueByVendorId.get(vendor.id) || 0));
                          return hint ? (
                            <span className="shrink-0 text-[10px] font-bold tabular-nums text-indigo-600">{hint}</span>
                          ) : (
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Incharge</span>
                          );
                        })()}
                      </button>
                    ))}
                </div>
              ) : null}
            </div>
            {laborEditForm.vendor_id && labourEditLimitStatus.hasLimit ? (
              <p className={clsx('text-xs font-bold tabular-nums', labourEditLimitStatus.tone === 'over' || labourEditLimitStatus.tone === 'limit' ? 'text-rose-700' : labourEditLimitStatus.tone === 'watch' ? 'text-amber-800' : 'text-emerald-700')}>
                {labourLimitSuggestionLabel(labourEditLimitStatus)} of {formatCurrency(labourEditLimitStatus.limit)}
              </p>
            ) : null}
          </EntrySection>

          <EntrySection title="Work & Wage">
            <div>
              <RequiredLabel label="Labour Category" required filled={Boolean(laborEditForm.labour_type.trim())} />
              <input value={laborEditForm.labour_type} onChange={(e) => setLaborEditForm((c) => ({ ...c, labour_type: e.target.value }))} placeholder="Labour type" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <RequiredLabel label="Count" required filled={laborEditForm.labour_count > 0} />
                <input type="number" min="0" step="1" value={numberFieldValue(laborEditForm.labour_count)} onChange={(e) => setLaborEditForm((c) => ({ ...c, labour_count: parseNumberInput(e.target.value) }))} placeholder="Count" />
              </div>
              <div>
                <RequiredLabel label="Wage / Head" required filled={laborEditForm.wage_per_head > 0} />
                <input type="number" min="0" step="0.01" value={numberFieldValue(laborEditForm.wage_per_head)} onChange={(e) => setLaborEditForm((c) => ({ ...c, wage_per_head: parseNumberInput(e.target.value) }))} placeholder="Wage / head" />
              </div>
            </div>
          </EntrySection>

          <EntrySection title="Extras">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <RequiredLabel label="No. of OTs" filled={laborEditForm.overtime_count > 0} />
                <input type="number" min="0" step="0.01" value={numberFieldValue(laborEditForm.overtime_count)} onChange={(e) => setLaborEditForm((c) => ({ ...c, overtime_count: parseNumberInput(e.target.value) }))} placeholder="No. of OTs" />
              </div>
              <div>
                <RequiredLabel label="Remarks" filled={Boolean(laborEditForm.remarks.trim())} />
                <input value={laborEditForm.remarks} onChange={(e) => setLaborEditForm((c) => ({ ...c, remarks: e.target.value }))} placeholder="Remarks" />
              </div>
            </div>
          </EntrySection>

          {laborEditForm.vendor_id && labourEditLimitStatus.hasLimit ? (
            <LabourInchargeLimitMeter status={labourEditLimitStatus} />
          ) : null}

          <EntrySummary
            rows={[
              { label: 'Normal wage', value: formatCurrency(Number(laborEditForm.labour_count || 0) * Number(laborEditForm.wage_per_head || 0)) },
              { label: 'OT cost', value: formatCurrency(Number(laborEditForm.overtime_count || 0) * Number(laborEditForm.wage_per_head || 0)) },
            ]}
            totalLabel="Total wage"
            totalValue={formatCurrency(Number(laborEditForm.total_wage || 0))}
          />
        </div>
      </ProjectEntryModal>

      {selectedProjectId && canManageInchargeLimits ? (
        <LabourInchargeLimitDialog
          open={Boolean(labourLimitDialog)}
          projectId={selectedProjectId}
          vendorId={labourLimitDialog?.vendorId ?? null}
          vendorName={labourLimitDialog?.vendorName}
          incharges={labourLimitIncharges}
          limits={labourLimitByVendorId}
          onClose={() => setLabourLimitDialog(null)}
        />
      ) : null}

      {/* Edit Expense Sidebar Drawer */}
      <ProjectEntryModal
        open={showExpenseEditModal && Boolean(editingExpenseId)}
        title="Edit Expense"
        icon={<Banknote className="h-5 w-5" />}
        onClose={() => setShowExpenseEditModal(false)}
        footer={(
          <>
            <EntryGhostButton onClick={() => setShowExpenseEditModal(false)}>Cancel</EntryGhostButton>
            <EntryPrimaryButton
              type="button"
              onClick={() => {
                const item = selectedExpenses.find((m) => m.id === editingExpenseId);
                if (!item) return;
                updateExpense.mutate({
                  expenseId: item.id,
                  payload: {
                    project_id: item.project_id,
                    category: expenseEditForm.category,
                    amount: expenseEditForm.amount,
                    description: expenseEditForm.description || null,
                    date: expenseEditForm.date,
                  },
                });
                setShowExpenseEditModal(false);
              }}
            >
              Update Expense
            </EntryPrimaryButton>
          </>
        )}
      >
        <div className="space-y-4">
          <EntrySection title="When">
            <div>
              <RequiredLabel label="Date" required filled={Boolean(expenseEditForm.date)} />
              <input type="date" value={expenseEditForm.date} onChange={(e) => setExpenseEditForm((c) => ({ ...c, date: e.target.value }))} required />
            </div>
          </EntrySection>

          <EntrySection title="What">
            <div>
              <RequiredLabel label="Category" required filled={Boolean(expenseEditForm.category.trim())} />
              <input value={expenseEditForm.category} onChange={(e) => setExpenseEditForm((c) => ({ ...c, category: e.target.value }))} placeholder="Category" required />
            </div>
          </EntrySection>

          <EntrySection title="Amount">
            <div>
              <RequiredLabel label="Amount" required filled={expenseEditForm.amount > 0} />
              <input type="number" min="0" className="text-lg font-black" value={numberFieldValue(expenseEditForm.amount)} onChange={(e) => setExpenseEditForm((c) => ({ ...c, amount: parseNumberInput(e.target.value) }))} required />
            </div>
          </EntrySection>

          <EntrySection title="Notes">
            <div>
              <RequiredLabel label="Description" filled={Boolean(expenseEditForm.description.trim())} />
              <input value={expenseEditForm.description} onChange={(e) => setExpenseEditForm((c) => ({ ...c, description: e.target.value }))} placeholder="Description" />
            </div>
          </EntrySection>

          <EntrySummary
            rows={[{ label: 'Category', value: expenseEditForm.category.trim() || '—' }]}
            totalLabel="Amount"
            totalValue={formatCurrency(Number(expenseEditForm.amount || 0))}
          />
        </div>
      </ProjectEntryModal>

      {showCalendarDrawer && statement ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/35 backdrop-blur-sm" onClick={() => { setShowCalendarDrawer(false); setSelectedCalendarDate(null); }}>
          <aside
            className="calendar-drawer-panel h-full w-full max-w-5xl translate-x-0 overflow-y-auto bg-white shadow-[-20px_0_60px_rgba(15,23,42,0.25)] transition-transform duration-300"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-700">Project Calendar</p>
                  <h3 className="mt-1 text-2xl font-black text-graphite">{statement.project.project_name}</h3>
                  <p className="mt-1 text-sm font-semibold text-slate-600">
                    {formatDateRange(projectCalendar.startDate, projectCalendar.endDate)}
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
                  onClick={() => { setShowCalendarDrawer(false); setSelectedCalendarDate(null); }}
                >
                  Close
                </button>
              </div>
            </div>

            <div className="space-y-4 p-5">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <button
                  type="button"
                  className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-left shadow-sm transition hover:border-emerald-200 hover:bg-emerald-100"
                  onClick={() => setShowClientDetailModal(true)}
                >
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Received</p>
                  <p className="mt-2 text-2xl font-black text-emerald-950">{formatCurrency(projectCalendar.totals.received)}</p>
                  <p className="mt-1 text-sm font-semibold text-emerald-800">Client and shareholder receipts</p>
                </button>
                <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 shadow-sm">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-rose-700">Spent</p>
                  <p className="mt-2 text-2xl font-black text-rose-950">{formatCurrency(projectCalendar.totals.spent)}</p>
                  <p className="mt-1 text-sm font-semibold text-rose-800">Materials, labour, expenses</p>
                </div>
                <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4 shadow-sm">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-700">Range</p>
                  <p className="mt-2 text-lg font-black text-indigo-950">Start to {statement.project.expected_end_date ? 'project end' : 'current date'}</p>
                  <p className="mt-1 text-sm font-semibold text-indigo-800">
                    Start: {formatDate(projectCalendar.startDate)} | End: {statement.project.expected_end_date ? formatDate(projectCalendar.endDate) : '-'}
                  </p>
                </div>
                <div className={`rounded-2xl border p-4 shadow-sm ${projectCalendar.totals.balance >= 0 ? 'border-sky-100 bg-sky-50' : 'border-amber-100 bg-amber-50'}`}>
                  <p className={`text-xs font-black uppercase tracking-[0.18em] ${projectCalendar.totals.balance >= 0 ? 'text-sky-700' : 'text-amber-700'}`}>Net Balance</p>
                  <p className={`mt-2 text-2xl font-black ${projectCalendar.totals.balance >= 0 ? 'text-sky-950' : 'text-amber-950'}`}>{formatCurrency(projectCalendar.totals.balance)}</p>
                  <p className={`mt-1 text-sm font-semibold ${projectCalendar.totals.balance >= 0 ? 'text-sky-800' : 'text-amber-800'}`}>Received minus spent</p>
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.05)]">
                <div className="bg-navy p-3 text-[color:var(--on-accent)]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="inline-flex items-center gap-2">
                      <CalendarDays className="h-5 w-5" />
                      <h3 className="text-lg font-black">{projectCalendar.monthLabel}</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="inline-flex h-8 items-center gap-1 rounded-lg bg-white/15 px-2.5 text-xs font-bold text-white ring-1 ring-white/20 transition hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={projectCalendar.monthKey <= projectCalendar.minMonth}
                        onClick={() => setCalendarMonth((current) => clampMonthKey(shiftMonth(current, -1), projectCalendar.minMonth, projectCalendar.maxMonth))}
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Previous
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-8 items-center rounded-lg bg-white px-3 text-xs font-black text-indigo-700 transition hover:bg-indigo-50"
                        onClick={() => setCalendarMonth(projectCalendar.maxMonth)}
                      >
                        Today
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-8 items-center gap-1 rounded-lg bg-white/15 px-2.5 text-xs font-bold text-white ring-1 ring-white/20 transition hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={projectCalendar.monthKey >= projectCalendar.maxMonth}
                        onClick={() => setCalendarMonth((current) => clampMonthKey(shiftMonth(current, 1), projectCalendar.minMonth, projectCalendar.maxMonth))}
                      >
                        Next
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-black">
                    <span className="rounded-lg bg-emerald-500/80 px-2.5 py-1">Received: {formatCompactCurrency(projectCalendar.totals.received)}</span>
                    <span className="rounded-lg bg-rose-500/80 px-2.5 py-1">Spent: {formatCompactCurrency(projectCalendar.totals.spent)}</span>
                    <span className="rounded-lg bg-slate-900/25 px-2.5 py-1">Net: {formatCompactCurrency(projectCalendar.totals.balance)}</span>
                  </div>
                </div>
                <div className="app-calendar">
                <div className="app-calendar-inner">
                <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-100 text-center text-[11px] font-black uppercase tracking-[0.12em] text-slate-600">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                    <div key={day} className="px-1 py-2">{day}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 bg-slate-200 text-xs">
                  {projectCalendar.days.map((day) => {
                    const hasActivity = day.spent > 0 || day.received > 0 || day.transactions.length > 0;
                    return (
                      <button
                        key={day.key}
                        type="button"
                        disabled={!day.day || !day.inRange}
                        className={clsx(
                          'min-h-[86px] border-b border-r border-slate-200 bg-white p-1.5 text-left transition',
                          !day.day && 'bg-slate-50',
                          day.day && !day.inRange && 'cursor-not-allowed bg-slate-50 text-slate-300',
                          day.day && day.inRange && 'hover:bg-indigo-50',
                          day.isToday && 'ring-2 ring-inset ring-indigo-400',
                          day.isSelected && 'bg-indigo-600 text-white hover:bg-indigo-600',
                        )}
                        onClick={() => {
                          if (!day.day || !day.inRange) return;
                          setSelectedCalendarDate(day.key);
                        }}
                      >
                        {day.day ? (
                          <div className="flex h-full min-h-[74px] flex-col gap-1">
                            <div className="flex items-center justify-between gap-1">
                              <span className={clsx('text-sm font-black', day.isSelected ? 'text-white' : day.inRange ? 'text-slate-700' : 'text-slate-300')}>{day.day}</span>
                              {hasActivity ? <span className={clsx('h-2 w-2 rounded-full', day.isSelected ? 'bg-white' : 'bg-emerald-500')} /> : null}
                            </div>
                            {day.isStart || day.isEnd ? (
                              <span className={clsx('rounded px-1 py-0.5 text-[10px] font-black uppercase tracking-wide', day.isSelected ? 'bg-white/20 text-white' : 'bg-amber-50 text-amber-800')}>
                                {day.isStart && day.isEnd ? 'Start / End' : day.isStart ? 'Start' : 'End'}
                              </span>
                            ) : null}
                            {day.received > 0 ? (
                              <span className={clsx('rounded px-1 py-0.5 text-[11px] font-black', day.isSelected ? 'bg-white/20 text-white' : 'bg-emerald-50 text-emerald-700')}>↑ {formatCompactCurrency(day.received)}</span>
                            ) : null}
                            {day.spent > 0 ? (
                              <span className={clsx('rounded px-1 py-0.5 text-[11px] font-black', day.isSelected ? 'bg-white/20 text-white' : 'bg-rose-50 text-rose-700')}>↓ {formatCompactCurrency(day.spent)}</span>
                            ) : null}
                          </div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-600">Day Transactions</p>
                    <h4 className="mt-1 text-lg font-black text-graphite">
                      {projectCalendar.selectedDay ? formatDate(projectCalendar.selectedDay.key) : 'Select a day'}
                    </h4>
                  </div>
                  {projectCalendar.selectedDay ? (
                    <div className="flex gap-2 text-xs font-black">
                      <span className="rounded-lg bg-emerald-50 px-2.5 py-1 text-emerald-700">Received {formatCurrency(projectCalendar.selectedDay.received)}</span>
                      <span className="rounded-lg bg-rose-50 px-2.5 py-1 text-rose-700">Spent {formatCurrency(projectCalendar.selectedDay.spent)}</span>
                    </div>
                  ) : null}
                </div>
                {projectCalendar.selectedDay ? (
                  <div className="overflow-auto rounded-xl border border-slate-200">
                    <table className="w-full table-fixed text-sm">
                      <thead className="bg-slate-100 text-slate-700">
                        <tr>
                          <th className="w-[15%] px-3 py-2 text-left font-semibold text-xs uppercase tracking-wider border-b border-slate-200">Type</th>
                          <th className="w-[28%] px-3 py-2 text-left font-semibold text-xs uppercase tracking-wider border-b border-slate-200">Transaction</th>
                          <th className="w-[15%] px-3 py-2 text-left font-semibold text-xs uppercase tracking-wider border-b border-slate-200">Direction</th>
                          <th className="w-[16%] px-3 py-2 text-right font-semibold text-xs uppercase tracking-wider border-b border-slate-200">Amount</th>
                          <th className="px-3 py-2 text-left font-semibold text-xs uppercase tracking-wider border-b border-slate-200">Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {projectCalendar.selectedDay.transactions.length ? projectCalendar.selectedDay.transactions.map((transaction, idx) => (
                          <tr key={transaction.id} className={clsx('border-t border-slate-100 transition', idx % 2 === 0 ? 'bg-white hover:bg-slate-50/80' : 'bg-slate-50/40 hover:bg-slate-100/60')}>
                            <td className="px-3 py-2 font-semibold text-slate-800">{transaction.type}</td>
                            <td className="px-3 py-2 font-semibold text-slate-800">{transaction.title}</td>
                            <td className="px-3 py-2">
                              <span
                                className={clsx(
                                  'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                                  transaction.direction === 'received' && 'bg-emerald-50 text-emerald-700',
                                  transaction.direction === 'spent' && 'bg-rose-50 text-rose-700',
                                  transaction.direction === 'cash_out' && 'bg-amber-50 text-amber-700',
                                )}
                              >
                                {transaction.direction === 'received' ? 'Received' : transaction.direction === 'spent' ? 'Spent' : 'Vendor Paid'}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-900">{formatCurrency(transaction.amount)}</td>
                            <td className="px-3 py-2 text-slate-600">{transaction.detail}</td>
                          </tr>
                        )) : (
                          <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">No transactions recorded for this date.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm font-semibold text-slate-500">
                    Click any project date in the calendar to see that day&apos;s entries.
                  </div>
                )}
                <p className="mt-3 text-xs font-semibold text-slate-500">Vendor Paid rows are shown as cash payments for reference and are not added to the spent total to avoid double-counting material or labour costs.</p>
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      {showClientDetailModal && statement ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/45 px-2 py-4 sm:px-4 sm:py-6" onClick={() => setShowClientDetailModal(false)}>
          <div className="w-full max-w-4xl rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-600">Client Payment Details</p>
                <h3 className="mt-1 text-xl font-black text-graphite">{selectedClient?.name || selectedClient?.pan_no || selectedClient?.company_name || 'Client not linked'}</h3>
                <p className="mt-1 text-sm font-semibold text-slate-600">
                  {selectedClient ? `${selectedClient.phone || '-'} | ${selectedClient.email || '-'} | ${selectedClient.city || '-'}` : 'No client record is linked to this project.'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100" onClick={printClientDetail}>
                  <Printer className="h-3.5 w-3.5" />
                  Print
                </button>
                <button className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50" onClick={() => setShowClientDetailModal(false)}>Close</button>
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-4">
              <div className="rounded-lg bg-indigo-50 p-3">
                <p className="text-xs font-bold text-indigo-700">Project Amount</p>
                <p className="text-base font-black text-indigo-900">{formatCurrency(statement.project.total_amount || 0)}</p>
              </div>
              <div className="rounded-lg bg-emerald-50 p-3">
                <p className="text-xs font-bold text-emerald-700">Received</p>
                <p className="text-base font-black text-emerald-900">{formatCurrency(statement.metrics.total_received || 0)}</p>
              </div>
              <div className="rounded-lg bg-rose-50 p-3">
                <p className="text-xs font-bold text-rose-700">Outstanding</p>
                <p className="text-base font-black text-rose-900">{formatCurrency(statement.metrics.outstanding || 0)}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs font-bold text-slate-600">Payment Rows</p>
                <p className="text-base font-black text-slate-900">{selectedPayments.length}</p>
              </div>
            </div>
            <div className="mt-4 overflow-auto rounded-xl border border-slate-200">
              <table className="w-full table-fixed text-sm">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-xs uppercase tracking-wider border-b border-slate-200">Type</th>
                    <th className="px-3 py-2 text-right font-semibold text-xs uppercase tracking-wider border-b border-slate-200">Amount</th>
                    <th className="px-3 py-2 text-left font-semibold text-xs uppercase tracking-wider border-b border-slate-200">Status</th>
                    <th className="px-3 py-2 text-left font-semibold text-xs uppercase tracking-wider border-b border-slate-200">Received Date</th>
                    <th className="px-3 py-2 text-left font-semibold text-xs uppercase tracking-wider border-b border-slate-200">Due Date</th>
                    <th className="px-3 py-2 text-left font-semibold text-xs uppercase tracking-wider border-b border-slate-200">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedPayments.length ? selectedPayments.map((payment, idx) => (
                    <tr key={payment.id} className={clsx('border-t border-slate-100 transition', idx % 2 === 0 ? 'bg-white hover:bg-slate-50/80' : 'bg-slate-50/40 hover:bg-slate-100/60')} onMouseEnter={() => showRecordAudit('payment_logs', payment.id, 'Payment')} onMouseLeave={hideAudit}>
                      <td className="px-3 py-2 font-semibold text-slate-800">{payment.payment_type}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">{formatCurrency(payment.amount)}</td>
                      <td className="px-3 py-2">{payment.status}</td>
                      <td className="px-3 py-2">{payment.received_date ? formatDate(payment.received_date) : '-'}</td>
                      <td className="px-3 py-2">{payment.due_date ? formatDate(payment.due_date) : '-'}</td>
                      <td className="px-3 py-2 text-slate-600">{payment.notes || '-'}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={6} className="px-3 py-5 text-center text-slate-400">No client payment entries found for this project.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {showPaymentsModal ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/45 px-2 py-4 sm:px-4 sm:py-6" onClick={() => setShowPaymentsModal(false)}>
          <div className="w-full max-w-3xl rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-base font-bold text-graphite">Payment Details</h3>
              <button className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700" onClick={() => setShowPaymentsModal(false)}>Close</button>
            </div>
            <DataTable
              auditTableName="payment_logs"
              auditRecordIds={selectedPayments.map((payment) => payment.id)}
              auditRecordLabel="Payment"
              headers={['Type', 'Amount', 'Status', 'Received Date', 'Due Date', 'Notes']}
              printTitle={`Payment Details - ${statement?.project.project_name || 'Project'}`}
              printMetadata={{
                Project: statement?.project.project_name || '-',
                Location: statement?.project.location || '-',
                'Total Received': formatCurrency(statement?.metrics.total_received || 0),
                Outstanding: formatCurrency(statement?.metrics.outstanding || 0),
              }}
              rows={selectedPayments.length ? selectedPayments.map((p) => [p.payment_type, formatCurrency(p.amount), p.status, p.received_date ? formatDate(p.received_date) : '-', p.due_date ? formatDate(p.due_date) : '-', p.notes || '-']) : [['-', '-', '-', '-', '-', 'No payments found']]}
            />
          </div>
        </div>
      ) : null}

      {showVendorEditModal ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/45 px-2 py-4 sm:px-4 sm:py-6" onClick={() => setShowVendorEditModal(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-base font-bold text-graphite">Edit Vendor</h3>
              <button className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700" onClick={() => setShowVendorEditModal(false)}>Close</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">Vendor Name <span className="text-red-500">*</span></label>
                <input
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  value={vendorEditForm.name}
                  onChange={(event) => setVendorEditForm((current) => ({ ...current, name: event.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">Phone</label>
                <input
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  value={vendorEditForm.phone}
                  onChange={(event) => setVendorEditForm((current) => ({ ...current, phone: event.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">Address</label>
                <textarea
                  className="min-h-[90px] w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  value={vendorEditForm.address}
                  onChange={(event) => setVendorEditForm((current) => ({ ...current, address: event.target.value }))}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700" onClick={() => setShowVendorEditModal(false)}>Cancel</button>
                <button
                  className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  disabled={!vendorEditForm.name.trim()}
                  onClick={() => {
                    if (!vendorEditForm.id || !vendorEditForm.name.trim()) return;
                    updateVendorMutation.mutate({
                      vendorId: vendorEditForm.id,
                      payload: {
                        name: vendorEditForm.name.trim(),
                        phone: vendorEditForm.phone.trim() || null,
                        address: vendorEditForm.address.trim() || null,
                        active: true,
                      },
                    });
                  }}
                >
                  Update Vendor
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showDescriptionModal && statement ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/45 px-2 py-4 sm:px-4 sm:py-6" onClick={() => setShowDescriptionModal(false)}>
          <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Project description</p>
                <h3 className="mt-1 text-xl font-bold text-graphite">{statement.project.project_name}</h3>
              </div>
              <button className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700" onClick={() => setShowDescriptionModal(false)}>Close</button>
            </div>

            {isDescriptionEditing ? (
              <textarea
                className="min-h-[240px] w-full resize-y rounded-2xl border border-slate-200 bg-white p-4 text-base leading-7 text-slate-800 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                value={projectDescriptionDraft}
                onChange={(event) => setProjectDescriptionDraft(event.target.value)}
                placeholder="Write project description, scope, site notes, important instructions, or client requirements..."
              />
            ) : (
              <div className="min-h-[220px] whitespace-pre-wrap rounded-2xl border border-slate-100 bg-slate-50 p-4 text-base leading-7 text-slate-700">
                {projectDescriptionDraft.trim() || 'No description added yet.'}
              </div>
            )}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              {!isDescriptionEditing ? (
                <button
                  type="button"
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700"
                  onClick={() => setIsDescriptionEditing(true)}
                >
                  Edit / Write
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
                    onClick={() => {
                      setProjectDescriptionDraft(statement.project.description || '');
                      setIsDescriptionEditing(false);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={updateProjectMutation.isPending}
                    onClick={saveProjectDescription}
                  >
                    Save
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {showVendorTransactionModal && canManageVendorTransactions ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/45 px-2 py-4 sm:px-4 sm:py-6" onClick={() => { setShowVendorTransactionModal(false); setEditingVendorTransactionId(null); }}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-base font-bold text-graphite">{editingVendorTransactionId ? 'Edit Vendor Payment' : 'Record Vendor Payment'}</h3>
              <button className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700" onClick={() => { setShowVendorTransactionModal(false); setEditingVendorTransactionId(null); }}>Close</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">Vendor / Incharge <span className="text-red-500">*</span></label>
                <select
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  value={vendorTransactionForm.vendor_id || ''}
                  onChange={(e) => setVendorTransactionForm((c) => ({ ...c, vendor_id: Number(e.target.value) }))}
                  disabled={Boolean(editingVendorTransactionId)}
                  required
                >
                  <option value="">-- Select Vendor / Incharge --</option>
                  {vendorMaster.filter((v) => v.active).map((v) => (
                    <option key={v.id} value={v.id}>{v.name} ({v.party_type === 'labour_incharge' ? 'Labour Incharge' : 'Vendor'})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">Amount Paid (₹) <span className="text-red-500">*</span></label>
                <input
                  type="number" min="0" step="0.01"
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  value={vendorTransactionForm.amount || ''}
                  onChange={(e) => setVendorTransactionForm((c) => ({ ...c, amount: Number(e.target.value || 0) }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">Round Off (+/-)</label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  value={vendorTransactionForm.round_off === 0 ? '' : vendorTransactionForm.round_off}
                  onChange={(e) => setVendorTransactionForm((c) => ({ ...c, round_off: Number(e.target.value || 0) }))}
                  placeholder="e.g. -50 or +100"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">Total Paid</label>
                <div className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-950">
                  {formatCurrency(vendorPaymentTotal(vendorTransactionForm))}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">Payment Date <span className="text-red-500">*</span></label>
                <input
                  type="date"
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  value={vendorTransactionForm.payment_date}
                  onChange={(e) => setVendorTransactionForm((c) => ({ ...c, payment_date: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">Payment Mode</label>
                <select
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  value={vendorTransactionForm.payment_mode}
                  onChange={(e) => setVendorTransactionForm((c) => ({ ...c, payment_mode: e.target.value }))}
                >
                  <option value="">-- Select Mode --</option>
                  <option value="Cash">Cash</option>
                  <option value="Online">Online</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="UPI">UPI</option>
                  <option value="Cheque">Cheque</option>
                  <option value="Others">Others</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">Remarks</label>
                <input
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  value={vendorTransactionForm.notes}
                  onChange={(e) => setVendorTransactionForm((c) => ({ ...c, notes: e.target.value }))}
                  placeholder="Optional remarks"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700" onClick={() => { setShowVendorTransactionModal(false); setEditingVendorTransactionId(null); }}>Cancel</button>
                <button
                  className="rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                  disabled={!vendorTransactionForm.vendor_id || !vendorTransactionForm.payment_date || vendorPaymentTotal(vendorTransactionForm) <= 0}
                  onClick={() => {
                    if (!selectedProjectId || !vendorTransactionForm.vendor_id || vendorPaymentTotal(vendorTransactionForm) <= 0) return;
                    const roundOff = Number(vendorTransactionForm.round_off || 0);
                    if (editingVendorTransactionId) {
                      updateVendorTransactionMutation.mutate({
                        transactionId: editingVendorTransactionId,
                        payload: {
                          amount: vendorTransactionForm.amount,
                          round_off: roundOff,
                          payment_date: vendorTransactionForm.payment_date,
                          payment_mode: vendorTransactionForm.payment_mode || null,
                          notes: vendorTransactionForm.notes || null,
                        },
                      });
                      return;
                    }
                    createVendorTransactionMutation.mutate({
                      project_id: selectedProjectId,
                      vendor_id: vendorTransactionForm.vendor_id,
                      amount: vendorTransactionForm.amount,
                      round_off: roundOff,
                      payment_date: vendorTransactionForm.payment_date,
                      payment_mode: vendorTransactionForm.payment_mode || null,
                      notes: vendorTransactionForm.notes || null,
                    });
                  }}
                >{editingVendorTransactionId ? 'Update Payment' : 'Record Payment'}</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Sleek In-App File Preview Modal */}
      {previewingFile ? (
        <div
          className="fixed inset-0 z-[200] flex flex-col bg-slate-950/80 backdrop-blur-md transition-opacity animate-in fade-in duration-200"
          onClick={() => {
            if (previewingFile.url) URL.revokeObjectURL(previewingFile.url);
            setPreviewingFile(null);
          }}
        >
          {/* Modal Header */}
          <div
            className="flex items-center justify-between border-b border-slate-800 bg-slate-900/90 px-6 py-3 text-white shadow-md shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 min-w-0">
              <FileText className="h-5 w-5 text-indigo-400 shrink-0" />
              <div className="min-w-0">
                <h3 className="font-bold text-sm text-white truncate" title={previewingFile.file.original_filename}>
                  {previewingFile.file.original_filename}
                </h3>
                <p className="text-[10px] text-slate-400 font-medium">
                  {formatFileBytes(previewingFile.file.original_size)} · {previewingFile.file.content_type || 'Document'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700 hover:text-white transition shadow-sm"
                onClick={() => {
                  window.open(previewingFile.url, '_blank');
                }}
              >
                <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                Open in New Tab
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 transition shadow-sm"
                onClick={() => void handleDownloadProjectFile(previewingFile.file)}
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 border border-slate-700 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-slate-700 transition shadow-sm"
                onClick={() => void handlePrintProjectFile(previewingFile.file)}
              >
                <Printer className="h-3.5 w-3.5 text-amber-400" />
                Print
              </button>
              <button
                type="button"
                className="ml-2 inline-flex h-8 w-8 items-center justify-center rounded-xl bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white transition"
                onClick={() => {
                  if (previewingFile.url) URL.revokeObjectURL(previewingFile.url);
                  setPreviewingFile(null);
                }}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Modal Main Content Container */}
          <div
            className="flex-1 min-h-0 p-4 md:p-6 overflow-auto flex items-center justify-center bg-slate-950/60"
            onClick={(e) => e.stopPropagation()}
          >
            {previewingFile.file.content_type?.startsWith('image/') ||
            /\.(png|jpe?g|webp|gif|svg)$/i.test(previewingFile.file.original_filename) ? (
              <div className="relative max-h-full max-w-full overflow-auto rounded-2xl border border-slate-800 bg-slate-900/50 p-2 shadow-2xl">
                <img
                  src={previewingFile.url}
                  alt={previewingFile.file.original_filename}
                  className="max-h-[80vh] max-w-full object-contain rounded-xl mx-auto"
                />
              </div>
            ) : (
              <iframe
                src={previewingFile.url}
                title={previewingFile.file.original_filename}
                className="h-full w-full max-w-6xl rounded-2xl border border-slate-800 bg-white shadow-2xl"
              />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
