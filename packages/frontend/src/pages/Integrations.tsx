import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Zap, Key, Webhook, Plus, Trash2, Copy, Check, X, Loader2,
  ChevronRight, CheckCircle2, AlertCircle, ExternalLink, Settings2,
  Mail, MessageSquare, Phone, Bot, CreditCard, Globe, ShieldCheck,
} from 'lucide-react';
import { api } from '../services/api';
import { useCan } from '../hooks/useRole';

// ── Category definitions ───────────────────────────────────────────────────
const SECTIONS = [
  {
    key: 'email',
    label: 'Email Configuration',
    icon: Mail,
    color: 'blue',
    description: 'Connect Gmail, Microsoft 365/Outlook, or any SMTP server to send emails to customers and team.',
    connectorIds: ['gmail', 'microsoft365', 'smtp', 'sendgrid'],
  },
  {
    key: 'sms',
    label: 'SMS Gateways',
    icon: MessageSquare,
    color: 'green',
    description: 'Send SMS ticket updates to customers. Supports Pakistan operators and international gateways.',
    connectorIds: ['twilio_sms', 'jazz_sms', 'telenor_sms', 'zong_sms', 'ufone_sms', 'http_sms'],
  },
  {
    key: 'voice',
    label: 'Telephony & Voice Bot',
    icon: Phone,
    color: 'purple',
    description: 'Connect your phone system and AI voice bot for inbound call handling and ticket creation.',
    connectorIds: ['twilio', 'vonage', 'vapi', 'retell', 'bland'],
  },
  {
    key: 'billing',
    label: 'Payments & Billing',
    icon: CreditCard,
    color: 'amber',
    description: 'Accept payments from customers. Supports international cards and Pakistan mobile wallets.',
    connectorIds: ['stripe', 'jazzcash', 'easypaisa', 'raast'],
  },
  {
    key: 'notify',
    label: 'Notifications',
    icon: Zap,
    color: 'indigo',
    description: 'Push CRM alerts and events to your team channels.',
    connectorIds: ['slack'],
  },
];

const COLOR_MAP: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  blue:   { bg: 'bg-blue-50',   border: 'border-blue-100',  text: 'text-blue-700',   icon: 'text-blue-500'   },
  green:  { bg: 'bg-green-50',  border: 'border-green-100', text: 'text-green-700',  icon: 'text-green-500'  },
  purple: { bg: 'bg-purple-50', border: 'border-purple-100',text: 'text-purple-700', icon: 'text-purple-500' },
  amber:  { bg: 'bg-amber-50',  border: 'border-amber-100', text: 'text-amber-700',  icon: 'text-amber-500'  },
  indigo: { bg: 'bg-indigo-50', border: 'border-indigo-100',text: 'text-indigo-700', icon: 'text-indigo-500' },
};

const ALL_EVENTS = [
  'contact.created','contact.updated','contact.deleted',
  'deal.created','deal.won','deal.lost','deal.stage_changed',
  'ticket.created','ticket.assigned','ticket.resolved','ticket.closed',
  'voice.call_completed','voice.call_transcribed',
  'activity.created','activity.completed',
  'billing.payment_succeeded','billing.payment_failed',
];

// ── Connector config modal ─────────────────────────────────────────────────
function ConnectorModal({ connector, onClose }: { connector: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>(connector.config ?? {});
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const saveMutation = useMutation({
    mutationFn: (body: Record<string, string>) =>
      api.put(`/api/v1/connectors/${connector.id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['connectors'] }); onClose(); },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => api.delete(`/api/v1/connectors/${connector.id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['connectors'] }); onClose(); },
  });

  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    try {
      const res = await api.post(`/api/v1/connectors/${connector.id}/test`);
      setTestResult({ ok: res.data.success, message: res.data.message });
    } catch (err: any) {
      setTestResult({ ok: false, message: err.response?.data?.error?.message ?? err.message });
    } finally { setTesting(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{connector.logo}</span>
            <div>
              <h2 className="font-semibold text-gray-900">{connector.name}</h2>
              <p className="text-xs text-gray-400">{connector.description}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {connector.id === 'microsoft365' && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-800 space-y-1.5">
              <p className="font-semibold">One-time Azure AD setup (5 minutes):</p>
              <ol className="list-decimal list-inside space-y-1 leading-relaxed">
                <li>Go to <a href="https://portal.azure.com" target="_blank" rel="noreferrer" className="underline font-medium">portal.azure.com</a> → Azure Active Directory → App registrations → New registration</li>
                <li>Name it (e.g. "CRM Email Sender"), click Register</li>
                <li>Copy the <strong>Application (client) ID</strong> and <strong>Directory (tenant) ID</strong></li>
                <li>Go to <strong>Certificates &amp; secrets</strong> → New client secret → copy the <strong>Value</strong></li>
                <li>Go to <strong>API permissions</strong> → Add → Microsoft Graph → Application permissions → search <code className="bg-blue-100 px-1 rounded">Mail.Send</code> → Add</li>
                <li>Click <strong>Grant admin consent</strong> for your organisation</li>
              </ol>
            </div>
          )}
          {connector.id === 'gmail' && (
            <div className="bg-yellow-50 border border-yellow-100 rounded-xl p-3 text-xs text-yellow-800 space-y-1">
              <p className="font-semibold">Gmail App Password required:</p>
              <ol className="list-decimal list-inside space-y-1 leading-relaxed">
                <li>Enable 2-Step Verification on your Google Account</li>
                <li>Go to <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="underline font-medium">myaccount.google.com/apppasswords</a></li>
                <li>Select app: Mail → device: Other → Generate</li>
                <li>Copy the 16-character password shown and paste it below</li>
              </ol>
            </div>
          )}
          {connector.id !== 'microsoft365' && connector.id !== 'gmail' && (
            <a href={connector.docsUrl} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-brand-600 hover:underline">
              <ExternalLink className="w-3.5 h-3.5" />
              Get credentials from {connector.name} dashboard
            </a>
          )}
          {connector.fields.map((field: any) => (
            <div key={field.key}>
              <label className="text-xs font-medium text-gray-600 mb-1 block">
                {field.label}{field.required && <span className="text-red-400 ml-0.5">*</span>}
              </label>
              <input
                type={field.secret ? 'password' : 'text'}
                value={form[field.key] ?? ''}
                onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                placeholder={field.placeholder}
                autoComplete="off"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400 font-mono"
              />
            </div>
          ))}
          {testResult && (
            <div className={`flex items-start gap-2 p-3 rounded-lg text-sm ${
              testResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            }`}>
              {testResult.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
              {testResult.message}
            </div>
          )}
        </div>

        <div className="px-6 pb-6 space-y-2">
          <div className="flex gap-2">
            <button onClick={handleTest} disabled={testing}
              className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 flex items-center justify-center gap-1.5">
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Settings2 className="w-3.5 h-3.5" />}
              Test Connection
            </button>
            <button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending}
              className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
              {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Save
            </button>
          </div>
          {connector.connected && (
            <button onClick={() => disconnectMutation.mutate()} disabled={disconnectMutation.isPending}
              className="w-full py-2 text-sm text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors">
              Disconnect {connector.name}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Connector card ─────────────────────────────────────────────────────────
function ConnectorCard({ conn, onConfigure, canEdit }: { conn: any; onConfigure: () => void; canEdit: boolean }) {
  return (
    <div className={`bg-white rounded-xl border p-4 flex items-center gap-3 hover:shadow-sm transition-all ${
      conn.connected ? 'border-green-200' : 'border-gray-100 hover:border-gray-200'
    }`}>
      <span className="text-2xl shrink-0">{conn.logo}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-gray-900">{conn.name}</p>
          {conn.connected && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded-full">
              <CheckCircle2 className="w-2.5 h-2.5" /> Connected
            </span>
          )}
        </div>
        <p className="text-xs text-gray-400 truncate mt-0.5">{conn.description}</p>
      </div>
      <button onClick={onConfigure} disabled={!canEdit}
        className="shrink-0 flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
        {conn.connected ? 'Edit' : 'Configure'}
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── External CRM / Call Centre API card ───────────────────────────────────
function ExternalApiCard() {
  return (
    <div className="bg-gradient-to-br from-gray-50 to-white rounded-xl border border-gray-200 border-dashed p-5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
          <Globe className="w-5 h-5 text-gray-500" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-gray-900">Using your own CRM or Call Centre?</p>
          <p className="text-xs text-gray-500 mt-1 leading-relaxed">
            If your organisation already has an existing CRM, call centre solution, or any third-party platform,
            you can push tickets, contacts, and events into AmanahCX using our REST API or inbound webhooks.
            All preferred channel settings (Email, SMS, WhatsApp) apply to all tickets regardless of source.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <a href="/docs" target="_blank"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 bg-brand-50 hover:bg-brand-100 border border-brand-100 px-3 py-1.5 rounded-lg transition-colors">
              <Key className="w-3.5 h-3.5" /> API Docs
            </a>
            <a href="#" onClick={(e) => { e.preventDefault(); document.getElementById('tab-api-keys')?.click(); }}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-200 px-3 py-1.5 rounded-lg transition-colors">
              <ShieldCheck className="w-3.5 h-3.5" /> Generate API Key
            </a>
            <a href="#" onClick={(e) => { e.preventDefault(); document.getElementById('tab-webhooks')?.click(); }}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-200 px-3 py-1.5 rounded-lg transition-colors">
              <Webhook className="w-3.5 h-3.5" /> Set Up Webhooks
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────
type Tab = 'connectors' | 'webhooks' | 'api-keys';

export function Integrations() {
  const qc = useQueryClient();
  const can = useCan();
  const [tab, setTab] = useState<Tab>('connectors');
  const [activeConnector, setActiveConnector] = useState<any | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showCreateWebhook, setShowCreateWebhook] = useState(false);
  const [showCreateKey, setShowCreateKey] = useState(false);
  const [newKey, setNewKey] = useState<{ key: string; name: string } | null>(null);
  const [webhookForm, setWebhookForm] = useState({ name: '', url: '', events: [] as string[] });
  const [keyForm, setKeyForm] = useState({ name: '', scopes: [] as string[] });

  const { data: connectors, isLoading } = useQuery({
    queryKey: ['connectors'],
    queryFn: () => api.get('/api/v1/connectors').then((r) => r.data.data),
  });
  const { data: webhooks } = useQuery({
    queryKey: ['webhooks'],
    queryFn: () => api.get('/api/v1/webhooks').then((r) => r.data.data),
  });
  const { data: apiKeys } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => api.get('/api/v1/api-keys').then((r) => r.data.data),
  });
  const { data: scopes } = useQuery({
    queryKey: ['api-scopes'],
    queryFn: () => api.get('/api/v1/api-keys/scopes').then((r) => r.data.data),
  });

  const createWebhookMutation = useMutation({
    mutationFn: (body: any) => api.post('/api/v1/webhooks', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['webhooks'] }); setShowCreateWebhook(false); setWebhookForm({ name: '', url: '', events: [] }); },
  });
  const deleteWebhookMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/webhooks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
  });
  const createKeyMutation = useMutation({
    mutationFn: (body: any) => api.post('/api/v1/api-keys', body),
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: ['api-keys'] }); setNewKey({ key: res.data.data.key, name: res.data.data.name }); setShowCreateKey(false); },
  });
  const revokeKeyMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/api-keys/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  });

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };
  const toggleEvent = (evt: string) => setWebhookForm((f) => ({ ...f, events: f.events.includes(evt) ? f.events.filter((e) => e !== evt) : [...f.events, evt] }));
  const toggleScope = (scope: string) => setKeyForm((f) => ({ ...f, scopes: f.scopes.includes(scope) ? f.scopes.filter((s) => s !== scope) : [...f.scopes, scope] }));

  const connectedCount = (connectors ?? []).filter((c: any) => c.connected).length;

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white px-6 py-4 border-b border-gray-100 shrink-0">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-lg font-semibold text-gray-900">Integrations & Configuration</h1>
          {connectedCount > 0 && (
            <span className="text-xs text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-full font-medium">
              {connectedCount} connected
            </span>
          )}
        </div>
        <p className="text-xs text-gray-400 mb-3">Configure every communication channel, payment gateway, and external system connection.</p>
        <div className="flex gap-1">
          {[
            { key: 'connectors', label: 'Channels & Services', icon: Zap },
            { key: 'webhooks',   label: `Webhooks${webhooks?.length ? ` (${webhooks.length})` : ''}`, icon: Webhook, id: 'tab-webhooks' },
            { key: 'api-keys',   label: `API Keys${apiKeys?.length ? ` (${apiKeys.length})` : ''}`, icon: Key, id: 'tab-api-keys' },
          ].map(({ key, label, icon: Icon, id }: any) => (
            <button key={key} id={id} onClick={() => setTab(key as Tab)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg transition-colors ${
                tab === key ? 'bg-brand-100 text-brand-700 font-medium' : 'text-gray-500 hover:bg-gray-100'
              }`}>
              <Icon className="w-3.5 h-3.5" />{label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">

        {/* ── CONNECTORS TAB ── */}
        {tab === 'connectors' && (
          <div className="max-w-4xl space-y-6">
            {isLoading && <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 text-brand-400 animate-spin" /></div>}

            {SECTIONS.map((section) => {
              const SectionIcon = section.icon;
              const colors = COLOR_MAP[section.color];
              const items = (connectors ?? []).filter((c: any) => section.connectorIds.includes(c.id));
              const connectedInSection = items.filter((c: any) => c.connected).length;

              return (
                <div key={section.key} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                  {/* Section header */}
                  <div className={`px-5 py-4 border-b ${colors.bg} ${colors.border}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colors.bg} border ${colors.border}`}>
                          <SectionIcon className={`w-4 h-4 ${colors.icon}`} />
                        </div>
                        <div>
                          <h3 className={`text-sm font-semibold ${colors.text}`}>{section.label}</h3>
                          <p className="text-xs text-gray-500">{section.description}</p>
                        </div>
                      </div>
                      {connectedInSection > 0 && (
                        <span className="text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                          {connectedInSection}/{items.length} active
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Connector cards */}
                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                    {items.length === 0 && (
                      <p className="text-xs text-gray-400 py-2 col-span-2">No connectors available for this category.</p>
                    )}
                    {items.map((conn: any) => (
                      <ConnectorCard key={conn.id} conn={conn}
                        onConfigure={() => setActiveConnector(conn)}
                        canEdit={can.manageWorkspace} />
                    ))}
                  </div>
                </div>
              );
            })}

            {/* External CRM / Call Centre integration card */}
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="px-5 py-4 border-b bg-gray-50 border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
                    <Globe className="w-4 h-4 text-gray-500" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700">External CRM & Call Centre API</h3>
                    <p className="text-xs text-gray-500">Connect your existing systems via REST API or inbound webhooks</p>
                  </div>
                </div>
              </div>
              <div className="p-4">
                <ExternalApiCard />
              </div>
            </div>
          </div>
        )}

        {/* ── WEBHOOKS TAB ── */}
        {tab === 'webhooks' && (
          <div className="max-w-2xl space-y-4">
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-700">
              <p className="font-medium mb-1">Inbound & Outbound Webhooks</p>
              <p className="text-xs leading-relaxed">
                Outbound webhooks fire when events happen in AmanahCX — your external CRM or call centre receives them in real time.
                For inbound (pushing data into AmanahCX), use the REST API with an API Key.
              </p>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">Subscribed to {webhooks?.length ?? 0} event stream{webhooks?.length !== 1 ? 's' : ''}.</p>
              {can.manageIntegrations && (
                <button onClick={() => setShowCreateWebhook(true)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700">
                  <Plus className="w-4 h-4" /> Add Webhook
                </button>
              )}
            </div>
            {(webhooks ?? []).map((wh: any) => (
              <div key={wh.id} className="bg-white rounded-xl border border-gray-100 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900">{wh.name}</p>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${wh.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {wh.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 font-mono mt-0.5 truncate">{wh.url}</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {wh.events.map((e: string) => (
                        <span key={e} className="text-xs bg-gray-50 text-gray-600 px-1.5 py-0.5 rounded font-mono">{e}</span>
                      ))}
                    </div>
                  </div>
                  {can.manageIntegrations && (
                    <button onClick={() => deleteWebhookMutation.mutate(wh.id)} className="text-gray-300 hover:text-red-500 p-1 shrink-0">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {(!webhooks || webhooks.length === 0) && (
              <div className="text-center py-12 text-gray-400">
                <Webhook className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No webhooks configured yet</p>
              </div>
            )}
          </div>
        )}

        {/* ── API KEYS TAB ── */}
        {tab === 'api-keys' && (
          <div className="max-w-2xl space-y-4">
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-sm text-amber-800">
              <p className="font-medium mb-1">API Keys — for external CRM & call centre integrations</p>
              <p className="text-xs leading-relaxed">
                Use API keys to authenticate your existing CRM, call centre, IVR system, or any third-party tool.
                Pass the key as <code className="bg-amber-100 px-1 rounded font-mono">Authorization: ApiKey YOUR_KEY</code>.
                All channels (Email / SMS / WhatsApp) respect the ticket's preferred_channel setting regardless of source.
              </p>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">{apiKeys?.length ?? 0} active key{apiKeys?.length !== 1 ? 's' : ''}.</p>
              {can.manageIntegrations && (
                <button onClick={() => setShowCreateKey(true)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700">
                  <Plus className="w-4 h-4" /> Create Key
                </button>
              )}
            </div>
            {newKey && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-amber-800 mb-2">⚠️ Copy your key now — it won't be shown again</p>
                <div className="flex items-center gap-2 bg-white border border-amber-200 rounded-lg px-3 py-2">
                  <code className="text-xs text-gray-800 flex-1 font-mono truncate">{newKey.key}</code>
                  <button onClick={() => copyToClipboard(newKey.key, 'new')} className="text-amber-600 hover:text-amber-700 shrink-0">
                    {copiedKey === 'new' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <button onClick={() => setNewKey(null)} className="text-xs text-amber-600 hover:underline mt-2">I've saved it</button>
              </div>
            )}
            {(apiKeys ?? []).map((key: any) => (
              <div key={key.id} className="bg-white rounded-xl border border-gray-100 p-4 flex items-center gap-3">
                <Key className="w-4 h-4 text-gray-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{key.name}</p>
                  <p className="text-xs font-mono text-gray-400">{key.key_prefix}••••••••••••</p>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {key.scopes.map((s: string) => <span key={s} className="text-xs bg-brand-50 text-brand-600 px-1.5 py-0.5 rounded">{s}</span>)}
                  </div>
                </div>
                <div className="text-right shrink-0 space-y-1">
                  {key.last_used_at && <p className="text-xs text-gray-400">Used {new Date(key.last_used_at).toLocaleDateString()}</p>}
                  {can.manageIntegrations && (
                    <button onClick={() => revokeKeyMutation.mutate(key.id)} className="text-xs text-red-500 hover:text-red-600">Revoke</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {activeConnector && <ConnectorModal connector={activeConnector} onClose={() => setActiveConnector(null)} />}

      {showCreateWebhook && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-gray-900">New Webhook</h2>
              <button onClick={() => setShowCreateWebhook(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Name</label>
                <input value={webhookForm.name} onChange={(e) => setWebhookForm({ ...webhookForm, name: e.target.value })}
                  placeholder="e.g. Salesforce Sync"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Endpoint URL</label>
                <input value={webhookForm.url} onChange={(e) => setWebhookForm({ ...webhookForm, url: e.target.value })}
                  placeholder="https://hooks.example.com/..."
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-2 block">Events to subscribe</label>
                <div className="space-y-1 max-h-48 overflow-y-auto border border-gray-100 rounded-lg p-2">
                  {ALL_EVENTS.map((evt) => (
                    <label key={evt} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer">
                      <input type="checkbox" checked={webhookForm.events.includes(evt)} onChange={() => toggleEvent(evt)} className="accent-brand-600" />
                      <span className="text-xs text-gray-700 font-mono">{evt}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button onClick={() => setShowCreateWebhook(false)} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={() => createWebhookMutation.mutate(webhookForm)}
                disabled={!webhookForm.name || !webhookForm.url || webhookForm.events.length === 0 || createWebhookMutation.isPending}
                className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {createWebhookMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Create Webhook
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreateKey && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-gray-900">Create API Key</h2>
              <button onClick={() => setShowCreateKey(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Key Name</label>
                <input value={keyForm.name} onChange={(e) => setKeyForm({ ...keyForm, name: e.target.value })}
                  placeholder="e.g. Salesforce Integration"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-2 block">Permissions (Scopes)</label>
                <div className="space-y-1 max-h-48 overflow-y-auto border border-gray-100 rounded-lg p-2">
                  {(scopes ?? []).map((s: any) => (
                    <label key={s.scope} className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer">
                      <input type="checkbox" checked={keyForm.scopes.includes(s.scope)} onChange={() => toggleScope(s.scope)} className="accent-brand-600 mt-0.5" />
                      <div>
                        <p className="text-xs font-mono text-gray-800">{s.scope}</p>
                        <p className="text-xs text-gray-400">{s.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button onClick={() => setShowCreateKey(false)} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={() => createKeyMutation.mutate(keyForm)}
                disabled={!keyForm.name || keyForm.scopes.length === 0 || createKeyMutation.isPending}
                className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {createKeyMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Generate Key
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
