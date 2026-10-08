import { useCallback, useEffect, useRef, useState } from 'react';
import { WifiOff, Wifi, RefreshCw, AlertTriangle, LogIn } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

import { useAuth } from '../contexts/AuthContext';

const API_URL = String(import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1').replace(/\/$/, '');
const HEALTH_URL = `${API_URL}/health`;

export function NetworkStatusBanner() {
  const queryClient = useQueryClient();
  const { connectionError, retryBootstrap, logout } = useAuth();
  const [isOnline, setIsOnline] = useState<boolean>(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [wasOffline, setWasOffline] = useState<boolean>(false);
  const [showRestored, setShowRestored] = useState<boolean>(false);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [serverUnreachable, setServerUnreachable] = useState<boolean>(false);
  const restoredTimerRef = useRef<number | null>(null);

  const clearRestoredTimer = useCallback(() => {
    if (restoredTimerRef.current != null) {
      window.clearTimeout(restoredTimerRef.current);
      restoredTimerRef.current = null;
    }
  }, []);

  const pingHealth = useCallback(async (): Promise<boolean> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setIsOnline(false);
      setServerUnreachable(false);
      return false;
    }

    try {
      await axios.get(HEALTH_URL, { timeout: 4000 });
      setIsOnline(true);
      setServerUnreachable(false);
      return true;
    } catch {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setIsOnline(false);
        setServerUnreachable(false);
      } else {
        setIsOnline(true);
        setServerUnreachable(true);
      }
      return false;
    }
  }, []);

  const checkConnection = useCallback(async () => {
    setIsChecking(true);
    try {
      const healthy = await pingHealth();
      if (healthy) {
        void queryClient.invalidateQueries();
        await retryBootstrap();
      }
    } finally {
      setIsChecking(false);
    }
  }, [pingHealth, queryClient, retryBootstrap]);

  useEffect(() => {
    void pingHealth();
  }, [pingHealth]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (wasOffline) {
        setShowRestored(true);
        clearRestoredTimer();
        restoredTimerRef.current = window.setTimeout(() => setShowRestored(false), 3500);
      }
      void checkConnection();
    };

    const handleOffline = () => {
      setIsOnline(false);
      setWasOffline(true);
      setShowRestored(false);
      setServerUnreachable(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearRestoredTimer();
    };
  }, [wasOffline, checkConnection, clearRestoredTimer]);

  const showServerDown = Boolean(connectionError) || serverUnreachable;

  if (showRestored && isOnline && !showServerDown) {
    return (
      <div className="fixed top-0 inset-x-0 z-[190] flex items-center justify-center bg-emerald-600 px-4 py-2 text-white shadow-md transition-all duration-300 animate-in slide-in-from-top">
        <div className="flex items-center gap-2 text-xs sm:text-sm font-bold">
          <Wifi className="h-4 w-4 shrink-0 text-white animate-pulse" />
          <span>Internet connection restored. Synchronizing KKR workspace...</span>
        </div>
      </div>
    );
  }

  if (!isOnline || showServerDown) {
    return (
      <div className="fixed top-0 inset-x-0 z-[190] flex flex-wrap items-center justify-between gap-3 bg-amber-500 px-4 py-2 text-amber-950 shadow-md transition-all duration-300 animate-in slide-in-from-top">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1 rounded-lg bg-amber-600/20 shrink-0">
            {isOnline ? <AlertTriangle className="h-4 w-4 text-amber-950" /> : <WifiOff className="h-4 w-4 text-amber-950 animate-bounce" />}
          </div>
          <div className="text-xs sm:text-sm font-bold truncate">
            {!isOnline ? (
              <span>You are currently offline. Check your network or Wi-Fi connection.</span>
            ) : (
              <span>KKR server is temporarily unreachable. Changes may not sync until reconnected.</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-auto">
          <button
            type="button"
            onClick={() => {
              logout();
              window.location.href = '/login';
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white/80 text-amber-950 text-xs font-bold hover:bg-white active:scale-95 transition shadow-xs"
          >
            <LogIn className="h-3 w-3" />
            Re-login
          </button>
          <button
            type="button"
            onClick={() => void checkConnection()}
            disabled={isChecking}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-950 text-white text-xs font-bold hover:bg-black active:scale-95 transition shadow-xs disabled:opacity-60"
          >
            <RefreshCw className={`h-3 w-3 ${isChecking ? 'animate-spin' : ''}`} />
            {isChecking ? 'Checking...' : 'Check Connection'}
          </button>
        </div>
      </div>
    );
  }

  return null;
}
