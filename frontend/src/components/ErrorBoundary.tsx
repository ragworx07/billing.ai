import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertOctagon, RefreshCw, LogIn, Home } from 'lucide-react';
import kkrLogo from '../assets/kkr-logo.png';
import { clearAuthSession } from '../services/authSession';

interface Props {
  children: ReactNode;
  fallbackRender?: (error: Error, resetErrorBoundary: () => void) => ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error caught by ErrorBoundary:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleReload = () => {
    window.location.reload();
  };

  private handleReLogin = () => {
    clearAuthSession();
    sessionStorage.clear();
    window.location.href = '/login';
  };

  private handleGoHome = () => {
    window.location.href = '/';
  };

  public override render() {
    if (this.state.hasError) {
      if (this.props.fallbackRender && this.state.error) {
        return this.props.fallbackRender(this.state.error, this.handleReset);
      }

      return (
        <div className="flex min-h-screen items-center justify-center bg-mist p-4 sm:p-6">
          <div className="w-full max-w-lg rounded-3xl border border-line bg-surface p-6 sm:p-8 shadow-2xl text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 border border-amber-200">
              <AlertOctagon className="h-8 w-8 text-amber-700" />
            </div>

            <div className="mb-2 flex items-center justify-center gap-2">
              <img src={kkrLogo} alt="KKR Logo" className="h-7 w-7 object-contain" />
              <h2 className="text-xl font-black text-graphite">Something went wrong</h2>
            </div>

            <p className="text-sm text-muted leading-relaxed mb-6">
              An unexpected error occurred while loading this view. You can retry the action or re-authenticate your session.
            </p>

            {import.meta.env.DEV && this.state.error && (
              <div className="mb-6 max-h-32 overflow-y-auto rounded-xl bg-slate-900/5 p-3 text-left font-mono text-xs text-slate-700 border border-slate-200/60 break-words">
                {this.state.error.message || 'Unknown application error'}
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={this.handleReload}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-xs sm:text-sm font-bold text-white hover:bg-graphite active:scale-95 transition shadow-sm"
              >
                <RefreshCw className="h-4 w-4" />
                Retry & Reload
              </button>

              <button
                type="button"
                onClick={this.handleReLogin}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-white border border-line px-4 py-2.5 text-xs sm:text-sm font-bold text-brand hover:bg-sand active:scale-95 transition shadow-xs"
              >
                <LogIn className="h-4 w-4" />
                Re-login
              </button>

              <button
                type="button"
                onClick={this.handleGoHome}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-white border border-slate-200 px-4 py-2.5 text-xs sm:text-sm font-bold text-slate-700 hover:bg-slate-50 active:scale-95 transition shadow-xs"
              >
                <Home className="h-4 w-4" />
                Home
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
