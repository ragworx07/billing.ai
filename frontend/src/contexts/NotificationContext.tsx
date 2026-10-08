import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { X, RefreshCw, LogIn, AlertCircle, CheckCircle2, WifiOff } from 'lucide-react';

import { clearAuthSession } from '../services/authSession';

export type NotificationType = 'success' | 'error' | 'network' | 'warning';

export interface NotificationOptions {
  title?: string;
  onRetry?: () => void | Promise<void>;
  retryLabel?: string;
  relogin?: boolean;
  duration?: number; // duration in ms, 0 or negative means persistent
}

export type Toast = {
  id: number;
  message: string;
  type: NotificationType;
  title?: string;
  onRetry?: () => void | Promise<void>;
  retryLabel?: string;
  relogin?: boolean;
};

export type NotificationContextValue = {
  success: (message: string, options?: NotificationOptions) => void;
  error: (message: string, options?: NotificationOptions) => void;
  networkError: (message?: string, options?: NotificationOptions) => void;
  warning: (message: string, options?: NotificationOptions) => void;
  dismiss: (id: number) => void;
  dismissNetwork: () => void;
};

const NotificationContext = createContext<NotificationContextValue | undefined>(undefined);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const dismissNetwork = useCallback(() => {
    setToasts((current) => current.filter((toast) => toast.type !== 'network'));
  }, []);

  const notify = useCallback(
    (type: NotificationType, message: string, options?: NotificationOptions) => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      const newToast: Toast = {
        id,
        message,
        type,
        title: options?.title,
        onRetry: options?.onRetry,
        retryLabel: options?.retryLabel,
        relogin: options?.relogin,
      };

      setToasts((current) => {
        const next = type === 'network' ? current.filter((toast) => toast.type !== 'network') : current;
        return [...next, newToast];
      });

      const actionable = Boolean(options?.onRetry || options?.relogin || type === 'network');
      const defaultDuration = actionable ? 0 : type === 'error' ? 4000 : 2800;
      const duration = options?.duration !== undefined ? options.duration : defaultDuration;

      if (duration > 0) {
        window.setTimeout(() => {
          dismissToast(id);
        }, duration);
      }
    },
    [dismissToast],
  );

  const value = useMemo<NotificationContextValue>(
    () => ({
      success: (message: string, options?: NotificationOptions) => notify('success', message, options),
      error: (message: string, options?: NotificationOptions) => notify('error', message, options),
      networkError: (
        message = 'Cannot connect to KKR server. Please check your network.',
        options?: NotificationOptions,
      ) =>
        notify('network', message, {
          title: 'Network / Connection Issue',
          ...options,
        }),
      warning: (message: string, options?: NotificationOptions) => notify('warning', message, options),
      dismiss: dismissToast,
      dismissNetwork,
    }),
    [dismissNetwork, dismissToast, notify],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-3 top-3 z-[200] max-w-[calc(100vw-1.5rem)] space-y-2.5 sm:right-4 sm:top-4">
        {toasts.map((toast) => {
          const isSuccess = toast.type === 'success';
          const isNetwork = toast.type === 'network';
          const isWarning = toast.type === 'warning';

          const borderBgClass = isSuccess
            ? 'border-emerald-200 bg-white/95 text-emerald-950 shadow-emerald-900/10'
            : isNetwork
              ? 'border-amber-200 bg-white/95 text-amber-950 shadow-amber-900/10'
              : isWarning
                ? 'border-orange-200 bg-white/95 text-orange-950 shadow-orange-900/10'
                : 'border-rose-200 bg-white/95 text-rose-950 shadow-rose-900/10';

          const IconComponent = isSuccess
            ? CheckCircle2
            : isNetwork
              ? WifiOff
              : isWarning
                ? AlertCircle
                : AlertCircle;

          const iconColorClass = isSuccess
            ? 'text-emerald-600 bg-emerald-50'
            : isNetwork
              ? 'text-amber-600 bg-amber-50'
              : isWarning
                ? 'text-orange-600 bg-orange-50'
                : 'text-rose-600 bg-rose-50';

          return (
            <div
              key={toast.id}
              role="alert"
              className={`pointer-events-auto flex min-w-0 w-[min(440px,calc(100vw-1.5rem))] flex-col rounded-2xl border p-3.5 shadow-2xl backdrop-blur-md transition-all animate-in fade-in slide-in-from-top-2 ${borderBgClass}`}
            >
              <div className="flex items-start gap-3">
                <div className={`p-1.5 rounded-xl shrink-0 mt-0.5 ${iconColorClass}`}>
                  <IconComponent className="h-4.5 w-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  {toast.title && (
                    <p className="text-xs font-black uppercase tracking-wider text-slate-700 mb-0.5">
                      {toast.title}
                    </p>
                  )}
                  <p className="text-xs sm:text-[13px] font-semibold leading-snug text-slate-900 break-words">
                    {toast.message}
                  </p>
                </div>
                <button
                  type="button"
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                  onClick={() => dismissToast(toast.id)}
                  aria-label="Dismiss notification"
                  title="Dismiss notification"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {(toast.onRetry || toast.relogin) && (
                <div className="mt-3 flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                  {toast.relogin && (
                    <button
                      type="button"
                      onClick={() => {
                        dismissToast(toast.id);
                        clearAuthSession();
                        window.location.href = '/login';
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 transition shadow-xs"
                    >
                      <LogIn className="h-3.5 w-3.5" />
                      Re-login
                    </button>
                  )}
                  {toast.onRetry && (
                    <button
                      type="button"
                      onClick={async () => {
                        dismissToast(toast.id);
                        try {
                          await toast.onRetry?.();
                        } catch {
                          // Handled in callback
                        }
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-brand-primary hover:bg-graphite transition shadow-xs"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      {toast.retryLabel || 'Retry'}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </NotificationContext.Provider>
  );
}

export function useNotify() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotify must be used within NotificationProvider');
  return context;
}
