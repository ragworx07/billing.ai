import type { FormEvent, ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  CheckCircle2,
  CreditCard,
  HardHat,
  History,
  Plus,
  ReceiptText,
  ShieldCheck,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';

import { DataTable } from '../components/DataTable';
import { SectionCard } from '../components/SectionCard';
import { useAuth } from '../contexts/AuthContext';
import { useNotify } from '../contexts/NotificationContext';
import { api } from '../services/api';
import type { OfficeExpenseInput, OfficeSettlementInput } from '../types/api';
import { hasPermission } from '../utils/access';
import { getApiErrorMessage } from '../utils/errors';
import { formatCurrency, formatDate } from '../utils/format';

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type OfficeRow = {
  id: number;
  source: 'office' | 'site';
  item_name?: string | null;
  category: string;
  description?: string | null;
  amount: number;
  rate?: number | null;
  quantity?: number | null;
  date: string;
  week_start: string;
};

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

const initialForm: OfficeExpenseInput = {
  item_name: '',
  category: '',
  rate: 0,
  quantity: 1,
  description: '',
  date: localDateValue(),
};

const defaultCategories = ['Stationery', 'Pantry items', 'Paper copies', 'EB', 'Other'];

function mondayFor(value: string) {
  const [year, month, dayOfMonth] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, dayOfMonth));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

export function OfficePage() {
  const { user } = useAuth();
  const canExpenseEntry = hasPermission(user?.role, 'office_expense_entry');

  const notify = useNotify();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<OfficeExpenseInput>(initialForm);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isSettleOpen, setIsSettleOpen] = useState(false);
  const [isSettlementsSidebarOpen, setIsSettlementsSidebarOpen] = useState(false);
  const [settleForm, setSettleForm] = useState<OfficeSettlementInput>({
    amount: 0,
    date: localDateValue(),
    payment_mode: 'Cash',
    notes: '',
  });

  const [selectedYear, setSelectedYear] = useState(() => Number(initialForm.date.slice(0, 4)));
  const [selectedMonth, setSelectedMonth] = useState(() => initialForm.date.slice(5, 7));
  const [selectedWeek, setSelectedWeek] = useState(() => mondayFor(initialForm.date));
  const [selectedDay, setSelectedDay] = useState('all');

  const { data: officeExpenses = [], isLoading } = useQuery({
    queryKey: ['office-expenses'],
    queryFn: api.getOfficeExpenses,
  });

  const { data: siteOfficeExpenses = [] } = useQuery({
    queryKey: ['site-expenses', 'office'],
    queryFn: () => api.getSiteExpenses({ allocation: 'office' }),
  });

  // Site expenses tagged to Office are listed here alongside native office entries,
  // but stay owned by the Site Expenses tab (edit/delete happens there).
  const expenses = useMemo<OfficeRow[]>(
    () => [
      ...officeExpenses.map((expense) => ({ ...expense, source: 'office' as const })),
      ...siteOfficeExpenses.map((expense) => ({ ...expense, source: 'site' as const })),
    ].sort((left, right) => right.date.localeCompare(left.date) || right.id - left.id),
    [officeExpenses, siteOfficeExpenses],
  );

  const { data: settlements = [] } = useQuery({
    queryKey: ['office-settlements'],
    queryFn: api.getOfficeSettlements,
  });

  const createMutation = useMutation({
    mutationFn: (payload: OfficeExpenseInput) => {
      if (!canExpenseEntry) {
        throw new Error('You do not have permission for Office Expense Entry.');
      }
      return api.createOfficeExpense(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['office-expenses'] });
      setForm({ ...initialForm, date: localDateValue() });
      setIsAddOpen(false);
      notify.success('Office item added.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to add office item.')),
  });

  const deleteMutation = useMutation({
    mutationFn: (expenseId: number) => {
      if (!canExpenseEntry) {
        throw new Error('You do not have permission for Office Expense Entry.');
      }
      return api.deleteOfficeExpense(expenseId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['office-expenses'] });
      notify.success('Office item removed.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to remove office item.')),
  });

  const createSettlementMutation = useMutation({
    mutationFn: (payload: OfficeSettlementInput) => {
      if (!canExpenseEntry) {
        throw new Error('You do not have permission to settle office expenses.');
      }
      return api.createOfficeSettlement(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['office-settlements'] });
      setIsSettleOpen(false);
      notify.success('Office expense settlement recorded.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to record settlement.')),
  });

  const deleteSettlementMutation = useMutation({
    mutationFn: (settlementId: number) => {
      if (!canExpenseEntry) {
        throw new Error('You do not have permission to delete settlements.');
      }
      return api.deleteOfficeSettlement(settlementId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['office-settlements'] });
      notify.success('Settlement record removed.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to remove settlement.')),
  });

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
      return matchesYear && matchesMonth && matchesWeek && matchesDay;
    }),
    [expenses, selectedDay, selectedMonth, selectedWeek, selectedYear],
  );

  const weekTotal = weekExpenses.reduce((total, expense) => total + Number(expense.amount || 0), 0);
  const calculatedTotal = Number((form.rate * form.quantity).toFixed(2));

  const grandTotalExpenses = useMemo(
    () => expenses.reduce((total, expense) => total + Number(expense.amount || 0), 0),
    [expenses],
  );

  const totalSettled = useMemo(
    () => settlements.reduce((total, settlement) => total + Number(settlement.amount || 0), 0),
    [settlements],
  );

  const outstandingAmount = useMemo(
    () => Number(Math.max(grandTotalExpenses - totalSettled, 0).toFixed(2)),
    [grandTotalExpenses, totalSettled],
  );

  function updateForm<K extends keyof OfficeExpenseInput>(field: K, value: OfficeExpenseInput[K]) {
    setForm((current) => ({ ...current, [field]: value }));
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
      notify.error('You do not have permission for Office Expense Entry.');
      return;
    }
    if (!form.item_name.trim() || !form.category.trim() || form.rate <= 0 || form.quantity <= 0) {
      notify.error('Enter the item name, category, rate, and quantity.');
      return;
    }
    createMutation.mutate({
      ...form,
      item_name: form.item_name.trim(),
      category: form.category.trim(),
      description: form.description?.trim() || null,
    });
  }

  function openSettleModal() {
    setSettleForm({
      amount: outstandingAmount > 0 ? outstandingAmount : 0,
      date: localDateValue(),
      payment_mode: 'Cash',
      notes: '',
    });
    setIsSettleOpen(true);
  }

  function submitSettlement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canExpenseEntry) {
      notify.error('You do not have permission to settle office expenses.');
      return;
    }
    if (settleForm.amount <= 0) {
      notify.error('Please enter a valid settlement amount.');
      return;
    }
    createSettlementMutation.mutate({
      ...settleForm,
      notes: settleForm.notes?.trim() || null,
    });
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-clay">Vouchers · Cash & Bank (F4/F5)</p>
          <h1 className="mt-1 font-display text-3xl text-graphite">Cash & Bank (Office Vouchers)</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate">Manage cash transactions, administrative disbursements, utility bills, settlements, and non-project operational expenses.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-sm font-semibold text-slate shadow-sm">
            <CalendarDays className="h-4 w-4 text-clay" />
            {selectedDay !== 'all'
              ? formatDate(selectedDay)
              : selectedWeek !== 'all'
                ? `Week of ${formatDate(selectedWeek)}`
                : selectedMonth !== 'all'
                  ? `${monthNames[Number(selectedMonth) - 1]} ${selectedYear}`
                  : `All months · ${selectedYear}`}
          </div>
          {canExpenseEntry ? (
            <button type="button" className="inline-flex items-center gap-2 rounded-2xl bg-clay px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-graphite" onClick={() => setIsAddOpen(true)}>
              <Plus className="h-4 w-4" /> Add Voucher
            </button>
          ) : null}
        </div>
      </div>

      {/* Office Expenses & Settlements Financial Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Total Office Expenses Card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition hover:shadow-md">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider">Total Office Disbursements</span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
              <ReceiptText className="h-5 w-5" />
            </div>
          </div>
          <p className="mt-2 font-display text-3xl font-black text-slate-900">{formatCurrency(grandTotalExpenses)}</p>
          <p className="mt-1 text-xs text-slate-500">{expenses.length} total office voucher entries</p>
        </div>

        {/* Total Settled Card */}
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5 shadow-xs transition hover:shadow-md">
          <div className="flex items-center justify-between text-emerald-700">
            <span className="text-xs font-bold uppercase tracking-wider">Total Settled</span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </div>
          <p className="mt-2 font-display text-3xl font-black text-emerald-950">{formatCurrency(totalSettled)}</p>
          <p className="mt-1 text-xs font-semibold text-emerald-700">{settlements.length} settlement record{settlements.length === 1 ? '' : 's'}</p>
        </div>

        {/* Outstanding & Action Buttons Card */}
        <div className="rounded-2xl border border-amber-200/90 bg-gradient-to-br from-amber-50 to-orange-50/70 p-5 shadow-xs transition hover:shadow-md sm:col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between text-amber-800">
            <span className="text-xs font-bold uppercase tracking-wider">Outstanding Balance</span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-900">
              <Wallet className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
            <p className={`font-display text-3xl font-black ${outstandingAmount > 0 ? 'text-amber-950' : 'text-emerald-700'}`}>
              {formatCurrency(outstandingAmount)}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {canExpenseEntry ? (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-extrabold text-white shadow-xs transition hover:bg-emerald-800 disabled:opacity-50"
                onClick={openSettleModal}
                disabled={outstandingAmount <= 0}
              >
                <ShieldCheck className="h-4 w-4" />
                Settle Amount
              </button>
            ) : null}
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-white px-4 py-2.5 text-xs font-extrabold text-amber-900 shadow-xs transition hover:bg-amber-100/60"
              onClick={() => setIsSettlementsSidebarOpen(true)}
            >
              <History className="h-4 w-4" />
              Settlements ({settlements.length})
            </button>
          </div>
        </div>
      </div>

      <SectionCard title="Weekly office bill">
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-semibold text-slate">Year<select value={selectedYear} onChange={(event) => selectYear(event.target.value)}>{yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
          <label className="text-sm font-semibold text-slate">Month<select value={selectedMonth} onChange={(event) => selectMonth(event.target.value)}><option value="all">All months</option>{monthNames.map((month, index) => <option key={month} value={String(index + 1).padStart(2, '0')}>{month}</option>)}</select></label>
          <label className="text-sm font-semibold text-slate">Week<select value={selectedWeek} onChange={(event) => selectWeek(event.target.value)}><option value="all">All weeks</option>{weekOptions.map((week) => <option key={week} value={week}>{weekLabel(week)}</option>)}</select></label>
          <label className="text-sm font-semibold text-slate">Day<select value={selectedDay} onChange={(event) => setSelectedDay(event.target.value)}><option value="all">All days</option>{dayOptions.map((day) => <option key={day} value={day}>{shortDateLabel(day)}</option>)}</select></label>
        </div>
        {isLoading ? <p className="text-sm text-slate">Loading office expenses...</p> : null}
        <DataTable
          printTitle="Cash & Bank (Office Vouchers)"
          auditTableName="office_expenses"
          auditRecordIds={weekExpenses.filter((expense) => expense.source === 'office').map((expense) => expense.id)}
          auditRecordLabel="Cash & bank voucher"
          printMetadata={{ Module: 'Cash & Bank', Year: selectedYear, Month: selectedMonth === 'all' ? 'All months' : monthNames[Number(selectedMonth) - 1], Week: selectedWeek === 'all' ? 'All weeks' : weekLabel(selectedWeek), Total: formatCurrency(weekTotal) }}
          headers={canExpenseEntry ? ['Date', 'Item', 'Category', 'Source', 'Rate', 'Qty', 'Total', 'Actions'] : ['Date', 'Item', 'Category', 'Source', 'Rate', 'Qty', 'Total']}
          rows={weekExpenses.map((expense) => {
            const rowItems: ReactNode[] = [
              formatDate(expense.date),
              expense.item_name || expense.description || expense.category,
              expense.category,
              expense.source === 'site'
                ? <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-800"><HardHat className="h-3 w-3" />Site expense</span>
                : <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">Office</span>,
              expense.rate ? formatCurrency(expense.rate) : '-',
              expense.quantity ?? '-',
              formatCurrency(expense.amount),
            ];
            if (canExpenseEntry) {
              rowItems.push(
                expense.source === 'site'
                  ? <span className="text-xs font-semibold text-slate-400">Manage in Site Expenses</span>
                  : <button type="button" className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2 py-1 text-xs font-bold text-red-700" onClick={() => deleteMutation.mutate(expense.id)}><Trash2 className="h-3.5 w-3.5" />Remove</button>
              );
            }
            return rowItems;
          })}
        />
        <div className="mt-4 flex justify-end">
          <div className="min-w-0 rounded-2xl bg-graphite px-5 py-4 text-white shadow-panel">
            <p className="text-sm font-semibold text-white/70">Filtered Period Expense</p>
            <p className="mt-1 font-display text-3xl">{formatCurrency(weekTotal)}</p>
          </div>
        </div>
      </SectionCard>

      {/* Add New Item Modal */}
      {isAddOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-graphite/55 px-4 py-6" onMouseDown={() => setIsAddOpen(false)}>
          <div className="w-full max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[28px] border border-white/70 bg-surface p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="add-office-item-title">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-sm font-bold uppercase tracking-[0.2em] text-clay">Office transaction</p><h2 id="add-office-item-title" className="mt-1 font-display text-2xl text-graphite">Add new item</h2></div>
              <button type="button" className="rounded-full bg-slate-100 p-2 text-slate-600 hover:bg-slate-200" onClick={() => setIsAddOpen(false)} aria-label="Close add item dialog"><X className="h-5 w-5" /></button>
            </div>
            <form className="mt-6 grid gap-4 sm:grid-cols-2" onSubmit={submit}>
              <div><label className="mb-1 block text-sm font-semibold text-slate">Item name</label><input autoFocus value={form.item_name} onChange={(event) => updateForm('item_name', event.target.value)} placeholder="A4 paper, tea powder..." required /></div>
              <div><label className="mb-1 block text-sm font-semibold text-slate">Category</label><input list="office-category-history" value={form.category} onChange={(event) => updateForm('category', event.target.value)} placeholder="Select or type a category" required /><datalist id="office-category-history">{categoryOptions.map((category) => <option key={category} value={category} />)}</datalist><p className="mt-1 text-xs text-slate">New categories are saved and appear here next time.</p></div>
              <div><label className="mb-1 block text-sm font-semibold text-slate">Rate</label><input type="number" min="0.01" step="0.01" value={form.rate || ''} onChange={(event) => updateForm('rate', Number(event.target.value || 0))} placeholder="0.00" required /></div>
              <div><label className="mb-1 block text-sm font-semibold text-slate">Quantity</label><input type="number" min="0.001" step="0.001" value={form.quantity || ''} onChange={(event) => updateForm('quantity', Number(event.target.value || 0))} placeholder="1" required /></div>
              <div className="rounded-2xl border border-clay/20 bg-orange-50 px-4 py-3 sm:col-span-2"><p className="text-sm font-semibold text-slate">Calculated total</p><p className="mt-1 font-display text-3xl text-graphite">{formatCurrency(calculatedTotal)}</p><p className="text-xs text-slate">Rate × quantity</p></div>
              <div><label className="mb-1 block text-sm font-semibold text-slate">Date</label><input type="date" value={form.date} onChange={(event) => { updateForm('date', event.target.value); selectCalendarDate(event.target.value); }} required /></div>
              <div><label className="mb-1 block text-sm font-semibold text-slate">Description (optional)</label><input value={form.description || ''} onChange={(event) => updateForm('description', event.target.value)} placeholder="EB bill, pantry refill..." /></div>
              <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50" onClick={() => setIsAddOpen(false)}>Cancel</button><button type="submit" className="inline-flex items-center gap-2 rounded-2xl bg-clay px-5 py-3 text-sm font-bold text-white hover:bg-graphite disabled:opacity-60" disabled={createMutation.isPending || calculatedTotal <= 0}><ReceiptText className="h-4 w-4" />{createMutation.isPending ? 'Creating...' : 'Create item'}</button></div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Settle Office Expense Modal */}
      {isSettleOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-graphite/55 px-4 py-6" onMouseDown={() => setIsSettleOpen(false)}>
          <div className="w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[28px] border border-white/70 bg-surface p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">Office Expense Settlement</p>
                <h2 className="mt-1 font-display text-2xl text-graphite">Settle Outstanding Amount</h2>
              </div>
              <button type="button" className="rounded-full bg-slate-100 p-2 text-slate-600 hover:bg-slate-200" onClick={() => setIsSettleOpen(false)}><X className="h-5 w-5" /></button>
            </div>
            <form className="mt-6 space-y-4" onSubmit={submitSettlement}>
              <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-900">Current Outstanding:</span>
                <span className="text-xl font-black text-amber-950">{formatCurrency(outstandingAmount)}</span>
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">Amount to Settle</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={settleForm.amount || ''}
                  onChange={(event) => setSettleForm((c) => ({ ...c, amount: Number(event.target.value || 0) }))}
                  placeholder="0.00"
                  required
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700">Settlement Date</label>
                  <input
                    type="date"
                    value={settleForm.date}
                    onChange={(event) => setSettleForm((c) => ({ ...c, date: event.target.value }))}
                    required
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700">Payment Mode</label>
                  <select
                    value={settleForm.payment_mode || 'Cash'}
                    onChange={(event) => setSettleForm((c) => ({ ...c, payment_mode: event.target.value }))}
                  >
                    <option value="Cash">Cash</option>
                    <option value="UPI / GPay">UPI / GPay</option>
                    <option value="Bank Transfer">Bank Transfer / NEFT</option>
                    <option value="Cheque">Cheque</option>
                    <option value="Card">Card</option>
                    <option value="Others">Others</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">Notes / Remarks (optional)</label>
                <input
                  value={settleForm.notes || ''}
                  onChange={(event) => setSettleForm((c) => ({ ...c, notes: event.target.value }))}
                  placeholder="e.g. Cleared by MD, receipt no #104"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50" onClick={() => setIsSettleOpen(false)}>Cancel</button>
                <button type="submit" className="inline-flex items-center gap-2 rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-60" disabled={createSettlementMutation.isPending || settleForm.amount <= 0}>
                  <ShieldCheck className="h-4 w-4" />
                  {createSettlementMutation.isPending ? 'Settling...' : 'Confirm Settlement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Settlement History Sidebar (Slide-over) */}
      {isSettlementsSidebarOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-graphite/45 backdrop-blur-xs transition-opacity animate-in fade-in duration-200">
          <div className="absolute inset-0" onClick={() => setIsSettlementsSidebarOpen(false)} />

          <div className="relative z-10 flex h-full max-h-full w-full min-w-0 max-w-md flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl animate-in slide-in-from-right duration-300">
            {/* Sidebar Header */}
            <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-slate-50 to-emerald-50/40 px-6 py-5 shrink-0">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-800 shadow-xs">
                  <History className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-display text-xl text-graphite">Settlement History</h3>
                  <p className="text-xs text-slate-500">Total Settled: <span className="font-extrabold text-emerald-700">{formatCurrency(totalSettled)}</span></p>
                </div>
              </div>
              <button
                type="button"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100"
                onClick={() => setIsSettlementsSidebarOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Sidebar Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {settlements.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 py-12 text-center">
                  <Wallet className="h-10 w-10 text-slate-300 mb-2" />
                  <p className="text-sm font-bold text-slate-700">No Settlements Yet</p>
                  <p className="mt-1 text-xs text-slate-500">Settled amounts will appear here in chronological order.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {settlements.map((settlement) => (
                    <div
                      key={settlement.id}
                      className="rounded-2xl border border-slate-200/90 bg-slate-50/60 p-4 space-y-2.5 transition hover:border-slate-300 hover:bg-white shadow-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-extrabold text-slate-900">{formatDate(settlement.date)}</span>
                        <span className="text-base font-black text-emerald-700">{formatCurrency(settlement.amount)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-slate-600">
                        <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 font-bold text-indigo-700">
                          <CreditCard className="h-3 w-3" />
                          {settlement.payment_mode || 'Cash'}
                        </span>
                        {canExpenseEntry ? (
                          <button
                            type="button"
                            className="text-xs font-bold text-red-600 hover:underline inline-flex items-center gap-1"
                            onClick={() => {
                              if (confirm('Delete this settlement record?')) {
                                deleteSettlementMutation.mutate(settlement.id);
                              }
                            }}
                          >
                            <Trash2 className="h-3 w-3" /> Delete
                          </button>
                        ) : null}
                      </div>
                      {settlement.notes ? (
                        <p className="text-xs text-slate-500 bg-white p-2 rounded-xl border border-slate-100">{settlement.notes}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Sidebar Footer */}
            <div className="border-t border-slate-100 bg-slate-50/80 px-6 py-4 shrink-0 flex items-center justify-between text-xs font-bold text-slate-600">
              <span>{settlements.length} settlement record{settlements.length === 1 ? '' : 's'}</span>
              <button
                type="button"
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-slate-700 hover:bg-slate-100"
                onClick={() => setIsSettlementsSidebarOpen(false)}
              >
                Close Sidebar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
