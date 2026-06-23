import axios from 'axios';

export const api = axios.create({
  baseURL: (import.meta as any).env?.VITE_API_URL || '',
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

// Auto-refresh on 401
// Guards against:
//   1. infinite refresh loop — if /auth/refresh itself returns 401, the
//      interceptor previously caught that 401, tried to refresh again, and
//      spiralled. Now we skip the interceptor entirely for the refresh URL.
//   2. parallel-request thundering herd — if 5 widgets all 401 at once, we
//      previously fired 5 refresh calls. Now they all await the same in-flight
//      refresh promise.
let inflightRefresh: Promise<string> | null = null;

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const url = (original?.url ?? '') as string;

    // Don't try to refresh on the refresh endpoint itself, or on login/logout —
    // a 401 there means the refresh token is gone or invalid. Bounce to login.
    const isAuthEndpoint = url.includes('/auth/refresh')
                        || url.includes('/auth/login')
                        || url.includes('/auth/logout');

    if (error.response?.status === 401 && !original?._retry && !isAuthEndpoint) {
      original._retry = true;
      try {
        // Coalesce concurrent 401s into ONE refresh call.
        if (!inflightRefresh) {
          inflightRefresh = api.post('/auth/refresh').then(r => {
            inflightRefresh = null;
            return r.data.data.token as string;
          }).catch(e => { inflightRefresh = null; throw e; });
        }
        const newToken = await inflightRefresh;
        api.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
        original.headers['Authorization'] = `Bearer ${newToken}`;
        import('../store/auth.store').then(({ useAuthStore }) => {
          useAuthStore.getState().setToken(newToken);
        });
        return api(original);
      } catch {
        import('../store/auth.store').then(({ useAuthStore }) => {
          useAuthStore.getState().logout();
        });
        if (!window.location.pathname.startsWith('/login')) {
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(error);
  },
);
