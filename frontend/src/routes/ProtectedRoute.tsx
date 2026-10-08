import { Navigate, Outlet } from 'react-router-dom';
import { WifiOff, RefreshCw, LogIn } from 'lucide-react';

import { BuildingLoader } from '../components/BuildingLoader';
import { useAuth } from '../contexts/AuthContext';
import kkrLogo from '../assets/kkr-logo.png';

export function ProtectedRoute({ allowedRoles }: { allowedRoles?: string[] }) {
  const { user, token, isAuthReady, connectionError, retryBootstrap, logout } = useAuth();

  if (!isAuthReady) {
    return <BuildingLoader label="Building KKR workspace" fullPage />;
  }

  // If initial connection to backend failed (e.g. Supabase DNS or offline) but user has token
  if (token && !user && connectionError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-mist p-4 sm:p-6">
        <div className="w-full max-w-md rounded-3xl border border-line bg-surface p-6 sm:p-8 shadow-2xl text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 border border-amber-200">
            <WifiOff className="h-8 w-8 text-amber-700 animate-pulse" />
          </div>

          <div className="mb-2 flex items-center justify-center gap-2">
            <img src={kkrLogo} alt="KKR Logo" className="h-7 w-7 object-contain" />
            <h2 className="text-xl font-black text-graphite">Connection Error</h2>
          </div>

          <p className="text-sm text-muted leading-relaxed mb-6">
            {connectionError}
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={() => void retryBootstrap()}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white hover:bg-graphite active:scale-95 transition shadow-sm"
            >
              <RefreshCw className="h-4 w-4" />
              Retry Connection
            </button>

            <button
              type="button"
              onClick={logout}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-white border border-line px-4 py-2.5 text-sm font-bold text-brand hover:bg-sand active:scale-95 transition shadow-xs"
            >
              <LogIn className="h-4 w-4" />
              Re-login
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!token || !user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && (!user.role || !allowedRoles.includes(user.role))) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}

