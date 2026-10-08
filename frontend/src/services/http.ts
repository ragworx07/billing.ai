import axios from 'axios';

import { clearAuthSession } from './authSession';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';
const AUTH_EXEMPT_ENDPOINTS = ['/auth/login', '/auth/signup', '/auth/bootstrap-owner'];
let authErrorHandled = false;

export const http = axios.create({
  baseURL: API_URL,
});

http.interceptors.request.use((config) => {
  const token = localStorage.getItem('cido_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

http.interceptors.response.use(
  (response) => {
    authErrorHandled = false;
    return response;
  },
  async (error) => {
    const statusCode = error?.response?.status;
    const detail = error?.response?.data?.detail;
    const code = error?.response?.data?.code;
    const authActionFromBody = error?.response?.data?.auth_action;
    const authActionFromHeader = error?.response?.headers?.['x-auth-action'];
    const shouldLogout =
      statusCode === 401 || authActionFromBody === 'logout' || authActionFromHeader === 'logout';
    const reasonFromDetail = typeof detail === 'string' && detail.trim() ? detail.trim() : '';
    const reasonByCode =
      code === 'missing_token'
        ? 'You are not logged in. Please sign in again.'
        : code === 'invalid_token'
          ? 'Session token is invalid. Please sign in again.'
          : code === 'token_expired_or_invalid'
            ? 'Session expired. Please sign in again.'
            : '';
    const reason = reasonByCode || reasonFromDetail || 'Unauthorized access';
    const requestUrl = String(error?.config?.url || '');
    const isAuthExempt = AUTH_EXEMPT_ENDPOINTS.some((path) => requestUrl.includes(path));

    if (shouldLogout && typeof statusCode === 'number' && !isAuthExempt && !authErrorHandled) {
      authErrorHandled = true;
      clearAuthSession();
      sessionStorage.setItem('auth_notice', reason);
      if (window.location.pathname !== '/login') {
        window.location.replace('/login');
      }
    }

    return Promise.reject(error);
  },
);
