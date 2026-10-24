import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, Bell, CircleDollarSign, Check, X, ChevronLeft, ChevronRight, ChevronDown, CalendarDays, Calendar, Filter, Search, Flag } from 'lucide-react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';

import kkrLogo from '../assets/kkr-logo.png';
import { BuildingLoader } from '../components/BuildingLoader';
import { AnalyticsSkeleton } from '../components/Skeleton';
import { DataTable } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { SectionCard } from '../components/SectionCard';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { SearchableSelect } from '../components/SearchableSelect';
import { formatCurrency, formatDate, localDateKey } from '../utils/format';
import { useChartTheme } from '../utils/chartTheme';
import { normalizedRole } from '../utils/access';
import type { ProjectMilestone, ProjectStatus } from '../types/api';
import { RoleDashboard } from './RoleDashboard';

const READ_ALERTS_STORAGE_KEY = 'cido_dashboard_read_alerts';
type ProjectStatusFilter = 'all' | ProjectStatus;

function formatLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split('-');
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

function shiftMonth(monthKey: string, offset: number) {
  const [year, month] = monthKey.split('-').map(Number);
  const shifted = new Date(year, month - 1 + offset, 1);
  return formatLocalDateKey(shifted).slice(0, 7);
}

function formatCompactCurrency(value: number) {
  const abs = Math.abs(value);
  if (abs >= 10000000) return `₹${(value / 10000000).toFixed(abs >= 100000000 ? 0 : 1)}Cr`;
  if (abs >= 100000) return `₹${(value / 100000).toFixed(abs >= 1000000 ? 0 : 1)}L`;
  if (abs >= 1000) return `₹${(value / 1000).toFixed(abs >= 10000 ? 0 : 1)}K`;
  return formatCurrency(value);
}

const PROJECT_STATUS_FILTERS: Array<{ value: ProjectStatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'ongoing', label: 'Ongoing' },
  { value: 'completed', label: 'Completed' },
];

function projectStatusNameClass(status: string, colorize: boolean) {
  if (!colorize) return 'bg-transparent';
  if (status === 'ongoing') return 'bg-amber-200 text-amber-950';
  if (status === 'completed') return 'bg-emerald-200 text-emerald-950';
  return 'border border-slate-200 bg-white text-slate-900';
}

function ProjectStatusSelect({
  value,
  onChange,
  id,
}: {
  value: ProjectStatusFilter;
  onChange: (value: ProjectStatusFilter) => void;
  id: string;
}) {
  return (
    <select
      id={id}
      className="h-10 min-w-0 w-full max-w-xs rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
      value={value}
      onChange={(event) => onChange(event.target.value as ProjectStatusFilter)}
      aria-label="Filter by project status"
    >
      {PROJECT_STATUS_FILTERS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function ProjectNameLink({
  to,
  name,
  status,
  colorize,
}: {
  to: string;
  name: string;
  status: string;
  colorize: boolean;
}) {
  return (
    <Link
      to={to}
      className={`inline-flex max-w-full truncate rounded-md px-2 py-0.5 font-semibold underline decoration-current/30 underline-offset-2 hover:opacity-90 ${
        colorize ? projectStatusNameClass(status, true) : 'text-clay decoration-clay/40 hover:text-graphite'
      }`}
      title={name}
    >
      {name}
    </Link>
  );
}

type DashboardAlert = {
  severity: string;
  title: string;
  detail: string;
  project_id?: number | null;
  route?: string | null;
};

function alertKey(alert: DashboardAlert) {
  return [alert.severity, alert.title, alert.detail, alert.project_id ?? '', alert.route ?? ''].join('|');
}

function loadReadAlertKeys() {
  try {
    const raw = localStorage.getItem(READ_ALERTS_STORAGE_KEY);
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set<string>();
  }
}

function saveReadAlertKeys(keys: Set<string>) {
  localStorage.setItem(READ_ALERTS_STORAGE_KEY, JSON.stringify([...keys]));
}

const COST_SQFT_LABEL_WIDTH = 168;
const COST_SQFT_CHARS_PER_LINE = 18;
const CHART_PANEL_HEIGHT = 420;
const CASHFLOW_MONTH_WIDTH = 92;
const COST_SQFT_ROW_HEIGHT = 56;

function formatCashflowMonth(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month).trim());
  if (!match) return month;
  const labels = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const monthIndex = Number(match[2]) - 1;
  return `${labels[monthIndex] || match[2]}-${match[1]}`;
}

function wrapProjectLabel(value: string, maxChars = COST_SQFT_CHARS_PER_LINE) {
  const text = value.trim();
  if (text.length <= maxChars) return [text];

  const mid = Math.ceil(Math.min(text.length, maxChars * 2) / 2);
  let best = -1;
  let bestDist = Infinity;

  for (let index = 1; index < text.length; index += 1) {
    if (text[index] !== '_' && text[index] !== ' ') continue;
    if (index > maxChars) continue;
    const dist = Math.abs(index - mid);
    if (dist < bestDist) {
      best = index;
      bestDist = dist;
    }
  }

  if (best < 0) {
    for (let index = Math.min(maxChars, text.length - 1); index >= 1; index -= 1) {
      if (text[index] === '_' || text[index] === ' ') {
        best = index;
        break;
      }
    }
  }

  if (best < 0) best = maxChars;

  const first = text.slice(0, best).replace(/[_\s]+$/g, '');
  let second = text.slice(best).replace(/^[_\s]+/g, '');
  if (second.length > maxChars) {
    second = `${second.slice(0, maxChars - 1)}…`;
  }
  return first ? [first, second || text.slice(best)] : [second];
}

function CostSqftProjectTick({
  x,
  y,
  payload,
}: {
  x?: number;
  y?: number;
  payload?: { value?: string };
}) {
  const lines = wrapProjectLabel(String(payload?.value || ''));
  const startY = (y || 0) - ((lines.length - 1) * 6);

  return (
    <text x={x} y={startY} textAnchor="end" className="chart-axis-text" fontSize={11} fontWeight={600}>
      <title>{payload?.value}</title>
      {lines.map((line, index) => (
        <tspan key={`${line}-${index}`} x={x} dy={index === 0 ? 0 : 12}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function formatQuickNoteTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently updated';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function metricValue(label: string, value: number) {
  if (label.includes('%')) return `${value.toFixed(2)}%`;
  if (label.toLowerCase().includes('projects')) return String(Math.round(value));
  return formatCurrency(value);
}

function metricTone(label: string) {
  const lower = label.toLowerCase();
  if (lower.includes('outstanding')) return 'text-rose-700 bg-rose-50 border-rose-100';
  if (lower.includes('received') || lower.includes('efficiency')) return 'text-emerald-700 bg-emerald-50 border-emerald-100';
  if (lower.includes('margin')) return 'text-indigo-700 bg-indigo-50 border-indigo-100';
  return 'text-slate-800 bg-slate-50 border-slate-100';
}

function ClientHoverLink({
  to,
  name,
  company,
  phone,
  address,
}: {
  to: string;
  name: string;
  company?: string | null;
  phone?: string | null;
  address?: string | null;
}) {
  return (
    <span className="group relative inline-flex max-w-full">
      <Link to={to} className="truncate font-semibold text-clay underline decoration-clay/40 underline-offset-2 hover:text-graphite">
        {name}
      </Link>
      <span className="pointer-events-none absolute left-0 top-7 z-30 hidden w-72 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-2xl group-hover:block">
        <span className="block text-sm font-black text-graphite">{name}</span>
        <span className="mt-2 grid gap-1 text-xs font-semibold text-slate-600">
          <span>Company: <b className="text-slate-900">{company || '-'}</b></span>
          <span>Phone: <b className="text-slate-900">{phone || '-'}</b></span>
          <span>Address: <b className="text-slate-900">{address || '-'}</b></span>
        </span>
      </span>
    </span>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const chartTheme = useChartTheme();
  const currentRole = normalizedRole(user?.role);
  const isOwner = currentRole === 'owner' || currentRole === 'administrator';
  const [cashflowProjectId, setCashflowProjectId] = useState<'all' | number>('all');
  const [timelineMonths, setTimelineMonths] = useState<number | 'all'>(13);
  const [monthDropdownOpen, setMonthDropdownOpen] = useState(false);
  const [customMonthsInput, setCustomMonthsInput] = useState('13');
  const monthDropdownRef = useRef<HTMLDivElement>(null);
  const notificationDropdownRef = useRef<HTMLDivElement>(null);
  const [riskOpen, setRiskOpen] = useState(false);
  const [readAlertKeys, setReadAlertKeys] = useState<Set<string>>(() => loadReadAlertKeys());
  const [healthStatusFilter, setHealthStatusFilter] = useState<ProjectStatusFilter>('all');
  const [shareholderStatusFilter, setShareholderStatusFilter] = useState<ProjectStatusFilter>('all');
  const [overdueStatusFilter, setOverdueStatusFilter] = useState<ProjectStatusFilter>('all');

  useEffect(() => {
    if (!monthDropdownOpen && !riskOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        monthDropdownOpen &&
        monthDropdownRef.current &&
        !monthDropdownRef.current.contains(event.target as Node)
      ) {
        setMonthDropdownOpen(false);
      }
      if (
        riskOpen &&
        notificationDropdownRef.current &&
        !notificationDropdownRef.current.contains(event.target as Node)
      ) {
        setRiskOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [monthDropdownOpen, riskOpen]);

  // Calendar states
  const [calendarMonth, setCalendarMonth] = useState(() => localDateKey().slice(0, 7));
  const [showCalendarDrawer, setShowCalendarDrawer] = useState(false);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);
  const [calendarSearchQuery, setCalendarSearchQuery] = useState('');
  const [calendarFilterProject, setCalendarFilterProject] = useState<'all' | number>('all');
  const [calendarFilterType, setCalendarFilterType] = useState('all');
  const [calendarViewMode, setCalendarViewMode] = useState<'day' | 'month'>('day');

  // Top Priority Focus Queries (Load immediately on mount for top 3 components)
  const { data } = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.getDashboard,
    enabled: isOwner,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const { data: calendarData } = useQuery({
    queryKey: ['dashboard-calendar', calendarMonth],
    queryFn: () => api.getDashboardCalendar(calendarMonth),
    enabled: isOwner,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  // Secondary Background Queries (Deferred until top 3 components render so page loads super fast)
  const { data: milestones = [] } = useQuery({
    queryKey: ['milestones'],
    queryFn: api.getMilestones,
    enabled: isOwner && Boolean(data),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const { data: notesBoard } = useQuery({
    queryKey: ['notes-board'],
    queryFn: api.getNotesBoard,
    enabled: isOwner && Boolean(data),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const milestonesByDate = useMemo(() => {
    const map = new Map<string, ProjectMilestone[]>();
    milestones.forEach((m) => {
      const key = m.milestone_date ? m.milestone_date.slice(0, 10) : '';
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    });
    return map;
  }, [milestones]);

  const lastUpdatedTime = useMemo(() => {
    return new Date().toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    }) + ', ' + new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }).toLowerCase();
  }, []);

  const dashboardCalendar = useMemo(() => {
    if (!calendarData || !Array.isArray(calendarData.days)) return null;
    const year = Number(calendarMonth.slice(0, 4));
    const month = Number(calendarMonth.slice(5, 7));
    const firstDay = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();

    const gridDays: Array<{
      key: string;
      day?: number;
      dateStr?: string;
      isToday: boolean;
      isSelected: boolean;
      spent: number;
      received: number;
      transactions: any[];
      milestones: ProjectMilestone[];
    }> = [];

    for (let index = 0; index < firstDay; index++) {
      gridDays.push({ key: `empty-${index}`, isToday: false, isSelected: false, spent: 0, received: 0, transactions: [], milestones: [] });
    }

    const todayStr = formatLocalDateKey(new Date());

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${calendarMonth}-${String(day).padStart(2, '0')}`;
      const dayData = calendarData.days?.find((d) => d.date === dateStr);
      const dayMilestones = milestonesByDate.get(dateStr) || [];
      gridDays.push({
        key: dateStr,
        day,
        dateStr,
        isToday: dateStr === todayStr,
        isSelected: dateStr === selectedCalendarDate,
        spent: dayData?.spent || 0,
        received: dayData?.received || 0,
        transactions: dayData?.transactions || [],
        milestones: dayMilestones,
      });
    }

    return {
      month: calendarMonth,
      totals: calendarData.totals,
      days: gridDays,
    };
  }, [calendarData, calendarMonth, milestonesByDate, selectedCalendarDate]);

  const filteredTransactions = useMemo(() => {
    if (!calendarData || !Array.isArray(calendarData.days)) return [];
    let list: any[] = [];

    if (calendarViewMode === 'day') {
      if (selectedCalendarDate) {
        const dayData = calendarData.days?.find((d) => d.date === selectedCalendarDate);
        list = dayData?.transactions || [];
      }
    } else {
      calendarData.days.forEach((day) => {
        list.push(...day.transactions);
      });
    }

    const query = calendarSearchQuery.toLowerCase().trim();
    if (query) {
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(query) ||
          t.project_name.toLowerCase().includes(query) ||
          t.type.toLowerCase().includes(query) ||
          (t.detail && t.detail.toLowerCase().includes(query))
      );
    }

    if (calendarFilterProject !== 'all') {
      list = list.filter((t) => t.project_id === calendarFilterProject);
    }

    if (calendarFilterType !== 'all') {
      list = list.filter((t) => t.type === calendarFilterType);
    }

    return list.sort((left, right) => left.date.localeCompare(right.date));
  }, [calendarData, calendarViewMode, selectedCalendarDate, calendarSearchQuery, calendarFilterProject, calendarFilterType]);

  // Arrow key date navigation when a calendar date is selected
  useEffect(() => {
    if (!selectedCalendarDate) return;

    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.getAttribute('contenteditable') === 'true')
      ) {
        return;
      }

      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        const current = new Date(`${selectedCalendarDate}T00:00:00`);
        if (isNaN(current.getTime())) return;

        let deltaDays = 0;
        if (e.key === 'ArrowLeft') deltaDays = -1;
        if (e.key === 'ArrowRight') deltaDays = 1;
        if (e.key === 'ArrowUp') deltaDays = -7;
        if (e.key === 'ArrowDown') deltaDays = 7;

        current.setDate(current.getDate() + deltaDays);
        const year = current.getFullYear();
        const month = String(current.getMonth() + 1).padStart(2, '0');
        const day = String(current.getDate()).padStart(2, '0');

        const nextDateStr = `${year}-${month}-${day}`;
        const nextMonthStr = `${year}-${month}`;

        if (nextMonthStr !== calendarMonth) {
          setCalendarMonth(nextMonthStr);
        }
        setSelectedCalendarDate(nextDateStr);
      } else if (e.key === 'Escape') {
        setSelectedCalendarDate(null);
        setShowCalendarDrawer(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedCalendarDate, calendarMonth]);

  const quickNotes = (notesBoard?.active || [])
    .slice()
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .slice(0, 3);
  const totalNotes = notesBoard?.active.length || 0;
  const unreadAlerts = useMemo(
    () => (data?.alerts || []).filter((alert) => !readAlertKeys.has(alertKey(alert))),
    [data?.alerts, readAlertKeys],
  );
  const milestoneReminders = unreadAlerts.filter((alert) =>
    alert.title.toLowerCase().includes('milestone') || alert.title.toLowerCase().startsWith('today:'),
  );
  const urgentMilestoneReminders = milestoneReminders.filter((alert) => alert.severity === 'high').slice(0, 3);
  const projectStatusById = useMemo(() => {
    const map = new Map<number, string>();
    for (const project of data?.project_health || []) {
      map.set(project.project_id, project.status);
    }
    return map;
  }, [data?.project_health]);
  const filteredProjectHealth = useMemo(() => {
    const rows = data?.project_health || [];
    if (healthStatusFilter === 'all') return rows;
    return rows.filter((project) => project.status === healthStatusFilter);
  }, [data?.project_health, healthStatusFilter]);
  const filteredShareholderRisks = useMemo(() => {
    const rows = data?.shareholder_risks || [];
    if (shareholderStatusFilter === 'all') return rows;
    return rows.filter((row) => projectStatusById.get(row.project_id) === shareholderStatusFilter);
  }, [data?.shareholder_risks, projectStatusById, shareholderStatusFilter]);
  const filteredOverduePayments = useMemo(() => {
    const rows = data?.overdue_payments || [];
    if (overdueStatusFilter === 'all') return rows;
    return rows.filter((row) => projectStatusById.get(row.project_id) === overdueStatusFilter);
  }, [data?.overdue_payments, overdueStatusFilter, projectStatusById]);

  const markAlertAsRead = (alert: DashboardAlert) => {
    setReadAlertKeys((current) => {
      const next = new Set(current);
      next.add(alertKey(alert));
      const activeKeys = new Set((data?.alerts || []).map(alertKey));
      const pruned = new Set([...next].filter((key) => activeKeys.has(key)));
      saveReadAlertKeys(pruned);
      return pruned;
    });
  };

  const markAllAlertsAsRead = () => {
    setReadAlertKeys((current) => {
      const next = new Set(current);
      (data?.alerts || []).forEach((alert) => next.add(alertKey(alert)));
      saveReadAlertKeys(next);
      return next;
    });
  };

  const cashflowProjects = useMemo(() => {
    if (!data) return [];
    return data.project_health
      .map((item) => ({ id: item.project_id, name: item.project_name }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [data]);
  const selectedCashflowProject = cashflowProjectId === 'all'
    ? null
    : cashflowProjects.find((project) => project.id === cashflowProjectId) || null;
  const cashflowChartData = cashflowProjectId === 'all'
    ? data?.monthly_cashflow || []
    : data?.monthly_cashflow_by_project.filter((item) => item.project_id === cashflowProjectId) || [];
  const formattedCashflowChartData = useMemo(
    () => cashflowChartData.map((item) => ({ ...item, monthLabel: formatCashflowMonth(item.month) })),
    [cashflowChartData],
  );
  const filteredCashflowChartData = useMemo(() => {
    if (timelineMonths === 'all') return formattedCashflowChartData;
    const count = typeof timelineMonths === 'number' ? timelineMonths : 13;
    return formattedCashflowChartData.slice(-count);
  }, [formattedCashflowChartData, timelineMonths]);

  const cashflowScrollRef = useRef<HTMLDivElement>(null);
  const needsCashflowScroll = filteredCashflowChartData.length > 8;
  const cashflowChartWidth = needsCashflowScroll
    ? filteredCashflowChartData.length * CASHFLOW_MONTH_WIDTH
    : undefined;
  const costPerSqftChartData = useMemo(() => {
    if (!data) return [];
    return data.project_health
      .filter((project) => project.status === 'ongoing')
      .map((project) => {
        const sqft = Number(project.construction_sqft || 0);
        const estimatedPerSqft = Number(project.construction_rate_per_sqft || 0);
        const spent = Number(project.total_cost || 0);
        const spentPerSqft = sqft > 0 ? spent / sqft : 0;
        const spentWithinEstimate = Math.min(spentPerSqft, estimatedPerSqft);
        const remainingPerSqft = Math.max(estimatedPerSqft - spentPerSqft, 0);
        const overrunPerSqft = Math.max(spentPerSqft - estimatedPerSqft, 0);
        return {
          name: project.project_name,
          estimatedPerSqft,
          spentPerSqft: spentWithinEstimate,
          remainingPerSqft,
          overrunPerSqft,
          actualSpentPerSqft: spentPerSqft,
        };
      })
      .filter((project) => project.estimatedPerSqft > 0 || project.spentPerSqft > 0 || project.overrunPerSqft > 0)
      .sort((left, right) => (right.remainingPerSqft + right.overrunPerSqft) - (left.remainingPerSqft + left.overrunPerSqft));
  }, [data]);
  const costPerSqftInnerHeight = Math.max(
    CHART_PANEL_HEIGHT,
    costPerSqftChartData.length * COST_SQFT_ROW_HEIGHT + 48,
  );

  useEffect(() => {
    const node = cashflowScrollRef.current;
    if (!node) return;
    node.scrollLeft = node.scrollWidth;
  }, [filteredCashflowChartData.length, cashflowProjectId]);

  if (!isOwner) {
    return <RoleDashboard />;
  }

  if (!data) {
    return <AnalyticsSkeleton />;
  }

  return (
    <div className="min-w-0 space-y-6">
      {/* Header Title Area */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-clay">Gateway of ERP · Overview</p>
          <h1 className="mt-1 font-display text-3xl font-black tracking-tight text-graphite">Company Financial Gateway</h1>
          <p className="text-xs text-muted mt-1 font-medium">
            {data.project_health.filter((p) => p.status === 'ongoing').length} active cost centers / projects · updated {lastUpdatedTime}
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {/* Editable Month Range Selector */}
          <div className="relative" ref={monthDropdownRef}>
            <button
              type="button"
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition shadow-xs ${
                monthDropdownOpen
                  ? 'border-indigo-400 bg-indigo-50/60 text-indigo-950 ring-2 ring-indigo-500/20'
                  : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50'
              }`}
              onClick={() => setMonthDropdownOpen((prev) => !prev)}
              aria-label="Filter timeline months"
            >
              <Calendar className="h-4 w-4 text-indigo-600 shrink-0" />
              <span>{timelineMonths === 'all' ? 'All time' : `Last ${timelineMonths} months`}</span>
              <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform ${monthDropdownOpen ? 'rotate-180 text-indigo-600' : ''}`} />
            </button>

            {monthDropdownOpen && (
              <div className="absolute right-0 top-12 z-[120] w-64 rounded-2xl border border-slate-200 bg-white p-3 text-slate-900 shadow-2xl animate-in fade-in zoom-in-95 duration-100">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Timeline Range</p>
                <div className="grid grid-cols-3 gap-1.5 mb-3">
                  {[
                    { label: '3M', value: 3 },
                    { label: '6M', value: 6 },
                    { label: '12M', value: 12 },
                    { label: '13M', value: 13 },
                    { label: '24M', value: 24 },
                    { label: 'All', value: 'all' as const },
                  ].map((preset) => {
                    const isSelected = timelineMonths === preset.value;
                    return (
                      <button
                        key={String(preset.value)}
                        type="button"
                        className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${
                          isSelected
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                        onClick={() => {
                          setTimelineMonths(preset.value);
                          if (typeof preset.value === 'number') {
                            setCustomMonthsInput(String(preset.value));
                          }
                          setMonthDropdownOpen(false);
                        }}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>

                <div className="border-t border-slate-100 pt-2.5">
                  <label className="text-[11px] font-bold text-slate-500 mb-1.5 block">
                    Custom months
                  </label>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const num = parseInt(customMonthsInput, 10);
                      if (!isNaN(num) && num > 0) {
                        setTimelineMonths(num);
                        setMonthDropdownOpen(false);
                      }
                    }}
                    className="flex items-center gap-1.5"
                  >
                    <input
                      type="number"
                      min="1"
                      max="120"
                      value={customMonthsInput}
                      onChange={(e) => setCustomMonthsInput(e.target.value)}
                      placeholder="e.g. 18"
                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-bold text-slate-800 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                    <button
                      type="submit"
                      className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1 text-xs font-bold text-white hover:bg-indigo-700 transition"
                    >
                      Set
                    </button>
                  </form>
                </div>
              </div>
            )}
          </div>
          
          {/* Notifications Bell & Popover */}
          <div className="relative" ref={notificationDropdownRef}>
            <button
              type="button"
              className={`relative inline-flex h-9 w-9 items-center justify-center rounded-xl border transition shadow-xs active:scale-95 ${
                riskOpen
                  ? 'border-indigo-400 bg-indigo-50/60 text-indigo-950 ring-2 ring-indigo-500/20'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900'
              }`}
              onClick={() => setRiskOpen((current) => !current)}
              aria-label="Show risk notifications"
            >
              <Bell className="h-4 w-4" />
              {unreadAlerts.length > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-black leading-none text-white ring-2 ring-white shadow-xs">
                  {unreadAlerts.length > 99 ? '99+' : unreadAlerts.length}
                </span>
              )}
            </button>
            {riskOpen ? (
              <div className="absolute right-0 top-12 z-[120] w-[360px] max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-2xl animate-in fade-in zoom-in-95 duration-100">
                <div className="mb-3 flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-black text-slate-900">Risk Notifications</p>
                      {unreadAlerts.length > 0 && (
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-extrabold text-rose-700">
                          {unreadAlerts.length} new
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] font-medium text-slate-400 mt-0.5">Dashboard alerts and reminders</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {unreadAlerts.length > 0 && (
                      <button
                        type="button"
                        onClick={markAllAlertsAsRead}
                        className="rounded-lg px-2 py-1 text-[10px] font-bold text-indigo-600 hover:bg-indigo-50 hover:text-indigo-800 transition"
                        title="Mark all as read"
                      >
                        Read all
                      </button>
                    )}
                    <button
                      type="button"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                      onClick={() => setRiskOpen(false)}
                      aria-label="Close risk notifications"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {unreadAlerts.length ? (
                  <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                    {unreadAlerts.map((alert, index) => (
                      <div
                        key={`${alert.title}-${index}`}
                        className={clsx(
                          "rounded-xl border p-3 text-slate-900 text-xs shadow-2xs transition-all",
                          alert.severity === 'high' ? 'border-rose-100 bg-rose-50/40 hover:bg-rose-50/70' : 'border-amber-100 bg-amber-50/40 hover:bg-amber-50/70'
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <span className={clsx(
                              "inline-block text-[9px] font-extrabold uppercase tracking-wider rounded px-1.5 py-0.5 mb-1",
                              alert.severity === 'high' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'
                            )}>
                              {alert.severity} priority
                            </span>
                            <p className="font-bold text-slate-900 mt-0.5">{alert.title}</p>
                            <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{alert.detail}</p>
                          </div>
                          {alert.route ? (
                            <Link
                              to={alert.route}
                              className="shrink-0 rounded-lg bg-white border border-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-700 shadow-2xs hover:bg-slate-50 transition"
                              onClick={() => setRiskOpen(false)}
                            >
                              Open
                            </Link>
                          ) : (
                            <AlertTriangle className={clsx("h-4 w-4 shrink-0 mt-1", alert.severity === 'high' ? 'text-rose-500' : 'text-amber-500')} />
                          )}
                        </div>
                        <div className="mt-2.5 flex justify-end">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-slate-200 px-2.5 py-1 text-[10px] font-bold text-slate-600 shadow-2xs hover:bg-slate-50 hover:text-slate-900 transition"
                            onClick={() => markAlertAsRead(alert)}
                          >
                            <Check className="h-3 w-3 text-emerald-600" />
                            Mark as read
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-6 text-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 mb-2">
                      <Check className="h-5 w-5" />
                    </div>
                    <p className="text-xs font-bold text-slate-700">All caught up!</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">No critical alerts or pending risks.</p>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Top Combined Collection Summary Bar (Image 2 Exact Match) */}
      {(() => {
        const portfolioQuoted = data?.cards?.find(c => c.label === "Portfolio Quoted")?.value || 0;
        const totalCost = data?.cards?.find(c => c.label === "Total Cost")?.value || 0;
        const totalReceived = data?.cards?.find(c => c.label === "Total Received")?.value || 0;
        const outstanding = data?.cards?.find(c => c.label === "Outstanding")?.value || 0;
        const activeProjectsCount = data?.cards?.find(c => c.label === "Total Active Projects")?.value || 0;
        const collectionEfficiency = data?.cards?.find(c => c.label === "Collection Efficiency %")?.value || 0;

        const costPercent = portfolioQuoted > 0 ? (totalCost / portfolioQuoted * 100).toFixed(1) : '0';
        const receivedPercent = portfolioQuoted > 0 ? (totalReceived / portfolioQuoted * 100).toFixed(1) : '0';
        const efficiencyDiff = (collectionEfficiency - 60).toFixed(1);
        const formattedEfficiencyDiff = Number(efficiencyDiff) >= 0 ? `+${efficiencyDiff}` : efficiencyDiff;

        const receivedBarPct = portfolioQuoted > 0 ? Math.min(100, Math.max(0, (totalReceived / portfolioQuoted) * 100)) : 0;

        return (
          <div className="bg-white border border-line rounded-2xl p-6 shadow-sm space-y-5">
            {/* 4 Metric Columns */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted">PORTFOLIO QUOTED</p>
                <p className="mt-1 text-3xl font-black text-graphite tracking-tight">{formatCompactCurrency(portfolioQuoted)}</p>
              </div>

              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted">TOTAL COST BOOKED</p>
                <p className="mt-1 text-3xl font-black text-graphite tracking-tight">{formatCompactCurrency(totalCost)}</p>
                <p className="text-xs text-muted font-medium mt-0.5">{costPercent}% of quoted</p>
              </div>

              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted">RECEIVED</p>
                <p className="mt-1 text-3xl font-black text-emerald-700 tracking-tight">{formatCompactCurrency(totalReceived)}</p>
                <p className="text-xs text-muted font-medium mt-0.5">{receivedPercent}% of quoted</p>
              </div>

              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted">OUTSTANDING</p>
                <p className="mt-1 text-3xl font-black text-danger tracking-tight">{formatCompactCurrency(outstanding)}</p>
                <p className="text-xs text-muted font-medium mt-0.5">Across {activeProjectsCount} active projects</p>
              </div>
            </div>

            {/* Segmented Progress Bar */}
            <div className="w-full h-3.5 bg-danger rounded-full overflow-hidden flex">
              <div className="h-full bg-emerald-700 transition-all duration-500" style={{ width: `${receivedBarPct}%` }} />
              <div className="h-full bg-danger flex-1" />
            </div>

            {/* Sub-Legend Row */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-5 text-xs font-semibold text-body">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-700" />
                  Received
                </span>
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-danger" />
                  Outstanding
                </span>
              </div>

              <div className="text-right">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted block sm:inline sm:mr-2">COLLECTION EFFICIENCY</span>
                <span className="text-lg font-black text-danger mr-1.5">{collectionEfficiency.toFixed(2)}%</span>
                <span className="text-xs font-semibold text-muted">target 60% · {formattedEfficiencyDiff} pts</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Main Two-Column Row: Monthly Cashflow & Calendar on Left; Cost/sqft, Overdue Aging & Daily Preview on Right */}
      <div className="grid items-start gap-6 grid-cols-1 xl:grid-cols-3">
        {/* Left Column (xl:col-span-2) */}
        <div className="xl:col-span-2 space-y-6 min-w-0">
          {/* Monthly Cashflow */}
          <SectionCard
            title="Monthly cashflow"
            action={
              <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-xs font-semibold">
                <div className="flex items-center gap-3 text-body">
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-700" /> Inflow</span>
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-danger" /> Outflow</span>
                  <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 bg-clay" /> Net</span>
                </div>
                <SearchableSelect
                  options={[
                    { id: 'all', name: 'Overall Cashflow' },
                    ...cashflowProjects,
                  ]}
                  value={cashflowProjectId}
                  onChange={setCashflowProjectId}
                  placeholder="Search project..."
                />
              </div>
            }
          >
            <p className="text-xs text-muted mb-3 font-medium">Click a bar to drill into that month</p>
            <div
              ref={cashflowScrollRef}
              className="w-full overflow-x-auto overflow-y-hidden"
              style={{ height: CHART_PANEL_HEIGHT }}
            >
              <div
                className="h-full"
                style={{ width: cashflowChartWidth ? `${cashflowChartWidth}px` : '100%', minWidth: '100%' }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={filteredCashflowChartData} margin={{ top: 12, right: 12, left: 4, bottom: 28 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="monthLabel"
                      interval={0}
                      tick={{ fontSize: 11, fontWeight: 600 }}
                      angle={0}
                      dy={8}
                    />
                    <YAxis tickFormatter={(value) => `₹${Math.round(Number(value) / 100000)}L`} width={56} tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(value: number) => formatCurrency(value)}
                      labelFormatter={(label) => String(label)}
                    />
                    <Bar dataKey="inflow" name="Inflow" fill={chartTheme.inflow} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="outflow" name="Outflow" fill={chartTheme.outflow} radius={[4, 4, 0, 0]} />
                    <Line type="monotone" dataKey="net" name="Net" stroke={chartTheme.net} strokeWidth={3} dot={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </SectionCard>

          {/* Portfolio Cashflow Calendar Widget */}
          <SectionCard title="Portfolio Cashflow Calendar">
            {/* Calendar Custom Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-stretch gap-6 pb-4 mb-4 border-b border-line">
              {/* Left Column Summary Cards */}
              {dashboardCalendar && (
                <div className="grid grid-cols-3 gap-3.5 items-end self-stretch md:w-[480px] lg:w-[600px] shrink-0">
                  <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-3 text-center shadow-xs flex flex-col justify-center h-full">
                    <p className="text-[9px] font-black uppercase tracking-[0.15em] text-emerald-800">TOTAL INFLOW</p>
                    <p className="mt-1 text-sm font-black text-emerald-700 tracking-tight">
                      {formatCurrency(dashboardCalendar.totals.received)}
                    </p>
                  </div>
                  <div className="bg-rose-50 border border-rose-100 rounded-2xl p-3 text-center shadow-xs flex flex-col justify-center h-full">
                    <p className="text-[9px] font-black uppercase tracking-[0.15em] text-rose-800">TOTAL OUTFLOW</p>
                    <p className="mt-1 text-sm font-black text-rose-700 tracking-tight">
                      {formatCurrency(dashboardCalendar.totals.spent)}
                    </p>
                  </div>
                  {(() => {
                    const netFlow = dashboardCalendar.totals.received - dashboardCalendar.totals.spent;
                    return (
                      <div className={clsx(
                        "border rounded-2xl p-3 text-center shadow-xs flex flex-col justify-center h-full",
                        netFlow >= 0 ? "bg-emerald-50/50 border-emerald-100/70 text-emerald-800" : "bg-amber-50 border-amber-100 text-amber-800"
                      )}>
                        <p className="text-[9px] font-black uppercase tracking-[0.15em] opacity-80">NET FLOW</p>
                        <p className="mt-1 text-sm font-black tracking-tight">
                          {netFlow >= 0 ? '+' : ''}{formatCurrency(netFlow)}
                        </p>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Right Column Controls */}
              <div className="flex flex-col gap-2.5 items-start md:items-end">
                {/* Arrow Navigation, Month/Year Title and Today button */}
                <div className="flex items-center gap-2.5 justify-start md:justify-end">
                  <button
                    type="button"
                    className="p-2 rounded-xl border border-line bg-white hover:bg-mist text-body transition shadow-xs"
                    onClick={() => setCalendarMonth((current) => shiftMonth(current, -1))}
                    title="Previous Month"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>

                  <h3 className="text-xl sm:text-2xl font-black text-graphite tracking-tight px-1.5 min-w-0 text-center">
                    {dashboardCalendar ? formatMonthLabel(dashboardCalendar.month) : 'Loading...'}
                  </h3>

                  <button
                    type="button"
                    className="p-2 rounded-xl border border-line bg-white hover:bg-mist text-body transition shadow-xs"
                    onClick={() => setCalendarMonth((current) => shiftMonth(current, 1))}
                    title="Next Month"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>

                  <button
                    type="button"
                    className="ml-2 text-xs font-black text-clay hover:text-brand hover:underline"
                    onClick={() => setCalendarMonth(localDateKey().slice(0, 7))}
                  >
                    Today
                  </button>
                </div>
                {/* View Details Button */}
                <button
                  type="button"
                  className="mt-1 inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3.5 py-1.5 text-xs font-black text-body shadow-xs hover:bg-surface transition w-fit md:self-end"
                  onClick={() => {
                    setCalendarViewMode('month');
                    setShowCalendarDrawer(true);
                  }}
                >
                  <CalendarDays className="h-4 w-4 text-muted" />
                  Show Month Details
                </button>
              </div>
            </div>

            {/* Days of Week Headers */}
            <div className="app-calendar">
            <div className="app-calendar-inner">
            <div className="grid grid-cols-7 text-center text-[10px] font-black uppercase tracking-wider text-muted mb-2 py-1">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>

            {/* Days Grid Container */}
            <div className="grid grid-cols-7 gap-1.5 sm:gap-2 p-1.5 sm:p-2 bg-surface rounded-3xl border border-line">
              {dashboardCalendar?.days.map((day, idx) => {
                return (
                  <button
                    key={day.key || `empty-${idx}`}
                    type="button"
                    disabled={!day.day}
                    onClick={() => {
                      if (!day.dateStr) return;
                      setSelectedCalendarDate(day.dateStr);
                      setCalendarViewMode('day');
                      setShowCalendarDrawer(true);
                    }}
                    className={clsx(
                      "relative flex flex-col justify-between items-start min-h-[90px] sm:min-h-[110px] p-2 rounded-2xl transition border group/day",
                      !day.day && "bg-transparent border-transparent pointer-events-none opacity-0",
                      day.day && !day.isSelected && !day.isToday && "bg-white border-line hover:bg-surface text-slate-700 shadow-xs hover:shadow-md hover:border-indigo-300",
                      day.day && !day.isSelected && day.isToday && "border-2 border-indigo-500/60 bg-indigo-50/15 text-slate-800 shadow-xs",
                      day.day && day.isSelected && "border-2 border-indigo-600 ring-2 ring-indigo-500/30 bg-indigo-50/25 text-slate-800 shadow-sm"
                    )}
                  >
                    {day.day && (
                      <>
                        {/* Day / Today status header */}
                        <div className="flex items-center justify-between w-full">
                          {day.isToday ? (
                            <span className="inline-flex items-center rounded-lg bg-indigo-600 px-1.5 py-0.5 text-[8.5px] font-black uppercase text-white tracking-wider shadow-2xs">
                              {day.day} TODAY
                            </span>
                          ) : (
                            <span className="text-xs font-black text-slate-700">{day.day}</span>
                          )}
                          {day.milestones && day.milestones.length > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] font-black text-indigo-700 bg-indigo-50 px-1 py-0.5 rounded-full border border-indigo-200/80">
                              <Flag className="h-2.5 w-2.5" />
                              {day.milestones.length}
                            </span>
                          )}
                        </div>

                        {/* Milestone Tags / Strips */}
                        {day.milestones && day.milestones.length > 0 && (
                          <div className="my-1 flex flex-col gap-1 w-full shrink-0">
                            {day.milestones.map((m) => {
                              const isCompleted = m.status === 'completed';
                              return (
                                <div
                                  key={m.id}
                                  className={clsx(
                                    "group/milestone relative flex items-center gap-1.5 px-1.5 py-0.5 rounded-md text-[9.5px] font-black border transition w-full text-left truncate cursor-pointer shadow-2xs",
                                    isCompleted
                                      ? "bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100"
                                      : "bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100"
                                  )}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (!day.dateStr) return;
                                    setSelectedCalendarDate(day.dateStr);
                                    setCalendarViewMode('day');
                                    setShowCalendarDrawer(true);
                                  }}
                                >
                                  <Flag className={clsx("h-2.5 w-2.5 shrink-0", isCompleted ? "text-emerald-600" : "text-amber-600")} />
                                  <span className="truncate flex-1 font-bold">{m.title}</span>

                                  {/* Rich Hover Tooltip for Milestone Strip */}
                                  <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/milestone:flex flex-col gap-1 z-[130] w-64 rounded-2xl border border-slate-700 bg-slate-900/95 backdrop-blur-md p-3 text-xs text-white shadow-2xl animate-in fade-in duration-150 text-left">
                                    <div className="flex items-center justify-between border-b border-slate-700 pb-1.5">
                                      <span className="font-black text-indigo-300 text-[10px] uppercase tracking-wider flex items-center gap-1">
                                        <Flag className="h-3 w-3 text-indigo-400" /> Milestone
                                      </span>
                                      <span className={clsx(
                                        "px-1.5 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider",
                                        isCompleted ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                                      )}>
                                        {m.status}
                                      </span>
                                    </div>
                                    <p className="font-black text-sm text-white leading-tight">{m.title}</p>
                                    {m.project_name && (
                                      <p className="text-[11px] font-bold text-slate-300">
                                        <span className="text-slate-400 font-normal">Project:</span> {m.project_name}
                                      </p>
                                    )}
                                    <p className="text-[10px] text-slate-400 font-semibold">
                                      Due Date: {formatDate(m.milestone_date)}
                                    </p>
                                    {m.details && (
                                      <p className="text-[10px] text-slate-300 border-t border-slate-800 pt-1.5 mt-0.5 line-clamp-2">
                                        {m.details}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Badges showing Inflow and Outflow totals */}
                        <div className="flex flex-col gap-1 items-end mt-auto w-full">
                          {day.received > 0 && (
                            <span className="bg-emerald-50 border border-emerald-100 text-emerald-700 text-[9.5px] font-black rounded-lg py-0.5 px-1.5 flex items-center justify-center w-full sm:w-auto shrink-0 select-none shadow-2xs">
                              ↑ ₹{formatCompactCurrency(day.received)}
                            </span>
                          )}
                          {day.spent > 0 && (
                            <span className="bg-rose-50 border border-rose-100 text-rose-700 text-[9.5px] font-black rounded-lg py-0.5 px-1.5 flex items-center justify-center w-full sm:w-auto shrink-0 select-none shadow-2xs">
                              ↓ ₹{formatCompactCurrency(day.spent)}
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
            </div>
            </div>
          </SectionCard>
        </div>

        {/* Right Column (xl:col-span-1) */}
        <div className="xl:col-span-1 space-y-6 min-w-0">
          {/* Cost Calculation per sqft */}
          <SectionCard title="Cost Calculation (per sqft)">
            <div className="mb-3 flex items-center justify-between text-xs font-semibold text-muted">
              <span>Ongoing projects</span>
              <span className="rounded-full bg-mist px-2.5 py-0.5 text-[10px] font-bold text-body">
                {costPerSqftChartData.length} project{costPerSqftChartData.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="space-y-4">
              {costPerSqftChartData.map((project) => {
                const percent = project.estimatedPerSqft > 0 ? (project.spentPerSqft / project.estimatedPerSqft) * 100 : 0;
                return (
                  <div key={project.name} className="space-y-1.5 bg-surface p-3.5 rounded-2xl border border-line shadow-sm">
                    <div className="flex justify-between items-start text-xs font-semibold">
                      <div className="min-w-0">
                        <span className="text-graphite font-bold block truncate" title={project.name}>{project.name}</span>
                        <span className="text-[10px] text-muted">Consumed: {formatCurrency(project.actualSpentPerSqft)}/sqft</span>
                      </div>
                      <span className="text-body font-bold shrink-0">
                        Quoted: {formatCurrency(project.estimatedPerSqft)}/sqft
                      </span>
                    </div>
                    <div className="relative pt-1">
                      <div className="w-full h-2.5 bg-sand rounded-full overflow-hidden flex">
                        <div className="h-full bg-emerald-700 rounded-full transition-all duration-500" style={{ width: `${Math.min(percent, 100)}%` }} />
                        {percent > 100 && (
                          <div className="h-full bg-danger transition-all duration-500" style={{ width: `${Math.min(percent - 100, 100)}%` }} />
                        )}
                      </div>
                      <div className="flex justify-between items-center text-[10px] text-muted mt-1 font-bold">
                        <span>{percent.toFixed(0)}% used</span>
                        {percent > 100 && <span className="text-danger font-black tracking-wide">OVERRUN</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </SectionCard>

          {/* Overdue Aging */}
          <SectionCard title="Overdue Aging">
            <div className="space-y-2.5">
              {data.overdue_aging.map((item) => (
                <div key={item.bucket} className="flex items-center justify-between p-3 rounded-2xl border border-slate-100 bg-slate-50/50 text-xs">
                  <div>
                    <p className="font-bold text-slate-700">{item.bucket}</p>
                    <p className="text-[9px] text-slate-400 uppercase tracking-wider mt-0.5">{item.count} payment(s)</p>
                  </div>
                  <p className="text-sm font-black text-slate-800">{formatCurrency(item.amount)}</p>
                </div>
              ))}
              <div className="flex items-center justify-between p-3 rounded-2xl border border-rose-100 bg-rose-50/60 text-xs mt-3 shadow-sm">
                <span className="font-bold text-rose-800">Total Overdue Payments</span>
                <span className="text-sm font-black text-rose-900">{formatCurrency(data.overdue_aging.reduce((sum, row) => sum + row.amount, 0))}</span>
              </div>
            </div>
          </SectionCard>

          {/* Daily Flow Preview */}
          <SectionCard title={calendarMonth === localDateKey().slice(0, 7) ? "Daily Flow Preview" : "Month flow summary"}>
            {calendarMonth === localDateKey().slice(0, 7) ? (
              // Current month: Show Today's Flow
              (() => {
                const todayStr = localDateKey();
                const todayData = dashboardCalendar?.days?.find(d => d.dateStr === todayStr);
                const hasTodayActivity = todayData && (todayData.spent > 0 || todayData.received > 0);

                return (
                  <div className="space-y-4">
                    <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3 text-center">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">TODAY'S DATE</p>
                      <p className="mt-1 text-sm font-black text-slate-800">
                        {new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-emerald-50/60 border border-emerald-100/70 rounded-2xl p-3 text-center shadow-sm">
                        <p className="text-[9px] font-black uppercase tracking-wider text-emerald-700">INFLOW</p>
                        <p className="mt-1 text-base font-black text-emerald-800">
                          {formatCurrency(todayData?.received || 0)}
                        </p>
                      </div>
                      <div className="bg-rose-50/60 border border-rose-100/70 rounded-2xl p-3 text-center shadow-sm">
                        <p className="text-[9px] font-black uppercase tracking-wider text-rose-700">OUTFLOW</p>
                        <p className="mt-1 text-base font-black text-rose-800">
                          {formatCurrency(todayData?.spent || 0)}
                        </p>
                      </div>
                    </div>

                    <div className="border-t border-slate-100 pt-3">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">TODAY'S ACTIVITY</p>
                      {hasTodayActivity && todayData?.transactions && todayData.transactions.length > 0 ? (
                        <div className="space-y-2 max-h-[140px] overflow-y-auto pr-1">
                          {todayData.transactions.slice(0, 3).map((t, idx) => (
                            <div key={idx} className={clsx(
                              "flex items-center justify-between gap-2 p-2.5 rounded-xl text-xs border border-slate-100 bg-white shadow-sm",
                              t.direction === 'received' ? "border-l-4 border-l-emerald-500" : "border-l-4 border-l-rose-500"
                            )}>
                              <div className="min-w-0">
                                <p className="font-bold text-slate-800 truncate" title={t.title}>{t.title}</p>
                                <p className="text-[10px] text-slate-400 truncate" title={t.project_name}>{t.project_name}</p>
                              </div>
                              <span className={clsx(
                                "font-black text-right shrink-0",
                                t.direction === 'received' ? "text-emerald-700" : "text-rose-700"
                              )}>
                                {t.direction === 'received' ? '+' : '-'}{formatCompactCurrency(t.amount)}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-5 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                          <p className="text-xs font-bold text-slate-700">No transactions today</p>
                          <p className="text-[10px] text-slate-400 mt-1 max-w-[80%] mx-auto leading-relaxed">
                            Everything is quiet. Check the rest of the month's flow below.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()
            ) : (
              // Other month: Show Month Category breakdown
              (() => {
                const totals = dashboardCalendar?.totals || { spent: 0, received: 0, balance: 0 };
                
                // Simple category counts
                let materialCount = 0;
                let labourCount = 0;
                let expenseCount = 0;
                let receiptCount = 0;
                
                calendarData?.days.forEach(day => {
                  day.transactions.forEach(t => {
                    if (t.type === 'Material') materialCount++;
                    else if (t.type === 'Labour') labourCount++;
                    else if (t.type === 'Expense' || t.type === 'Vendor Payment') expenseCount++;
                    else if (t.type === 'Client Receipt' || t.type === 'Shareholder Receipt') receiptCount++;
                  });
                });

                return (
                  <div className="space-y-3.5">
                    <div className="bg-indigo-50/60 border border-indigo-100 rounded-2xl p-3 text-center shadow-sm">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-700">NET BALANCE</p>
                      <p className={clsx(
                        "mt-1 text-xl font-black tracking-tight",
                        totals.balance >= 0 ? "text-emerald-700" : "text-amber-700"
                      )}>
                        {formatCurrency(totals.balance)}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-center text-xs">
                      <div className="bg-slate-50 border border-slate-100 rounded-xl py-2 px-1">
                        <span className="block text-[9px] font-black text-slate-400 uppercase">RECEIVED</span>
                        <span className="font-bold text-slate-700">{formatCompactCurrency(totals.received)}</span>
                      </div>
                      <div className="bg-slate-50 border border-slate-100 rounded-xl py-2 px-1">
                        <span className="block text-[9px] font-black text-slate-400 uppercase">SPENT</span>
                        <span className="font-bold text-slate-700">{formatCompactCurrency(totals.spent)}</span>
                      </div>
                    </div>

                    <div className="border-t border-slate-100 pt-3">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">TRANSACTION COUNTS</p>
                      <div className="grid grid-cols-2 gap-2 text-xs font-semibold text-slate-600">
                        <div className="flex justify-between items-center bg-slate-50/60 p-2 rounded-xl">
                          <span>Materials</span>
                          <span className="font-bold text-slate-800 bg-slate-200/60 rounded px-1.5 py-0.5 text-[10px]">{materialCount}</span>
                        </div>
                        <div className="flex justify-between items-center bg-slate-50/60 p-2 rounded-xl">
                          <span>Labour</span>
                          <span className="font-bold text-slate-800 bg-slate-200/60 rounded px-1.5 py-0.5 text-[10px]">{labourCount}</span>
                        </div>
                        <div className="flex justify-between items-center bg-slate-50/60 p-2 rounded-xl">
                          <span>Expenses</span>
                          <span className="font-bold text-slate-800 bg-slate-200/60 rounded px-1.5 py-0.5 text-[10px]">{expenseCount}</span>
                        </div>
                        <div className="flex justify-between items-center bg-slate-50/60 p-2 rounded-xl">
                          <span>Receipts</span>
                          <span className="font-bold text-slate-800 bg-slate-200/60 rounded px-1.5 py-0.5 text-[10px]">{receiptCount}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()
            )}
          </SectionCard>
        </div>
      </div>

      {/* Analytical Detail Tables Row */}
      {urgentMilestoneReminders.length ? (
        <div className="rounded-[28px] border border-rose-200 bg-gradient-to-br from-rose-50 via-white to-orange-50 p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-rose-600">Milestone reminder</p>
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            {urgentMilestoneReminders.map((alert, index) => (
              <Link
                key={`${alert.title}-${index}`}
                to={alert.route || '/milestones'}
                className="rounded-2xl border border-rose-200 bg-white px-4 py-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <p className="text-lg font-black text-rose-800">{alert.title}</p>
                <p className="mt-2 text-sm font-semibold text-slate-700">{alert.detail}</p>
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      <SectionCard
        title="Project Health Ranking"
        action={
          <ProjectStatusSelect
            id="project-health-status-filter"
            value={healthStatusFilter}
            onChange={setHealthStatusFilter}
          />
        }
      >
        <DataTable
          size="roomy"
          printTitle="Dashboard - Project Health Ranking"
          printMetadata={{
            Module: 'Dashboard',
            Status: healthStatusFilter,
            'Total Projects': filteredProjectHealth.length,
            Outstanding: formatCurrency(filteredProjectHealth.reduce((sum, row) => sum + row.outstanding, 0)),
          }}
          headers={['Project', 'Status', 'Total Amount', 'Cost', 'Received', 'Outstanding', 'Margin %', 'Collection %', 'Cost/Total %']}
          rows={filteredProjectHealth.map((project) => [
            <ProjectNameLink
              key={project.project_id}
              to={`/projects?projectId=${project.project_id}`}
              name={project.project_name}
              status={project.status}
              colorize={healthStatusFilter === 'all'}
            />,
            project.status,
            formatCurrency(project.total_amount),
            formatCurrency(project.total_cost),
            formatCurrency(project.total_received),
            formatCurrency(project.outstanding),
            `${project.profit_margin_pct.toFixed(1)}%`,
            `${project.collection_efficiency_pct.toFixed(1)}%`,
            `${project.cost_to_quote_pct.toFixed(1)}%`,
          ])}
        />
      </SectionCard>

      <div className="space-y-6">
        <SectionCard
          title="Client Collection Risk"
          action={
            <ProjectStatusSelect
              id="shareholder-risk-status-filter"
              value={shareholderStatusFilter}
              onChange={setShareholderStatusFilter}
            />
          }
        >
          <DataTable
            printTitle="Dashboard - Client Collection Risk"
            printMetadata={{
              Module: 'Dashboard',
              Status: shareholderStatusFilter,
              'Risk Rows': filteredShareholderRisks.length,
              Balance: formatCurrency(filteredShareholderRisks.reduce((sum, row) => sum + row.balance_amount, 0)),
            }}
            headers={['Project', 'Client', 'Due', 'Paid', 'Balance', 'Collection %']}
            rows={filteredShareholderRisks.map((row) => {
              const status = projectStatusById.get(row.project_id) || 'upcoming';
              return [
                <ProjectNameLink
                  key={`${row.project_id}-${row.shareholder_id}`}
                  to={`/projects?projectId=${row.project_id}`}
                  name={row.project_name}
                  status={status}
                  colorize={shareholderStatusFilter === 'all'}
                />,
                <ClientHoverLink
                  to={`/clients?projectId=${row.project_id}&shareholderId=${row.shareholder_id}`}
                  name={row.shareholder_name}
                  company={row.company_name}
                  phone={row.phone}
                  address={row.address}
                />,
                formatCurrency(row.due_amount),
                formatCurrency(row.paid_amount),
                formatCurrency(row.balance_amount),
                `${row.collection_efficiency_pct.toFixed(1)}%`,
              ];
            })}
          />
        </SectionCard>

        <SectionCard
          title="Top Overdue Payment Items"
          action={
            <ProjectStatusSelect
              id="overdue-payment-status-filter"
              value={overdueStatusFilter}
              onChange={setOverdueStatusFilter}
            />
          }
        >
          {filteredOverduePayments.length ? (
            <DataTable
              printTitle="Dashboard - Top Overdue Payment Items"
              printMetadata={{
                Module: 'Dashboard',
                Status: overdueStatusFilter,
                'Overdue Items': filteredOverduePayments.length,
                'Overdue Amount': formatCurrency(filteredOverduePayments.reduce((sum, row) => sum + row.amount, 0)),
              }}
              headers={['Project', 'Type', 'Due Date', 'Days', 'Amount', 'Status']}
              rows={filteredOverduePayments.map((payment) => {
                const status = projectStatusById.get(payment.project_id) || 'upcoming';
                return [
                  <ProjectNameLink
                    key={payment.payment_id}
                    to={`/projects?projectId=${payment.project_id}`}
                    name={payment.project_name}
                    status={status}
                    colorize={overdueStatusFilter === 'all'}
                  />,
                  payment.payment_type,
                  formatDate(payment.due_date),
                  `${payment.days_overdue}d`,
                  formatCurrency(payment.amount),
                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">
                    <CircleDollarSign className="h-3 w-3" />
                    {payment.status}
                  </span>,
                ];
              })}
            />
          ) : (
            <EmptyState title="No overdue payments" subtitle="Collections are on track for this status." />
          )}
        </SectionCard>
      </div>

      <SectionCard title="Notes">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Fast view</p>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{totalNotes} active</span>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {quickNotes.length ? (
            quickNotes.map((note, index) => (
              <Link
                key={note.id}
                to="/notes"
                className="group flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-sm"
              >
                <div
                  className="mt-0.5 h-10 w-1.5 shrink-0 rounded-full bg-gradient-to-b from-navy via-steel to-amber-700"
                  style={{ opacity: Math.max(0.55, 1 - index * 0.12) }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="truncate text-sm font-semibold text-slate-900">{note.topic}</p>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Note
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600">{note.importantInfo}</p>
                  <p className="mt-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                    {formatQuickNoteTime(note.updatedAt)}
                  </p>
                </div>
              </Link>
            ))
          ) : (
            <Link
              to="/notes"
              className="block rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600 transition hover:border-slate-400 hover:bg-slate-100"
            >
              No notes yet. Open the notes board to add a quick reminder or site update.
            </Link>
          )}
        </div>
      </SectionCard>
      {/* Interactive Detailed Portfolio Calendar Drawer */}
      {showCalendarDrawer && dashboardCalendar && (
        <div 
          className="fixed inset-0 z-[100] flex justify-end bg-slate-950/40 transition-opacity duration-300" 
          onClick={() => { setShowCalendarDrawer(false); setSelectedCalendarDate(null); }}
        >
          <aside
            className="calendar-drawer-panel h-full w-full max-w-xl translate-x-0 overflow-y-auto bg-white shadow-[-20px_0_60px_rgba(15,23,42,0.25)] transition-transform duration-300 flex flex-col"
            onClick={(event) => event.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 z-10 border-b border-line bg-white px-6 py-4 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-clay">DAILY TRANSACTIONS</p>
                <h3 className="mt-1 text-xl font-black text-slate-800">Cashflow Details</h3>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  Consolidated transactions for the selected date
                </p>
              </div>
              <button
                type="button"
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 hover:text-slate-800 transition"
                onClick={() => { setShowCalendarDrawer(false); setSelectedCalendarDate(null); }}
              >
                Close
              </button>
            </div>

            {/* Content Body */}
            <div className="p-6 flex-1 overflow-y-auto space-y-4">
              {/* Explorer Toolbar */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
                      <Search className="h-3.5 w-3.5" />
                    </span>
                    <input
                      type="text"
                      className="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 outline-none transition focus:bg-white focus:border-slate-300 focus:ring-2 focus:ring-slate-100"
                      placeholder="Search transactions (e.g. cement, wages, client...)"
                      value={calendarSearchQuery}
                      onChange={(e) => setCalendarSearchQuery(e.target.value)}
                    />
                    {calendarSearchQuery && (
                      <button
                        type="button"
                        className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600"
                        onClick={() => setCalendarSearchQuery('')}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Filters (Project and Type) */}
                  <div className="grid grid-cols-2 gap-2 text-xs font-bold">
                    <div>
                      <label className="block text-[9px] uppercase tracking-wider text-slate-400 mb-1">Project</label>
                      <SearchableSelect
                        options={[
                          { id: 'all', name: 'All Projects' },
                          ...cashflowProjects,
                        ]}
                        value={calendarFilterProject}
                        onChange={setCalendarFilterProject}
                        placeholder="Search project..."
                        widthClass="w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] uppercase tracking-wider text-slate-400 mb-1">Log Type</label>
                      <SearchableSelect
                        options={[
                          { id: 'all', name: 'All Types' },
                          { id: 'Client Receipt', name: 'Client Receipts' },
                          { id: 'Shareholder Receipt', name: 'Shareholder Receipts' },
                          { id: 'Material', name: 'Material Logs' },
                          { id: 'Labour', name: 'Labour Logs' },
                          { id: 'Expense', name: 'Site Expenses' },
                          { id: 'Vendor Payment', name: 'Vendor Payments' },
                        ]}
                        value={calendarFilterType}
                        onChange={setCalendarFilterType}
                        placeholder="Search type..."
                        widthClass="w-full"
                      />
                    </div>
                  </div>
                </div>

                {/* Day Details Card */}
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col min-h-[350px] max-h-[500px]">
                  <div className="border-b border-slate-100 pb-3 mb-3 flex items-start justify-between">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                        SELECTED DAY TRANSACTIONS
                      </p>
                      <h4 className="mt-0.5 text-base font-black text-slate-800">
                        {selectedCalendarDate
                          ? new Date(selectedCalendarDate).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })
                          : 'No Date Selected'
                        }
                      </h4>
                    </div>
                    <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-black text-indigo-700 border border-indigo-100">
                      {filteredTransactions.length} records
                    </span>
                  </div>

                  {/* Transaction items list */}
                  <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                    {filteredTransactions.length > 0 ? (
                      filteredTransactions.map((t) => {
                        const isReceived = t.direction === 'received';
                        return (
                          <div
                            key={t.id}
                            className={clsx(
                              "border rounded-xl p-3 bg-slate-50/50 hover:bg-slate-50 transition text-xs relative",
                              isReceived ? "border-l-4 border-l-emerald-500 border-slate-200" : "border-l-4 border-l-rose-500 border-slate-200"
                            )}
                          >
                            <div className="flex justify-between items-start gap-4">
                              <div className="space-y-1 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className={clsx(
                                    "rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide",
                                    t.type === 'Material' && 'bg-slate-200 text-slate-700',
                                    t.type === 'Labour' && 'bg-amber-100 text-amber-800',
                                    t.type === 'Expense' && 'bg-orange-100 text-orange-800',
                                    t.type === 'Client Receipt' && 'bg-emerald-100 text-emerald-800',
                                    t.type === 'Shareholder Receipt' && 'bg-sky-100 text-sky-800',
                                    t.type === 'Vendor Payment' && 'bg-purple-100 text-purple-800',
                                  )}>
                                    {t.type}
                                  </span>
                                  {calendarViewMode === 'month' && (
                                    <span className="text-[10px] text-slate-400 font-bold">
                                      {new Date(t.date).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
                                    </span>
                                  )}
                                </div>
                                <p className="font-bold text-slate-800 text-sm leading-tight">{t.title}</p>
                                <div className="flex items-center gap-1 text-[10px] text-slate-500">
                                  <span>Site:</span>
                                  <Link
                                    to={`/projects?projectId=${t.project_id}`}
                                    className="font-bold text-indigo-600 hover:text-indigo-800 hover:underline"
                                    onClick={() => setShowCalendarDrawer(false)}
                                  >
                                    {t.project_name}
                                  </Link>
                                </div>
                              </div>
                              <span className={clsx(
                                "font-black text-right shrink-0 text-sm",
                                isReceived ? "text-emerald-700" : "text-rose-700"
                              )}>
                                {isReceived ? '+' : '-'}{formatCurrency(t.amount)}
                              </span>
                            </div>
                            {t.detail && (
                              <p className="mt-2 text-[11px] leading-relaxed text-slate-500 bg-white border border-slate-100 rounded-lg p-2 font-medium">
                                {t.detail}
                              </p>
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full py-16 text-slate-400 text-center">
                        <AlertTriangle className="h-8 w-8 text-slate-300 mb-2" />
                        <p className="text-xs font-bold">No transactions found</p>
                        <p className="text-[10px] text-slate-400 mt-1 max-w-[80%] leading-relaxed">
                          Try adjusting your project filter, log type, or search query to find entries.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

              </div>
          </aside>
        </div>
      )}
    </div>
  );
}
