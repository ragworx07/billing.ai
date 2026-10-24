import { useMemo } from 'react';
import { Building2, Calendar, FileText, Layers, Package, Printer, TrendingUp, X } from 'lucide-react';

import { DataTable } from './DataTable';
import type { MaterialLog, MaterialMaster } from '../types/api';
import { calculateMaterialTotal, formatCurrency, formatDate, formatMaterialId } from '../utils/format';

interface StockItemLedgerModalProps {
  item: Partial<MaterialMaster> & { name: string };
  logs: MaterialLog[];
  projectsMap: Record<number, string>;
  onClose: () => void;
}

export function StockItemLedgerModal({ item, logs, projectsMap, onClose }: StockItemLedgerModalProps) {
  // Filter logs for this specific material name (case-insensitive)
  const itemLogs = useMemo(() => {
    const targetName = item.name.trim().toLowerCase();
    return [...logs]
      .filter((log) => log.material_name.trim().toLowerCase() === targetName)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || b.id - a.id);
  }, [logs, item.name]);

  // Aggregate stats
  const { totalQty, totalSpend, weightedAvgRate, projectBreakdown } = useMemo(() => {
    let qtySum = 0;
    let spendSum = 0;
    const projectMap: Record<number, { projectId: number; projectName: string; qty: number; spend: number }> = {};

    for (const log of itemLogs) {
      const q = Number(log.quantity || 0);
      const totalCost = calculateMaterialTotal(log);
      qtySum += q;
      spendSum += totalCost;

      const pId = log.project_id;
      const pName = projectsMap[pId] || `Job #${pId}`;
      if (!projectMap[pId]) {
        projectMap[pId] = { projectId: pId, projectName: pName, qty: 0, spend: 0 };
      }
      projectMap[pId].qty += q;
      projectMap[pId].spend += totalCost;
    }

    const avgRate = qtySum > 0 ? spendSum / qtySum : Number(item.default_unit_cost || 0);

    const sortedProjects = Object.values(projectMap).sort((a, b) => b.spend - a.spend);

    return {
      totalQty: qtySum,
      totalSpend: spendSum,
      weightedAvgRate: avgRate,
      projectBreakdown: sortedProjects,
    };
  }, [itemLogs, projectsMap, item.default_unit_cost]);

  const unit = item.unit || itemLogs[0]?.unit || 'units';
  const code = item.id ? formatMaterialId(item.id) : 'ITEM';

  function handlePrint() {
    window.print();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/50 p-2 sm:p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl my-6 rounded-2xl bg-white shadow-2xl overflow-hidden border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/80 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-700">
              <Package className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-slate-200/80 px-2 py-0.5 text-xs font-mono font-bold text-slate-700">
                  {code}
                </span>
                <h2 className="text-xl font-black text-graphite tracking-tight">{item.name}</h2>
              </div>
              <p className="mt-0.5 text-xs font-medium text-slate-500">
                Item Stock Ledger · Standard Rate: {formatCurrency(item.default_unit_cost || 0)} / {unit} · Default Vendor: {item.supplier || 'Various'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-xs hover:bg-slate-50 transition"
            >
              <Printer className="h-3.5 w-3.5" />
              Print Ledger
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 transition"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-amber-200/80 bg-amber-50/50 p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-800">Total Inward Qty</p>
              <p className="mt-1 text-2xl font-black text-amber-950">
                {totalQty.toLocaleString('en-IN')} <span className="text-sm font-semibold text-amber-800">{unit}</span>
              </p>
              <p className="mt-1 text-[11px] text-amber-700/80">From {itemLogs.length} purchase vouchers</p>
            </div>

            <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/50 p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">Total Procurement Value</p>
              <p className="mt-1 text-2xl font-black text-emerald-950">{formatCurrency(totalSpend)}</p>
              <p className="mt-1 text-[11px] text-emerald-700/80">Inclusive of GST & freight</p>
            </div>

            <div className="rounded-2xl border border-indigo-200/80 bg-indigo-50/50 p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-800">Weighted Avg. Rate</p>
              <p className="mt-1 text-2xl font-black text-indigo-950">
                {formatCurrency(weightedAvgRate)} <span className="text-xs font-normal text-indigo-700">/{unit}</span>
              </p>
              <p className="mt-1 text-[11px] text-indigo-700/80">Std: {formatCurrency(item.default_unit_cost || 0)}</p>
            </div>

            <div className="rounded-2xl border border-blue-200/80 bg-blue-50/50 p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-blue-800">Projects / Cost Centers</p>
              <p className="mt-1 text-2xl font-black text-blue-950">{projectBreakdown.length}</p>
              <p className="mt-1 text-[11px] text-blue-700/80">Allocated jobs</p>
            </div>
          </div>

          {/* Project-wise Allocation Breakdown */}
          {projectBreakdown.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="flex items-center gap-2 mb-3">
                <Building2 className="h-4 w-4 text-slate-500" />
                <h3 className="text-sm font-bold text-graphite uppercase tracking-wide">
                  Project / Cost Center Allocation
                </h3>
              </div>
              <div className="space-y-3">
                {projectBreakdown.map((pb) => {
                  const pct = totalSpend > 0 ? (pb.spend / totalSpend) * 100 : 0;
                  return (
                    <div key={pb.projectId} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="font-bold text-graphite">{pb.projectName}</span>
                        <div className="flex items-center gap-4 text-xs font-semibold text-slate-600">
                          <span>
                            {pb.qty.toLocaleString('en-IN')} {unit}
                          </span>
                          <span className="font-bold text-slate-900">{formatCurrency(pb.spend)}</span>
                          <span className="rounded-md bg-indigo-100 px-2 py-0.5 font-bold text-indigo-700">
                            {pct.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full bg-indigo-600 transition-all duration-300"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Chronological Stock Vouchers / Inward Movement Table */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-slate-500" />
                <h3 className="text-sm font-bold text-graphite uppercase tracking-wide">
                  Chronological Inward Vouchers ({itemLogs.length})
                </h3>
              </div>
            </div>

            {itemLogs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                No inward stock movement recorded for this item yet. Use the "+ Inward Stock Voucher" button to record
                purchases.
              </div>
            ) : (
              <DataTable
                size="compact"
                headers={[
                  'S.No',
                  'Date',
                  'Bill / Voucher',
                  'Project',
                  'Vendor',
                  'Quantity',
                  'Rate',
                  'Landed Cost',
                  'Remarks',
                ]}
                rows={itemLogs.map((log, index) => {
                  const landed = calculateMaterialTotal(log);
                  const pName = projectsMap[log.project_id] || `#${log.project_id}`;
                  return [
                    <span className="font-mono text-xs text-slate-400">{index + 1}</span>,
                    <span className="whitespace-nowrap text-xs font-semibold">{formatDate(log.date)}</span>,
                    <span className="font-mono text-xs font-bold text-slate-800">{log.bill_no || '—'}</span>,
                    <span className="text-xs font-semibold text-graphite">{pName}</span>,
                    <span className="text-xs text-slate-600">{log.supplier || '—'}</span>,
                    <span className="text-xs font-bold text-slate-900">
                      {Number(log.quantity || 0).toLocaleString('en-IN')} {log.unit}
                    </span>,
                    <span className="text-xs text-slate-700">{formatCurrency(log.unit_cost)}</span>,
                    <span className="text-xs font-black text-emerald-800">{formatCurrency(landed)}</span>,
                    <span className="text-xs text-slate-500 truncate max-w-xs block" title={log.work_remarks || ''}>
                      {log.work_remarks || '—'}
                    </span>,
                  ];
                })}
                footerRows={[
                  [
                    '',
                    '',
                    '',
                    'Total',
                    '',
                    <span className="font-black text-slate-900">
                      {totalQty.toLocaleString('en-IN')} {unit}
                    </span>,
                    '',
                    <span className="font-black text-emerald-900">{formatCurrency(totalSpend)}</span>,
                    '',
                  ],
                ]}
              />
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
