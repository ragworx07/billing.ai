import { Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';

import { AppLayout } from '../layouts/AppLayout';
import { AISearchPage } from '../pages/AISearchPage';
import { ClientsPage } from '../pages/ClientsPage';
import { DashboardPage } from '../pages/DashboardPage';
import { LoginPage } from '../pages/LoginPage';
import { MaterialEntryPage } from '../pages/MaterialEntryPage';
import { MilestonesPage } from '../pages/MilestonesPage';
import { NotesPage } from '../pages/NotesPage';
import { GSTInvoicesPage, PaymentsPage } from '../pages/PaymentsPage';
import { ProfitLossPage } from '../pages/ProfitLossPage';
import { ProjectsPage } from '../pages/ProjectsPage';
import { ProjectAnalyticsPage } from '../pages/ProjectAnalyticsPage';
import { ProjectStatementDocumentPage } from '../pages/ProjectStatementDocumentPage';
import { SettingsPage } from '../pages/SettingsPage';
import { VendorsPage } from '../pages/VendorsPage';
import { WorkersPage } from '../pages/WorkersPage';
import { OfficePage } from '../pages/OfficePage';
import { SiteExpensesPage } from '../pages/SiteExpensesPage';
import { UserAccessPage } from '../pages/UserAccessPage';
import { canAccessPath } from '../utils/access';
import { useAuth } from '../contexts/AuthContext';
import { BuildingLoader } from '../components/BuildingLoader';
import { ProtectedRoute } from './ProtectedRoute';

function RoleRoute({ path, children }: { path: string; children: ReactNode }) {
  const { user } = useAuth();
  return canAccessPath(user?.role, path) ? <>{children}</> : <Navigate to="/" replace />;
}

export function AppRoutes() {
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('preview') === 'loader') {
    return <BuildingLoader label="Initializing Billing ERP" fullPage />;
  }

  return (
    <div className="app-root">
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />

          <Route path="/office" element={<RoleRoute path="/office"><OfficePage /></RoleRoute>} />
          <Route path="/site-expenses" element={<RoleRoute path="/site-expenses"><SiteExpensesPage /></RoleRoute>} />
          <Route path="/projects" element={<RoleRoute path="/projects"><ProjectsPage /></RoleRoute>} />
          <Route path="/projects/:projectId/analytics" element={<RoleRoute path="/projects"><ProjectAnalyticsPage /></RoleRoute>} />
          <Route path="/projects/:projectId/statement-document" element={<RoleRoute path="/projects"><ProjectStatementDocumentPage /></RoleRoute>} />
          <Route path="/projects/:projectId" element={<RoleRoute path="/projects"><ProjectsPage /></RoleRoute>} />
          <Route path="/projects/:projectId/:projectSlug" element={<RoleRoute path="/projects"><ProjectsPage /></RoleRoute>} />
          <Route path="/projects/:projectId/:projectSlug/:tab" element={<RoleRoute path="/projects"><ProjectsPage /></RoleRoute>} />
          <Route path="/milestones" element={<RoleRoute path="/milestones"><MilestonesPage /></RoleRoute>} />
          <Route path="/notes" element={<RoleRoute path="/notes"><NotesPage /></RoleRoute>} />
          <Route path="/vendors" element={<RoleRoute path="/vendors"><VendorsPage /></RoleRoute>} />
          <Route path="/clients" element={<RoleRoute path="/clients"><ClientsPage /></RoleRoute>} />
          <Route path="/clients/:projectId" element={<RoleRoute path="/clients"><ClientsPage /></RoleRoute>} />
          <Route path="/clients/:projectId/:projectSlug" element={<RoleRoute path="/clients"><ClientsPage /></RoleRoute>} />
          <Route path="/clients/:projectId/:projectSlug/:tab" element={<RoleRoute path="/clients"><ClientsPage /></RoleRoute>} />
          <Route path="/payments" element={<RoleRoute path="/payments"><PaymentsPage /></RoleRoute>} />
          <Route path="/gst-invoices" element={<RoleRoute path="/gst-invoices"><GSTInvoicesPage /></RoleRoute>} />
          <Route path="/materials" element={<RoleRoute path="/materials"><MaterialEntryPage /></RoleRoute>} />
          <Route path="/workers" element={<RoleRoute path="/workers"><WorkersPage /></RoleRoute>} />
          <Route path="/ai-search" element={<RoleRoute path="/ai-search"><AISearchPage /></RoleRoute>} />
          <Route path="/profit-loss" element={<RoleRoute path="/profit-loss"><ProfitLossPage /></RoleRoute>} />
          <Route path="/settings" element={<RoleRoute path="/settings"><SettingsPage /></RoleRoute>} />
          <Route path="/users" element={<RoleRoute path="/users"><UserAccessPage /></RoleRoute>} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </div>
  );
}
