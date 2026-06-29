import axios from 'axios';

export const api = axios.create({
  baseURL: (import.meta as any).env?.VITE_API_URL || '',
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

// Single-flight token refresh — all concurrent 401s wait for one refresh attempt
let isRefreshing = false;
let pendingResolvers: Array<(token: string) => void> = [];
let pendingRejectors: Array<(err: unknown) => void> = [];

function flushQueue(err: unknown, token: string | null) {
  if (token) pendingResolvers.forEach(fn => fn(token));
  else pendingRejectors.forEach(fn => fn(err));
  pendingResolvers = [];
  pendingRejectors = [];
}

// URLs that must NEVER trigger the refresh-loop:
//  - /auth/login: a 401 here means "user typed the wrong password" — surface it
//    to the form so the spinner stops and "Invalid credentials" renders. (BUG-V1)
//  - /auth/refresh: the refresh endpoint itself failing means our refresh token
//    is dead; looping would be infinite.
//  - /auth/logout: cleanup call, no need to interpret 401 as expiry.
const AUTH_BYPASS = ['/auth/login', '/auth/refresh', '/auth/logout'];

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const isAuthCall = AUTH_BYPASS.some((u) => (original?.url ?? '').endsWith(u));
    if (error.response?.status !== 401 || original._retry || isAuthCall) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      // Another refresh is in flight — queue this request until it resolves
      return new Promise((resolve, reject) => {
        pendingResolvers.push((token) => {
          original.headers['Authorization'] = `Bearer ${token}`;
          resolve(api(original));
        });
        pendingRejectors.push(reject);
      });
    }

    original._retry = true;
    isRefreshing = true;

    try {
      const { data } = await api.post('/auth/refresh');
      const newToken = data.data.token;
      api.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
      import('../store/auth.store').then(({ useAuthStore }) => {
        useAuthStore.getState().setToken(newToken);
      });
      flushQueue(null, newToken);
      return api(original);
    } catch (err) {
      flushQueue(err, null);
      import('../store/auth.store').then(({ useAuthStore }) => {
        useAuthStore.getState().logout();
      });
      window.location.href = '/login';
      return Promise.reject(err);
    } finally {
      isRefreshing = false;
    }
  },
);
