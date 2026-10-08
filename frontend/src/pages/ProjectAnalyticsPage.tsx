import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AnalyticsSkeleton } from '../components/Skeleton';
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  CircleDollarSign,
  Hammer,
  Layers3,
  Package,
  Receipt,
  Sparkles,
  TrendingUp,
  Wallet,
} from 'lucide-react';

import { DataTable } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { SectionCard } from '../components/SectionCard';
import { api } from '../services/api';
import type { ExpenseLog, LaborLog, MaterialLog, Payment, ProjectStatement } from '../types/api';
import { formatCurrency, formatDate, calculateMaterialTotal } from '../utils/format';

type PeriodMode = 'overall' | 'yearly' | 'monthly' | 'weekly' | 'daily';
type AnalyticsKind = 'material' | 'labour' | 'expense' | 'payment';

type AnalyticsEntry = {
  date: string;
  amount: number;
  quantity: number;
  kind: AnalyticsKind;
  label: string;
  category: string;
  note: string;
  unit?: string | null;
};

type BucketRow = {
  key: string;
  label: string;
  sortTime: number;
  materialsAmount: number;
  labourAmount: number;
  expenseAmount: number;
  receivedAmount: number;
  materialQuantity: number;
  labourCount: number;
  totalSpend: number;
  net: number;
};

type TopRow = {
  label: string;
  detail: string;
  amount: number;
  quantity: number;
};

const moneyPalette = ['#2563eb', '#06b6d4', '#f97316', '#f43f5e', '#8b5cf6'];
const categoryPalette = ['#f97316', '#06b6d4', '#8b5cf6', '#ec4899', '#22c55e', '#eab308', '#3b82f6', '#14b8a6'];

function safeDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfWeek(date: Date) {
  const clone = new Date(date);
  clone.setHours(0, 0, 0, 0);
  const offset = (clone.getDay() + 6) % 7;
  clone.setDate(clone.getDate() - offset);
  return clone;
}

function endOfWeek(date: Date) {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return end;
}

function formatCompactDate(date: Date) {
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatRangeLabel(start: Date, end: Date) {
  const sameYear = start.getFullYear() === end.getFullYear();
  if (sameYear) {
    const startPart = start.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    const endPart = end.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    return `${startPart} → ${endPart}`;
  }
  return `${formatCompactDate(start)} → ${formatCompactDate(end)}`;
}

function formatMonthLabel(date: Date) {
  return date.toLocaleDateString('en-IN', {
    month: 'short',
    year: 'numeric',
  });
}

function formatYearLabel(date: Date) {
  return date.getFullYear().toString();
}

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getOverallGranularity(days: number): Exclude<PeriodMode, 'overall'> {
  if (days <= 45) return 'daily';
  if (days <= 180) return 'weekly';
  if (days <= 730) return 'monthly';
  return 'yearly';
}

function getBucketInfo(date: Date, mode: Exclude<PeriodMode, 'overall'>) {
  if (mode === 'yearly') {
    return {
      key: `${date.getFullYear()}`,
      label: formatYearLabel(date),
      sortTime: new Date(date.getFullYear(), 0, 1).getTime(),
    };
  }

  if (mode === 'monthly') {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    return {
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
      label: formatMonthLabel(start),
      sortTime: start.getTime(),
    };
  }

  if (mode === 'weekly') {
    const start = startOfWeek(date);
    const end = endOfWeek(date);
    return {
      key: formatDateInput(start),
      label: formatRangeLabel(start, end),
      sortTime: start.getTime(),
    };
  }

  return {
    key: formatDateInput(date),
    label: formatCompactDate(date),
    sortTime: date.getTime(),
  };
}

function calcMaterialAmount(material: MaterialLog) {
  return calculateMaterialTotal(material);
}

function calcLaborAmount(labor: LaborLog) {
  if (labor.total_wage !== null && labor.total_wage !== undefined) {
    return Number(labor.total_wage || 0);
  }
  return Number(labor.labour_count || 0) * Number(labor.wage_per_head || 0) + Number(labor.overtime_cost || 0);
}

function calcExpenseAmount(expense: ExpenseLog) {
  return Number(expense.amount || 0);
}

function calcPaymentAmount(payment: Payment) {
  return Number(payment.amount || 0);
}

function createTopRows<T extends { label: string; detail: string; amount: number; quantity: number }>(rows: T[], limit = 8): T[] {
  return [...rows].sort((left, right) => right.amount - left.amount).slice(0, limit);
}

function metricCardTone(label: string) {
  const lower = label.toLowerCase();
  if (lower.includes('received') || lower.includes('net') || lower.includes('profit')) return 'text-emerald-800 bg-emerald-50 border-emerald-200';
  if (lower.includes('spend') || lower.includes('expense') || lower.includes('cost')) return 'text-rose-800 bg-rose-50 border-rose-200';
  if (lower.includes('labour')) return 'text-amber-800 bg-amber-50 border-amber-200';
  if (lower.includes('material')) return 'text-sky-800 bg-sky-50 border-sky-200';
  return 'text-violet-800 bg-violet-50 border-violet-200';
}

function buildBucketedRows(entries: AnalyticsEntry[], mode: Exclude<PeriodMode, 'overall'>) {
  const buckets = new Map<string, BucketRow>();

  for (const entry of entries) {
    const date = safeDate(entry.date);
    if (!date) continue;
    const bucket = getBucketInfo(date, mode);
    const current = buckets.get(bucket.key) ?? {
      key: bucket.key,
      label: bucket.label,
      sortTime: bucket.sortTime,
      materialsAmount: 0,
      labourAmount: 0,
      expenseAmount: 0,
      receivedAmount: 0,
      materialQuantity: 0,
      labourCount: 0,
      totalSpend: 0,
      net: 0,
    };

    if (entry.kind === 'material') {
      current.materialsAmount += entry.amount;
      current.materialQuantity += entry.quantity;
      current.totalSpend += entry.amount;
    }

    if (entry.kind === 'labour') {
      current.labourAmount += entry.amount;
      current.labourCount += entry.quantity;
      current.totalSpend += entry.amount;
    }

    if (entry.kind === 'expense') {
      current.expenseAmount += entry.amount;
      current.totalSpend += entry.amount;
    }

    if (entry.kind === 'payment') {
      current.receivedAmount += entry.amount;
    }

    current.net = current.receivedAmount - current.totalSpend;
    buckets.set(bucket.key, current);
  }

  return [...buckets.values()].sort((left, right) => left.sortTime - right.sortTime);
}

function aggregateTopRows(entries: AnalyticsEntry[]) {
  const rows = new Map<string, TopRow>();
  entries.forEach((entry) => {
    if (entry.kind === 'payment') return;
    const key = `${entry.kind}::${entry.label}::${entry.category}`;
    const current = rows.get(key) ?? {
      label: entry.label,
      detail: entry.category || entry.note || '-',
      amount: 0,
      quantity: 0,
    };
    current.amount += entry.amount;
    current.quantity += entry.quantity;
    rows.set(key, current);
  });
  return [...rows.values()];
}

function AnalyticsLoadingShell() {
  return <AnalyticsSkeleton />;
}

export function ProjectAnalyticsPage() {
  const { projectId } = useParams();
  const id = Number(projectId || 0);
  const hasValidId = id > 0 && !Number.isNaN(id);
  const [periodMode, setPeriodMode] = useState<PeriodMode>('overall');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [rangeSeeded, setRangeSeeded] = useState(false);

  const statementQuery = useQuery({
    queryKey: ['project-analytics-statement', id],
    queryFn: () => api.getProjectStatement(id),
    enabled: hasValidId,
  });
  const materialsQuery = useQuery({
    queryKey: ['project-analytics-materials', id],
    queryFn: () => api.getMaterials(id),
    enabled: hasValidId,
  });
  const expensesQuery = useQuery({
    queryKey: ['project-analytics-expenses', id],
    queryFn: () => api.getExpenses(id),
    enabled: hasValidId,
  });
  const siteExpensesQuery = useQuery({
    queryKey: ['project-analytics-site-expenses', id],
    queryFn: () => api.getSiteExpenses({ allocation: 'project', project_id: id }),
    enabled: hasValidId,
  });
  const labourQuery = useQuery({
    queryKey: ['project-analytics-labour', id],
    queryFn: () => api.getLaborLogs(id),
    enabled: hasValidId,
  });
  const paymentsQuery = useQuery({
    queryKey: ['project-analytics-payments', id],
    queryFn: () => api.getPayments(id),
    enabled: hasValidId,
  });

  const statement: ProjectStatement | undefined = statementQuery.data;
  const materials = materialsQuery.data ?? [];
  const expenses = expensesQuery.data ?? [];
  const siteExpenses = siteExpensesQuery.data ?? [];
  const labourLogs = labourQuery.data ?? [];
  const payments = paymentsQuery.data ?? [];
  const projectStartDate = statement?.project.start_date || formatDateInput(new Date());

  const materialEntries = materials.map<AnalyticsEntry>((material) => ({
    date: material.date,
    amount: calcMaterialAmount(material),
    quantity: Number(material.quantity || 0),
    kind: 'material',
    label: material.material_name,
    category: 'Materials',
    note: material.work_remarks || '',
    unit: material.unit,
  }));

  const labourEntries = labourLogs.map<AnalyticsEntry>((labor) => ({
    date: labor.date,
    amount: calcLaborAmount(labor),
    quantity: Number(labor.labour_count || 0),
    kind: 'labour',
    label: labor.labour_type,
    category: labor.labour_type,
    note: labor.remarks || '',
    unit: 'workers',
  }));

  const expenseEntries = [
    ...expenses.map<AnalyticsEntry>((expense) => ({
      date: expense.date,
      amount: calcExpenseAmount(expense),
      quantity: 1,
      kind: 'expense' as const,
      label: expense.category,
      category: expense.category,
      note: expense.description || '',
      unit: null,
    })),
    ...siteExpenses.map<AnalyticsEntry>((expense) => ({
      date: expense.date,
      amount: Number(expense.amount || 0),
      quantity: Number(expense.quantity || 1),
      kind: 'expense' as const,
      label: expense.item_name || expense.category,
      category: expense.category,
      note: expense.description || '',
      unit: null,
    })),
  ];

  const paymentEntries = payments.map<AnalyticsEntry>((payment) => ({
    date: payment.received_date || payment.due_date || projectStartDate,
    amount: calcPaymentAmount(payment),
    quantity: 1,
    kind: 'payment',
    label: payment.payment_type,
    category: payment.payment_mode || payment.payment_type,
    note: payment.notes || '',
    unit: null,
  }));

  const allEntries = [...materialEntries, ...labourEntries, ...expenseEntries, ...paymentEntries];
  const dateValues = allEntries.map((entry) => safeDate(entry.date)).filter((date): date is Date => Boolean(date));
  const rangeStart = safeDate(statement?.project.start_date) || dateValues[0] || new Date();
  const rangeEnd = dateValues.length ? new Date(Math.max(...dateValues.map((date) => date.getTime()))) : new Date();

  useEffect(() => {
    if (rangeSeeded || !statement) return;
    setDateFrom(formatDateInput(rangeStart));
    setDateTo(formatDateInput(rangeEnd));
    setRangeSeeded(true);
  }, [rangeEnd, rangeSeeded, rangeStart, statement]);

  const effectiveDateFrom = dateFrom || formatDateInput(rangeStart);
  const effectiveDateTo = dateTo || formatDateInput(rangeEnd);
  const normalizedDateFrom = effectiveDateFrom <= effectiveDateTo ? effectiveDateFrom : effectiveDateTo;
  const normalizedDateTo = effectiveDateFrom <= effectiveDateTo ? effectiveDateTo : effectiveDateFrom;
  const rangeFilteredEntries = allEntries.filter((entry) => {
    const entryDateKey = entry.date.slice(0, 10);
    return entryDateKey >= normalizedDateFrom && entryDateKey <= normalizedDateTo;
  });

  const selectedRangeStart = safeDate(normalizedDateFrom) || rangeStart;
  const selectedRangeEnd = safeDate(normalizedDateTo) || rangeEnd;
  const overallDays = Math.max(1, Math.ceil((selectedRangeEnd.getTime() - selectedRangeStart.getTime()) / 86_400_000) + 1);
  const smartMode = getOverallGranularity(overallDays);
  const effectiveMode = periodMode === 'overall' ? smartMode : periodMode;

  const bucketedRows = useMemo(() => buildBucketedRows(rangeFilteredEntries, effectiveMode), [effectiveMode, rangeFilteredEntries]);
  const bucketChartRows = bucketedRows.map((row) => ({
    label: row.label,
    materialsAmount: row.materialsAmount,
    labourAmount: row.labourAmount,
    expenseAmount: row.expenseAmount,
    receivedAmount: row.receivedAmount,
    materialQuantity: row.materialQuantity,
    labourCount: row.labourCount,
    totalSpend: row.totalSpend,
    net: row.net,
  }));

  const filteredMaterialEntries = rangeFilteredEntries.filter((entry) => entry.kind === 'material');
  const filteredLabourEntries = rangeFilteredEntries.filter((entry) => entry.kind === 'labour');
  const filteredExpenseEntries = rangeFilteredEntries.filter((entry) => entry.kind === 'expense');
  const filteredPaymentEntries = rangeFilteredEntries.filter((entry) => entry.kind === 'payment');

  const totalMaterials = filteredMaterialEntries.reduce((sum, entry) => sum + entry.amount, 0);
  const totalLabour = filteredLabourEntries.reduce((sum, entry) => sum + entry.amount, 0);
  const totalExpenses = filteredExpenseEntries.reduce((sum, entry) => sum + entry.amount, 0);
  const totalSpend = totalMaterials + totalLabour + totalExpenses;
  const totalReceived = filteredPaymentEntries.reduce((sum, entry) => sum + entry.amount, 0);
  const netPosition = totalReceived - totalSpend;
  const averageSpend = bucketedRows.length ? totalSpend / bucketedRows.length : totalSpend;
  const labourCountTotal = filteredLabourEntries.reduce((sum, entry) => sum + entry.quantity, 0);
  const materialQuantityTotal = filteredMaterialEntries.reduce((sum, entry) => sum + entry.quantity, 0);

  const costSplitData = [
    { name: 'Materials', value: totalMaterials },
    { name: 'Labour', value: totalLabour },
    { name: 'Expenses', value: totalExpenses },
  ].filter((item) => item.value > 0);

  const expenseCategoryMap = new Map<string, TopRow>();
  filteredExpenseEntries.forEach((entry) => {
    const key = entry.label || 'Expense';
    const current = expenseCategoryMap.get(key) ?? {
      label: key,
      detail: entry.note || 'Expense category',
      amount: 0,
      quantity: 0,
    };
    current.amount += entry.amount;
    current.quantity += 1;
    expenseCategoryMap.set(key, current);
  });

  const materialTopRows = createTopRows(aggregateTopRows(filteredMaterialEntries));
  const labourTopRows = createTopRows(aggregateTopRows(filteredLabourEntries));
  const expenseTopRows = createTopRows([...expenseCategoryMap.values()].map((row) => ({ ...row })));

  const timelineRows = [...rangeFilteredEntries]
    .filter((entry) => entry.kind !== 'payment')
    .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
    .slice(0, 15)
    .map((entry) => ({
      kind: entry.kind,
      date: entry.date,
      title: entry.label,
      detail: entry.note || entry.category,
      amount: entry.amount,
    }));

  if (!hasValidId) {
    return <Navigate to="/projects" replace />;
  }

  if (statementQuery.isLoading || materialsQuery.isLoading || expensesQuery.isLoading || siteExpensesQuery.isLoading || labourQuery.isLoading || paymentsQuery.isLoading) {
    return <AnalyticsLoadingShell />;
  }

  if (statementQuery.isError || !statement) {
    return (
      <div className="space-y-4">
        <div className="rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-lg font-semibold text-graphite">Project analytics not available.</p>
          <p className="mt-2 text-slate-600">We couldn’t load the selected project. Please go back and try again.</p>
          <Link to="/projects" className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-graphite px-4 py-3 text-sm font-semibold text-white">
            <ArrowLeft className="h-4 w-4" />
            Back to Projects
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-6 pb-4">
      <section className="app-hero relative overflow-hidden rounded-[32px] border border-white/70 px-5 py-5 shadow-panel sm:px-7 sm:py-6">
        <div className="absolute inset-y-0 right-0 w-1/3 bg-[radial-gradient(circle_at_top,rgb(var(--pal-clay)_/_0.18),transparent_72%)]" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-3xl bg-clay text-[color:var(--on-accent)] shadow-lg">
              <BarChart3 className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/90 px-4 py-1.5 text-sm font-semibold text-navy shadow-sm">
                <Sparkles className="h-4 w-4" />
                Project Analytics
              </div>
              <h1 className="mt-3 font-display text-4xl leading-tight text-graphite sm:text-5xl">{statement.project.project_name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-3 py-1.5 font-semibold">
                  <CalendarDays className="h-4 w-4" />
                  {statement.project.location}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-3 py-1.5 font-semibold">
                  <CalendarDays className="h-4 w-4" />
                  {formatDate(statement.project.start_date)}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-3 py-1.5 font-semibold">
                  <TrendingUp className="h-4 w-4" />
                  {statement.project.status}
                </span>
              </div>
              <p className="mt-3 max-w-3xl text-sm text-slate-600 sm:text-base">
                Track material usage, labour activity, and money spend across the project lifecycle with a single project-wide analytics workspace.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/projects?projectId=${statement.project.id}`}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/70 bg-white/88 px-4 py-3 text-sm font-semibold text-navy shadow-sm transition hover:bg-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Project
            </Link>
            <Link
              to={`/projects/${statement.project.id}/statement-document`}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/70 bg-white/88 px-4 py-3 text-sm font-semibold text-navy shadow-sm transition hover:bg-white"
            >
              <Receipt className="h-4 w-4" />
              Statement
            </Link>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-white/70 bg-white/80 p-4 shadow-[0_20px_60px_rgba(44,52,74,0.08)] backdrop-blur-sm sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Time View</p>
            <p className="text-sm text-slate-600">
              Overall analytics adapt automatically to the project length. You can still switch between yearly, monthly, weekly, and daily views anytime, and narrow the window with a custom from/to range.
            </p>
          </div>
          <div className="flex flex-col gap-3 xl:items-end">
            <div className="flex flex-wrap gap-2 rounded-[24px] border border-slate-200 bg-white px-2 py-2 shadow-sm">
              {(['overall', 'yearly', 'monthly', 'weekly', 'daily'] as PeriodMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`rounded-full px-4 py-2 text-sm font-semibold capitalize transition ${
                    periodMode === mode ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                  onClick={() => setPeriodMode(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
            <div className="grid gap-3 rounded-[24px] border border-sky-100 bg-sky-50/70 p-3 shadow-sm sm:grid-cols-[1fr_1fr_auto]">
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">From</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                  className="w-full rounded-2xl border border-sky-200 bg-white px-3 py-2.5 text-sm shadow-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">To</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  className="w-full rounded-2xl border border-sky-200 bg-white px-3 py-2.5 text-sm shadow-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  className="inline-flex h-[46px] items-center justify-center rounded-2xl bg-sky-500 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-600"
                  onClick={() => {
                    setDateFrom(formatDateInput(rangeStart));
                    setDateTo(formatDateInput(rangeEnd));
                  }}
                >
                  Project span
                </button>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-3 py-1.5 text-xs font-semibold text-sky-700">
            <Layers3 className="h-3.5 w-3.5" />
            Range: {formatCompactDate(selectedRangeStart)} → {formatCompactDate(selectedRangeEnd)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-3 py-1.5 text-xs font-semibold text-violet-700">
            <CalendarDays className="h-3.5 w-3.5" />
            View: {periodMode === 'overall' ? `Smart ${smartMode}` : periodMode}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800">
            <Wallet className="h-3.5 w-3.5" />
            Buckets: {bucketedRows.length}
          </span>
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        {[
          { label: 'Total Spend', value: totalSpend },
          { label: 'Materials', value: totalMaterials },
          { label: 'Labour', value: totalLabour },
          { label: 'Other Expenses', value: totalExpenses },
          { label: 'Received', value: totalReceived },
          { label: 'Net Position', value: netPosition },
        ].map((card) => (
          <div key={card.label} className={`rounded-[22px] border px-4 py-4 shadow-sm ${metricCardTone(card.label)}`}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{card.label}</p>
            <p className="mt-2 text-2xl font-black tracking-tight">{formatCurrency(card.value)}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.5fr_0.9fr]">
        <SectionCard
          title="Cashflow & Spend Mix"
          action={<span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">Materials + Labour + Expenses vs Received</span>}
        >
          {bucketChartRows.length ? (
            <div className="h-[min(26rem,70dvh)] min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={bucketChartRows}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis />
                  <Tooltip formatter={(value: number) => formatCurrency(Number(value || 0))} />
                  <Legend />
                  <Bar dataKey="materialsAmount" stackId="spend" name="Materials" fill={moneyPalette[0]} radius={[6, 6, 0, 0]} />
                  <Bar dataKey="labourAmount" stackId="spend" name="Labour" fill={moneyPalette[1]} radius={[6, 6, 0, 0]} />
                  <Bar dataKey="expenseAmount" stackId="spend" name="Expenses" fill={moneyPalette[2]} radius={[6, 6, 0, 0]} />
                  <Line type="monotone" dataKey="receivedAmount" name="Received" stroke={moneyPalette[3]} strokeWidth={3} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="py-6">
              <EmptyState title="No cashflow entries yet" subtitle="Add materials, labour, expenses, or payments to start building the project trend." />
            </div>
          )}
        </SectionCard>

        <SectionCard title="Cost Composition" action={<span className="rounded-full bg-fuchsia-100 px-3 py-1 text-xs font-semibold text-fuchsia-700">Spend share</span>}>
          {costSplitData.length ? (
            <div className="grid gap-4">
              <div className="h-[min(16.25rem,55dvh)] min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={costSplitData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={92} innerRadius={52} paddingAngle={3} label>
                      {costSplitData.map((entry, index) => (
                        <Cell key={entry.name} fill={moneyPalette[index % moneyPalette.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => formatCurrency(Number(value || 0))} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="grid gap-2">
                {costSplitData.map((entry, index) => {
                  const percentage = totalSpend > 0 ? (entry.value / totalSpend) * 100 : 0;
                  return (
                    <div key={entry.name} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-white px-3 py-2.5 shadow-sm">
                      <span className="flex items-center gap-2 font-semibold text-slate-700">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: moneyPalette[index % moneyPalette.length] }} />
                        {entry.name}
                      </span>
                      <span className="text-sm font-bold text-graphite">
                        {formatCurrency(entry.value)} <span className="text-slate-500">({percentage.toFixed(1)}%)</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <EmptyState title="No spend data" subtitle="The cost composition will appear once project entries are added." />
          )}
        </SectionCard>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.45fr_0.95fr]">
        <SectionCard
          title="Material Usage"
          action={<span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">Spend and quantity over time</span>}
        >
          {bucketChartRows.length ? (
            <div className="h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={bucketChartRows}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis yAxisId="left" />
                  <YAxis yAxisId="right" orientation="right" />
                  <Tooltip formatter={(value: number) => formatCurrency(Number(value || 0))} />
                  <Legend />
                  <Bar yAxisId="left" dataKey="materialsAmount" name="Material spend" fill={moneyPalette[0]} radius={[8, 8, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="materialQuantity" name="Quantity" stroke={moneyPalette[4]} strokeWidth={3} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="No material entries" subtitle="Material analytics will appear once project materials are added." />
          )}
        </SectionCard>

        <SectionCard title="Top Materials" action={<span className="rounded-full bg-cyan-100 px-3 py-1 text-xs font-semibold text-cyan-700">By spend</span>}>
          {materialTopRows.length ? (
            <div className="h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={materialTopRows} layout="vertical" margin={{ left: 8, right: 24, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tickFormatter={(value: number) => formatCurrency(value)} />
                  <YAxis type="category" dataKey="label" width={120} />
                  <Tooltip formatter={(value: number) => formatCurrency(Number(value || 0))} />
                  <Bar dataKey="amount" fill={moneyPalette[0]} radius={[0, 12, 12, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="No material breakdown" subtitle="Top material usage will show here after a few entries are recorded." />
          )}
        </SectionCard>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.45fr_0.95fr]">
        <SectionCard
          title="Labour Usage"
          action={<span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">Headcount and wage over time</span>}
        >
          {bucketChartRows.length ? (
            <div className="h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={bucketChartRows}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis yAxisId="left" />
                  <YAxis yAxisId="right" orientation="right" />
                  <Tooltip formatter={(value: number) => formatCurrency(Number(value || 0))} />
                  <Legend />
                  <Bar yAxisId="left" dataKey="labourCount" name="Labour count" fill={moneyPalette[1]} radius={[8, 8, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="labourAmount" name="Labour cost" stroke={moneyPalette[2]} strokeWidth={3} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="No labour entries" subtitle="Labour analytics will appear once project work logs are added." />
          )}
        </SectionCard>

        <SectionCard title="Top Labour Groups" action={<span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-700">By wage</span>}>
          {labourTopRows.length ? (
            <div className="h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={labourTopRows} layout="vertical" margin={{ left: 8, right: 24, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tickFormatter={(value: number) => formatCurrency(value)} />
                  <YAxis type="category" dataKey="label" width={120} />
                  <Tooltip formatter={(value: number) => formatCurrency(Number(value || 0))} />
                  <Bar dataKey="amount" fill={moneyPalette[1]} radius={[0, 12, 12, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="No labour breakdown" subtitle="Top labour groups will appear once work logs are added." />
          )}
        </SectionCard>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.45fr_0.95fr]">
        <SectionCard
          title="Other Expenses"
          action={<span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700">Category spend over time</span>}
        >
          {bucketChartRows.length ? (
            <div className="h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={bucketChartRows}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis />
                  <Tooltip formatter={(value: number) => formatCurrency(Number(value || 0))} />
                  <Legend />
                  <Area type="monotone" dataKey="expenseAmount" name="Expenses" stroke={moneyPalette[3]} fill="rgba(185,28,28,0.12)" strokeWidth={3} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="No expenses recorded" subtitle="Expense analytics will appear once project expenses are added." />
          )}
        </SectionCard>

        <SectionCard title="Expense Categories" action={<span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700">Spend share</span>}>
          {expenseTopRows.length ? (
            <div className="grid gap-4">
              <div className="h-[min(16.25rem,55dvh)] min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={expenseTopRows} dataKey="amount" nameKey="label" cx="50%" cy="50%" outerRadius={92} innerRadius={52} paddingAngle={3} label>
                      {expenseTopRows.map((entry, index) => (
                        <Cell key={entry.label} fill={categoryPalette[index % categoryPalette.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => formatCurrency(Number(value || 0))} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="grid gap-2">
                {expenseTopRows.map((row, index) => {
                  const share = totalExpenses > 0 ? (row.amount / totalExpenses) * 100 : 0;
                  return (
                    <div key={row.label} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-white px-3 py-2.5 shadow-sm">
                      <span className="flex items-center gap-2 font-semibold text-slate-700">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: categoryPalette[index % categoryPalette.length] }} />
                        {row.label}
                      </span>
                      <span className="text-sm font-bold text-graphite">
                        {formatCurrency(row.amount)} <span className="text-slate-500">({share.toFixed(1)}%)</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <EmptyState title="No expense categories" subtitle="Expense category breakdown will appear after entries are created." />
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Recent Activity"
        action={
          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500">
            Total spend {formatCurrency(totalSpend)} • Received {formatCurrency(totalReceived)}
          </span>
        }
      >
        {timelineRows.length ? (
          <DataTable
            printTitle={`Recent Activity - ${statement.project.project_name}`}
            printMetadata={{
              Project: statement.project.project_name,
              Location: statement.project.location,
              'Date Range': `${formatDate(rangeStart.toISOString())} - ${formatDate(rangeEnd.toISOString())}`,
              'Total Spend': formatCurrency(totalSpend),
              Received: formatCurrency(totalReceived),
            }}
            headers={['Date', 'Type', 'Title', 'Detail', 'Amount']}
            rows={timelineRows.map((row) => [
              formatDate(row.date),
              <span
                key={`${row.kind}-${row.date}`}
                className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${
                  row.kind === 'material'
                    ? 'bg-blue-50 text-blue-700'
                    : row.kind === 'labour'
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-rose-50 text-rose-700'
                }`}
              >
                {row.kind}
              </span>,
              row.title,
              <span key={`${row.title}-${row.date}`} className="line-clamp-2 max-w-[360px] text-slate-600">
                {row.detail || '-'}
              </span>,
              <span key={`amount-${row.title}-${row.date}`} className="font-semibold text-graphite">
                {formatCurrency(row.amount)}
              </span>,
            ])}
            maxBodyHeightClass="max-h-[420px]"
            ariaLabel="Project analytics recent activity"
          />
        ) : (
          <EmptyState title="No activity to show" subtitle="Once the project gets materials, labour, or expenses, the latest activity will appear here." />
        )}
      </SectionCard>
    </div>
  );
}
