import { useState, useMemo } from 'react';
import type { FormEvent } from 'react';
import { Building2, Calendar, FileText, IndianRupee, Layers, Package, Plus, Sparkles, Truck, UploadCloud, X } from 'lucide-react';

import { RequiredLabel } from './RequiredLabel';
import { SearchableCreatableSelect, type SelectOption } from './SearchableCreatableSelect';
import { useNotify } from '../contexts/NotificationContext';
import { api } from '../services/api';
import type { MaterialMaster, Project, VendorMaster } from '../types/api';
import { getApiErrorMessage } from '../utils/errors';
import { formatCurrency, localDateKey } from '../utils/format';

interface StockInwardModalProps {
  projects: Project[];
  materialMaster: MaterialMaster[];
  vendors: VendorMaster[];
  onClose: () => void;
  onSuccess: () => void;
}

export function StockInwardModal({
  projects,
  materialMaster,
  vendors,
  onClose,
  onSuccess,
}: StockInwardModalProps) {
  const notify = useNotify();
  const [submitting, setSubmitting] = useState(false);

  // Form State
  const [projectId, setProjectId] = useState<number>(() => (projects.length > 0 ? projects[0].id : 0));
  const [date, setDate] = useState(localDateKey());
  const [materialName, setMaterialName] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [vendorId, setVendorId] = useState<number | null>(null);
  const [unit, setUnit] = useState('bags');
  const [quantity, setQuantity] = useState<number>(0);
  const [unitCost, setUnitCost] = useState<number>(0);
  const [gstPercent, setGstPercent] = useState<number>(0);
  const [transportCost, setTransportCost] = useState<number>(0);
  const [billNo, setBillNo] = useState('');
  const [workRemarks, setWorkRemarks] = useState('');
  const [saveToMaster, setSaveToMaster] = useState(true);

  // Bundle conversion state
  const [hasBundleConversion, setHasBundleConversion] = useState(false);
  const [noOfBundles, setNoOfBundles] = useState<number>(0);
  const [weightPerBundle, setWeightPerBundle] = useState<number>(0);
  const [costPerKg, setCostPerKg] = useState<number>(0);

  // File Upload State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [billUrl, setBillUrl] = useState('');

  // Auto-fill when material is chosen from master
  const materialOptions: SelectOption[] = useMemo(() => {
    return materialMaster.map((m) => ({
      id: m.id,
      name: m.name,
      subtext: `${m.unit} · ${formatCurrency(m.default_unit_cost)} · ${m.supplier || 'General'}`,
    }));
  }, [materialMaster]);

  const vendorOptions: SelectOption[] = useMemo(() => {
    return vendors.map((v) => ({
      id: v.id,
      name: v.name,
      subtext: v.work_field || v.phone || undefined,
    }));
  }, [vendors]);

  function handleMaterialSelect(value: string | number, option?: SelectOption | null) {
    const rawName = option ? option.name : String(value);
    setMaterialName(rawName);

    const masterMatch = materialMaster.find(
      (m) => String(m.id) === String(value) || m.name.toLowerCase() === rawName.toLowerCase()
    );

    if (masterMatch) {
      if (masterMatch.unit) setUnit(masterMatch.unit);
      if (masterMatch.default_unit_cost) setUnitCost(Number(masterMatch.default_unit_cost));
      if (masterMatch.supplier && !vendorName) {
        setVendorName(masterMatch.supplier);
        const vMatch = vendors.find((v) => v.name.toLowerCase() === masterMatch.supplier.toLowerCase());
        if (vMatch) setVendorId(vMatch.id);
      }
      if (masterMatch.has_bundle_conversion) {
        setHasBundleConversion(true);
        if (masterMatch.default_bundle_weight) setWeightPerBundle(Number(masterMatch.default_bundle_weight));
        if (masterMatch.default_unit_cost) setCostPerKg(Number(masterMatch.default_unit_cost));
      }
    }
  }

  function handleVendorSelect(value: string | number, option?: SelectOption | null) {
    const rawName = option ? option.name : String(value);
    setVendorName(rawName);

    const vMatch = vendors.find((v) => String(v.id) === String(value) || v.name.toLowerCase() === rawName.toLowerCase());
    setVendorId(vMatch ? vMatch.id : null);
  }

  // Calculated values
  const effectiveQty = hasBundleConversion
    ? Number(noOfBundles || 0) * Number(weightPerBundle || 0)
    : Number(quantity || 0);

  const effectiveRate = hasBundleConversion ? Number(costPerKg || 0) : Number(unitCost || 0);

  const subtotal = effectiveQty * effectiveRate;
  const gstAmount = subtotal * (Number(gstPercent || 0) / 100);
  const totalLandedCost = subtotal + gstAmount + Number(transportCost || 0);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!projectId) {
      notify.error('Please select a project or cost center.');
      return;
    }
    if (!materialName.trim()) {
      notify.error('Please specify the material / item name.');
      return;
    }
    if (effectiveQty <= 0) {
      notify.error('Please provide a valid quantity greater than 0.');
      return;
    }

    setSubmitting(true);
    try {
      let finalBillUrl = billUrl.trim() || undefined;

      // Handle bill document upload if provided
      if (selectedFile) {
        try {
          const uploadRes = await api.uploadMaterialBill(selectedFile);
          if (uploadRes?.url) {
            finalBillUrl = uploadRes.url;
          }
        } catch {
          // File upload fail shouldn't necessarily block saving voucher if user accepts
          notify.error('Bill upload failed, saving voucher without attachment.');
        }
      }

      // Check if item exists in master; if not and saveToMaster is checked, auto-create it
      const existsInMaster = materialMaster.some(
        (m) => m.name.toLowerCase() === materialName.trim().toLowerCase()
      );

      if (!existsInMaster && saveToMaster) {
        try {
          await api.createMaterialMaster({
            name: materialName.trim(),
            supplier: vendorName.trim() || 'General',
            unit: hasBundleConversion ? 'kg' : unit.trim() || 'units',
            default_unit_cost: effectiveRate,
            active: true,
            has_bundle_conversion: hasBundleConversion,
            default_bundle_weight: hasBundleConversion ? weightPerBundle : null,
          });
        } catch {
          // Ignore duplicate race conditions
        }
      }

      // Record Material Log / Inward Voucher
      await api.createMaterial({
        project_id: projectId,
        vendor_id: vendorId || null,
        material_name: materialName.trim(),
        quantity: effectiveQty,
        unit: hasBundleConversion ? 'kg' : unit.trim() || 'units',
        unit_cost: effectiveRate,
        supplier: vendorName.trim() || null,
        work_remarks: workRemarks.trim() || null,
        bill_no: billNo.trim() || null,
        gst_percent: gstPercent || null,
        transport_cost: Number(transportCost || 0),
        bill_url: finalBillUrl,
        date,
        template_meta: hasBundleConversion
          ? {
              has_bundle_conversion: true,
              no_of_bundles: Number(noOfBundles || 0),
              weight_per_bundle: Number(weightPerBundle || 0),
              cost_per_kg: Number(costPerKg || 0),
              total_weight_kg: effectiveQty,
            }
          : null,
      });

      notify.success('Inward stock voucher recorded successfully.');
      onSuccess();
      onClose();
    } catch (err) {
      notify.error(getApiErrorMessage(err, 'Failed to record inward stock voucher.'));
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
        className="w-full max-w-2xl my-6 rounded-2xl bg-white shadow-2xl overflow-hidden border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-700">
              <Plus className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-black text-graphite tracking-tight">Record Inward Stock Voucher</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Log procurement, delivery, and stock addition against a cost center or project.
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

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Row 1: Project & Date */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <RequiredLabel label="Cost Center / Project" required filled={Boolean(projectId)} />
              <select
                value={projectId}
                onChange={(e) => setProjectId(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-xs outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                required
              >
                <option value={0} disabled>
                  Select a Project / Cost Center...
                </option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.project_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <RequiredLabel label="Inward / Delivery Date" required filled={Boolean(date)} />
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-xs outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                required
              >
              </input>
            </div>
          </div>

          {/* Row 2: Material Name & Vendor */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <RequiredLabel label="Stock Item / Material" required filled={Boolean(materialName.trim())} />
              <SearchableCreatableSelect
                options={materialOptions}
                value={materialName}
                onChange={handleMaterialSelect}
                placeholder="Select stock item or type new..."
                createLabelPrefix="Add Item"
              />
            </div>

            <div>
              <RequiredLabel label="Supplier / Vendor" required={false} filled={Boolean(vendorName.trim())} />
              <SearchableCreatableSelect
                options={vendorOptions}
                value={vendorName}
                onChange={handleVendorSelect}
                placeholder="Select vendor or type..."
                createLabelPrefix="Use Vendor"
              />
            </div>
          </div>

          {/* Bundle Conversion Switch */}
          <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3.5 space-y-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hasBundleConversion}
                onChange={(e) => setHasBundleConversion(e.target.checked)}
                className="h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
              />
              <span className="text-xs font-bold text-amber-900">
                Enable Steel / Bundle Conversion (Bundles × Weight per Bundle)
              </span>
            </label>

            {hasBundleConversion ? (
              <div className="grid gap-2 sm:grid-cols-3 pt-1">
                <div>
                  <label className="block text-[11px] font-bold text-amber-900 mb-0.5">No. of Bundles</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="e.g. 10"
                    value={noOfBundles || ''}
                    onChange={(e) => setNoOfBundles(Number(e.target.value || 0))}
                    className="w-full rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-amber-900 mb-0.5">Weight / Bundle (kg)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="e.g. 50"
                    value={weightPerBundle || ''}
                    onChange={(e) => setWeightPerBundle(Number(e.target.value || 0))}
                    className="w-full rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-amber-900 mb-0.5">Rate / kg (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="e.g. 68.50"
                    value={costPerKg || ''}
                    onChange={(e) => setCostPerKg(Number(e.target.value || 0))}
                    className="w-full rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-xs font-bold"
                  />
                </div>
              </div>
            ) : null}
          </div>

          {/* Row 3: Standard Quantity & Unit Rate */}
          {!hasBundleConversion && (
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <RequiredLabel label="Quantity" required filled={quantity > 0} />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={quantity || ''}
                  onChange={(e) => setQuantity(Number(e.target.value || 0))}
                  placeholder="0.00"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-800 shadow-xs outline-none focus:border-indigo-400"
                  required
                />
              </div>

              <div>
                <RequiredLabel label="Unit of Measure" required filled={Boolean(unit.trim())} />
                <input
                  type="text"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="e.g. bags, tons, cft"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800 shadow-xs outline-none focus:border-indigo-400"
                  required
                />
              </div>

              <div>
                <RequiredLabel label="Unit Rate (₹)" required filled={unitCost > 0} />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={unitCost || ''}
                  onChange={(e) => setUnitCost(Number(e.target.value || 0))}
                  placeholder="0.00"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-800 shadow-xs outline-none focus:border-indigo-400"
                  required
                />
              </div>
            </div>
          )}

          {/* Row 4: GST %, Transport, Bill No */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">GST %</label>
              <select
                value={gstPercent}
                onChange={(e) => setGstPercent(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-xs outline-none focus:border-indigo-400"
              >
                <option value={0}>0% (Exempt / Nil)</option>
                <option value={5}>5% GST</option>
                <option value={12}>12% GST</option>
                <option value={18}>18% GST</option>
                <option value={28}>28% GST</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Freight / Transport Cost (₹)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={transportCost || ''}
                onChange={(e) => setTransportCost(Number(e.target.value || 0))}
                placeholder="0.00"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800 shadow-xs outline-none focus:border-indigo-400"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Voucher / Bill No.</label>
              <input
                type="text"
                value={billNo}
                onChange={(e) => setBillNo(e.target.value)}
                placeholder="e.g. INV-1049"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800 shadow-xs outline-none focus:border-indigo-400"
              />
            </div>
          </div>

          {/* Remarks & Bill File Upload */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Work Remarks / Purpose</label>
              <input
                type="text"
                value={workRemarks}
                onChange={(e) => setWorkRemarks(e.target.value)}
                placeholder="e.g. Column foundation slab casting"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 shadow-xs outline-none focus:border-indigo-400"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Bill / Invoice Document</label>
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-slate-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
                />
              </div>
            </div>
          </div>

          {/* Master Catalog Auto-save checkbox */}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="save-to-master-check"
              checked={saveToMaster}
              onChange={(e) => setSaveToMaster(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <label htmlFor="save-to-master-check" className="text-xs font-semibold text-slate-600 cursor-pointer">
              Automatically keep / update in Master Stock Catalog
            </label>
          </div>

          {/* Live Valuation Breakdown Banner */}
          <div className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50 via-white to-indigo-50/50 p-4 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5 text-xs text-slate-600">
                <p>
                  Effective Inward:{' '}
                  <span className="font-bold text-slate-900">
                    {effectiveQty.toLocaleString('en-IN')} {hasBundleConversion ? 'kg' : unit}
                  </span>{' '}
                  @ <span className="font-bold text-slate-900">{formatCurrency(effectiveRate)}</span>
                </p>
                <p>
                  Subtotal: <span className="font-semibold text-slate-800">{formatCurrency(subtotal)}</span> | GST (
                  {gstPercent}%):{' '}
                  <span className="font-semibold text-slate-800">{formatCurrency(gstAmount)}</span> | Freight:{' '}
                  <span className="font-semibold text-slate-800">{formatCurrency(transportCost)}</span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">Total Landed Voucher Cost</p>
                <p className="text-2xl font-black text-indigo-950">{formatCurrency(totalLandedCost)}</p>
              </div>
            </div>
          </div>

          {/* Action buttons */}
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
              {submitting ? 'Recording Voucher…' : 'Record Inward Voucher'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
