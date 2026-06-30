/**
 * Live Wallboard — manager/admin presence + ticket-load board.
 *
 * Auto-refreshes every 30 s. Reads from a single backend endpoint
 * (`GET /api/v1/agent/wallboard`) that returns every agent in the
 * tenant with their current agent_status + active/breached ticket
 * counts joined from the tickets table.
 */
import { useQuery } from '@tanstack/react-query';
import { Loader2, Users, AlertTriangle, Clock, RefreshCw } from 'lucide-react';
import { api } from '../services/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AgentRow {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string | null;
  agent_status: 'online' | 'busy' | 'away' | 'offline';
  agent_status_updated_at: string | null;
  active_tickets: number;
  breached_tickets: number;
}

// ── Status config ──────────────────────────────────────────────────────────────

const STATUS_CFG = {
  online:  { dot: 'bg-emerald-400', badge: 'bg-emerald-50 text-emerald-700 border border-emerald-200',  label: 'Online'  },
  busy:    { dot: 'bg-red-400',     badge: 'bg-red-50 text-red-700 border border-red-200',              label: 'Busy'    },
  away:    { dot: 'bg-yellow-400',  badge: 'bg-yellow-50 text-yellow-700 border border-yellow-200',     label: 'Away'    },
  offline: { dot: 'bg-gray-300',    badge: 'bg-gray-50 text-gray-500 border border-gray-200',           label: 'Offline' },
} as const;

function fmtRelative(iso: string | null) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

// ── Agent card ─────────────────────────────────────────────────────────────────

function AgentCard({ agent }: { agent: AgentRow }) {
  const cfg = STATUS_CFG[agent.agent_status] ?? STATUS_CFG.offline;
  const initials = agent.name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) ?? '?';

  return (
    <div className={`bg-white rounded-xl border p-4 flex flex-col gap-3 transition-all ${
      agent.agent_status === 'offline' ? 'opacity-60 border-gray-100' : 'border-gray-200 shadow-sm'
    }`}>
      {/* Avatar + name */}
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold"
               style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #4D8B3C 100%)' }}>
            {initials}
          </div>
          <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${cfg.dot}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{agent.name}</p>
          <p className="text-xs text-gray-400 truncate">{agent.role?.replace('_', ' ')} · {agent.department ?? '—'}</p>
        </div>
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${cfg.badge}`}>
          {cfg.label}
        </span>
      </div>

      {/* Ticket load */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-gray-50 rounded-lg px-3 py-2 text-center">
          <p className="text-lg font-bold text-gray-900">{agent.active_tickets ?? 0}</p>
          <p className="text-[10px] text-gray-400">Active tickets</p>
        </div>
        <div className={`rounded-lg px-3 py-2 text-center ${(agent.breached_tickets ?? 0) > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
          <p className={`text-lg font-bold ${(agent.breached_tickets ?? 0) > 0 ? 'text-red-600' : 'text-gray-900'}`}>
            {agent.breached_tickets ?? 0}
          </p>
          <p className="text-[10px] text-gray-400">SLA breached</p>
        </div>
      </div>

      {/* Status since */}
      <p className="text-[10px] text-gray-400 text-right -mt-1">
        Status since {fmtRelative(agent.agent_status_updated_at)}
      </p>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function Wallboard() {
  const { data, isLoading, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['wallboard-agents'],
    queryFn: () => api.get('/api/v1/agent/wallboard').then(r => r.data.data ?? []),
    refetchInterval: 30_000,
  });

  const agents: AgentRow[] = data ?? [];

  const online  = agents.filter(a => a.agent_status === 'online').length;
  const busy    = agents.filter(a => a.agent_status === 'busy').length;
  const away    = agents.filter(a => a.agent_status === 'away').length;
  const offline = agents.filter(a => a.agent_status === 'offline').length;
  const available = online + busy; // agents who can handle work

  const totalBreached = agents.reduce((s, a) => s + (a.breached_tickets ?? 0), 0);
  const breachedAgents = agents.filter(a => (a.breached_tickets ?? 0) > 0).length;

  const updatedAt = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-6">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Live Wallboard</h1>
          <p className="text-sm text-gray-400 mt-0.5">Auto-refreshes every 30 seconds</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> Last updated {updatedAt}
          </span>
          <button onClick={() => refetch()}
            className="flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-700 border border-brand-200 hover:border-brand-400 px-3 py-1.5 rounded-lg transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Online',  value: online,  color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
          { label: 'Busy',    value: busy,    color: 'text-red-600',     bg: 'bg-red-50',     border: 'border-red-200'     },
          { label: 'Away',    value: away,    color: 'text-yellow-600',  bg: 'bg-yellow-50',  border: 'border-yellow-200'  },
          { label: 'Offline', value: offline, color: 'text-gray-500',    bg: 'bg-gray-50',    border: 'border-gray-200'    },
        ].map(s => (
          <div key={s.label} className={`${s.bg} border ${s.border} rounded-xl p-4 text-center`}>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* SLA alert bar */}
      {totalBreached > 0 && (
        <div className="mb-5 flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-700 font-medium">
            {totalBreached} SLA {totalBreached === 1 ? 'breach' : 'breaches'} across {breachedAgents} agent{breachedAgents !== 1 ? 's' : ''} — immediate action required
          </p>
        </div>
      )}

      {/* Agent grid */}
      <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
        <Users className="w-4 h-4 text-brand-500" /> Agents ({available} available of {agents.length})
      </h2>

      {agents.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No agents found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {agents.map(a => <AgentCard key={a.id} agent={a} />)}
        </div>
      )}
    </div>
  );
}
