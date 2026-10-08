import { api } from '../services/api';
import type { UserRole } from '../types/api';

export type AccessCategory = {
  value: UserRole;
  label: string;
  summary: string;
  specialTabs: string[];
  isCustom?: boolean;
};

export const accessCategories: AccessCategory[] = [
  {
    value: 'client_manager',
    label: 'Accounts Manager',
    summary: 'Manages office expenses, client balances, payment follow-ups, and the account-side project records.',
    specialTabs: ['Clients', 'Payments', 'GST Invoices', 'Vendors', 'Incharges', 'Materials', 'Labour', 'Master'],
  },
  {
    value: 'project_manager',
    label: 'Project Manager',
    summary: 'Plans and coordinates project delivery, client updates, materials, labour, vendors, and project masters.',
    specialTabs: ['Clients', 'GST Invoices', 'Vendors', 'Incharges', 'Materials', 'Labour', 'Master'],
  },
  {
    value: 'project_coordinator',
    label: 'Site Operations Team',
    summary: 'Records daily site operations, including materials, labour, vendors, transactions, and project files.',
    specialTabs: ['GST Invoices', 'Vendors', 'Incharges', 'Materials', 'Labour', 'Master'],
  },
];

export const administratorCategory: AccessCategory = {
  value: 'administrator',
  label: 'Owner / Administrator',
  summary: 'Controls the full workspace, financial reporting, settings, and user access for the business.',
  specialTabs: ['Office', 'Clients', 'Payments', 'GST Invoices', 'Vendors', 'Incharges', 'Materials', 'Labour', 'P & L', 'Settings', 'User Access'],
};

const ownerCategory: AccessCategory = {
  value: 'owner',
  label: 'Owner / Administrator',
  summary: administratorCategory.summary,
  specialTabs: administratorCategory.specialTabs,
};

const legacyCategoryMap: Record<string, UserRole> = {
  supervisor: 'project_manager',
  accountant: 'client_manager',
};

export type CustomRoleDefinition = {
  id: string;
  label: string;
  summary: string;
  baseCategory?: string;
  isCustom?: boolean;
};

const CUSTOM_ROLES_STORAGE_KEY = 'cido_custom_user_roles';
const PERMISSIONS_STORAGE_KEY = 'cido_role_permissions';
const PERMISSIONS_FEATURE_MIGRATION_KEY = 'cido_role_permissions_features_v1';

export async function fetchAndSyncPermissionsSettings(): Promise<void> {
  try {
    const data = await api.getPermissionsSettings();
    if (data) {
      let updated = false;
      if (data.role_permissions && Object.keys(data.role_permissions).length > 0) {
        const migrated = migrateStoredRolePermissions({ ...defaultRolePermissions, ...data.role_permissions });
        localStorage.setItem(PERMISSIONS_STORAGE_KEY, JSON.stringify(migrated));
        updated = true;
      }
      if (data.custom_user_roles && Array.isArray(data.custom_user_roles)) {
        localStorage.setItem(CUSTOM_ROLES_STORAGE_KEY, JSON.stringify(data.custom_user_roles));
        updated = true;
      }
      if (updated) {
        window.dispatchEvent(new Event('cido_permissions_updated'));
      }
    }
  } catch {
    // fallback to local cached permissions
  }
}

export function getCustomUserRoles(): CustomRoleDefinition[] {
  try {
    const raw = localStorage.getItem(CUSTOM_ROLES_STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // fallback
  }
  return [];
}

export function saveCustomUserRole(roleDef: CustomRoleDefinition, initialPermissions?: PermissionKey[]): void {
  const current = getCustomUserRoles();
  const existsIndex = current.findIndex((r) => r.id === roleDef.id);
  let updated: CustomRoleDefinition[];
  if (existsIndex >= 0) {
    updated = [...current];
    updated[existsIndex] = { ...roleDef, isCustom: true };
  } else {
    updated = [...current, { ...roleDef, isCustom: true }];
  }
  localStorage.setItem(CUSTOM_ROLES_STORAGE_KEY, JSON.stringify(updated));

  const allPerms = getAllRolePermissions();
  if (initialPermissions) {
    allPerms[roleDef.id] = initialPermissions;
    saveRolePermissions(allPerms);
  } else {
    window.dispatchEvent(new Event('cido_permissions_updated'));
  }

  void api.updatePermissionsSettings({ custom_user_roles: updated, role_permissions: allPerms });
}

export function deleteCustomUserRole(roleId: string): void {
  const current = getCustomUserRoles();
  const updated = current.filter((r) => r.id !== roleId);
  localStorage.setItem(CUSTOM_ROLES_STORAGE_KEY, JSON.stringify(updated));

  // Remove permissions
  const allPerms = getAllRolePermissions();
  delete allPerms[roleId];
  saveRolePermissions(allPerms);

  void api.updatePermissionsSettings({ custom_user_roles: updated, role_permissions: allPerms });
}

export function getAllUserCategories(): AccessCategory[] {
  const customRoles = getCustomUserRoles();
  const customCategories: AccessCategory[] = customRoles.map((r) => ({
    value: r.id as UserRole,
    label: r.label,
    summary: r.summary || 'Custom user role with tailored permissions.',
    specialTabs: [],
    isCustom: true,
  }));
  return [administratorCategory, ...accessCategories, ...customCategories];
}

export function normalizedRole(role: UserRole | null | undefined): UserRole | null {
  if (!role) return null;
  return legacyCategoryMap[role] || role;
}

export function accessCategoryFor(role: UserRole | null | undefined): AccessCategory {
  const normalized = normalizedRole(role);
  if (normalized === 'owner') return ownerCategory;
  if (normalized === 'administrator') return administratorCategory;
  const categories = getAllUserCategories();
  return categories.find((category) => category.value === normalized) || {
    value: (normalized || 'custom') as UserRole,
    label: String(normalized || 'Custom Role').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    summary: 'Custom role access permissions.',
    specialTabs: [],
    isCustom: true,
  };
}

export type PermissionKey =
  | 'tab_dashboard'
  | 'tab_projects'
  | 'tab_milestones'
  | 'tab_clients'
  | 'tab_notes'
  | 'tab_ai_search'
  | 'tab_payments'
  | 'tab_gst_invoices'
  | 'tab_materials'
  | 'tab_labour'
  | 'tab_vendors'
  | 'tab_office'
  | 'tab_site_expenses'
  | 'tab_profit_loss'
  | 'tab_settings'
  | 'tab_user_access'
  | 'client_payment_entry'
  | 'client_due_schedule'
  | 'client_add_edit'
  | 'client_delete'
  | 'client_gst_billing'
  | 'client_government_charges'
  | 'gst_invoice_manage'
  | 'gst_invoice_export'
  | 'labour_incharge_detail'
  | 'labour_incharge_limit'
  | 'project_create_edit'
  | 'project_delete'
  | 'material_entry_edit'
  | 'labour_entry_edit'
  | 'site_expense_entry'
  | 'project_files_manage'
  | 'vendor_transaction_manage'
  | 'office_expense_entry'
  | 'office_week_close'
  | 'pl_view_analysis'
  | 'project_tab_materials'
  | 'project_tab_labour'
  | 'project_tab_expenses'
  | 'project_tab_transactions'
  | 'project_tab_files';

export type PermissionCategory =
  | 'Navigation Tabs'
  | 'GST, Vendors & Incharges'
  | 'Client & JV Operations'
  | 'Project Operations'
  | 'Office & Finance';

export type PermissionDefinition = {
  key: PermissionKey;
  label: string;
  category: PermissionCategory;
  description: string;
};

export const permissionDefinitions: PermissionDefinition[] = [
  // Navigation Tabs (Billing ERP Structure)
  { key: 'tab_dashboard', label: 'Gateway / Dashboard', category: 'Navigation Tabs', description: 'Overview metrics, cashflow, and financial health.' },
  { key: 'tab_projects', label: 'Cost Centers / Jobs', category: 'Navigation Tabs', description: 'View cost centers, job accounts, and project ledgers.' },
  { key: 'tab_milestones', label: 'Milestones & Calendar', category: 'Navigation Tabs', description: 'View operational timelines and upcoming events.' },
  { key: 'tab_clients', label: 'Customers (Debtors Ledger)', category: 'Navigation Tabs', description: 'Customer accounts, debtor statements, and ledger balances.' },
  { key: 'tab_notes', label: 'Notes & Reminders', category: 'Navigation Tabs', description: 'Operational notes, follow-ups, and memo board.' },
  { key: 'tab_ai_search', label: 'AI Query / Search', category: 'Navigation Tabs', description: 'AI assistant and ledger/document search.' },
  { key: 'tab_payments', label: 'Receipts & Payments', category: 'Navigation Tabs', description: 'Customer receipts and payment voucher history.' },
  { key: 'tab_gst_invoices', label: 'Sales Invoices (Billing)', category: 'Navigation Tabs', description: 'Tax invoices, sales registers, and GST billing.' },
  { key: 'tab_materials', label: 'Items & Stock (Inventory)', category: 'Navigation Tabs', description: 'Product catalog, stock items, and inventory logs.' },
  { key: 'tab_labour', label: 'Staff & Payroll Master', category: 'Navigation Tabs', description: 'Staff designations, wages, and daily payroll logs.' },
  { key: 'tab_vendors', label: 'Suppliers (Creditors)', category: 'Navigation Tabs', description: 'Supplier directory, purchases, and creditor balances.' },

  { key: 'gst_invoice_manage', label: 'Create / Edit Sales Invoices', category: 'Billing & GST Vouchers', description: 'Create, edit, and delete sales tax invoices.' },
  { key: 'gst_invoice_export', label: 'Export Sales Invoices', category: 'Billing & GST Vouchers', description: 'Download sales invoice register as Excel.' },
  { key: 'client_gst_billing', label: 'GST Tax Billing', category: 'Billing & GST Vouchers', description: 'Record GST payments, tax invoices, and GST balances on customer ledgers.' },
  { key: 'labour_incharge_detail', label: 'Contractor Ledger Details', category: 'Billing & GST Vouchers', description: 'View and maintain contractor master records and payment history.' },
  { key: 'labour_incharge_limit', label: 'Contractor Credit Limits', category: 'Billing & GST Vouchers', description: 'Set and change contractor spending limits.' },
  { key: 'client_government_charges', label: 'Statutory Charges', category: 'Billing & GST Vouchers', description: 'View and edit GST, cess, and statutory charge settings.' },
  { key: 'tab_office', label: 'Cash & Bank Vouchers', category: 'Navigation Tabs', description: 'Office cash, bank accounts, and daily expense settlements.' },
  { key: 'tab_site_expenses', label: 'Operating Expenses', category: 'Navigation Tabs', description: 'Operating expense vouchers and field settlements.' },
  { key: 'tab_profit_loss', label: 'Profit & Loss (P&L)', category: 'Navigation Tabs', description: 'Financial profit and loss analysis.' },
  { key: 'tab_settings', label: 'Company Settings', category: 'Navigation Tabs', description: 'System and company configuration settings.' },
  { key: 'tab_user_access', label: 'User & Role Access', category: 'Navigation Tabs', description: 'User login management and role-based permissions.' },

  // Granular Action Permissions
  { key: 'client_payment_entry', label: 'Client Payment Entry', category: 'Client & JV Operations', description: 'Record and edit payments received from clients.' },
  { key: 'client_due_schedule', label: 'Client Due Schedule', category: 'Client & JV Operations', description: 'Set up and modify payment due schedules.' },
  { key: 'client_add_edit', label: 'Add / Edit Client Profile', category: 'Client & JV Operations', description: 'Create new clients and edit area measurements.' },
  { key: 'client_delete', label: 'Delete Client Records', category: 'Client & JV Operations', description: 'Delete clients or shareholder ledger entries.' },
  { key: 'project_create_edit', label: 'Create & Edit Projects', category: 'Project Operations', description: 'Create new project sites and edit specifications.' },
  { key: 'project_delete', label: 'Delete Projects', category: 'Project Operations', description: 'Permanently remove projects from system.' },
  { key: 'material_entry_edit', label: 'Add & Edit Materials Log', category: 'Project Operations', description: 'Record, modify, or remove material purchases and stock.' },
  { key: 'labour_entry_edit', label: 'Add & Edit Labour Log', category: 'Project Operations', description: 'Record, modify, or remove daily worker attendance and wages.' },
  { key: 'site_expense_entry', label: 'Add & Edit Site Expenses', category: 'Project Operations', description: 'Record, modify, or remove site overhead expenses and settlements.' },
  { key: 'project_files_manage', label: 'Manage Project Files', category: 'Project Operations', description: 'Upload, rename, or delete project files and folders.' },
  { key: 'vendor_transaction_manage', label: 'Manage Vendor Transactions', category: 'GST, Vendors & Incharges', description: 'Record, update, or remove vendor and incharge payment transactions.' },
  { key: 'project_tab_materials', label: 'Project View: Materials Tab', category: 'Project Operations', description: 'Access the Materials tab within the project details view.' },
  { key: 'project_tab_labour', label: 'Project View: Labour Tab', category: 'Project Operations', description: 'Access the Labour tab within the project details view.' },
  { key: 'project_tab_expenses', label: 'Project View: Expenses Tab', category: 'Project Operations', description: 'Access the Expenses tab within the project details view.' },
  { key: 'project_tab_transactions', label: 'Project View: Transactions Tab', category: 'Project Operations', description: 'Access the Transactions tab within the project details view.' },
  { key: 'project_tab_files', label: 'Project View: Files Tab', category: 'Project Operations', description: 'Access the Files tab within the project details view.' },
  { key: 'office_expense_entry', label: 'Office Expense Entry', category: 'Office & Finance', description: 'Add and edit office overhead expenses.' },
  { key: 'office_week_close', label: 'Close Office Financial Week', category: 'Office & Finance', description: 'Lock weekly office expenditure.' },
  { key: 'pl_view_analysis', label: 'View P & L Analysis', category: 'Office & Finance', description: 'View net profit margins and project financial health.' },
];

export const defaultRolePermissions: Record<string, PermissionKey[]> = {
  administrator: permissionDefinitions.map((item) => item.key),
  owner: permissionDefinitions.map((item) => item.key),
  client_manager: [
    'tab_dashboard',
    'tab_projects',
    'tab_milestones',
    'tab_clients',
    'tab_notes',
    'tab_payments',
    'tab_gst_invoices',
    'tab_materials',
    'tab_labour',
    'tab_vendors',
    'tab_office',
    'tab_site_expenses',
    'client_payment_entry',
    'client_due_schedule',
    'client_add_edit',
    'client_gst_billing',
    'client_government_charges',
    'gst_invoice_manage',
    'gst_invoice_export',
    'labour_incharge_detail',
    'labour_incharge_limit',
    'material_entry_edit',
    'labour_entry_edit',
    'site_expense_entry',
    'project_files_manage',
    'vendor_transaction_manage',
    'office_expense_entry',
    'office_week_close',
    'project_tab_materials',
    'project_tab_labour',
    'project_tab_expenses',
    'project_tab_transactions',
    'project_tab_files',
  ],
  project_manager: [
    'tab_dashboard',
    'tab_projects',
    'tab_milestones',
    'tab_clients',
    'tab_notes',
    'tab_payments',
    'tab_gst_invoices',
    'tab_materials',
    'tab_labour',
    'tab_vendors',
    'tab_office',
    'tab_site_expenses',
    'client_payment_entry',
    'client_add_edit',
    'client_gst_billing',
    'client_government_charges',
    'gst_invoice_manage',
    'gst_invoice_export',
    'labour_incharge_detail',
    'labour_incharge_limit',
    'project_create_edit',
    'material_entry_edit',
    'labour_entry_edit',
    'site_expense_entry',
    'project_files_manage',
    'vendor_transaction_manage',
    'office_expense_entry',
    'project_tab_materials',
    'project_tab_labour',
    'project_tab_expenses',
    'project_tab_transactions',
    'project_tab_files',
  ],
  project_coordinator: [
    'tab_dashboard',
    'tab_projects',
    'tab_milestones',
    'tab_notes',
    'tab_payments',
    'tab_gst_invoices',
    'tab_materials',
    'tab_labour',
    'tab_vendors',
    'tab_office',
    'tab_site_expenses',
    'client_payment_entry',
    'client_gst_billing',
    'gst_invoice_manage',
    'gst_invoice_export',
    'labour_incharge_detail',
    'labour_incharge_limit',
    'material_entry_edit',
    'labour_entry_edit',
    'site_expense_entry',
    'project_files_manage',
    'vendor_transaction_manage',
    'office_expense_entry',
    'project_tab_materials',
    'project_tab_labour',
    'project_tab_expenses',
    'project_tab_transactions',
    'project_tab_files',
  ],
};

const pathToTabKey: Record<string, PermissionKey> = {
  '/': 'tab_dashboard',
  '/dashboard': 'tab_dashboard',
  '/projects': 'tab_projects',
  '/milestones': 'tab_milestones',
  '/clients': 'tab_clients',
  '/notes': 'tab_notes',
  '/ai-search': 'tab_ai_search',
  '/payments': 'tab_payments',
  '/gst-invoices': 'tab_gst_invoices',
  '/materials': 'tab_materials',
  '/workers': 'tab_labour',
  '/vendors': 'tab_vendors',
  '/office': 'tab_office',
  '/site-expenses': 'tab_site_expenses',
  '/profit-loss': 'tab_profit_loss',
  '/settings': 'tab_settings',
  '/users': 'tab_user_access',
};

function inheritLegacyNewFeatures(keys: PermissionKey[]): PermissionKey[] {
  const next = new Set(keys);
  if (next.has('tab_payments')) next.add('tab_gst_invoices');
  if (next.has('tab_gst_invoices')) {
    next.add('gst_invoice_manage');
    next.add('gst_invoice_export');
    next.add('client_gst_billing');
  }
  if (next.has('tab_vendors')) next.add('labour_incharge_detail');
  if (next.has('tab_vendors') || next.has('project_tab_transactions')) next.add('vendor_transaction_manage');
  if (next.has('project_tab_labour') || next.has('tab_labour')) next.add('labour_incharge_limit');
  if (next.has('client_add_edit')) next.add('client_government_charges');
  return Array.from(next);
}

function migrateStoredRolePermissions(all: Record<string, PermissionKey[]>): Record<string, PermissionKey[]> {
  try {
    if (localStorage.getItem(PERMISSIONS_FEATURE_MIGRATION_KEY) === 'v1') return all;
  } catch {
    return all;
  }

  const next: Record<string, PermissionKey[]> = {};
  Object.entries(all).forEach(([role, keys]) => {
    next[role] = inheritLegacyNewFeatures(keys || []);
  });

  try {
    localStorage.setItem(PERMISSIONS_FEATURE_MIGRATION_KEY, 'v1');
    localStorage.setItem(PERMISSIONS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota
  }
  void api.updatePermissionsSettings({ role_permissions: next, custom_user_roles: getCustomUserRoles() });
  return next;
}

export function getAllRolePermissions(): Record<string, PermissionKey[]> {
  try {
    const raw = localStorage.getItem(PERMISSIONS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return migrateStoredRolePermissions({ ...defaultRolePermissions, ...parsed });
    }
  } catch {
    // fallback
  }
  return defaultRolePermissions;
}

export function getRolePermissions(role: UserRole | null | undefined): PermissionKey[] {
  const normalized = normalizedRole(role);
  if (!normalized) return [];
  if (normalized === 'owner' || normalized === 'administrator') {
    return permissionDefinitions.map((item) => item.key);
  }
  const all = getAllRolePermissions();
  if (all[normalized]) {
    return all[normalized];
  }
  const customRoles = getCustomUserRoles();
  const customDef = customRoles.find((r) => r.id === normalized);
  if (customDef?.baseCategory && defaultRolePermissions[customDef.baseCategory]) {
    return defaultRolePermissions[customDef.baseCategory];
  }
  return defaultRolePermissions[normalized] || [
    'tab_dashboard',
    'tab_projects',
    'tab_milestones',
    'tab_notes',
    'tab_office',
  ];
}

export function saveRolePermissions(rolePermissions: Record<string, PermissionKey[]>): void {
  try {
    localStorage.setItem(PERMISSIONS_STORAGE_KEY, JSON.stringify(rolePermissions));
    window.dispatchEvent(new Event('cido_permissions_updated'));
    void api.updatePermissionsSettings({ role_permissions: rolePermissions });
  } catch {
    // handle error
  }
}

export function resetRolePermissions(): void {
  try {
    localStorage.removeItem(PERMISSIONS_STORAGE_KEY);
    localStorage.removeItem(CUSTOM_ROLES_STORAGE_KEY);
    localStorage.setItem(PERMISSIONS_FEATURE_MIGRATION_KEY, 'v1');
    window.dispatchEvent(new Event('cido_permissions_updated'));
    void api.updatePermissionsSettings({ role_permissions: defaultRolePermissions, custom_user_roles: [] });
  } catch {
    // handle error
  }
}

export function hasPermission(role: UserRole | null | undefined, permission: PermissionKey): boolean {
  const normalized = normalizedRole(role);
  if (!normalized) return false;
  if (normalized === 'owner' || normalized === 'administrator') return true;
  const current = getRolePermissions(normalized);
  return current.includes(permission);
}

export function hasAnyPermission(role: UserRole | null | undefined, permissions: PermissionKey[]): boolean {
  return permissions.some((permission) => hasPermission(role, permission));
}

export function canAccessPath(role: UserRole | null | undefined, path: string): boolean {
  const normalized = normalizedRole(role);
  if (!normalized) return false;
  if (normalized === 'owner' || normalized === 'administrator') return true;
  if (path === '/vendors') {
    return hasAnyPermission(normalized, ['tab_vendors', 'labour_incharge_detail']);
  }
  const tabKey = pathToTabKey[path];
  if (tabKey) {
    return hasPermission(normalized, tabKey);
  }
  return true;
}

export function canManageUsers(role: UserRole | null | undefined) {
  const normalized = normalizedRole(role);
  return normalized === 'owner' || normalized === 'administrator';
}
