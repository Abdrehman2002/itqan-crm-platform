/**
 * Voice Bot Calls page
 *
 * Lists all inbound calls received by the AI voice bot with:
 *  • KPI strip — total calls, tickets created, negative/urgent sentiment counts
 *  • Call cards with: caller number, duration, sentiment badge, summary preview,
 *    transcript snippet, linked ticket badge, provider tag
 *  • Filters: provider, sentiment, has/no ticket, search (number or summary)
 *  • Detail panel: full transcript, AI summary, recording player (if available),
 *    extracted ticket data, "Create Ticket" button if none exists, linked ticket link
 *  • Tabs: All | Has Ticket | No Ticket | Urgent
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Phone, Clock, Ticket, AlertCircle, CheckCircle2, Mic,
  Search, Loader2, X, ExternalLink, Plus, ChevronDown,
  PhoneIncoming, FileText, User,
} from 'lucide-react';
import { api } from '../services/api';

// ── Types ─────────────────────────────────────────────────────────────────

interface BotCall {
  id: string;
  provider: string;
  provider_call_id?: string;
  from_number?: string;
  to_number?: string;
  duration_seconds?: number;
  status: string;
  transcript?: string;
  summary?: string;
  recording_url?: string;
  sentiment?: 'positive' | 'neutral' | 'negative' | 'urgent';
  extracted_subject?: string;
  extracted_priority?: string;
  extracted_reporter_name?: string;
  extracted_reporter_email?: string;
  contact_name?: string;
  contact_email?: string;
  ticket_id?: string;
  ticket_number?: string;
  ticket_status?: string;
  ticket_priority?: string;
  ticket_subject?: string;
  assignee_name?: string;
  created_at: string;
}

// ── Sentiment config ──────────────────────────────────────────────────────

const SENTIMENT_CFG = {
  positive: { label: 'Positive', color: 'text-emerald-400', bg: 'bg-emerald-900/40 border-emerald-700/50', dot: 'bg-emerald-400' },
  neutral:  { label: 'Neutral',  color: 'text-gray-400',    bg: 'bg-gray-800/60 border-gray-700/50',       dot: 'bg-gray-400'    },
  negative: { label: 'Negative', color: 'text-red-400',     bg: 'bg-red-900/40 border-red-700/50',         dot: 'bg-red-400'     },
  urgent:   { label: 'Urgent',   color: 'text-orange-400',  bg: 'bg-orange-900/40 border-orange-700/50',   dot: 'bg-orange-400'  },
};

function SentimentBadge({ sentiment }: { sentiment?: string }) {
  const cfg = SENTIMENT_CFG[sentiment as keyof typeof SENTIMENT_CFG] ?? SENTIMENT_CFG.neutral;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[11px] font-semibold border ${cfg.bg} ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

const PRIORITY_CFG = {
  urgent: 'text-red-400 bg-red-900/40 border-red-700/50',
  high:   'text-orange-400 bg-orange-900/40 border-orange-700/50',
  medium: 'text-yellow-400 bg-yellow-900/40 border-yellow-700/50',
  low:    'text-gray-400 bg-gray-800/60 border-gray-700/50',
};

function PriorityBadge({ priority }: { priority?: string }) {
  if (!priority) return null;
  const cls = PRIORITY_CFG[priority as keyof typeof PRIORITY_CFG] ?? PRIORITY_CFG.medium;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-semibold border capitalize ${cls}`}>
      {priority}
    </span>
  );
}

function ProviderBadge({ provider }: { provider: string }) {
  const map: Record<string, string> = { vapi: '#7c3aed', retell: '#0891b2', bland: '#059669' };
  return (
    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full text-white"
          style={{ background: map[provider] ?? '#6b7280' }}>
      {provider}
    </span>
  );
}

function fmtDuration(secs?: number): string {
  if (!secs) return '—';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function ago(d: string): string {
  const diff = Date.now() - new Date(d).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(d).toLocaleDateString();
}

// ── Call card ─────────────────────────────────────────────────────────────

function CallCard({ call, selected, onClick }: { call: BotCall; selected: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className={`px-5 py-4 border-b border-white/5 cursor-pointer transition-colors hover:bg-white/5 ${
        selected ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Avatar / sentiment indicator */}
        <div className={`w-9 h-9 rounded-xl shrink-0 flex items-center justify-center mt-0.5 ${
          call.sentiment === 'urgent'   ? 'bg-orange-900/60' :
          call.sentiment === 'negative' ? 'bg-red-900/60'    :
          call.sentiment === 'positive' ? 'bg-emerald-900/60': 'bg-gray-800/60'
        }`}>
          <PhoneIncoming className={`w-4 h-4 ${
            call.sentiment === 'urgent'   ? 'text-orange-400' :
            call.sentiment === 'negative' ? 'text-red-400'    :
            call.sentiment === 'positive' ? 'text-emerald-400': 'text-gray-400'
          }`} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-sm font-semibold text-white truncate">
              {call.extracted_reporter_name ?? call.contact_name ?? call.from_number ?? 'Unknown caller'}
            </span>
            <span className="text-[10px] text-gray-500 shrink-0">{ago(call.created_at)}</span>
          </div>

          {/* Summary */}
          {call.extracted_subject ? (
            <p className="text-sm text-gray-300 truncate mb-2">{call.extracted_subject}</p>
          ) : call.summary ? (
            <p className="text-xs text-gray-500 truncate mb-2 italic">{call.summary.slice(0, 100)}</p>
          ) : null}

          <div className="flex items-center gap-2 flex-wrap">
            <ProviderBadge provider={call.provider} />
            <SentimentBadge sentiment={call.sentiment} />
            {call.extracted_priority && <PriorityBadge priority={call.extracted_priority} />}

            {/* Duration */}
            <span className="flex items-center gap-1 text-[10px] text-gray-600">
              <Clock className="w-3 h-3" />{fmtDuration(call.duration_seconds)}
            </span>

            {/* Ticket badge */}
            {call.ticket_id ? (
              <span className="flex items-center gap-1 text-[10px] text-brand-400 bg-brand-900/40 border border-brand-700/50 px-2 py-0.5 rounded-full font-semibold">
                <Ticket className="w-3 h-3" />{call.ticket_number}
              </span>
            ) : (
              <span className="text-[10px] text-gray-600">No ticket</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Detail panel ──────────────────────────────────────────────────────────

function CallPanel({ callId, onClose }: { callId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [showFullTranscript, setShowFullTranscript] = useState(false);

  const { data, isLoading } = useQuery<BotCall>({
    queryKey: ['voice-bot-call', callId],
    queryFn: async () => { const r = await api.get(`/api/v1/voice-bot/calls/${callId}`); return r.data.data; },
  });

  const createTicketMut = useMutation({
    mutationFn: async () => {
      const r = await api.post(`/api/v1/voice-bot/calls/${callId}/ticket`);
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['voice-bot-calls'] });
      qc.invalidateQueries({ queryKey: ['voice-bot-call', callId] });
    },
  });

  return (
    <div className="w-[420px] shrink-0 border-l border-white/10 flex flex-col h-full"
         style={{ background: '#0d1117' }}>

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
        <h3 className="text-white font-semibold text-sm">Call Detail</h3>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 p-1 rounded transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-brand-400" />
        </div>
      ) : data ? (
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Caller info + badges */}
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center bg-gray-800/60">
              <User className="w-5 h-5 text-gray-400" />
            </div>
            <div>
              <p className="text-white font-semibold">
                {data.extracted_reporter_name ?? data.contact_name ?? data.from_number ?? 'Unknown'}
              </p>
              <p className="text-xs text-gray-500">{data.from_number ?? ''}</p>
              {data.extracted_reporter_email && (
                <p className="text-xs text-gray-500">{data.extracted_reporter_email}</p>
              )}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <ProviderBadge provider={data.provider} />
                <SentimentBadge sentiment={data.sentiment} />
                {data.extracted_priority && <PriorityBadge priority={data.extracted_priority} />}
              </div>
            </div>
          </div>

          {/* Metadata grid */}
          <div className="rounded-xl border border-white/10 overflow-hidden">
            {[
              { label: 'Called',    value: new Date(data.created_at).toLocaleString() },
              { label: 'Duration',  value: fmtDuration(data.duration_seconds) },
              { label: 'Helpline',  value: data.to_number ?? '—' },
              { label: 'Provider',  value: data.provider },
              ...(data.contact_name ? [{ label: 'Contact', value: data.contact_name }] : []),
            ].map(({ label, value }) => (
              <div key={label} className="flex gap-3 px-4 py-2.5 border-b border-white/5 last:border-0">
                <span className="text-xs text-gray-500 w-20 shrink-0 pt-0.5">{label}</span>
                <span className="text-xs text-gray-200">{value}</span>
              </div>
            ))}
          </div>

          {/* Recording */}
          {data.recording_url && (
            <div>
              <p className="text-xs text-gray-500 mb-2 font-semibold uppercase tracking-wide flex items-center gap-1">
                <Mic className="w-3 h-3" /> Recording
              </p>
              <audio controls src={data.recording_url} className="w-full h-8 rounded-lg" />
            </div>
          )}

          {/* AI Summary */}
          {data.summary && (
            <div>
              <p className="text-xs text-gray-500 mb-2 font-semibold uppercase tracking-wide flex items-center gap-1">
                <FileText className="w-3 h-3" /> AI Summary
              </p>
              <div className="p-3 rounded-xl border border-white/10 text-sm text-gray-300"
                   style={{ background: 'rgba(41,171,226,0.05)' }}>
                {data.summary}
              </div>
            </div>
          )}

          {/* Transcript */}
          {data.transcript && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Transcript</p>
                <button onClick={() => setShowFullTranscript(!showFullTranscript)}
                  className="text-[10px] text-brand-400 hover:text-brand-300 flex items-center gap-1">
                  {showFullTranscript ? 'Collapse' : 'Expand'}
                  <ChevronDown className={`w-3 h-3 transition-transform ${showFullTranscript ? 'rotate-180' : ''}`} />
                </button>
              </div>
              <pre className={`text-xs text-gray-400 rounded-xl border border-white/10 p-3 font-sans whitespace-pre-wrap overflow-auto
                ${showFullTranscript ? 'max-h-96' : 'max-h-32'} transition-all`}
                   style={{ background: 'rgba(255,255,255,0.02)' }}>
                {data.transcript}
              </pre>
            </div>
          )}

          {/* Linked ticket */}
          {data.ticket_id ? (
            <div className="rounded-xl border border-brand-700/40 p-4"
                 style={{ background: 'rgba(41,171,226,0.05)' }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Ticket className="w-4 h-4 text-brand-400" />
                  <span className="text-sm text-white font-semibold">{data.ticket_number}</span>
                </div>
                <a href="/tickets" className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1">
                  View <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              {data.ticket_subject && (
                <p className="text-xs text-gray-400 mb-2">{data.ticket_subject}</p>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                {data.ticket_status && (
                  <span className="text-[10px] text-gray-400 capitalize border border-white/10 px-2 py-0.5 rounded-full">
                    {data.ticket_status}
                  </span>
                )}
                {data.ticket_priority && <PriorityBadge priority={data.ticket_priority} />}
                {data.assignee_name && (
                  <span className="text-[10px] text-gray-500">→ {data.assignee_name}</span>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-gray-700/50 p-4 flex flex-col items-center gap-3">
              <Ticket className="w-6 h-6 text-gray-600" />
              <p className="text-sm text-gray-500">No ticket created yet</p>
              <button
                onClick={() => createTicketMut.mutate()}
                disabled={createTicketMut.isPending}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #1a8cbf 100%)' }}
              >
                {createTicketMut.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Plus className="w-4 h-4" />}
                {createTicketMut.isPending ? 'Creating…' : 'Create Ticket from Call'}
              </button>
              {createTicketMut.isSuccess && (
                <p className="text-xs text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Ticket created successfully
                </p>
              )}
              {createTicketMut.isError && (
                <p className="text-xs text-red-400">Failed to create ticket</p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">Call not found</div>
      )}
    </div>
  );
}

// ── Stats strip ───────────────────────────────────────────────────────────

function KpiStrip({ calls }: { calls: BotCall[] }) {
  const total    = calls.length;
  const withTkt  = calls.filter(c => c.ticket_id).length;
  const urgent   = calls.filter(c => c.sentiment === 'urgent').length;
  const negative = calls.filter(c => c.sentiment === 'negative').length;
  const noTkt    = calls.filter(c => !c.ticket_id).length;

  return (
    <div className="grid grid-cols-5 gap-3 px-6 pt-5 pb-4 shrink-0">
      {[
        { label: 'Total calls',       value: total,    color: 'text-white'        },
        { label: 'Tickets created',   value: withTkt,  color: 'text-brand-400'    },
        { label: 'Pending triage',    value: noTkt,    color: 'text-yellow-400'   },
        { label: 'Urgent sentiment',  value: urgent,   color: 'text-orange-400'   },
        { label: 'Negative calls',    value: negative, color: 'text-red-400'      },
      ].map(({ label, value, color }) => (
        <div key={label} className="rounded-xl px-4 py-3 border border-white/10"
             style={{ background: 'rgba(255,255,255,0.03)' }}>
          <p className={`text-xl font-bold ${color}`}>{value}</p>
          <p className="text-xs text-gray-500 mt-0.5">{label}</p>
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

const TABS = [
  { id: '',      label: 'All' },
  { id: 'true',  label: 'Has Ticket' },
  { id: 'false', label: 'No Ticket'  },
];

export function VoiceBotCalls() {
  const [selectedId, setSelected] = useState<string | null>(null);
  const [search, setSearch]       = useState('');
  const [provider, setProvider]   = useState('');
  const [sentiment, setSentiment] = useState('');
  const [hasTicket, setHasTicket] = useState('');
  const [page, setPage]           = useState(1);

  const { data, isLoading, isFetching } = useQuery<{ data: BotCall[]; meta: { total: number } }>({
    queryKey: ['voice-bot-calls', provider, sentiment, hasTicket, search, page],
    queryFn: async () => {
      const params = new URLSearchParams({
        pageSize: '30', page: String(page),
        ...(provider  ? { provider }  : {}),
        ...(sentiment ? { sentiment } : {}),
        ...(hasTicket !== '' ? { hasTicket } : {}),
        ...(search    ? { search }    : {}),
      });
      const r = await api.get(`/api/v1/voice-bot/calls?${params}`);
      return r.data;
    },
    staleTime: 15_000,
  });

  const calls = data?.data ?? [];
  const total = data?.meta?.total ?? 0;

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0d1117' }}>

      {/* ── Main list ──────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                 style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #4D8B3C 100%)' }}>
              <Phone className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-white font-bold text-lg leading-tight">Bot Calls</h1>
              <p className="text-gray-500 text-xs">{total} inbound call{total !== 1 ? 's' : ''} from AI voice bot</p>
            </div>
          </div>
          <a href="/voice-bot"
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs text-brand-300 border border-brand-700/50 hover:bg-brand-900/30 transition-colors">
            Bot Settings
          </a>
        </div>

        {/* KPI strip */}
        <KpiStrip calls={calls} />

        {/* Filters */}
        <div className="px-6 pb-3 border-b border-white/10 flex items-center gap-3 shrink-0">
          {/* Tabs */}
          <div className="flex items-center gap-1 p-1 rounded-xl border border-white/10"
               style={{ background: 'rgba(255,255,255,0.03)' }}>
            {TABS.map(t => (
              <button key={t.id}
                onClick={() => { setHasTicket(t.id); setPage(1); }}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  hasTicket === t.id ? 'bg-brand-600 text-white' : 'text-gray-400 hover:text-white'
                }`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <input type="text" placeholder="Search by number or summary…"
              value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="pl-9 pr-4 py-2 bg-gray-900/60 border border-gray-700/60 text-gray-300 placeholder-gray-600 rounded-xl text-xs outline-none focus:border-brand-500/60 w-56" />
          </div>

          {/* Provider filter */}
          <select value={provider} onChange={e => { setProvider(e.target.value); setPage(1); }}
            className="px-3 py-2 bg-gray-900/60 border border-gray-700/60 text-gray-400 rounded-xl text-xs outline-none appearance-none">
            <option value="">All providers</option>
            <option value="vapi">Vapi</option>
            <option value="retell">Retell</option>
            <option value="bland">Bland</option>
          </select>

          {/* Sentiment filter */}
          <select value={sentiment} onChange={e => { setSentiment(e.target.value); setPage(1); }}
            className="px-3 py-2 bg-gray-900/60 border border-gray-700/60 text-gray-400 rounded-xl text-xs outline-none appearance-none">
            <option value="">All sentiments</option>
            <option value="urgent">Urgent</option>
            <option value="negative">Negative</option>
            <option value="neutral">Neutral</option>
            <option value="positive">Positive</option>
          </select>

          {isFetching && !isLoading && (
            <Loader2 className="w-4 h-4 animate-spin text-brand-400" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 animate-spin text-brand-400" />
            </div>
          ) : calls.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                   style={{ background: 'rgba(41,171,226,0.1)' }}>
                <Phone className="w-8 h-8 text-brand-400/50" />
              </div>
              <div className="text-center">
                <p className="text-gray-400 font-medium">No calls yet</p>
                <p className="text-gray-600 text-sm mt-1">
                  {search || provider || sentiment || hasTicket
                    ? 'Try changing your filters'
                    : 'Voice bot calls will appear here after your first inbound call'}
                </p>
              </div>
              {!search && !provider && !sentiment && !hasTicket && (
                <a href="/voice-bot"
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
                  style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #1a8cbf 100%)' }}>
                  Configure Voice Bot
                </a>
              )}
            </div>
          ) : (
            <>
              {calls.map(c => (
                <CallCard key={c.id} call={c} selected={selectedId === c.id}
                  onClick={() => setSelected(selectedId === c.id ? null : c.id)} />
              ))}
              {total > 30 && (
                <div className="flex items-center justify-center gap-3 py-4 border-t border-white/5">
                  <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                    className="px-3 py-1.5 rounded-lg text-xs text-gray-400 disabled:opacity-30 hover:bg-white/5 border border-white/10 transition-colors">
                    ← Prev
                  </button>
                  <span className="text-xs text-gray-500">
                    Page {page} of {Math.ceil(total / 30)}
                  </span>
                  <button disabled={page >= Math.ceil(total / 30)} onClick={() => setPage(p => p + 1)}
                    className="px-3 py-1.5 rounded-lg text-xs text-gray-400 disabled:opacity-30 hover:bg-white/5 border border-white/10 transition-colors">
                    Next →
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Detail panel ─────────────────────────────────────────── */}
      {selectedId && (
        <CallPanel callId={selectedId} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
