/**
 * MessageToast
 *
 * Polls /api/v1/messages/unread-count every 10s using a "since" timestamp
 * stored in localStorage. When the unread count climbs between two polls, a
 * small toast appears bottom-right with the latest sender + preview. Click
 * the toast → navigates to /messages, which also bumps the timestamp.
 *
 * Lightweight on purpose: no WebSocket, no service worker, no schema change
 * for "read receipts". Good enough for v1 internal team chat.
 */

import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useLocation } from 'react-router-dom';
import { MessageCircle, X } from 'lucide-react';
import { api } from '../services/api';

const LAST_SEEN_KEY = 'amanahcx.messages.lastSeenAt';
const POLL_MS       = 10_000;

export function getMessageLastSeen(): string {
  return localStorage.getItem(LAST_SEEN_KEY) ?? new Date(0).toISOString();
}
export function bumpMessageLastSeen(): void {
  localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString());
}

interface UnreadResp {
  total: number;
  dm: number;
  channel: number;
  latestAt: string | null;
  latestSender: string | null;
  latestPreview: string | null;
}

export function useMessageUnread() {
  // We're using a state-mirror of localStorage so that bumping the seen
  // timestamp inside the same tab actually re-fires the query. Without the
  // mirror the queryKey wouldn't change and the next refetch would re-count
  // the messages we just marked as seen.
  const [since, setSince] = useState(getMessageLastSeen);
  useEffect(() => {
    const sync = () => setSince(getMessageLastSeen());
    window.addEventListener('storage', sync);
    window.addEventListener('amanahcx:messages-seen', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('amanahcx:messages-seen', sync);
    };
  }, []);
  const { data } = useQuery<UnreadResp>({
    queryKey: ['messages-unread', since],
    queryFn: () => api.get('/api/v1/messages/unread-count', { params: { since } }).then((r) => r.data.data),
    refetchInterval: POLL_MS,
    // Avoid the first paint flash while the request is in flight — treat the
    // last-known value as fresh for a full poll cycle.
    staleTime: POLL_MS,
  });
  return { unread: data?.total ?? 0, latest: data, bump: () => { bumpMessageLastSeen(); window.dispatchEvent(new Event('amanahcx:messages-seen')); } };
}

export function MessageToast() {
  const navigate = useNavigate();
  const location = useLocation();
  const { unread, latest, bump } = useMessageUnread();
  const prevUnread = useRef(0);
  const [show, setShow] = useState(false);
  const dismissTimer = useRef<number | null>(null);

  // Pop the toast only when the count INCREASES — not on first load and not
  // when count drops because we just visited the page.
  useEffect(() => {
    if (unread > prevUnread.current && prevUnread.current >= 0 && unread > 0) {
      setShow(true);
      if (dismissTimer.current) window.clearTimeout(dismissTimer.current);
      dismissTimer.current = window.setTimeout(() => setShow(false), 8000);
    }
    prevUnread.current = unread;
  }, [unread]);

  // Bump the last-seen timestamp whenever the user is actually on /messages,
  // so the count drops to zero while they're there and a new arrival pops
  // a fresh toast instead of being silently swallowed.
  useEffect(() => {
    if (location.pathname.startsWith('/messages')) {
      bump();
      setShow(false);
    }
  }, [location.pathname, bump]);

  if (!show || !latest || !latest.latestSender) return null;

  return (
    <div
      role="status"
      onClick={() => { setShow(false); navigate('/messages'); }}
      className="fixed bottom-6 right-6 z-[9999] w-80 bg-white shadow-2xl rounded-2xl border border-gray-100 px-4 py-3 cursor-pointer hover:shadow-xl transition-shadow"
      style={{ animation: 'slide-in-right 200ms ease-out' }}
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
             style={{ background: 'linear-gradient(135deg,#29ABE2 0%,#1a8cbf 100%)' }}>
          <MessageCircle className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-xs font-semibold text-gray-900 truncate">{latest.latestSender}</p>
            {unread > 1 && (
              <span className="text-[10px] font-bold bg-brand-50 text-brand-700 px-1.5 py-0.5 rounded-full">
                +{unread - 1} more
              </span>
            )}
          </div>
          <p className="text-xs text-gray-600 line-clamp-2">{latest.latestPreview ?? ''}</p>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); setShow(false); }}
          className="text-gray-300 hover:text-gray-500 shrink-0"
          title="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
