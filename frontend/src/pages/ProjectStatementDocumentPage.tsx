import { useQuery } from '@tanstack/react-query';
import { useLocation, useParams } from 'react-router-dom';

import kkrLogo from '../assets/kkr-logo.png';
import { BuildingLoader } from '../components/BuildingLoader';
import { api } from '../services/api';
import { formatCurrency, formatDate, calculateMaterialTotal, vendorPaymentTotal } from '../utils/format';

const statementSections = ['summary', 'materials', 'labour', 'expenses', 'transactions', 'files', 'timeline'] as const;

function usePrintOptions() {
  const { search } = useLocation();
  const q = new URLSearchParams(search);
  const hasExplicitSections = statementSections.some((name) => q.has(name));
  const on = (name: typeof statementSections[number]) => !hasExplicitSections || q.get(name) === '1';
  return {
    role: q.get('role') || 'owner',
    summary: on('summary'),
    materials: on('materials'),
    labour: on('labour'),
    expenses: on('expenses'),
    transactions: on('transactions'),
    files: on('files'),
    timeline: on('timeline'),
  };
}

function formatFileSize(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function moneyOrDash(value: number) {
  return value ? formatCurrency(value) : '-';
}

export function ProjectStatementDocumentPage() {
  const { projectId } = useParams();
  const id = Number(projectId || 0);
  const printOptions = usePrintOptions();
  const isSupervisorPrint = printOptions.role === 'supervisor';

  const { data: statement } = useQuery({ queryKey: ['project-statement-document', id], queryFn: () => api.getProjectStatement(id), enabled: id > 0 });
  const { data: materials = [] } = useQuery({ queryKey: ['materials', id], queryFn: () => api.getMaterials(id), enabled: id > 0 });
  const { data: expenses = [] } = useQuery({ queryKey: ['expenses', id], queryFn: () => api.getExpenses(id), enabled: id > 0 });
  const { data: siteExpenses = [] } = useQuery({ queryKey: ['site-expenses', id], queryFn: () => api.getSiteExpenses({ allocation: 'project', project_id: id }), enabled: id > 0 });
  const { data: laborLogs = [] } = useQuery({ queryKey: ['labor-logs', id], queryFn: () => api.getLaborLogs(id), enabled: id > 0 });
  const { data: payments = [] } = useQuery({ queryKey: ['payments', id], queryFn: () => api.getPayments(id), enabled: id > 0 });
  const { data: vendorMaster = [] } = useQuery({ queryKey: ['vendor-master'], queryFn: () => api.getVendorMaster(), enabled: id > 0 });
  const { data: vendorTransactions = [] } = useQuery({ queryKey: ['vendor-transactions', id], queryFn: () => api.getVendorTransactions(id), enabled: id > 0 });
  const { data: fileBoard = { folders: [], files: [] } } = useQuery({ queryKey: ['project-files-statement', id], queryFn: () => api.getProjectFiles(id), enabled: id > 0 });

  if (!statement) return <BuildingLoader label="Compiling Statement..." sublabel="Generating official project statement document" />;

  const projectMaterials = materials.filter((item) => item.project_id === id).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const projectExpenses = [
    ...expenses.filter((item) => item.project_id === id).map((item) => ({ key: `expense-${item.id}`, date: item.date, category: item.category, description: item.description, amount: Number(item.amount || 0) })),
    ...siteExpenses.map((item) => ({ key: `site-expense-${item.id}`, date: item.date, category: item.item_name || item.category, description: item.description ? `${item.description} (site expense)` : 'Site expense', amount: Number(item.amount || 0) })),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const projectLaborLogs = laborLogs.filter((item) => item.project_id === id).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const projectPayments = payments.filter((item) => item.project_id === id).sort((a, b) => new Date((a.received_date || a.due_date || '')).getTime() - new Date((b.received_date || b.due_date || '')).getTime());
  const projectVendorTransactions = vendorTransactions
    .filter((item) => item.project_id === id)
    .sort((a, b) => new Date(a.payment_date).getTime() - new Date(b.payment_date).getTime());
  const projectFiles = fileBoard.files.slice().sort((a, b) => a.original_filename.localeCompare(b.original_filename));

  const getVendorName = (vendorId?: number | null) => {
    if (!vendorId) return 'Unassigned';
    return vendorMaster.find((item) => item.id === vendorId)?.name || `Vendor #${vendorId}`;
  };
  const getFolderName = (folderId?: number | null) => {
    if (!folderId) return 'Root';
    return fileBoard.folders.find((folder) => folder.id === folderId)?.name || `Folder #${folderId}`;
  };

  const materialTotal = projectMaterials.reduce((sum, row) => sum + calculateMaterialTotal(row), 0);
  const labourTotal = projectLaborLogs.reduce((sum, row) => sum + Number(row.total_wage || 0), 0);
  const expenseTotal = projectExpenses.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const transactionTotal = projectVendorTransactions.reduce((sum, row) => sum + vendorPaymentTotal(row), 0);
  const transactionRoundOffTotal = projectVendorTransactions.reduce((sum, row) => sum + Number(row.round_off || 0), 0);
  const constructionSqft = Number(statement.project.construction_sqft || 0);
  const spentPerSqft = constructionSqft > 0 ? statement.metrics.total_cost / constructionSqft : 0;
  const plannedRatePerSqft = Number(statement.project.construction_rate_per_sqft || 0);
  const remainingPerSqft = Math.max(plannedRatePerSqft - spentPerSqft, 0);

  const vendorBalances = new Map<number, { vendorId: number; vendorName: string; materialDue: number; labourDue: number; paid: number; materialCount: number; labourCount: number; paymentCount: number }>();
  const ensureVendorBalance = (vendorId: number) => {
    const existing = vendorBalances.get(vendorId);
    if (existing) return existing;
    const row = { vendorId, vendorName: getVendorName(vendorId), materialDue: 0, labourDue: 0, paid: 0, materialCount: 0, labourCount: 0, paymentCount: 0 };
    vendorBalances.set(vendorId, row);
    return row;
  };
  projectMaterials.forEach((row) => {
    const balance = ensureVendorBalance(row.vendor_id || 0);
    balance.materialDue += calculateMaterialTotal(row);
    balance.materialCount += 1;
  });
  projectLaborLogs.forEach((row) => {
    const balance = ensureVendorBalance(row.vendor_id || 0);
    balance.labourDue += Number(row.total_wage || 0);
    balance.labourCount += 1;
  });
  projectVendorTransactions.forEach((row) => {
    const balance = ensureVendorBalance(row.vendor_id);
    balance.paid += vendorPaymentTotal(row);
    balance.paymentCount += 1;
  });
  const vendorBalanceRows = Array.from(vendorBalances.values())
    .map((row) => ({ ...row, totalDue: row.materialDue + row.labourDue, balance: row.materialDue + row.labourDue - row.paid }))
    .sort((a, b) => a.vendorName.localeCompare(b.vendorName));
  const materialVendorRows = vendorBalanceRows.filter((row) => row.materialDue > 0 || row.materialCount > 0);
  const labourInchargeRows = vendorBalanceRows.filter((row) => row.labourDue > 0 || row.labourCount > 0);

  const sectionClass = 'report-section';
  const tableClass = 'report-table';
  const rightClass = 'text-right';

  return (
    <div className="statement-doc mx-auto max-w-6xl bg-white px-8 py-6 text-slate-950">
      <style>{`
        .statement-doc { font-family: Arial, sans-serif; color: #111827; }
        .statement-doc * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .statement-header { display: grid; grid-template-columns: 1.35fr 1fr; gap: 12px; border-bottom: 3px solid #1f2937; padding-bottom: 10px; margin-bottom: 12px; }
        .statement-brand { display: flex; align-items: flex-start; gap: 12px; min-width: 0; }
        .statement-logo { width: 118px; max-height: 74px; object-fit: contain; flex: 0 0 auto; }
        .statement-heading { min-width: 0; }
        .statement-title { margin: 0; font-size: 24px; line-height: 1.1; letter-spacing: 0; color: #111827; }
        .statement-subtitle { margin: 4px 0 0; color: #475569; font-size: 12px; }
        .header-meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; font-size: 11px; }
        .header-meta div, .metric-card { border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 8px; background: #f8fafc; }
        .label { display: block; color: #64748b; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
        .value { display: block; margin-top: 2px; color: #0f172a; font-size: 12px; font-weight: 800; overflow-wrap: anywhere; }
        .metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-bottom: 14px; }
        .metric-card .value { font-size: 14px; }
        .metric-card:nth-child(1), .metric-card:nth-child(2), .metric-card:nth-child(7), .metric-card:nth-child(8) { background: #eff6ff; border-color: #bfdbfe; }
        .metric-card:nth-child(3), .metric-card:nth-child(5), .metric-card:nth-child(6) { background: #f0fdf4; border-color: #bbf7d0; }
        .metric-card:nth-child(4) { background: #fff1f2; border-color: #fecdd3; }
        .report-section { margin: 0 0 16px; break-inside: avoid; page-break-inside: avoid; }
        .section-title { margin: 0 0 7px; border-bottom: 2px solid #94a3b8; padding: 0 0 4px; color: #0f172a; font-size: 15px; font-weight: 800; }
        .report-table { width: 100%; border-collapse: collapse; font-size: 11px; table-layout: auto; }
        .report-table th, .report-table td { border: 1px solid #cbd5e1; padding: 6px 7px; text-align: left; vertical-align: top; line-height: 1.3; overflow-wrap: anywhere; }
        .report-table th { background: #1f2937; color: #ffffff; font-weight: 800; }
        .report-table tbody tr:nth-child(even) td { background: #f8fafc; }
        .report-table tfoot td { background: #eff6ff; color: #0f172a; font-weight: 800; }
        .text-right { text-align: right !important; }
        .summary-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; font-size: 11px; }
        .summary-grid div { border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 8px; background: #ffffff; }
        .page-break { page-break-before: always; break-before: page; }
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          .statement-doc { padding: 0 !important; max-width: 100% !important; }
          .statement-header { margin-bottom: 8px; padding-bottom: 7px; }
          .statement-logo { width: 96px; max-height: 58px; }
          .statement-title { font-size: 20px; }
          .statement-subtitle { font-size: 10px; }
          .metric-grid { gap: 5px; margin-bottom: 9px; }
          .metric-card { padding: 4px 6px; }
          .metric-card .value { font-size: 12px; }
          .report-section { margin-bottom: 11px; }
          .report-table { font-size: 9.5px; }
          .report-table th, .report-table td { padding: 4px 5px; }
          thead { display: table-header-group; }
          tr { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      <header className="statement-header">
        <div className="statement-brand">
          <img src={kkrLogo} alt="KKR Developers and Foundations" className="statement-logo" />
          <div className="statement-heading">
            <h1 className="statement-title">Project Statement</h1>
            <p className="statement-subtitle">Owner report for project cost, collections, vendor payments, files, and site activity.</p>
          </div>
        </div>
        <div className="header-meta">
          <div><span className="label">Project</span><span className="value">{statement.project.project_name}</span></div>
          <div><span className="label">Generated</span><span className="value">{formatDate(new Date().toISOString())}</span></div>
          <div><span className="label">Location</span><span className="value">{statement.project.location || '-'}</span></div>
          <div><span className="label">Status</span><span className="value">{statement.project.status}</span></div>
        </div>
      </header>

      <div className="mb-3 flex justify-end gap-2 print:hidden">
        <button className="border border-slate-300 px-3 py-2 text-xs hover:bg-slate-50" onClick={() => window.history.back()}>Back</button>
        <button className="border border-slate-950 bg-slate-950 px-3 py-2 text-xs text-white hover:bg-slate-800" onClick={() => window.print()}>Print Statement</button>
      </div>

      {!isSupervisorPrint ? (
        <section className="metric-grid">
          <div className="metric-card"><span className="label">Total Project Value</span><span className="value">{formatCurrency(statement.project.total_amount)}</span></div>
          <div className="metric-card"><span className="label">Total Cost</span><span className="value">{formatCurrency(statement.metrics.total_cost)}</span></div>
          <div className="metric-card"><span className="label">Received</span><span className="value">{formatCurrency(statement.metrics.total_received)}</span></div>
          <div className="metric-card"><span className="label">Outstanding</span><span className="value">{formatCurrency(statement.metrics.outstanding)}</span></div>
          <div className="metric-card"><span className="label">Profit</span><span className="value">{formatCurrency(statement.metrics.profit)}</span></div>
          <div className="metric-card"><span className="label">Profit %</span><span className="value">{statement.metrics.profit_percentage.toFixed(2)}%</span></div>
          <div className="metric-card"><span className="label">Spent / Sqft</span><span className="value">{moneyOrDash(spentPerSqft)}</span></div>
          <div className="metric-card"><span className="label">Remaining / Sqft</span><span className="value">{moneyOrDash(remainingPerSqft)}</span></div>
        </section>
      ) : null}

      {printOptions.summary ? (
        <section className={sectionClass}>
          <h2 className="section-title">Project Summary</h2>
          <div className="summary-grid">
            <div><span className="label">Project ID</span><span className="value">{statement.project.id}</span></div>
            <div><span className="label">Start Date</span><span className="value">{formatDate(statement.project.start_date)}</span></div>
            <div><span className="label">Expected End</span><span className="value">{formatDate(statement.project.expected_end_date)}</span></div>
            <div><span className="label">Construction Sqft</span><span className="value">{constructionSqft || '-'}</span></div>
            <div><span className="label">Rate / Sqft</span><span className="value">{moneyOrDash(plannedRatePerSqft)}</span></div>
            <div><span className="label">Created On</span><span className="value">{formatDate(statement.project.created_at)}</span></div>
          </div>
        </section>
      ) : null}

      {printOptions.materials ? (
        <section className={sectionClass}>
          <h2 className="section-title">Material Statement</h2>
          <table className={tableClass}>
            <thead><tr><th>Date</th><th>Bill No</th><th>Material</th><th>Vendor</th><th className={rightClass}>Qty</th><th>Unit</th>{!isSupervisorPrint ? <th className={rightClass}>Rate</th> : null}{!isSupervisorPrint ? <th className={rightClass}>Subtotal</th> : null}<th>Remarks</th></tr></thead>
            <tbody>
              {projectMaterials.length === 0 ? <tr><td className="text-center" colSpan={isSupervisorPrint ? 7 : 9}>No materials found</td></tr> : null}
              {projectMaterials.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.date)}</td>
                  <td>{row.bill_no || '-'}</td>
                  <td>{row.material_name}</td>
                  <td>{getVendorName(row.vendor_id)}</td>
                  <td className={rightClass}>{row.quantity}</td>
                  <td>{row.unit}</td>
                  {!isSupervisorPrint ? <td className={rightClass}>{formatCurrency(row.unit_cost)}</td> : null}
                  {!isSupervisorPrint ? <td className={rightClass}>{formatCurrency(calculateMaterialTotal(row))}</td> : null}
                  <td>{row.work_remarks || '-'}</td>
                </tr>
              ))}
            </tbody>
            {!isSupervisorPrint ? <tfoot><tr><td colSpan={7}>Material Subtotal</td><td className={rightClass}>{formatCurrency(materialTotal)}</td><td /></tr></tfoot> : null}
          </table>
        </section>
      ) : null}

      {printOptions.labour ? (
        <section className={sectionClass}>
          <h2 className="section-title">Labour Statement</h2>
          <table className={tableClass}>
            <thead><tr><th>Date</th><th>Labour Type</th><th>Incharge</th><th className={rightClass}>Count</th>{!isSupervisorPrint ? <th className={rightClass}>Wage / Head</th> : null}{!isSupervisorPrint ? <th className={rightClass}>OT Total</th> : null}{!isSupervisorPrint ? <th className={rightClass}>Day Cost</th> : null}<th>Remarks</th></tr></thead>
            <tbody>
              {projectLaborLogs.length === 0 ? <tr><td className="text-center" colSpan={isSupervisorPrint ? 5 : 8}>No labour entries found</td></tr> : null}
              {projectLaborLogs.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.date)}</td>
                  <td>{row.labour_type}</td>
                  <td>{getVendorName(row.vendor_id)}</td>
                  <td className={rightClass}>{row.labour_count}</td>
                  {!isSupervisorPrint ? <td className={rightClass}>{formatCurrency(row.wage_per_head)}</td> : null}
                  {!isSupervisorPrint ? <td className={rightClass}>{formatCurrency(row.overtime_cost || 0)}</td> : null}
                  {!isSupervisorPrint ? <td className={rightClass}>{formatCurrency(row.total_wage || 0)}</td> : null}
                  <td>{row.remarks || '-'}</td>
                </tr>
              ))}
            </tbody>
            {!isSupervisorPrint ? <tfoot><tr><td colSpan={6}>Labour Subtotal</td><td className={rightClass}>{formatCurrency(labourTotal)}</td><td /></tr></tfoot> : null}
          </table>
        </section>
      ) : null}

      {printOptions.expenses ? (
        <section className={sectionClass}>
          <h2 className="section-title">Expense Statement</h2>
          <table className={tableClass}>
            <thead><tr><th>Date</th><th>Expense</th><th>Description</th>{!isSupervisorPrint ? <th className={rightClass}>Amount</th> : null}</tr></thead>
            <tbody>
              {projectExpenses.length === 0 ? <tr><td className="text-center" colSpan={isSupervisorPrint ? 3 : 4}>No expenses found</td></tr> : null}
              {projectExpenses.map((row) => <tr key={row.key}><td>{formatDate(row.date)}</td><td>{row.category}</td><td>{row.description || '-'}</td>{!isSupervisorPrint ? <td className={rightClass}>{formatCurrency(row.amount)}</td> : null}</tr>)}
            </tbody>
            {!isSupervisorPrint ? <tfoot><tr><td colSpan={3}>Expense Subtotal</td><td className={rightClass}>{formatCurrency(expenseTotal)}</td></tr></tfoot> : null}
          </table>
        </section>
      ) : null}

      {printOptions.transactions && !isSupervisorPrint ? (
        <section className={sectionClass}>
          <h2 className="section-title">Vendor And Incharge Payment Summary</h2>
          <table className={`${tableClass} mb-3`}>
            <thead><tr><th>Vendor For Materials</th><th className={rightClass}>Material Cost</th><th className={rightClass}>Payments</th><th className={rightClass}>Yet To Pay</th><th className={rightClass}>Entries</th></tr></thead>
            <tbody>
              {materialVendorRows.length === 0 ? <tr><td className="text-center" colSpan={5}>No material vendor balances found</td></tr> : null}
              {materialVendorRows.map((row) => <tr key={`mat-${row.vendorId}`}><td>{row.vendorName}</td><td className={rightClass}>{formatCurrency(row.materialDue)}</td><td className={rightClass}>{formatCurrency(row.paid)}</td><td className={rightClass}>{formatCurrency(Math.max(row.materialDue - row.paid, 0))}</td><td className={rightClass}>{row.materialCount}</td></tr>)}
            </tbody>
          </table>
          <table className={tableClass}>
            <thead><tr><th>Labour Incharge</th><th className={rightClass}>Labour Cost</th><th className={rightClass}>Payments</th><th className={rightClass}>Yet To Pay</th><th className={rightClass}>Entries</th></tr></thead>
            <tbody>
              {labourInchargeRows.length === 0 ? <tr><td className="text-center" colSpan={5}>No labour incharge balances found</td></tr> : null}
              {labourInchargeRows.map((row) => <tr key={`lab-${row.vendorId}`}><td>{row.vendorName}</td><td className={rightClass}>{formatCurrency(row.labourDue)}</td><td className={rightClass}>{formatCurrency(row.paid)}</td><td className={rightClass}>{formatCurrency(Math.max(row.labourDue - row.paid, 0))}</td><td className={rightClass}>{row.labourCount}</td></tr>)}
            </tbody>
          </table>
        </section>
      ) : null}

      {printOptions.transactions && !isSupervisorPrint ? (
        <section className={sectionClass}>
          <h2 className="section-title">All Vendor Payments</h2>
          <table className={tableClass}>
            <thead><tr><th>Date</th><th>Vendor / Incharge</th><th>Mode</th><th>Remarks</th><th className={rightClass}>Round Off</th><th className={rightClass}>Amount Paid</th></tr></thead>
            <tbody>
              {projectVendorTransactions.length === 0 ? <tr><td className="text-center" colSpan={6}>No payments found</td></tr> : null}
              {projectVendorTransactions.map((row) => <tr key={row.id}><td>{formatDate(row.payment_date)}</td><td>{getVendorName(row.vendor_id)}</td><td>{row.payment_mode || '-'}</td><td>{row.notes || '-'}</td><td className={rightClass}>{formatCurrency(Number(row.round_off || 0))}</td><td className={rightClass}>{formatCurrency(vendorPaymentTotal(row))}</td></tr>)}
            </tbody>
            <tfoot><tr><td colSpan={4}>Vendor Payment Total</td><td className={rightClass}>{formatCurrency(transactionRoundOffTotal)}</td><td className={rightClass}>{formatCurrency(transactionTotal)}</td></tr></tfoot>
          </table>
        </section>
      ) : null}

      {!isSupervisorPrint ? (
        <section className={sectionClass}>
          <h2 className="section-title">Client Payments</h2>
          <table className={tableClass}>
            <thead><tr><th>Type</th><th>Mode</th><th>Due Date</th><th>Received Date</th><th className={rightClass}>Amount</th><th>Status</th><th>Notes</th></tr></thead>
            <tbody>
              {projectPayments.length === 0 ? <tr><td className="text-center" colSpan={7}>No client payments found</td></tr> : null}
              {projectPayments.map((row) => <tr key={row.id}><td>{row.payment_type}</td><td>{row.payment_mode || '-'}</td><td>{formatDate(row.due_date)}</td><td>{formatDate(row.received_date)}</td><td className={rightClass}>{formatCurrency(row.amount)}</td><td>{row.status}</td><td>{row.notes || '-'}</td></tr>)}
            </tbody>
          </table>
        </section>
      ) : null}

      {printOptions.files ? (
        <section className={sectionClass}>
          <h2 className="section-title">Project Files</h2>
          <table className={tableClass}>
            <thead><tr><th>Folder</th><th>File Name</th><th>Type</th><th className={rightClass}>Original Size</th><th className={rightClass}>Stored Size</th><th>Uploaded On</th></tr></thead>
            <tbody>
              {projectFiles.length === 0 ? <tr><td className="text-center" colSpan={6}>No files uploaded</td></tr> : null}
              {projectFiles.map((file) => <tr key={file.id}><td>{getFolderName(file.folder_id)}</td><td>{file.original_filename}</td><td>{file.content_type || '-'}</td><td className={rightClass}>{formatFileSize(file.original_size || 0)}</td><td className={rightClass}>{formatFileSize(file.compressed_size || 0)}</td><td>{formatDate(file.created_at)}</td></tr>)}
            </tbody>
          </table>
        </section>
      ) : null}

      {!isSupervisorPrint ? (
        <div className="mb-4 border-t-2 border-slate-950 pt-2 text-sm font-bold">
          Grand Total Project Cost: {formatCurrency(statement.metrics.total_cost)}
        </div>
      ) : null}

      {printOptions.timeline ? (
        <section className={`${sectionClass} page-break`}>
          <h2 className="section-title">Project Timeline</h2>
          <table className={tableClass}>
            <thead><tr><th>Date</th><th>Type</th><th>Title</th><th>Details</th>{!isSupervisorPrint ? <th className={rightClass}>Amount</th> : null}</tr></thead>
            <tbody>
              {statement.timeline.length === 0 ? <tr><td className="text-center" colSpan={isSupervisorPrint ? 4 : 5}>No timeline activity found</td></tr> : null}
              {statement.timeline.map((item, idx) => (
                <tr key={`${item.type}-${item.date}-${idx}`}>
                  <td>{formatDate(item.date)}</td>
                  <td>{item.type}</td>
                  <td>{item.title}</td>
                  <td>{item.detail}</td>
                  {!isSupervisorPrint ? <td className={rightClass}>{item.amount ? formatCurrency(item.amount) : '-'}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
