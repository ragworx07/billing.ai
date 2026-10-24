import { useState } from 'react';
import type { FormEvent } from 'react';
import { Package, Plus, X } from 'lucide-react';

import { RequiredLabel } from './RequiredLabel';
import { SearchableCreatableSelect, type SelectOption } from './SearchableCreatableSelect';
import { useNotify } from '../contexts/NotificationContext';
import { api } from '../services/api';
import type { MaterialMaster, VendorMaster } from '../types/api';
import { getApiErrorMessage } from '../utils/errors';

interface StockItemMasterModalProps {
  initialData?: MaterialMaster | null;
  vendors: VendorMaster[];
  onClose: () => void;
  onSuccess: () => void;
}

export function StockItemMasterModal({
  initialData,
  vendors,
  onClose,
  onSuccess,
}: StockItemMasterModalProps) {
  const isEditing = Boolean(initialData?.id);
  const notify = useNotify();
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState(initialData?.name || '');
  const [supplier, setSupplier] = useState(initialData?.supplier || '');
  const [unit, setUnit] = useState(initialData?.unit || 'bags');
  const [defaultUnitCost, setDefaultUnitCost] = useState<number>(initialData?.default_unit_cost || 0);
  const [active, setActive] = useState(initialData?.active ?? true);
  const [hasBundleConversion, setHasBundleConversion] = useState(Boolean(initialData?.has_bundle_conversion));
  const [defaultBundleWeight, setDefaultBundleWeight] = useState<number>(
    initialData?.default_bundle_weight || 0
  );

  const vendorOptions: SelectOption[] = vendors.map((v) => ({
    id: v.id,
    name: v.name,
    subtext: v.work_field || undefined,
  }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      notify.error('Please enter the stock item name.');
      return;
    }
    if (!supplier.trim()) {
      notify.error('Please specify a vendor/supplier.');
      return;
    }
    if (!unit.trim()) {
      notify.error('Please specify unit of measure.');
      return;
    }

    setSubmitting(true);
    try {
      const payload: Partial<MaterialMaster> = {
        name: name.trim(),
        supplier: supplier.trim(),
        unit: unit.trim(),
        default_unit_cost: Number(defaultUnitCost || 0),
        active,
        has_bundle_conversion: hasBundleConversion,
        default_bundle_weight: hasBundleConversion ? Number(defaultBundleWeight || 0) : null,
      };

      if (isEditing && initialData?.id) {
        await api.updateMaterialMaster(initialData.id, payload);
        notify.success('Stock item updated successfully.');
      } else {
        await api.createMaterialMaster(payload);
        notify.success('Stock item added to catalog.');
      }

      onSuccess();
      onClose();
    } catch (err) {
      notify.error(getApiErrorMessage(err, 'Failed to save stock item.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/50 p-2 sm:p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg my-6 rounded-2xl bg-white shadow-2xl overflow-hidden border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-700">
              <Package className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-black text-graphite tracking-tight">
                {isEditing ? 'Edit Stock Item Master' : 'Add Stock Item Master'}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Configure item definition, standard rate, vendor, and unit of measure.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <RequiredLabel label="Stock Item Name" required filled={Boolean(name.trim())} />
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. 53 Grade OPC Cement / 16mm TMT Steel"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800 shadow-xs outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
              required
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <RequiredLabel label="Primary Vendor / Supplier" required filled={Boolean(supplier.trim())} />
              <SearchableCreatableSelect
                options={vendorOptions}
                value={supplier}
                onChange={(val, opt) => setSupplier(opt ? opt.name : String(val))}
                placeholder="Select or enter vendor..."
                createLabelPrefix="Use Vendor"
              />
            </div>

            <div>
              <RequiredLabel label="Unit of Measure (UOM)" required filled={Boolean(unit.trim())} />
              <input
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="bags, kg, tons, cft, nos, sqft"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800 shadow-xs outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                required
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <RequiredLabel label="Default / Standard Cost (₹)" required filled={defaultUnitCost > 0} />
              <input
                type="number"
                min="0"
                step="0.01"
                value={defaultUnitCost || ''}
                onChange={(e) => setDefaultUnitCost(Number(e.target.value || 0))}
                placeholder="0.00"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-800 shadow-xs outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Status</label>
              <select
                value={String(active)}
                onChange={(e) => setActive(e.target.value === 'true')}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-xs outline-none focus:border-amber-400"
              >
                <option value="true">Active in Catalog</option>
                <option value="false">Inactive / Archived</option>
              </select>
            </div>
          </div>

          {/* Bundle Conversion Section */}
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3.5 space-y-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hasBundleConversion}
                onChange={(e) => setHasBundleConversion(e.target.checked)}
                className="h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
              />
              <span className="text-xs font-bold text-amber-900">
                Enable Steel / Bundle Conversion (Bundled Materials)
              </span>
            </label>
            <p className="text-[11px] text-amber-800/80">
              When enabled, entering this item allows calculating quantity by No. of Bundles × Weight per Bundle (kg).
            </p>

            {hasBundleConversion ? (
              <div className="pt-1">
                <label className="block text-[11px] font-bold text-amber-900 mb-0.5">
                  Default Weight per Bundle (kg)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="e.g. 50"
                  value={defaultBundleWeight || ''}
                  onChange={(e) => setDefaultBundleWeight(Number(e.target.value || 0))}
                  className="w-full rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-bold"
                />
              </div>
            ) : null}
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-graphite px-5 py-2 text-sm font-bold text-white shadow-md hover:bg-black transition disabled:opacity-50"
            >
              {submitting ? 'Saving…' : isEditing ? 'Update Stock Item' : 'Save Stock Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
