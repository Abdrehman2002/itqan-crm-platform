import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { User, Tenant } from '@crm/shared';
import { api } from '../services/api';

interface AuthState {
  user: User | null;
  tenant: Tenant | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (email: string, password: string, tenantSlug?: string) => Promise<void>;
  logout: () => void;
  refreshTenant: () => Promise<void>;
  setToken: (token: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      tenant: null,
      token: null,
      isAuthenticated: false,

      login: async (email, password, tenantSlug) => {
        const { data } = await api.post('/auth/login', { email, password, tenantSlug });
        const { token, user, tenant } = data.data;
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        set({ user, tenant, token, isAuthenticated: true });
      },

      logout: () => {
        delete api.defaults.headers.common['Authorization'];
        // Best-effort server-side logout (invalidate token in Redis blocklist)
        api.post('/auth/logout').catch(() => {});
        set({ user: null, tenant: null, token: null, isAuthenticated: false });
      },

      setToken: (token: string) => {
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        set({ token });
      },

      refreshTenant: async () => {
        const { data } = await api.get('/api/v1/tenant/me');
        set({ tenant: data.data });
      },
    }),
    {
      name: 'crm-auth',
      // Use sessionStorage instead of localStorage so the token is not
      // accessible to XSS payloads that survive page navigation.
      // sessionStorage is cleared when the browser tab is closed.
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ token: state.token, user: state.user, tenant: state.tenant }),
      onRehydrateStorage: () => (state) => {
        if (state?.token) {
          api.defaults.headers.common['Authorization'] = `Bearer ${state.token}`;
          state.isAuthenticated = true;
        }
      },
    },
  ),
);
