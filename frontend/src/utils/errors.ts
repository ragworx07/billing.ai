import { AxiosError } from 'axios';

export interface ApiErrorInfo {
  message: string;
  isNetworkError: boolean;
  isAuthError: boolean;
  isServerError: boolean;
  statusCode?: number;
}

export async function parseBlobErrorMessage(blob: unknown): Promise<string | null> {
  if (blob instanceof Blob) {
    try {
      const text = await blob.text();
      const parsed = JSON.parse(text);
      if (typeof parsed?.detail === 'string' && parsed.detail.trim()) {
        return parsed.detail;
      }
    } catch {
      // Ignore JSON parse errors
    }
  }
  return null;
}

export function analyzeApiError(error: unknown, fallback = 'Something went wrong. Please try again.'): ApiErrorInfo {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      message: 'You are currently offline. Please check your internet connection and try again.',
      isNetworkError: true,
      isAuthError: false,
      isServerError: false,
    };
  }

  if (error instanceof AxiosError) {
    const statusCode = error.response?.status;
    const detail = error.response?.data?.detail;
    const code = error.code;
    const canceled = code === 'ERR_CANCELED' || error.message === 'canceled';
    const timedOut = code === 'ECONNABORTED' || error.message?.toLowerCase().includes('timeout');

    if (canceled) {
      return {
        message: fallback,
        isNetworkError: false,
        isAuthError: false,
        isServerError: false,
      };
    }

    if (timedOut) {
      return {
        message: 'Server request timed out. Please try again.',
        isNetworkError: true,
        isAuthError: false,
        isServerError: false,
        statusCode,
      };
    }

    // No HTTP response: DNS, connection refused, CORS, offline, or ERR_NETWORK
    if (!error.response) {
      return {
        message: 'Cannot reach the KKR server. Please check your network or server status and try again.',
        isNetworkError: true,
        isAuthError: false,
        isServerError: false,
        statusCode,
      };
    }

    // 401 Unauthorized / Expired
    if (statusCode === 401) {
      const msg = typeof detail === 'string' && detail.trim() ? detail.trim() : 'Session expired or invalid. Please sign in again.';
      return {
        message: msg,
        isNetworkError: false,
        isAuthError: true,
        isServerError: false,
        statusCode: 401,
      };
    }

    // 403 Forbidden
    if (statusCode === 403) {
      return {
        message: typeof detail === 'string' && detail.trim() ? detail.trim() : 'You do not have permission to perform this action.',
        isNetworkError: false,
        isAuthError: false,
        isServerError: false,
        statusCode: 403,
      };
    }

    // 5xx Server / Database Errors (including Supabase DNS / psycopg errors)
    if (statusCode && statusCode >= 500) {
      return {
        message: 'The server or database is temporarily unavailable. Please try again in a moment.',
        isNetworkError: false,
        isAuthError: false,
        isServerError: true,
        statusCode,
      };
    }

    // Detail in response body
    if (typeof detail === 'string' && detail.trim()) {
      return {
        message: detail.trim(),
        isNetworkError: false,
        isAuthError: false,
        isServerError: false,
        statusCode,
      };
    }

    // FastAPI validation array
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0];
      if (typeof first?.msg === 'string' && first.msg.trim()) {
        const field = Array.isArray(first?.loc) && first.loc.length > 1 ? `${first.loc[first.loc.length - 1]}: ` : '';
        return {
          message: `${field}${first.msg}`,
          isNetworkError: false,
          isAuthError: false,
          isServerError: false,
          statusCode,
        };
      }
    }

    if (typeof error.message === 'string' && error.message.trim()) {
      return {
        message: error.message,
        isNetworkError: false,
        isAuthError: false,
        isServerError: false,
        statusCode,
      };
    }
  }

  if (error instanceof Error && error.message) {
    return {
      message: error.message,
      isNetworkError: false,
      isAuthError: false,
      isServerError: false,
    };
  }

  return {
    message: fallback,
    isNetworkError: false,
    isAuthError: false,
    isServerError: false,
  };
}

export function getApiErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.') {
  return analyzeApiError(error, fallback).message;
}
