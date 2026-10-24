import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Building2,
  Calendar,
  CalendarDays,
  CheckCircle2,
  Download,
  Edit2,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  FileText,
  Filter,
  Layers,
  Package,
  Plus,
  Printer,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  TrendingUp,
  Truck,
  X,
} from 'lucide-react';

import { DataTable } from '../components/DataTable';
import { RequiredLabel } from '../components/RequiredLabel';
import { SectionCard } from '../components/SectionCard';
import { StockInwardModal } from '../components/StockInwardModal';
import { StockItemLedgerModal } from '../components/StockItemLedgerModal';
import { StockItemMasterModal } from '../components/StockItemMasterModal';
import { useAuth } from '../contexts/AuthContext';
import { useNotify } from '../contexts/NotificationContext';
import { api } from '../services/api';
import type { MaterialLog, MaterialMaster, Project, VendorMaster } from '../types/api';
import { hasPermission, normalizedRole } from '../utils/access';
import { getApiErrorMessage } from '../utils/errors';
import {
  calculateMaterialTotal,
  formatCurrency,
  formatDate,
  formatMaterialId,
  localDateKey,
} from '../utils/format';

type TabView = 'summary' | 'register' | 'master';
type SortMode = 'valuation_high' | 'valuation_low' | 'qty_high' | 'name_az' | 'name_za' | 'cost_high' | 'cost_low';
type PeriodMode = 'all' | 'today' | 'month' | 'year' | 'custom';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function MaterialEntryPage() {
  const { user } = useAuth();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // Tab View State: summary | register | master
  const activeTab: TabView = (searchParams.get('tab') as TabView) || 'summary';
  function setActiveTab(tab: TabView) {
    const next = new URLSearchParams(searchParams);
    if (tab === 'summary') {
      next.delete('tab');
    } else {
      next.set('tab', tab);
    }
    setSearchParams(next, { replace: true });
  }

  // Permissions
  const userRole = normalizedRole(user?.role);
  const canManageMaster =
    userRole === 'owner' ||
    userRole === 'administrator' ||
    userRole === 'client_manager' ||
    userRole === 'project_manager' ||
    userRole === 'project_coordinator';

  const canEditVoucher = hasPermission(user?.role, 'material_entry_edit') || canManageMaster;

  // Modals state
  const [showInwardModal, setShowInwardModal] = useState(false);
  const [showAddMasterModal, setShowAddMasterModal] = useState(false);
  const [editingMasterItem, setEditingMasterItem] = useState<MaterialMaster | null>(null);
  const [ledgerItem, setLedgerItem] = useState<Partial<MaterialMaster> & { name: string } | null>(null);

  // Edit Voucher Modal state
  const [editingVoucher, setEditingVoucher] = useState<MaterialLog | null>(null);
  const [editVoucherForm, setEditVoucherForm] = useState<{
    date: string;
    quantity: number;
    unit_cost: number;
    unit: string;
    supplier: string;
    bill_no: string;
    work_remarks: string;
    gst_percent: number;
    transport_cost: number;
  }>({
    date: '',
    quantity: 0,
    unit_cost: 0,
    unit: '',
    supplier: '',
    bill_no: '',
    work_remarks: '',
    gst_percent: 0,
    transport_cost: 0,
  });

  // Queries
  const { data: materialMaster = [], isLoading: masterLoading } = useQuery({
    queryKey: ['material-master'],
    queryFn: api.getMaterialMaster,
  });

  const { data: materialLogs = [], isLoading: logsLoading } = useQuery({
    queryKey: ['materials'],
    queryFn: () => api.getMaterials(),
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: api.getProjects,
  });

  const { data: vendors = [] } = useQuery({
    queryKey: ['vendor-master', 'material_vendor'],
    queryFn: () => api.getVendorMaster('material_vendor'),
  });

  // Projects lookup map
  const projectsMap = useMemo(() => {
    const map: Record<number, string> = {};
    for (const p of projects) {
      map[p.id] = p.project_name;
    }
    return map;
  }, [projects]);

  // General Filter State for Stock Summary
  const [summarySearch, setSummarySearch] = useState('');
  const [summaryVendor, setSummaryVendor] = useState('all');
  const [summaryProject, setSummaryProject] = useState<number | 'all'>('all');
  const [summaryUnit, setSummaryUnit] = useState('all');
  const [summaryStatus, setSummaryStatus] = useState<'all' | 'active' | 'inactive'>('active');
  const [summarySort, setSummarySort] = useState<SortMode>('valuation_high');

  // Register Filter State
  const [registerPeriod, setRegisterPeriod] = useState<PeriodMode>('all');
  const [registerProject, setRegisterProject] = useState<number | 'all'>('all');
  const [registerVendor, setRegisterVendor] = useState('all');
  const [registerMaterial, setRegisterMaterial] = useState('all');
  const [registerSearch, setRegisterSearch] = useState('');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');

  // Master List Filter State
  const [masterSearch, setMasterSearch] = useState('');
  const [masterVendorFilter, setMasterVendorFilter] = useState('all');
  const [masterUnitFilter, setMasterUnitFilter] = useState('all');
  const [masterStatusFilter, setMasterStatusFilter] = useState<'all' | 'active' | 'inactive'>('active');

  // Available Vendors and Units lists
  const availableVendors = useMemo(() => {
    const list = new Set<string>();
    for (const m of materialMaster) if (m.supplier) list.add(m.supplier);
    for (const l of materialLogs) if (l.supplier) list.add(l.supplier);
    for (const v of vendors) if (v.name) list.add(v.name);
    return Array.from(list).sort((a, b) => a.localeCompare(b));
  }, [materialMaster, materialLogs, vendors]);

  const availableUnits = useMemo(() => {
    const list = new Set<string>();
    for (const m of materialMaster) if (m.unit) list.add(m.unit);
    for (const l of materialLogs) if (l.unit) list.add(l.unit);
    return Array.from(list).sort((a, b) => a.localeCompare(b));
  }, [materialMaster, materialLogs]);

  const availableMaterials = useMemo(() => {
    const list = new Set<string>();
    for (const m of materialMaster) if (m.name) list.add(m.name);
    for (const l of materialLogs) if (l.material_name) list.add(l.material_name);
    return Array.from(list).sort((a, b) => a.localeCompare(b));
  }, [materialMaster, materialLogs]);

  // Executive KPI summary calculations
  const kpiStats = useMemo(() => {
    let totalValuation = 0;
    let totalInwardUnits = 0;
    let spend30Days = 0;
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    for (const log of materialLogs) {
      const landed = calculateMaterialTotal(log);
      totalValuation += landed;
      totalInwardUnits += Number(log.quantity || 0);

      const logDate = new Date(log.date);
      if (logDate >= thirtyDaysAgo) {
        spend30Days += landed;
      }
    }

    return {
      totalValuation,
      totalCatalogItems: materialMaster.length,
      totalInwardUnits,
      totalVouchers: materialLogs.length,
      spend30Days,
    };
  }, [materialLogs, materialMaster]);

  // 1. Stock Summary & Valuation aggregation
  const stockSummaryRows = useMemo(() => {
    // Map of normalized material name -> aggregated data
    type ItemSummary = {
      masterId?: number;
      name: string;
      primaryVendor: string;
      unit: string;
      standardRate: number;
      inwardQty: number;
      totalSpend: number;
      weightedAvgRate: number;
      lastProcuredDate?: string;
      projectIds: Set<number>;
      hasBundleConversion: boolean;
      bundleWeight?: number | null;
      active: boolean;
    };

    const map = new Map<string, ItemSummary>();

    // Seed with Master Items
    for (const m of materialMaster) {
      const key = m.name.trim().toLowerCase();
      map.set(key, {
        masterId: m.id,
        name: m.name.trim(),
        primaryVendor: m.supplier || '',
        unit: m.unit || 'units',
        standardRate: Number(m.default_unit_cost || 0),
        inwardQty: 0,
        totalSpend: 0,
        weightedAvgRate: Number(m.default_unit_cost || 0),
        projectIds: new Set<number>(),
        hasBundleConversion: Boolean(m.has_bundle_conversion),
        bundleWeight: m.default_bundle_weight,
        active: m.active,
      });
    }

    // Filter logs if a specific project filter is set in summary view
    const relevantLogs =
      summaryProject === 'all' ? materialLogs : materialLogs.filter((l) => l.project_id === summaryProject);

    // Aggregate Logs
    for (const log of relevantLogs) {
      const key = log.material_name.trim().toLowerCase();
      let item = map.get(key);
      if (!item) {
        item = {
          name: log.material_name.trim(),
          primaryVendor: log.supplier || '',
          unit: log.unit || 'units',
          standardRate: Number(log.unit_cost || 0),
          inwardQty: 0,
          totalSpend: 0,
          weightedAvgRate: Number(log.unit_cost || 0),
          projectIds: new Set<number>(),
          hasBundleConversion: false,
          active: true,
        };
        map.set(key, item);
      }

      const q = Number(log.quantity || 0);
      const landed = calculateMaterialTotal(log);
      item.inwardQty += q;
      item.totalSpend += landed;
      item.projectIds.add(log.project_id);

      if (log.supplier && !item.primaryVendor) {
        item.primaryVendor = log.supplier;
      }

      if (!item.lastProcuredDate || new Date(log.date) > new Date(item.lastProcuredDate)) {
        item.lastProcuredDate = log.date;
      }
    }

    // Compute weighted avg rates
    for (const item of map.values()) {
      if (item.inwardQty > 0) {
        item.weightedAvgRate = item.totalSpend / item.inwardQty;
      } else {
        item.weightedAvgRate = item.standardRate;
      }
    }

    // Filter & Sort
    const q = summarySearch.trim().toLowerCase();
    const result = Array.from(map.values()).filter((item) => {
      const matchesSearch =
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.primaryVendor.toLowerCase().includes(q) ||
        item.unit.toLowerCase().includes(q) ||
        (item.masterId && formatMaterialId(item.masterId).toLowerCase().includes(q));

      const matchesVendor = summaryVendor === 'all' || item.primaryVendor === summaryVendor;
      const matchesUnit = summaryUnit === 'all' || item.unit === summaryUnit;
      const matchesStatus =
        summaryStatus === 'all' || (summaryStatus === 'active' ? item.active : !item.active);

      return matchesSearch && matchesVendor && matchesUnit && matchesStatus;
    });

    result.sort((a, b) => {
      if (summarySort === 'valuation_high') return b.totalSpend - a.totalSpend;
      if (summarySort === 'valuation_low') return a.totalSpend - b.totalSpend;
      if (summarySort === 'qty_high') return b.inwardQty - a.inwardQty;
      if (summarySort === 'cost_high') return b.weightedAvgRate - a.weightedAvgRate;
      if (summarySort === 'cost_low') return a.weightedAvgRate - b.weightedAvgRate;
      if (summarySort === 'name_az') return a.name.localeCompare(b.name);
      if (summarySort === 'name_za') return b.name.localeCompare(a.name);
      return b.totalSpend - a.totalSpend;
    });

    return result;
  }, [
    materialMaster,
    materialLogs,
    summaryProject,
    summarySearch,
    summaryVendor,
    summaryUnit,
    summaryStatus,
    summarySort,
  ]);

  // Grand totals for Stock Summary
  const summaryGrandTotal = useMemo(() => {
    return stockSummaryRows.reduce((sum, item) => sum + item.totalSpend, 0);
  }, [stockSummaryRows]);

  // 2. Stock Register (Voucher logs) Filtering
  const filteredRegisterLogs = useMemo(() => {
    const today = localDateKey();
    const currentMonth = today.slice(0, 7);
    const currentYear = today.slice(0, 4);
    const query = registerSearch.trim().toLowerCase();

    return [...materialLogs]
      .filter((log) => {
        // Period filter
        if (registerPeriod === 'today' && log.date.slice(0, 10) !== today) return false;
        if (registerPeriod === 'month' && log.date.slice(0, 7) !== currentMonth) return false;
        if (registerPeriod === 'year' && log.date.slice(0, 4) !== currentYear) return false;
        if (registerPeriod === 'custom') {
          if (customDateFrom && log.date < customDateFrom) return false;
          if (customDateTo && log.date > customDateTo) return false;
        }

        // Project filter
        if (registerProject !== 'all' && log.project_id !== registerProject) return false;

        // Vendor filter
        if (registerVendor !== 'all' && (log.supplier || '') !== registerVendor) return false;

        // Material filter
        if (registerMaterial !== 'all' && log.material_name !== registerMaterial) return false;

        // Search query
        if (query) {
          const match =
            log.material_name.toLowerCase().includes(query) ||
            (log.supplier || '').toLowerCase().includes(query) ||
            (log.bill_no || '').toLowerCase().includes(query) ||
            (log.work_remarks || '').toLowerCase().includes(query) ||
            (projectsMap[log.project_id] || '').toLowerCase().includes(query);
          if (!match) return false;
        }

        return true;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || b.id - a.id);
  }, [
    materialLogs,
    registerPeriod,
    registerProject,
    registerVendor,
    registerMaterial,
    registerSearch,
    customDateFrom,
    customDateTo,
    projectsMap,
  ]);

  const registerTotals = useMemo(() => {
    const totalQty = filteredRegisterLogs.reduce((sum, l) => sum + Number(l.quantity || 0), 0);
    const totalAmount = filteredRegisterLogs.reduce((sum, l) => sum + calculateMaterialTotal(l), 0);
    return { count: filteredRegisterLogs.length, totalQty, totalAmount };
  }, [filteredRegisterLogs]);

  // 3. Master Items Filtering
  const filteredMasterItems = useMemo(() => {
    const query = masterSearch.trim().toLowerCase();
    return [...materialMaster]
      .filter((item) => {
        const matchesSearch =
          !query ||
          [item.id.toString(), item.name, item.supplier, item.unit, formatCurrency(item.default_unit_cost)]
            .join(' ')
            .toLowerCase()
            .includes(query);
        const matchesVendor = masterVendorFilter === 'all' || item.supplier === masterVendorFilter;
        const matchesUnit = masterUnitFilter === 'all' || item.unit === masterUnitFilter;
        const matchesStatus =
          masterStatusFilter === 'all' || (masterStatusFilter === 'active' ? item.active : !item.active);
        return matchesSearch && matchesVendor && matchesUnit && matchesStatus;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [materialMaster, masterSearch, masterVendorFilter, masterUnitFilter, masterStatusFilter]);

  // Mutations
  const deleteMasterMutation = useMutation({
    mutationFn: api.deleteMaterialMaster,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['material-master'] });
      notify.success('Stock item deleted from catalog.');
    },
    onError: (e) => notify.error(getApiErrorMessage(e, 'Unable to delete stock item.')),
  });

  const updateVoucherMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<MaterialLog> }) =>
      api.updateMaterial(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      setEditingVoucher(null);
      notify.success('Stock voucher updated successfully.');
    },
    onError: (e) => notify.error(getApiErrorMessage(e, 'Unable to update stock voucher.')),
  });

  const deleteVoucherMutation = useMutation({
    mutationFn: api.deleteMaterial,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      notify.success('Stock voucher deleted.');
    },
    onError: (e) => notify.error(getApiErrorMessage(e, 'Unable to delete stock voucher.')),
  });

  function handleVoucherEditSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editingVoucher) return;
    updateVoucherMutation.mutate({
      id: editingVoucher.id,
      payload: {
        date: editVoucherForm.date,
        quantity: Number(editVoucherForm.quantity || 0),
        unit_cost: Number(editVoucherForm.unit_cost || 0),
        unit: editVoucherForm.unit.trim(),
        supplier: editVoucherForm.supplier.trim() || null,
        bill_no: editVoucherForm.bill_no.trim() || null,
        work_remarks: editVoucherForm.work_remarks.trim() || null,
        gst_percent: editVoucherForm.gst_percent || null,
        transport_cost: Number(editVoucherForm.transport_cost || 0),
      },
    });
  }

  return (
    <div className="min-w-0 space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-amber-900 shadow-xs">
              <Package className="h-3.5 w-3.5" />
              Tally Edition · Inventory
            </span>
          </div>
          <h1 className="mt-1 font-display text-3xl font-extrabold text-graphite tracking-tight sm:text-4xl">
            Items & Stock
          </h1>
          <p className="mt-1 text-sm font-medium text-slate-500">
            Stock summary & valuation, movement register, material catalog, and item ledgers.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canEditVoucher ? (
            <button
              type="button"
              onClick={() => setShowInwardModal(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-graphite px-4 py-2.5 text-sm font-bold text-white shadow-md hover:bg-black transition"
            >
              <Plus className="h-4 w-4" />
              + Inward Stock Voucher
            </button>
          ) : null}

          {canManageMaster ? (
            <button
              type="button"
              onClick={() => {
                setEditingMasterItem(null);
                setShowAddMasterModal(true);
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-bold text-slate-700 shadow-xs hover:bg-slate-50 transition"
            >
              <Plus className="h-4 w-4 text-amber-600" />
              Add Stock Item
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 shadow-xs hover:bg-slate-50 transition"
            title="Print Current View"
          >
            <Printer className="h-4 w-4 text-slate-500" />
            Print
          </button>
        </div>
      </div>

      {/* 5 Executive KPI Metric Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="rounded-2xl border border-emerald-200/90 bg-gradient-to-br from-emerald-50/70 to-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-emerald-800">
            <span className="text-[11px] font-bold uppercase tracking-wider">Total Stock Valuation</span>
            <TrendingUp className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="mt-2 text-2xl font-black text-emerald-950">
            {formatCurrency(kpiStats.totalValuation)}
          </p>
          <p className="mt-1 text-[11px] font-semibold text-emerald-700/80">Landed procurement spend</p>
        </div>

        <div className="rounded-2xl border border-amber-200/90 bg-gradient-to-br from-amber-50/70 to-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-amber-800">
            <span className="text-[11px] font-bold uppercase tracking-wider">Catalog Stock Items</span>
            <Package className="h-4 w-4 text-amber-600" />
          </div>
          <p className="mt-2 text-2xl font-black text-amber-950">{kpiStats.totalCatalogItems}</p>
          <p className="mt-1 text-[11px] font-semibold text-amber-700/80">Registered master products</p>
        </div>

        <div className="rounded-2xl border border-indigo-200/90 bg-gradient-to-br from-indigo-50/70 to-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-indigo-800">
            <span className="text-[11px] font-bold uppercase tracking-wider">Total Inward Units</span>
            <Layers className="h-4 w-4 text-indigo-600" />
          </div>
          <p className="mt-2 text-2xl font-black text-indigo-950">
            {kpiStats.totalInwardUnits.toLocaleString('en-IN')}
          </p>
          <p className="mt-1 text-[11px] font-semibold text-indigo-700/80">Combined across all UOM</p>
        </div>

        <div className="rounded-2xl border border-blue-200/90 bg-gradient-to-br from-blue-50/70 to-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-blue-800">
            <span className="text-[11px] font-bold uppercase tracking-wider">Inward Vouchers</span>
            <FileText className="h-4 w-4 text-blue-600" />
          </div>
          <p className="mt-2 text-2xl font-black text-blue-950">{kpiStats.totalVouchers}</p>
          <p className="mt-1 text-[11px] font-semibold text-blue-700/80">Material purchase entries</p>
        </div>

        <div className="rounded-2xl border border-purple-200/90 bg-gradient-to-br from-purple-50/70 to-white p-4 shadow-xs col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between text-purple-800">
            <span className="text-[11px] font-bold uppercase tracking-wider">30-Day Activity</span>
            <Calendar className="h-4 w-4 text-purple-600" />
          </div>
          <p className="mt-2 text-2xl font-black text-purple-950">
            {formatCurrency(kpiStats.spend30Days)}
          </p>
          <p className="mt-1 text-[11px] font-semibold text-purple-700/80">Past 30 days landed spend</p>
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <div className="flex border-b border-slate-200 bg-white px-2 rounded-2xl shadow-xs">
        <button
          type="button"
          onClick={() => setActiveTab('summary')}
          className={`flex items-center gap-2 border-b-2 px-5 py-3.5 text-sm font-extrabold transition ${
            activeTab === 'summary'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <Package className="h-4 w-4" />
          Stock Summary & Valuation
          <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
            {stockSummaryRows.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('register')}
          className={`flex items-center gap-2 border-b-2 px-5 py-3.5 text-sm font-extrabold transition ${
            activeTab === 'register'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <Layers className="h-4 w-4" />
          Stock Register (Movement Logs)
          <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
            {filteredRegisterLogs.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('master')}
          className={`flex items-center gap-2 border-b-2 px-5 py-3.5 text-sm font-extrabold transition ${
            activeTab === 'master'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <CheckCircle2 className="h-4 w-4" />
          Item Master Catalog
          <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
            {materialMaster.length}
          </span>
        </button>
      </div>

      {/* TAB 1: Stock Summary & Valuation */}
      {activeTab === 'summary' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="app-hero rounded-3xl border border-white/70 p-5 shadow-panel">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex items-center gap-2 rounded-full bg-white/90 px-3.5 py-1 text-xs font-bold text-navy shadow-xs">
                  <Filter className="h-3.5 w-3.5" />
                  Stock Summary Controls
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-500">
                    Showing {stockSummaryRows.length} items | Total Valuation:
                  </span>
                  <span className="rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-black text-emerald-900">
                    {formatCurrency(summaryGrandTotal)}
                  </span>
                </div>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-[1.5fr_1.2fr_1.2fr_1fr_auto]">
                <label className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    placeholder="Search stock item name, code, vendor..."
                    value={summarySearch}
                    onChange={(e) => setSummarySearch(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm shadow-xs outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  />
                </label>

                <select
                  value={summaryProject}
                  onChange={(e) => setSummaryProject(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 shadow-xs outline-none focus:border-indigo-400"
                >
                  <option value="all">All Projects / Cost Centers</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.project_name}
                    </option>
                  ))}
                </select>

                <select
                  value={summaryVendor}
                  onChange={(e) => setSummaryVendor(e.target.value)}
                  className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 shadow-xs outline-none focus:border-indigo-400"
                >
                  <option value="all">All Suppliers / Vendors</option>
                  {availableVendors.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>

                <select
                  value={summaryUnit}
                  onChange={(e) => setSummaryUnit(e.target.value)}
                  className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 shadow-xs outline-none focus:border-indigo-400"
                >
                  <option value="all">All Units (UOM)</option>
                  {availableUnits.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => {
                    setSummarySearch('');
                    setSummaryVendor('all');
                    setSummaryProject('all');
                    setSummaryUnit('all');
                    setSummaryStatus('all');
                    setSummarySort('valuation_high');
                  }}
                  className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 shadow-xs hover:bg-slate-50 transition"
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
                  Reset
                </button>
              </div>

              {/* Sorting Pills */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Sort By:</span>
                <button
                  type="button"
                  onClick={() => setSummarySort('valuation_high')}
                  className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                    summarySort === 'valuation_high' ? 'bg-graphite text-white' : 'bg-white text-slate-700 border border-slate-200'
                  }`}
                >
                  Valuation High → Low
                </button>
                <button
                  type="button"
                  onClick={() => setSummarySort('qty_high')}
                  className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                    summarySort === 'qty_high' ? 'bg-graphite text-white' : 'bg-white text-slate-700 border border-slate-200'
                  }`}
                >
                  Qty High → Low
                </button>
                <button
                  type="button"
                  onClick={() => setSummarySort('name_az')}
                  className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                    summarySort === 'name_az' ? 'bg-graphite text-white' : 'bg-white text-slate-700 border border-slate-200'
                  }`}
                >
                  Name A-Z
                </button>
                <button
                  type="button"
                  onClick={() => setSummarySort('cost_high')}
                  className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                    summarySort === 'cost_high' ? 'bg-graphite text-white' : 'bg-white text-slate-700 border border-slate-200'
                  }`}
                >
                  Avg Rate High → Low
                </button>
              </div>
            </div>
          </div>

          {/* Stock Summary Table */}
          <SectionCard
            title="Stock Inventory Balances & Valuation"
            action={
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-xs hover:bg-slate-50"
              >
                <Printer className="h-3.5 w-3.5 text-slate-500" />
                Print Valuation Report
              </button>
            }
          >
            <DataTable
              printTitle="Inventory Stock Valuation Summary"
              printMetadata={{
                'Total Items': stockSummaryRows.length,
                'Total Valuation': formatCurrency(summaryGrandTotal),
                'Project Scope': summaryProject === 'all' ? 'All Projects' : projectsMap[summaryProject] || `#${summaryProject}`,
              }}
              headers={[
                'S.No',
                'Item Code',
                'Stock Item Name',
                'Primary Vendor',
                'UOM',
                'Inward Quantity',
                'Std. Rate',
                'Weighted Avg Rate',
                'Valuation (Landed)',
                'Last Procured',
                'Jobs',
                'Actions',
              ]}
              rows={stockSummaryRows.map((item, index) => {
                const code = item.masterId ? formatMaterialId(item.masterId) : `ITM-${index + 1}`;
                return [
                  <span className="font-mono text-xs font-bold text-clay">{index + 1}</span>,
                  <span className="font-mono text-xs font-bold text-slate-700">{code}</span>,
                  <div>
                    <span className="font-bold text-graphite text-sm block">{item.name}</span>
                    {item.hasBundleConversion ? (
                      <span className="inline-block mt-0.5 rounded-md bg-amber-100 px-1.5 py-0.2 text-[10px] font-bold text-amber-800">
                        📦 Bundle Conversion
                      </span>
                    ) : null}
                  </div>,
                  <span className="text-xs text-slate-600">{item.primaryVendor || '—'}</span>,
                  <span className="text-xs font-semibold uppercase text-slate-500">{item.unit}</span>,
                  <span className="text-sm font-black text-slate-900">
                    {item.inwardQty.toLocaleString('en-IN')}{' '}
                    <span className="text-xs font-normal text-slate-500">{item.unit}</span>
                  </span>,
                  <span className="text-xs font-semibold text-slate-600">
                    {formatCurrency(item.standardRate)}
                  </span>,
                  <span className="text-xs font-bold text-indigo-900">
                    {formatCurrency(item.weightedAvgRate)}
                  </span>,
                  <span className="rounded-md bg-emerald-50 px-2 py-1 text-sm font-black text-emerald-900">
                    {formatCurrency(item.totalSpend)}
                  </span>,
                  <span className="text-xs text-slate-500 whitespace-nowrap">
                    {item.lastProcuredDate ? formatDate(item.lastProcuredDate) : '—'}
                  </span>,
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700">
                    {item.projectIds.size}
                  </span>,
                  <button
                    type="button"
                    onClick={() =>
                      setLedgerItem({
                        id: item.masterId,
                        name: item.name,
                        unit: item.unit,
                        supplier: item.primaryVendor,
                        default_unit_cost: item.standardRate,
                        has_bundle_conversion: item.hasBundleConversion,
                        default_bundle_weight: item.bundleWeight,
                      })
                    }
                    className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition"
                  >
                    <Eye className="h-3 w-3" />
                    Item Ledger
                  </button>,
                ];
              })}
              footerRows={[
                [
                  '',
                  '',
                  <span className="font-bold text-slate-700">Total Items: {stockSummaryRows.length}</span>,
                  '',
                  '',
                  '',
                  '',
                  <span className="font-black text-slate-900">Grand Total Valuation:</span>,
                  <span className="rounded-md bg-emerald-100 px-2.5 py-1 text-base font-black text-emerald-950">
                    {formatCurrency(summaryGrandTotal)}
                  </span>,
                  '',
                  '',
                  '',
                ],
              ]}
            />
          </SectionCard>
        </div>
      )}

      {/* TAB 2: Stock Register (Movement Logs) */}
      {activeTab === 'register' && (
        <div className="space-y-4">
          {/* Register Filter Card */}
          <div className="app-hero rounded-3xl border border-white/70 p-5 shadow-panel">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex items-center gap-2 rounded-full bg-white/90 px-3.5 py-1 text-xs font-bold text-navy shadow-xs">
                  <Layers className="h-3.5 w-3.5" />
                  Stock Movement Register Filters
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-500">
                    {registerTotals.count} vouchers | Total Inward Cost:
                  </span>
                  <span className="rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-black text-emerald-900">
                    {formatCurrency(registerTotals.totalAmount)}
                  </span>
                </div>
              </div>

              {/* Period selection pills */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Period:</span>
                {(['all', 'today', 'month', 'year', 'custom'] as PeriodMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setRegisterPeriod(mode)}
                    className={`rounded-full px-3 py-1 text-xs font-bold capitalize transition ${
                      registerPeriod === mode ? 'bg-graphite text-white shadow-xs' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {mode === 'all'
                      ? 'All Time'
                      : mode === 'today'
                      ? 'Today'
                      : mode === 'month'
                      ? 'This Month'
                      : mode === 'year'
                      ? 'This Year'
                      : 'Custom Range'}
                  </button>
                ))}

                {registerPeriod === 'custom' && (
                  <div className="flex items-center gap-2 pl-2">
                    <input
                      type="date"
                      value={customDateFrom}
                      onChange={(e) => setCustomDateFrom(e.target.value)}
                      className="rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold shadow-xs"
                    />
                    <span className="text-xs text-slate-400">to</span>
                    <input
                      type="date"
                      value={customDateTo}
                      onChange={(e) => setCustomDateTo(e.target.value)}
                      className="rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold shadow-xs"
                    />
                  </div>
                )}
              </div>

              {/* Filter controls row */}
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-[1.5fr_1.2fr_1.2fr_1.2fr_auto]">
                <label className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    placeholder="Search bill no, item, vendor, remarks..."
                    value={registerSearch}
                    onChange={(e) => setRegisterSearch(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm shadow-xs outline-none focus:border-indigo-400"
                  />
                </label>

                <select
                  value={registerProject}
                  onChange={(e) => setRegisterProject(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 shadow-xs outline-none focus:border-indigo-400"
                >
                  <option value="all">All Cost Centers / Projects</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.project_name}
                    </option>
                  ))}
                </select>

                <select
                  value={registerVendor}
                  onChange={(e) => setRegisterVendor(e.target.value)}
                  className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 shadow-xs outline-none focus:border-indigo-400"
                >
                  <option value="all">All Vendors</option>
                  {availableVendors.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>

                <select
                  value={registerMaterial}
                  onChange={(e) => setRegisterMaterial(e.target.value)}
                  className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 shadow-xs outline-none focus:border-indigo-400"
                >
                  <option value="all">All Stock Items</option>
                  {availableMaterials.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => {
                    setRegisterPeriod('all');
                    setRegisterProject('all');
                    setRegisterVendor('all');
                    setRegisterMaterial('all');
                    setRegisterSearch('');
                    setCustomDateFrom('');
                    setCustomDateTo('');
                  }}
                  className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 shadow-xs hover:bg-slate-50 transition"
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
                  Reset
                </button>
              </div>
            </div>
          </div>

          {/* Movement Register Table */}
          <SectionCard
            title={`Stock Inward Register (${filteredRegisterLogs.length} Vouchers)`}
            action={
              <div className="flex items-center gap-2">
                {canEditVoucher ? (
                  <button
                    type="button"
                    onClick={() => setShowInwardModal(true)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-graphite px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-black transition"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    New Inward Voucher
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-xs hover:bg-slate-50"
                >
                  <Printer className="h-3.5 w-3.5 text-slate-500" />
                  Print Register
                </button>
              </div>
            }
          >
            <DataTable
              printTitle="Stock Inward Movement Register"
              printMetadata={{
                'Voucher Count': filteredRegisterLogs.length,
                'Total Spend': formatCurrency(registerTotals.totalAmount),
                Period: registerPeriod,
              }}
              headers={[
                'S.No',
                'Date',
                'Voucher / Bill No',
                'Stock Item',
                'Cost Center / Job',
                'Supplier / Vendor',
                'Inward Qty',
                'Unit Rate',
                'GST & Freight',
                'Total Landed Cost',
                'Document',
                'Actions',
              ]}
              rows={filteredRegisterLogs.map((log, index) => {
                const landedCost = calculateMaterialTotal(log);
                const pName = projectsMap[log.project_id] || `Job #${log.project_id}`;
                return [
                  <span className="font-mono text-xs font-bold text-clay">{index + 1}</span>,
                  <span className="whitespace-nowrap text-xs font-semibold text-slate-700">
                    {formatDate(log.date)}
                  </span>,
                  <span className="font-mono text-xs font-bold text-slate-900">{log.bill_no || '—'}</span>,
                  <div>
                    <span className="font-bold text-graphite text-sm block">{log.material_name}</span>
                    {log.work_remarks ? (
                      <span className="text-[11px] text-slate-500 block truncate max-w-xs">
                        {log.work_remarks}
                      </span>
                    ) : null}
                  </div>,
                  <span className="text-xs font-semibold text-graphite">{pName}</span>,
                  <span className="text-xs text-slate-600">{log.supplier || '—'}</span>,
                  <span className="text-xs font-bold text-slate-900">
                    {Number(log.quantity || 0).toLocaleString('en-IN')}{' '}
                    <span className="text-[11px] font-normal text-slate-500">{log.unit}</span>
                  </span>,
                  <span className="text-xs text-slate-700">{formatCurrency(log.unit_cost)}</span>,
                  <span className="text-[11px] text-slate-500">
                    {log.gst_percent ? `${log.gst_percent}% GST` : '0%'}
                    {log.transport_cost ? ` + ₹${log.transport_cost} frt` : ''}
                  </span>,
                  <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-black text-emerald-900">
                    {formatCurrency(landedCost)}
                  </span>,
                  log.bill_url ? (
                    <a
                      href={log.bill_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      View Bill
                    </a>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  ),
                  <div className="flex items-center gap-1.5">
                    {canEditVoucher ? (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingVoucher(log);
                          setEditVoucherForm({
                            date: log.date.slice(0, 10),
                            quantity: Number(log.quantity || 0),
                            unit_cost: Number(log.unit_cost || 0),
                            unit: log.unit,
                            supplier: log.supplier || '',
                            bill_no: log.bill_no || '',
                            work_remarks: log.work_remarks || '',
                            gst_percent: Number(log.gst_percent || 0),
                            transport_cost: Number(log.transport_cost || 0),
                          });
                        }}
                        className="rounded-lg bg-slate-100 p-1.5 text-slate-600 hover:bg-slate-200 transition"
                        title="Edit Voucher"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}

                    {canEditVoucher ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Delete inward voucher #${log.bill_no || log.id} for ${log.material_name}?`)) {
                            deleteVoucherMutation.mutate(log.id);
                          }
                        }}
                        className="rounded-lg bg-rose-50 p-1.5 text-rose-600 hover:bg-rose-100 transition"
                        title="Delete Voucher"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>,
                ];
              })}
              footerRows={[
                [
                  '',
                  '',
                  <span className="font-bold text-slate-700">Total Vouchers: {filteredRegisterLogs.length}</span>,
                  '',
                  '',
                  '',
                  '',
                  '',
                  <span className="font-black text-slate-900">Total Landed Amount:</span>,
                  <span className="rounded-md bg-emerald-100 px-2.5 py-1 text-sm font-black text-emerald-950">
                    {formatCurrency(registerTotals.totalAmount)}
                  </span>,
                  '',
                  '',
                ],
              ]}
            />
          </SectionCard>
        </div>
      )}

      {/* TAB 3: Item Master Catalog */}
      {activeTab === 'master' && (
        <div className="space-y-4">
          {/* Master Filter Card */}
          <div className="app-hero rounded-3xl border border-white/70 p-5 shadow-panel">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex items-center gap-2 rounded-full bg-white/90 px-3.5 py-1 text-xs font-bold text-navy shadow-xs">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Item Master Filter Controls
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-500">
                    {filteredMasterItems.length} items in master catalog
                  </span>
                </div>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-[1.5fr_1.2fr_1fr_1fr_auto]">
                <label className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    placeholder="Search stock item catalog..."
                    value={masterSearch}
                    onChange={(e) => setMasterSearch(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm shadow-xs outline-none focus:border-indigo-400"
                  />
                </label>

                <select
                  value={masterVendorFilter}
                  onChange={(e) => setMasterVendorFilter(e.target.value)}
                  className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 shadow-xs outline-none focus:border-indigo-400"
                >
                  <option value="all">All Vendors</option>
                  {availableVendors.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>

                <select
                  value={masterUnitFilter}
                  onChange={(e) => setMasterUnitFilter(e.target.value)}
                  className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 shadow-xs outline-none focus:border-indigo-400"
                >
                  <option value="all">All Units</option>
                  {availableUnits.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>

                <select
                  value={masterStatusFilter}
                  onChange={(e) => setMasterStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
                  className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 shadow-xs outline-none focus:border-indigo-400"
                >
                  <option value="all">All Status</option>
                  <option value="active">Active Only</option>
                  <option value="inactive">Inactive Only</option>
                </select>

                <button
                  type="button"
                  onClick={() => {
                    setMasterSearch('');
                    setMasterVendorFilter('all');
                    setMasterUnitFilter('all');
                    setMasterStatusFilter('active');
                  }}
                  className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 shadow-xs hover:bg-slate-50 transition"
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
                  Reset
                </button>
              </div>
            </div>
          </div>

          {/* Master Table */}
          <SectionCard
            title={`Registered Stock Items (${filteredMasterItems.length})`}
            action={
              canManageMaster ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditingMasterItem(null);
                    setShowAddMasterModal(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-graphite px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-black transition"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Stock Item
                </button>
              ) : null
            }
          >
            <DataTable
              printTitle="Stock Item Master Catalog"
              printMetadata={{
                'Item Count': filteredMasterItems.length,
              }}
              headers={[
                'S.No',
                'Item ID',
                'Stock Item Name',
                'Default Vendor',
                'Units (UOM)',
                'Standard Cost Per Unit',
                'Bundle Conversion',
                'Status',
                'Actions',
              ]}
              rows={filteredMasterItems.map((item, index) => {
                return [
                  <span className="font-mono text-xs font-bold text-clay">{index + 1}</span>,
                  <span className="font-mono text-xs font-bold text-slate-700">{formatMaterialId(item.id)}</span>,
                  <span className="font-bold text-graphite text-sm">{item.name}</span>,
                  <span className="text-xs text-slate-600">{item.supplier || 'General'}</span>,
                  <span className="text-xs font-bold uppercase text-slate-600">{item.unit}</span>,
                  <span className="text-xs font-black text-slate-900">
                    {formatCurrency(item.default_unit_cost)}
                  </span>,
                  item.has_bundle_conversion ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                      📦 {item.default_bundle_weight ? `${item.default_bundle_weight} kg/bdl` : 'Bundle'}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  ),
                  item.active ? (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                      Active
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-500">
                      Inactive
                    </span>
                  ),
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setLedgerItem({
                          id: item.id,
                          name: item.name,
                          unit: item.unit,
                          supplier: item.supplier,
                          default_unit_cost: item.default_unit_cost,
                          has_bundle_conversion: item.has_bundle_conversion,
                          default_bundle_weight: item.default_bundle_weight,
                        })
                      }
                      className="rounded-lg bg-indigo-50 px-2 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-100"
                    >
                      Ledger
                    </button>
                    {canManageMaster ? (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingMasterItem(item);
                          setShowAddMasterModal(true);
                        }}
                        className="rounded-lg bg-slate-100 p-1.5 text-slate-600 hover:bg-slate-200 transition"
                        title="Edit Master Item"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                    {canManageMaster ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Delete ${item.name} from stock master?`)) {
                            deleteMasterMutation.mutate(item.id);
                          }
                        }}
                        className="rounded-lg bg-rose-50 p-1.5 text-rose-600 hover:bg-rose-100 transition"
                        title="Delete Item"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>,
                ];
              })}
            />
          </SectionCard>
        </div>
      )}

      {/* Inward Stock Voucher Entry Modal */}
      {showInwardModal ? (
        <StockInwardModal
          projects={projects}
          materialMaster={materialMaster}
          vendors={vendors}
          onClose={() => setShowInwardModal(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['materials'] });
            queryClient.invalidateQueries({ queryKey: ['material-master'] });
          }}
        />
      ) : null}

      {/* Add / Edit Master Item Modal */}
      {showAddMasterModal ? (
        <StockItemMasterModal
          initialData={editingMasterItem}
          vendors={vendors}
          onClose={() => {
            setShowAddMasterModal(false);
            setEditingMasterItem(null);
          }}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['material-master'] });
          }}
        />
      ) : null}

      {/* Item Stock Ledger Drill-Down Modal */}
      {ledgerItem ? (
        <StockItemLedgerModal
          item={ledgerItem}
          logs={materialLogs}
          projectsMap={projectsMap}
          onClose={() => setLedgerItem(null)}
        />
      ) : null}

      {/* Edit Voucher Modal */}
      {editingVoucher ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/50 p-2 sm:p-4 backdrop-blur-xs"
          onClick={() => setEditingVoucher(null)}
        >
          <div
            className="w-full max-w-lg my-6 rounded-2xl bg-white shadow-2xl overflow-hidden border border-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-6 py-4">
              <h3 className="text-lg font-black text-graphite">
                Edit Stock Voucher #{editingVoucher.bill_no || editingVoucher.id}
              </h3>
              <button
                type="button"
                onClick={() => setEditingVoucher(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleVoucherEditSubmit} className="p-6 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Voucher Date</label>
                  <input
                    type="date"
                    value={editVoucherForm.date}
                    onChange={(e) => setEditVoucherForm((c) => ({ ...c, date: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Bill / Voucher No.</label>
                  <input
                    type="text"
                    value={editVoucherForm.bill_no}
                    onChange={(e) => setEditVoucherForm((c) => ({ ...c, bill_no: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Quantity</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editVoucherForm.quantity}
                    onChange={(e) => setEditVoucherForm((c) => ({ ...c, quantity: Number(e.target.value || 0) }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Unit (UOM)</label>
                  <input
                    type="text"
                    value={editVoucherForm.unit}
                    onChange={(e) => setEditVoucherForm((c) => ({ ...c, unit: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Unit Rate (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editVoucherForm.unit_cost}
                    onChange={(e) => setEditVoucherForm((c) => ({ ...c, unit_cost: Number(e.target.value || 0) }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"
                    required
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Vendor / Supplier</label>
                  <input
                    type="text"
                    value={editVoucherForm.supplier}
                    onChange={(e) => setEditVoucherForm((c) => ({ ...c, supplier: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">GST %</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editVoucherForm.gst_percent}
                    onChange={(e) => setEditVoucherForm((c) => ({ ...c, gst_percent: Number(e.target.value || 0) }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Freight / Transport Cost (₹)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editVoucherForm.transport_cost}
                  onChange={(e) => setEditVoucherForm((c) => ({ ...c, transport_cost: Number(e.target.value || 0) }))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Work Remarks / Purpose</label>
                <input
                  type="text"
                  value={editVoucherForm.work_remarks}
                  onChange={(e) => setEditVoucherForm((c) => ({ ...c, work_remarks: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingVoucher(null)}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updateVoucherMutation.isPending}
                  className="rounded-xl bg-graphite px-5 py-2 text-sm font-bold text-white shadow-md hover:bg-black"
                >
                  {updateVoucherMutation.isPending ? 'Updating…' : 'Update Voucher'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
