/**
 * Team Messaging — internal tenant chat (channels + DMs) + external compose
 *
 * Left panel: channel list + DM list
 * Main panel: message thread + compose bar
 * Right panel (optional): Compose external email/SMS to contacts
 */

import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Hash, MessageSquare, Send, Plus, Search, Mail, Phone,
  ChevronDown, X, Loader2, User, Users, MessageCircle,
  ExternalLink, PaperclipIcon, AtSign, RefreshCw,
} from 'lucide-react';
import { api } from '../services/api';
import { useAuthStore } from '../store/auth.store';

interface Message {
  id: string;
  sender_id: string;
  sender_name: string;
  content: string;
  created_at: string;
  recipient_id?: string;
}

interface TeamMember {
  id: string;
  first_name: string;
  last_name?: string;
  email: string;
  role: string;
}

interface Channel {
  name: string;
  message_count: number;
  last_message_at: string | null;
}

interface Contact { id: string; first_name: string; last_name?: string; email?: string; phone?: string; }

// ── External Compose Modal ──────────────────────────────────────────────────
function ExternalComposeModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'email' | 'sms'>('email');
  const [form, setForm] = useState({ to: '', subject: '', body: '', phone: '' });
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const { data: contacts } = useQuery<Contact[]>({
    queryKey: ['contacts-search'],
    queryFn: () => api.get('/api/v1/contacts?limit=200').then((r) => r.data.data),
  });

  const sendEmail = async () => {
    setSending(true); setResult(null);
    try {
      await api.post('/api/v1/emails', { to_email: form.to, subject: form.subject, body_html: form.body });
      setResult({ ok: true, msg: 'Email sent successfully' });
    } catch (err: any) {
      setResult({ ok: false, msg: err.response?.data?.error?.message ?? 'Failed to send' });
    } finally { setSending(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Message Customer</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        {/* Tab */}
        <div className="flex gap-1 px-6 pt-4">
          {(['email', 'sms'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 px-4 py-1.5 text-sm rounded-lg capitalize transition-colors ${
                tab === t ? 'bg-brand-100 text-brand-700 font-medium' : 'text-gray-500 hover:bg-gray-100'
              }`}>
              {t === 'email' ? <Mail className="w-3.5 h-3.5" /> : <Phone className="w-3.5 h-3.5" />}
              {t === 'email' ? 'Email' : 'SMS'}
            </button>
          ))}
        </div>

        <div className="px-6 py-5 space-y-4">
          {tab === 'email' ? (
            <>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">To</label>
                <input value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })}
                  placeholder="customer@email.com"
                  list="contact-emails"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
                <datalist id="contact-emails">
                  {(contacts ?? []).filter((c) => c.email).map((c) => (
                    <option key={c.id} value={c.email!}>{c.first_name} {c.last_name}</option>
                  ))}
                </datalist>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Subject</label>
                <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  placeholder="Subject"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Message</label>
                <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })}
                  rows={6} placeholder="Write your message..."
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400 resize-none" />
              </div>
              {result && (
                <div className={`p-3 rounded-lg text-sm ${result.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  {result.msg}
                </div>
              )}
              <button onClick={sendEmail} disabled={!form.to || !form.subject || !form.body || sending}
                className="w-full py-2.5 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Send Email
              </button>
            </>
          ) : (
            <div className="py-8 text-center text-gray-400">
              <Phone className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium text-gray-600 mb-1">SMS requires SMS gateway configured</p>
              <p className="text-xs">Configure an SMS gateway in Integrations to send SMS messages to customers.</p>
              <button onClick={onClose} className="mt-4 text-xs text-brand-600 hover:underline">Go to Integrations →</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Message Bubble ──────────────────────────────────────────────────────────
function MessageBubble({ msg, isMe }: { msg: Message; isMe: boolean }) {
  return (
    <div className={`flex gap-2 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold text-white ${
        isMe ? 'bg-brand-500' : 'bg-gray-400'
      }`}>
        {msg.sender_name.charAt(0).toUpperCase()}
      </div>
      <div className={`max-w-[70%] ${isMe ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        {!isMe && <p className="text-xs text-gray-400 px-1">{msg.sender_name}</p>}
        <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed ${
          isMe
            ? 'bg-brand-600 text-white rounded-tr-sm'
            : 'bg-gray-100 text-gray-800 rounded-tl-sm'
        }`}>
          {msg.content}
        </div>
        <p className="text-[10px] text-gray-400 px-1">
          {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────
export function TeamMessaging() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const myId = (user as any)?.id;

  const [view, setView] = useState<{ type: 'channel'; name: string } | { type: 'dm'; userId: string; userName: string }>({ type: 'channel', name: 'general' });
  const [draft, setDraft] = useState('');
  const [showCompose, setShowCompose] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: channels } = useQuery<Channel[]>({
    queryKey: ['team-channels'],
    queryFn: () => api.get('/api/v1/messages/channels').then((r) => r.data.data),
    refetchInterval: 10_000,
  });

  const { data: members } = useQuery<TeamMember[]>({
    queryKey: ['team-members'],
    queryFn: () => api.get('/api/v1/messages/team-members').then((r) => r.data.data),
  });

  const messagesKey = view.type === 'channel'
    ? ['channel-messages', view.name]
    : ['dm-messages', view.userId];

  const { data: messages, isLoading: msgsLoading } = useQuery<Message[]>({
    queryKey: messagesKey,
    queryFn: () => view.type === 'channel'
      ? api.get(`/api/v1/messages/channel/${view.name}`).then((r) => r.data.data)
      : api.get(`/api/v1/messages/dm/${view.userId}`).then((r) => r.data.data),
    refetchInterval: 5_000,
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMutation = useMutation({
    mutationFn: (content: string) => view.type === 'channel'
      ? api.post(`/api/v1/messages/channel/${view.name}`, { content })
      : api.post(`/api/v1/messages/dm/${view.userId}`, { content }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: messagesKey }); setDraft(''); },
  });

  const handleSend = () => {
    if (!draft.trim() || sendMutation.isPending) return;
    sendMutation.mutate(draft.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const filteredMembers = (members ?? []).filter((m) =>
    m.id !== myId &&
    (`${m.first_name} ${m.last_name ?? ''} ${m.email}`).toLowerCase().includes(memberSearch.toLowerCase())
  );

  const currentTitle = view.type === 'channel' ? `#${view.name}` : view.userName;

  return (
    <div className="flex h-full bg-gray-50 overflow-hidden">
      {/* ── Sidebar ── */}
      <div className="w-56 bg-slate-800 flex flex-col shrink-0 h-full">
        <div className="px-4 py-4 border-b border-slate-700">
          <p className="text-sm font-bold text-white">Team Messaging</p>
          <p className="text-xs text-slate-400 mt-0.5">Internal & External</p>
        </div>

        {/* Compose to customer */}
        <div className="px-3 pt-3">
          <button onClick={() => setShowCompose(true)}
            className="w-full flex items-center gap-2 px-3 py-2 bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium rounded-lg transition-colors">
            <ExternalLink className="w-3.5 h-3.5" /> Message Customer
          </button>
        </div>

        {/* Channels */}
        <div className="px-3 pt-4">
          <div className="flex items-center justify-between mb-1 px-1">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Channels</p>
          </div>
          <div className="space-y-0.5">
            {(channels ?? []).map((ch) => (
              <button key={ch.name}
                onClick={() => setView({ type: 'channel', name: ch.name })}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors text-left ${
                  view.type === 'channel' && view.name === ch.name
                    ? 'bg-brand-600/30 text-white font-medium'
                    : 'text-slate-400 hover:text-white hover:bg-slate-700'
                }`}>
                <Hash className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{ch.name}</span>
                {ch.message_count > 0 && (
                  <span className="ml-auto text-[10px] text-slate-500">{ch.message_count}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Direct Messages */}
        <div className="px-3 pt-4 flex-1 overflow-y-auto">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-1">Direct Messages</p>
          <div className="mb-2">
            <input value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)}
              placeholder="Search teammates..."
              className="w-full px-2 py-1.5 text-xs bg-slate-700 text-white rounded-lg outline-none placeholder-slate-500 border border-slate-600 focus:border-brand-400" />
          </div>
          <div className="space-y-0.5">
            {filteredMembers.map((m) => (
              <button key={m.id}
                onClick={() => setView({ type: 'dm', userId: m.id, userName: `${m.first_name} ${m.last_name ?? ''}`.trim() })}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors text-left ${
                  view.type === 'dm' && view.userId === m.id
                    ? 'bg-brand-600/30 text-white font-medium'
                    : 'text-slate-400 hover:text-white hover:bg-slate-700'
                }`}>
                <div className="w-5 h-5 rounded-full bg-slate-600 flex items-center justify-center shrink-0 text-[10px] font-bold text-white">
                  {m.first_name.charAt(0)}
                </div>
                <span className="truncate">{m.first_name} {m.last_name ?? ''}</span>
              </button>
            ))}
            {filteredMembers.length === 0 && memberSearch && (
              <p className="text-xs text-slate-500 px-2 py-2">No teammates found</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Main Chat Area ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            {view.type === 'channel'
              ? <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center"><Hash className="w-4 h-4 text-brand-600" /></div>
              : <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600">{view.userName.charAt(0)}</div>
            }
            <div>
              <p className="text-sm font-semibold text-gray-900">{currentTitle}</p>
              <p className="text-xs text-gray-400">
                {view.type === 'channel'
                  ? `${(members ?? []).length} members`
                  : 'Direct message'}
              </p>
            </div>
          </div>
          <button onClick={() => qc.invalidateQueries({ queryKey: messagesKey })}
            className="text-gray-400 hover:text-gray-600 p-1">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {msgsLoading && (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 text-brand-400 animate-spin" /></div>
          )}
          {!msgsLoading && (!messages || messages.length === 0) && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <MessageCircle className="w-12 h-12 mb-3 opacity-20" />
              <p className="text-sm font-medium text-gray-500 mb-1">
                {view.type === 'channel' ? `Start the conversation in #${view.name}` : `Start a conversation`}
              </p>
              <p className="text-xs">Be the first to say something!</p>
            </div>
          )}
          {(messages ?? []).map((msg) => (
            <MessageBubble key={msg.id} msg={msg} isMe={msg.sender_id === myId} />
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Compose bar */}
        <div className="bg-white border-t border-gray-100 px-4 py-3 shrink-0">
          <div className="flex items-end gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 focus-within:border-brand-400 transition-colors">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder={`Message ${currentTitle}`}
              className="flex-1 bg-transparent text-sm text-gray-800 outline-none resize-none placeholder-gray-400 leading-relaxed max-h-32"
              style={{ fieldSizing: 'content' } as any}
            />
            <button onClick={handleSend} disabled={!draft.trim() || sendMutation.isPending}
              className="shrink-0 w-8 h-8 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white rounded-lg flex items-center justify-center transition-colors">
              {sendMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            </button>
          </div>
          <p className="text-[10px] text-gray-400 mt-1.5 px-1">Press Enter to send · Shift+Enter for new line</p>
        </div>
      </div>

      {showCompose && <ExternalComposeModal onClose={() => setShowCompose(false)} />}
    </div>
  );
}
