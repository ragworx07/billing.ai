import React from 'react';
import ReactDOM from 'react-dom/client';
import axios from 'axios';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

import { AppRoutes } from './routes/AppRoutes';
import { AppearanceProvider } from './contexts/AppearanceContext';
import { AuthProvider } from './contexts/AuthContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { AuditHoverProvider } from './contexts/AuditHoverContext';
import { NetworkStatusBanner } from './components/NetworkStatusBanner';
import { ErrorBoundary } from './components/ErrorBoundary';
import { applyAppearance, getSavedAppearance } from './utils/appearance';
import './index.css';

// Applied before the first render so the app never flashes the default theme.
applyAppearance(getSavedAppearance());

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      refetchOnMount: false,
      retry: (failureCount, error) => {
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          // Do not retry client auth/validation errors
          if (status === 401 || status === 403 || status === 404 || status === 422) {
            return false;
          }
        }
        return failureCount < 2;
      },
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AppearanceProvider>
            <NotificationProvider>
              <AuthProvider>
                <AuditHoverProvider>
                  <NetworkStatusBanner />
                  <AppRoutes />
                </AuditHoverProvider>
              </AuthProvider>
            </NotificationProvider>
          </AppearanceProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
