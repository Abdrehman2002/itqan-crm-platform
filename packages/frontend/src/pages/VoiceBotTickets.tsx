import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bot, Mic, AlertCircle, CheckCircle2, Clock, ChevronRight,
  X, Phone, MessageSquare, Tag, User, Calendar, Loader2,
  ChevronDown, ChevronUp, PlayCircle,
} from 'lucide-react';
import { api } from '../services/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface VoiceBotTicket {
  id: string;
  ticket_number: string;
  subject: string;
  description: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed' | 'pending';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  channel: string;
  contact_name: string;
  assignee_name: string;
  queue_name: string;
  sla_due_at: string;
  is_overdue: boolean;
  created_at: string;
  voiceBotCall?: VoiceBotCall;
}

interface VoiceBotCall {
  id: string;
  provider: string;
  from_number: string;
  to_number: string;
  transcript: string;
  summary: string;
  recording_url: string;
  sentiment: 'positive' | 'neutral' | 'negative' | 'urgent';
  extracted_subject: string;
  extracted_priority: string;
  extracted_reporter_name: string;
  extracted_reporter_email: string;
  contact_name: string;
  duration_seconds: number;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PRIORITY_STYLES: Record<string, string> = {
  low:    'bg-gray-100 text-gray-600',
  medium: 'bg-blue-100 text-blue-700',
  high:   'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
};

const STATUS_STYLES: Record<string, { bg: string; icon: React.ElementType; label: string }> = {
  open:        { bg: 'bg-blue-50 text-blue-700',    icon: AlertCircle,   label: 'Open'        },
  in_progress: { bg: 'bg-brand-50 text-brand-700',  icon: Clock,         label: 'In Progress' },
  pending:     { bg: 'bg-amber-50 text-amber-700',  icon: Clock,         label: 'Pending'     },
  resolved:    { bg: 'bg-emerald-50 text-emerald-700', icon: CheckCircle2, label: 'Resolved'  },
  closed:      { bg: 'bg-gray-100 text-gray-600',   icon: CheckCircle2,  label: 'Closed'      },
};

const SENTIMENT_STYLES: Record<string, string> = {
  positive: 'bg-emerald-100 text-emerald-700',
  neutral:  'bg-gray-100 text-gray-600',
  negative: 'bg-red-100 text-red-700',
  urgent:   'bg-orange-100 text-orange-700',
};

const PROVIDER_COLORS: Record<string, string> = {
  vapi:   'bg-violet-100 text-violet-700',
  retell: 'bg-cyan-100 text-cyan-700',
  bland:  'bg-amber-100 text-amber-700',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtDuration(secs?: number) {
  if (!secs) return '—';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

// ── Ticket card ───────────────────────────────────────────────────────────────

function TicketCard({ ticket, selected, onClick }: {
  ticket: VoiceBotTicket;
  selected: boolean;
  onClick: () => void;
}) {
  const statusInfo = STATUS_STYLES[ticket.status] ?? STATUS_STYLES.open;
  const StatusIcon = statusInfo.icon;
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 border-b border-gray-100 hover:bg-gray-50 transition-colors ${selected ? 'bg-brand-50 border-l-2 border-l-brand-500' : ''}`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 p-1.5 rounded-lg bg-violet-100">
          <Bot className="w-3.5 h-3.5 text-violet-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono text-gray-400">#{ticket.ticket_number}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${PRIORITY_STYLES[ticket.priority]}`}>
              {ticket.priority}
            </span>
            {ticket.is_overdue && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">SLA breach</span>
            )}
          </div>
          <p className="text-sm font-medium text-gray-900 truncate leading-tight">{ticket.subject}</p>
          {ticket.contact_name && (
            <p className="text-xs text-gray-500 mt-0.5 truncate">{ticket.contact_name}</p>
          )}
          <div className="flex items-center gap-2 mt-2">
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${statusInfo.bg}`}>
              <StatusIcon className="w-2.5 h-2.5 inline mr-0.5" />{statusInfo.label}
            </span>
            <span className="text-xs text-gray-400">{fmtDate(ticket.created_at)}</span>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-gray-300 shrink-0 mt-1" />
      </div>
    </button>
  );
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function DetailPanel({ ticket, onClose }: { ticket: VoiceBotTicket; onClose: () => void }) {
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const qc = useQueryClient();

  const { data: detail, isLoading } = useQuery({
    queryKey: ['ticket', ticket.id],
    queryFn: () => api.get(`/api/v1/tickets/${ticket.id}`).then((r) => r.data.data),
  });

  const resolveMutation = useMutation({
    mutationFn: () => api.post(`/api/v1/tickets/${ticket.id}/resolve`, { resolution: 'Resolved via voice bot ticket view.' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vb-tickets'] }),
  });

  const call: VoiceBotCall | null = detail?.voiceBotCall ?? null;

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
      </div>
    );
  }

  const statusInfo = STATUS_STYLES[detail?.status ?? ticket.status] ?? STATUS_STYLES.open;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3 shrink-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono text-gray-400">#{ticket.ticket_number}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${statusInfo.bg}`}>
              {statusInfo.label}
            </span>
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${PRIORITY_STYLES[ticket.priority]}`}>
              {ticket.priority}
            </span>
          </div>
          <h2 className="text-sm font-semibold text-gray-900 leading-snug">{ticket.subject}</h2>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Description */}
        {ticket.description && (
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Description</h3>
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap bg-gray-50 rounded-lg p-3">
              {ticket.description}
            </p>
          </div>
        )}

        {/* Meta grid */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { icon: User,         label: 'Contact',  value: ticket.contact_name  || '—' },
            { icon: User,         label: 'Assignee', value: ticket.assignee_name || 'Unassigned' },
            { icon: Tag,          label: 'Queue',    value: ticket.queue_name    || '—' },
            { icon: Calendar,     label: 'Created',  value: fmtDate(ticket.created_at) },
            { icon: Clock,        label: 'SLA Due',  value: ticket.sla_due_at ? fmtDate(ticket.sla_due_at) : '—' },
            { icon: Bot,          label: 'Channel',  value: 'Voice Bot' },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="bg-gray-50 rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className="w-3 h-3 text-gray-400" />
                <span className="text-xs text-gray-500">{label}</span>
              </div>
              <p className="text-sm font-medium text-gray-800 truncate">{value}</p>
            </div>
          ))}
        </div>

        {/* Voice call info */}
        {call && (
          <div className="border border-violet-100 rounded-xl overflow-hidden">
            <div className="bg-violet-50 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mic className="w-4 h-4 text-violet-600" />
                <span className="text-sm font-semibold text-violet-800">Voice Call Details</span>
              </div>
              <div className="flex items-center gap-2">
                {call.provider && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium capitalize ${PROVIDER_COLORS[call.provider] ?? 'bg-gray-100 text-gray-600'}`}>
                    {call.provider}
                  </span>
                )}
                {call.sentiment && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${SENTIMENT_STYLES[call.sentiment]}`}>
                    {call.sentiment}
                  </span>
                )}
              </div>
            </div>

            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">From</p>
                  <p className="font-medium text-gray-800">{call.from_number || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Duration</p>
                  <p className="font-medium text-gray-800">{fmtDuration(call.duration_seconds)}</p>
                </div>
                {call.extracted_reporter_name && (
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">Caller Name</p>
                    <p className="font-medium text-gray-800">{call.extracted_reporter_name}</p>
                  </div>
                )}
                {call.extracted_reporter_email && (
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">Caller Email</p>
                    <p className="font-medium text-gray-800 truncate">{call.extracted_reporter_email}</p>
                  </div>
                )}
              </div>

              {/* AI Summary */}
              {call.summary && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1.5">AI Summary</p>
                  <p className="text-sm text-gray-700 bg-violet-50 rounded-lg p-3 leading-relaxed">{call.summary}</p>
                </div>
              )}

              {/* Recording */}
              {call.recording_url && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1.5">Recording</p>
                  <audio controls src={call.recording_url} className="w-full h-9" />
                </div>
              )}

              {/* Transcript toggle */}
              {call.transcript && (
                <div>
                  <button
                    onClick={() => setTranscriptOpen((o) => !o)}
                    className="flex items-center gap-1.5 text-xs font-medium text-violet-600 hover:text-violet-800"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    {transcriptOpen ? 'Hide' : 'View'} Full Transcript
                    {transcriptOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                  {transcriptOpen && (
                    <div className="mt-2 max-h-64 overflow-y-auto bg-gray-900 rounded-lg p-3">
                      <pre className="text-xs text-gray-200 whitespace-pre-wrap font-mono leading-relaxed">
                        {call.transcript}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Comments */}
        {detail?.comments?.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Comments</h3>
            <div className="space-y-2">
              {detail.comments.map((c: any) => (
                <div key={c.id} className="bg-gray-50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-700">{c.author_name_resolved}</span>
                    <span className="text-xs text-gray-400">{fmtDate(c.created_at)}</span>
                  </div>
                  <p className="text-sm text-gray-600 leading-relaxed">{c.body}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Actions footer */}
      {detail?.status !== 'resolved' && detail?.status !== 'closed' && (
        <div className="px-5 py-3 border-t border-gray-100 shrink-0">
          <button
            onClick={() => resolveMutation.mutate()}
            disabled={resolveMutation.isPending}
            className="w-full py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {resolveMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <CheckCircle2 className="w-3.5 h-3.5" />
            Mark Resolved
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function VoiceBotTickets() {
  const [selected, setSelected] = useState<VoiceBotTicket | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [priorityFilter, setPriorityFilter] = useState<string>('');
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['vb-tickets', statusFilter, priorityFilter, search],
    queryFn: () => {
      const params = new URLSearchParams({ channel: 'voice_bot', pageSize: '50' });
      if (statusFilter)   params.set('status',   statusFilter);
      if (priorityFilter) params.set('priority', priorityFilter);
      if (search)         params.set('search',   search);
      return api.get(`/api/v1/tickets?${params}`).then((r) => r.data);
    },
    refetchInterval: 30_000,
  });

  const tickets: VoiceBotTicket[] = data?.data ?? [];
  const total    = data?.meta?.total ?? tickets.length;
  const open     = tickets.filter((t) => t.status === 'open').length;
  const urgent   = tickets.filter((t) => t.priority === 'urgent').length;
  const resolved = tickets.filter((t) => ['resolved','closed'].includes(t.status)).length;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel: list */}
      <div className={`flex flex-col border-r border-gray-100 ${selected ? 'w-96 shrink-0' : 'flex-1'}`}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2 mb-3">
            <div className="p-2 bg-violet-100 rounded-lg">
              <Bot className="w-4 h-4 text-violet-600" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Voice Bot Tickets</h1>
              <p className="text-xs text-gray-400">Tickets auto-created from inbound calls</p>
            </div>
          </div>

          {/* KPI strip */}
          <div className="grid grid-cols-4 gap-2 mb-3">
            {[
              { label: 'Total',    value: total,    color: 'text-gray-700' },
              { label: 'Open',     value: open,     color: 'text-blue-600' },
              { label: 'Urgent',   value: urgent,   color: 'text-red-600' },
              { label: 'Resolved', value: resolved, color: 'text-emerald-600' },
            ].map((k) => (
              <div key={k.label} className="bg-gray-50 rounded-lg p-2 text-center">
                <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
                <p className="text-xs text-gray-400">{k.label}</p>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div className="space-y-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tickets…"
              className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400"
            />
            <div className="flex gap-2">
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-brand-400 text-gray-700">
                <option value="">All statuses</option>
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="pending">Pending</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </select>
              <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}
                className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-brand-400 text-gray-700">
                <option value="">All priorities</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>
        </div>

        {/* Ticket list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 text-brand-400 animate-spin" />
            </div>
          ) : tickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center px-6">
              <div className="p-3 bg-violet-100 rounded-xl mb-3">
                <Bot className="w-6 h-6 text-violet-500" />
              </div>
              <p className="text-sm font-medium text-gray-700 mb-1">No voice bot tickets yet</p>
              <p className="text-xs text-gray-400">Tickets will appear here when customers call your helpline and the AI bot creates them automatically.</p>
            </div>
          ) : (
            tickets.map((ticket) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                selected={selected?.id === ticket.id}
                onClick={() => setSelected(selected?.id === ticket.id ? null : ticket)}
              />
            ))
          )}
        </div>
      </div>

      {/* Right panel: detail */}
      {selected && <DetailPanel ticket={selected} onClose={() => setSelected(null)} />}

      {/* Empty state when no selection on wide screen */}
      {!selected && !isLoading && tickets.length > 0 && (
        <div className="flex-1 flex items-center justify-center text-center px-8">
          <div>
            <div className="p-4 bg-violet-50 rounded-2xl mb-4 inline-block">
              <Bot className="w-8 h-8 text-violet-400" />
            </div>
            <p className="text-sm text-gray-500">Select a ticket to view details and transcript</p>
          </div>
        </div>
      )}
    </div>
  );
}
