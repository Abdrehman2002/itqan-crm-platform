/**
 * Tickets — Manual ticket dashboard
 *
 * Shows only channel = 'manual' tickets.
 * Voice-bot auto-created tickets have their own page (VoiceTickets).
 *
 * Layout:
 *  ┌─────────────────────────────────────────────────┐
 *  │ 6 KPI cards: created / pending / within-TAT /   │
 *  │              breached-TAT / escalated / resolved │
 *  ├─────────────────────────────────────────────────┤
 *  │ Tabs: All · Open · Assigned · In Progress ·      │
 *  │       Pending · Resolved                         │
 *  ├─────────────────────────────────────────────────┤
 *  │ 2-column card grid — each card shows:            │
 *  │  • Ticket # + priority badge + status + date     │
 *  │  • Reporter name / contact                       │
 *  │  • Reason (subject)                              │
 *  │  • Brief description                             │
 *  │  • Assigned to                                   │
 *  │  • SLA countdown bar                             │
 *  │  • Action buttons                                │
 *  └─────────────────────────────────────────────────┘
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Search, Clock, CheckCircle, AlertTriangle,
  User, Loader2, X, Send, Lock, MessageSquare,
  ArrowUpCircle, CheckCheck, UserCheck, Filter,
  LifeBuoy, PhoneCall, ChevronRight,
  Calendar, TrendingUp, ShieldAlert, Timer,
  Circle, ArrowRightLeft, CornerUpLeft, StickyNote,
  Reply,
} from 'lucide-react';
import { api } from '../services/api';
import { useCan } from '../hooks/useRole';

// ── Types ──────────────────────────────────────────────────────────────────
interface Ticket {
  id: string;
  ticket_number: string;
  subject: string;
  description?: string;
  status: string;
  priority: string;
  channel: string;
  assignee_id?: string;
  assignee_name?: string;
  contact_name?: string;
  queue_name?: string;
  queue_color?: string;
  reporter_name?: string;
  reporter_email?: string;
  reporter_phone?: string;
  sla_due_at?: string;
  sla_seconds_remaining?: number;
  is_overdue: boolean;
  escalation_level: number;
  accepted_at?: string;
  resolved_at?: string;
  created_at: string;
}

interface Comment {
  id: string;
  body: string;
  is_internal: boolean;
  comment_type: 'reply' | 'remark' | 'note';
  author_name_resolved?: string;
  author_role?: string;
  created_at: string;
  // WhatsApp-style reply quote
  reply_to_id?: string;
  reply_to_body?: string;
  reply_to_created_at?: string;
  reply_to_author_name?: string;
}
interface TicketDetail extends Ticket {
  comments: Comment[];
  escalations: any[];
  // Warm-transfer fields
  prev_assignee_id?: string;
  prev_assignee_name?: string;
  manager_overridden_by?: string;
  manager_overridden_by_name?: string;
  manager_overridden_at?: string;
  manager_override_note?: string;
  age_seconds?: number;
}

interface Stats {
  total: string;
  open: string;
  assigned: string;
  in_progress: string;
  pending: string;
  resolved: string;
  mine: string;
  overdue: string;
}
interface Queue { id: string; name: string; color: string }

// ── Config ─────────────────────────────────────────────────────────────────
const PRIORITY_CFG: Record<string, { label: string; dot: string; card: string; badge: string }> = {
  urgent: {
    label: 'Urgent',
    dot: 'bg-red-500',
    card: 'border-red-500/40 bg-red-950/10',
    badge: 'bg-red-900/60 text-red-300 border border-red-700/50',
  },
  high: {
    label: 'High',
    dot: 'bg-orange-400',
    card: 'border-orange-500/40 bg-orange-950/10',
    badge: 'bg-orange-900/60 text-orange-300 border border-orange-700/50',
  },
  medium: {
    label: 'Medium',
    dot: 'bg-blue-400',
    card: 'border-blue-500/30 bg-blue-950/10',
    badge: 'bg-blue-900/60 text-blue-300 border border-blue-700/50',
  },
  low: {
    label: 'Low',
    dot: 'bg-gray-400',
    card: 'border-gray-200 bg-gray-50',
    badge: 'bg-gray-100 text-gray-500 border border-gray-200',
  },
};

const STATUS_CFG: Record<string, { label: string; badge: string; dot: string }> = {
  open:        { label: 'Open',        badge: 'bg-sky-900/60 text-sky-300 border border-sky-700/50',          dot: 'bg-sky-400'    },
  assigned:    { label: 'Assigned',    badge: 'bg-amber-900/60 text-amber-300 border border-amber-700/50',    dot: 'bg-amber-400'  },
  accepted:    { label: 'Accepted',    badge: 'bg-brand-900/60 text-brand-300 border border-brand-700/50', dot: 'bg-brand-400' },
  in_progress: { label: 'In Progress', badge: 'bg-brand-900/60 text-vivid-green-300 border border-brand-600/50', dot: 'bg-brand-300' },
  pending:     { label: 'Pending',     badge: 'bg-yellow-900/60 text-yellow-300 border border-yellow-700/50', dot: 'bg-yellow-400' },
  resolved:    { label: 'Resolved',    badge: 'bg-emerald-900/60 text-emerald-300 border border-emerald-700/50',dot:'bg-emerald-400'},
  closed:      { label: 'Closed',      badge: 'bg-gray-100 text-gray-500 border border-gray-200',       dot: 'bg-gray-400'   },
};

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtTime(d: string) {
  return new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}
function fmtSla(secs: number | undefined, overdue: boolean) {
  if (secs === undefined) return null;
  if (overdue) {
    const m = Math.abs(Math.floor(secs / 60));
    return { text: `${m}m overdue`, cls: 'text-red-400', pct: 100 };
  }
  const hrs  = Math.floor(secs / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  const text = hrs > 0 ? `${hrs}h ${mins}m left` : `${mins}m left`;
  const cls  = secs < 3600 ? 'text-orange-400' : secs < 7200 ? 'text-yellow-400' : 'text-emerald-400';
  return { text, cls, pct: Math.max(0, Math.min(100, 100 - (secs / 86400) * 100)) };
}

// ── KPI card ───────────────────────────────────────────────────────────────
function KpiCard({
  label, value, sub, icon: Icon, accent, onClick, active,
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; accent: string; onClick?: () => void; active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative text-left rounded-2xl border p-4 transition-all ${
        active
          ? 'border-brand-500 bg-brand-950/40 ring-1 ring-brand-500/30'
          : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className={`p-1.5 rounded-lg ${accent}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <p className={`text-2xl font-bold ${active ? 'text-white' : 'text-gray-900'}`}>{value}</p>
      <p className="text-xs font-medium text-gray-400 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </button>
  );
}

// ── SLA progress bar ───────────────────────────────────────────────────────
function SlaBar({ ticket }: { ticket: Ticket }) {
  if (!ticket.sla_due_at) return (
    <div className="flex items-center gap-1.5 text-xs text-gray-500">
      <Clock className="w-3 h-3" /> No SLA set
    </div>
  );
  if (['resolved','closed'].includes(ticket.status)) return (
    <div className="flex items-center gap-1.5 text-xs text-emerald-500">
      <CheckCircle className="w-3 h-3" /> Resolved
    </div>
  );

  const info = fmtSla(ticket.sla_seconds_remaining, ticket.is_overdue);
  if (!info) return null;
  const barCls = ticket.is_overdue ? 'bg-red-500' : info.pct > 80 ? 'bg-orange-500' : info.pct > 50 ? 'bg-yellow-500' : 'bg-emerald-500';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className={`text-xs font-medium flex items-center gap-1 ${info.cls}`}>
          <Timer className="w-3 h-3" />
          {ticket.is_overdue ? 'TAT Breached' : 'TAT Remaining'}
        </span>
        <span className={`text-xs font-semibold ${info.cls}`}>{info.text}</span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barCls}`} style={{ width: `${info.pct}%` }} />
      </div>
    </div>
  );
}

// ── Ticket card ────────────────────────────────────────────────────────────
function TicketCard({
  ticket, onOpen, onAccept, onResolve,
}: {
  ticket: Ticket;
  onOpen: (id: string) => void;
  onAccept: (id: string) => void;
  onResolve: (id: string) => void;
}) {
  const can = useCan();
  const pc  = PRIORITY_CFG[ticket.priority] ?? PRIORITY_CFG.medium;
  const sc  = STATUS_CFG[ticket.status]     ?? STATUS_CFG.open;

  const canAccept  = can.writeRecords && ['open','assigned'].includes(ticket.status);
  const canResolve = can.writeRecords && ['accepted','in_progress','pending'].includes(ticket.status);

  return (
    <div className={`relative rounded-2xl border p-5 flex flex-col gap-4 transition-all hover:border-opacity-70 ${pc.card}`}>
      {/* Escalation glow */}
      {ticket.escalation_level >= 2 && (
        <div className="absolute inset-0 rounded-2xl ring-2 ring-red-500/40 pointer-events-none" />
      )}

      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-xs font-bold text-gray-400 tracking-widest">
            {ticket.ticket_number}
          </span>
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${sc.badge}`}>
            <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${sc.dot}`} />
            {sc.label}
          </span>
          {ticket.escalation_level >= 2 && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-900/80 text-red-300 border border-red-600/50">
              <ShieldAlert className="w-3 h-3" /> Escalated
            </span>
          )}
          {ticket.escalation_level === 1 && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-orange-900/60 text-orange-300 border border-orange-700/50">
              <ArrowUpCircle className="w-3 h-3" /> L1 Escalation
            </span>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-gray-400">{fmtDate(ticket.created_at)}</p>
          <p className="text-xs text-gray-500">{fmtTime(ticket.created_at)}</p>
        </div>
      </div>

      {/* Reporter */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-xl p-3">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1">
            <User className="w-3 h-3" /> Reporter
          </p>
          <p className="text-sm font-semibold text-gray-800 truncate">
            {ticket.reporter_name || ticket.contact_name?.trim() || 'Unknown'}
          </p>
          {ticket.reporter_email && (
            <p className="text-xs text-gray-400 truncate">{ticket.reporter_email}</p>
          )}
          {ticket.reporter_phone && (
            <p className="text-xs text-gray-400">{ticket.reporter_phone}</p>
          )}
        </div>

        <div className="bg-white rounded-xl p-3">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1">
            <UserCheck className="w-3 h-3" /> Assigned To
          </p>
          {ticket.assignee_name ? (
            <>
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-brand-600 flex items-center justify-center text-[10px] font-bold text-white shrink-0">
                  {ticket.assignee_name[0].toUpperCase()}
                </div>
                <p className="text-sm font-semibold text-gray-800 truncate">{ticket.assignee_name}</p>
              </div>
              {ticket.accepted_at && (
                <p className="text-xs text-gray-400 mt-0.5">
                  Accepted {fmtDate(ticket.accepted_at)}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-500 italic">Unassigned</p>
          )}
        </div>
      </div>

      {/* Reason / Subject */}
      <div className="bg-white rounded-xl p-3">
        <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
          <MessageSquare className="w-3 h-3" /> Reason
        </p>
        <p className="text-sm font-semibold text-gray-900 leading-snug">{ticket.subject}</p>
        {ticket.description && (
          <p className="text-xs text-gray-400 mt-1.5 leading-relaxed line-clamp-2">
            {ticket.description}
          </p>
        )}
      </div>

      {/* Priority + Queue row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 ${pc.badge}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${pc.dot}`} />
          {pc.label} Priority
        </span>
        {ticket.queue_name && (
          <span className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-gray-100 text-gray-500 border border-gray-200">
            {ticket.queue_name}
          </span>
        )}
      </div>

      {/* SLA bar */}
      <SlaBar ticket={ticket} />


          {/* Milestone progress bar */}
          {ticket.milestones && ticket.milestones.length > 0 && (() => {
            const total = ticket.milestones.length;
            const done  = ticket.milestones.filter((m: any) => m.completed).length;
            const pct   = Math.round((done / total) * 100);
            return (
              <div className="mt-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-gray-400 font-medium">Progress</span>
                  <span className="text-[10px] text-gray-500">{done}/{total} steps</span>
                </div>
                <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-green-500' : 'bg-brand-500'}`}
                       style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })()}
      {/* Action buttons */}
      <div className="flex gap-2 pt-1">
        {canAccept && (
          <button
            onClick={(e) => { e.stopPropagation(); onAccept(ticket.id); }}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold bg-brand-600/80 text-white hover:bg-brand-600 border border-brand-500/50 transition-colors"
          >
            <CheckCircle className="w-3.5 h-3.5" /> Accept
          </button>
        )}
        {canResolve && (
          <button
            onClick={(e) => { e.stopPropagation(); onResolve(ticket.id); }}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold bg-emerald-700/60 text-emerald-200 hover:bg-emerald-700/80 border border-emerald-600/40 transition-colors"
          >
            <CheckCheck className="w-3.5 h-3.5" /> Mark Resolved
          </button>
        )}
        <button
          onClick={() => onOpen(ticket.id)}
          className="px-3 py-2 rounded-xl text-xs font-semibold bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200 transition-colors flex items-center gap-1"
        >
          View <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Create ticket modal ────────────────────────────────────────────────────
function CreateTicketModal({ queues, onClose }: { queues: Queue[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    subject: '', description: '', priority: 'medium',
    queueId: '', reporterName: '', reporterEmail: '', reporterPhone: '',
    reporterWhatsapp: '', preferredChannel: 'email' as 'email' | 'sms' | 'whatsapp',
  });

  const mutation = useMutation({
    mutationFn: () => api.post('/api/v1/tickets', {
      subject:       form.subject,
      description:   form.description || undefined,
      priority:      form.priority,
      channel:       'manual',
      queueId:       form.queueId       || undefined,
      reporterName:     form.reporterName     || undefined,
      reporterEmail:    form.reporterEmail    || undefined,
      reporterPhone:     form.reporterPhone     || undefined,
      reporterWhatsapp:  form.reporterWhatsapp  || undefined,
      preferredChannel:  form.preferredChannel,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['ticket-stats'] });
      onClose();
    },
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-white border border-gray-200 rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <LifeBuoy className="w-4 h-4 text-brand-400" /> New Support Ticket
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-500 p-1"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-4">
          {/* Reporter section */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Reporter Details</p>
            <div className="grid grid-cols-2 gap-3">
              <input value={form.reporterName} onChange={set('reporterName')} placeholder="Full Name"
                className="col-span-2 bg-white border border-gray-200 text-gray-900 placeholder-gray-400 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand-400" />
              <input value={form.reporterEmail} onChange={set('reporterEmail')} placeholder="Email address" type="email"
                className="bg-white border border-gray-200 text-gray-900 placeholder-gray-400 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand-400" />
              <input value={form.reporterPhone} onChange={set('reporterPhone')} placeholder="Phone / SMS number"
                className="bg-white border border-gray-200 text-gray-900 placeholder-gray-400 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand-400" />
              <input value={form.reporterWhatsapp} onChange={set('reporterWhatsapp')} placeholder="WhatsApp number (if different)"
                className="col-span-2 bg-white border border-gray-200 text-gray-900 placeholder-gray-400 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand-400" />
            </div>
          </div>

          {/* Preferred response channel */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Preferred Response Channel</p>
            <p className="text-xs text-gray-400 mb-2">How would the customer like to receive replies?</p>
            <div className="grid grid-cols-3 gap-2">
              {([
                { val: 'email',    label: 'Email',    icon: '✉️',  desc: 'Reply by email' },
                { val: 'sms',      label: 'SMS',      icon: '💬',  desc: 'Text message' },
                { val: 'whatsapp', label: 'WhatsApp', icon: '📱',  desc: 'WhatsApp message' },
              ] as const).map(({ val, label, icon, desc }) => (
                <button key={val} type="button"
                  onClick={() => setForm(f => ({ ...f, preferredChannel: val }))}
                  className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all text-center ${
                    form.preferredChannel === val
                      ? 'border-brand-500 bg-brand-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}>
                  <span className="text-lg">{icon}</span>
                  <span className={`text-xs font-semibold ${form.preferredChannel === val ? 'text-brand-700' : 'text-gray-700'}`}>{label}</span>
                  <span className="text-[10px] text-gray-400">{desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Issue section */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Issue Details</p>
            <input value={form.subject} onChange={set('subject')} placeholder="Reason / Subject *"
              className="w-full bg-white border border-gray-200 text-gray-900 placeholder-gray-400 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand-500/60 mb-3" />
            <textarea value={form.description} onChange={set('description')} rows={3} placeholder="Describe the problem in detail…"
              className="w-full bg-white border border-gray-200 text-gray-900 placeholder-gray-400 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand-500/60 resize-none" />
          </div>

          {/* Priority + Queue */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-medium text-gray-400 mb-1.5">Priority</p>
              <div className="flex gap-1.5 flex-wrap">
                {(['urgent','high','medium','low'] as const).map(p => (
                  <button key={p} onClick={() => setForm(f => ({ ...f, priority: p }))}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                      form.priority === p ? PRIORITY_CFG[p].badge : 'border-gray-200 text-gray-400 hover:border-gray-300'
                    }`}>
                    {PRIORITY_CFG[p].label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-400 mb-1.5">Queue</p>
              <select value={form.queueId} onChange={set('queueId')}
                className="w-full bg-white border border-gray-200 text-gray-700 rounded-xl px-3 py-2 text-sm outline-none focus:border-brand-500/60">
                <option value="">Default queue</option>
                {queues.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="px-6 pb-5 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-500 hover:bg-gray-50">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={!form.subject || mutation.isPending}
            className="flex-1 py-2.5 bg-brand-600 text-white rounded-xl text-sm font-semibold hover:bg-brand-500 disabled:opacity-40 flex items-center justify-center gap-2">
            {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Create Ticket
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtAge(seconds: number): string {
  if (seconds < 60)    return `${Math.floor(seconds)}s`;
  if (seconds < 3600)  return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

function fmtExact(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Quoted remark preview (WhatsApp-style) ────────────────────────────────
function ReplyQuote({ authorName, body, createdAt }: {
  authorName?: string; body?: string; createdAt?: string;
}) {
  if (!body) return null;
  const preview = body.length > 120 ? body.slice(0, 120) + '…' : body;
  return (
    <div className="flex items-stretch gap-0 mb-2 rounded-lg overflow-hidden border border-brand-200/60">
      <div className="w-1 shrink-0 bg-brand-400 rounded-l-lg" />
      <div className="flex-1 bg-brand-50/80 px-3 py-1.5 min-w-0">
        <p className="text-[10px] font-semibold text-brand-600 mb-0.5">
          {authorName ?? 'Unknown'}{createdAt ? ` · ${fmtExact(createdAt)}` : ''}
        </p>
        <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap break-words">{preview}</p>
      </div>
    </div>
  );
}

// ── Single remark / comment bubble ───────────────────────────────────────
function CommentBubble({ c, onReply, canReply }: {
  c: Comment; onReply: (c: Comment) => void; canReply: boolean;
}) {
  const isRemark  = c.comment_type === 'remark';
  const isNote    = c.comment_type === 'note' || (c.is_internal && c.comment_type === 'reply');
  const initials  = (c.author_name_resolved ?? 'A')[0].toUpperCase();

  const roleColor: Record<string, string> = {
    manager:      'bg-orange-100 text-orange-700',
    tenant_admin: 'bg-red-100 text-red-700',
    agent:        'bg-blue-100 text-blue-700',
    super_admin:  'bg-purple-100 text-purple-700',
  };

  let bubbleCls = 'bg-white border border-gray-100';
  let typeLabel: React.ReactNode = null;
  if (isRemark) {
    bubbleCls = 'bg-violet-50 border border-violet-200';
    typeLabel = (
      <span className="flex items-center gap-1 text-[10px] text-violet-600 bg-violet-100 px-1.5 py-0.5 rounded-full border border-violet-200 font-medium">
        <StickyNote className="w-2.5 h-2.5" /> Remark
      </span>
    );
  } else if (isNote) {
    bubbleCls = 'bg-amber-50 border border-amber-200';
    typeLabel = (
      <span className="flex items-center gap-1 text-[10px] text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full border border-amber-200 font-medium">
        <Lock className="w-2.5 h-2.5" /> Internal
      </span>
    );
  }

  return (
    <div className={`group rounded-xl p-3 ${bubbleCls}`}>
      {/* Header row: avatar + name + role + type + timestamp */}
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <div className="w-6 h-6 rounded-full bg-brand-600 flex items-center justify-center text-[10px] font-bold text-white shrink-0">
          {initials}
        </div>
        <span className="text-xs font-semibold text-gray-800">
          {c.author_name_resolved ?? 'Agent'}
        </span>
        {c.author_role && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${roleColor[c.author_role] ?? 'bg-gray-100 text-gray-600'}`}>
            {c.author_role.replace('_', ' ')}
          </span>
        )}
        {typeLabel}
        <span className="ml-auto text-[10px] text-gray-400 shrink-0">{fmtExact(c.created_at)}</span>
        {/* Reply button — appears on hover */}
        {canReply && (
          <button
            onClick={() => onReply(c)}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50 shrink-0"
            title="Reply to this remark"
          >
            <Reply className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Quoted reply (WhatsApp-style) */}
      {c.reply_to_id && (
        <ReplyQuote
          authorName={c.reply_to_author_name}
          body={c.reply_to_body}
          createdAt={c.reply_to_created_at}
        />
      )}

      {/* Message body */}
      <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap break-words">{c.body}</p>
    </div>
  );
}

// ── Ticket detail side panel ───────────────────────────────────────────────
function TicketPanel({ ticketId, onClose }: { ticketId: string; onClose: () => void }) {
  const qc  = useQueryClient();
  const can = useCan();

  // Tab: 'conversation' | 'remarks'
  const [activeTab, setActiveTab]     = useState<'conversation' | 'remarks'>('conversation');
  const [comment, setComment]         = useState('');
  const [isInternal, setInternal]     = useState(false);
  // WhatsApp-style reply-to state
  const [replyTo, setReplyTo]         = useState<Comment | null>(null);
  const commentsEndRef                = useRef<HTMLDivElement>(null);
  const remarksEndRef                 = useRef<HTMLDivElement>(null);
  const inputRef                      = useRef<HTMLTextAreaElement>(null);

  const { data: t, isLoading } = useQuery<TicketDetail>({
    queryKey: ['ticket', ticketId],
    queryFn: async () => (await api.get(`/api/v1/tickets/${ticketId}`)).data.data,
    refetchInterval: 10_000,   // 10s — react to peer accepts/resolves quickly
  });

  const allComments = t?.comments ?? [];
  const conversation = allComments.filter(c => c.comment_type !== 'remark');
  const remarks      = allComments.filter(c => c.comment_type === 'remark');

  useEffect(() => {
    if (activeTab === 'conversation') commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    else remarksEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [allComments.length, activeTab]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ticket', ticketId] });
    qc.invalidateQueries({ queryKey: ['tickets'] });
    qc.invalidateQueries({ queryKey: ['ticket-stats'] });
  };

  const acceptMutation  = useMutation({ mutationFn: () => api.post(`/api/v1/tickets/${ticketId}/accept`, {}),  onSuccess: invalidate });
  const resolveMutation = useMutation({ mutationFn: () => api.post(`/api/v1/tickets/${ticketId}/resolve`, {}), onSuccess: invalidate });

  const commentMutation = useMutation({
    mutationFn: () => api.post(`/api/v1/tickets/${ticketId}/comments`, {
      body:        comment,
      isInternal,
      commentType: activeTab === 'remarks' ? 'remark' : (isInternal ? 'note' : 'reply'),
      replyToId:   replyTo?.id ?? undefined,
    }),
    onSuccess: () => { setComment(''); setReplyTo(null); invalidate(); },
  });

  const handleReply = (c: Comment) => {
    setReplyTo(c);
    inputRef.current?.focus();
  };

  if (isLoading || !t) return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-gray-50 border-l border-gray-200 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
      </div>
    </div>
  );

  const pc = PRIORITY_CFG[t.priority] ?? PRIORITY_CFG.medium;
  const sc = STATUS_CFG[t.status]     ?? STATUS_CFG.open;
  const slaInfo = fmtSla(t.sla_seconds_remaining, t.is_overdue);
  const isWarmTransfer = !!t.prev_assignee_id && !!t.manager_overridden_by;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-gray-50 border-l border-gray-200 flex flex-col overflow-hidden">

        {/* Panel header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-gray-200 shrink-0 bg-white">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className="font-mono text-xs font-bold text-gray-400 tracking-widest">{t.ticket_number}</span>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${sc.badge}`}>
                <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${sc.dot}`} />{sc.label}
              </span>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${pc.badge}`}>
                <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${pc.dot}`} />{pc.label}
              </span>
              {/* Age chip — always visible */}
              {t.age_seconds != null && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600 border border-gray-200">
                  <Timer className="w-3 h-3" />
                  Age: {fmtAge(t.age_seconds)}
                </span>
              )}
              {t.escalation_level >= 2 && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-900/80 text-red-300 border border-red-600/50">
                  <ShieldAlert className="w-3 h-3" /> Escalated L{t.escalation_level}
                </span>
              )}
            </div>
            <h2 className="text-sm font-semibold text-gray-900 leading-snug">{t.subject}</h2>
          </div>
          <button onClick={onClose} className="ml-3 p-1 text-gray-500 hover:text-gray-500 shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* SLA bar */}
        {slaInfo && !['resolved','closed'].includes(t.status) && (
          <div className={`px-5 py-2.5 border-b border-gray-200 ${t.is_overdue ? 'bg-red-50' : 'bg-white'}`}>
            <SlaBar ticket={t} />
          </div>
        )}

        {/* ── WARM TRANSFER BANNER ─────────────────────────────────────── */}
        {isWarmTransfer && (
          <div className="mx-4 mt-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 shrink-0">
            <div className="flex items-center gap-2 mb-2">
              <ArrowRightLeft className="w-4 h-4 text-blue-600 shrink-0" />
              <p className="text-xs font-semibold text-blue-800">This ticket was transferred to you</p>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
              <div>
                <span className="text-blue-500 font-medium">Originally created</span>
                <p className="text-blue-900 font-semibold mt-0.5">{fmtExact(t.created_at)}</p>
              </div>
              <div>
                <span className="text-blue-500 font-medium">Time elapsed</span>
                <p className="text-blue-900 font-semibold mt-0.5">
                  {t.age_seconds != null ? fmtAge(t.age_seconds) : '—'} since creation
                </p>
              </div>
              <div>
                <span className="text-blue-500 font-medium">Previously with</span>
                <p className="text-blue-900 font-semibold mt-0.5">{t.prev_assignee_name ?? '—'}</p>
              </div>
              <div>
                <span className="text-blue-500 font-medium">Transferred by</span>
                <p className="text-blue-900 font-semibold mt-0.5">{t.manager_overridden_by_name ?? '—'}</p>
              </div>
              {t.manager_overridden_at && (
                <div>
                  <span className="text-blue-500 font-medium">Transferred on</span>
                  <p className="text-blue-900 font-semibold mt-0.5">{fmtExact(t.manager_overridden_at)}</p>
                </div>
              )}
              {t.manager_override_note && (
                <div className="col-span-2 mt-1 bg-white/70 rounded-lg px-3 py-2 border border-blue-200">
                  <span className="text-blue-500 font-medium">Transfer note</span>
                  <p className="text-blue-900 mt-0.5 leading-relaxed">{t.manager_override_note}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── TABS ─────────────────────────────────────────────────────── */}
        <div className="flex gap-0 px-5 pt-3 pb-0 border-b border-gray-200 bg-white shrink-0">
          {([
            { id: 'conversation', label: 'Conversation', icon: MessageSquare, count: conversation.length },
            { id: 'remarks',      label: 'Remarks',       icon: StickyNote,    count: remarks.length     },
          ] as const).map(({ id, label, icon: Icon, count }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors -mb-px ${
                activeTab === id
                  ? id === 'remarks'
                    ? 'border-violet-500 text-violet-700'
                    : 'border-brand-500 text-brand-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
              <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                activeTab === id
                  ? id === 'remarks' ? 'bg-violet-100 text-violet-700' : 'bg-brand-100 text-brand-700'
                  : 'bg-gray-100 text-gray-500'
              }`}>{count}</span>
            </button>
          ))}
        </div>

        {/* ── SCROLLABLE BODY ──────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Ticket age + creation info */}
          {t.age_seconds != null && (
            <div className="flex items-center gap-3 bg-white rounded-xl px-4 py-2.5 border border-gray-100">
              <Clock className="w-4 h-4 text-gray-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-500">
                  <span className="font-semibold text-gray-800">Created:</span> {fmtExact(t.created_at)}
                </p>
              </div>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                t.age_seconds > 86400 ? 'bg-red-100 text-red-700' :
                t.age_seconds > 3600  ? 'bg-yellow-100 text-yellow-700' :
                'bg-green-100 text-green-700'
              }`}>
                {fmtAge(t.age_seconds)} old
              </span>
            </div>
          )}

          {/* Action buttons */}
          {can.writeRecords && (
            <div className="flex gap-2 flex-wrap">
              {['open','assigned'].includes(t.status) && (
                <button onClick={() => acceptMutation.mutate()} disabled={acceptMutation.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-brand-600/80 text-white hover:bg-brand-600 disabled:opacity-40 border border-brand-500/50">
                  {acceptMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                  Accept Ticket
                </button>
              )}
              {['accepted','in_progress','pending'].includes(t.status) && (
                <button onClick={() => resolveMutation.mutate()} disabled={resolveMutation.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-700/60 text-emerald-200 hover:bg-emerald-700/80 disabled:opacity-40 border border-emerald-600/40">
                  {resolveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />}
                  Mark Resolved
                </button>
              )}
            </div>
          )}

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Reporter',    val: t.reporter_name  || '—' },
              { label: 'Phone',       val: t.reporter_phone || '—' },
              { label: 'Email',       val: t.reporter_email || '—' },
              { label: 'Assigned To', val: t.assignee_name  || 'Unassigned' },
              { label: 'Queue',       val: t.queue_name     || '—' },
              { label: 'Created',     val: fmtDate(t.created_at) },
              ...(t.accepted_at ? [{ label: 'Accepted', val: fmtDate(t.accepted_at) }] : []),
              ...(t.sla_due_at  ? [{ label: 'TAT Due',  val: fmtDate(t.sla_due_at)  }] : []),
              ...(t.resolved_at ? [{ label: 'Resolved', val: fmtDate(t.resolved_at) }] : []),
            ].map(({ label, val }) => (
              <div key={label} className="bg-white rounded-xl px-3 py-2.5">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</p>
                <p className="text-sm font-medium text-gray-700 mt-0.5 truncate">{val}</p>
              </div>
            ))}
          </div>

          {/* Description */}
          {t.description && (
            <div className="bg-white rounded-xl p-3">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Problem Description</p>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{t.description}</p>
            </div>
          )}

          {/* Escalation history */}
          {t.escalations?.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Escalation Log</p>
              {t.escalations.map((e: any) => (
                <div key={e.id} className="flex items-center gap-2.5 text-xs bg-orange-950/30 border border-orange-800/30 rounded-xl px-3 py-2">
                  <ArrowUpCircle className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                  <span className="text-orange-300 font-semibold">L{e.escalation_level}</span>
                  <span className="text-orange-500">— {e.reason.replace(/_/g,' ')}</span>
                  <span className="ml-auto text-gray-500 text-[10px]">{fmtDate(e.created_at)}</span>
                </div>
              ))}
            </div>
          )}

          {/* ── CONVERSATION TAB ─────────────────────────────────────── */}
          {activeTab === 'conversation' && (
            <div className="space-y-3">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" /> Conversation ({conversation.length})
              </p>
              {conversation.length === 0 && (
                <p className="text-xs text-gray-500 text-center py-6">No messages yet</p>
              )}
              {conversation.map(c => (
                <CommentBubble key={c.id} c={c} onReply={handleReply} canReply={can.writeRecords && !['closed'].includes(t.status)} />
              ))}
              <div ref={commentsEndRef} />
            </div>
          )}

          {/* ── REMARKS TAB ──────────────────────────────────────────── */}
          {activeTab === 'remarks' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                  <StickyNote className="w-3.5 h-3.5 text-violet-500" />
                  <span className="text-violet-600">Agent Remarks</span>
                  <span className="ml-1 px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[10px] font-bold">{remarks.length}</span>
                </p>
              </div>
              <p className="text-[11px] text-gray-400 leading-relaxed bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">
                Remarks are internal notes visible only to agents and managers. Add context, updates, or observations. Click
                <Reply className="w-3 h-3 inline mx-1 text-violet-500" />
                on any remark to reply with a quoted reference.
              </p>
              {remarks.length === 0 && (
                <p className="text-xs text-gray-500 text-center py-6">No remarks yet. Add the first one below.</p>
              )}
              {remarks.map(c => (
                <CommentBubble key={c.id} c={c} onReply={handleReply} canReply={can.writeRecords && !['closed'].includes(t.status)} />
              ))}
              <div ref={remarksEndRef} />
            </div>
          )}

          {/* ── INPUT AREA ────────────────────────────────────────────── */}
          {can.writeRecords && !['closed'].includes(t.status) && (
            <div className="space-y-2">

              {/* Reply-to quote preview (shown when replying to a specific remark) */}
              {replyTo && (
                <div className="flex items-start gap-2 bg-brand-50 border border-brand-200 rounded-xl px-3 py-2">
                  <CornerUpLeft className="w-3.5 h-3.5 text-brand-500 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-semibold text-brand-600 mb-0.5">
                      Replying to {replyTo.author_name_resolved ?? 'Agent'} · {fmtExact(replyTo.created_at)}
                    </p>
                    <p className="text-xs text-gray-600 truncate">
                      {replyTo.body.length > 100 ? replyTo.body.slice(0, 100) + '…' : replyTo.body}
                    </p>
                  </div>
                  <button onClick={() => setReplyTo(null)} className="text-gray-400 hover:text-gray-600 shrink-0 mt-0.5">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Message type selector — only on Conversation tab */}
              {activeTab === 'conversation' && (
                <div className="flex gap-2">
                  {[
                    { val: false, label: 'Reply to Customer', icon: Send },
                    { val: true,  label: 'Internal Note',     icon: Lock },
                  ].map(({ val, label, icon: Icon }) => (
                    <button key={String(val)} onClick={() => setInternal(val)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-all ${
                        isInternal === val
                          ? val ? 'bg-amber-50 text-amber-700 border-amber-300' : 'bg-brand-50 text-brand-700 border-brand-300'
                          : 'border-gray-200 text-gray-400 hover:border-gray-300'
                      }`}>
                      <Icon className="w-3 h-3" /> {label}
                    </button>
                  ))}
                </div>
              )}

              {/* Remark badge when on remarks tab */}
              {activeTab === 'remarks' && (
                <div className="flex items-center gap-1.5 text-xs text-violet-600">
                  <StickyNote className="w-3 h-3" />
                  <span className="font-medium">Adding a remark</span>
                  <span className="text-violet-400">— internal only, not visible to customers</span>
                </div>
              )}

              <div className="flex gap-2 items-end">
                <textarea
                  ref={inputRef}
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && comment.trim()) {
                      e.preventDefault();
                      commentMutation.mutate();
                    }
                  }}
                  rows={3}
                  placeholder={
                    activeTab === 'remarks'
                      ? 'Write a remark… (Cmd/Ctrl+Enter to send)'
                      : isInternal
                        ? 'Write internal note… (Cmd/Ctrl+Enter to send)'
                        : 'Write a reply to the customer… (Cmd/Ctrl+Enter to send)'
                  }
                  className={`flex-1 border rounded-xl px-3 py-2.5 text-sm outline-none resize-none ${
                    activeTab === 'remarks'
                      ? 'bg-violet-50 border-violet-200 text-gray-800 placeholder-violet-300 focus:border-violet-400'
                      : 'bg-white border-gray-200 text-gray-800 placeholder-gray-400 focus:border-brand-400'
                  }`}
                />
                <button
                  onClick={() => commentMutation.mutate()}
                  disabled={!comment.trim() || commentMutation.isPending}
                  className={`self-end p-2.5 rounded-xl text-white disabled:opacity-40 ${
                    activeTab === 'remarks' ? 'bg-violet-600 hover:bg-violet-700' : 'bg-brand-600 hover:bg-brand-500'
                  }`}
                >
                  {commentMutation.isPending
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : activeTab === 'remarks'
                      ? <StickyNote className="w-4 h-4" />
                      : <Send className="w-4 h-4" />
                  }
                </button>
              </div>
              <p className="text-[10px] text-gray-400">Cmd/Ctrl + Enter to send</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
type Tab = 'all' | 'open' | 'assigned' | 'in_progress' | 'pending' | 'resolved';

const TABS: { id: Tab; label: string }[] = [
  { id: 'all',         label: 'All Tickets'  },
  { id: 'open',        label: 'Open'         },
  { id: 'assigned',    label: 'Assigned'     },
  { id: 'in_progress', label: 'In Progress'  },
  { id: 'pending',     label: 'Pending'      },
  { id: 'resolved',    label: 'Resolved'     },
];

export function Tickets() {
  const can = useCan();
  const qc  = useQueryClient();

  const [tab, setTab]           = useState<Tab>('all');
  const [search, setSearch]     = useState('');
  const [priority, setPriority] = useState('');
  const [showCreate, setCreate] = useState(false);
  const [selectedId, setSelect] = useState<string | null>(null);

  // Derive API params
  const params = useMemo(() => {
    const p: Record<string, string> = { pageSize: '50' };
    if (tab !== 'all') p.status = tab;
    if (search)   p.search   = search;
    if (priority) p.priority = priority;
    return p;
  }, [tab, search, priority]);

  const { data: statsData } = useQuery<Stats>({
    queryKey: ['ticket-stats'],
    queryFn: async () => (await api.get('/api/v1/tickets/stats')).data.data,
    refetchInterval: 10_000,   // 10s — keeps summary cards in sync with the list
  });
  const { data: queuesData } = useQuery<Queue[]>({
    queryKey: ['ticket-queues'],
    queryFn: async () => (await api.get('/api/v1/tickets/queues')).data.data,
  });
  const { data: ticketsData, isLoading } = useQuery<{ data: Ticket[]; meta: any }>({
    queryKey: ['tickets', params],
    queryFn: async () => {
      const qs = new URLSearchParams(params).toString();
      return (await api.get(`/api/v1/tickets?${qs}`)).data;
    },
    refetchInterval: 10_000,   // 10s — tickets accepted by peer agents drop out within 10s
  });

  const tickets = ticketsData?.data ?? [];
  const queues  = queuesData ?? [];
  const s       = statsData;

  // Compute extra stats not in the existing API
  const withinTat  = tickets.filter(t => !t.is_overdue && t.accepted_at && !['resolved','closed'].includes(t.status)).length;
  const breachedTat = tickets.filter(t => t.is_overdue).length;
  const escalatedL2 = tickets.filter(t => t.escalation_level >= 2).length;

  const acceptMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/tickets/${id}/accept`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tickets'] }); qc.invalidateQueries({ queryKey: ['ticket-stats'] }); },
  });
  const resolveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/tickets/${id}/resolve`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tickets'] }); qc.invalidateQueries({ queryKey: ['ticket-stats'] }); },
  });

  return (
    <div className="flex flex-col h-full bg-gray-50 text-gray-900">

      {/* Top header */}
      <div className="px-6 pt-6 pb-4 border-b border-gray-200 shrink-0">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-brand-900/40 border border-brand-700/40">
              <LifeBuoy className="w-5 h-5 text-brand-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Support Tickets</h1>
              <p className="text-xs text-gray-400">All tickets across every channel</p>
            </div>
          </div>
          {can.writeRecords && (
            <button onClick={() => setCreate(true)}
              className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-xl text-sm font-semibold hover:bg-brand-500 transition-colors border border-brand-500/50">
              <Plus className="w-4 h-4" /> New Ticket
            </button>
          )}
        </div>

        {/* KPI strip — Created / Open / Assigned / Claimed / Within TAT / Overdue */}
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
          <KpiCard label="Created Today"  value={s?.created_today ?? s?.total ?? '—'} icon={LifeBuoy}   accent="bg-brand-900/60 text-brand-400"  />
          <KpiCard label="Open"           value={s?.open  ?? '—'} icon={Circle}     accent="bg-blue-100 text-blue-6000 text-yellow-400"  />
          <KpiCard label="Assigned"       value={s?.assigned ?? '—'} icon={Calendar} accent="bg-sky-900/60 text-sky-400" />
          <KpiCard label="Claimed"        value={s?.claimed ?? withinTat} icon={TrendingUp} accent="bg-emerald-100 text-emerald-60060 text-emerald-400"/>
          <KpiCard label="Within TAT"     value={s?.within_tat ?? 0} icon={AlertTriangle} accent="bg-green-100 text-green-6000/60 text-orange-400"
            onClick={() => setTab('all')} active={breachedTat > 0 && tab === 'all'} />
          <KpiCard label="Overdue"        value={s?.overdue ?? 0}    icon={ShieldAlert} accent="bg-red-100 text-red-600 text-red-400" />
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl p-1 w-fit mb-4 flex-wrap">
          {TABS.map(t => {
            const count = t.id === 'all' ? s?.total :
                          t.id === 'open' ? s?.open :
                          t.id === 'assigned' ? s?.assigned :
                          t.id === 'in_progress' ? s?.in_progress :
                          t.id === 'pending' ? s?.pending :
                          t.id === 'resolved' ? s?.resolved : undefined;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                  tab === t.id
                    ? 'bg-brand-600 text-white shadow'
                    : 'text-gray-400 hover:text-gray-500'
                }`}>
                {t.label}
                {count && Number(count) > 0 && (
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                    tab === t.id ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500'
                  }`}>{count}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Search + filter */}
        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by subject, #, reporter…"
              className="pl-9 pr-4 py-2 bg-white border border-gray-200 text-gray-500 placeholder-gray-600 rounded-xl text-xs outline-none focus:border-brand-500/60 w-64" />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <select value={priority} onChange={e => setPriority(e.target.value)}
              className="pl-9 pr-4 py-2 bg-white border border-gray-200 text-gray-400 rounded-xl text-xs outline-none focus:border-brand-500/60 appearance-none">
              <option value="">All priorities</option>
              {['urgent','high','medium','low'].map(p => (
                <option key={p} value={p}>{PRIORITY_CFG[p].label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Card grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading && (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-8 h-8 animate-spin text-gray-700" />
          </div>
        )}
        {!isLoading && tickets.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-gray-700">
            <LifeBuoy className="w-10 h-10 mb-3 opacity-20" />
            <p className="text-sm">No tickets found</p>
            <p className="text-xs mt-1 text-gray-800">Try adjusting the filters or create a new ticket</p>
          </div>
        )}
        {!isLoading && tickets.length > 0 && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {tickets.map(ticket => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                onOpen={setSelect}
                onAccept={id => acceptMutation.mutate(id)}
                onResolve={id => resolveMutation.mutate(id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {showCreate && <CreateTicketModal queues={queues} onClose={() => setCreate(false)} />}
      {selectedId  && <TicketPanel ticketId={selectedId} onClose={() => setSelect(null)} />}
    </div>
  );
}
