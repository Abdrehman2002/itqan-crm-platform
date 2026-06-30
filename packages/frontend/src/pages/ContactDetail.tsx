import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, User, Building2, Mail, Phone, Tag,
  TrendingUp, CheckSquare, LifeBuoy,
  Edit2, Save, X, Loader2,
  Clock, Calendar, PhoneCall, Plus, Star,
} from 'lucide-react';
import { api } from '../services/api';
import { formatCurrency } from '../utils/format';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  mobile: string;
  job_title: string;
  status: string;
  source: string;
  tags: string[];
  company_id: string;
  company_name: string;
  owner_name: string;
  created_at: string;
  updated_at: string;
  custom_fields: Record<string, string>;
}

interface Deal {
  id: string;
  name: string;
  amount: number;
  currency: string;
  status: string;
  stage_name: string;
  close_date: string;
}

interface TimelineItem {
  id: string;
  type: string;
  subtype: string;
  subject: string;
  created_at: string;
  owner_id: string;
  metadata: any;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  lead:       'bg-blue-100 text-blue-700',
  prospect:   'bg-violet-100 text-violet-700',
  customer:   'bg-emerald-100 text-emerald-700',
  churned:    'bg-red-100 text-red-700',
  partner:    'bg-amber-100 text-amber-700',
};

const DEAL_STATUS_COLORS: Record<string, string> = {
  open: 'text-blue-600',
  won:  'text-emerald-600',
  lost: 'text-red-500',
};

function fmtDate(iso: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtRelative(iso: string) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs  < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const TIMELINE_ICONS: Record<string, { icon: React.ElementType; bg: string; text: string }> = {
  activity:    { icon: CheckSquare, bg: 'bg-brand-100',   text: 'text-brand-600'   },
  voice_call:  { icon: PhoneCall,   bg: 'bg-emerald-100', text: 'text-emerald-600' },
  email:       { icon: Mail,        bg: 'bg-violet-100',  text: 'text-violet-600'  },
  ticket:      { icon: LifeBuoy,    bg: 'bg-orange-100',  text: 'text-orange-600'  },
  deal:        { icon: TrendingUp,  bg: 'bg-cyan-100',    text: 'text-cyan-600'    },
};

// ── Edit modal ────────────────────────────────────────────────────────────────

function EditModal({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    firstName: contact.first_name,
    lastName:  contact.last_name  ?? '',
    email:     contact.email      ?? '',
    phone:     contact.phone      ?? '',
    mobile:    contact.mobile     ?? '',
    jobTitle:  contact.job_title  ?? '',
    status:    contact.status,
    source:    contact.source     ?? '',
  });

  const mutation = useMutation({
    mutationFn: () => api.patch(`/api/v1/contacts/${contact.id}`, form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contact', contact.id] }); onClose(); },
  });

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-gray-900">Edit Contact</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {([
            ['First Name', 'firstName', 'text'],
            ['Last Name',  'lastName',  'text'],
            ['Email',      'email',     'email'],
            ['Phone',      'phone',     'tel'],
            ['Mobile',     'mobile',    'tel'],
            ['Job Title',  'jobTitle',  'text'],
          ] as const).map(([label, key, type]) => (
            <div key={key}>
              <label className="text-xs font-medium text-gray-600 mb-1 block">{label}</label>
              <input type={type} value={form[key as keyof typeof form] as string} onChange={f(key as keyof typeof form)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
            </div>
          ))}
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Status</label>
            <select value={form.status} onChange={f('status')}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400">
              {['lead','prospect','customer','churned','partner'].map((s) => (
                <option key={s} value={s} className="capitalize">{s}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex gap-2 mt-6">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {mutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <Save className="w-3.5 h-3.5" />
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Deals tab ─────────────────────────────────────────────────────────────────

function DealsTab({ contactId }: { contactId: string }) {
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ['contact-deals', contactId],
    queryFn: () => api.get(`/api/v1/deals?contactId=${contactId}`).then((r) => r.data.data ?? []),
  });
  const deals: Deal[] = data ?? [];

  if (deals.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">No deals linked to this contact</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {deals.map((deal) => (
        // Munir-merge — rows are clickable. We navigate to /deals?open=<id>
        // and the Deals page picks up the param, switches to the right
        // pipeline, and opens the drawer.
        <button
          key={deal.id}
          onClick={() => navigate(`/deals?open=${deal.id}`)}
          className="w-full text-left bg-white border border-gray-100 rounded-xl p-4 flex items-center justify-between hover:border-brand-300 hover:bg-brand-50/40 transition-colors"
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{deal.name}</p>
            <p className="text-xs text-gray-400 mt-0.5">{deal.stage_name ?? '—'} · Close: {fmtDate(deal.close_date)}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className={`text-xs font-medium capitalize ${DEAL_STATUS_COLORS[deal.status] ?? 'text-gray-600'}`}>
              {deal.status}
            </span>
            <span className="text-sm font-semibold text-brand-600">
              {deal.amount ? formatCurrency(deal.amount, deal.currency) : '—'}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

// ── Timeline tab ──────────────────────────────────────────────────────────────

function TimelineTab({ contactId }: { contactId: string }) {
  const navigate = useNavigate();

  // Munir-merge — Unified Timeline pulls four independent feeds (activities &
  // voice calls already merged server-side; tickets + deals fetched separately)
  // and merges them on the client by created_at desc. Each item keeps a `type`
  // tag so we render the correct icon + click target.
  const { data: baseTimeline, isLoading } = useQuery({
    queryKey: ['contact-timeline', contactId],
    queryFn: () => api.get(`/api/v1/contacts/${contactId}/timeline`).then((r) => r.data.data ?? []),
  });
  const { data: ticketRows } = useQuery({
    queryKey: ['contact-timeline-tickets', contactId],
    queryFn: () => api.get(`/api/v1/tickets?contactId=${contactId}&pageSize=50`).then((r) => r.data.data ?? []),
  });
  const { data: dealRows } = useQuery({
    queryKey: ['contact-timeline-deals', contactId],
    queryFn: () => api.get(`/api/v1/deals?contactId=${contactId}`).then((r) => r.data.data ?? []),
  });

  type Item = TimelineItem & { onClick?: () => void; meta?: string };
  const items: Item[] = [
    ...((baseTimeline as TimelineItem[] | undefined) ?? []),
    ...((ticketRows as any[] | undefined) ?? []).map((t: any): Item => ({
      id:         t.id,
      type:       'ticket',
      subtype:    t.status,
      subject:    `#${t.ticket_number} · ${t.subject ?? '—'}`,
      created_at: t.created_at,
      owner_id:   t.assignee_id ?? '',
      metadata:   null,
      meta:       t.priority ? `${t.priority} priority` : undefined,
      onClick:    () => navigate(`/tickets?open=${t.id}`),
    })),
    ...((dealRows as any[] | undefined) ?? []).map((d: any): Item => ({
      id:         d.id,
      type:       'deal',
      subtype:    d.stage_name ?? d.status,
      subject:    d.name,
      created_at: d.created_at,
      owner_id:   d.owner_id ?? '',
      metadata:   null,
      meta:       d.amount ? formatCurrency(parseFloat(d.amount), d.currency) : undefined,
      onClick:    () => navigate(`/deals?open=${d.id}`),
    })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 text-brand-400 animate-spin" /></div>;
  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">No activity recorded yet</p>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Vertical line */}
      <div className="absolute left-5 top-0 bottom-0 w-px bg-gray-100" />
      <div className="space-y-1">
        {items.map((item) => {
          const iconInfo = TIMELINE_ICONS[item.type] ?? TIMELINE_ICONS.activity;
          const Icon = iconInfo.icon;
          const clickable = !!item.onClick;
          return (
            <div key={`${item.type}-${item.id}`} className="flex gap-4 relative pl-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-1 z-10 ${iconInfo.bg}`}>
                <Icon className={`w-3 h-3 ${iconInfo.text}`} />
              </div>
              <div
                onClick={item.onClick}
                className={`flex-1 bg-white border border-gray-100 rounded-xl p-3 mb-2 ${
                  clickable ? 'cursor-pointer hover:border-brand-300 hover:bg-brand-50/30' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-400 capitalize mb-0.5">
                      {item.type.replace('_', ' ')}
                      {item.subtype ? ` · ${String(item.subtype).replace('_',' ')}` : ''}
                      {item.meta ? ` · ${item.meta}` : ''}
                    </p>
                    <p className="text-sm font-medium text-gray-800 leading-snug">{item.subject || '—'}</p>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">{fmtRelative(item.created_at)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Emails tab ────────────────────────────────────────────────────────────────

function EmailsTab({ contactId }: { contactId: string }) {
  const { data } = useQuery({
    queryKey: ['contact-emails', contactId],
    queryFn: () => api.get(`/api/v1/emails?contactId=${contactId}&pageSize=20`).then((r) => r.data.data ?? []),
  });
  const emails: any[] = data ?? [];

  const STATUS_COLORS: Record<string, string> = {
    delivered: 'bg-emerald-100 text-emerald-700',
    queued:    'bg-gray-100 text-gray-600',
    sending:   'bg-blue-100 text-blue-700',
    failed:    'bg-red-100 text-red-700',
    bounced:   'bg-orange-100 text-orange-700',
    archived:  'bg-gray-100 text-gray-400',
  };

  if (emails.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <Mail className="w-8 h-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">No emails sent to this contact</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {emails.map((email) => (
        <div key={email.id} className="bg-white border border-gray-100 rounded-xl p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{email.subject}</p>
              <p className="text-xs text-gray-400 mt-0.5">To: {email.to_email} · {fmtRelative(email.created_at)}</p>
            </div>
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0 ${STATUS_COLORS[email.status] ?? ''}`}>
              {email.status}
            </span>
          </div>
          {(email.opened_at || email.clicked_at) && (
            <div className="flex gap-3 mt-2">
              {email.opened_at  && <span className="text-xs text-brand-600">✓ Opened  {fmtRelative(email.opened_at)}</span>}
              {email.clicked_at && <span className="text-xs text-emerald-600">✓ Clicked {fmtRelative(email.clicked_at)}</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Tickets tab ───────────────────────────────────────────────────────────────

function NewTicketModal({
  contact, onClose, onCreated,
}: {
  contact: Contact;
  onClose: () => void;
  onCreated: (ticketId: string) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    subject: '',
    description: '',
    priority: 'medium',
  });

  const mutation = useMutation({
    mutationFn: () => api.post('/api/v1/tickets', {
      subject:       form.subject,
      description:   form.description || undefined,
      priority:      form.priority,
      channel:       'manual',
      // Munir-merge — always link to the contact we're viewing + pre-fill
      // reporter fields so the agent gets the same record on submit as if
      // they had searched on the Tickets page.
      contactId:     contact.id,
      reporterName:  [contact.first_name, contact.last_name].filter(Boolean).join(' ') || undefined,
      reporterEmail: contact.email  || undefined,
      reporterPhone: contact.phone  || contact.mobile || undefined,
    }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['contact-tickets', contact.id] });
      qc.invalidateQueries({ queryKey: ['contact-timeline', contact.id] });
      qc.invalidateQueries({ queryKey: ['contact-timeline-tickets', contact.id] });
      qc.invalidateQueries({ queryKey: ['contact-csat', contact.id] });
      const newId = res?.data?.data?.id;
      if (newId) onCreated(newId);
      onClose();
    },
  });

  const PRIORITY_OPTS = ['low', 'medium', 'high', 'urgent'] as const;
  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'this contact';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">New Ticket for {fullName}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Subject <span className="text-red-500">*</span>
            </label>
            <input
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              placeholder="Describe the issue…"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-brand-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              placeholder="Optional context…"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-brand-400 resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Priority</label>
            <div className="flex gap-2">
              {PRIORITY_OPTS.map((p) => (
                <button key={p} type="button"
                  onClick={() => setForm({ ...form, priority: p })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize border transition-colors ${
                    form.priority === p
                      ? 'border-brand-400 bg-brand-50 text-brand-700'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-gray-400 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
            This ticket will be linked to {fullName} and pre-filled with their contact details.
          </p>
          {mutation.isError && (
            <p className="text-xs text-red-600">Failed to create ticket. Try again.</p>
          )}
        </div>
        <div className="px-6 pb-5 flex justify-end gap-2">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!form.subject.trim() || mutation.isPending}
            className="px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-xl disabled:opacity-50 flex items-center gap-1.5"
          >
            {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Create Ticket
          </button>
        </div>
      </div>
    </div>
  );
}

function TicketsTab({ contact }: { contact: Contact }) {
  const navigate = useNavigate();
  const [showNew, setShowNew] = useState(false);
  const { data } = useQuery({
    queryKey: ['contact-tickets', contact.id],
    queryFn: () => api.get(`/api/v1/tickets?contactId=${contact.id}&pageSize=20`).then((r) => r.data.data ?? []),
  });
  const tickets: any[] = data ?? [];

  const PRIORITY_COLORS: Record<string, string> = {
    low:    'bg-gray-100 text-gray-600',
    medium: 'bg-blue-100 text-blue-700',
    high:   'bg-orange-100 text-orange-700',
    urgent: 'bg-red-100 text-red-700',
  };

  // Live TAT (turnaround/SLA) indicator for an open ticket. Returns null for
  // resolved/closed tickets (the clock no longer applies) or when no TAT is set.
  const tatLabel = (t: any): { text: string; cls: string } | null => {
    if (['resolved', 'closed'].includes(t.status)) return null;
    const secs = t.sla_seconds_remaining;
    if (secs === undefined || secs === null) return null;
    if (t.is_overdue || secs < 0) {
      const m = Math.abs(Math.floor(secs / 60));
      const h = Math.floor(m / 60);
      return { text: h > 0 ? `TAT breached ${h}h ${m % 60}m` : `TAT breached ${m}m`, cls: 'text-red-600' };
    }
    const hrs = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    const text = hrs > 0 ? `${hrs}h ${mins}m to TAT` : `${mins}m to TAT`;
    const cls = secs < 3600 ? 'text-orange-600' : secs < 7200 ? 'text-yellow-600' : 'text-emerald-600';
    return { text, cls };
  };

  // Munir-merge — quick "New Ticket" button on the Tickets tab. Opens an
  // inline modal pre-linked to this contact and routes to the new ticket
  // detail panel on success.
  const NewBtn = (
    <div className="flex justify-end mb-3">
      <button onClick={() => setShowNew(true)}
        className="flex items-center gap-1.5 text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 px-3 py-1.5 rounded-lg transition-colors">
        <Plus className="w-3.5 h-3.5" /> New Ticket
      </button>
    </div>
  );

  return (
    <>
      {showNew && (
        <NewTicketModal
          contact={contact}
          onClose={() => setShowNew(false)}
          onCreated={(id) => navigate(`/tickets?open=${id}`)}
        />
      )}
      {NewBtn}
      {tickets.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <LifeBuoy className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No support tickets from this contact</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tickets.map((t) => (
            <button
              key={t.id}
              onClick={() => navigate(`/tickets?open=${t.id}`)}
              className="w-full text-left bg-white border border-gray-100 rounded-xl p-4 flex items-center justify-between hover:border-brand-300 hover:bg-brand-50/40 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-mono text-gray-400">#{t.ticket_number}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${PRIORITY_COLORS[t.priority]}`}>{t.priority}</span>
                </div>
                <p className="text-sm font-medium text-gray-900 truncate">{t.subject}</p>
                <p className="text-xs text-gray-400 mt-0.5">{fmtRelative(t.created_at)}</p>
              </div>
              <div className="flex flex-col items-end shrink-0 ml-3 gap-0.5">
                <span className={`text-xs font-medium capitalize ${t.status === 'resolved' || t.status === 'closed' ? 'text-emerald-600' : 'text-blue-600'}`}>
                  {t.status?.replace('_', ' ')}
                </span>
                {(() => {
                  const tat = tatLabel(t);
                  return tat ? <span className={`text-[11px] font-medium ${tat.cls}`}>{tat.text}</span> : null;
                })()}
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'timeline', label: 'Timeline',   icon: Clock        },
  { key: 'deals',    label: 'Deals',      icon: TrendingUp   },
  { key: 'emails',   label: 'Emails',     icon: Mail         },
  { key: 'tickets',  label: 'Tickets',    icon: LifeBuoy     },
] as const;

export function ContactDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tab, setTab]       = useState<typeof TABS[number]['key']>('timeline');
  const [editing, setEditing] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['contact', id],
    queryFn: () => api.get(`/api/v1/contacts/${id}`).then((r) => r.data.data),
    enabled: !!id,
  });
  const contact: Contact | undefined = data;

  // Munir-merge — CSAT summary (avg + count) from resolved tickets linked to
  // this contact. Endpoint added to packages/api/src/routes/csat.ts under
  // /api/v1/tickets/csat/contact/:contactId.
  const { data: csatData } = useQuery<{ avg: number | null; count: number }>({
    queryKey: ['contact-csat', id],
    queryFn: () =>
      api.get(`/api/v1/tickets/csat/contact/${id}`).then((r) => r.data.data),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
      </div>
    );
  }

  if (error || !contact) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <User className="w-10 h-10 text-gray-300 mb-3" />
        <p className="text-gray-500 font-medium">Contact not found</p>
        <button onClick={() => navigate('/contacts')} className="mt-3 text-sm text-brand-600 hover:underline">← Back to Contacts</button>
      </div>
    );
  }

  const initials = [contact.first_name?.[0], contact.last_name?.[0]].filter(Boolean).join('').toUpperCase() || '?';
  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ');

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left profile sidebar */}
      <div className="w-72 border-r border-gray-100 flex flex-col overflow-y-auto shrink-0">
        {/* Back button */}
        <div className="px-4 py-3 border-b border-gray-100">
          <button onClick={() => navigate('/contacts')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
            <ArrowLeft className="w-4 h-4" />
            All Contacts
          </button>
        </div>

        {/* Avatar + name */}
        <div className="px-5 py-6 text-center border-b border-gray-100">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-brand-400 to-purple-500 flex items-center justify-center text-white text-xl font-bold mx-auto mb-3">
            {initials}
          </div>
          <h2 className="text-base font-semibold text-gray-900">{fullName}</h2>
          {contact.job_title && <p className="text-sm text-gray-500 mt-0.5">{contact.job_title}</p>}
          {contact.company_name && (
            <p className="text-xs text-brand-600 mt-1 flex items-center justify-center gap-1">
              <Building2 className="w-3 h-3" />{contact.company_name}
            </p>
          )}
          <span className={`inline-block mt-2 text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_COLORS[contact.status] ?? 'bg-gray-100 text-gray-600'}`}>
            {contact.status}
          </span>

          {/* CSAT widget — shows the rolling average of CSAT survey responses
              across this contact's resolved tickets. Hidden when there are
              no ratings yet (avoid showing a misleading 0★). */}
          {csatData && csatData.count > 0 && csatData.avg != null && (
            <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200">
              {[1,2,3,4,5].map(n => (
                <Star key={n}
                  className={`w-3.5 h-3.5 ${n <= Math.round(csatData.avg!) ? 'text-amber-400 fill-amber-400' : 'text-gray-200 fill-gray-200'}`}
                />
              ))}
              <span className="text-xs font-bold text-gray-800 ml-0.5">{csatData.avg.toFixed(1)}</span>
              <span className="text-[10px] text-gray-500">
                ({csatData.count} {csatData.count === 1 ? 'rating' : 'ratings'})
              </span>
            </div>
          )}
        </div>

        {/* Contact info */}
        <div className="px-5 py-4 space-y-3 border-b border-gray-100">
          {contact.email && (
            <a href={`mailto:${contact.email}`} className="flex items-center gap-2.5 text-sm text-gray-700 hover:text-brand-600 group">
              <Mail className="w-4 h-4 text-gray-400 group-hover:text-brand-500" />
              <span className="truncate">{contact.email}</span>
            </a>
          )}
          {contact.phone && (
            <a href={`tel:${contact.phone}`} className="flex items-center gap-2.5 text-sm text-gray-700 hover:text-brand-600 group">
              <Phone className="w-4 h-4 text-gray-400 group-hover:text-brand-500" />
              <span>{contact.phone}</span>
            </a>
          )}
          {contact.mobile && (
            <a href={`tel:${contact.mobile}`} className="flex items-center gap-2.5 text-sm text-gray-700 hover:text-brand-600 group">
              <Phone className="w-4 h-4 text-gray-400 group-hover:text-brand-500" />
              <span>{contact.mobile} (mobile)</span>
            </a>
          )}
        </div>

        {/* Meta */}
        <div className="px-5 py-4 space-y-2 border-b border-gray-100">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Owner</span>
            <span className="text-gray-700 font-medium">{contact.owner_name || '—'}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Source</span>
            <span className="text-gray-700 font-medium capitalize">{contact.source?.replace(/_/g,' ') || '—'}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Created</span>
            <span className="text-gray-700">{fmtDate(contact.created_at)}</span>
          </div>
        </div>

        {/* Tags */}
        {contact.tags?.length > 0 && (
          <div className="px-5 py-4 border-b border-gray-100">
            <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1"><Tag className="w-3 h-3" /> Tags</p>
            <div className="flex flex-wrap gap-1.5">
              {contact.tags.map((tag) => (
                <span key={tag} className="text-xs px-2 py-0.5 bg-brand-50 text-brand-700 rounded-full">{tag}</span>
              ))}
            </div>
          </div>
        )}

        {/* Custom fields */}
        {Object.keys(contact.custom_fields ?? {}).length > 0 && (
          <div className="px-5 py-4 border-b border-gray-100">
            <p className="text-xs font-medium text-gray-500 mb-2">Custom Fields</p>
            <div className="space-y-2">
              {Object.entries(contact.custom_fields).map(([k, v]) => (
                <div key={k} className="flex justify-between text-sm">
                  <span className="text-gray-400 capitalize">{k.replace(/_/g,' ')}</span>
                  <span className="text-gray-700 font-medium">{v as string}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Edit button */}
        <div className="px-5 py-4 mt-auto">
          <button
            onClick={() => setEditing(true)}
            className="w-full flex items-center justify-center gap-2 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
          >
            <Edit2 className="w-3.5 h-3.5" />
            Edit Contact
          </button>
        </div>
      </div>

      {/* Right content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Tab bar */}
        <div className="px-5 border-b border-gray-100 flex items-center gap-1 shrink-0">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-3 py-3.5 text-sm font-medium border-b-2 transition-colors ${
                tab === key
                  ? 'border-brand-500 text-brand-600'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'timeline' && <TimelineTab contactId={id!} />}
          {tab === 'deals'    && <DealsTab    contactId={id!} />}
          {tab === 'emails'   && <EmailsTab   contactId={id!} />}
          {tab === 'tickets'  && <TicketsTab  contact={contact} />}
        </div>
      </div>

      {editing && contact && <EditModal contact={contact} onClose={() => setEditing(false)} />}
    </div>
  );
}
