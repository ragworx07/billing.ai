export function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
}

export function localDateKey(date: Date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDaysToDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.slice(0, 10).split('-').map(Number);
  return localDateKey(new Date(year, month - 1, day + days));
}

export function formatDate(value?: string | null) {
  if (!value) {
    return '-';
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatCodeId(prefix: string, id: number | string | null | undefined): string {
  if (id === null || id === undefined || id === '') return '-';
  const num = Number(id);
  if (Number.isNaN(num)) return `${prefix}${id}`;
  return `${prefix}${num.toString().padStart(3, '0')}`;
}

export function formatMaterialId(id: number | string | null | undefined): string {
  return formatCodeId('M', id);
}

export function formatVendorId(id: number | string | null | undefined): string {
  return formatCodeId('V', id);
}

export function formatLabourInchargeId(id: number | string | null | undefined): string {
  return formatCodeId('L', id);
}

export function formatWorkerId(id: number | string | null | undefined): string {
  return formatCodeId('W', id);
}

export function calculateMaterialSubtotal(quantity?: number | null, unitCost?: number | null): number {
  return Number(quantity || 0) * Number(unitCost || 0);
}

export function calculateMaterialGst(quantity?: number | null, unitCost?: number | null, gstPercent?: number | null): number {
  const subtotal = calculateMaterialSubtotal(quantity, unitCost);
  return subtotal * (Number(gstPercent || 0) / 100);
}

export function calculateMaterialTotal(item: { quantity?: number | null; unit_cost?: number | null; gst_percent?: number | null; transport_cost?: number | null }): number {
  const subtotal = calculateMaterialSubtotal(item.quantity, item.unit_cost);
  const gst = calculateMaterialGst(item.quantity, item.unit_cost, item.gst_percent);
  const transport = Number(item.transport_cost || 0);
  return subtotal + gst + transport;
}

export function vendorPaymentTotal(item: { amount?: number | null; round_off?: number | null }): number {
  return Number((Number(item.amount || 0) + Number(item.round_off || 0)).toFixed(2));
}

export function slugify(text?: string | null): string {
  if (!text) return 'item';
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';
}
