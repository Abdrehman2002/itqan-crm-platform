import { useEffect } from 'react';
import { api } from '../services/api';
import { useAuthStore } from '../store/auth.store';

/**
 * Fires a POST /auth/heartbeat every 30 seconds while the user is logged in
 * and the tab is visible. Updates users.last_active_at so manager dashboards
 * can show online/idle/offline status.
 */
export function useHeartbeat(intervalMs = 30_000) {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated) return;

    let cancelled = false;

    const beat = () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.hidden) return; // skip when tab is hidden
      api.post('/auth/heartbeat').catch(() => { /* best-effort, swallow */ });
    };

    beat(); // fire once immediately
    const id = setInterval(beat, intervalMs);

    // Also beat when the tab becomes visible again
    const onVis = () => { if (!document.hidden) beat(); };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [isAuthenticated, intervalMs]);
}
