import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Filter,
  History,
  KeyRound,
  LayoutGrid,
  LockKeyhole,
  Plus,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  ShieldOff,
  SlidersHorizontal,
  TableProperties,
  Trash2,
  UserPlus,
  X,
  XCircle,
} from 'lucide-react';

import { SectionCard } from '../components/SectionCard';
import { useAuth } from '../contexts/AuthContext';
import { useNotify } from '../contexts/NotificationContext';
import { api } from '../services/api';
import { assignUserRole, createUser, deleteUser, getUsers, resetUserPassword, restoreUserAccess, revokeUserAccess } from '../services/auth';
import type { User, UserRole } from '../types/api';
import type { PermissionCategory, PermissionKey } from '../utils/access';
import {
  accessCategoryFor,
  administratorCategory,
  deleteCustomUserRole,
  getAllRolePermissions,
  getAllUserCategories,
  getRolePermissions,
  normalizedRole,
  permissionDefinitions,
  resetRolePermissions,
  saveCustomUserRole,
  saveRolePermissions,
} from '../utils/access';
import { getApiErrorMessage } from '../utils/errors';

const initialForm = { name: '', email: '', password: '', phone: '', role: 'client_manager' as UserRole };

const categoryIcons: Record<PermissionCategory, string> = {
  'Navigation Tabs': '📍',
  'GST, Vendors & Incharges': '🧾',
  'Client & JV Operations': '💳',
  'Project Operations': '🏗️',
  'Office & Finance': '💰',
};

function formatDateTime(isoString: string) {
  if (!isoString) return '-';
  try {
    const d = new Date(isoString);
    return d.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return isoString;
  }
}

export function UserAccessPage() {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(initialForm);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);
  const [showAddRoleModal, setShowAddRoleModal] = useState(false);
  const [selectedSettingsRole, setSelectedSettingsRole] = useState<UserRole>('client_manager');
  const [permissionsState, setPermissionsState] = useState<Record<string, PermissionKey[]>>({});
  const [resetFor, setResetFor] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState('');

  // UI/UX Enhancements for Owner
  const [viewMode, setViewMode] = useState<'grid' | 'matrix'>('grid');
  const [drawerSearch, setDrawerSearch] = useState('');
  const [drawerCategory, setDrawerCategory] = useState<'all' | PermissionCategory>('all');

  // Add custom role form state
  const [newRoleTitle, setNewRoleTitle] = useState('');
  const [newRoleSummary, setNewRoleSummary] = useState('');

  const { data: users = [], isLoading: usersLoading } = useQuery({ queryKey: ['users'], queryFn: () => getUsers() });

  const userCategories = getAllUserCategories();

  const { user: currentUser } = useAuth();
  const isOwner = normalizedRole(currentUser?.role) === 'owner';

  const [showUserHistoryModal, setShowUserHistoryModal] = useState(false);
  const [historyUserId, setHistoryUserId] = useState<number | 'all'>('all');
  const [historyAction, setHistoryAction] = useState<string>('all');
  const [historyCategory, setHistoryCategory] = useState<string>('all');
  const [historyStartDate, setHistoryStartDate] = useState<string>('');
  const [historyEndDate, setHistoryEndDate] = useState<string>('');
  const [historySearch, setHistorySearch] = useState<string>('');

  // Delete user warning modal state
  const [deletingUser, setDeletingUser] = useState<User | null>(null);
  const [deleteLogsOption, setDeleteLogsOption] = useState<'keep' | 'purge'>('keep');
  const [confirmUserIdInput, setConfirmUserIdInput] = useState('');

  const { data: historyLogs = [], isLoading: historyLoading } = useQuery({
    queryKey: ['audit-history', historyUserId, historyAction, historyCategory, historyStartDate, historyEndDate, historySearch],
    queryFn: () =>
      api.getAuditHistory({
        user_id: historyUserId === 'all' ? undefined : historyUserId,
        action: historyAction === 'all' ? undefined : historyAction,
        table_name: historyCategory === 'all' ? undefined : historyCategory,
        start_date: historyStartDate || undefined,
        end_date: historyEndDate || undefined,
        search: historySearch || undefined,
      }),
    enabled: isOwner && showUserHistoryModal,
  });

  const createCount = historyLogs.filter((l) => l.action === 'create').length;
  const updateCount = historyLogs.filter((l) => l.action === 'update').length;
  const deleteCount = historyLogs.filter((l) => l.action === 'delete').length;

  useEffect(() => {
    setPermissionsState(getAllRolePermissions());
  }, [showSettingsDrawer, showAddRoleModal]);

  function refreshUsers() {
    queryClient.invalidateQueries({ queryKey: ['users'] });
  }

  const createMutation = useMutation({
    mutationFn: () => createUser({ ...form, phone: form.phone || undefined }),
    onSuccess: () => {
      refreshUsers();
      setForm(initialForm);
      setShowCreateModal(false);
      notify.success('User login created with the selected access category.');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to create user login.')),
  });

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: UserRole }) => assignUserRole(userId, role),
    onSuccess: () => { refreshUsers(); notify.success('Access category updated.'); },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to update access category.')),
  });

  const passwordMutation = useMutation({
    mutationFn: ({ userId, password }: { userId: number; password: string }) => resetUserPassword(userId, password),
    onSuccess: () => { setResetFor(null); setNewPassword(''); notify.success('Password reset successfully.'); },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to reset password.')),
  });

  const accessMutation = useMutation({
    mutationFn: ({ userId, active }: { userId: number; active: boolean }) => active ? restoreUserAccess(userId) : revokeUserAccess(userId),
    onSuccess: (_, variables) => { refreshUsers(); notify.success(variables.active ? 'User access restored.' : 'User access revoked.'); },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to update user access.')),
  });

  const deleteUserMutation = useMutation({
    mutationFn: ({ userId, deleteLogs }: { userId: number; deleteLogs: boolean }) => deleteUser(userId, deleteLogs),
    onSuccess: () => {
      refreshUsers();
      notify.success('User deleted permanently.');
      setDeletingUser(null);
      setConfirmUserIdInput('');
    },
    onError: (error) => notify.error(getApiErrorMessage(error, 'Unable to delete user.')),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.password.length < 8) {
      notify.error('Use at least 8 characters for the temporary password.');
      return;
    }
    createMutation.mutate();
  }

  function handleCreateCustomRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newRoleTitle.trim();
    if (!title) return;
    const roleId = title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!roleId) {
      notify.error('Please enter a valid role title.');
      return;
    }

    const defaultInitialPerms: PermissionKey[] = [
      'tab_dashboard',
      'tab_projects',
      'tab_milestones',
      'tab_notes',
      'tab_office',
    ];
    saveCustomUserRole(
      {
        id: roleId,
        label: title,
        summary: newRoleSummary.trim() || `${title} custom user role.`,
        isCustom: true,
      },
      defaultInitialPerms,
    );

    notify.success(`Custom user role "${title}" created successfully.`);
    setNewRoleTitle('');
    setNewRoleSummary('');
    setShowAddRoleModal(false);
    setSelectedSettingsRole(roleId as UserRole);
    setShowSettingsDrawer(true);
  }

  function handleDeleteRole(roleId: string, roleLabel: string) {
    if (confirm(`Are you sure you want to delete custom role "${roleLabel}"? Users assigned to this role will fallback to default access.`)) {
      deleteCustomUserRole(roleId);
      notify.success(`Custom role "${roleLabel}" deleted.`);
      if (selectedSettingsRole === roleId) {
        setSelectedSettingsRole('client_manager');
      }
    }
  }

  function handleTogglePermission(role: UserRole, key: PermissionKey) {
    setPermissionsState((prev) => {
      const currentKeys = prev[role] || getRolePermissions(role);
      const exists = currentKeys.includes(key);
      const updatedKeys = exists ? currentKeys.filter((k) => k !== key) : [...currentKeys, key];
      return { ...prev, [role]: updatedKeys };
    });
  }

  function handleEnableAll(role: UserRole) {
    setPermissionsState((prev) => ({
      ...prev,
      [role]: permissionDefinitions.map((item) => item.key),
    }));
  }

  function handleClearAll(role: UserRole) {
    setPermissionsState((prev) => ({
      ...prev,
      [role]: [],
    }));
  }

  function handleSavePermissions() {
    saveRolePermissions(permissionsState);
    notify.success('Role access permissions updated successfully.');
    setShowSettingsDrawer(false);
  }

  function handleResetAllToDefault() {
    if (confirm('Reset all role access settings and custom roles to system defaults?')) {
      resetRolePermissions();
      setPermissionsState(getAllRolePermissions());
      notify.success('Role permissions reset to default.');
    }
  }

  function openRoleSettings(role: UserRole) {
    setSelectedSettingsRole(role);
    setShowSettingsDrawer(true);
  }

  const groupedDefinitions = permissionDefinitions.reduce<Record<PermissionCategory, typeof permissionDefinitions>>(
    (acc, item) => {
      acc[item.category] = acc[item.category] || [];
      acc[item.category].push(item);
      return acc;
    },
    {
      'Navigation Tabs': [],
      'GST, Vendors & Incharges': [],
      'Client & JV Operations': [],
      'Project Operations': [],
      'Office & Finance': [],
    },
  );

  const nonAdminCategories = userCategories.filter((cat) => cat.value !== 'administrator');

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-clay">Administration · Security & Roles</p>
          <h1 className="mt-1 font-display text-3xl text-graphite">User & Role Access Controls</h1>
          <p className="mt-1 text-sm text-slate-600">Categorize, compare, and customize security levels and voucher permissions for every user role.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* View Mode Toggle */}
          <div className="flex items-center rounded-2xl border border-slate-200 bg-white p-1 shadow-xs">
            <button
              type="button"
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-extrabold transition',
                viewMode === 'grid' ? 'bg-graphite text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100',
              )}
              onClick={() => setViewMode('grid')}
            >
              <LayoutGrid className="h-4 w-4" />
              Role Cards
            </button>
            <button
              type="button"
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-extrabold transition',
                viewMode === 'matrix' ? 'bg-graphite text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100',
              )}
              onClick={() => setViewMode('matrix')}
            >
              <TableProperties className="h-4 w-4" />
              Permission Matrix
            </button>
          </div>

          {isOwner ? (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-2xl border border-violet-300 bg-violet-50 px-4 py-2.5 text-sm font-bold text-violet-800 shadow-xs transition hover:bg-violet-100"
              onClick={() => setShowUserHistoryModal(true)}
            >
              <History className="h-4 w-4 text-violet-600" />
              User History
            </button>
          ) : null}
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-800 shadow-xs transition hover:bg-emerald-100"
            onClick={() => setShowAddRoleModal(true)}
          >
            <Plus className="h-4 w-4" />
            Add New Role
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-bold text-indigo-700 shadow-xs transition hover:bg-indigo-100"
            onClick={() => {
              setSelectedSettingsRole('client_manager');
              setShowSettingsDrawer(true);
            }}
          >
            <Settings className="h-4 w-4" />
            Configure Role Permissions
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-clay px-5 py-2.5 text-sm font-bold text-white shadow-xs transition hover:bg-graphite"
            onClick={() => setShowCreateModal(true)}
          >
            <UserPlus className="h-4 w-4" />
            Add User
          </button>
        </div>
      </div>

      {/* Owner Header Info Card */}
      <div className="rounded-3xl border border-indigo-200/80 bg-gradient-to-r from-indigo-900 via-slate-900 to-slate-950 p-5 text-white shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-400/20 border border-amber-400/40 text-amber-300 shadow-inner">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-display text-lg font-bold text-white">Owner / Administrator (Full Unrestricted Access)</p>
                <span className="rounded-full bg-amber-400/20 px-2.5 py-0.5 text-xs font-black uppercase tracking-wider text-amber-300 border border-amber-400/30">
                  Master Privileges
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-300 max-w-3xl leading-relaxed">
                As Owner, you have complete bypass access to all modules, financial reporting, P & L analysis, payment entries, user management, and system settings. Use the controls below to customize exact permissions for employee roles.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-l border-white/10 pl-4">
            <div className="rounded-2xl bg-white/10 px-4 py-2 text-center backdrop-blur-xs">
              <span className="block text-[10px] uppercase tracking-wider text-slate-400">Total Users</span>
              <span className="text-lg font-black text-white">{users.length}</span>
            </div>
            <div className="rounded-2xl bg-white/10 px-4 py-2 text-center backdrop-blur-xs">
              <span className="block text-[10px] uppercase tracking-wider text-slate-400">Roles Configured</span>
              <span className="text-lg font-black text-amber-300">{userCategories.length}</span>
            </div>
          </div>
        </div>
      </div>

      {/* SIDE-BY-SIDE MATRIX COMPARISON VIEW */}
      {viewMode === 'matrix' ? (
        <SectionCard title="Role Permissions Comparison Matrix">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-600">
              Click any badge (<span className="text-emerald-700 font-bold">✓ Allowed</span> / <span className="text-slate-500 font-bold">✕ Restricted</span>) to toggle permissions live across roles.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
                onClick={handleResetAllToDefault}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset Defaults
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-xl bg-graphite px-4 py-1.5 text-xs font-extrabold text-white shadow-xs hover:bg-black"
                onClick={handleSavePermissions}
              >
                <Check className="h-3.5 w-3.5" />
                Apply Matrix Changes
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 uppercase tracking-wider text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3.5 min-w-[260px]">Permission Definition</th>
                  <th className="px-4 py-3.5 min-w-[140px]">Category</th>
                  {nonAdminCategories.map((category) => (
                    <th key={category.value} className="px-3 py-3.5 text-center min-w-[130px]">
                      <div className="flex flex-col items-center">
                        <span className="font-extrabold text-slate-900">{category.label}</span>
                        {category.isCustom ? <span className="text-[10px] font-bold text-amber-700">Custom Role</span> : null}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(Object.keys(groupedDefinitions) as PermissionCategory[]).map((catName) => {
                  const items = groupedDefinitions[catName];
                  return (
                    <>
                      <tr key={catName} className="bg-slate-50/80">
                        <td colSpan={2 + nonAdminCategories.length} className="px-4 py-2.5 font-black uppercase tracking-wider text-slate-800 border-y border-slate-200/80">
                          <span className="mr-1.5">{categoryIcons[catName]}</span>
                          {catName}
                        </td>
                      </tr>
                      {items.map((perm) => (
                        <tr key={perm.key} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-4 py-3 font-bold text-slate-900">
                            <div>{perm.label}</div>
                            <div className="text-[11px] font-normal text-slate-500">{perm.description}</div>
                          </td>
                          <td className="px-4 py-3 font-semibold text-slate-500 whitespace-nowrap">{perm.category}</td>
                          {nonAdminCategories.map((category) => {
                            const activeRoleKeys = permissionsState[category.value] || getRolePermissions(category.value);
                            const isAllowed = activeRoleKeys.includes(perm.key);
                            return (
                              <td key={category.value} className="px-3 py-3 text-center">
                                <button
                                  type="button"
                                  className={clsx(
                                    'inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-black transition-transform active:scale-95 cursor-pointer',
                                    isAllowed
                                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-xs hover:bg-emerald-200'
                                      : 'bg-slate-100 text-slate-400 border border-slate-200 hover:bg-slate-200 hover:text-slate-600',
                                  )}
                                  onClick={() => handleTogglePermission(category.value, perm.key)}
                                  title={`Click to ${isAllowed ? 'disable' : 'enable'} ${perm.label} for ${category.label}`}
                                >
                                  {isAllowed ? (
                                    <>
                                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                      Allowed
                                    </>
                                  ) : (
                                    <>
                                      <XCircle className="h-3.5 w-3.5 text-slate-400" />
                                      Restricted
                                    </>
                                  )}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : null}

      {/* Role Cards Grid View */}
      {viewMode === 'grid' ? (
        <div className="grid gap-4 xl:grid-cols-4">
          {nonAdminCategories.map((category) => {
            const enabledKeys = permissionsState[category.value] || getRolePermissions(category.value);
            const enabledTabs = permissionDefinitions
              .filter((p) => p.category === 'Navigation Tabs' && enabledKeys.includes(p.key))
              .map((p) => p.label.replace(' Page', '').replace(' Tab', ''));
            const enabledActions = permissionDefinitions
              .filter((p) => p.category !== 'Navigation Tabs' && enabledKeys.includes(p.key))
              .map((p) => p.label);

            return (
              <div key={category.value} className="relative rounded-3xl border border-slate-200/80 bg-white p-5 shadow-xs flex flex-col justify-between hover:border-slate-300 transition-all">
                <div>
                  <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-graphite text-base">{category.label}</p>
                        {category.isCustom ? (
                          <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold text-amber-800 uppercase tracking-wider">
                            Custom Role
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-slate-500">{category.summary}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        title={`Configure ${category.label} permissions`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                        onClick={() => openRoleSettings(category.value)}
                      >
                        <Settings className="h-4 w-4" />
                      </button>
                      {category.isCustom ? (
                        <button
                          type="button"
                          title={`Delete custom role ${category.label}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-600 transition hover:bg-rose-100"
                          onClick={() => handleDeleteRole(category.value, category.label)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-3.5 space-y-3">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">Navigation Tabs</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">{enabledTabs.length} allowed</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {enabledTabs.length > 0 ? (
                          enabledTabs.map((tab) => (
                            <span key={tab} className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                              {tab}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs italic text-slate-400">No tabs enabled</span>
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] font-black uppercase tracking-wider text-emerald-700">Action Operations</span>
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">{enabledActions.length} allowed</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {enabledActions.length > 0 ? (
                          enabledActions.map((action) => (
                            <span key={action} className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-800 border border-emerald-200/60">
                              ✓ {action}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs italic text-slate-400">No action permissions enabled</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 text-xs font-bold text-slate-700 transition hover:bg-graphite hover:text-white hover:border-graphite shadow-xs"
                    onClick={() => openRoleSettings(category.value)}
                  >
                    Edit Permissions Toggle
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Add New Custom Role Modal */}
      {showAddRoleModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-graphite/45 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-3xl border border-white/70 bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <Plus className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-display text-xl text-graphite">Add New User Role</h2>
                  <p className="text-xs text-slate-500">Create a custom role with tailored access controls.</p>
                </div>
              </div>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-100"
                onClick={() => setShowAddRoleModal(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateCustomRole} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                  Role Title / Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Quality Inspector, Safety Officer, Store Manager"
                  value={newRoleTitle}
                  onChange={(e) => setNewRoleTitle(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-semibold text-graphite focus:border-indigo-500 focus:outline-none"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                  Description / Role Summary
                </label>
                <input
                  type="text"
                  placeholder="Short description of responsibilities (optional)"
                  value={newRoleSummary}
                  onChange={(e) => setNewRoleSummary(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
                  onClick={() => setShowAddRoleModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-extrabold text-white shadow-md transition hover:bg-emerald-700"
                >
                  <Plus className="h-4 w-4" />
                  Create & Configure Permissions
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Role Access Settings Side Drawer */}
      {showSettingsDrawer ? (
        <div className="fixed inset-0 z-[100] flex justify-end bg-slate-950/45 backdrop-blur-xs transition-opacity animate-in fade-in duration-200">
          <div className="absolute inset-0" onClick={() => setShowSettingsDrawer(false)} aria-label="Close settings overlay" />
          <div
            className="relative z-10 flex h-full max-h-full w-full min-w-0 max-w-xl sm:max-w-2xl flex-col overflow-hidden border-l border-slate-200 bg-white shadow-[-20px_0_60px_rgba(15,23,42,0.22)] animate-in slide-in-from-right duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-slate-50 via-white to-indigo-50/40 px-6 py-5 shrink-0">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-indigo-200 bg-indigo-50 text-indigo-700 shadow-xs">
                  <Settings className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-display text-2xl text-graphite">Role Access Controls</h3>
                  <p className="text-xs font-medium text-slate-500">Toggle tab access and specific action permissions for user roles.</p>
                </div>
              </div>
              <button
                type="button"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                onClick={() => setShowSettingsDrawer(false)}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Role Tabs Selector */}
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-3 shrink-0">
              <div className="flex items-center gap-2 overflow-x-auto">
                <span className="text-xs font-black uppercase tracking-wider text-slate-400 mr-1">Role:</span>
                {userCategories
                  .filter((cat) => cat.value !== 'administrator')
                  .map((category) => {
                    const isActive = selectedSettingsRole === category.value;
                    return (
                      <button
                        key={category.value}
                        type="button"
                        className={`rounded-xl px-3.5 py-2 text-xs font-bold transition shrink-0 flex items-center gap-1.5 ${
                          isActive
                            ? 'bg-graphite text-white shadow-md'
                            : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                        }`}
                        onClick={() => setSelectedSettingsRole(category.value)}
                      >
                        {category.label}
                        {category.isCustom ? <span className="text-[10px] text-amber-400 font-extrabold">•</span> : null}
                      </button>
                    );
                  })}
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-xl bg-emerald-50 px-3 py-1.5 text-xs font-extrabold text-emerald-800 border border-emerald-200 shrink-0 hover:bg-emerald-100"
                onClick={() => setShowAddRoleModal(true)}
              >
                <Plus className="h-3.5 w-3.5" />
                Add Role
              </button>
            </div>

            {/* Search Input */}
            <div className="relative border-b border-slate-200 bg-white px-6 py-2.5 shrink-0">
              <Search className="pointer-events-none absolute left-9 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search permission by keyword (e.g. Client, Labour, Expense, Delete)..."
                value={drawerSearch}
                onChange={(e) => setDrawerSearch(e.target.value)}
                className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs text-graphite placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none"
              />
            </div>

            {/* Category Filter Pills & Presets Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-6 py-2 shrink-0">
              <div className="flex items-center gap-1 overflow-x-auto">
                <button
                  type="button"
                  className={clsx(
                    'rounded-lg px-2.5 py-1 text-[11px] font-extrabold transition',
                    drawerCategory === 'all' ? 'bg-graphite text-white' : 'text-slate-600 hover:bg-slate-200',
                  )}
                  onClick={() => setDrawerCategory('all')}
                >
                  All Categories
                </button>
                {(Object.keys(groupedDefinitions) as PermissionCategory[]).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    className={clsx(
                      'rounded-lg px-2.5 py-1 text-[11px] font-extrabold transition whitespace-nowrap',
                      drawerCategory === cat ? 'bg-graphite text-white' : 'text-slate-600 hover:bg-slate-200',
                    )}
                    onClick={() => setDrawerCategory(cat)}
                  >
                    {categoryIcons[cat]} {cat}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] font-bold">
                <span className="text-slate-400">Preset:</span>
                <button type="button" className="text-emerald-700 hover:underline" onClick={() => handleEnableAll(selectedSettingsRole)}>Full Access</button>
                <span className="text-slate-300">•</span>
                <button type="button" className="text-rose-700 hover:underline" onClick={() => handleClearAll(selectedSettingsRole)}>Clear All</button>
              </div>
            </div>

            {/* Permissions List with Toggles */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
              {(Object.keys(groupedDefinitions) as PermissionCategory[])
                .filter((catName) => drawerCategory === 'all' || drawerCategory === catName)
                .map((catName) => {
                  const rawItems = groupedDefinitions[catName];
                  const items = rawItems.filter(
                    (p) =>
                      !drawerSearch.trim() ||
                      p.label.toLowerCase().includes(drawerSearch.toLowerCase()) ||
                      p.description.toLowerCase().includes(drawerSearch.toLowerCase()),
                  );

                  if (items.length === 0) return null;

                  const activeRoleKeys = permissionsState[selectedSettingsRole] || getRolePermissions(selectedSettingsRole);

                  return (
                    <div key={catName} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
                      <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-base">{categoryIcons[catName]}</span>
                          <span className="text-xs font-black uppercase tracking-wider text-slate-800">{catName}</span>
                        </div>
                        <span className="text-[10px] font-bold text-slate-500">{items.length} options</span>
                      </div>

                      <div className="space-y-2">
                        {items.map((perm) => {
                          const isEnabled = activeRoleKeys.includes(perm.key);
                          return (
                            <label
                              key={perm.key}
                              className={`flex items-center justify-between rounded-xl border p-3 transition cursor-pointer ${
                                isEnabled
                                  ? 'border-emerald-200 bg-emerald-50/50 shadow-xs'
                                  : 'border-slate-200 bg-white hover:border-slate-300'
                              }`}
                            >
                              <div className="pr-4 space-y-0.5">
                                <p className={`text-sm font-bold ${isEnabled ? 'text-emerald-950' : 'text-slate-700'}`}>
                                  {perm.label}
                                </p>
                                <p className="text-xs text-slate-500">{perm.description}</p>
                              </div>

                              {/* iOS Style Toggle Switch */}
                              <button
                                type="button"
                                role="switch"
                                aria-checked={isEnabled}
                                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                  isEnabled ? 'bg-emerald-600' : 'bg-slate-300'
                                }`}
                                onClick={() => handleTogglePermission(selectedSettingsRole, perm.key)}
                              >
                                <span
                                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                                    isEnabled ? 'translate-x-5' : 'translate-x-0'
                                  }`}
                                />
                              </button>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* Footer Action Bar */}
            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-4 shrink-0">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
                onClick={handleResetAllToDefault}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset Defaults
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                  onClick={() => setShowSettingsDrawer(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-xl bg-graphite px-6 py-2.5 text-sm font-extrabold text-white shadow-md transition hover:bg-black"
                  onClick={handleSavePermissions}
                >
                  <Check className="h-4 w-4" />
                  Save & Apply Permissions
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Add User Modal */}
      {showCreateModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-graphite/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-[28px] border border-white/70 bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl text-graphite">Add user</h2>
              </div>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate hover:bg-slate-50"
                onClick={() => {
                  setShowCreateModal(false);
                  setForm(initialForm);
                }}
                aria-label="Close add user popup"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form className="grid gap-3 md:grid-cols-2" onSubmit={submit}>
              <input placeholder="Employee name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required />
              <input type="email" placeholder="Email address" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} required />
              <input placeholder="Phone (optional)" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
              <input type="password" placeholder="Temporary password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} minLength={8} required />
              <select className="md:col-span-2" value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as UserRole }))}>
                {userCategories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
              </select>
              <div className="flex flex-wrap justify-end gap-2 md:col-span-2">
                <button
                  type="button"
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-graphite hover:bg-slate-50"
                  onClick={() => {
                    setShowCreateModal(false);
                    setForm(initialForm);
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className="inline-flex items-center justify-center gap-2 rounded-2xl bg-clay px-4 py-3 text-sm font-bold text-white hover:bg-graphite disabled:opacity-60" disabled={createMutation.isPending}>
                  <Plus className="h-4 w-4" />
                  {createMutation.isPending ? 'Creating...' : 'Create login'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Managed Users List */}
      <SectionCard title="Active and revoked users">
        {usersLoading ? <p className="text-sm text-slate">Loading users...</p> : null}
        <div className="space-y-3">
          {users.map((user) => {
            const category = accessCategoryFor(user.role);
            const isAdminAccount = user.role === 'owner' || normalizedRole(user.role) === 'administrator';
            const resetting = resetFor === user.id;
            return <div key={user.id} className="rounded-2xl border border-slate/15 bg-white p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div><p className="font-bold text-graphite">{user.name}</p><p className="text-sm text-slate">{user.email}</p><p className="mt-1 text-xs font-bold text-clay">{category.label}</p><p className="mt-1 text-xs text-slate/80">{user.is_active ? 'Active login' : 'Access revoked'}</p></div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  {isAdminAccount ? <span className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">Owner / Administrator</span> : <select className="min-w-0 w-full max-w-xs" value={user.role || ''} onChange={(event) => roleMutation.mutate({ userId: user.id, role: event.target.value as UserRole })}>{userCategories.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>}
                  <button type="button" className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-graphite" onClick={() => { setResetFor(resetting ? null : user.id); setNewPassword(''); }}><KeyRound className="h-4 w-4" />Reset password</button>
                  <button type="button" className={`inline-flex items-center justify-center gap-1 rounded-xl px-3 py-2 text-xs font-bold ${user.is_active ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`} onClick={() => accessMutation.mutate({ userId: user.id, active: !user.is_active })}>{user.is_active ? <><ShieldOff className="h-4 w-4" />Revoke</> : <><ShieldCheck className="h-4 w-4" />Restore</>}</button>
                  {user.id !== currentUser?.id && user.role !== 'owner' ? (
                    <button
                      type="button"
                      className="inline-flex items-center justify-center gap-1 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100"
                      onClick={() => {
                        setDeletingUser(user);
                        setDeleteLogsOption('keep');
                        setConfirmUserIdInput('');
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </button>
                  ) : null}
                </div>
              </div>
              {resetting ? <div className="mt-3 flex flex-col gap-2 sm:flex-row"><input type="password" className="sm:max-w-xs" placeholder="New password (8+ characters)" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} /><button type="button" className="inline-flex items-center justify-center gap-1 rounded-xl bg-graphite px-3 py-2 text-xs font-bold text-white disabled:opacity-60" disabled={newPassword.length < 8 || passwordMutation.isPending} onClick={() => passwordMutation.mutate({ userId: user.id, password: newPassword })}><LockKeyhole className="h-4 w-4" />Save password</button></div> : null}
            </div>;
          })}
          {!usersLoading && users.length === 0 ? <p className="text-sm text-slate">No managed users yet.</p> : null}
        </div>
      </SectionCard>

      {/* Delete User Warning Modal */}
      {deletingUser ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-graphite/60 p-4 backdrop-blur-sm"
          onClick={() => setDeletingUser(null)}
        >
          <div
            className="flex max-h-[min(92vh,100dvh)] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex min-w-0 items-center justify-between border-b border-rose-100 bg-rose-50/70 px-4 py-4 sm:px-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-rose-100 text-rose-700">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-display text-lg font-bold text-graphite">
                    Delete User Account
                  </h3>
                  <p className="text-xs font-medium text-rose-700">
                    Warning: You are about to delete <span className="font-bold">{deletingUser.name}</span> (ID: {deletingUser.id})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeletingUser(null)}
                className="rounded-xl p-2 text-slate/50 hover:bg-white hover:text-graphite"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Content Body */}
            <div className="space-y-5 overflow-y-auto p-6">
              <p className="text-sm leading-relaxed text-graphite/80">
                Please select how you want to handle past action audit logs recorded for <span className="font-bold">{deletingUser.name}</span>:
              </p>

              {/* Option A: Keep logs with name */}
              <div
                className={`flex cursor-pointer items-start gap-4 rounded-2xl border-2 p-4 transition-all ${
                  deleteLogsOption === 'keep'
                    ? 'border-clay bg-clay/5 ring-2 ring-clay/20'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
                onClick={() => setDeleteLogsOption('keep')}
              >
                <input
                  type="radio"
                  name="deleteLogsOption"
                  checked={deleteLogsOption === 'keep'}
                  onChange={() => setDeleteLogsOption('keep')}
                  className="mt-1 h-4 w-4 text-clay focus:ring-clay"
                />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-graphite">Delete user, but KEEP their logs</span>
                    <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                      Recommended
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-slate">
                    The user login will be deleted, but all of their past action logs will be preserved under their name (<span className="font-semibold text-graphite">{deletingUser.name}</span>).
                  </p>
                </div>
              </div>

              {/* Option B: Purge all logs */}
              <div
                className={`flex cursor-pointer items-start gap-4 rounded-2xl border-2 p-4 transition-all ${
                  deleteLogsOption === 'purge'
                    ? 'border-rose-500 bg-rose-50/50 ring-2 ring-rose-500/20'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
                onClick={() => setDeleteLogsOption('purge')}
              >
                <input
                  type="radio"
                  name="deleteLogsOption"
                  checked={deleteLogsOption === 'purge'}
                  onChange={() => setDeleteLogsOption('purge')}
                  className="mt-1 h-4 w-4 text-rose-600 focus:ring-rose-500"
                />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-rose-900">Delete user AND PURGE ALL logs</span>
                    <span className="rounded-md bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">
                      Permanent Wipe
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-slate">
                    Deletes the user account AND completely wipes all action logs created by <span className="font-semibold text-graphite">{deletingUser.name}</span> from the audit database.
                  </p>
                </div>
              </div>

              {/* Confirmation User ID Input when Purge option is selected */}
              {deleteLogsOption === 'purge' && (
                <div className="space-y-2 rounded-2xl border border-rose-200 bg-rose-50 p-4">
                  <label className="block text-xs font-bold text-rose-900">
                    To confirm deleting all audit logs, type the user ID (<span className="font-mono text-sm underline">{deletingUser.id}</span>):
                  </label>
                  <input
                    type="text"
                    placeholder={`Type ${deletingUser.id} to confirm`}
                    value={confirmUserIdInput}
                    onChange={(e) => setConfirmUserIdInput(e.target.value)}
                    className="h-11 w-full rounded-xl border border-rose-300 bg-white px-3 text-sm font-bold text-graphite focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
                  />
                  {confirmUserIdInput.trim() !== String(deletingUser.id) && confirmUserIdInput.length > 0 && (
                    <p className="text-xs font-medium text-rose-600">User ID does not match ({deletingUser.id}).</p>
                  )}
                </div>
              )}
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50/80 px-6 py-4">
              <button
                type="button"
                onClick={() => setDeletingUser(null)}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-graphite hover:bg-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  deleteUserMutation.isPending ||
                  (deleteLogsOption === 'purge' && confirmUserIdInput.trim() !== String(deletingUser.id))
                }
                onClick={() => {
                  deleteUserMutation.mutate({
                    userId: deletingUser.id,
                    deleteLogs: deleteLogsOption === 'purge',
                  });
                }}
                className={`inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-xs font-bold text-white transition-all ${
                  deleteLogsOption === 'purge'
                    ? 'bg-rose-600 hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50'
                    : 'bg-graphite hover:bg-clay disabled:opacity-50'
                }`}
              >
                {deleteUserMutation.isPending
                  ? 'Deleting...'
                  : deleteLogsOption === 'purge'
                  ? 'Delete User & All Logs'
                  : 'Delete User (Keep Logs)'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* User History Audit Log Modal */}
      {showUserHistoryModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-graphite/60 p-4 backdrop-blur-sm"
          onClick={() => setShowUserHistoryModal(false)}
        >
          <div
            className="flex max-h-[min(92vh,100dvh)] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-600 text-white shadow-md">
                  <History className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-xl font-extrabold text-graphite">Platform User History & Audit Log</h2>
                  <p className="text-xs font-semibold text-slate-500">
                    Track all CRUD operations, changes, and activity performed across all tabs and categories.
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                onClick={() => setShowUserHistoryModal(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex flex-1 flex-col overflow-y-auto p-6 gap-5">
              {/* Summary Stats Bar */}
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Activity</p>
                  <p className="mt-1 text-2xl font-black text-graphite">{historyLogs.length}</p>
                </div>
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 shadow-sm">
                  <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Creates</p>
                  <p className="mt-1 text-2xl font-black text-emerald-900">{createCount}</p>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm">
                  <p className="text-xs font-bold uppercase tracking-wider text-amber-700">Updates</p>
                  <p className="mt-1 text-2xl font-black text-amber-900">{updateCount}</p>
                </div>
                <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-4 shadow-sm">
                  <p className="text-xs font-bold uppercase tracking-wider text-rose-700">Deletes</p>
                  <p className="mt-1 text-2xl font-black text-rose-900">{deleteCount}</p>
                </div>
              </div>

              {/* Filters Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                {/* Search */}
                <div className="relative min-w-0 w-full flex-1 sm:min-w-[12rem]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    className="h-10 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-sm text-graphite placeholder:text-slate-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                    placeholder="Search user, project, or item..."
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                  />
                </div>

                {/* Filter by User */}
                <div className="flex items-center gap-2">
                  <label className="text-xs font-bold text-slate-600">User:</label>
                  <select
                    className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 focus:border-violet-500 focus:outline-none"
                    value={historyUserId}
                    onChange={(e) => setHistoryUserId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  >
                    <option value="all">All Users</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.role || 'user'})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Filter by Action */}
                <div className="flex items-center gap-2">
                  <label className="text-xs font-bold text-slate-600">Action:</label>
                  <select
                    className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 focus:border-violet-500 focus:outline-none"
                    value={historyAction}
                    onChange={(e) => setHistoryAction(e.target.value)}
                  >
                    <option value="all">All Actions</option>
                    <option value="create">Created</option>
                    <option value="update">Updated</option>
                    <option value="delete">Deleted</option>
                    <option value="export">Exported</option>
                  </select>
                </div>

                {/* Filter by Category */}
                <div className="flex items-center gap-2">
                  <label className="text-xs font-bold text-slate-600">Category:</label>
                  <select
                    className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 focus:border-violet-500 focus:outline-none"
                    value={historyCategory}
                    onChange={(e) => setHistoryCategory(e.target.value)}
                  >
                    <option value="all">All Categories</option>
                    <option value="projects">Projects</option>
                    <option value="material_logs">Materials</option>
                    <option value="labor_logs">Labour</option>
                    <option value="expense_logs">Expenses</option>
                    <option value="payment_logs">Payments</option>
                    <option value="bills">GST Invoices</option>
                    <option value="shareholder_payments">Client Payments</option>
                    <option value="government_charges">Government Charges</option>
                    <option value="vendor_master">Vendors & Incharges</option>
                    <option value="vendor_transactions">Vendor Payments</option>
                    <option value="labour_incharge_limits">Incharge Limits</option>
                    <option value="project_files">Project Files</option>
                    <option value="site_expenses">Site Expenses</option>
                    <option value="office_expenses">Office Expenses</option>
                    <option value="clients">Clients</option>
                    <option value="workers">Workers</option>
                    <option value="users">User Access</option>
                    <option value="role_permissions">Role Permissions</option>
                    <option value="custom_user_roles">Custom Roles</option>
                  </select>
                </div>

                {/* Date Range */}
                <div className="flex items-center gap-2">
                  <label className="text-xs font-bold text-slate-600">From:</label>
                  <input
                    type="date"
                    className="h-10 rounded-xl border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 focus:border-violet-500 focus:outline-none"
                    value={historyStartDate}
                    onChange={(e) => setHistoryStartDate(e.target.value)}
                  />
                  <label className="text-xs font-bold text-slate-600">To:</label>
                  <input
                    type="date"
                    className="h-10 rounded-xl border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 focus:border-violet-500 focus:outline-none"
                    value={historyEndDate}
                    onChange={(e) => setHistoryEndDate(e.target.value)}
                  />
                </div>

                {historySearch || historyUserId !== 'all' || historyAction !== 'all' || historyCategory !== 'all' || historyStartDate || historyEndDate ? (
                  <button
                    type="button"
                    className="inline-flex h-10 items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-100"
                    onClick={() => {
                      setHistorySearch('');
                      setHistoryUserId('all');
                      setHistoryAction('all');
                      setHistoryCategory('all');
                      setHistoryStartDate('');
                      setHistoryEndDate('');
                    }}
                  >
                    Reset Filters
                  </button>
                ) : null}
              </div>

              {/* Data Table */}
              <div className="min-w-0 overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="max-h-[48vh] overflow-y-auto">
                  <table className="w-full text-left text-sm text-slate-600">
                    <thead className="sticky top-0 z-10 bg-slate-100 text-xs font-bold uppercase tracking-wider text-slate-500 shadow-sm">
                      <tr>
                        <th className="px-4 py-3">Date & Time</th>
                        <th className="px-4 py-3">User</th>
                        <th className="px-4 py-3">Action</th>
                        <th className="px-4 py-3">Project</th>
                        <th className="px-4 py-3">Modified</th>
                        <th className="px-4 py-3">Category / Tab</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {historyLoading ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center font-semibold text-slate-400">
                            Loading activity history...
                          </td>
                        </tr>
                      ) : historyLogs.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                            <History className="mx-auto h-8 w-8 text-slate-300" />
                            <p className="mt-2 font-bold text-slate-500">No activity history found matching the filters.</p>
                          </td>
                        </tr>
                      ) : (
                        historyLogs.map((log) => (
                          <tr key={log.id} className="transition hover:bg-slate-50/80">
                            <td className="whitespace-nowrap px-4 py-3 text-xs font-semibold text-slate-700">
                              {formatDateTime(log.timestamp)}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2.5">
                                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700">
                                  {log.user_initials}
                                </span>
                                <div>
                                  <p className="text-xs font-bold text-slate-900">{log.user_name}</p>
                                  <p className="text-[10px] text-slate-400">
                                    {log.user_email} · <span className="font-semibold text-slate-500">{log.user_role}</span>
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={clsx(
                                  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold capitalize',
                                  log.action === 'create' && 'bg-emerald-100 text-emerald-800',
                                  log.action === 'update' && 'bg-amber-100 text-amber-800',
                                  log.action === 'delete' && 'bg-rose-100 text-rose-800',
                                  !['create', 'update', 'delete'].includes(log.action) && 'bg-slate-100 text-slate-700',
                                )}
                              >
                                {log.action}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <p className="text-xs font-bold text-slate-800">{log.project_name || '—'}</p>
                            </td>
                            <td className="px-4 py-3">
                              <p className="text-xs font-semibold text-slate-800">{log.subject || log.details || '—'}</p>
                              {log.details && log.subject && !log.details.toLowerCase().includes(log.subject.toLowerCase()) ? (
                                <p className="mt-0.5 text-[10px] font-medium text-slate-400">{log.details}</p>
                              ) : null}
                            </td>
                            <td className="px-4 py-3">
                              <p className="text-xs font-bold text-slate-800">{log.category_label}</p>
                              <p className="text-[10px] font-medium text-slate-400">{log.tab_label}</p>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
