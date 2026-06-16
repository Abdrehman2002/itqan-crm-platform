/**
 * TicketQueues — manage ticket queues + queue member assignments
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  List, Plus, Pencil, Trash2, Loader2, X, CheckCircle,
  Users, ChevronDown, ChevronRight, UserPlus, UserMinus,
  Ticket, Search, AlertCircle,
} from 'lucide-react';
import { api } from '../services/api';
import { useCan } from '../hooks/useRole';

interface Queue {
  id: string; name: string; description?: string;
  color: string; is_default: boolean; ticket_count: string;
}

interface QueueMember {
  id: string; name: string; email: string; role: string;
  department?: string; is_active: boolean;
  added_at: string; active_tickets: number;
}

interface TeamUser {
  id: string; name: string; email: string; role: string; department?: string;
}

const COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#84cc16','#f97316','#64748b'];

// ── Create / Edit queue modal ─────────────────────────────────────────────────

function QueueModal({ queue, onClose }: { queue?: Queue; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name:        queue?.name        ?? '',
    description: queue?.description ?? '',
    color:       queue?.color       ?? '#6366f1',
    isDefault:   queue?.is_default  ?? false,
  });

  const mutation = useMutation({
    mutationFn: () => queue
      ? api.patch(`/api/v1/tickets/queues/${queue.id}`, form)
      : api.post('/api/v1/tickets/queues', form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ticket-queues'] }); onClose(); },
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">{queue ? 'Edit Queue' : 'New Queue'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Queue Name *</label>
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-400"
              placeholder="e.g. Technical Support"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
            <input
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-400"
              placeholder="Optional description"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Color</label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setForm(f => ({ ...f, color: c }))}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${form.color === c ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={e => setForm(f => ({ ...f, isDefault: e.target.checked }))}
              className="rounded"
            />
            Set as default queue for new tickets
          </label>
        </div>
        <div className="px-6 pb-5 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!form.name || mutation.isPending}
            className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {queue ? 'Save Changes' : 'Create Queue'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add members modal ─────────────────────────────────────────────────────────

function AddMembersModal({
  queueId,
  queueName,
  currentMemberIds,
  onClose,
}: {
  queueId: string;
  queueName: string;
  currentMemberIds: Set<string>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [search, setSearch]       = useState('');
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [error, setError]         = useState('');

  // Fetch all team members to pick from
  const { data: team = [], isLoading } = useQuery<TeamUser[]>({
    queryKey: ['team-members'],
    queryFn:  () => api.get('/api/v1/settings/team').then(r => r.data.data ?? []),
  });

  // Only show agents/managers not already in this queue
  const eligible = team.filter(u =>
    ['agent', 'manager'].includes(u.role) &&
    !currentMemberIds.has(u.id) &&
    (
      !search ||
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
    ),
  );

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const mutation = useMutation({
    mutationFn: () => api.post(`/api/v1/tickets/queues/${queueId}/members`, {
      userIds: Array.from(selected),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['queue-members', queueId] });
      onClose();
    },
    onError: (e: any) => setError(e.response?.data?.error?.message ?? 'Failed to add members'),
  });

  const roleColor: Record<string, string> = {
    manager: 'bg-orange-100 text-orange-700',
    agent:   'bg-blue-100 text-blue-700',
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="font-semibold text-gray-900">Add Members to Queue</h2>
            <p className="text-xs text-gray-400 mt-0.5">{queueName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        {/* Search */}
        <div className="px-6 pt-4 shrink-0">
          {error && (
            <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />{error}
            </div>
          )}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search agents and managers…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400"
            />
          </div>
        </div>

        {/* Agent list */}
        <div className="flex-1 overflow-y-auto px-6 py-3 space-y-1.5">
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-300" /></div>
          ) : eligible.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">{search ? 'No agents match your search' : 'All agents are already in this queue'}</p>
            </div>
          ) : eligible.map(u => (
            <label
              key={u.id}
              className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${
                selected.has(u.id)
                  ? 'border-brand-400 bg-brand-50'
                  : 'border-gray-100 hover:border-gray-200 bg-white'
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(u.id)}
                onChange={() => toggle(u.id)}
                className="sr-only"
              />
              {/* Avatar */}
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-400 to-purple-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                {u.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{u.name}</p>
                <p className="text-xs text-gray-400 truncate">{u.email}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${roleColor[u.role] ?? 'bg-gray-100 text-gray-600'}`}>
                {u.role}
              </span>
              {selected.has(u.id) && (
                <div className="w-5 h-5 rounded-full bg-brand-500 flex items-center justify-center shrink-0">
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </label>
          ))}
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-6 py-4 border-t border-gray-100 shrink-0">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={selected.size === 0 || mutation.isPending}
            className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {mutation.isPending
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <UserPlus className="w-3.5 h-3.5" />}
            Add {selected.size > 0 ? `${selected.size} Member${selected.size > 1 ? 's' : ''}` : 'Members'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Queue members panel (expanded inline) ─────────────────────────────────────

function QueueMembersPanel({
  queue,
  canManage,
}: {
  queue: Queue;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);

  const { data: members = [], isLoading } = useQuery<QueueMember[]>({
    queryKey: ['queue-members', queue.id],
    queryFn:  () => api.get(`/api/v1/tickets/queues/${queue.id}/members`).then(r => r.data.data ?? []),
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => api.delete(`/api/v1/tickets/queues/${queue.id}/members/${userId}`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['queue-members', queue.id] }),
  });

  const currentMemberIds = new Set(members.map(m => m.id));

  const roleColor: Record<string, string> = {
    manager: 'bg-orange-100 text-orange-700',
    agent:   'bg-blue-100 text-blue-700',
  };

  // Load badge colour from ticket count
  const loadColor = (n: number) => {
    if (n === 0) return 'bg-emerald-100 text-emerald-700';
    if (n < 4)   return 'bg-yellow-100 text-yellow-700';
    return 'bg-red-100 text-red-700';
  };

  return (
    <div className="border-t border-gray-100 bg-gray-50/60 rounded-b-2xl px-4 pt-3 pb-4">
      {/* Sub-header */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" />
          Assigned Agents
          <span className="ml-1 px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded-full text-[10px] font-bold">
            {isLoading ? '…' : members.length}
          </span>
        </p>
        {canManage && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-medium"
          >
            <UserPlus className="w-3.5 h-3.5" /> Add Agent
          </button>
        )}
      </div>

      {/* Member rows */}
      {isLoading ? (
        <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-gray-300" /></div>
      ) : members.length === 0 ? (
        <div className="text-center py-5 text-gray-400">
          <Users className="w-7 h-7 mx-auto mb-1.5 opacity-30" />
          <p className="text-xs">No agents assigned yet.</p>
          {canManage && (
            <button
              onClick={() => setShowAdd(true)}
              className="mt-2 text-xs text-brand-600 hover:underline"
            >
              + Add the first agent
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          {members.map(m => (
            <div
              key={m.id}
              className="flex items-center gap-3 bg-white px-3 py-2 rounded-xl border border-gray-100"
            >
              {/* Avatar */}
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-400 to-purple-500 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                {m.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              </div>

              {/* Name + email */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate leading-tight">{m.name}</p>
                <p className="text-[11px] text-gray-400 truncate">{m.email}</p>
              </div>

              {/* Role badge */}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${roleColor[m.role] ?? 'bg-gray-100 text-gray-600'}`}>
                {m.role}
              </span>

              {/* Active tickets badge */}
              <div className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${loadColor(m.active_tickets)}`}>
                <Ticket className="w-2.5 h-2.5" />
                {m.active_tickets}
              </div>

              {/* Remove button */}
              {canManage && (
                <button
                  onClick={() => {
                    if (confirm(`Remove ${m.name} from this queue?`)) removeMutation.mutate(m.id);
                  }}
                  disabled={removeMutation.isPending}
                  className="p-1 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
                  title="Remove from queue"
                >
                  <UserMinus className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Routing hint */}
      {members.length > 0 && (
        <p className="text-[10px] text-gray-400 mt-2.5 flex items-center gap-1">
          <AlertCircle className="w-3 h-3 shrink-0" />
          Tickets in this queue are routed only to these agents. Go to Settings → Routing & SLA to set per-agent limits.
        </p>
      )}

      {showAdd && (
        <AddMembersModal
          queueId={queue.id}
          queueName={queue.name}
          currentMemberIds={currentMemberIds}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}

// ── Queue row with expand/collapse ────────────────────────────────────────────

function QueueRow({
  queue,
  canManage,
  onEdit,
  onDelete,
}: {
  queue: Queue;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden transition-shadow hover:shadow-sm">
      {/* Main row */}
      <div className="flex items-center gap-4 p-4">
        {/* Colour icon */}
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: queue.color + '22' }}>
          <List className="w-5 h-5" style={{ color: queue.color }} />
        </div>

        {/* Name + description */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-gray-900">{queue.name}</p>
            {queue.is_default && (
              <span className="flex items-center gap-1 text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                <CheckCircle className="w-3 h-3" /> Default
              </span>
            )}
          </div>
          {queue.description && <p className="text-sm text-gray-500 truncate">{queue.description}</p>}
        </div>

        {/* Open tickets */}
        <div className="text-center shrink-0">
          <p className="text-lg font-bold text-gray-800">{queue.ticket_count}</p>
          <p className="text-xs text-gray-400">open tickets</p>
        </div>

        {/* Expand members toggle */}
        <button
          onClick={() => setExpanded(e => !e)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0 ${
            expanded
              ? 'bg-brand-100 text-brand-700'
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          Members
          {expanded
            ? <ChevronDown className="w-3 h-3" />
            : <ChevronRight className="w-3 h-3" />}
        </button>

        {/* Edit / Delete */}
        {canManage && (
          <div className="flex gap-1 shrink-0">
            <button
              onClick={onEdit}
              className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              onClick={onDelete}
              disabled={queue.is_default}
              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-30"
              title={queue.is_default ? 'Cannot delete the default queue' : 'Delete queue'}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Members panel — slides in when expanded */}
      {expanded && (
        <QueueMembersPanel queue={queue} canManage={canManage} />
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function TicketQueues() {
  const can = useCan();
  const qc  = useQueryClient();
  const [editing,    setEditing]    = useState<Queue | undefined>(undefined);
  const [showCreate, setShowCreate] = useState(false);

  const { data = [], isLoading } = useQuery<Queue[]>({
    queryKey: ['ticket-queues'],
    queryFn:  async () => (await api.get('/api/v1/tickets/queues')).data.data,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/tickets/queues/${id}`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['ticket-queues'] }),
  });

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <List className="w-5 h-5 text-brand-600" />
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Ticket Queues</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              Click <strong>Members</strong> on any queue to assign or remove agents.
            </p>
          </div>
        </div>
        {can.manageWorkspace && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white rounded-xl text-sm font-medium hover:bg-brand-700"
          >
            <Plus className="w-4 h-4" /> New Queue
          </button>
        )}
      </div>

      {/* Hint banner */}
      <div className="flex items-start gap-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
        <AlertCircle className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
        <p className="text-xs text-blue-700 leading-relaxed">
          Assign agents to a queue so tickets in that queue are only routed to those agents.
          If a queue has no members, the router falls back to all active agents in your workspace.
          The per-agent ticket limit and routing method are configured in <strong>Settings → Routing & SLA</strong>.
        </p>
      </div>

      {/* Queue list */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-300" /></div>
      ) : data.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <List className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No queues yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.map(q => (
            <QueueRow
              key={q.id}
              queue={q}
              canManage={can.manageWorkspace}
              onEdit={() => setEditing(q)}
              onDelete={() => { if (confirm(`Delete queue "${q.name}"?`)) deleteMutation.mutate(q.id); }}
            />
          ))}
        </div>
      )}

      {(showCreate || editing) && (
        <QueueModal
          queue={editing}
          onClose={() => { setShowCreate(false); setEditing(undefined); }}
        />
      )}
    </div>
  );
}
