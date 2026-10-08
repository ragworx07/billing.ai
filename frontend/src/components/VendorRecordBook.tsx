import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, CalendarDays, ChevronDown, Layers, Search, Truck } from 'lucide-react';

import { DataTable } from './DataTable';
import { api } from '../services/api';
import type { VendorRecordBookItem } from '../types/api';
import { getApiErrorMessage } from '../utils/errors';
import { formatCurrency, formatDate, formatLabourInchargeId, formatVendorId, localDateKey } from '../utils/format';

type PeriodMode = 'all' | 'day' | 'month' | 'year' | 'custom';
type GroupMode = 'vendor' | 'date' | 'project';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SOURCE_ORDER: Record<string, number> = { 'Material Cost': 0, 'Labour Cost': 1, Payment: 2 };

function dateKey(value: string) {
  return value.slice(0, 10);
}

function monthKey(value: string) {
  return dateKey(value).slice(0, 7);
}

function yearKey(value: string) {
  return dateKey(value).slice(0, 4);
}

function currentMonthValue() {
  return localDateKey().slice(0, 7);
}

function monthLabel(value: string) {
  const [year, month] = value.split('-');
  const monthName = MONTH_NAMES[Number(month) - 1];
  return monthName ? `${monthName} ${year}` : value;
}

function partyLabel(type?: string) {
  return type === 'labour_incharge' ? 'Labour Incharge' : 'Vendor';
}

function partyCode(row: VendorRecordBookItem) {
  return row.party_type === 'labour_incharge' ? formatLabourInchargeId(row.vendor_id) : formatVendorId(row.vendor_id);
}

function isPayment(row: VendorRecordBookItem) {
  return row.source === 'Payment';
}

function purchasedOf(row: VendorRecordBookItem) {
  return isPayment(row) ? 0 : Number(row.amount || 0);
}

function paidOf(row: VendorRecordBookItem) {
  return isPayment(row) ? Number(row.amount || 0) : 0;
}

function auditRecord(row: VendorRecordBookItem) {
  return {
    table_name: row.source === 'Payment' ? 'vendor_transactions' : row.source === 'Labour Cost' ? 'labor_logs' : 'material_logs',
    record_id: row.id,
  };
}

function totalsFor(rows: VendorRecordBookItem[]) {
  const purchased = rows.reduce((sum, row) => sum + purchasedOf(row), 0);
  const paid = rows.reduce((sum, row) => sum + paidOf(row), 0);
  return {
    purchased,
    paid,
    balance: purchased - paid,
    vendors: new Set(rows.map((row) => row.vendor_id)).size,
    projects: new Set(rows.map((row) => row.project_id)).size,
    count: rows.length,
  };
}

type LedgerGroup = {
  key: string;
  label: string;
  detail: string;
  rows: VendorRecordBookItem[];
};

export function VendorRecordBook({
  canViewVendors = true,
  canViewIncharges = true,
}: {
  canViewVendors?: boolean;
  canViewIncharges?: boolean;
}) {
  const today = localDateKey();
  const [periodMode, setPeriodMode] = useState<PeriodMode>('all');
  const [selectedDay, setSelectedDay] = useState(today);
  const [selectedMonth, setSelectedMonth] = useState(currentMonthValue);
  const [selectedYear, setSelectedYear] = useState(() => Number(today.slice(0, 4)));
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [groupMode, setGroupMode] = useState<GroupMode>('vendor');
  const [partyType, setPartyType] = useState<'all' | 'material_vendor' | 'labour_incharge'>(
    canViewVendors && canViewIncharges ? 'all' : canViewIncharges ? 'labour_incharge' : 'material_vendor',
  );
  const [vendorFilter, setVendorFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const { data: rows = [], isFetching, isError, error } = useQuery({
    queryKey: ['vendor-record-book'],
    queryFn: api.getVendorRecordBook,
  });

  useEffect(() => {
    if (partyType === 'all' && !(canViewVendors && canViewIncharges)) {
      setPartyType(canViewIncharges ? 'labour_incharge' : 'material_vendor');
      setVendorFilter('all');
      return;
    }
    if (partyType === 'material_vendor' && !canViewVendors) {
      setPartyType(canViewIncharges ? 'labour_incharge' : 'material_vendor');
      setVendorFilter('all');
      return;
    }
    if (partyType === 'labour_incharge' && !canViewIncharges) {
      setPartyType(canViewVendors ? 'material_vendor' : 'labour_incharge');
      setVendorFilter('all');
    }
  }, [canViewIncharges, canViewVendors, partyType]);

  useEffect(() => {
    if (periodMode !== 'custom' || dateFrom || dateTo || rows.length === 0) return;
    const dates = rows.map((row) => dateKey(row.payment_date)).sort();
    setDateFrom(dates[0]);
    setDateTo(dates[dates.length - 1]);
  }, [dateFrom, dateTo, periodMode, rows]);

  const yearOptions = useMemo(() => {
    const years = new Set(rows.map((row) => Number(yearKey(row.payment_date))).filter((year) => Number.isFinite(year)));
    years.add(selectedYear);
    years.add(Number(today.slice(0, 4)));
    return [...years].sort((left, right) => right - left);
  }, [rows, selectedYear, today]);

  const vendorOptions = useMemo(() => {
    const map = new Map<number, { id: number; name: string; party_type: string }>();
    rows.forEach((row) => {
      if (!map.has(row.vendor_id)) map.set(row.vendor_id, { id: row.vendor_id, name: row.vendor_name, party_type: row.party_type });
    });
    return [...map.values()]
      .filter((vendor) => {
        if (vendor.party_type === 'labour_incharge' ? !canViewIncharges : !canViewVendors) return false;
        return partyType === 'all' || vendor.party_type === partyType;
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [canViewIncharges, canViewVendors, partyType, rows]);

  const projectOptions = useMemo(() => {
    const map = new Map<number, { id: number; name: string }>();
    rows.forEach((row) => {
      if (!map.has(row.project_id)) map.set(row.project_id, { id: row.project_id, name: row.project_name });
    });
    return [...map.values()].sort((left, right) => left.name.localeCompare(right.name));
  }, [rows]);

  const periodBounds = useMemo(() => {
    if (periodMode === 'day') return { from: selectedDay, to: selectedDay };
    if (periodMode === 'month') {
      const [year, month] = selectedMonth.split('-').map(Number);
      const lastDay = new Date(year, month, 0).getDate();
      return { from: `${selectedMonth}-01`, to: `${selectedMonth}-${String(lastDay).padStart(2, '0')}` };
    }
    if (periodMode === 'year') return { from: `${selectedYear}-01-01`, to: `${selectedYear}-12-31` };
    if (periodMode === 'custom') {
      const from = dateFrom && dateTo && dateFrom > dateTo ? dateTo : dateFrom;
      const to = dateFrom && dateTo && dateFrom > dateTo ? dateFrom : dateTo;
      return { from, to };
    }
    return { from: '', to: '' };
  }, [dateFrom, dateTo, periodMode, selectedDay, selectedMonth, selectedYear]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      const key = dateKey(row.payment_date);
      if (periodMode === 'day' && key !== selectedDay) return false;
      if (periodMode === 'month' && monthKey(row.payment_date) !== selectedMonth) return false;
      if (periodMode === 'year' && yearKey(row.payment_date) !== String(selectedYear)) return false;
      if (periodMode === 'custom') {
        if (periodBounds.from && key < periodBounds.from) return false;
        if (periodBounds.to && key > periodBounds.to) return false;
      }
      if (partyType !== 'all' && row.party_type !== partyType) return false;
      if (row.party_type === 'labour_incharge' ? !canViewIncharges : !canViewVendors) return false;
      if (vendorFilter !== 'all' && String(row.vendor_id) !== vendorFilter) return false;
      if (projectFilter !== 'all' && String(row.project_id) !== projectFilter) return false;
      if (query) {
        const haystack = [
          row.vendor_name,
          row.project_name,
          row.source,
          row.work_detail,
          row.payment_mode,
          row.notes,
          partyLabel(row.party_type),
          partyCode(row),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [canViewIncharges, canViewVendors, partyType, periodBounds.from, periodBounds.to, periodMode, projectFilter, rows, search, selectedDay, selectedMonth, selectedYear, vendorFilter]);

  const groups = useMemo<LedgerGroup[]>(() => {
    const map = new Map<string, LedgerGroup>();
    filteredRows.forEach((row) => {
      const key = groupMode === 'vendor'
        ? `vendor:${row.vendor_id}`
        : groupMode === 'project'
          ? `project:${row.project_id}`
          : `date:${dateKey(row.payment_date)}`;
      const current = map.get(key) || {
        key,
        label: groupMode === 'vendor' ? row.vendor_name : groupMode === 'project' ? row.project_name : formatDate(row.payment_date),
        detail: '',
        rows: [],
      };
      current.rows.push(row);
      map.set(key, current);
    });

    const ordered = [...map.values()].map((group) => {
      const first = group.rows[0];
      const vendorCount = new Set(group.rows.map((row) => row.vendor_id)).size;
      const projectCount = new Set(group.rows.map((row) => row.project_id)).size;
      return {
        ...group,
        detail: groupMode === 'vendor'
          ? `${partyCode(first)} · ${partyLabel(first.party_type)} · ${projectCount} site${projectCount === 1 ? '' : 's'}`
          : groupMode === 'project'
            ? `${vendorCount} vendor${vendorCount === 1 ? '' : 's'}`
            : `${vendorCount} vendor${vendorCount === 1 ? '' : 's'} · ${projectCount} site${projectCount === 1 ? '' : 's'}`,
        rows: [...group.rows].sort((left, right) => {
          const dateCompare = dateKey(left.payment_date).localeCompare(dateKey(right.payment_date));
          if (dateCompare !== 0) return dateCompare;
          const sourceCompare = (SOURCE_ORDER[left.source] ?? 9) - (SOURCE_ORDER[right.source] ?? 9);
          if (sourceCompare !== 0) return sourceCompare;
          const vendorCompare = left.vendor_name.localeCompare(right.vendor_name);
          if (vendorCompare !== 0) return vendorCompare;
          return left.project_name.localeCompare(right.project_name) || left.id - right.id;
        }),
      };
    });

    return ordered.sort((left, right) => {
      if (groupMode === 'date') return left.key.localeCompare(right.key);
      return left.label.localeCompare(right.label);
    });
  }, [filteredRows, groupMode]);

  const summary = useMemo(() => totalsFor(filteredRows), [filteredRows]);

  const periodCaption = periodMode === 'all'
    ? 'All dates'
    : periodMode === 'day'
      ? formatDate(selectedDay)
      : periodMode === 'month'
        ? monthLabel(selectedMonth)
        : periodMode === 'year'
          ? String(selectedYear)
          : periodBounds.from && periodBounds.to
            ? `${formatDate(periodBounds.from)} → ${formatDate(periodBounds.to)}`
            : 'Custom range';

  function toggleGroup(key: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function setAllCollapsed(nextCollapsed: boolean) {
    setCollapsed(nextCollapsed ? new Set(groups.map((group) => group.key)) : new Set());
  }

  function renderGroupTable(group: LedgerGroup) {
    const groupTotals = totalsFor(group.rows);
    let running = 0;
    const showVendor = groupMode !== 'vendor';
    const showDate = groupMode !== 'date';
    const showProject = groupMode !== 'project';
    const showBalance = groupMode === 'vendor';
    const headers = [
      'S.No.',
      ...(showDate ? ['Date'] : []),
      ...(showVendor ? ['Vendor'] : []),
      ...(showProject ? ['Project'] : []),
      'Type',
      'Work Detail',
      'Qty',
      'Rate',
      'Payment Mode',
      'Notes',
      'Purchased',
      'Paid',
      ...(showBalance ? ['Balance'] : []),
    ];
    const emptyLead = Array.from({ length: headers.length - (showBalance ? 4 : 3) }, () => '');
    return (
      <DataTable
        auditRowRecords={group.rows.map(auditRecord)}
        auditRecordLabel="Vendor transaction"
        size="compact"
        enableSearch={groups.length === 1}
        printTitle={`Vendor Record Book - ${group.label}`}
        printMetadata={{
          Period: periodCaption,
          Group: group.label,
          Purchased: formatCurrency(groupTotals.purchased),
          Paid: formatCurrency(groupTotals.paid),
          Balance: formatCurrency(groupTotals.balance),
        }}
        headers={headers}
        rows={group.rows.map((row, index) => {
          running += purchasedOf(row) - paidOf(row);
          return [
            index + 1,
            ...(showDate ? [formatDate(row.payment_date)] : []),
            ...(showVendor ? [`${row.vendor_name} (${partyCode(row)})`] : []),
            ...(showProject ? [row.project_name] : []),
            row.source,
            row.work_detail,
            row.quantity !== null && row.quantity !== undefined ? row.quantity : '-',
            row.rate !== null && row.rate !== undefined ? formatCurrency(Number(row.rate)) : '-',
            row.payment_mode || '-',
            row.notes || '-',
            isPayment(row) ? '-' : formatCurrency(purchasedOf(row)),
            isPayment(row) ? formatCurrency(paidOf(row)) : '-',
            ...(showBalance ? [formatCurrency(running)] : []),
          ];
        })}
        footerRows={[
          [...emptyLead, 'Total', formatCurrency(groupTotals.purchased), formatCurrency(groupTotals.paid), ...(showBalance ? [formatCurrency(groupTotals.balance)] : [])],
        ]}
      />
    );
  }

  return (
    <section className="min-w-0 space-y-5">
      <div className="rounded-[var(--panel-radius)] border border-white/70 bg-[var(--panel-bg)] p-5 shadow-panel backdrop-blur">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="vendor-record-book-title" className="font-display text-xl text-graphite">Site purchases and repayments</h2>
          <div
            role="tablist"
            aria-label="Party"
            className={`grid w-full shrink-0 gap-1 self-start rounded-2xl border border-slate-200/90 bg-white p-1 shadow-sm sm:w-[22rem] ${
              canViewVendors && canViewIncharges ? 'grid-cols-3' : 'grid-cols-1'
            }`}
          >
            {([
              ...(canViewVendors && canViewIncharges ? [['all', 'All'] as const] : []),
              ...(canViewVendors ? [['material_vendor', 'Vendors'] as const] : []),
              ...(canViewIncharges ? [['labour_incharge', 'Labour'] as const] : []),
            ]).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={partyType === mode}
                className={`inline-flex items-center justify-center rounded-xl px-2.5 py-2 text-sm font-bold transition ${
                  partyType === mode
                    ? 'bg-graphite text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-graphite'
                }`}
                onClick={() => {
                  setPartyType(mode);
                  setVendorFilter('all');
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Period</span>
            {([
              ['all', 'All'],
              ['day', 'Day'],
              ['month', 'Month'],
              ['year', 'Year'],
              ['custom', 'Custom'],
            ] as Array<[PeriodMode, string]>).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={`rounded-full px-3 py-1.5 text-sm font-semibold ${periodMode === mode ? 'bg-graphite text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                onClick={() => {
                  setPeriodMode(mode);
                  if (mode === 'custom' && rows.length > 0) {
                    const dates = rows.map((row) => dateKey(row.payment_date)).sort();
                    setDateFrom((current) => current || dates[0]);
                    setDateTo((current) => current || dates[dates.length - 1]);
                  }
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {periodMode === 'day' ? (
            <label className="max-w-xs text-sm font-semibold text-slate">
              Day
              <input type="date" value={selectedDay} onChange={(event) => setSelectedDay(event.target.value)} />
            </label>
          ) : null}
          {periodMode === 'month' ? (
            <label className="max-w-xs text-sm font-semibold text-slate">
              Month
              <input type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} />
            </label>
          ) : null}
          {periodMode === 'year' ? (
            <label className="max-w-xs text-sm font-semibold text-slate">
              Year
              <select value={selectedYear} onChange={(event) => setSelectedYear(Number(event.target.value))}>
                {yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </label>
          ) : null}
          {periodMode === 'custom' ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:max-w-lg">
              <label className="text-sm font-semibold text-slate">From<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
              <label className="text-sm font-semibold text-slate">To<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Group by</span>
            {([
              ['vendor', 'Vendor'],
              ['date', 'Date'],
              ['project', 'Project'],
            ] as Array<[GroupMode, string]>).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${groupMode === mode ? 'bg-indigo-700 text-white' : 'bg-indigo-50 text-indigo-800 hover:bg-indigo-100'}`}
                onClick={() => {
                  setGroupMode(mode);
                  setCollapsed(new Set());
                }}
              >
                <Layers className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm font-semibold text-slate">
              Vendor
              <select value={vendorFilter} onChange={(event) => setVendorFilter(event.target.value)}>
                <option value="all">All vendors</option>
                {vendorOptions.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
              </select>
            </label>
            <label className="text-sm font-semibold text-slate">
              Project
              <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
                <option value="all">All projects</option>
                {projectOptions.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
            <label className="text-sm font-semibold text-slate">
              Search
              <span className="relative mt-0 block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Vendor, site, material..." />
              </span>
            </label>
          </div>
        </div>

        <div className="mt-5 grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-2 xl:grid-cols-6">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Purchased</p>
            <p className="mt-1 text-lg font-black text-slate-900">{formatCurrency(summary.purchased)}</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Paid</p>
            <p className="mt-1 text-lg font-black text-emerald-800">{formatCurrency(summary.paid)}</p>
          </div>
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
            <p className="text-xs font-bold uppercase tracking-wider text-rose-700">Balance</p>
            <p className="mt-1 text-lg font-black text-rose-800">{formatCurrency(summary.balance)}</p>
          </div>
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
            <p className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-indigo-700"><Truck className="h-3.5 w-3.5" /> Vendors</p>
            <p className="mt-1 text-lg font-black text-indigo-800">{summary.vendors}</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-amber-800"><Building2 className="h-3.5 w-3.5" /> Sites</p>
            <p className="mt-1 text-lg font-black text-amber-900">{summary.projects}</p>
          </div>
          <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
            <p className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-sky-700"><CalendarDays className="h-3.5 w-3.5" /> {periodCaption}</p>
            <p className="mt-1 text-lg font-black text-sky-900">{summary.count}</p>
          </div>
        </div>

        {isError ? (
          <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {getApiErrorMessage(error, 'Unable to load the vendor record book.')}
          </div>
        ) : isFetching && rows.length === 0 ? (
          <div className="mt-5 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-600">Loading vendor record book...</div>
        ) : groups.length === 0 ? (
          <div className="mt-5 rounded-lg border border-slate-100 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">No vendor site transactions in this period.</div>
        ) : (
          <div className="mt-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-600">{groups.length} {groupMode} group{groups.length === 1 ? '' : 's'}</p>
              {groups.length > 1 ? (
                <div className="flex gap-2">
                  <button type="button" className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={() => setAllCollapsed(false)}>Expand all</button>
                  <button type="button" className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={() => setAllCollapsed(true)}>Collapse all</button>
                </div>
              ) : null}
            </div>

            {groups.map((group) => {
              const groupTotals = totalsFor(group.rows);
              const isCollapsed = collapsed.has(group.key);
              return (
                <section key={group.key} className="overflow-hidden rounded-2xl border border-slate-200">
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center justify-between gap-3 bg-mist px-4 py-3 text-left"
                    onClick={() => toggleGroup(group.key)}
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-bold text-graphite">
                        <ChevronDown className={`h-4 w-4 shrink-0 transition ${isCollapsed ? '-rotate-90' : ''}`} />
                        {group.label}
                      </p>
                      <p className="mt-0.5 pl-6 text-xs font-semibold text-slate-500">{group.detail} · {group.rows.length} entries</p>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs font-bold">
                      <span className="rounded-full bg-white px-2.5 py-1 text-slate-700">Purchased {formatCurrency(groupTotals.purchased)}</span>
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-800">Paid {formatCurrency(groupTotals.paid)}</span>
                      <span className="rounded-full bg-rose-50 px-2.5 py-1 text-rose-800">Balance {formatCurrency(groupTotals.balance)}</span>
                    </div>
                  </button>
                  {isCollapsed ? null : <div className="p-3">{renderGroupTable(group)}</div>}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
