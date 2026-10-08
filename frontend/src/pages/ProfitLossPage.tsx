import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Calculator,
  CircleDollarSign,
  IndianRupee,
  Percent,
  Save,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AnalyticsSkeleton } from '../components/Skeleton';

import { DataTable } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { SectionCard } from '../components/SectionCard';
import { useNotify } from '../contexts/NotificationContext';
import { api } from '../services/api';
import type { ExpenseLog, LaborLog, MaterialLog, Project } from '../types/api';
import { getApiErrorMessage } from '../utils/errors';
import { formatCurrency, calculateMaterialTotal } from '../utils/format';
import { useChartTheme } from '../utils/chartTheme';

const DEFAULT_RATE_PER_SQFT = 4500;

function numberFieldValue(value: number) {
  return value === 0 ? '' : String(value);
}

function parseNumberInput(value: string) {
  if (value.trim() === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

function pct(value: number) {
  return `${value.toFixed(1)}%`;
}

type EditingBudget = {
  projectId: number;
  construction_sqft: number;
  construction_rate_per_sqft: number;
};

type FinancialStatus = 'Setup needed' | 'Loss' | 'Break-even' | 'Profit' | 'Strong';

type ProfitLossRow = {
  project: Project;
  materialCost: number;
  labourCost: number;
  otherExpenseCost: number;
  expensesIncurred: number;
  sqft: number;
  rate: number;
  totalProjectBudget: number;
  remainingBudget: number;
  clientPaymentsReceived: number;
  actualNetProfit: number;
  profitMarginPct: number;
  financialStatus: FinancialStatus;
  costPerSqft: number;
  remainingPerSqft: number;
  budgetUsedPct: number;
};

function financialStatusClasses(status: FinancialStatus) {
  if (status === 'Strong' || status === 'Profit') return 'bg-emerald-100 text-emerald-800';
  if (status === 'Break-even') return 'bg-sky-100 text-sky-800';
  if (status === 'Setup needed') return 'bg-slate-100 text-slate-700';
  return 'bg-red-100 text-red-800';
}

function resolveFinancialStatus(budget: number, actualNetProfit: number, marginPct: number): FinancialStatus {
  if (budget <= 0) return 'Setup needed';
  if (actualNetProfit < 0) return 'Loss';
  if (actualNetProfit === 0) return 'Break-even';
  if (marginPct >= 15) return 'Strong';
  return 'Profit';
}

export function ProfitLossPage() {
  const notify = useNotify();
  const chartTheme = useChartTheme();
  const queryClient = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [editingBudget, setEditingBudget] = useState<EditingBudget | null>(null);

  const { data: projects = [], isLoading } = useQuery({ queryKey: ['projects'], queryFn: api.getProjects });
  const { data: materials = [] } = useQuery({ queryKey: ['materials'], queryFn: () => api.getMaterials() });
  const { data: expenses = [] } = useQuery({ queryKey: ['expenses'], queryFn: () => api.getExpenses() });
  const { data: siteExpenses = [] } = useQuery({ queryKey: ['site-expenses'], queryFn: () => api.getSiteExpenses() });
  const { data: laborLogs = [] } = useQuery({ queryKey: ['labor-logs-all'], queryFn: () => api.getLaborLogs() });
  const { data: clientPayments = [] } = useQuery({
    queryKey: ['client-payments'],
    queryFn: () => api.getJVShareholderPayments(),
  });

  const updateProjectMutation = useMutation({
    mutationFn: ({ project, sqft, rate }: { project: Project; sqft: number; rate: number }) =>
      api.updateProject(project.id, {
        client_id: project.client_id,
        project_name: project.project_name,
        location: project.location,
        start_date: project.start_date,
        expected_end_date: project.expected_end_date || null,
        estimated_cost: Number((sqft * (rate || DEFAULT_RATE_PER_SQFT)).toFixed(2)),
        construction_sqft: sqft,
        construction_rate_per_sqft: rate || DEFAULT_RATE_PER_SQFT,
        status: project.status,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setEditingBudget(null);
      notify.success('P & L budget updated.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to update P & L budget.')),
  });

  const rows = useMemo<ProfitLossRow[]>(() => {
    return projects.map((project) => {
      const projectMaterials = materials.filter((item) => item.project_id === project.id);
      const projectExpenses = expenses.filter((item) => item.project_id === project.id);
      const projectLabour = laborLogs.filter((item) => item.project_id === project.id);
      const projectClientPayments = clientPayments.filter((item) => item.project_id === project.id);

      const materialCost = projectMaterials.reduce((sum, item) => sum + calcMaterialAmount(item), 0);
      const labourCost = projectLabour.reduce((sum, item) => sum + calcLaborAmount(item), 0);
      const projectSiteExpenseCost = siteExpenses
        .filter((item) => item.allocation === 'project' && item.project_id === project.id)
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const otherExpenseCost = projectExpenses.reduce((sum, item) => sum + calcExpenseAmount(item), 0) + projectSiteExpenseCost;
      const expensesIncurred = materialCost + labourCost + otherExpenseCost;
      const sqft = Number(project.construction_sqft || 0);
      const rate = Number(project.construction_rate_per_sqft || DEFAULT_RATE_PER_SQFT);
      const totalProjectBudget = Number((sqft * rate).toFixed(2));
      const remainingBudget = Number((totalProjectBudget - expensesIncurred).toFixed(2));
      const clientPaymentsReceived = projectClientPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
      const actualNetProfit = Number((clientPaymentsReceived - expensesIncurred).toFixed(2));
      const profitMarginPct = totalProjectBudget > 0 ? (actualNetProfit / totalProjectBudget) * 100 : 0;
      const costPerSqft = sqft > 0 ? expensesIncurred / sqft : 0;
      const remainingPerSqft = sqft > 0 ? remainingBudget / sqft : 0;
      const budgetUsedPct = totalProjectBudget > 0 ? (expensesIncurred / totalProjectBudget) * 100 : 0;
      const financialStatus = resolveFinancialStatus(totalProjectBudget, actualNetProfit, profitMarginPct);

      return {
        project,
        materialCost,
        labourCost,
        otherExpenseCost,
        expensesIncurred,
        sqft,
        rate,
        totalProjectBudget,
        remainingBudget,
        clientPaymentsReceived,
        actualNetProfit,
        profitMarginPct,
        financialStatus,
        costPerSqft,
        remainingPerSqft,
        budgetUsedPct,
      };
    });
  }, [clientPayments, expenses, laborLogs, materials, projects, siteExpenses]);

  const selectedRowIndex = rows.findIndex((row) => row.project.id === selectedProjectId);
  const selectedRow = selectedRowIndex >= 0 ? rows[selectedRowIndex] : null;

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.budget += row.totalProjectBudget;
        acc.expenses += row.expensesIncurred;
        acc.remainingBudget += row.remainingBudget;
        acc.clientPayments += row.clientPaymentsReceived;
        acc.actualNetProfit += row.actualNetProfit;
        acc.sqft += row.sqft;
        return acc;
      },
      { budget: 0, expenses: 0, remainingBudget: 0, clientPayments: 0, actualNetProfit: 0, sqft: 0 },
    );
  }, [rows]);

  const portfolioCostPerSqft = totals.sqft > 0 ? totals.expenses / totals.sqft : 0;
  const portfolioRatePerSqft = totals.sqft > 0 ? totals.budget / totals.sqft : DEFAULT_RATE_PER_SQFT;
  const portfolioMargin = totals.budget > 0 ? (totals.actualNetProfit / totals.budget) * 100 : 0;

  const metricCards = [
    { label: 'Total Project Budget', value: formatCurrency(totals.budget), icon: CircleDollarSign, tone: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
    { label: 'Expenses Incurred', value: formatCurrency(totals.expenses), icon: Calculator, tone: 'border-rose-200 bg-rose-50 text-rose-800' },
    { label: 'Remaining Budget', value: formatCurrency(totals.remainingBudget), icon: Wallet, tone: totals.remainingBudget >= 0 ? 'border-indigo-200 bg-indigo-50 text-indigo-800' : 'border-red-200 bg-red-50 text-red-800' },
    { label: 'Actual Net Profit', value: formatCurrency(totals.actualNetProfit), icon: TrendingUp, tone: totals.actualNetProfit >= 0 ? 'border-sky-200 bg-sky-50 text-sky-800' : 'border-red-200 bg-red-50 text-red-800' },
  ];

  const detailChartRows = selectedRow
    ? [
        { name: 'Materials', amount: Math.round(selectedRow.materialCost) },
        { name: 'Labour', amount: Math.round(selectedRow.labourCost) },
        { name: 'Expenses', amount: Math.round(selectedRow.otherExpenseCost) },
      ]
    : [];

  function beginBudgetEdit(row: ProfitLossRow) {
    setEditingBudget({
      projectId: row.project.id,
      construction_sqft: row.sqft,
      construction_rate_per_sqft: row.rate || DEFAULT_RATE_PER_SQFT,
    });
  }

  if (isLoading) {
    return <AnalyticsSkeleton />;
  }

  return (
    <div className="min-w-0 space-y-5">
      <div className="rounded-[28px] border border-white/70 bg-white/90 p-5 shadow-panel">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-clay">Reports · Financial Statements</p>
            <h1 className="mt-1 font-display text-3xl text-graphite">Profit & Loss Statement (P&L)</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Revenue recognized, cost of goods & services, operational overheads, and net profit margins across cost centers.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-right">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Default rate / sqft</p>
            <p className="text-2xl font-black text-slate-900">{formatCurrency(DEFAULT_RATE_PER_SQFT)}</p>
            <p className="text-xs text-slate-500">Portfolio avg: {formatCurrency(portfolioRatePerSqft)}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {metricCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className={`rounded-2xl border p-4 shadow-sm ${card.tone}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{card.label}</p>
                <Icon className="h-5 w-5" />
              </div>
              <p className="mt-2 text-3xl font-black tracking-tight">{card.value}</p>
            </div>
          );
        })}
      </div>

      <SectionCard title="Project Budget Breakdown">
        {rows.length ? (
          <DataTable
            size="roomy"
            selectableRows
            selectedRowIndex={selectedRowIndex >= 0 ? selectedRowIndex : null}
            onSelectedRowIndexChange={(index) => {
              setSelectedProjectId(rows[index]?.project.id ?? null);
              setEditingBudget(null);
            }}
            maxBodyHeightClass="max-h-[560px]"
            ariaLabel="Project budget breakdown"
            printTitle="P & L - Project Budget Breakdown"
            printMetadata={{
              Module: 'Profit and Loss',
              Projects: rows.length,
              'Portfolio Budget': formatCurrency(totals.budget),
              'Expenses Incurred': formatCurrency(totals.expenses),
              'Remaining Budget': formatCurrency(totals.remainingBudget),
            }}
            headers={['Project', 'Sqft', 'Rate', 'Budget', 'Expenses Incurred', 'Cost / Sqft', 'Remaining / Sqft', 'Remaining Budget', 'Margin', 'Status']}
            rows={rows.map((row) => [
              <div>
                <p className="font-bold text-slate-900">{row.project.project_name}</p>
                <p className="text-sm text-slate-500">{row.project.location}</p>
              </div>,
              <span className="font-semibold">{row.sqft.toLocaleString('en-IN')}</span>,
              <span className="font-semibold">{formatCurrency(row.rate)}</span>,
              <span className="font-bold text-emerald-800">{formatCurrency(row.totalProjectBudget)}</span>,
              <span className="font-bold text-rose-800">{formatCurrency(row.expensesIncurred)}</span>,
              <span className="font-bold text-slate-900">{formatCurrency(row.costPerSqft)}</span>,
              <span className={`font-bold ${row.remainingBudget >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                {formatCurrency(row.remainingPerSqft)}
              </span>,
              <span className={`font-bold ${row.remainingBudget >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                {formatCurrency(row.remainingBudget)}
              </span>,
              <span className={`font-bold ${row.profitMarginPct >= 0 ? 'text-indigo-700' : 'text-red-700'}`}>{pct(row.profitMarginPct)}</span>,
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${financialStatusClasses(row.financialStatus)}`}>
                {row.financialStatus === 'Loss' || row.financialStatus === 'Setup needed' ? <AlertTriangle className="h-3.5 w-3.5" /> : null}
                {row.financialStatus}
              </span>,
            ])}
            footerRows={[[
              <span className="font-black">Portfolio Total</span>,
              <span className="font-black">{totals.sqft.toLocaleString('en-IN')}</span>,
              <span className="font-black">{formatCurrency(portfolioRatePerSqft)}</span>,
              <span className="font-black text-emerald-800">{formatCurrency(totals.budget)}</span>,
              <span className="font-black text-rose-800">{formatCurrency(totals.expenses)}</span>,
              <span className="font-black">{formatCurrency(portfolioCostPerSqft)}</span>,
              <span className={`font-black ${totals.remainingBudget >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                {formatCurrency(totals.sqft > 0 ? totals.remainingBudget / totals.sqft : 0)}
              </span>,
              <span className={`font-black ${totals.remainingBudget >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatCurrency(totals.remainingBudget)}</span>,
              <span className="font-black text-indigo-700">{pct(portfolioMargin)}</span>,
              '',
            ]]}
          />
        ) : (
          <EmptyState title="No projects yet" subtitle="Create a project to start tracking P & L." />
        )}
      </SectionCard>

      <SectionCard title="Project Actual Profit Analysis">
        {rows.length ? (
          <DataTable
            size="roomy"
            selectableRows
            selectedRowIndex={selectedRowIndex >= 0 ? selectedRowIndex : null}
            onSelectedRowIndexChange={(index) => {
              setSelectedProjectId(rows[index]?.project.id ?? null);
              setEditingBudget(null);
            }}
            maxBodyHeightClass="max-h-[560px]"
            ariaLabel="Project actual profit analysis"
            printTitle="P & L - Project Actual Profit Analysis"
            printMetadata={{
              Module: 'Actual Profit Analysis',
              Projects: rows.length,
              'Client Payments': formatCurrency(totals.clientPayments),
              'Actual Net Profit': formatCurrency(totals.actualNetProfit),
              'Profit Margin': pct(portfolioMargin),
            }}
            headers={[
              'Project Name',
              'Total Project Budget',
              'Expenses Incurred',
              'Remaining Budget',
              'Client Payments Received',
              'Actual Net Profit',
              'Profit Margin %',
              'Financial Status',
            ]}
            rows={rows.map((row) => [
              <div>
                <p className="font-bold text-slate-900">{row.project.project_name}</p>
                <p className="text-sm text-slate-500">{row.project.location}</p>
              </div>,
              <span className="font-bold text-emerald-800">{formatCurrency(row.totalProjectBudget)}</span>,
              <span className="font-bold text-rose-800">{formatCurrency(row.expensesIncurred)}</span>,
              <span className={`font-bold ${row.remainingBudget >= 0 ? 'text-indigo-700' : 'text-red-700'}`}>
                {formatCurrency(row.remainingBudget)}
              </span>,
              <span className="font-bold text-sky-800">{formatCurrency(row.clientPaymentsReceived)}</span>,
              <span className={`font-black ${row.actualNetProfit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                {formatCurrency(row.actualNetProfit)}
              </span>,
              <span className={`font-bold ${row.profitMarginPct >= 0 ? 'text-indigo-700' : 'text-red-700'}`}>{pct(row.profitMarginPct)}</span>,
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${financialStatusClasses(row.financialStatus)}`}>
                {row.financialStatus === 'Loss' || row.financialStatus === 'Setup needed' ? <AlertTriangle className="h-3.5 w-3.5" /> : null}
                {row.financialStatus}
              </span>,
            ])}
            footerRows={[[
              <span className="font-black">Portfolio Total</span>,
              <span className="font-black text-emerald-800">{formatCurrency(totals.budget)}</span>,
              <span className="font-black text-rose-800">{formatCurrency(totals.expenses)}</span>,
              <span className={`font-black ${totals.remainingBudget >= 0 ? 'text-indigo-700' : 'text-red-700'}`}>{formatCurrency(totals.remainingBudget)}</span>,
              <span className="font-black text-sky-800">{formatCurrency(totals.clientPayments)}</span>,
              <span className={`font-black ${totals.actualNetProfit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatCurrency(totals.actualNetProfit)}</span>,
              <span className="font-black text-indigo-700">{pct(portfolioMargin)}</span>,
              '',
            ]]}
          />
        ) : (
          <EmptyState title="No projects yet" subtitle="Create a project to analyze actual profit." />
        )}
      </SectionCard>

      {selectedRow ? (
        <SectionCard title={`${selectedRow.project.project_name} Details`}>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {[
                  ['Total Project Budget', formatCurrency(selectedRow.totalProjectBudget)],
                  ['Expenses Incurred', formatCurrency(selectedRow.expensesIncurred)],
                  ['Remaining Budget', formatCurrency(selectedRow.remainingBudget)],
                  ['Client Payments', formatCurrency(selectedRow.clientPaymentsReceived)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{label}</p>
                    <p className="mt-2 text-2xl font-black text-slate-900">{value}</p>
                  </div>
                ))}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-bold text-slate-900">Cost Split</h3>
                    <IndianRupee className="h-5 w-5 text-slate-400" />
                  </div>
                  <div className="h-72 min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={detailChartRows}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis />
                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                        <Bar dataKey="amount" name="Cost" fill={chartTheme.accent} radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-4">
                  <h3 className="font-bold text-slate-900">P & L Breakdown</h3>
                  <div className="mt-4 space-y-3 text-sm">
                    {[
                      ['Material cost', selectedRow.materialCost],
                      ['Labour cost', selectedRow.labourCost],
                      ['Other expenses', selectedRow.otherExpenseCost],
                      ['Remaining budget', selectedRow.remainingBudget],
                      ['Client payments received', selectedRow.clientPaymentsReceived],
                      ['Actual net profit', selectedRow.actualNetProfit],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2 last:border-0">
                        <span className="font-semibold text-slate-600">{label}</span>
                        <span className="font-black text-slate-900">{formatCurrency(Number(value))}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between gap-3 pt-1">
                      <span className="font-semibold text-slate-600">Profit margin %</span>
                      <span className="font-black text-slate-900">{pct(selectedRow.profitMarginPct)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold text-slate-600">Financial status</span>
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-bold ${financialStatusClasses(selectedRow.financialStatus)}`}>
                        {selectedRow.financialStatus}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="font-bold text-slate-900">Project Rate Setup</h3>
              {editingBudget?.projectId === selectedRow.project.id ? (
                <div className="mt-4 space-y-3">
                  <label className="block text-sm font-semibold text-slate-600">
                    Total Area (Sq Ft)
                    <input
                      className="mt-1"
                      type="number"
                      min="0"
                      step="0.01"
                      value={numberFieldValue(editingBudget.construction_sqft)}
                      onChange={(event) => setEditingBudget((current) => current ? { ...current, construction_sqft: parseNumberInput(event.target.value) } : current)}
                    />
                  </label>
                  <label className="block text-sm font-semibold text-slate-600">
                    Project Rate per Sq Ft
                    <input
                      className="mt-1"
                      type="number"
                      min="0"
                      step="0.01"
                      value={numberFieldValue(editingBudget.construction_rate_per_sqft)}
                      onChange={(event) => setEditingBudget((current) => current ? { ...current, construction_rate_per_sqft: parseNumberInput(event.target.value) } : current)}
                    />
                  </label>
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3">
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Total Project Budget</p>
                    <p className="mt-1 text-xl font-black text-emerald-900">
                      {formatCurrency(Number(editingBudget.construction_sqft || 0) * Number(editingBudget.construction_rate_per_sqft || 0))}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="inline-flex items-center gap-1 rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white"
                      onClick={() => {
                        updateProjectMutation.mutate({
                          project: selectedRow.project,
                          sqft: editingBudget.construction_sqft,
                          rate: editingBudget.construction_rate_per_sqft || DEFAULT_RATE_PER_SQFT,
                        });
                      }}
                    >
                      <Save className="h-4 w-4" />
                      Save
                    </button>
                    <button className="rounded bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700" onClick={() => setEditingBudget(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Total Area</p>
                    <p className="text-2xl font-black">{selectedRow.sqft.toLocaleString('en-IN')}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Project Rate / Sq Ft</p>
                    <p className="text-2xl font-black">{formatCurrency(selectedRow.rate)}</p>
                  </div>
                  <div className="rounded-lg bg-emerald-50 p-3">
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Total Project Budget</p>
                    <p className="text-2xl font-black text-emerald-900">{formatCurrency(selectedRow.totalProjectBudget)}</p>
                  </div>
                  <button className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white" onClick={() => beginBudgetEdit(selectedRow)}>
                    Edit rate setup
                  </button>
                </div>
              )}
            </div>
          </div>
        </SectionCard>
      ) : (
        <SectionCard title="Project Details">
          <EmptyState title="Select a project" subtitle="Click a project row to see detailed P & L." />
        </SectionCard>
      )}
    </div>
  );
}
