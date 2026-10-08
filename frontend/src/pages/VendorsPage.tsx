import type { FormEvent } from 'react';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { BookOpen, ClipboardList, Plus, X } from 'lucide-react';

import { DataTable } from '../components/DataTable';
import { RequiredLabel } from '../components/RequiredLabel';
import { SectionCard } from '../components/SectionCard';
import { PageSkeleton } from '../components/Skeleton';
import { VendorRecordBook } from '../components/VendorRecordBook';
import { useAuth } from '../contexts/AuthContext';
import { useNotify } from '../contexts/NotificationContext';
import { api } from '../services/api';
import type { VendorMaster } from '../types/api';
import { hasPermission } from '../utils/access';
import { getApiErrorMessage } from '../utils/errors';
import { formatCurrency, formatDate, formatLabourInchargeId, formatVendorId } from '../utils/format';

type PageView = 'master' | 'record-book';

type PartyType = 'material_vendor' | 'labour_incharge';

const initialForm = {
  name: '',
  work_field: '',
  phone: '',
  address: '',
};

function titleForParty(type: PartyType) {
  return type === 'material_vendor' ? 'Vendor' : 'Labour Incharge';
}

function historyLabel(type?: PartyType) {
  return type === 'labour_incharge' ? 'Labour Incharge Payment History' : 'Vendor Payment History';
}

export function VendorsPage() {
  const { user } = useAuth();
  const notify = useNotify();
  const canViewVendors = hasPermission(user?.role, 'tab_vendors');
  const canViewIncharges = hasPermission(user?.role, 'labour_incharge_detail');
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const pageView: PageView = searchParams.get('view') === 'record-book' ? 'record-book' : 'master';
  const [forms, setForms] = useState<Record<PartyType, typeof initialForm>>({
    material_vendor: initialForm,
    labour_incharge: initialForm,
  });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ ...initialForm, party_type: 'material_vendor' as PartyType });
  const [historyParty, setHistoryParty] = useState<VendorMaster | null>(null);
  const [addPartyType, setAddPartyType] = useState<PartyType | null>(null);

  function setPageView(view: PageView) {
    setAddPartyType(null);
    setHistoryParty(null);
    setEditingId(null);
    setSearchParams(view === 'record-book' ? { view: 'record-book' } : {}, { replace: true });
  }

  const { data: materialVendors = [], isLoading: materialLoading, isError: materialError, error: materialLoadError } = useQuery({
    queryKey: ['vendors', 'material_vendor'],
    queryFn: () => api.getVendorMaster('material_vendor'),
  });
  const { data: labourIncharges = [], isError: labourError, error: labourLoadError } = useQuery({
    queryKey: ['vendors', 'labour_incharge'],
    queryFn: () => api.getVendorMaster('labour_incharge'),
  });
  const { data: materialWorkFields = [] } = useQuery({
    queryKey: ['vendor-work-fields', 'material_vendor'],
    queryFn: () => api.getVendorWorkFields('material_vendor'),
  });
  const { data: labourWorkFields = [] } = useQuery({
    queryKey: ['vendor-work-fields', 'labour_incharge'],
    queryFn: () => api.getVendorWorkFields('labour_incharge'),
  });
  const { data: historyRows = [], isFetching: historyLoading } = useQuery({
    queryKey: ['vendor-payment-history', historyParty?.id],
    queryFn: () => api.getVendorPaymentHistory(historyParty?.id as number),
    enabled: Boolean(historyParty?.id),
  });

  const historyCostTotal = historyRows
    .filter((row) => row.source !== 'Payment')
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const historyPaidTotal = historyRows
    .filter((row) => row.source === 'Payment')
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const historyBalance = historyCostTotal - historyPaidTotal;
  const historyProjectCount = useMemo(
    () => new Set(historyRows.map((row) => row.project_id)).size,
    [historyRows],
  );

  const createMutation = useMutation({
    mutationFn: api.createVendorMaster,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      queryClient.invalidateQueries({ queryKey: ['vendor-master'] });
      queryClient.invalidateQueries({ queryKey: ['vendor-work-fields'] });
      const partyType = (variables.party_type || 'material_vendor') as PartyType;
      setForms((current) => ({ ...current, [partyType]: initialForm }));
      setAddPartyType(null);
      notify.success(`${titleForParty(partyType)} created.`);
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to create record.')),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<VendorMaster> }) => api.updateVendorMaster(id, payload),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      queryClient.invalidateQueries({ queryKey: ['vendor-master'] });
      queryClient.invalidateQueries({ queryKey: ['vendor-work-fields'] });
      queryClient.invalidateQueries({ queryKey: ['vendor-payment-history', variables.id] });
      setEditingId(null);
      notify.success('Master record updated.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to update record.')),
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteVendorMaster,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      queryClient.invalidateQueries({ queryKey: ['vendor-master'] });
      notify.success('Master record deleted.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to delete record.')),
  });

  function submit(event: FormEvent<HTMLFormElement>, partyType: PartyType) {
    event.preventDefault();
    const form = forms[partyType];
    if (!form.name.trim()) return;
    createMutation.mutate({
      name: form.name.trim(),
      party_type: partyType,
      work_field: form.work_field.trim() || null,
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      active: true,
    });
  }

  function updateForm(partyType: PartyType, field: keyof typeof initialForm, value: string) {
    setForms((current) => ({ ...current, [partyType]: { ...current[partyType], [field]: value } }));
  }

  function workFieldsFor(type: PartyType, rows: VendorMaster[], apiFields: string[]) {
    return Array.from(
      new Set([
        ...apiFields,
        ...rows.map((row) => row.work_field || '').filter(Boolean),
      ]),
    ).sort((a, b) => a.localeCompare(b));
  }

  function renderMasterSection(type: PartyType, rows: VendorMaster[], apiFields: string[], isError: boolean, error: unknown) {
    const label = titleForParty(type);
    const fields = workFieldsFor(type, rows, apiFields);
    const form = forms[type];
    const activeEdit = editingId ? rows.find((row) => row.id === editingId) : null;

    return (
      <SectionCard title={`${label} Master List`} action={<button type="button" className="inline-flex items-center gap-2 rounded-xl bg-graphite px-3 py-2 text-sm font-semibold text-white hover:bg-clay" onClick={() => setAddPartyType(type)}><Plus className="h-4 w-4" /> Add {label}</button>}>

        {isError ? (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {getApiErrorMessage(error, `Unable to load ${label.toLowerCase()} master list.`)}
          </div>
        ) : null}

        <DataTable
          auditTableName="vendor_master"
          auditRecordIds={rows.map((item) => item.id)}
          auditRecordLabel={label}
          size="roomy"
          printTitle={`${label} Master List`}
          printMetadata={{
            Module: type === 'material_vendor' ? 'Material Vendors' : 'Labour Incharges',
            Records: rows.length,
          }}
          headers={['S.No.', `${label} ID`, 'Name', 'Field of Work', 'Phone', 'Address', 'Payment History', 'Actions']}
          rows={rows.map((item, index) => {
            const isEditing = editingId === item.id;
            return [
              index + 1,
              type === 'material_vendor' ? formatVendorId(item.id) : formatLabourInchargeId(item.id),
              isEditing ? <input value={editForm.name} onChange={(event) => setEditForm((current) => ({ ...current, name: event.target.value }))} required /> : item.name,
              isEditing ? (
                <>
                  <input
                    list={`${type}-edit-work-field-options`}
                    value={editForm.work_field}
                    onChange={(event) => setEditForm((current) => ({ ...current, work_field: event.target.value }))}
                  />
                  <datalist id={`${type}-edit-work-field-options`}>
                    {fields.map((field) => <option key={field} value={field} />)}
                  </datalist>
                </>
              ) : (item.work_field || '-'),
              isEditing ? <input value={editForm.phone} onChange={(event) => setEditForm((current) => ({ ...current, phone: event.target.value }))} /> : (item.phone || '-'),
              isEditing ? <input value={editForm.address} onChange={(event) => setEditForm((current) => ({ ...current, address: event.target.value }))} /> : (item.address || '-'),
              <button
                type="button"
                className="rounded bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                onClick={() => setHistoryParty(item)}
              >
                Payment History
              </button>,
              isEditing ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded bg-emerald-600 px-2 py-1 text-xs text-white"
                    onClick={() =>
                      updateMutation.mutate({
                        id: item.id,
                        payload: {
                          name: editForm.name.trim(),
                          party_type: editForm.party_type,
                          work_field: editForm.work_field.trim() || null,
                          phone: editForm.phone.trim() || null,
                          address: editForm.address.trim() || null,
                          active: true,
                        },
                      })
                    }
                    disabled={!editForm.name.trim()}
                  >
                    Update
                  </button>
                  <button type="button" className="rounded border border-slate-300 px-2 py-1 text-xs" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded bg-slate-100 px-2 py-1 text-xs"
                    onClick={() => {
                      setEditingId(item.id);
                      setEditForm({
                        name: item.name,
                        party_type: item.party_type,
                        work_field: item.work_field || '',
                        phone: item.phone || '',
                        address: item.address || '',
                      });
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="rounded bg-red-600 px-2 py-1 text-xs text-white"
                    onClick={() => {
                      if (confirm(`Delete ${item.name}?`)) {
                        deleteMutation.mutate(item.id);
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              ),
            ];
          })}
        />
        {activeEdit && activeEdit.party_type !== type ? <div className="mt-2 text-xs text-slate-500">Editing another section.</div> : null}
      </SectionCard>
    );
  }

  if (pageView === 'master' && materialLoading) {
    return <PageSkeleton title cards={2} tableRows={6} />;
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="min-w-0 font-display text-3xl text-graphite">
          {canViewVendors && canViewIncharges
            ? 'Vendors & Labour Incharges'
            : canViewIncharges
              ? 'Labour Incharges'
              : 'Vendors'}
        </h1>
        <div
          role="tablist"
          aria-label="Vendors page view"
          className="grid w-full shrink-0 grid-cols-2 gap-1 self-start rounded-2xl border border-slate-200/90 bg-white p-1 shadow-sm sm:w-[22rem]"
        >
          <button
            type="button"
            role="tab"
            aria-selected={pageView === 'master'}
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold transition ${
              pageView === 'master'
                ? 'bg-graphite text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-50 hover:text-graphite'
            }`}
            onClick={() => setPageView('master')}
          >
            <ClipboardList className="h-4 w-4" />
            Master List
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={pageView === 'record-book'}
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold transition ${
              pageView === 'record-book'
                ? 'bg-graphite text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-50 hover:text-graphite'
            }`}
            onClick={() => setPageView('record-book')}
          >
            <BookOpen className="h-4 w-4" />
            Record Book
          </button>
        </div>
      </div>

      {pageView === 'master' ? (
        <>
          {canViewVendors
            ? renderMasterSection('material_vendor', materialVendors, materialWorkFields, materialError, materialLoadError)
            : null}
          {canViewIncharges
            ? renderMasterSection('labour_incharge', labourIncharges, labourWorkFields, labourError, labourLoadError)
            : null}
        </>
      ) : (
        <VendorRecordBook canViewVendors={canViewVendors} canViewIncharges={canViewIncharges} />
      )}

      {addPartyType ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/45 px-2 py-4 sm:px-4 sm:py-6" onClick={() => setAddPartyType(null)}>
          <div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="add-party-title">
            <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 id="add-party-title" className="text-lg font-bold text-graphite">Add {titleForParty(addPartyType)}</h2>
              <button type="button" className="rounded bg-slate-100 p-2 text-slate-700 hover:bg-slate-200" onClick={() => setAddPartyType(null)} aria-label="Close add form"><X className="h-4 w-4" /></button>
            </div>
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => submit(event, addPartyType)}>
              <div><RequiredLabel label={`${titleForParty(addPartyType)} Name`} required filled={Boolean(forms[addPartyType].name.trim())} /><input autoFocus value={forms[addPartyType].name} onChange={(event) => updateForm(addPartyType, 'name', event.target.value)} required /></div>
              <div><RequiredLabel label="Field of Work" filled={Boolean(forms[addPartyType].work_field.trim())} /><input list={`${addPartyType}-modal-work-field-options`} value={forms[addPartyType].work_field} onChange={(event) => updateForm(addPartyType, 'work_field', event.target.value)} placeholder={addPartyType === 'material_vendor' ? 'Steel, Cement, Plumbing...' : 'Mason, Carpenter, Helper...'} /><datalist id={`${addPartyType}-modal-work-field-options`}>{workFieldsFor(addPartyType, addPartyType === 'material_vendor' ? materialVendors : labourIncharges, addPartyType === 'material_vendor' ? materialWorkFields : labourWorkFields).map((field) => <option key={field} value={field} />)}</datalist></div>
              <div><RequiredLabel label="Phone Number" /><input value={forms[addPartyType].phone} onChange={(event) => updateForm(addPartyType, 'phone', event.target.value)} /></div>
              <div><RequiredLabel label="Address" /><input value={forms[addPartyType].address} onChange={(event) => updateForm(addPartyType, 'address', event.target.value)} /></div>
              <div className="flex justify-end gap-2 pt-2 sm:col-span-2"><button type="button" className="rounded border border-slate-300 px-4 py-2 text-sm" onClick={() => setAddPartyType(null)}>Cancel</button><button type="submit" className="inline-flex items-center gap-2 rounded bg-graphite px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={createMutation.isPending}><Plus className="h-4 w-4" />{createMutation.isPending ? 'Saving...' : `Save ${titleForParty(addPartyType)}`}</button></div>
            </form>
          </div>
        </div>
      ) : null}

      {historyParty ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/45 px-2 py-4 sm:px-4 sm:py-6" onClick={() => setHistoryParty(null)}>
          <div className="max-h-[88vh] w-full max-w-6xl overflow-auto rounded-2xl bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">{historyLabel(historyParty.party_type)}</p>
                <h2 className="mt-1 text-xl font-bold text-graphite">{historyParty.name}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {historyParty.work_field || 'No field of work'} | {historyParty.phone || 'No phone'}
                </p>
              </div>
              <button type="button" className="rounded bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700" onClick={() => setHistoryParty(null)}>Close</button>
            </div>

            {historyLoading ? (
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-600">Loading payment history...</div>
            ) : (
              <>
                <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Total Cost</p>
                    <p className="mt-1 text-lg font-black text-slate-900">{formatCurrency(historyCostTotal)}</p>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                    <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Total Paid</p>
                    <p className="mt-1 text-lg font-black text-emerald-800">{formatCurrency(historyPaidTotal)}</p>
                  </div>
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                    <p className="text-xs font-bold uppercase tracking-wider text-rose-700">Balance</p>
                    <p className="mt-1 text-lg font-black text-rose-800">{formatCurrency(historyBalance)}</p>
                  </div>
                  <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
                    <p className="text-xs font-bold uppercase tracking-wider text-indigo-700">Projects</p>
                    <p className="mt-1 text-lg font-black text-indigo-800">{historyProjectCount}</p>
                  </div>
                </div>

                <DataTable
                  auditRowRecords={historyRows.map((row) => ({
                    table_name: row.source === 'Payment' ? 'vendor_transactions' : row.source === 'Labour Cost' ? 'labor_logs' : 'material_logs',
                    record_id: row.id,
                  }))}
                  auditRecordLabel="Transaction"
                  size="compact"
                  printTitle={`${historyLabel(historyParty.party_type)} - ${historyParty.name}`}
                  printMetadata={{
                    Name: historyParty.name,
                    Type: titleForParty(historyParty.party_type),
                    'Field of Work': historyParty.work_field || '-',
                  }}
                  printSummarySections={[
                    {
                      title: 'Party Details',
                      items: [
                        { label: 'Name', value: historyParty.name },
                        { label: 'Type', value: titleForParty(historyParty.party_type) },
                        { label: 'Field of Work', value: historyParty.work_field || '-' },
                        { label: 'Phone', value: historyParty.phone || '-' },
                        { label: 'Address', value: historyParty.address || '-' },
                      ],
                    },
                    {
                      title: 'Financial Summary',
                      items: [
                        { label: 'Total Cost', value: formatCurrency(historyCostTotal) },
                        { label: 'Total Paid', value: formatCurrency(historyPaidTotal) },
                        { label: 'Balance', value: formatCurrency(historyBalance) },
                        { label: 'Projects', value: historyProjectCount },
                        { label: 'Transactions', value: historyRows.length },
                      ],
                    },
                  ]}
                  headers={['S.No.', 'Project', 'Date', 'Type', 'Work Detail', 'Qty', 'Rate', 'Payment Mode', 'Notes', 'Cost', 'Paid']}
                  rows={historyRows.map((row, index) => {
                    const isPayment = row.source === 'Payment';
                    return [
                      index + 1,
                      row.project_name,
                      formatDate(row.payment_date),
                      row.source,
                      row.work_detail,
                      row.quantity !== null && row.quantity !== undefined ? row.quantity : '-',
                      row.rate !== null && row.rate !== undefined ? formatCurrency(Number(row.rate)) : '-',
                      row.payment_mode || '-',
                      row.notes || '-',
                      isPayment ? '-' : formatCurrency(Number(row.amount || 0)),
                      isPayment ? formatCurrency(Number(row.amount || 0)) : '-',
                    ];
                  })}
                  footerRows={[
                    ['', '', '', '', '', '', '', 'Total', formatCurrency(historyCostTotal), formatCurrency(historyPaidTotal)],
                    ['', '', '', '', '', '', '', 'Balance', formatCurrency(historyBalance), ''],
                  ]}
                />
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
