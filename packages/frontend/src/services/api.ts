import axios from 'axios';

export const api = axios.create({
  baseURL: (import.meta as any).env?.VITE_API_URL || '',
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

// Auto-refresh on 401
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const { data } = await api.post('/auth/refresh');
        const newToken = data.data.token;
        api.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
        original.headers['Authorization'] = `Bearer ${newToken}`;
        // Update the Zustand store so the new token is persisted in sessionStorage
        // Lazy import to avoid circular dependency at module init time
        import('../store/auth.store').then(({ useAuthStore }) => {
          useAuthStore.getState().setToken(newToken);
        });
        return api(original);
      } catch {
        // Refresh failed — clear session and redirect to login
        import('../store/auth.store').then(({ useAuthStore }) => {
          useAuthStore.getState().logout();
        });
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);
