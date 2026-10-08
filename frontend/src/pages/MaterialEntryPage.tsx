import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ArrowDownAZ, ArrowUpAZ, Filter, Search } from 'lucide-react';

import { DataTable } from '../components/DataTable';
import { RequiredLabel } from '../components/RequiredLabel';
import { SectionCard } from '../components/SectionCard';
import { useAuth } from '../contexts/AuthContext';
import { useNotify } from '../contexts/NotificationContext';
import { api } from '../services/api';
import { getApiErrorMessage } from '../utils/errors';
import { normalizedRole } from '../utils/access';
import { formatCurrency, formatMaterialId } from '../utils/format';

const initialForm = { name: '', supplier: '', unit: 'bags', default_unit_cost: 0, active: true, has_bundle_conversion: false, default_bundle_weight: 0 };
type SortMode = 'id_asc' | 'name_az' | 'name_za' | 'vendor_az' | 'cost_high' | 'cost_low';
type ActiveFilter = 'all' | 'active' | 'inactive';

export function MaterialEntryPage() {
  const { user } = useAuth();
  const normalizedUserRole = normalizedRole(user?.role);
  const canAddMaterialMaster = normalizedUserRole === 'owner' || normalizedUserRole === 'administrator' || normalizedUserRole === 'client_manager' || normalizedUserRole === 'project_manager' || normalizedUserRole === 'project_coordinator';
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState(initialForm);
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [vendorFilter, setVendorFilter] = useState('all');
  const [unitFilter, setUnitFilter] = useState('all');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('active');
  const [sortMode, setSortMode] = useState<SortMode>('id_asc');
  const notify = useNotify();
  const queryClient = useQueryClient();
  const { data: materials = [] } = useQuery({ queryKey: ['material-master'], queryFn: api.getMaterialMaster });
  const availableVendors = useMemo(() => {
    return [...new Set(materials.map((item) => item.supplier).filter(Boolean))].sort((left, right) => left.localeCompare(right));
  }, [materials]);
  const availableUnits = useMemo(() => {
    return [...new Set(materials.map((item) => item.unit).filter(Boolean))].sort((left, right) => left.localeCompare(right));
  }, [materials]);
  const filteredMaterials = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return [...materials]
      .filter((item) => {
        const matchesSearch =
          !query ||
          [item.id.toString(), item.name, item.supplier, item.unit, formatCurrency(item.default_unit_cost)]
            .join(' ')
            .toLowerCase()
            .includes(query);
        const matchesVendor = vendorFilter === 'all' || item.supplier === vendorFilter;
        const matchesUnit = unitFilter === 'all' || item.unit === unitFilter;
        const matchesActive = activeFilter === 'all' || (activeFilter === 'active' ? item.active : !item.active);
        return matchesSearch && matchesVendor && matchesUnit && matchesActive;
      })
      .sort((left, right) => {
        if (sortMode === 'name_az') return left.name.localeCompare(right.name);
        if (sortMode === 'name_za') return right.name.localeCompare(left.name);
        if (sortMode === 'vendor_az') return left.supplier.localeCompare(right.supplier) || left.name.localeCompare(right.name);
        if (sortMode === 'cost_high') return right.default_unit_cost - left.default_unit_cost;
        if (sortMode === 'cost_low') return left.default_unit_cost - right.default_unit_cost;
        return left.id - right.id;
      });
  }, [activeFilter, materials, searchQuery, sortMode, vendorFilter, unitFilter]);

  const createMutation = useMutation({
    mutationFn: api.createMaterialMaster,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['material-master'] });
      setForm(initialForm);
      setShowAddModal(false);
      notify.success('Material template added successfully.');
    },
    onError: (e) => notify.error(getApiErrorMessage(e, 'Unable to add material template.')),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) => api.updateMaterialMaster(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['material-master'] });
      setEditingId(null);
      notify.success('Material template updated.');
    },
    onError: (e) => notify.error(getApiErrorMessage(e, 'Unable to update material template.')),
  });
  const deleteMutation = useMutation({
    mutationFn: api.deleteMaterialMaster,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['material-master'] });
      notify.success('Material template deleted.');
    },
    onError: (e) => notify.error(getApiErrorMessage(e, 'Unable to delete material template.')),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createMutation.mutate(form);
  }

  function clearFilters() {
    setSearchQuery('');
    setVendorFilter('all');
    setUnitFilter('all');
    setActiveFilter('all');
    setSortMode('id_asc');
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-graphite">Items & Stock Master</h1>
          <p className="text-sm text-slate-500">Inventory item catalog, units of measurement, and default purchase/sales rates.</p>
        </div>
        {canAddMaterialMaster ? (
          <button
            type="button"
            className="rounded-xl bg-graphite px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-black"
            onClick={() => {
              setForm(initialForm);
              setShowAddModal(true);
            }}
          >
            + Add Stock Item
          </button>
        ) : null}
      </div>

      <div className="app-hero rounded-[30px] border border-white/70 px-5 py-5 shadow-panel sm:px-6">
        <div className="relative flex flex-col gap-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/85 px-4 py-1.5 text-sm font-semibold text-navy shadow-sm">
              <Filter className="h-4 w-4" />
              Materials Filters
            </div>
            <p className="max-w-2xl text-sm text-slate-600">
              Search by name, vendor, unit, or cost. Filter by vendor, unit, and active state, then sort the list the way you want.
            </p>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr_1fr_1fr_auto]">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                placeholder="Search materials..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              />
            </label>

            <select
              value={vendorFilter}
              onChange={(e) => setVendorFilter(e.target.value)}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            >
              <option value="all">All vendors</option>
              {availableVendors.map((vendor) => (
                <option key={vendor} value={vendor}>
                  {vendor}
                </option>
              ))}
            </select>

            <select
              value={unitFilter}
              onChange={(e) => setUnitFilter(e.target.value)}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            >
              <option value="all">All units</option>
              {availableUnits.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>

            <select
              value={activeFilter}
              onChange={(e) => setActiveFilter(e.target.value as ActiveFilter)}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            >
              <option value="all">All status</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>

            <button
              type="button"
              className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
              onClick={clearFilters}
            >
              Reset
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">
              <Search className="h-3.5 w-3.5" />
              {searchQuery.trim() ? searchQuery.trim() : 'All materials'}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">
              Vendor: {vendorFilter === 'all' ? 'All' : vendorFilter}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">
              Unit: {unitFilter === 'all' ? 'All' : unitFilter}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">
              Status: {activeFilter === 'all' ? 'All' : activeFilter === 'active' ? 'Active' : 'Inactive'}
            </span>
            <span className="ml-auto inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1 shadow-sm">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Sort</span>
              <button
                type="button"
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold transition ${sortMode === 'name_az' ? 'bg-graphite text-white' : 'bg-slate-100 text-slate-700'}`}
                onClick={() => setSortMode('name_az')}
              >
                <ArrowDownAZ className="h-4 w-4" />
                Name A-Z
              </button>
              <button
                type="button"
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold transition ${sortMode === 'name_za' ? 'bg-graphite text-white' : 'bg-slate-100 text-slate-700'}`}
                onClick={() => setSortMode('name_za')}
              >
                <ArrowUpAZ className="h-4 w-4" />
                Name Z-A
              </button>
              <button
                type="button"
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold transition ${sortMode === 'vendor_az' ? 'bg-graphite text-white' : 'bg-slate-100 text-slate-700'}`}
                onClick={() => setSortMode('vendor_az')}
              >
                Vendor
              </button>
              <button
                type="button"
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold transition ${sortMode === 'cost_high' ? 'bg-graphite text-white' : 'bg-slate-100 text-slate-700'}`}
                onClick={() => setSortMode('cost_high')}
              >
                High Cost
              </button>
              <button
                type="button"
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold transition ${sortMode === 'cost_low' ? 'bg-graphite text-white' : 'bg-slate-100 text-slate-700'}`}
                onClick={() => setSortMode('cost_low')}
              >
                Low Cost
              </button>
            </span>
          </div>
        </div>
      </div>

      <SectionCard title="Material Products">
        <DataTable
          auditTableName="material_master"
          auditRecordIds={filteredMaterials.map((item) => item.id)}
          auditRecordLabel="Material"
          printTitle="Material Products"
          printMetadata={{
            Module: 'Material Master',
            Materials: filteredMaterials.length,
          }}
          headers={['S.No', 'Material ID', 'Name', 'Vendor', 'Units', 'Cost Per Unit', 'Bundle Conv.', 'Active', 'Actions']}
          rows={filteredMaterials.map((item, index) => {
            const isEditing = editingId === item.id;
            return [
              <span className="font-black text-clay">{index + 1}</span>,
              formatMaterialId(item.id),
              isEditing ? <input value={editForm.name} onChange={(e) => setEditForm((c) => ({ ...c, name: e.target.value }))} className="w-full rounded border px-2 py-1 text-sm" /> : item.name,
              isEditing ? <input value={editForm.supplier} onChange={(e) => setEditForm((c) => ({ ...c, supplier: e.target.value }))} className="w-full rounded border px-2 py-1 text-sm" /> : item.supplier,
              isEditing ? <input value={editForm.unit} onChange={(e) => setEditForm((c) => ({ ...c, unit: e.target.value }))} className="w-full rounded border px-2 py-1 text-sm" /> : item.unit,
              isEditing ? (
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editForm.default_unit_cost || ''}
                  onChange={(e) => setEditForm((c) => ({ ...c, default_unit_cost: Number(e.target.value || 0) }))}
                  className="w-full rounded border px-2 py-1 text-sm"
                />
              ) : (
                formatCurrency(item.default_unit_cost)
              ),
              isEditing ? (
                <div className="space-y-1">
                  <label className="flex items-center gap-1.5 text-xs font-semibold">
                    <input
                      type="checkbox"
                      checked={editForm.has_bundle_conversion}
                      onChange={(e) => setEditForm((c) => ({ ...c, has_bundle_conversion: e.target.checked }))}
                    />
                    Enable
                  </label>
                  {editForm.has_bundle_conversion ? (
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="kg/bdl"
                      value={editForm.default_bundle_weight || ''}
                      onChange={(e) => setEditForm((c) => ({ ...c, default_bundle_weight: Number(e.target.value || 0) }))}
                      className="w-20 rounded border px-1.5 py-0.5 text-xs"
                    />
                  ) : null}
                </div>
              ) : item.has_bundle_conversion ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                  📦 {item.default_bundle_weight ? `${item.default_bundle_weight} kg/bdl` : 'Bundle'}
                </span>
              ) : (
                <span className="text-xs text-slate-400">—</span>
              ),
              isEditing ? (
                <select value={String(editForm.active)} onChange={(e) => setEditForm((c) => ({ ...c, active: e.target.value === 'true' }))} className="rounded border px-2 py-1 text-sm">
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              ) : item.active ? 'Yes' : 'No',
              isEditing ? (
                <div className="flex gap-2">
                  <button className="rounded bg-emerald-600 px-2 py-1 text-xs text-white" onClick={() => updateMutation.mutate({ id: item.id, payload: editForm })}>Update</button>
                  <button className="rounded border border-slate-300 px-2 py-1 text-xs" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    className="rounded bg-slate-100 px-2 py-1 text-xs"
                    onClick={() => {
                      setEditingId(item.id);
                      setEditForm({
                        name: item.name,
                        supplier: item.supplier,
                        unit: item.unit,
                        default_unit_cost: item.default_unit_cost,
                        active: item.active,
                        has_bundle_conversion: Boolean(item.has_bundle_conversion),
                        default_bundle_weight: item.default_bundle_weight || 0,
                      });
                    }}
                  >
                    Edit
                  </button>
                  <button className="rounded bg-red-600 px-2 py-1 text-xs text-white" onClick={() => { if (confirm(`Delete ${item.name}?`)) deleteMutation.mutate(item.id); }}>Delete</button>
                </div>
              ),
            ];
          })}
        />
      </SectionCard>

      {showAddModal ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/45 px-2 py-4 sm:px-4 sm:py-6" onClick={() => setShowAddModal(false)}>
          <div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-bold text-graphite">Add Material</h3>
              <button className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700" onClick={() => setShowAddModal(false)}>Close</button>
            </div>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div><RequiredLabel label="Material Name" required filled={Boolean(form.name.trim())} /><input value={form.name} onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))} required className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><RequiredLabel label="Vendor" required filled={Boolean(form.supplier.trim())} /><input value={form.supplier} onChange={(e) => setForm((current) => ({ ...current, supplier: e.target.value }))} required className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></div>
                <div><RequiredLabel label="Units" required filled={Boolean(form.unit.trim())} /><input value={form.unit} onChange={(e) => setForm((current) => ({ ...current, unit: e.target.value }))} required className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></div>
              </div>
              <div><RequiredLabel label="Default Cost Per Unit / kg" required filled={form.default_unit_cost > 0} /><input type="number" min="0" step="0.01" value={form.default_unit_cost || ''} onChange={(e) => setForm((current) => ({ ...current, default_unit_cost: Number(e.target.value || 0) }))} required className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></div>
              
              <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3.5 space-y-2.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.has_bundle_conversion}
                    onChange={(e) => setForm((current) => ({ ...current, has_bundle_conversion: e.target.checked }))}
                    className="h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                  />
                  <span className="text-sm font-bold text-amber-900">Enable Bundle Conversion (Steel / Bundled Material)</span>
                </label>
                <p className="text-xs text-amber-800/80">
                  When enabled, entering this material during project logs allows calculation by No. of Bundles × Weight per Bundle (kg).
                </p>
                {form.has_bundle_conversion ? (
                  <div>
                    <label className="block text-xs font-bold text-amber-900 mb-1">Default Weight per Bundle (kg)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="e.g. 50 kg"
                      value={form.default_bundle_weight || ''}
                      onChange={(e) => setForm((current) => ({ ...current, default_bundle_weight: Number(e.target.value || 0) }))}
                      className="w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400"
                    />
                  </div>
                ) : null}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold" onClick={() => setShowAddModal(false)}>Cancel</button>
                <button type="submit" className="rounded-xl bg-graphite px-4 py-2 text-sm font-semibold text-white shadow-md">Save Material</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
