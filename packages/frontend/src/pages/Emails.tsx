/**
 * Emails page
 *
 * Compose & track outbound emails sent through the configured SMTP / SendGrid connector.
 * • Sent email history (cards with status indicators)
 * • Compose modal — To, Subject, HTML/plain body, optional CC/BCC, contact/deal association
 * • Template picker — apply saved templates in one click
 * • Filters — search by subject/recipient, status dropdown, date range
 * • Email detail side panel — full body preview + metadata
 * • Resend button for failed emails
 */

import { useState, useRef } from 'react';
import DOMPurify from 'dompurify';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Mail, Send, Plus, Search, RefreshCw, Trash2, Eye,
  CheckCircle2, XCircle, Clock, AlertCircle, ChevronDown,
  User, Briefcase, X, Loader2, FileText, Copy, MoreHorizontal,
} from 'lucide-react';
import { api } from '../services/api';

// ── Types ─────────────────────────────────────────────────────────────────

interface Email {
  id: string;
  from_email: string;
  from_name?: string;
  to_email: string;
  to_name?: string;
  cc: string[];
  bcc: string[];
  subject: string;
  body_html?: string;
  body_text?: string;
  status: 'queued' | 'sending' | 'delivered' | 'failed' | 'bounced' | 'archived';
  provider?: string;
  provider_id?: string;
  error?: string;
  contact_name?: string;
  sent_by_name?: string;
  deal_name?: string;
  contact_id?: string;
  deal_id?: string;
  ticket_id?: string;
  sent_at?: string;
  opened_at?: string;
  created_at: string;
}

interface Template {
  id: string;
  name: string;
  subject: string;
  body_html: string;
  body_text?: string;
  category: string;
}

interface Contact { id: string; first_name: string; last_name?: string; email?: string; }
interface Deal    { id: string; name: string; }

// ── Status config ─────────────────────────────────────────────────────────

const STATUS_CFG = {
  queued:    { label: 'Queued',    icon: Clock,         color: 'text-gray-400',   bg: 'bg-gray-800/60 border-gray-700/50' },
  sending:   { label: 'Sending',   icon: Loader2,       color: 'text-brand-400',  bg: 'bg-brand-900/40 border-brand-700/50' },
  delivered: { label: 'Delivered', icon: CheckCircle2,  color: 'text-emerald-400',bg: 'bg-emerald-900/40 border-emerald-700/50' },
  failed:    { label: 'Failed',    icon: XCircle,       color: 'text-red-400',    bg: 'bg-red-900/40 border-red-700/50' },
  bounced:   { label: 'Bounced',   icon: AlertCircle,   color: 'text-orange-400', bg: 'bg-orange-900/40 border-orange-700/50' },
  archived:  { label: 'Archived',  icon: Trash2,        color: 'text-gray-500',   bg: 'bg-gray-900/40 border-gray-700/30' },
};

function StatusBadge({ status }: { status: Email['status'] }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.queued;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold border ${cfg.bg} ${cfg.color}`}>
      <Icon className={`w-3 h-3 ${status === 'sending' ? 'animate-spin' : ''}`} />
      {cfg.label}
    </span>
  );
}

// ── Compose modal ─────────────────────────────────────────────────────────

interface ComposeProps {
  onClose: () => void;
  prefill?: Partial<{ to: string; toName: string; subject: string; contactId: string; dealId: string; ticketId: string }>;
}

function ComposeModal({ onClose, prefill }: ComposeProps) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    to:       prefill?.to       ?? '',
    toName:   prefill?.toName   ?? '',
    subject:  prefill?.subject  ?? '',
    bodyHtml: '',
    bodyText: '',
    cc:       '',
    bcc:      '',
    replyTo:  '',
    contactId: prefill?.contactId ?? '',
    dealId:    prefill?.dealId    ?? '',
    ticketId:  prefill?.ticketId  ?? '',
    useHtml:  true,
  });
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [error, setError] = useState('');

  const { data: templates } = useQuery<Template[]>({
    queryKey: ['email-templates'],
    queryFn: async () => { const r = await api.get('/api/v1/emails/templates'); return r.data.data; },
  });

  const { data: contacts } = useQuery<Contact[]>({
    queryKey: ['contacts-mini'],
    queryFn: async () => { const r = await api.get('/api/v1/contacts?pageSize=200'); return r.data.data; },
  });

  const sendMut = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        to: form.to,
        toName: form.toName || undefined,
        subject: form.subject,
        ...(form.useHtml ? { bodyHtml: form.bodyHtml } : { bodyText: form.bodyText }),
        ...(form.bodyText ? { bodyText: form.bodyText } : {}),
        ...(form.cc  ? { cc:  form.cc.split(',').map(s => s.trim()).filter(Boolean) }  : {}),
        ...(form.bcc ? { bcc: form.bcc.split(',').map(s => s.trim()).filter(Boolean) } : {}),
        ...(form.replyTo  ? { replyTo:   form.replyTo }  : {}),
        ...(form.contactId ? { contactId: form.contactId } : {}),
        ...(form.dealId    ? { dealId:    form.dealId }   : {}),
        ...(form.ticketId  ? { ticketId:  form.ticketId } : {}),
      };
      const r = await api.post('/api/v1/emails/send', body);
      return r.data;
    },
    onSuccess: (data) => {
      if (data.success) {
        qc.invalidateQueries({ queryKey: ['emails'] });
        onClose();
      } else {
        setError(data.data?.error ?? 'Failed to send email');
      }
    },
    onError: (err: any) => {
      setError(err.response?.data?.error?.message ?? 'Failed to send');
    },
  });

  const applyTemplate = (t: Template) => {
    setForm(f => ({ ...f, subject: t.subject, bodyHtml: t.body_html, bodyText: t.body_text ?? '', useHtml: true }));
    setShowTemplate(false);
  };

  const inputCls = "w-full bg-gray-900/60 border border-gray-700/60 text-gray-200 placeholder-gray-600 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand-500/60 transition-colors";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
         style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-2xl rounded-2xl border border-white/10 shadow-2xl flex flex-col max-h-[90vh]"
           style={{ background: '#0d1117' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                 style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #1a8cbf 100%)' }}>
              <Mail className="w-4 h-4 text-white" />
            </div>
            <h2 className="text-white font-semibold">New Email</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 p-1 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">

          {/* Template picker */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowTemplate(!showTemplate)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-dashed border-brand-600/50 text-brand-400 text-xs hover:border-brand-400 transition-colors"
            >
              <FileText className="w-3.5 h-3.5" />
              Use a template
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            {showTemplate && templates && templates.length > 0 && (
              <div className="absolute top-full left-0 mt-1 w-72 rounded-xl border border-white/10 shadow-xl z-10 overflow-hidden"
                   style={{ background: '#161b22' }}>
                {templates.map(t => (
                  <button key={t.id} onClick={() => applyTemplate(t)}
                    className="w-full text-left px-4 py-2.5 hover:bg-white/5 transition-colors border-b border-white/5 last:border-0">
                    <p className="text-sm text-white font-medium">{t.name}</p>
                    <p className="text-xs text-gray-500 truncate mt-0.5">{t.subject}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* To */}
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">To *</label>
              <input type="email" placeholder="recipient@example.com" value={form.to}
                onChange={e => setForm(f => ({ ...f, to: e.target.value }))}
                className={inputCls} required />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Display name</label>
              <input type="text" placeholder="John Smith" value={form.toName}
                onChange={e => setForm(f => ({ ...f, toName: e.target.value }))}
                className={inputCls} />
            </div>
          </div>

          {/* CC / BCC toggle */}
          <button type="button" onClick={() => setShowCcBcc(!showCcBcc)}
            className="text-xs text-gray-500 hover:text-brand-400 flex items-center gap-1 transition-colors">
            <ChevronDown className={`w-3 h-3 transition-transform ${showCcBcc ? 'rotate-180' : ''}`} />
            {showCcBcc ? 'Hide' : 'Add'} CC / BCC / Reply-to
          </button>
          {showCcBcc && (
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">CC</label>
                <input type="text" placeholder="a@b.com, c@d.com" value={form.cc}
                  onChange={e => setForm(f => ({ ...f, cc: e.target.value }))}
                  className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">BCC</label>
                <input type="text" placeholder="a@b.com" value={form.bcc}
                  onChange={e => setForm(f => ({ ...f, bcc: e.target.value }))}
                  className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Reply-To</label>
                <input type="text" placeholder="reply@yourco.com" value={form.replyTo}
                  onChange={e => setForm(f => ({ ...f, replyTo: e.target.value }))}
                  className={inputCls} />
              </div>
            </div>
          )}

          {/* Subject */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Subject *</label>
            <input type="text" placeholder="Your subject line" value={form.subject}
              onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
              className={inputCls} required />
          </div>

          {/* CRM associations */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                <User className="w-3 h-3 inline mr-1" />Link to Contact
              </label>
              <select value={form.contactId} onChange={e => setForm(f => ({ ...f, contactId: e.target.value }))}
                className={`${inputCls} appearance-none`}>
                <option value="">None</option>
                {contacts?.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.first_name} {c.last_name ?? ''}{c.email ? ` — ${c.email}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                <Briefcase className="w-3 h-3 inline mr-1" />Link to Deal (optional)
              </label>
              <input type="text" placeholder="Deal UUID (optional)" value={form.dealId}
                onChange={e => setForm(f => ({ ...f, dealId: e.target.value }))}
                className={inputCls} />
            </div>
          </div>

          {/* Body mode toggle */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">Body format:</span>
            <button type="button"
              onClick={() => setForm(f => ({ ...f, useHtml: true }))}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                form.useHtml ? 'bg-brand-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}>HTML</button>
            <button type="button"
              onClick={() => setForm(f => ({ ...f, useHtml: false }))}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                !form.useHtml ? 'bg-brand-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}>Plain text</button>
          </div>

          {/* Body editor */}
          {form.useHtml ? (
            <div>
              <label className="block text-xs text-gray-500 mb-1">HTML Body *</label>
              <textarea
                rows={10}
                placeholder="<p>Dear {{name}},</p>&#10;<p>Your message here...</p>"
                value={form.bodyHtml}
                onChange={e => setForm(f => ({ ...f, bodyHtml: e.target.value }))}
                className={`${inputCls} resize-none font-mono text-xs`}
              />
              {/* Plain text fallback */}
              <div className="mt-2">
                <label className="block text-xs text-gray-500 mb-1">Plain text fallback (optional)</label>
                <textarea rows={3} placeholder="Plain-text version for clients that block HTML"
                  value={form.bodyText}
                  onChange={e => setForm(f => ({ ...f, bodyText: e.target.value }))}
                  className={`${inputCls} resize-none text-xs`} />
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Plain-text Body *</label>
              <textarea rows={10} placeholder="Your message…"
                value={form.bodyText}
                onChange={e => setForm(f => ({ ...f, bodyText: e.target.value }))}
                className={`${inputCls} resize-none`} />
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-900/30 border border-red-700/50 text-red-300 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-400" />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-white/10">
          <button onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors">
            Cancel
          </button>
          <button
            onClick={() => sendMut.mutate()}
            disabled={sendMut.isPending || !form.to || !form.subject || (!form.bodyHtml && !form.bodyText)}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-all"
            style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #1a8cbf 100%)' }}
          >
            {sendMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {sendMut.isPending ? 'Sending…' : 'Send Email'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Email detail panel ────────────────────────────────────────────────────

function EmailPanel({ emailId, onClose }: { emailId: string; onClose: () => void }) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<Email>({
    queryKey: ['email', emailId],
    queryFn: async () => { const r = await api.get(`/api/v1/emails/${emailId}`); return r.data.data; },
  });

  const resendMut = useMutation({
    mutationFn: async () => {
      const r = await api.post(`/api/v1/emails/${emailId}/resend`);
      return r.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['emails'] }),
  });

  const deleteMut = useMutation({
    mutationFn: async () => api.delete(`/api/v1/emails/${emailId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['emails'] }); onClose(); },
  });

  return (
    <div className="w-[420px] shrink-0 border-l border-white/10 flex flex-col h-full"
         style={{ background: '#0d1117' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
        <h3 className="text-white font-semibold text-sm">Email Detail</h3>
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
          {/* Status */}
          <div className="flex items-center gap-2">
            <StatusBadge status={data.status} />
            {data.opened_at && (
              <span className="text-xs text-emerald-400">
                Opened {new Date(data.opened_at).toLocaleString()}
              </span>
            )}
          </div>

          {/* Metadata grid */}
          <div className="rounded-xl border border-white/10 overflow-hidden">
            {[
              { label: 'From',    value: data.from_name ? `${data.from_name} <${data.from_email}>` : data.from_email },
              { label: 'To',      value: data.to_name   ? `${data.to_name} <${data.to_email}>`     : data.to_email   },
              ...(data.cc?.length  ? [{ label: 'CC',  value: data.cc.join(', ')  }] : []),
              ...(data.bcc?.length ? [{ label: 'BCC', value: data.bcc.join(', ') }] : []),
              { label: 'Subject', value: data.subject },
              { label: 'Sent',    value: data.sent_at ? new Date(data.sent_at).toLocaleString() : '—' },
              { label: 'Via',     value: data.provider ?? '—' },
              ...(data.contact_name ? [{ label: 'Contact', value: data.contact_name }] : []),
              ...(data.deal_name    ? [{ label: 'Deal',    value: data.deal_name    }] : []),
              ...(data.sent_by_name ? [{ label: 'Sent by', value: data.sent_by_name }] : []),
            ].map(({ label, value }) => (
              <div key={label} className="flex gap-3 px-4 py-2.5 border-b border-white/5 last:border-0">
                <span className="text-xs text-gray-500 w-16 shrink-0 pt-0.5">{label}</span>
                <span className="text-xs text-gray-200 break-all">{value}</span>
              </div>
            ))}
          </div>

          {/* Error */}
          {data.error && (
            <div className="px-4 py-3 rounded-xl bg-red-900/30 border border-red-700/50 text-red-300 text-xs">
              <p className="font-semibold mb-1">Delivery error</p>
              {data.error}
            </div>
          )}

          {/* Body preview */}
          <div>
            <p className="text-xs text-gray-500 mb-2 font-semibold uppercase tracking-wide">Message body</p>
            {data.body_html ? (
              <div
                className="rounded-xl border border-white/10 p-4 text-sm text-gray-300 bg-white/5 overflow-auto max-h-64"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(data.body_html, { USE_PROFILES: { html: true } }) }}
              />
            ) : (
              <pre className="rounded-xl border border-white/10 p-4 text-sm text-gray-300 bg-white/5 overflow-auto max-h-64 whitespace-pre-wrap font-sans">
                {data.body_text ?? '(no body)'}
              </pre>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            {data.status === 'failed' && (
              <button
                onClick={() => resendMut.mutate()}
                disabled={resendMut.isPending}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold text-white bg-brand-600 hover:bg-brand-500 disabled:opacity-40 transition-colors"
              >
                {resendMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Resend
              </button>
            )}
            <button
              onClick={() => deleteMut.mutate()}
              disabled={deleteMut.isPending}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm text-red-400 hover:bg-red-900/30 border border-red-900/50 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Archive
            </button>
            <button
              onClick={() => navigator.clipboard.writeText(data.to_email)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm text-gray-400 hover:bg-white/5 border border-white/10 transition-colors"
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
          Email not found
        </div>
      )}
    </div>
  );
}

// ── Email card ────────────────────────────────────────────────────────────

function EmailCard({ email, selected, onClick }: { email: Email; selected: boolean; onClick: () => void }) {
  const ago = (d: string) => {
    const diff = Date.now() - new Date(d).getTime();
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return new Date(d).toLocaleDateString();
  };

  return (
    <div
      onClick={onClick}
      className={`px-5 py-4 border-b border-white/5 cursor-pointer transition-colors hover:bg-white/5 ${
        selected ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div
          className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-white mt-0.5"
          style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #4D8B3C 100%)' }}
        >
          {(email.to_name ?? email.to_email)?.[0]?.toUpperCase() ?? '?'}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <span className="text-sm font-semibold text-white truncate">
              {email.to_name ?? email.to_email}
            </span>
            <span className="text-[10px] text-gray-500 shrink-0">{ago(email.created_at)}</span>
          </div>
          <p className="text-sm text-gray-300 truncate mb-1.5">{email.subject}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={email.status} />
            {email.contact_name && (
              <span className="text-[10px] text-gray-500 flex items-center gap-1">
                <User className="w-3 h-3" />{email.contact_name}
              </span>
            )}
            {email.deal_name && (
              <span className="text-[10px] text-gray-500 flex items-center gap-1">
                <Briefcase className="w-3 h-3" />{email.deal_name}
              </span>
            )}
            {email.provider && (
              <span className="text-[10px] text-gray-600 capitalize">{email.provider}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Stats bar ─────────────────────────────────────────────────────────────

function StatsBar({ emails }: { emails: Email[] }) {
  const counts = emails.reduce((acc, e) => {
    acc[e.status] = (acc[e.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const stats = [
    { label: 'Total',     value: emails.length,             color: 'text-white' },
    { label: 'Delivered', value: counts.delivered ?? 0,     color: 'text-emerald-400' },
    { label: 'Failed',    value: counts.failed ?? 0,        color: 'text-red-400' },
    { label: 'Sending',   value: (counts.sending ?? 0) + (counts.queued ?? 0), color: 'text-brand-400' },
  ];

  return (
    <div className="grid grid-cols-4 gap-3 mb-5">
      {stats.map(({ label, value, color }) => (
        <div key={label}
          className="rounded-xl px-4 py-3 border border-white/10 flex flex-col gap-0.5"
          style={{ background: 'rgba(255,255,255,0.03)' }}
        >
          <span className={`text-xl font-bold ${color}`}>{value}</span>
          <span className="text-xs text-gray-500">{label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export function Emails() {
  const [compose, setCompose]     = useState(false);
  const [selectedId, setSelected] = useState<string | null>(null);
  const [search, setSearch]       = useState('');
  const [statusFilter, setStatus] = useState('');
  const [page, setPage]           = useState(1);

  const { data, isLoading, isFetching } = useQuery<{ data: Email[]; meta: { total: number } }>({
    queryKey: ['emails', statusFilter, search, page],
    queryFn: async () => {
      const params = new URLSearchParams({
        pageSize: '30',
        page: String(page),
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(search       ? { search }                : {}),
      });
      const r = await api.get(`/api/v1/emails?${params}`);
      return r.data;
    },
    staleTime: 15_000,
  });

  const emails = data?.data ?? [];
  const total  = data?.meta?.total ?? 0;

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0d1117' }}>

      {/* ── Main list area ───────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                 style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #1a8cbf 100%)' }}>
              <Mail className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-white font-bold text-lg leading-tight">Emails</h1>
              <p className="text-gray-500 text-xs">{total} message{total !== 1 ? 's' : ''} sent</p>
            </div>
          </div>

          <button
            onClick={() => setCompose(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all shadow-lg hover:shadow-brand-500/20"
            style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #1a8cbf 100%)' }}
          >
            <Plus className="w-4 h-4" />
            Compose
          </button>
        </div>

        {/* Filters */}
        <div className="px-6 py-3 border-b border-white/10 flex items-center gap-3 shrink-0">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <input
              type="text"
              placeholder="Search subject or recipient…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="pl-9 pr-4 py-2 bg-gray-900/60 border border-gray-700/60 text-gray-300 placeholder-gray-600 rounded-xl text-xs outline-none focus:border-brand-500/60 w-full"
            />
          </div>

          <select
            value={statusFilter}
            onChange={e => { setStatus(e.target.value); setPage(1); }}
            className="px-3 py-2 bg-gray-900/60 border border-gray-700/60 text-gray-400 rounded-xl text-xs outline-none focus:border-brand-500/60 appearance-none"
          >
            <option value="">All statuses</option>
            {Object.entries(STATUS_CFG).filter(([k]) => k !== 'archived').map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>

          {isFetching && !isLoading && (
            <Loader2 className="w-4 h-4 animate-spin text-brand-400 shrink-0" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 animate-spin text-brand-400" />
            </div>
          ) : emails.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                   style={{ background: 'rgba(41,171,226,0.1)' }}>
                <Mail className="w-8 h-8 text-brand-400/50" />
              </div>
              <div className="text-center">
                <p className="text-gray-400 font-medium">No emails yet</p>
                <p className="text-gray-600 text-sm mt-1">
                  {search || statusFilter
                    ? 'Try changing your filters'
                    : 'Compose your first email to get started'}
                </p>
              </div>
              {!search && !statusFilter && (
                <button onClick={() => setCompose(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
                  style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #1a8cbf 100%)' }}>
                  <Plus className="w-4 h-4" /> Compose email
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Stats */}
              <div className="px-6 pt-5">
                <StatsBar emails={emails} />
              </div>
              {/* List */}
              {emails.map(e => (
                <EmailCard
                  key={e.id}
                  email={e}
                  selected={selectedId === e.id}
                  onClick={() => setSelected(selectedId === e.id ? null : e.id)}
                />
              ))}
              {/* Pagination */}
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
        <EmailPanel emailId={selectedId} onClose={() => setSelected(null)} />
      )}

      {/* ── Compose modal ─────────────────────────────────────────── */}
      {compose && <ComposeModal onClose={() => setCompose(false)} />}
    </div>
  );
}
