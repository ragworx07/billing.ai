import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Calendar as CalendarIcon,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Edit3,
  Filter,
  Info,
  Layers,
  Package,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';

import { BuildingLoader } from '../components/BuildingLoader';
import { EmptyState } from '../components/EmptyState';
import { useAuditHover } from '../contexts/AuditHoverContext';
import { useNotify } from '../contexts/NotificationContext';
import { api } from '../services/api';
import type { Project, ProjectMilestone } from '../types/api';
import { getApiErrorMessage } from '../utils/errors';
import { formatDate } from '../utils/format';

const projectColors = [
  '#2563eb', // blue
  '#059669', // emerald
  '#d97706', // amber
  '#7c3aed', // purple
  '#dc2626', // red
  '#0891b2', // cyan
  '#be185d', // pink
  '#4f46e5', // indigo
];

const initialForm = {
  project_id: 0,
  title: '',
  milestone_date: formatDateKey(new Date()),
  details: '',
};

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toDateKey(date: Date) {
  return formatDateKey(date);
}

function getMonthDays(monthDate: Date) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function daysFromToday(dateKey: string) {
  const today = new Date(new Date().toDateString());
  const target = new Date(`${dateKey}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function reminderText(dateKey: string, completed: boolean) {
  if (completed) return 'Completed';
  const days = daysFromToday(dateKey);
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`;
  if (days === 0) return 'Due today';
  return `${days} day${days === 1 ? '' : 's'} left`;
}

function projectColor(projectId: number, projects: Project[]) {
  const index = Math.max(0, projects.findIndex((project) => project.id === projectId));
  return projectColors[index % projectColors.length];
}

function sortedMilestones(items: ProjectMilestone[]) {
  return items.slice().sort((left, right) => {
    const statusGap = Number(left.status === 'completed') - Number(right.status === 'completed');
    if (statusGap !== 0) return statusGap;
    return new Date(left.milestone_date).getTime() - new Date(right.milestone_date).getTime();
  });
}

export function MilestonesPage() {
  const notify = useNotify();
  const { showAudit, hideAudit } = useAuditHover();
  const queryClient = useQueryClient();
  const [monthDate, setMonthDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => formatDateKey(new Date()));

  // Selected project filter for the section below calendar
  const [tableProjectId, setTableProjectId] = useState<number | 'all'>('all');
  const [tableStatusFilter, setTableStatusFilter] = useState<'all' | 'pending' | 'completed'>('all');
  const [tableSearchQuery, setTableSearchQuery] = useState('');
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState('');

  // Modals state
  const [selectedMilestoneForDetail, setSelectedMilestoneForDetail] = useState<ProjectMilestone | null>(null);
  const [editingMilestoneId, setEditingMilestoneId] = useState<number | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState(initialForm);

  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: api.getProjects,
  });
  const { data: milestones = [], isLoading: milestonesLoading } = useQuery({
    queryKey: ['milestones'],
    queryFn: api.getMilestones,
  });

  const milestoneAuditRecords = useMemo(
    () => milestones.map((milestone) => ({ table_name: 'project_milestones', record_id: milestone.id })),
    [milestones],
  );
  const { data: milestoneAuditActors = {} } = useQuery({
    queryKey: ['audit-actors', 'milestones', milestones.map((milestone) => milestone.id)],
    queryFn: () => api.getAuditActors(milestoneAuditRecords),
    enabled: milestoneAuditRecords.length > 0,
  });
  const showMilestoneAudit = (milestone: ProjectMilestone) => showAudit(milestoneAuditActors[`project_milestones:${milestone.id}`] || null, 'Milestone');

  const activeProjects = useMemo(
    () => projects.filter((project) => project.status === 'ongoing' || project.status === 'upcoming'),
    [projects],
  );

  // Map milestones by date for calendar day tiles
  const milestonesByDate = useMemo(() => {
    const map = new Map<string, ProjectMilestone[]>();
    milestones.forEach((milestone) => {
      const rows = map.get(milestone.milestone_date) || [];
      rows.push(milestone);
      map.set(milestone.milestone_date, sortedMilestones(rows));
    });
    return map;
  }, [milestones]);

  // All upcoming events across all projects sorted chronologically (nearest first)
  const allUpcomingEvents = useMemo(() => {
    const today = formatDateKey(new Date());
    return milestones
      .filter((item) => item.status !== 'completed' && item.milestone_date >= today)
      .filter((item) => {
        if (!sidebarSearchQuery.trim()) return true;
        const q = sidebarSearchQuery.trim().toLowerCase();
        return (
          item.title.toLowerCase().includes(q) ||
          (item.project_name || '').toLowerCase().includes(q) ||
          (item.details || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => new Date(a.milestone_date).getTime() - new Date(b.milestone_date).getTime());
  }, [milestones, sidebarSearchQuery]);

  // Filtered milestones for the project-based table below calendar
  const projectTableMilestones = useMemo(() => {
    const query = tableSearchQuery.trim().toLowerCase();
    return milestones
      .filter((item) => {
        const matchesProject = tableProjectId === 'all' || item.project_id === tableProjectId;
        const matchesStatus =
          tableStatusFilter === 'all' ||
          (tableStatusFilter === 'completed' ? item.status === 'completed' : item.status !== 'completed');
        const matchesQuery =
          !query ||
          item.title.toLowerCase().includes(query) ||
          (item.project_name || '').toLowerCase().includes(query) ||
          (item.details || '').toLowerCase().includes(query);
        return matchesProject && matchesStatus && matchesQuery;
      })
      .sort((a, b) => new Date(a.milestone_date).getTime() - new Date(b.milestone_date).getTime());
  }, [milestones, tableProjectId, tableStatusFilter, tableSearchQuery]);

  const saveMutation = useMutation({
    mutationFn: (payload: typeof form) => {
      const cleanPayload = {
        project_id: Number(payload.project_id),
        title: payload.title.trim(),
        milestone_date: payload.milestone_date,
        details: payload.details.trim() || null,
      };
      return editingMilestoneId ? api.updateMilestone(editingMilestoneId, cleanPayload) : api.createMilestone(cleanPayload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['milestones'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setEditingMilestoneId(null);
      setIsFormOpen(false);
      setSelectedMilestoneForDetail(null);
      setForm({ ...initialForm, milestone_date: selectedDate, project_id: activeProjects[0]?.id || 0 });
      notify.success('Milestone saved successfully.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to save milestone.')),
  });

  const completeMutation = useMutation({
    mutationFn: api.completeMilestone,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['milestones'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      if (selectedMilestoneForDetail) {
        setSelectedMilestoneForDetail((curr) => (curr ? { ...curr, status: 'completed' } : null));
      }
      notify.success('Milestone marked as completed.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to complete milestone.')),
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteMilestone,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['milestones'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setSelectedMilestoneForDetail(null);
      notify.success('Milestone deleted.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to delete milestone.')),
  });

  function startCreate(dateKey = selectedDate, projectId = activeProjects[0]?.id || 0) {
    setEditingMilestoneId(null);
    setSelectedDate(dateKey);
    setForm({ ...initialForm, project_id: projectId, milestone_date: dateKey });
    setIsFormOpen(true);
  }

  function startEdit(milestone: ProjectMilestone) {
    setEditingMilestoneId(milestone.id);
    setSelectedDate(milestone.milestone_date);
    setForm({
      project_id: milestone.project_id,
      title: milestone.title,
      milestone_date: milestone.milestone_date,
      details: milestone.details || '',
    });
    setIsFormOpen(true);
  }

  function openDetailModal(milestone: ProjectMilestone) {
    setSelectedMilestoneForDetail(milestone);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.project_id || !form.title.trim() || !form.milestone_date) return;
    saveMutation.mutate(form);
  }

  function moveMonth(offset: number) {
    setMonthDate((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  }

  function resetToToday() {
    const today = new Date();
    setMonthDate(today);
    setSelectedDate(formatDateKey(today));
  }

  if (projectsLoading || milestonesLoading) {
    return <BuildingLoader label="Building milestones & calendar" />;
  }

  const monthDays = getMonthDays(monthDate);
  const todayKey = formatDateKey(new Date());

  return (
    <div className="min-w-0 space-y-6">
      {/* Header Section */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-[28px] border border-white/70 bg-gradient-to-r from-white/90 via-slate-50/80 to-indigo-50/60 px-6 py-5 shadow-[0_10px_30px_rgba(30,41,59,0.06)]">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-indigo-100/70 px-3 py-1 text-xs font-extrabold text-indigo-900">
            <CalendarIcon className="h-3.5 w-3.5" />
            Project Progress Schedule
          </div>
          <h1 className="mt-1 font-display text-3xl text-graphite sm:text-4xl">Milestones & Events Calendar</h1>
          <p className="mt-0.5 text-sm font-medium text-slate-600">
            Track key deliverables across projects, preview event timelines, and manage project milestones seamlessly.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2.5 rounded-2xl bg-graphite px-5 py-3.5 text-sm font-bold text-white shadow-lg transition hover:bg-black hover:shadow-xl active:scale-[0.98]"
          onClick={() => startCreate()}
        >
          <Plus className="h-4 w-4" />
          + New Milestone
        </button>
      </section>

      {/* Main Grid: Left Sidebar (Upcoming Events) + Main Calendar */}
      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        {/* Left Sidebar: Upcoming Events across all projects */}
        <aside className="flex flex-col gap-4 rounded-[28px] border border-slate-200/90 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3.5">
            <div className="flex items-center gap-2">
              <div className="rounded-xl bg-amber-100 p-2 text-amber-800">
                <Clock className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-base font-extrabold text-graphite">Upcoming Events</h2>
                <p className="text-xs font-semibold text-slate-500">Across all projects ({allUpcomingEvents.length})</p>
              </div>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-extrabold text-slate-700">
              {allUpcomingEvents.length}
            </span>
          </div>

          {/* Search box for sidebar */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              placeholder="Search upcoming events..."
              value={sidebarSearchQuery}
              onChange={(e) => setSidebarSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/60 py-2 pl-9 pr-3 text-xs outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          {/* Chronological list of upcoming events */}
          <div className="flex-1 space-y-2.5 max-h-[640px] overflow-y-auto pr-1">
            {allUpcomingEvents.length ? (
              allUpcomingEvents.map((milestone) => {
                const color = projectColor(milestone.project_id, activeProjects);
                const days = daysFromToday(milestone.milestone_date);
                const isOverdue = days < 0;
                const isToday = days === 0;

                return (
                  <button
                    key={milestone.id}
                    type="button"
                    className="group relative flex w-full flex-col gap-1.5 rounded-2xl border border-slate-200/80 bg-slate-50/60 p-3.5 text-left transition hover:border-indigo-300 hover:bg-gradient-to-r hover:from-white hover:to-indigo-50/30 hover:shadow-md"
                    onClick={() => openDetailModal(milestone)}
                    onMouseEnter={() => showMilestoneAudit(milestone)}
                    onMouseLeave={hideAudit}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full shadow-xs" style={{ backgroundColor: color }} />
                        <p className="truncate text-sm font-extrabold text-slate-900 group-hover:text-indigo-950">
                          {milestone.title}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-200/50">
                      <span className="truncate text-xs font-semibold text-slate-600">
                        {milestone.project_name || 'Project'}
                      </span>
                      <span
                        className={clsx(
                          'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold',
                          isOverdue
                            ? 'bg-rose-100 text-rose-800'
                            : isToday
                            ? 'bg-amber-100 text-amber-900'
                            : 'bg-emerald-100 text-emerald-800',
                        )}
                      >
                        {formatDate(milestone.milestone_date)} ({reminderText(milestone.milestone_date, false)})
                      </span>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center">
                <CalendarDays className="mx-auto h-7 w-7 text-slate-300" />
                <p className="mt-2 text-xs font-bold text-slate-600">No upcoming events found</p>
                <p className="mt-0.5 text-[11px] text-slate-400">All planned milestones are completed or search filtered.</p>
              </div>
            )}
          </div>
        </aside>

        {/* Main Calendar View */}
        <section className="flex flex-col rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          {/* Month Navigation Toolbar */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-xl border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                onClick={() => moveMonth(-1)}
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <h2 className="font-display text-xl sm:text-2xl text-graphite min-w-0 flex-1 text-center sm:min-w-[12rem]">
                {monthDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
              </h2>
              <button
                type="button"
                className="rounded-xl border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                onClick={() => moveMonth(1)}
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-extrabold text-slate-700 shadow-xs transition hover:bg-slate-100"
                onClick={resetToToday}
              >
                Today
              </button>
            </div>
          </div>

          {/* Days of Week Header */}
          <div className="app-calendar">
          <div className="app-calendar-inner">
          <div className="grid grid-cols-7 border-b border-slate-100 pb-2 text-center text-xs font-black uppercase tracking-wider text-slate-400">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
              <div key={day}>{day}</div>
            ))}
          </div>

          {/* Calendar Day Tiles (7 columns x 6 rows) */}
          <div className="mt-2 grid flex-1 grid-cols-7 gap-1.5 min-h-[520px]">
            {monthDays.map((day) => {
              const dateKey = toDateKey(day);
              const dayMilestones = milestonesByDate.get(dateKey) || [];
              const isCurrentMonth = day.getMonth() === monthDate.getMonth();
              const isToday = dateKey === todayKey;
              const hasMilestones = dayMilestones.length > 0;

              return (
                <div
                  key={dateKey}
                  className={clsx(
                    'group relative flex min-h-[95px] flex-col rounded-2xl border p-2 text-left transition-colors',
                    isToday ? 'border-indigo-400 bg-indigo-50/20 ring-1 ring-indigo-300' : 'border-slate-200/90 bg-white',
                    !isCurrentMonth && 'bg-slate-50/50 opacity-45',
                    !hasMilestones && isCurrentMonth && 'hover:bg-slate-50/80',
                  )}
                  onClick={(e) => {
                    // If clicking directly on empty day space, start create milestone for this date
                    if (e.target === e.currentTarget) {
                      startCreate(dateKey);
                    }
                  }}
                >
                  {/* Top Bar of Day Tile: Date Number & Add Button */}
                  <div className="flex items-center justify-between pointer-events-none">
                    <span
                      className={clsx(
                        'inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-black transition',
                        isToday ? 'bg-clay text-white shadow-sm' : 'text-slate-700',
                      )}
                    >
                      {day.getDate()}
                    </span>

                    <button
                      type="button"
                      className="pointer-events-auto opacity-0 group-hover:opacity-100 transition rounded-md p-0.5 hover:bg-slate-200 text-slate-500"
                      onClick={(e) => {
                        e.stopPropagation();
                        startCreate(dateKey);
                      }}
                      title="Add milestone on this day"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Compact Event Indicators inside Day Tile with Hover Expansion */}
                  <div className="mt-1.5 flex flex-col gap-1 flex-1">
                    {dayMilestones.slice(0, 3).map((milestone) => {
                      const color = projectColor(milestone.project_id, activeProjects);
                      const isCompleted = milestone.status === 'completed';

                      return (
                        <div
                          key={milestone.id}
                          className="group/badge relative cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDetailModal(milestone);
                          }}
                          onMouseEnter={() => showMilestoneAudit(milestone)}
                          onMouseLeave={hideAudit}
                        >
                          {/* Standard compact indicator badge */}
                          <div
                            className={clsx(
                              'flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11px] font-bold shadow-2xs transition-all duration-200 ease-out',
                              'group-hover/badge:scale-[1.05] group-hover/badge:z-30 group-hover/badge:shadow-md group-hover/badge:bg-white group-hover/badge:ring-1 group-hover/badge:ring-slate-300',
                              isCompleted
                                ? 'bg-emerald-50 text-emerald-900 border border-emerald-200/60 line-through opacity-75'
                                : 'bg-slate-100 text-slate-900 border border-slate-200/70',
                            )}
                          >
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: color }}
                            />
                            <span className="truncate flex-1">{milestone.title}</span>
                          </div>

                          {/* Hover Expansion Card (appears smoothly on hover showing details preview) */}
                          <div className="pointer-events-none absolute left-0 top-0 z-40 hidden w-[220px] rounded-2xl border border-slate-200 bg-white p-3 shadow-xl group-hover/badge:block group-hover/badge:pointer-events-auto">
                            <div className="flex items-center gap-2">
                              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                              <p className="font-extrabold text-xs text-slate-900 truncate">{milestone.title}</p>
                            </div>
                            <p className="mt-1 text-[11px] font-semibold text-slate-500 truncate">{milestone.project_name}</p>
                            <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-1.5 text-[10px] font-bold">
                              <span className="text-slate-500">{formatDate(milestone.milestone_date)}</span>
                              <span className={clsx(isCompleted ? 'text-emerald-700' : 'text-amber-700')}>
                                {reminderText(milestone.milestone_date, isCompleted)}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {dayMilestones.length > 3 ? (
                      <button
                        type="button"
                        className="mt-auto inline-flex items-center text-[10px] font-extrabold text-slate-500 hover:text-indigo-600"
                        onClick={(e) => {
                          e.stopPropagation();
                          openDetailModal(dayMilestones[3]);
                        }}
                      >
                        +{dayMilestones.length - 3} more events
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          </div>
          </div>
        </section>
      </div>

      {/* Project-Based Event Listing Section Below Calendar */}
      <section className="rounded-[28px] border border-slate-200/90 bg-white p-6 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-extrabold text-slate-700">
              <Layers className="h-3.5 w-3.5" />
              Project Milestones Explorer
            </div>
            <h2 className="mt-1 font-display text-2xl text-graphite">Project Events & Deliverables</h2>
          </div>

          {/* Filters & Dropdowns */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Project Selector Dropdown */}
            <div className="relative">
              <select
                value={tableProjectId}
                onChange={(e) => setTableProjectId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                className="appearance-none rounded-2xl border border-slate-200 bg-slate-50 py-2.5 pl-4 pr-10 text-xs font-extrabold text-slate-800 shadow-xs outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
              >
                <option value="all">📁 All Projects ({activeProjects.length})</option>
                {activeProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.project_name} ({project.location})
                  </option>
                ))}
              </select>
              <Filter className="pointer-events-none absolute right-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            </div>

            {/* Status Filter */}
            <select
              value={tableStatusFilter}
              onChange={(e) => setTableStatusFilter(e.target.value as 'all' | 'pending' | 'completed')}
              className="rounded-2xl border border-slate-200 bg-slate-50 py-2.5 px-4 text-xs font-extrabold text-slate-800 shadow-xs outline-none transition focus:border-indigo-300 focus:bg-white"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending Only</option>
              <option value="completed">Completed Only</option>
            </select>

            {/* Search Input */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                placeholder="Search event title..."
                value={tableSearchQuery}
                onChange={(e) => setTableSearchQuery(e.target.value)}
                className="rounded-2xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-xs outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
              />
            </div>
          </div>
        </div>

        {/* Clean Table / List of Project Events */}
        {projectTableMilestones.length ? (
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[11px] font-black uppercase tracking-wider text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Event Name</th>
                  <th className="px-4 py-3">Project</th>
                  <th className="px-4 py-3">Target Date</th>
                  <th className="px-4 py-3">Timeline</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {projectTableMilestones.map((milestone) => {
                  const color = projectColor(milestone.project_id, activeProjects);
                  const isCompleted = milestone.status === 'completed';
                  const days = daysFromToday(milestone.milestone_date);

                  return (
                    <tr
                      key={milestone.id}
                      className="hover:bg-slate-50/80 transition cursor-pointer"
                      onClick={() => openDetailModal(milestone)}
                      onMouseEnter={() => showMilestoneAudit(milestone)}
                      onMouseLeave={hideAudit}
                    >
                      <td className="px-4 py-3">
                        {isCompleted ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-extrabold text-emerald-800">
                            <CheckCircle2 className="h-3 w-3" /> Completed
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-extrabold text-amber-800">
                            <Clock className="h-3 w-3" /> Pending
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-extrabold text-slate-900 text-sm">{milestone.title}</p>
                        {milestone.details ? (
                          <p className="mt-0.5 max-w-md truncate text-slate-500 font-medium">{milestone.details}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 font-bold text-slate-700">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                          {milestone.project_name || 'Project'}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-extrabold text-slate-800">
                        {formatDate(milestone.milestone_date)}
                      </td>
                      <td className="px-4 py-3 font-bold">
                        <span
                          className={clsx(
                            isCompleted
                              ? 'text-emerald-700'
                              : days <= 0
                              ? 'text-rose-700'
                              : 'text-amber-700',
                          )}
                        >
                          {reminderText(milestone.milestone_date, isCompleted)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
                            onClick={() => openDetailModal(milestone)}
                          >
                            <Info className="inline h-3.5 w-3.5 mr-1" /> View
                          </button>
                          <button
                            type="button"
                            className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                            onClick={() => startEdit(milestone)}
                          >
                            <Edit3 className="inline h-3.5 w-3.5 mr-1" /> Edit
                          </button>
                          {!isCompleted ? (
                            <button
                              type="button"
                              className="rounded-xl bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
                              onClick={() => completeMutation.mutate(milestone.id)}
                            >
                              <CheckCircle2 className="inline h-3.5 w-3.5" />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="rounded-xl bg-red-50 px-2.5 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100"
                            onClick={() => {
                              if (confirm(`Delete milestone "${milestone.title}"?`)) deleteMutation.mutate(milestone.id);
                            }}
                          >
                            <Trash2 className="inline h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No project events found"
            subtitle="Select another project or adjust filter criteria to view events."
          />
        )}
      </section>

      {/* Full Event Details Popup Modal */}
      {selectedMilestoneForDetail ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-xs"
          onClick={() => setSelectedMilestoneForDetail(null)}
        >
          <div
            className="w-full max-w-lg rounded-[28px] bg-white p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <span
                  className="h-4 w-4 shrink-0 rounded-full shadow-sm"
                  style={{ backgroundColor: projectColor(selectedMilestoneForDetail.project_id, activeProjects) }}
                />
                <div>
                  <h3 className="font-display text-2xl text-graphite">{selectedMilestoneForDetail.title}</h3>
                  <p className="text-xs font-bold text-slate-500">{selectedMilestoneForDetail.project_name}</p>
                </div>
              </div>
              <button
                type="button"
                className="rounded-full border border-slate-200 p-2 text-slate-500 hover:bg-slate-100"
                onClick={() => setSelectedMilestoneForDetail(null)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Event Details Body */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-50 p-3.5 border border-slate-100">
                <div>
                  <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400">Target Date</span>
                  <span className="text-sm font-extrabold text-slate-800">{formatDate(selectedMilestoneForDetail.milestone_date)}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400">Status</span>
                  <span
                    className={clsx(
                      'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-extrabold',
                      selectedMilestoneForDetail.status === 'completed'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-900',
                    )}
                  >
                    {reminderText(selectedMilestoneForDetail.milestone_date, selectedMilestoneForDetail.status === 'completed')}
                  </span>
                </div>
              </div>

              <div>
                <span className="block text-xs font-bold text-slate-700 mb-1">Details & Remarks</span>
                <div className="rounded-2xl border border-slate-200 bg-white p-3.5 text-xs text-slate-700 font-medium">
                  {selectedMilestoneForDetail.details || 'No additional details provided for this milestone.'}
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
              <button
                type="button"
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                onClick={() => setSelectedMilestoneForDetail(null)}
              >
                Close
              </button>
              {selectedMilestoneForDetail.status !== 'completed' ? (
                <button
                  type="button"
                  className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-md hover:bg-emerald-700"
                  onClick={() => completeMutation.mutate(selectedMilestoneForDetail.id)}
                >
                  <CheckCircle2 className="inline h-3.5 w-3.5 mr-1" /> Mark Complete
                </button>
              ) : null}
              <button
                type="button"
                className="rounded-xl bg-graphite px-4 py-2.5 text-xs font-bold text-white shadow-md hover:bg-black"
                onClick={() => {
                  startEdit(selectedMilestoneForDetail);
                  setSelectedMilestoneForDetail(null);
                }}
              >
                <Edit3 className="inline h-3.5 w-3.5 mr-1" /> Edit
              </button>
              <button
                type="button"
                className="rounded-xl bg-red-600 px-4 py-2.5 text-xs font-bold text-white shadow-md hover:bg-red-700"
                onClick={() => {
                  if (confirm('Delete this milestone?')) deleteMutation.mutate(selectedMilestoneForDetail.id);
                }}
              >
                <Trash2 className="inline h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Create / Edit Milestone Form Modal */}
      {isFormOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 px-4 py-6 backdrop-blur-xs">
          <div className="w-full max-w-xl rounded-[28px] bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <p className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                  {formatDate(form.milestone_date)}
                </p>
                <h2 className="font-display text-2xl text-graphite">
                  {editingMilestoneId ? 'Edit Milestone' : 'New Milestone'}
                </h2>
              </div>
              <button
                type="button"
                className="rounded-full border border-slate-200 p-2 text-slate-500 hover:bg-slate-100"
                onClick={() => setIsFormOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Project</label>
                <select
                  value={form.project_id}
                  onChange={(event) => setForm((current) => ({ ...current, project_id: Number(event.target.value) }))}
                  required
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-800"
                >
                  <option value={0}>Select Project</option>
                  {activeProjects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.project_name} ({project.location})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Milestone Title</label>
                <input
                  value={form.title}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder="e.g. First floor slab casting, Roof work..."
                  required
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Target Date</label>
                <input
                  type="date"
                  value={form.milestone_date}
                  onChange={(event) => {
                    setSelectedDate(event.target.value);
                    setForm((current) => ({ ...current, milestone_date: event.target.value }));
                  }}
                  required
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Details & Remarks</label>
                <textarea
                  value={form.details}
                  onChange={(event) => setForm((current) => ({ ...current, details: event.target.value }))}
                  placeholder="Additional details, dependencies, owner note..."
                  rows={4}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800"
                />
              </div>

              <div className="flex gap-2 pt-2 justify-end">
                <button
                  type="button"
                  className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-bold text-slate-700"
                  onClick={() => setIsFormOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-graphite px-6 py-2.5 text-sm font-bold text-white shadow-md hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={saveMutation.isPending}
                >
                  {editingMilestoneId ? 'Save Changes' : 'Create Milestone'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
