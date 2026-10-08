import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Hammer, Plus, RotateCcw, Search, X } from 'lucide-react';

import { DataTable } from '../components/DataTable';
import { RequiredLabel } from '../components/RequiredLabel';
import { SectionCard } from '../components/SectionCard';
import { useNotify } from '../contexts/NotificationContext';
import { api } from '../services/api';
import { getApiErrorMessage } from '../utils/errors';
import { formatCurrency, formatWorkerId } from '../utils/format';

const initialForm = {
  name: '',
  role: '',
  daily_wage: 0,
  wage_options: [] as number[],
};

export function WorkersPage() {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(initialForm);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState(initialForm);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRoleFilter, setSelectedRoleFilter] = useState('');
  const [selectedWageRange, setSelectedWageRange] = useState('all');

  const { data: rows = [], isError, error } = useQuery({
    queryKey: ['workers'],
    queryFn: api.getWorkers,
  });

  // Close modal on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isAddModalOpen) {
        setIsAddModalOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAddModalOpen]);

  // Unique roles for filter & autocomplete
  const uniqueRoles = useMemo(() => {
    return Array.from(new Set(rows.map((row) => row.role?.trim()).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b),
    );
  }, [rows]);

  // Filtered rows based on search & filter controls
  const filteredRows = useMemo(() => {
    return rows.filter((item) => {
      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const code = formatWorkerId(item.id).toLowerCase();
        const rawId = String(item.id);
        const name = (item.name || '').toLowerCase();
        const role = (item.role || '').toLowerCase();
        const wage = String(item.daily_wage || '');

        const matchesQuery =
          name.includes(query) ||
          role.includes(query) ||
          code.includes(query) ||
          rawId.includes(query) ||
          wage.includes(query);

        if (!matchesQuery) return false;
      }

      // Role filter
      if (selectedRoleFilter && item.role?.trim() !== selectedRoleFilter) {
        return false;
      }

      // Wage range filter
      if (selectedWageRange === 'under-500' && item.daily_wage >= 500) return false;
      if (selectedWageRange === '500-800' && (item.daily_wage < 500 || item.daily_wage > 800)) return false;
      if (selectedWageRange === '800-1200' && (item.daily_wage < 800 || item.daily_wage > 1200)) return false;
      if (selectedWageRange === 'above-1200' && item.daily_wage <= 1200) return false;

      return true;
    });
  }, [rows, searchQuery, selectedRoleFilter, selectedWageRange]);

  const sortedRows = useMemo(() => {
    return [...filteredRows].sort((left, right) => left.id - right.id);
  }, [filteredRows]);

  const hasActiveFilters = Boolean(searchQuery.trim() || selectedRoleFilter || selectedWageRange !== 'all');

  function resetFilters() {
    setSearchQuery('');
    setSelectedRoleFilter('');
    setSelectedWageRange('all');
  }

  const createMutation = useMutation({
    mutationFn: api.createWorker,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workers'] });
      setForm(initialForm);
      setIsAddModalOpen(false);
      notify.success('Labour category created.');
    },
    onError: (err) => notify.error(getApiErrorMessage(err, 'Unable to create labour category.')),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) =>
      api.updateWorker(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workers'] });
      setEditingId(null);
      notify.success('Labour category updated.');
    },
    onError: (err) => notify.error(getApiErrorMessage(err, 'Unable to update labour category.')),
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteWorker,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workers'] });
      notify.success('Labour category deleted.');
    },
    onError: (err) => notify.error(getApiErrorMessage(err, 'Unable to delete labour category.')),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name.trim() || !form.role.trim() || form.daily_wage <= 0) return;
    createMutation.mutate({
      ...form,
      name: form.name.trim(),
      role: form.role.trim(),
      wage_options: form.daily_wage > 0 ? [form.daily_wage] : [],
    });
  }

  return (
    <div className="min-w-0 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-clay">Masters · Payroll & Workforce</p>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="font-display text-3xl text-graphite">Staff & Payroll Master</h1>
            <span className="rounded-full bg-slate-200/80 px-2.5 py-0.5 text-xs font-bold text-slate-700">
              {rows.length} {rows.length === 1 ? 'Designation' : 'Designations'}
            </span>
          </div>
          <p className="mt-1 text-sm font-medium text-slate-500">
            Manage employee designations, skill roles, standard daily rates, and payroll cost categories.
          </p>
        </div>

        <button
          type="button"
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-graphite px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-clay active:scale-95 shrink-0 cursor-pointer"
          onClick={() => {
            setForm(initialForm);
            setIsAddModalOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          Add Designation
        </button>
      </div>

      {/* Main Labour Master Card with Search & Filters */}
      <SectionCard title="Staff & Payroll Master Register">
        {isError ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {getApiErrorMessage(error, 'Unable to load staff and payroll master list.')}
          </div>
        ) : null}

        {/* Search and Filters Bar */}
        <div className="mb-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-col gap-2.5 sm:flex-row sm:items-center">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search category, skill, or ID..."
                className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-9 pr-8 text-xs font-medium text-slate-800 placeholder-slate-400 shadow-2xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Skill / Role Filter */}
            <div className="w-full sm:w-48">
              <select
                value={selectedRoleFilter}
                onChange={(e) => setSelectedRoleFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white py-1.5 px-2.5 text-xs font-medium text-slate-700 shadow-2xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">All Skills / Roles</option>
                {uniqueRoles.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </div>

            {/* Wage Range Filter */}
            <div className="w-full sm:w-44">
              <select
                value={selectedWageRange}
                onChange={(e) => setSelectedWageRange(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white py-1.5 px-2.5 text-xs font-medium text-slate-700 shadow-2xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="all">All Wage Rates</option>
                <option value="under-500">Under ₹500</option>
                <option value="500-800">₹500 – ₹800</option>
                <option value="800-1200">₹800 – ₹1,200</option>
                <option value="above-1200">Above ₹1,200</option>
              </select>
            </div>
          </div>

          {/* Reset Filters & Results Counter */}
          <div className="flex items-center justify-between gap-2.5 border-t border-slate-200 pt-2 sm:border-t-0 sm:pt-0">
            <span className="text-xs font-medium text-slate-500 whitespace-nowrap">
              Showing <strong className="text-slate-800">{sortedRows.length}</strong> of {rows.length}
            </span>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 transition cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" />
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Data Table */}
        <DataTable
          auditTableName="workers"
          auditRecordIds={sortedRows.map((item) => item.id)}
          auditRecordLabel="Staff designation"
          size="roomy"
          printTitle="Staff & Payroll Master Register"
          printMetadata={{
            Module: 'Staff & Payroll Master',
            Designations: sortedRows.length,
          }}
          headers={['S.No', 'Role ID', 'Designation / Role', 'Skill / Description', 'Standard Rate / Day', 'Wage History', 'Actions']}
          rows={sortedRows.map((item, index) => {
            const isEditing = editingId === item.id;
            return [
              <span className="font-black text-clay">{index + 1}</span>,
              <span className="font-mono text-xs font-bold text-indigo-700">{formatWorkerId(item.id)}</span>,
              isEditing ? (
                <input
                  value={editForm.name}
                  onChange={(e) => setEditForm((c) => ({ ...c, name: e.target.value }))}
                  className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                />
              ) : (
                <span className="font-semibold text-slate-900">{item.name}</span>
              ),
              isEditing ? (
                <input
                  value={editForm.role}
                  onChange={(e) => setEditForm((c) => ({ ...c, role: e.target.value }))}
                  className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                />
              ) : (
                <span className="text-slate-700">{item.role}</span>
              ),
              isEditing ? (
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editForm.daily_wage || ''}
                  onChange={(e) =>
                    setEditForm((c) => ({ ...c, daily_wage: Number(e.target.value || 0) }))
                  }
                  className="w-28 rounded border border-slate-300 px-2 py-1 text-xs text-right"
                />
              ) : (
                <span className="font-bold tabular-nums text-slate-900">{formatCurrency(item.daily_wage)}</span>
              ),
              (() => {
                const options = Array.from(new Set([...(item.wage_options || []), item.daily_wage])).sort(
                  (a, b) => a - b,
                );
                return options.length ? (
                  <span className="text-xs text-slate-500 tabular-nums">
                    {options.map((w) => formatCurrency(w)).join(', ')}
                  </span>
                ) : (
                  '-'
                );
              })(),
              isEditing ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 transition cursor-pointer"
                    onClick={() =>
                      updateMutation.mutate({
                        id: item.id,
                        payload: {
                          ...editForm,
                          wage_options: Array.from(
                            new Set([...(item.wage_options || []), editForm.daily_wage]),
                          ).filter((v) => Number(v) >= 0),
                        },
                      })
                    }
                  >
                    Update
                  </button>
                  <button
                    type="button"
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 transition cursor-pointer"
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition cursor-pointer"
                    onClick={() => {
                      setEditingId(item.id);
                      setEditForm({
                        name: item.name,
                        role: item.role,
                        daily_wage: item.daily_wage,
                        wage_options: item.wage_options || [],
                      });
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="rounded-lg bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-100 transition cursor-pointer"
                    onClick={() => {
                      if (confirm(`Are you sure you want to delete ${item.name}?`)) {
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
      </SectionCard>

      {/* Add Labour Master Item Pop-up Modal */}
      {isAddModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/45 px-2 py-6 sm:px-4 backdrop-blur-xs"
          onClick={() => setIsAddModalOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl border border-slate-100"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-labour-modal-title"
          >
            <div className="mb-5 flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
                  <Hammer className="h-4.5 w-4.5" />
                </div>
                <div>
                  <h2 id="add-labour-modal-title" className="text-base font-bold text-graphite">
                    Add Designation / Role
                  </h2>
                  <p className="text-xs text-slate-500">
                    Define a workforce designation, role description, and standard rate.
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition cursor-pointer"
                onClick={() => setIsAddModalOpen(false)}
                aria-label="Close add form"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form className="space-y-4" onSubmit={submit}>
              <div>
                <RequiredLabel label="Designation / Role Name" required filled={Boolean(form.name.trim())} />
                <input
                  autoFocus
                  type="text"
                  placeholder="e.g. Accountant, Sales Executive, Supervisor, Technician..."
                  value={form.name}
                  onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))}
                  required
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-900 shadow-2xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <RequiredLabel label="Skill / Description" required filled={Boolean(form.role.trim())} />
                <input
                  type="text"
                  list="labour-skill-options"
                  placeholder="e.g. Brick work & plastering, Material shifting..."
                  value={form.role}
                  onChange={(e) => setForm((c) => ({ ...c, role: e.target.value }))}
                  required
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-900 shadow-2xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <datalist id="labour-skill-options">
                  {uniqueRoles.map((role) => (
                    <option key={role} value={role} />
                  ))}
                </datalist>
              </div>

              <div>
                <RequiredLabel label="Default Wage / Head" required filled={form.daily_wage > 0} />
                <div className="relative">
                  <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 font-semibold text-slate-400">
                    ₹
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={form.daily_wage || ''}
                    onChange={(e) =>
                      setForm((c) => ({ ...c, daily_wage: Number(e.target.value || 0) }))
                    }
                    required
                    className="w-full rounded-xl border border-slate-300 py-2 pl-8 pr-3.5 text-sm font-semibold tabular-nums text-slate-900 shadow-2xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition cursor-pointer"
                  onClick={() => setIsAddModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-xl bg-graphite px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-clay active:scale-95 transition disabled:opacity-60 cursor-pointer"
                  disabled={createMutation.isPending || !form.name.trim() || !form.role.trim() || form.daily_wage <= 0}
                >
                  <Plus className="h-4 w-4" />
                  {createMutation.isPending ? 'Adding...' : 'Add Labour'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

