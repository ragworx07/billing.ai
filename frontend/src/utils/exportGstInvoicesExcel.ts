import * as ExcelJSNS from 'exceljs';
import type { Border, Borders, Cell, Font, Worksheet } from 'exceljs';

import kkrLogo from '../assets/kkr-logo.png';
import { downloadBlob } from './fileActions';

const ExcelJS =
  (ExcelJSNS as { Workbook?: typeof ExcelJSNS.Workbook }).Workbook
    ? ExcelJSNS
    : ((ExcelJSNS as unknown as { default: typeof ExcelJSNS }).default);
const INR = '"₹"#,##0.00';
const COLS = 16;
const LAST_COL = 'P';

const C = {
  graphite: 'FF1B1B18',
  clay: 'FFB4653D',
  mist: 'FFF7F5F1',
  sand: 'FFEBE0CD',
  white: 'FFFFFFFF',
  muted: 'FF56616F',
  border: 'FFD6D3D1',
  alt: 'FFFAF8F5',
  indigo: 'FF3730A3',
  indigoBg: 'FFEEF2FF',
  emerald: 'FF065F46',
  emeraldBg: 'FFECFDF5',
  rose: 'FF9F1239',
  roseBg: 'FFFEF2F2',
  amber: 'FF92400E',
  amberBg: 'FFFFFBEB',
  totalsBg: 'FFF3EDE4',
};

export type GstInvoiceExcelRow = {
  sno: number;
  billNumber: string;
  billDate: Date | null;
  dueDate: Date | null;
  project: string;
  client: string;
  pan: string;
  entity: string;
  taxable: number;
  cgst: number;
  sgst: number;
  gst: number;
  billTotal: number;
  paid: number;
  balance: number;
  status: string;
};

export type GstInvoiceExcelSummary = {
  count: number;
  taxable: number;
  cgst: number;
  sgst: number;
  gst: number;
  totalBilled: number;
  totalPaid: number;
  totalBalance: number;
  overdueCount: number;
};

export type GstInvoiceExcelBreakdown = {
  label: string;
  count: number;
  taxable: number;
  gst: number;
  billTotal: number;
  paid: number;
  balance: number;
};

type FillColor = { type: 'pattern'; pattern: 'solid'; fgColor: { argb: string } };

function fill(argb: string): FillColor {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function font(opts: Partial<Font> = {}): Partial<Font> {
  return { name: 'Calibri', size: 11, color: { argb: C.graphite }, ...opts };
}

function thinBorder(): Partial<Borders> {
  const edge: Border = { style: 'thin', color: { argb: C.border } };
  return { top: edge, left: edge, bottom: edge, right: edge };
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseLocalDate(value?: string | null): Date | null {
  if (!value || !String(value).trim()) return null;
  const isoDate = String(value).trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    const [year, month, day] = isoDate.split('-').map(Number);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatExcelDate(value: Date | null | undefined): string {
  if (!value || Number.isNaN(value.getTime())) return 'NIL';
  const day = String(value.getDate()).padStart(2, '0');
  return `${day}-${MONTH_SHORT[value.getMonth()]}-${value.getFullYear()}`;
}

function statusFill(status: string) {
  const key = status.toLowerCase();
  if (key === 'paid') return { bg: C.emeraldBg, fg: C.emerald };
  if (key === 'partial') return { bg: C.amberBg, fg: C.amber };
  return { bg: C.roseBg, fg: C.rose };
}

function titleCaseStatus(status: string) {
  if (!status) return 'Unpaid';
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

function sanitizeFilename(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim() || 'export';
}

async function logoBase64() {
  const response = await fetch(kkrLogo);
  const blob = await response.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return dataUrl.replace(/^data:image\/\w+;base64,/, '');
}

function applyHeaderBanner(sheet: Worksheet, title: string, subtitle: string) {
  sheet.mergeCells(`C1:${LAST_COL}1`);
  sheet.mergeCells(`C2:${LAST_COL}2`);
  sheet.mergeCells(`C3:${LAST_COL}3`);
  sheet.mergeCells('A1:B3');

  const company = sheet.getCell('C1');
  company.value = 'KKR DEVELOPERS & FOUNDATIONS';
  company.font = font({ size: 16, bold: true, color: { argb: C.white } });
  company.alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(1).height = 28;

  const heading = sheet.getCell('C2');
  heading.value = title;
  heading.font = font({ size: 13, bold: true, color: { argb: C.white } });
  heading.alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(2).height = 22;

  const meta = sheet.getCell('C3');
  meta.value = subtitle;
  meta.font = font({ size: 10, color: { argb: 'FFE7E5E4' } });
  meta.alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(3).height = 18;

  for (let row = 1; row <= 3; row += 1) {
    for (let col = 1; col <= COLS; col += 1) {
      sheet.getCell(row, col).fill = fill(C.graphite);
    }
  }
}

function moneyCell(cell: Cell, value: number, extra?: { bold?: boolean; color?: string; bg?: string }) {
  cell.value = Number(value || 0);
  cell.numFmt = INR;
  cell.font = font({ bold: extra?.bold, color: extra?.color ? { argb: extra.color } : undefined });
  cell.alignment = { horizontal: 'right', vertical: 'middle' };
  if (extra?.bg) cell.fill = fill(extra.bg);
}

function writeKpiStrip(
  sheet: Worksheet,
  startRow: number,
  summary: GstInvoiceExcelSummary,
) {
  const items: Array<{ label: string; value: number; money?: boolean; color?: string; bg: string }> = [
    { label: 'Invoices', value: summary.count, bg: C.mist },
    { label: 'Taxable value', value: summary.taxable, money: true, bg: C.mist },
    { label: 'CGST', value: summary.cgst, money: true, bg: C.indigoBg, color: C.indigo },
    { label: 'SGST', value: summary.sgst, money: true, bg: C.indigoBg, color: C.indigo },
    { label: 'Total GST', value: summary.gst, money: true, bg: C.indigoBg, color: C.indigo },
    { label: 'Bill total', value: summary.totalBilled, money: true, bg: C.sand },
    { label: 'Collected', value: summary.totalPaid, money: true, bg: C.emeraldBg, color: C.emerald },
    { label: 'Outstanding', value: summary.totalBalance, money: true, bg: C.roseBg, color: C.rose },
  ];

  items.forEach((item, index) => {
    const col = index + 1;
    const labelCell = sheet.getCell(startRow, col);
    const valueCell = sheet.getCell(startRow + 1, col);
    labelCell.value = item.label;
    labelCell.font = font({ size: 9, bold: true, color: { argb: item.color || C.muted } });
    labelCell.fill = fill(item.bg);
    labelCell.alignment = { vertical: 'middle', horizontal: 'left' };
    labelCell.border = thinBorder();
    if (item.money) {
      moneyCell(valueCell, item.value, { bold: true, color: item.color, bg: item.bg });
    } else {
      valueCell.value = item.value;
      valueCell.font = font({ size: 14, bold: true, color: { argb: item.color || C.graphite } });
      valueCell.fill = fill(item.bg);
      valueCell.alignment = { horizontal: 'left', vertical: 'middle' };
    }
    valueCell.border = thinBorder();
  });

  sheet.getRow(startRow).height = 18;
  sheet.getRow(startRow + 1).height = 24;
}

function writeTableHeader(sheet: Worksheet, row: number, headers: string[]) {
  headers.forEach((header, index) => {
    const cell = sheet.getCell(row, index + 1);
    cell.value = header;
    cell.font = font({ size: 10, bold: true, color: { argb: C.white } });
    cell.fill = fill(C.graphite);
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = thinBorder();
  });
  sheet.getRow(row).height = 28;
}

export function billDateValue(value?: string | null) {
  return parseLocalDate(value);
}

export function billingEntityLabel(sealType?: string | null) {
  return sealType === 'foundations' ? 'KKR Foundations' : 'KKR Developers';
}

export async function exportGstInvoiceRegisterExcel({
  rows,
  summary,
  filters,
  byProject,
  byStatus,
}: {
  rows: GstInvoiceExcelRow[];
  summary: GstInvoiceExcelSummary;
  filters: string[];
  byProject: GstInvoiceExcelBreakdown[];
  byStatus: GstInvoiceExcelBreakdown[];
}) {
  if (!ExcelJS?.Workbook) {
    throw new Error('Excel export is unavailable in this environment.');
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'KKR ERP';
  workbook.created = new Date();
  workbook.modified = new Date();

  const generatedAt = new Date().toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const subtitle = [`Generated ${generatedAt}`, ...filters.filter(Boolean)].join('   ·   ');

  let logoId: number | null = null;
  try {
    logoId = workbook.addImage({ base64: await logoBase64(), extension: 'png' });
  } catch {
    logoId = null;
  }

  const register = workbook.addWorksheet('GST Invoice Register', {
    views: [{ state: 'frozen', ySplit: 10, showGridLines: false }],
    pageSetup: {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
    headerFooter: {
      oddFooter: '&LKKR Developers & Foundations&C&P of &N&RConfidential',
    },
  });

  applyHeaderBanner(register, 'GST Invoice Register', subtitle);
  if (logoId !== null) {
    register.addImage(logoId, { tl: { col: 0.2, row: 0.15 }, ext: { width: 108, height: 46 } });
  }

  register.getCell('A5').value = 'SUMMARY';
  register.getCell('A5').font = font({ size: 10, bold: true, color: { argb: C.clay } });
  if (summary.overdueCount > 0) {
    register.mergeCells('B5:D5');
    register.getCell('B5').value = `${summary.overdueCount} overdue invoice${summary.overdueCount === 1 ? '' : 's'}`;
    register.getCell('B5').font = font({ size: 10, bold: true, color: { argb: C.rose } });
  }

  writeKpiStrip(register, 6, summary);

  register.getCell('A9').value = 'INVOICE LIST';
  register.getCell('A9').font = font({ size: 10, bold: true, color: { argb: C.clay } });

  const headers = [
    'S.No',
    'Invoice No',
    'Invoice Date',
    'Due Date',
    'Project',
    'Client',
    'PAN / Company',
    'Billing entity',
    'Taxable value',
    'CGST',
    'SGST',
    'Total GST',
    'Bill total',
    'Paid',
    'Balance',
    'Status',
  ];
  writeTableHeader(register, 10, headers);

  const dataStart = 11;
  rows.forEach((row, index) => {
    const excelRow = register.getRow(dataStart + index);
    const zebra = index % 2 === 1;
    const bg = zebra ? C.alt : C.white;
    const statusColors = statusFill(row.status);

    excelRow.values = [
      row.sno,
      row.billNumber,
      formatExcelDate(row.billDate),
      formatExcelDate(row.dueDate),
      row.project,
      row.client,
      row.pan,
      row.entity,
      row.taxable,
      row.cgst,
      row.sgst,
      row.gst,
      row.billTotal,
      row.paid,
      row.balance,
      titleCaseStatus(row.status),
    ];
    excelRow.height = 20;
    excelRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.border = thinBorder();
      cell.alignment = {
        vertical: 'middle',
        horizontal: colNumber === 1 || colNumber >= 9 ? 'center' : 'left',
        wrapText: colNumber >= 5 && colNumber <= 8,
      };
      cell.font = font({ size: 10 });
      cell.fill = fill(bg);
      if (colNumber === 1) cell.alignment = { vertical: 'middle', horizontal: 'center' };
      if (colNumber === 2) cell.font = font({ size: 10, bold: true, color: { argb: C.indigo } });
      if (colNumber === 3 || colNumber === 4) {
        cell.numFmt = '@';
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        if (cell.value === 'NIL') {
          cell.font = font({ size: 10, italic: true, color: { argb: C.muted } });
        }
      }
      if (colNumber >= 9 && colNumber <= 15) {
        cell.numFmt = INR;
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
        if (colNumber === 12) cell.font = font({ size: 10, bold: true, color: { argb: C.indigo } });
        if (colNumber === 13) cell.font = font({ size: 10, bold: true });
        if (colNumber === 14) cell.font = font({ size: 10, color: { argb: C.emerald } });
        if (colNumber === 15) cell.font = font({ size: 10, bold: true, color: { argb: C.rose } });
      }
      if (colNumber === 16) {
        cell.fill = fill(statusColors.bg);
        cell.font = font({ size: 10, bold: true, color: { argb: statusColors.fg } });
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      }
    });
  });

  const totalsRowNumber = dataStart + Math.max(rows.length, 1);
  const totalsRow = register.getRow(rows.length ? totalsRowNumber : dataStart);
  if (rows.length) {
    const first = dataStart;
    const last = totalsRowNumber - 1;
    totalsRow.getCell(1).value = '';
    totalsRow.getCell(2).value = 'TOTALS';
    totalsRow.getCell(5).value = `${summary.count} invoice${summary.count === 1 ? '' : 's'}`;
    [9, 10, 11, 12, 13, 14, 15].forEach((col) => {
      const letter = register.getColumn(col).letter;
      totalsRow.getCell(col).value = { formula: `SUM(${letter}${first}:${letter}${last})` };
      totalsRow.getCell(col).numFmt = INR;
    });
    totalsRow.height = 22;
    for (let col = 1; col <= COLS; col += 1) {
      const cell = totalsRow.getCell(col);
      cell.fill = fill(C.totalsBg);
      cell.font = font({ size: 10, bold: true, color: { argb: col === 12 ? C.indigo : col === 14 ? C.emerald : col === 15 ? C.rose : C.graphite } });
      cell.border = thinBorder();
      cell.alignment = { vertical: 'middle', horizontal: col >= 9 && col <= 15 ? 'right' : 'left' };
    }
    register.autoFilter = { from: { row: 10, column: 1 }, to: { row: last, column: COLS } };
  }

  const noteRow = (rows.length ? totalsRowNumber : dataStart) + 2;
  register.mergeCells(`A${noteRow}:${LAST_COL}${noteRow}`);
  register.getCell(`A${noteRow}`).value =
    'Amounts in Indian Rupees. This export matches the filters currently applied on the GST Invoices screen.';
  register.getCell(`A${noteRow}`).font = font({ size: 9, italic: true, color: { argb: C.muted } });

  register.columns = [
    { width: 8 },
    { width: 16 },
    { width: 14 },
    { width: 14 },
    { width: 24 },
    { width: 24 },
    { width: 16 },
    { width: 18 },
    { width: 14 },
    { width: 12 },
    { width: 12 },
    { width: 13 },
    { width: 14 },
    { width: 13 },
    { width: 13 },
    { width: 12 },
  ];
  register.pageSetup.printTitlesRow = '1:10';

  const summarySheet = workbook.addWorksheet('GST Summary', {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1, paperSize: 9 },
  });
  summarySheet.properties.defaultColWidth = 16;
  applyHeaderBanner(summarySheet, 'GST Summary', subtitle);
  if (logoId !== null) {
    summarySheet.addImage(logoId, { tl: { col: 0.2, row: 0.15 }, ext: { width: 108, height: 46 } });
  }

  summarySheet.getCell('A5').value = 'OVERALL';
  summarySheet.getCell('A5').font = font({ size: 10, bold: true, color: { argb: C.clay } });
  writeKpiStrip(summarySheet, 6, summary);

  const statusHeaders = ['Status', 'Invoices', 'Taxable value', 'Total GST', 'Bill total', 'Paid', 'Balance'];
  summarySheet.getCell('A9').value = 'BY STATUS';
  summarySheet.getCell('A9').font = font({ size: 10, bold: true, color: { argb: C.clay } });
  writeTableHeader(summarySheet, 10, statusHeaders);
  byStatus.forEach((item, index) => {
    writeBreakdownRow(summarySheet, 11 + index, item, true);
  });
  writeBreakdownTotals(summarySheet, 11 + byStatus.length, byStatus);

  const projectStart = 13 + byStatus.length;
  summarySheet.getCell(`A${projectStart}`).value = 'BY PROJECT';
  summarySheet.getCell(`A${projectStart}`).font = font({ size: 10, bold: true, color: { argb: C.clay } });
  writeTableHeader(summarySheet, projectStart + 1, ['Project', 'Invoices', 'Taxable value', 'Total GST', 'Bill total', 'Paid', 'Balance']);
  byProject.forEach((item, index) => {
    writeBreakdownRow(summarySheet, projectStart + 2 + index, item, false);
  });
  if (byProject.length) {
    writeBreakdownTotals(summarySheet, projectStart + 2 + byProject.length, byProject);
  }

  summarySheet.columns = [
    { width: 28 },
    { width: 12 },
    { width: 16 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
  ];

  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer as ArrayBuffer);
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const dateKey = new Date().toISOString().slice(0, 10);
  return downloadBlob(blob, `${sanitizeFilename(`GST-Invoice-Register-${dateKey}`)}.xlsx`);
}

function writeBreakdownRow(
  sheet: Worksheet,
  rowNumber: number,
  item: GstInvoiceExcelBreakdown,
  statusRow: boolean,
) {
  const row = sheet.getRow(rowNumber);
  const colors = statusRow ? statusFill(item.label) : null;
  row.values = [statusRow ? titleCaseStatus(item.label) : item.label, item.count, item.taxable, item.gst, item.billTotal, item.paid, item.balance];
  row.height = 20;
  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    cell.border = thinBorder();
    cell.font = font({ size: 10, bold: colNumber === 1 });
    cell.alignment = { vertical: 'middle', horizontal: colNumber === 1 ? 'left' : 'right' };
    cell.fill = fill(colors && colNumber === 1 ? colors.bg : rowNumber % 2 === 0 ? C.alt : C.white);
    if (colNumber === 1 && colors) {
      cell.font = font({ size: 10, bold: true, color: { argb: colors.fg } });
    }
    if (colNumber >= 3) cell.numFmt = INR;
  });
}

function writeBreakdownTotals(sheet: Worksheet, rowNumber: number, items: GstInvoiceExcelBreakdown[]) {
  const total = items.reduce(
    (acc, item) => {
      acc.count += item.count;
      acc.taxable += item.taxable;
      acc.gst += item.gst;
      acc.billTotal += item.billTotal;
      acc.paid += item.paid;
      acc.balance += item.balance;
      return acc;
    },
    { count: 0, taxable: 0, gst: 0, billTotal: 0, paid: 0, balance: 0 },
  );
  const row = sheet.getRow(rowNumber);
  row.values = ['Total', total.count, total.taxable, total.gst, total.billTotal, total.paid, total.balance];
  row.height = 22;
  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    cell.border = thinBorder();
    cell.fill = fill(C.totalsBg);
    cell.font = font({ size: 10, bold: true });
    cell.alignment = { vertical: 'middle', horizontal: colNumber === 1 ? 'left' : 'right' };
    if (colNumber >= 3) cell.numFmt = INR;
  });
}
