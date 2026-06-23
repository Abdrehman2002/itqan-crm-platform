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

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status !== 401 || original._retry) {
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
