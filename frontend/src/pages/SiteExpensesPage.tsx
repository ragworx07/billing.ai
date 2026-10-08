import type { FormEvent, ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  CalendarDays,
  HardHat,
  HelpCircle,
  Pencil,
  Plus,
  ReceiptText,
  Trash2,
  X,
} from 'lucide-react';

import { DataTable } from '../components/DataTable';
import { SearchableSelect } from '../components/SearchableSelect';
import { TableSkeleton } from '../components/Skeleton';
import { SectionCard } from '../components/SectionCard';
import { useAuth } from '../contexts/AuthContext';
import { useNotify } from '../contexts/NotificationContext';
import { api } from '../services/api';
import type { SiteExpense, SiteExpenseInput } from '../types/api';
import { hasPermission } from '../utils/access';
import { getApiErrorMessage } from '../utils/errors';
import { formatCurrency, formatDate } from '../utils/format';

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function localDateValue() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isoFromUtcDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function weekStartsForMonth(year: number, month: number) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const last = new Date(Date.UTC(year, month, 0));
  const day = first.getUTCDay() || 7;
  first.setUTCDate(first.getUTCDate() - day + 1);
  const weeks: string[] = [];
  while (first <= last) {
    weeks.push(isoFromUtcDate(first));
    first.setUTCDate(first.getUTCDate() + 7);
  }
  return weeks;
}

function daysForWeek(weekStart: string) {
  const start = new Date(`${weekStart}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setUTCDate(day.getUTCDate() + index);
    return isoFromUtcDate(day);
  });
}

function shortDateLabel(value: string) {
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
}

function weekLabel(value: string) {
  const end = daysForWeek(value)[6];
  return `${shortDateLabel(value)} - ${shortDateLabel(end)}`;
}

const initialForm: SiteExpenseInput = {
  item_name: '',
  category: '',
  rate: 0,
  quantity: 1,
  description: '',
  date: localDateValue(),
  allocation: 'other',
  project_id: null,
};

const defaultCategories = [
  'Safety gear & PPE',
  'Scaffolding & Centering',
  'Water supply & tanker',
  'Site tea & refreshments',
  'Minor tools & consumables',
  'Equipment fuel & diesel',
  'Site electricity & generator',
  'Other site expenses',
];

const OFFICE_OPTION = 'office';
const OTHER_OPTION = 'other';

function allocationValue(expense: Pick<SiteExpenseInput, 'allocation' | 'project_id'>) {
  return expense.allocation === 'project' && expense.project_id ? `project:${expense.project_id}` : expense.allocation;
}

function mondayFor(value: string) {
  const [year, month, dayOfMonth] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, dayOfMonth));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

export function SiteExpensesPage() {
  const { user } = useAuth();
  const canExpenseEntry = hasPermission(user?.role, 'site_expense_entry');

  const notify = useNotify();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SiteExpenseInput>(initialForm);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const [selectedYear, setSelectedYear] = useState(() => Number(initialForm.date.slice(0, 4)));
  const [selectedMonth, setSelectedMonth] = useState(() => initialForm.date.slice(5, 7));
  const [selectedWeek, setSelectedWeek] = useState(() => mondayFor(initialForm.date));
  const [selectedDay, setSelectedDay] = useState('all');
  const [selectedAllocation, setSelectedAllocation] = useState('all');

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ['site-expenses'],
    queryFn: () => api.getSiteExpenses(),
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: api.getProjects,
  });

  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.project_name])),
    [projects],
  );

  const allocationOptions = useMemo(
    () => [
      { id: OFFICE_OPTION, name: 'Office' },
      { id: OTHER_OPTION, name: 'Other (not counted anywhere)' },
      ...projects
        .slice()
        .sort((left, right) => left.project_name.localeCompare(right.project_name))
        .map((project) => ({ id: `project:${project.id}`, name: project.project_name })),
    ],
    [projects],
  );

  function allocationLabel(expense: SiteExpense) {
    if (expense.allocation === 'project') {
      return projectNameById.get(expense.project_id ?? 0) || `Project #${expense.project_id}`;
    }
    return expense.allocation === 'office' ? 'Office' : 'Other';
  }

  const createMutation = useMutation({
    mutationFn: (payload: SiteExpenseInput) => {
      if (!canExpenseEntry) {
        throw new Error('You do not have permission for Site Expense Entry.');
      }
      return api.createSiteExpense(payload);
    },
    onSuccess: () => {
      invalidateExpenseViews();
      closeItemModal();
      notify.success('Site expense item added.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to add site expense item.')),
  });

  const updateMutation = useMutation({
    mutationFn: ({ expenseId, payload }: { expenseId: number; payload: SiteExpenseInput }) => {
      if (!canExpenseEntry) {
        throw new Error('You do not have permission for Site Expense Entry.');
      }
      return api.updateSiteExpense(expenseId, payload);
    },
    onSuccess: () => {
      invalidateExpenseViews();
      closeItemModal();
      notify.success('Site expense item updated.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to update site expense item.')),
  });

  const deleteMutation = useMutation({
    mutationFn: (expenseId: number) => {
      if (!canExpenseEntry) {
        throw new Error('You do not have permission for Site Expense Entry.');
      }
      return api.deleteSiteExpense(expenseId);
    },
    onSuccess: () => {
      invalidateExpenseViews();
      notify.success('Site expense item removed.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to remove site expense item.')),
  });

  function invalidateExpenseViews() {
    queryClient.invalidateQueries({ queryKey: ['site-expenses'] });
    queryClient.invalidateQueries({ queryKey: ['project-statement'] });
  }

  const categoryOptions = useMemo(
    () => [...new Set([...defaultCategories, ...expenses.map((expense) => expense.category).filter(Boolean)])].sort((left, right) => left.localeCompare(right)),
    [expenses],
  );

  const yearOptions = useMemo(
    () => {
      const currentYear = new Date().getFullYear();
      const availableYears = Array.from({ length: currentYear - 1999 }, (_, index) => currentYear - index);
      return [...new Set([selectedYear, ...availableYears, ...expenses.map((expense) => Number(expense.date.slice(0, 4)))])]
        .sort((left, right) => right - left);
    },
    [expenses, selectedYear],
  );

  const weekOptions = useMemo(() => {
    if (selectedMonth === 'all') {
      return [...new Set(Array.from({ length: 12 }, (_, index) => weekStartsForMonth(selectedYear, index + 1)).flat())].sort();
    }
    return weekStartsForMonth(selectedYear, Number(selectedMonth));
  }, [selectedMonth, selectedYear]);

  const dayOptions = useMemo(() => selectedWeek === 'all' ? [] : daysForWeek(selectedWeek), [selectedWeek]);

  const weekExpenses = useMemo(
    () => expenses.filter((expense) => {
      const matchesYear = Number(expense.date.slice(0, 4)) === selectedYear;
      const matchesMonth = selectedMonth === 'all' || expense.date.slice(5, 7) === selectedMonth;
      const matchesWeek = selectedWeek === 'all' || expense.week_start === selectedWeek;
      const matchesDay = selectedDay === 'all' || expense.date === selectedDay;
      const matchesAllocation = selectedAllocation === 'all' || allocationValue(expense) === selectedAllocation;
      return matchesYear && matchesMonth && matchesWeek && matchesDay && matchesAllocation;
    }),
    [expenses, selectedAllocation, selectedDay, selectedMonth, selectedWeek, selectedYear],
  );

  const weekTotal = weekExpenses.reduce((total, expense) => total + Number(expense.amount || 0), 0);
  const calculatedTotal = Number((form.rate * form.quantity).toFixed(2));

  const grandTotalExpenses = useMemo(
    () => expenses.reduce((total, expense) => total + Number(expense.amount || 0), 0),
    [expenses],
  );

  const allocationTotals = useMemo(
    () => expenses.reduce(
      (totals, expense) => {
        totals[expense.allocation] = (totals[expense.allocation] || 0) + Number(expense.amount || 0);
        return totals;
      },
      { project: 0, office: 0, other: 0 } as Record<string, number>,
    ),
    [expenses],
  );

  function updateForm<K extends keyof SiteExpenseInput>(field: K, value: SiteExpenseInput[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function selectAllocation(value: string) {
    if (value.startsWith('project:')) {
      setForm((current) => ({ ...current, allocation: 'project', project_id: Number(value.slice('project:'.length)) }));
      return;
    }
    setForm((current) => ({ ...current, allocation: value === OFFICE_OPTION ? 'office' : 'other', project_id: null }));
  }

  function openAddModal() {
    setEditingId(null);
    setForm({ ...initialForm, date: localDateValue() });
    setIsAddOpen(true);
  }

  function openEditModal(expense: SiteExpense) {
    setEditingId(expense.id);
    setForm({
      item_name: expense.item_name || '',
      category: expense.category,
      rate: Number(expense.rate ?? expense.amount),
      quantity: Number(expense.quantity ?? 1),
      description: expense.description || '',
      date: expense.date,
      allocation: expense.allocation,
      project_id: expense.project_id ?? null,
    });
    setIsAddOpen(true);
  }

  function closeItemModal() {
    setIsAddOpen(false);
    setEditingId(null);
    setForm({ ...initialForm, date: localDateValue() });
  }

  function selectCalendarDate(value: string) {
    setSelectedYear(Number(value.slice(0, 4)));
    setSelectedMonth(value.slice(5, 7));
    setSelectedWeek(mondayFor(value));
    setSelectedDay('all');
  }

  function selectYear(value: string) {
    const year = Number(value);
    setSelectedYear(year);
    setSelectedWeek('all');
    setSelectedDay('all');
  }

  function selectMonth(value: string) {
    setSelectedMonth(value);
    setSelectedWeek('all');
    setSelectedDay('all');
  }

  function selectWeek(value: string) {
    setSelectedWeek(value);
    setSelectedDay('all');
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canExpenseEntry) {
      notify.error('You do not have permission for Site Expense Entry.');
      return;
    }
    if (!form.item_name.trim() || !form.category.trim() || form.rate <= 0 || form.quantity <= 0) {
      notify.error('Enter the item name, category, rate, and quantity.');
      return;
    }
    if (form.allocation === 'project' && !form.project_id) {
      notify.error('Select the project this expense belongs to.');
      return;
    }
    const payload: SiteExpenseInput = {
      ...form,
      item_name: form.item_name.trim(),
      category: form.category.trim(),
      description: form.description?.trim() || null,
    };
    if (editingId) {
      updateMutation.mutate({ expenseId: editingId, payload });
      return;
    }
    createMutation.mutate(payload);
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-amber-700 flex items-center gap-1.5">
            <ReceiptText className="h-4 w-4" /> Vouchers · Operating Expenses (F7)
          </p>
          <h1 className="mt-1 font-display text-3xl text-graphite">Operating Expenses & Vouchers</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate">Track operational costs, consumables, logistics, utilities, and field expenses. Allocate to cost centers, central office, or general overheads.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-sm font-semibold text-slate shadow-sm">
            <CalendarDays className="h-4 w-4 text-amber-700" />
            {selectedDay !== 'all'
              ? formatDate(selectedDay)
              : selectedWeek !== 'all'
                ? `Week of ${formatDate(selectedWeek)}`
                : selectedMonth !== 'all'
                  ? `${monthNames[Number(selectedMonth) - 1]} ${selectedYear}`
                  : `All months · ${selectedYear}`}
          </div>
          {canExpenseEntry ? (
            <button type="button" className="inline-flex items-center gap-2 rounded-2xl bg-amber-800 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-graphite" onClick={openAddModal}>
              <Plus className="h-4 w-4" /> Add Expense Voucher
            </button>
          ) : null}
        </div>
      </div>

      {/* Site expense totals by allocation */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition hover:shadow-md">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider">Total Operating Expenses</span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-800">
              <ReceiptText className="h-5 w-5" />
            </div>
          </div>
          <p className="mt-2 font-display text-3xl font-black text-slate-900">{formatCurrency(grandTotalExpenses)}</p>
          <p className="mt-1 text-xs text-slate-500">{expenses.length} total expense voucher entries</p>
        </div>

        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-5 shadow-xs transition hover:shadow-md">
          <div className="flex items-center justify-between text-indigo-700">
            <span className="text-xs font-bold uppercase tracking-wider">Cost Centers / Jobs</span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100 text-indigo-800">
              <HardHat className="h-5 w-5" />
            </div>
          </div>
          <p className="mt-2 font-display text-3xl font-black text-indigo-950">{formatCurrency(allocationTotals.project)}</p>
          <p className="mt-1 text-xs font-semibold text-indigo-700">Counts in cost center expense totals</p>
        </div>

        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5 shadow-xs transition hover:shadow-md">
          <div className="flex items-center justify-between text-emerald-700">
            <span className="text-xs font-bold uppercase tracking-wider">Tagged to Office</span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800">
              <Building2 className="h-5 w-5" />
            </div>
          </div>
          <p className="mt-2 font-display text-3xl font-black text-emerald-950">{formatCurrency(allocationTotals.office)}</p>
          <p className="mt-1 text-xs font-semibold text-emerald-700">Also listed in the Office tab</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5 shadow-xs transition hover:shadow-md">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider">Other</span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-200 text-slate-700">
              <HelpCircle className="h-5 w-5" />
            </div>
          </div>
          <p className="mt-2 font-display text-3xl font-black text-slate-800">{formatCurrency(allocationTotals.other)}</p>
          <p className="mt-1 text-xs font-semibold text-slate-500">Not counted against any project or office</p>
        </div>
      </div>

      <SectionCard title="Weekly site bill">
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-sm font-semibold text-slate">Year<select value={selectedYear} onChange={(event) => selectYear(event.target.value)}>{yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
          <label className="text-sm font-semibold text-slate">Month<select value={selectedMonth} onChange={(event) => selectMonth(event.target.value)}><option value="all">All months</option>{monthNames.map((month, index) => <option key={month} value={String(index + 1).padStart(2, '0')}>{month}</option>)}</select></label>
          <label className="text-sm font-semibold text-slate">Week<select value={selectedWeek} onChange={(event) => selectWeek(event.target.value)}><option value="all">All weeks</option>{weekOptions.map((week) => <option key={week} value={week}>{weekLabel(week)}</option>)}</select></label>
          <label className="text-sm font-semibold text-slate">Day<select value={selectedDay} onChange={(event) => setSelectedDay(event.target.value)}><option value="all">All days</option>{dayOptions.map((day) => <option key={day} value={day}>{shortDateLabel(day)}</option>)}</select></label>
          <label className="text-sm font-semibold text-slate">Allocated to<select value={selectedAllocation} onChange={(event) => setSelectedAllocation(event.target.value)}><option value="all">All allocations</option>{allocationOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
        </div>
        {isLoading ? <TableSkeleton rows={6} columns={7} /> : (
          <DataTable
          printTitle="Operating Expense Vouchers"
          auditTableName="site_expenses"
          auditRecordIds={weekExpenses.map((expense) => expense.id)}
          auditRecordLabel="Operating expense voucher"
          printMetadata={{ Module: 'Operating Expenses', Year: selectedYear, Month: selectedMonth === 'all' ? 'All months' : monthNames[Number(selectedMonth) - 1], Week: selectedWeek === 'all' ? 'All weeks' : weekLabel(selectedWeek), Total: formatCurrency(weekTotal) }}
          headers={canExpenseEntry ? ['Date', 'Item', 'Category', 'Allocated to', 'Rate', 'Qty', 'Total', 'Actions'] : ['Date', 'Item', 'Category', 'Allocated to', 'Rate', 'Qty', 'Total']}
          rows={weekExpenses.map((expense) => {
            const rowItems: ReactNode[] = [
              formatDate(expense.date),
              expense.item_name || expense.description || expense.category,
              expense.category,
              <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold ${expense.allocation === 'project' ? 'bg-indigo-50 text-indigo-700' : expense.allocation === 'office' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{allocationLabel(expense)}</span>,
              expense.rate ? formatCurrency(expense.rate) : '-',
              expense.quantity ?? '-',
              formatCurrency(expense.amount),
            ];
            if (canExpenseEntry) {
              rowItems.push(
                <div className="flex flex-wrap items-center gap-1.5">
                  {expense.closed_at ? (
                    <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500">Closed</span>
                  ) : (
                    <button type="button" className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-xs font-bold text-amber-800 hover:bg-amber-100" onClick={() => openEditModal(expense)}><Pencil className="h-3.5 w-3.5" />Edit</button>
                  )}
                  <button type="button" className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2 py-1 text-xs font-bold text-red-700" onClick={() => deleteMutation.mutate(expense.id)}><Trash2 className="h-3.5 w-3.5" />Remove</button>
                </div>
              );
            }
            return rowItems;
          })}
        />
      )}
        <div className="mt-4 flex justify-end">
          <div className="min-w-0 rounded-2xl bg-graphite px-5 py-4 text-white shadow-panel">
            <p className="text-sm font-semibold text-white/70">Filtered Period Expense</p>
            <p className="mt-1 font-display text-3xl">{formatCurrency(weekTotal)}</p>
          </div>
        </div>
      </SectionCard>

      {/* Add / Edit Site Item Modal */}
      {isAddOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-graphite/55 px-4 py-6" onMouseDown={closeItemModal}>
          <div className="w-full max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[28px] border border-white/70 bg-surface p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="add-site-item-title">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.2em] text-amber-700 flex items-center gap-1">
                  <HardHat className="h-4 w-4" /> Site expense transaction
                </p>
                <h2 id="add-site-item-title" className="mt-1 font-display text-2xl text-graphite">{editingId ? 'Edit site item' : 'Add new site item'}</h2>
              </div>
              <button type="button" className="rounded-full bg-slate-100 p-2 text-slate-600 hover:bg-slate-200" onClick={closeItemModal} aria-label="Close site item dialog"><X className="h-5 w-5" /></button>
            </div>
            <form className="mt-6 grid gap-4 sm:grid-cols-2" onSubmit={submit}>
              <div><label className="mb-1 block text-sm font-semibold text-slate">Item name</label><input autoFocus value={form.item_name} onChange={(event) => updateForm('item_name', event.target.value)} placeholder="Safety helmets, water tanker, fuel..." required /></div>
              <div><label className="mb-1 block text-sm font-semibold text-slate">Category</label><input list="site-category-history" value={form.category} onChange={(event) => updateForm('category', event.target.value)} placeholder="Select or type a category" required /><datalist id="site-category-history">{categoryOptions.map((category) => <option key={category} value={category} />)}</datalist><p className="mt-1 text-xs text-slate">New site categories are saved automatically.</p></div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-semibold text-slate">Allocated to</label>
                <SearchableSelect
                  options={allocationOptions}
                  value={allocationValue(form)}
                  onChange={(value) => selectAllocation(String(value))}
                  placeholder="Search project, Office or Other..."
                  widthClass="w-full"
                />
                <p className="mt-1 text-xs text-slate">Pick a project to add this to that project&apos;s expenses, Office to log it in the Office tab, or Other to leave it out of both.</p>
              </div>
              <div><label className="mb-1 block text-sm font-semibold text-slate">Rate</label><input type="number" min="0.01" step="0.01" value={form.rate || ''} onChange={(event) => updateForm('rate', Number(event.target.value || 0))} placeholder="0.00" required /></div>
              <div><label className="mb-1 block text-sm font-semibold text-slate">Quantity</label><input type="number" min="0.001" step="0.001" value={form.quantity || ''} onChange={(event) => updateForm('quantity', Number(event.target.value || 0))} placeholder="1" required /></div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 sm:col-span-2"><p className="text-sm font-semibold text-slate">Calculated total</p><p className="mt-1 font-display text-3xl text-graphite">{formatCurrency(calculatedTotal)}</p><p className="text-xs text-slate">Rate × quantity</p></div>
              <div><label className="mb-1 block text-sm font-semibold text-slate">Date</label><input type="date" value={form.date} onChange={(event) => { updateForm('date', event.target.value); selectCalendarDate(event.target.value); }} required /></div>
              <div><label className="mb-1 block text-sm font-semibold text-slate">Description (optional)</label><input value={form.description || ''} onChange={(event) => updateForm('description', event.target.value)} placeholder="Scaffolding rent, generator diesel..." /></div>
              <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50" onClick={closeItemModal}>Cancel</button><button type="submit" className="inline-flex items-center gap-2 rounded-2xl bg-amber-800 px-5 py-3 text-sm font-bold text-white hover:bg-graphite disabled:opacity-60" disabled={createMutation.isPending || updateMutation.isPending || calculatedTotal <= 0}><ReceiptText className="h-4 w-4" />{editingId ? (updateMutation.isPending ? 'Saving...' : 'Save changes') : createMutation.isPending ? 'Creating...' : 'Create site item'}</button></div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
