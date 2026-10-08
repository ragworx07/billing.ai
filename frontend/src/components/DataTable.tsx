import type { MouseEvent, ReactElement, ReactNode } from 'react';
import { isValidElement, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownAZ, ArrowUpAZ, ArrowUpDown, Calendar, ChevronRight, Layers, Printer, Search, X } from 'lucide-react';

import kkrLogo from '../assets/kkr-logo.png';
import { useAuditHover } from '../contexts/AuditHoverContext';
import { api } from '../services/api';
import { printHtmlDocument } from '../utils/fileActions';

function parseTableDateMs(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])).getTime();
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
}

function extractText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'bigint') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join(' ');
  if (isValidElement(node)) {
    const element = node as ReactElement<{ children?: ReactNode; value?: unknown; title?: unknown; 'aria-label'?: unknown }>;
    return [element.props.value, element.props.title, element.props['aria-label'], element.props.children]
      .map((value) => extractText(value as ReactNode))
      .join(' ');
  }
  return '';
}

function normalizeForSort(value: string) {
  const cleaned = value.replace(/[₹,\s%]/g, '').trim();
  const parsed = Number(cleaned);
  if (cleaned && Number.isFinite(parsed)) return parsed;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return date;
  return value.toLocaleLowerCase();
}

function formatPrintDateTime(value: Date) {
  return value.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPrintDate(value: Date) {
  return value.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatSubtotalValue(value: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

type PrintMetadataItem = { label: string; value: ReactNode };
type PrintSummarySection = { title: string; items: PrintMetadataItem[] };

function normalizePrintMetadata(metadata?: PrintMetadataItem[] | Record<string, ReactNode>): PrintMetadataItem[] {
  if (!metadata) return [];
  if (Array.isArray(metadata)) return metadata;
  return Object.entries(metadata).map(([label, value]) => ({ label, value }));
}

function summaryToneClass(label: string) {
  const normalized = label.toLocaleLowerCase();
  if (normalized.includes('paid') || normalized.includes('received')) return 'tone-paid';
  if (normalized.includes('balance') || normalized.includes('outstanding') || normalized.includes('overdue')) return 'tone-balance';
  if (normalized.includes('cost') || normalized.includes('pay') || normalized.includes('due')) return 'tone-cost';
  if (normalized.includes('project') || normalized.includes('transaction') || normalized.includes('payment')) return 'tone-info';
  return '';
}

function printRowClass(cells: string[]) {
  const combined = cells.join(' ').toLocaleLowerCase();
  if (combined.includes('payment')) return 'payment-row';
  if (combined.includes('cost') || combined.includes('payable')) return 'cost-row';
  if (combined.includes('overdue')) return 'overdue-row';
  return '';
}

function printCellClass(header: string, value: string) {
  const normalizedHeader = header.toLocaleLowerCase();
  const normalizedValue = value.trim();
  const numericHeaderHints = [
    'amount',
    'balance',
    'cost',
    'due',
    'paid',
    'payment',
    'qty',
    'quantity',
    'rate',
    'received',
    'subtotal',
    'total',
    '%',
  ];
  const looksNumeric = /^[-+]?₹?\s*[\d,]+(?:\.\d+)?%?$/.test(normalizedValue);
  if (numericHeaderHints.some((hint) => normalizedHeader.includes(hint)) || looksNumeric) return 'num';
  return '';
}

export function DataTable({
  headers,
  rows,
  footerRows = [],
  maxBodyHeightClass = '',
  size = 'compact',
  selectableRows = false,
  selectedRowIndex = null,
  onSelectedRowIndexChange,
  onRowContextMenu,
  ariaLabel = 'Data table',
  enableSearch = true,
  enableSort = true,
  enablePrint = true,
  printTitle,
  printMetadata,
  printSummarySections = [],
  printOmitColumns = [],
  auditTableName,
  auditRecordIds = [],
  auditRowRecords,
  auditRecordLabel = 'Record',
}: {
  headers: string[];
  rows: Array<Array<ReactNode>>;
  footerRows?: Array<Array<ReactNode>>;
  maxBodyHeightClass?: string;
  size?: 'compact' | 'roomy';
  selectableRows?: boolean;
  selectedRowIndex?: number | null;
  onSelectedRowIndexChange?: (index: number) => void;
  onRowContextMenu?: (index: number, event: MouseEvent<HTMLTableRowElement>) => void;
  ariaLabel?: string;
  enableSearch?: boolean;
  enableSort?: boolean;
  enablePrint?: boolean;
  printTitle?: string;
  printMetadata?: PrintMetadataItem[] | Record<string, ReactNode>;
  printSummarySections?: PrintSummarySection[];
  printOmitColumns?: number[];
  auditTableName?: string;
  auditRecordIds?: Array<number | null | undefined>;
  auditRowRecords?: Array<{ table_name: string; record_id: number } | null | undefined>;
  auditRecordLabel?: string;
}) {
  const { showAudit, hideAudit } = useAuditHover();
  const [search, setSearch] = useState('');
  const [sortState, setSortState] = useState<{ column: number; direction: 'asc' | 'desc' } | null>(null);
  const [groupByDate, setGroupByDate] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const isRoomy = size === 'roomy';
  const tableTextClass = isRoomy ? 'text-lg' : 'text-sm';
  const cellPaddingClass = isRoomy ? 'px-4 py-3.5' : 'px-3 py-2.5';

  const dateColumnIndex = useMemo(() => {
    return headers.findIndex((header) => {
      const lower = header.toLocaleLowerCase();
      return lower.includes('date') || lower.includes('day');
    });
  }, [headers]);

  const auditRecords = useMemo(() => {
    const records = auditRowRecords || (auditTableName
      ? auditRecordIds
          .filter((id): id is number => typeof id === 'number')
          .map((recordId) => ({ table_name: auditTableName, record_id: recordId }))
      : []);
    return [...new Map(records.filter(Boolean).map((record) => [`${record!.table_name}:${record!.record_id}`, record!])).values()];
  }, [auditRecordIds, auditRowRecords, auditTableName]);

  const { data: auditActors = {} } = useQuery({
    queryKey: ['audit-actors', auditRecords.map((record) => `${record.table_name}:${record.record_id}`)],
    queryFn: () => api.getAuditActors(auditRecords),
    enabled: auditRecords.length > 0,
    staleTime: 5_000,
    refetchInterval: 15_000,
  });

  const indexedRows = useMemo(() => {
    return rows.map((row, index) => ({ row, originalIndex: index, text: row.map(extractText) }));
  }, [rows]);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    let filtered = indexedRows;

    if (query) {
      filtered = filtered.filter((item) => item.text.join(' ').toLocaleLowerCase().includes(query));
    }

    if (dateColumnIndex >= 0 && (startDate || endDate)) {
      const startMs = startDate ? new Date(`${startDate}T00:00:00`).getTime() : 0;
      const endMs = endDate ? new Date(`${endDate}T23:59:59.999`).getTime() : Infinity;

      filtered = filtered.filter((item) => {
        const dateText = item.text[dateColumnIndex];
        const parsedMs = parseTableDateMs(dateText);
        if (parsedMs === null) return false;
        return parsedMs >= startMs && parsedMs <= endMs;
      });
    }

    if (!sortState) return filtered;
    return filtered.slice().sort((left, right) => {
      const leftValue = normalizeForSort(left.text[sortState.column] || '');
      const rightValue = normalizeForSort(right.text[sortState.column] || '');
      const result =
        typeof leftValue === 'number' && typeof rightValue === 'number'
          ? leftValue - rightValue
          : String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: 'base' });
      return sortState.direction === 'asc' ? result : -result;
    });
  }, [indexedRows, search, dateColumnIndex, startDate, endDate, sortState]);

  const selectedDaysCount = useMemo(() => {
    if (!startDate || !endDate) return null;
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    const diffMs = end.getTime() - start.getTime();
    if (diffMs < 0) return null;
    return Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1; // inclusive count
  }, [startDate, endDate]);

  const dateGroupedRows = useMemo(() => {
    if (!groupByDate || dateColumnIndex < 0) return null;

    const groupsMap = new Map<string, typeof visibleRows>();
    visibleRows.forEach((item) => {
      const key = item.text[dateColumnIndex] || 'Unspecified Date';
      const list = groupsMap.get(key) || [];
      list.push(item);
      groupsMap.set(key, list);
    });

    return [...groupsMap.entries()].map(([dateKey, items]) => {
      const subtotals: Record<number, number> = {};
      headers.forEach((_, colIndex) => {
        if (colIndex === dateColumnIndex) return;
        let colSum = 0;
        let hasNumeric = false;
        items.forEach((item) => {
          const valStr = item.text[colIndex] || '';
          const cleaned = valStr.replace(/[₹,\s%]/g, '').trim();
          const parsed = Number(cleaned);
          if (cleaned && Number.isFinite(parsed)) {
            colSum += parsed;
            hasNumeric = true;
          }
        });
        if (hasNumeric && colSum > 0) {
          subtotals[colIndex] = colSum;
        }
      });

      return { dateKey, items, subtotals };
    });
  }, [visibleRows, groupByDate, dateColumnIndex, headers]);

  function toggleSort(column: number) {
    if (!enableSort) return;
    setSortState((current) => {
      if (!current || current.column !== column) return { column, direction: 'asc' };
      if (current.direction === 'asc') return { column, direction: 'desc' };
      return null;
    });
  }

  function handleArrowNavigation(direction: 'up' | 'down') {
    if (!selectableRows || visibleRows.length === 0 || !onSelectedRowIndexChange) return;
    const currentVisibleIndex = visibleRows.findIndex((item) => item.originalIndex === selectedRowIndex);
    const nextVisibleIndex =
      direction === 'down'
        ? Math.min(visibleRows.length - 1, Math.max(0, currentVisibleIndex + 1))
        : Math.max(0, currentVisibleIndex <= 0 ? 0 : currentVisibleIndex - 1);
    onSelectedRowIndexChange(visibleRows[nextVisibleIndex].originalIndex);
  }

  function printVisibleRows() {
    const title = printTitle || ariaLabel || 'Table';
    const metadata = normalizePrintMetadata(printMetadata);
    const printableColumnIndexes = headers
      .map((_, index) => index)
      .filter((index) => !printOmitColumns.includes(index));
    const printableHeaders = printableColumnIndexes.map((index) => headers[index]);
    const detectedDates = dateColumnIndex >= 0
      ? visibleRows
          .map((item) => Date.parse(item.text[dateColumnIndex] || ''))
          .filter((value) => Number.isFinite(value))
          .sort((a, b) => a - b)
      : [];
    const sortLabel = sortState ? `${headers[sortState.column]} (${sortState.direction.toUpperCase()})` : 'Not applied';
    const systemMetadata: PrintMetadataItem[] = [
      { label: 'Generated On', value: formatPrintDateTime(new Date()) },
      { label: 'Printed Rows', value: `${visibleRows.length} of ${rows.length}` },
      { label: 'Search Filter', value: search.trim() || 'Not applied' },
      { label: 'Grouped By', value: groupByDate ? 'Date' : 'None' },
      { label: 'Sort', value: sortLabel },
    ];
    if (detectedDates.length) {
      const firstDate = detectedDates[0];
      const lastDate = detectedDates[detectedDates.length - 1];
      systemMetadata.push({
        label: 'Visible Date Range',
        value: firstDate === lastDate
          ? formatPrintDate(new Date(firstDate))
          : `${formatPrintDate(new Date(firstDate))} - ${formatPrintDate(new Date(lastDate))}`,
      });
    }
    const metadataHtml = [...metadata, ...systemMetadata]
      .filter((item) => extractText(item.value).trim())
      .map((item) => `
        <div class="meta-item">
          <span class="meta-label">${escapeHtml(item.label)}</span>
          <span class="meta-value">${escapeHtml(extractText(item.value))}</span>
        </div>
      `)
      .join('');
    const summaryHtml = printSummarySections
      .filter((section) => section.items.some((item) => extractText(item.value).trim()))
      .map((section) => `
        <section class="summary-section">
          <h2>${escapeHtml(section.title)}</h2>
          <div class="summary-grid">
            ${section.items
              .filter((item) => extractText(item.value).trim())
              .map((item) => `
                <div class="summary-card ${summaryToneClass(item.label)}">
                  <span class="summary-label">${escapeHtml(item.label)}</span>
                  <span class="summary-value">${escapeHtml(extractText(item.value))}</span>
                </div>
              `)
              .join('')}
          </div>
        </section>
      `)
      .join('');
    const tableRows = visibleRows
      .map((item) => `<tr class="${printRowClass(item.text)}">${printableColumnIndexes.map((index) => {
        const cellText = item.text[index] || '';
        return `<td class="${printCellClass(headers[index], cellText)}">${escapeHtml(cellText)}</td>`;
      }).join('')}</tr>`)
      .join('');
    const footer = footerRows.length
      ? `<tfoot>${footerRows
          .map((row) => `<tr>${printableColumnIndexes.map((index) => {
            const cellText = extractText(row[index]);
            return `<td class="${printCellClass(headers[index], cellText)}">${escapeHtml(cellText)}</td>`;
          }).join('')}</tr>`)
          .join('')}</tfoot>`
      : '';

    printHtmlDocument(`
      <!doctype html>
      <html>
        <head>
          <title>${escapeHtml(title)}</title>
          <style>
            * { box-sizing: border-box; }
            body { font-family: Arial, sans-serif; padding: 10mm; color: #111827; background: #ffffff; }
            * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .print-header { border-bottom: 3px solid #1f2937; padding-bottom: 8px; margin-bottom: 10px; }
            .print-brand { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 6px; min-width: 0; }
            .print-logo { width: 92px; max-height: 54px; object-fit: contain; flex: 0 0 auto; }
            .print-brand-copy { min-width: 0; }
            h1 { font-size: 18px; line-height: 1.2; margin: 0 0 3px; color: #111827; }
            .subtitle { margin: 0 0 6px; color: #475569; font-size: 10px; }
            .meta-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 5px; }
            .meta-item { border: 1px solid #cbd5e1; background: #f8fafc; padding: 5px 6px; border-radius: 5px; min-height: 30px; }
            .meta-label { display: block; color: #64748b; font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; line-height: 1.1; }
            .meta-value { display: block; margin-top: 2px; color: #0f172a; font-size: 10px; font-weight: 700; line-height: 1.25; overflow-wrap: anywhere; }
            .summary-section { border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px; margin: 0 0 9px; background: #ffffff; break-inside: avoid; page-break-inside: avoid; }
            .summary-section h2 { margin: 0 0 6px; font-size: 12px; color: #0f172a; text-transform: uppercase; letter-spacing: 0.04em; }
            .summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
            .summary-card { border: 1px solid #dbe3ef; background: #f8fafc; border-radius: 6px; padding: 6px; min-height: 38px; }
            .summary-card.tone-cost { border-color: #fed7aa; background: #fff7ed; }
            .summary-card.tone-paid { border-color: #bbf7d0; background: #f0fdf4; }
            .summary-card.tone-balance { border-color: #fecdd3; background: #fff1f2; }
            .summary-card.tone-info { border-color: #bfdbfe; background: #eff6ff; }
            .summary-label { display: block; color: #64748b; font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
            .summary-value { display: block; margin-top: 3px; color: #0f172a; font-size: 12px; font-weight: 800; line-height: 1.2; }
            table { width: 100%; border-collapse: collapse; font-size: 10.5px; table-layout: auto; }
            thead { display: table-header-group; }
            tfoot { display: table-row-group; }
            tr { break-inside: avoid; page-break-inside: avoid; }
            th, td { border: 1px solid #cbd5e1; padding: 5px 6px; text-align: left; vertical-align: top; line-height: 1.3; overflow-wrap: anywhere; }
            th { background: #1f2937; color: #ffffff; font-weight: 700; }
            td.num, th.num { text-align: right; white-space: nowrap; }
            tbody tr:nth-child(even) td { background: #f8fafc; }
            tbody tr.cost-row td { background: #fff7ed; }
            tbody tr.payment-row td { background: #f0fdf4; }
            tbody tr.overdue-row td { background: #fff1f2; }
            tfoot td { font-weight: 700; background: #f8fafc; }
            @page { size: landscape; margin: 12mm; }
          </style>
        </head>
        <body>
          <header class="print-header">
            <div class="print-brand">
              <img class="print-logo" src="${kkrLogo}" alt="KKR Developers and Foundations" />
              <div class="print-brand-copy">
                <h1>${escapeHtml(title)}</h1>
                <p class="subtitle">Filtered table printout with selected report context.</p>
              </div>
            </div>
            ${metadataHtml ? `<section class="meta-grid">${metadataHtml}</section>` : ''}
          </header>
          ${summaryHtml}
          <table>
            <thead><tr>${printableColumnIndexes.map((index) => `<th class="${printCellClass(headers[index], '')}">${escapeHtml(headers[index])}</th>`).join('')}</tr></thead>
            <tbody>${tableRows || `<tr><td colspan="${printableHeaders.length}">No rows</td></tr>`}</tbody>
            ${footer}
          </table>
        </body>
      </html>
    `);
  }

  const renderTableRow = (item: typeof visibleRows[0]) => {
    const { row, originalIndex } = item;
    const auditRecord = auditRowRecords?.[originalIndex]
      || (auditTableName && typeof auditRecordIds[originalIndex] === 'number'
        ? { table_name: auditTableName, record_id: auditRecordIds[originalIndex] as number }
        : null);
    const hasAuditRecord = Boolean(auditRecord);
    const actor = auditRecord ? auditActors[`${auditRecord.table_name}:${auditRecord.record_id}`] || null : null;
    return (
      <tr
        key={originalIndex}
        className={`${selectableRows && selectedRowIndex === originalIndex ? 'bg-indigo-50' : ''} ${hasAuditRecord ? 'transition-colors hover:bg-slate-50' : ''}`}
        onClick={selectableRows && onSelectedRowIndexChange ? () => onSelectedRowIndexChange(originalIndex) : undefined}
        onContextMenu={onRowContextMenu ? (event) => onRowContextMenu(originalIndex, event) : undefined}
        onMouseEnter={hasAuditRecord ? () => showAudit(actor, auditRecordLabel) : undefined}
        onMouseLeave={hasAuditRecord ? hideAudit : undefined}
      >
        {row.map((cell, cellIndex) => (
          <td key={cellIndex} className={`${cellPaddingClass} break-words text-graphite align-top`}>
            {cell}
          </td>
        ))}
      </tr>
    );
  };

  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-slate-100">
      {enableSearch || enablePrint || dateColumnIndex >= 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-white px-3 py-2.5">
          {enableSearch ? (
            <label className="relative min-w-0 w-full flex-1 sm:min-w-[200px] sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="h-9 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm text-graphite placeholder-slate-400 outline-none focus:border-slate-400"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search table..."
              />
            </label>
          ) : <span />}

          <div className="flex flex-wrap items-center gap-2">
            {/* Date Range Filter */}
            {dateColumnIndex >= 0 && (
              <div className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200/90 bg-slate-50/90 px-2.5 py-1.5 text-xs text-slate-700 shadow-2xs transition-all focus-within:border-indigo-400 focus-within:bg-white focus-within:ring-2 focus-within:ring-indigo-100 shrink-0 flex-nowrap">
                <Calendar className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                <input
                  type="date"
                  className="w-[7.5rem] sm:w-[8.2rem] bg-transparent text-xs font-semibold text-slate-800 outline-none cursor-pointer"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  title="Filter From Date"
                />
                <span className="text-slate-400 font-bold select-none text-[11px]">→</span>
                <input
                  type="date"
                  className="w-[7.5rem] sm:w-[8.2rem] bg-transparent text-xs font-semibold text-slate-800 outline-none cursor-pointer"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  title="Filter To Date"
                />
                {selectedDaysCount !== null && (
                  <span
                    className="inline-flex items-center rounded-md bg-indigo-50 border border-indigo-200/80 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-indigo-700 shrink-0 select-none shadow-2xs"
                    title={`Selected range: ${selectedDaysCount} day${selectedDaysCount === 1 ? '' : 's'}`}
                  >
                    {selectedDaysCount} {selectedDaysCount === 1 ? 'day' : 'days'}
                  </span>
                )}
                {(startDate || endDate) && (
                  <button
                    type="button"
                    className="rounded p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition shrink-0"
                    onClick={() => {
                      setStartDate('');
                      setEndDate('');
                    }}
                    title="Clear date range filter"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}

            {/* Group by Date Option */}
            {dateColumnIndex >= 0 && (
              <button
                type="button"
                onClick={() => setGroupByDate((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition shadow-sm ${
                  groupByDate
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-100'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
                title="Group table entries by Date"
              >
                <Layers className="h-3.5 w-3.5" />
                {groupByDate ? 'Grouped by Date' : 'Group by Date'}
              </button>
            )}

            <span className="text-xs font-semibold text-slate-500 px-1">
              {visibleRows.length} / {rows.length}
            </span>

            {enablePrint ? (
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 transition"
                title="Print table report"
                onClick={printVisibleRows}
              >
                <Printer className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        className={`overflow-auto ${maxBodyHeightClass} ${selectableRows ? 'outline-none focus:ring-2 focus:ring-indigo-200' : ''}`}
        tabIndex={selectableRows ? 0 : undefined}
        aria-label={ariaLabel}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            handleArrowNavigation('down');
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            handleArrowNavigation('up');
          }
        }}
      >
        <table className={`min-w-full divide-y divide-slate-100 ${tableTextClass}`}>
          <thead className="sticky top-0 z-10 bg-mist text-left text-slate">
            <tr>
              {headers.map((header, headerIndex) => {
                const SortIcon = sortState?.column === headerIndex
                  ? sortState.direction === 'asc'
                    ? ArrowDownAZ
                    : ArrowUpAZ
                  : ArrowUpDown;
                return (
                  <th key={header} className={`${cellPaddingClass} font-semibold`}>
                    {enableSort ? (
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 text-left font-semibold"
                        onClick={() => toggleSort(headerIndex)}
                        title={`Sort by ${header}`}
                      >
                        <span>{header}</span>
                        <SortIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      </button>
                    ) : header}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {dateGroupedRows ? (
              dateGroupedRows.map((group) => {
                const isCollapsed = Boolean(collapsedGroups[group.dateKey]);
                return (
                  <tbody key={`group-${group.dateKey}`} className="divide-y divide-slate-100 border-b-2 border-slate-200">
                    <tr className="bg-slate-100/90 font-bold border-y border-slate-200">
                      <td colSpan={headers.length} className="px-3 py-2 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <button
                            type="button"
                            className="flex items-center gap-1.5 font-black text-graphite hover:text-indigo-700"
                            onClick={() => setCollapsedGroups((c) => ({ ...c, [group.dateKey]: !c[group.dateKey] }))}
                          >
                            <ChevronRight className={`h-4 w-4 text-emerald-600 transition-transform ${!isCollapsed ? 'rotate-90' : ''}`} />
                            <span>{group.dateKey}</span>
                            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-extrabold text-slate-600 border border-slate-200">
                              {group.items.length} {group.items.length === 1 ? 'entry' : 'entries'}
                            </span>
                          </button>
                          {Object.keys(group.subtotals).length > 0 && (
                            <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-700">
                              {Object.entries(group.subtotals).map(([colIdx, sum]) => (
                                <span key={colIdx} className="bg-white px-2 py-0.5 rounded border border-slate-200 text-emerald-800 font-extrabold">
                                  {headers[Number(colIdx)]}: {formatSubtotalValue(sum)}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                    {!isCollapsed && group.items.map(renderTableRow)}
                  </tbody>
                );
              })
            ) : (
              visibleRows.map(renderTableRow)
            )}
            {visibleRows.length === 0 ? (
              <tr>
                <td className={`${cellPaddingClass} text-center text-slate-500`} colSpan={headers.length}>
                  No rows match the current search or filters.
                </td>
              </tr>
            ) : null}
          </tbody>
          {footerRows.length ? (
            <tfoot className="sticky bottom-0 z-10 border-t border-slate-200 bg-white">
              {footerRows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className={`${cellPaddingClass} break-words text-graphite align-top`}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}
