import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { getProfile, login as loginRequest } from '../services/auth';
import { clearAuthSession } from '../services/authSession';
import type { User } from '../types/api';
import { fetchAndSyncPermissionsSettings } from '../utils/access';
import { analyzeApiError } from '../utils/errors';
import { useNotify } from './NotificationContext';

interface AuthContextValue {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  isAuthReady: boolean;
  connectionError: string | null;
  retryBootstrap: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readStoredUser(): User | null {
  try {
    const saved = localStorage.getItem('cido_user');
    return saved ? (JSON.parse(saved) as User) : null;
  } catch {
    localStorage.removeItem('cido_user');
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const notify = useNotify();
  const [user, setUser] = useState<User | null>(() => readStoredUser());
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('cido_token'));
  const [isAuthReady, setIsAuthReady] = useState<boolean>(() => !localStorage.getItem('cido_token'));
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const bootstrapGen = useRef(0);

  useEffect(() => {
    if (user) {
      localStorage.setItem('cido_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('cido_user');
    }
  }, [user]);

  const login = async (email: string, password: string) => {
    const response = await loginRequest(email, password);
    setUser(response.user);
    setToken(response.access_token);
    setConnectionError(null);
    localStorage.setItem('cido_token', response.access_token);
    notify.dismissNetwork();
    void fetchAndSyncPermissionsSettings();
  };

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    setConnectionError(null);
    clearAuthSession();
  }, []);

  const bootstrapSession = useCallback(async () => {
    const gen = ++bootstrapGen.current;
    const savedToken = localStorage.getItem('cido_token');
    if (!savedToken) {
      if (gen === bootstrapGen.current) {
        setIsAuthReady(true);
        setConnectionError(null);
      }
      return;
    }

    try {
      const profile = await getProfile();
      if (gen !== bootstrapGen.current) return;
      setUser(profile);
      setConnectionError(null);
      localStorage.setItem('cido_user', JSON.stringify(profile));
      notify.dismissNetwork();
      void fetchAndSyncPermissionsSettings();
    } catch (err: unknown) {
      if (gen !== bootstrapGen.current) return;
      const errorInfo = analyzeApiError(err);

      if (errorInfo.isAuthError) {
        logout();
        const message = 'Session expired. Please log in again.';
        sessionStorage.setItem('auth_notice', message);
        if (window.location.pathname !== '/login') {
          window.location.replace('/login');
        }
      } else {
        const message = errorInfo.message || 'Cannot reach the KKR server. Please check your connection.';
        setConnectionError(message);
      }
    } finally {
      if (gen === bootstrapGen.current) {
        setIsAuthReady(true);
      }
    }
  }, [logout, notify]);

  useEffect(() => {
    void bootstrapSession();
  }, [bootstrapSession]);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        logout,
        isAuthReady,
        connectionError,
        retryBootstrap: bootstrapSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
