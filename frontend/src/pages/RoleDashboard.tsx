import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Building2, CalendarCheck2, ClipboardList, FileText, Hammer, Package, Receipt, Truck, Users } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { SectionCard } from '../components/SectionCard';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import type { ProjectMilestone } from '../types/api';
import { accessCategoryFor, hasAnyPermission, normalizedRole } from '../utils/access';
import { formatCurrency, formatDate } from '../utils/format';

function dateValue(value: string) {
  return new Date(`${value.slice(0, 10)}T00:00:00`);
}

function isWithinDays(value: string, days: number) {
  const difference = dateValue(value).getTime() - new Date().setHours(0, 0, 0, 0);
  return difference >= 0 && difference <= days * 24 * 60 * 60 * 1000;
}

function isRecent(value: string, days: number) {
  const difference = new Date().setHours(0, 0, 0, 0) - dateValue(value).getTime();
  return difference >= 0 && difference <= days * 24 * 60 * 60 * 1000;
}

function ActionCard({
  label,
  value,
  detail,
  href,
  icon: Icon,
  tone = 'slate',
}: {
  label: string;
  value: string | number;
  detail: string;
  href: string;
  icon: typeof Building2;
  tone?: 'slate' | 'indigo' | 'emerald' | 'amber' | 'rose';
}) {
  const tones = {
    slate: 'border-slate-200 bg-white text-graphite',
    indigo: 'border-indigo-100 bg-indigo-50/70 text-indigo-950',
    emerald: 'border-emerald-100 bg-emerald-50/70 text-emerald-950',
    amber: 'border-amber-100 bg-amber-50/70 text-amber-950',
    rose: 'border-rose-100 bg-rose-50/70 text-rose-950',
  };
  return (
    <Link to={href} className={`group rounded-2xl border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${tones[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] opacity-65">{label}</p>
          <p className="mt-2 text-2xl font-black">{value}</p>
        </div>
        <Icon className="h-5 w-5 opacity-70" />
      </div>
      <p className="mt-2 text-xs font-semibold opacity-70">{detail}</p>
      <span className="mt-3 inline-flex items-center gap-1 text-xs font-black opacity-70 group-hover:opacity-100">Open details <ArrowRight className="h-3.5 w-3.5" /></span>
    </Link>
  );
}

function MilestoneList({ rows, title }: { rows: ProjectMilestone[]; title: string }) {
  return (
    <SectionCard title={title}>
      {rows.length ? (
        <div className="space-y-2">
          {rows.slice(0, 5).map((milestone) => (
            <Link key={milestone.id} to="/milestones" className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 transition hover:border-clay/30 hover:bg-white">
              <div className="min-w-0"><p className="truncate text-sm font-bold text-graphite">{milestone.title}</p><p className="mt-1 truncate text-xs font-semibold text-slate-500">{milestone.project_name || 'Project'} · {formatDate(milestone.milestone_date)}</p></div>
              <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black uppercase ${milestone.status === 'completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{milestone.status}</span>
            </Link>
          ))}
        </div>
      ) : <p className="text-sm font-semibold text-slate-500">No milestone reminders right now.</p>}
      <Link to="/milestones" className="mt-4 inline-flex items-center gap-1 text-sm font-black text-clay hover:text-graphite">View milestone tab <ArrowRight className="h-4 w-4" /></Link>
    </SectionCard>
  );
}

export function RoleDashboard() {
  const { user } = useAuth();
  const role = normalizedRole(user?.role);
  const category = accessCategoryFor(user?.role);
  const isClientManager = role === 'client_manager';
  const isProjectRole = role === 'project_manager' || role === 'project_coordinator';

  const { data: projects = [], isLoading: projectsLoading } = useQuery({ queryKey: ['role-dashboard', 'projects'], queryFn: api.getProjects });
  const { data: milestones = [] } = useQuery({ queryKey: ['role-dashboard', 'milestones'], queryFn: api.getMilestones });
  const { data: officeExpenses = [] } = useQuery({ queryKey: ['role-dashboard', 'office'], queryFn: api.getOfficeExpenses });
  const { data: notesBoard } = useQuery({ queryKey: ['role-dashboard', 'notes'], queryFn: api.getNotesBoard });
  const { data: jvProjects = [] } = useQuery({ queryKey: ['role-dashboard', 'jv-projects'], queryFn: api.getJVProjects, enabled: isClientManager });
  const { data: payments = [] } = useQuery({ queryKey: ['role-dashboard', 'payments'], queryFn: () => api.getPayments(), enabled: isClientManager });
  const { data: materials = [] } = useQuery({ queryKey: ['role-dashboard', 'materials'], queryFn: () => api.getMaterials(), enabled: isProjectRole || isClientManager });
  const { data: laborLogs = [] } = useQuery({ queryKey: ['role-dashboard', 'labor'], queryFn: () => api.getLaborLogs(), enabled: isProjectRole });
  const { data: vendors = [] } = useQuery({ queryKey: ['role-dashboard', 'vendors'], queryFn: () => api.getVendorMaster(), enabled: isProjectRole || isClientManager });

  const pendingMilestones = useMemo(() => milestones.filter((row) => row.status !== 'completed').sort((left, right) => left.milestone_date.localeCompare(right.milestone_date)), [milestones]);
  const upcomingMilestones = pendingMilestones.filter((row) => isWithinDays(row.milestone_date, 14));
  const currentWeekExpenses = officeExpenses.filter((row) => isRecent(row.date, 7));
  const activeProjects = projects.filter((project) => project.status !== 'completed');
  const overduePayments = payments.filter((payment) => payment.status === 'overdue' || (!payment.received_date && payment.due_date && dateValue(payment.due_date).getTime() < new Date().setHours(0, 0, 0, 0)));
  const totalClientBalance = jvProjects.reduce((sum, project) => sum + Number(project.total_balance || 0), 0);
  const totalOfficeAmount = currentWeekExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const recentMaterials = materials.filter((row) => isRecent(row.date, 7)).length;
  const recentLabor = laborLogs.filter((row) => isRecent(row.date, 7)).length;
  const openOfficeItems = currentWeekExpenses.filter((row) => !row.closed_at).length;
  const recentNotes = (notesBoard?.active || []).slice().sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()).slice(0, 5);

  const milestoneRows = upcomingMilestones.length ? upcomingMilestones : pendingMilestones;

  return (
    <div className="min-w-0 space-y-6">
      <div className="rounded-[28px] border border-white/60 bg-gradient-to-br from-graphite via-slate-900 to-clay px-6 py-7 text-white shadow-panel sm:px-8">
        <p className="text-xs uppercase tracking-[0.34em] text-sand/70">KKR Construction</p>
        <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div><h1 className="font-display text-4xl leading-tight">Welcome, {user?.name}</h1><p className="mt-2 max-w-2xl text-sm text-white/75">Your dashboard is focused on the records and follow-ups assigned to your role.</p></div>
          <span className="inline-flex w-fit rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.2em] text-white/85">{category.label}</span>
        </div>
      </div>

      {isClientManager ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <ActionCard label="Client balance" value={formatCurrency(totalClientBalance)} detail={`${jvProjects.filter((project) => project.total_balance > 0).length} project balance(s) pending`} href="/clients" icon={Users} tone="rose" />
            <ActionCard label="Overdue payments" value={overduePayments.length} detail="Open the payment list to follow up" href="/payments" icon={AlertTriangle} tone="amber" />
            <ActionCard label="Office this week" value={formatCurrency(totalOfficeAmount)} detail={`${openOfficeItems} open office item(s)`} href="/office" icon={Building2} tone="indigo" />
            <ActionCard label="Upcoming milestones" value={upcomingMilestones.length} detail="Due within the next 14 days" href="/milestones" icon={CalendarCheck2} tone="emerald" />
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            <SectionCard title="Client balances needing attention">
              {jvProjects.filter((project) => project.total_balance > 0).slice(0, 6).map((project) => <Link key={project.project_id} to={`/projects?projectId=${project.project_id}`} className="flex items-center justify-between gap-3 border-b border-slate-100 py-3 last:border-0 hover:text-clay"><span className="min-w-0 truncate text-sm font-bold">{project.client_name} · {project.project_name}</span><span className="shrink-0 text-sm font-black text-rose-700">{formatCurrency(project.total_balance)}</span></Link>)}
              {!jvProjects.some((project) => project.total_balance > 0) ? <p className="text-sm font-semibold text-slate-500">No outstanding client balances.</p> : null}
              <Link to="/clients" className="mt-3 inline-flex items-center gap-1 text-sm font-black text-clay">Open client details <ArrowRight className="h-4 w-4" /></Link>
            </SectionCard>
            <SectionCard title="Overdue follow-ups">
              {overduePayments.slice(0, 6).map((payment) => <Link key={payment.id} to="/payments" className="flex items-center justify-between gap-3 border-b border-slate-100 py-3 last:border-0 hover:text-clay"><span className="text-sm font-bold">Project #{payment.project_id} · {payment.payment_type}</span><span className="text-sm font-black text-rose-700">{formatCurrency(payment.amount)}</span></Link>)}
              {!overduePayments.length ? <p className="text-sm font-semibold text-slate-500">No overdue payments.</p> : null}
              <Link to="/payments" className="mt-3 inline-flex items-center gap-1 text-sm font-black text-clay">Open payment details <ArrowRight className="h-4 w-4" /></Link>
            </SectionCard>
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <ActionCard label="Active projects" value={activeProjects.length} detail="Open the project workspace" href="/projects" icon={ClipboardList} tone="indigo" />
            <ActionCard label="Materials this week" value={recentMaterials} detail="Recent material entries" href="/materials" icon={Package} tone="emerald" />
            <ActionCard label="Labour this week" value={recentLabor} detail="Recent labour entries" href="/workers" icon={Hammer} tone="amber" />
            <ActionCard label="Milestones pending" value={pendingMilestones.length} detail={`${upcomingMilestones.length} due within 14 days`} href="/milestones" icon={CalendarCheck2} tone="rose" />
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            <MilestoneList rows={milestoneRows} title="Upcoming project milestones" />
            <SectionCard title="Recent project activity">
              <div className="space-y-2">
                {projectsLoading ? <p className="text-sm font-semibold text-slate-500">Loading project activity...</p> : null}
                {projects.slice(0, 6).map((project) => <Link key={project.id} to={`/projects?projectId=${project.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 transition hover:border-clay/30 hover:bg-white"><div className="min-w-0"><p className="truncate text-sm font-bold text-graphite">{project.project_name}</p><p className="mt-1 truncate text-xs font-semibold text-slate-500">{project.location} · Started {formatDate(project.start_date)}</p></div><span className="shrink-0 rounded-full bg-slate-200 px-2 py-1 text-[10px] font-black uppercase text-slate-700">{project.status}</span></Link>)}
                {!projectsLoading && !projects.length ? <p className="text-sm font-semibold text-slate-500">No projects assigned yet.</p> : null}
              </div>
              <Link to="/projects" className="mt-4 inline-flex items-center gap-1 text-sm font-black text-clay">Open project workspace <ArrowRight className="h-4 w-4" /></Link>
            </SectionCard>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <ActionCard label="Office items" value={openOfficeItems} detail="Open entries from the last 7 days" href="/office" icon={Receipt} />
            {hasAnyPermission(user?.role, ['tab_vendors', 'labour_incharge_detail']) ? (
              <ActionCard
                label={hasAnyPermission(user?.role, ['tab_vendors']) && hasAnyPermission(user?.role, ['labour_incharge_detail'])
                  ? 'Vendors & incharges'
                  : hasAnyPermission(user?.role, ['labour_incharge_detail'])
                    ? 'Labour incharges'
                    : 'Vendors'}
                value={vendors.length}
                detail="Open the vendor directory"
                href="/vendors"
                icon={Truck}
              />
            ) : null}
            <ActionCard label="Notes" value={recentNotes.length} detail="Recently updated notes" href="/notes" icon={FileText} />
            <ActionCard label="Files & transactions" value="Open" detail="Use the project workspace tabs" href="/projects" icon={ClipboardList} tone="slate" />
          </div>
        </>
      )}
    </div>
  );
}
