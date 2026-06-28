/**
 * NotificationBell
 *
 * Polls /api/v1/notifications every 30s.
 * Shows unread badge. Click opens a dropdown with recent notifications.
 * Clicking a notification marks it read and navigates to the entity.
 */

import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, LifeBuoy, AlertTriangle, ShieldAlert, X } from 'lucide-react';
import { api } from '../services/api';

interface Notification {
  id: string;
  type: string;
  title: string;
  body?: string;
  entity_type?: string;
  entity_id?: string;
  is_read: boolean;
  created_at: string;
}

const TYPE_CONFIG: Record<string, { icon: React.ElementType; cls: string }> = {
  ticket_assigned: { icon: LifeBuoy,    cls: 'text-brand-600 bg-brand-50' },
  ticket_accepted: { icon: LifeBuoy,    cls: 'text-green-600  bg-green-50'  },
  sla_reminder:    { icon: AlertTriangle,cls:'text-amber-600  bg-amber-50'  },
  sla_breach:      { icon: AlertTriangle,cls:'text-orange-600 bg-orange-50' },
  sla_escalated:   { icon: ShieldAlert,  cls: 'text-red-600   bg-red-50'    },
};

function timeAgo(dateStr: string): string {
  const secs = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (secs < 60)   return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400)return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data } = useQuery<{ data: Notification[]; meta: { unreadCount: number } }>({
    queryKey: ['notifications'],
    queryFn: async () => (await api.get('/api/v1/notifications')).data,
    refetchInterval: 30_000,
  });

  const readMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/notifications/${id}/read`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const readAllMutation = useMutation({
    mutationFn: () => api.post('/api/v1/notifications/read-all', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  // Per-notification dismiss + clear-all. Optimistic — drop the row from the
  // cached list before the request returns so the UI feels instant.
  const dismissMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/notifications/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['notifications'] });
      const prev = qc.getQueryData(['notifications']);
      qc.setQueryData(['notifications'], (old: any) => {
        if (!old?.data) return old;
        const filtered = old.data.filter((n: any) => n.id !== id);
        return {
          ...old,
          data: filtered,
          meta: { ...old.meta, unreadCount: filtered.filter((n: any) => !n.is_read).length },
        };
      });
      return { prev };
    },
    onError: (_e, _v, ctx: any) => ctx?.prev && qc.setQueryData(['notifications'], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const dismissAllMutation = useMutation({
    mutationFn: () => api.delete('/api/v1/notifications'),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['notifications'] });
      const prev = qc.getQueryData(['notifications']);
      qc.setQueryData(['notifications'], (old: any) => ({ ...old, data: [], meta: { unreadCount: 0 } }));
      return { prev };
    },
    onError: (_e, _v, ctx: any) => ctx?.prev && qc.setQueryData(['notifications'], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const notifications = data?.data ?? [];
  const unread        = data?.meta.unreadCount ?? 0;

  function handleClick(n: Notification) {
    if (!n.is_read) readMutation.mutate(n.id);
    if (n.entity_type === 'ticket' && n.entity_id) {
      setOpen(false);
      navigate('/tickets');
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
        title="Notifications"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        // The bell lives in the bottom-left sidebar. With `right-0` the popup
        // anchored its RIGHT edge to the bell and extended leftward — straight
        // off the screen. `left-full ml-2 bottom-0` anchors it just to the
        // RIGHT of the bell, popping out into the main content area where it's
        // actually visible.
        <div className="absolute bottom-0 left-full ml-2 w-80 bg-white rounded-2xl shadow-2xl border border-gray-100 z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="text-sm font-semibold text-gray-900">Notifications</span>
            <div className="flex items-center gap-3">
              {unread > 0 && (
                <button
                  onClick={() => readAllMutation.mutate()}
                  className="text-xs text-brand-600 hover:underline flex items-center gap-1"
                  title="Mark all as read"
                >
                  <CheckCheck className="w-3 h-3" /> Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  onClick={() => { if (confirm('Clear all notifications?')) dismissAllMutation.mutate(); }}
                  className="text-xs text-red-600 hover:underline"
                  title="Dismiss all notifications"
                >
                  Clear all
                </button>
              )}
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600" title="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
            {notifications.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                <Bell className="w-6 h-6 mb-2 opacity-30" />
                <p className="text-xs">No notifications</p>
              </div>
            )}
            {notifications.map(n => {
              const cfg = TYPE_CONFIG[n.type] ?? { icon: Bell, cls: 'text-gray-600 bg-gray-50' };
              const Icon = cfg.icon;
              return (
                <div
                  key={n.id}
                  className={`group flex gap-3 px-4 py-3 transition-colors hover:bg-gray-50 ${
                    !n.is_read ? 'bg-brand-50/40' : ''
                  }`}
                >
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${cfg.cls}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleClick(n)}
                    className="flex-1 min-w-0 text-left cursor-pointer"
                  >
                    <p className={`text-xs font-medium leading-snug ${!n.is_read ? 'text-gray-900' : 'text-gray-600'}`}>
                      {n.title}
                    </p>
                    {n.body && <p className="text-xs text-gray-400 mt-0.5 leading-snug line-clamp-2">{n.body}</p>}
                    <p className="text-[10px] text-gray-300 mt-1">{timeAgo(n.created_at)}</p>
                  </button>
                  {!n.is_read && <div className="w-2 h-2 bg-brand-500 rounded-full shrink-0 mt-1.5" />}
                  {/* Per-notification dismiss. Visible on hover (and always on touch).
                       Stops propagation so it doesn't also fire handleClick. */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); dismissMutation.mutate(n.id); }}
                    className="shrink-0 mt-0.5 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                    title="Dismiss this notification"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
