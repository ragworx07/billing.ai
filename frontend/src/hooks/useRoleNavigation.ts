import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { fetchAndSyncPermissionsSettings, canAccessPath, canManageUsers, hasAnyPermission } from '../utils/access';

export function useRoleNavigation() {
  const { user } = useAuth();
  const [, setRevision] = useState(0);

  useEffect(() => {
    void fetchAndSyncPermissionsSettings();

    function handleUpdate() {
      setRevision((prev) => prev + 1);
    }
    window.addEventListener('cido_permissions_updated', handleUpdate);
    return () => window.removeEventListener('cido_permissions_updated', handleUpdate);
  }, [user?.role]);

  const items = [
    { label: 'Gateway / Dashboard', path: '/' },
    { label: 'Customers (Debtors)', path: '/clients' },
    {
      label: hasAnyPermission(user?.role, ['tab_vendors']) && !hasAnyPermission(user?.role, ['labour_incharge_detail'])
        ? 'Suppliers (Creditors)'
        : !hasAnyPermission(user?.role, ['tab_vendors']) && hasAnyPermission(user?.role, ['labour_incharge_detail'])
          ? 'Contractors'
          : 'Suppliers (Creditors)',
      path: '/vendors',
    },
    { label: 'Items & Stock', path: '/materials' },
    { label: 'Staff & Payroll', path: '/workers' },
    { label: 'Sales Invoices', path: '/gst-invoices' },
    { label: 'Receipts & Payments', path: '/payments' },
    { label: 'Operating Expenses', path: '/site-expenses' },
    { label: 'Cash & Bank', path: '/office' },
    { label: 'Profit & Loss', path: '/profit-loss' },
    { label: 'Cost Centers / Jobs', path: '/projects' },
    { label: 'Milestones', path: '/milestones' },
    { label: 'Notes & Reminders', path: '/notes' },
    { label: 'AI Query', path: '/ai-search' },
    { label: 'Company Settings', path: '/settings' },
    ...(canManageUsers(user?.role) ? [{ label: 'User & Role Access', path: '/users' }] : []),
  ];

  return items.filter((item) => canAccessPath(user?.role, item.path));
}
