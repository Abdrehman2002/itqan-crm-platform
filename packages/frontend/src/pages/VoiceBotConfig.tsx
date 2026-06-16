/**
 * Voice Bot Configuration page
 *
 * Phase 1 — Connect a third-party AI voice provider (Vapi, Retell, Bland.ai)
 * that handles SIP connectivity and customer calls.
 *
 * Layout:
 *  • Provider selector cards (Vapi / Retell AI / Bland.ai)
 *  • Step-by-step setup guide per provider
 *  • Webhook URL (copy-to-clipboard) to paste into provider dashboard
 *  • Bot behaviour settings (greeting, system prompt, language, voice ID)
 *  • Ticket creation rules (auto-create, default queue, priority, urgency keywords)
 *  • Test call button — dials a number to verify the integration
 *  • Live stats strip (total calls, tickets auto-created, avg duration)
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bot, Phone, Copy, CheckCircle2, ChevronRight, ExternalLink,
  Settings2, Ticket, Zap, AlertCircle, Loader2, PhoneCall,
  Info, ToggleLeft, ToggleRight, ChevronDown, List,
} from 'lucide-react';
import { api } from '../services/api';

// ── Types ─────────────────────────────────────────────────────────────────

interface IvrOption {
  option:      number;
  intent:      'complaint' | 'inquiry' | 'sales' | 'agent';
  label:       string;
  ticketType?: 'complaint' | 'inquiry' | 'sales';
  queueId?:    string | null;
  description?: string;
}

interface BotConfig {
  id?: string;
  provider: string;
  is_active: boolean;
  assistant_id?: string;
  phone_number?: string;
  greeting_message?: string;
  system_prompt?: string;
  language: string;
  voice_id?: string;
  auto_create_ticket: boolean;
  default_queue_id?: string;
  default_priority: string;
  keyword_urgency: string[];
  queue_name?: string;
}

interface TicketQueue { id: string; name: string; }

interface WebhookUrls { vapi: string; retell: string; bland: string; }

interface Stats {
  summary: {
    total_calls: string;
    calls_with_tickets: string;
    avg_duration: string;
    unique_callers: string;
    urgent_calls: string;
  };
}

// ── Provider definitions ──────────────────────────────────────────────────

const PROVIDERS = [
  {
    id: 'vapi',
    name: 'Vapi',
    tagline: 'The developer platform for voice AI',
    description: 'Build, test and deploy AI voice agents. Best-in-class LLM routing and real-time transcription.',
    logo: '🤖',
    color: '#7c3aed',
    docsUrl: 'https://docs.vapi.ai',
    dashboardUrl: 'https://dashboard.vapi.ai',
    setupSteps: [
      'Create an account at dashboard.vapi.ai',
      'Build an assistant — set system prompt, voice model and language',
      'Under "Phone Numbers" → add a number and link it to your assistant',
      'Copy your API Key and Assistant ID from the dashboard',
      'Paste them in the Connectors page (Integrations → Vapi)',
      'Copy the Webhook URL below and paste it in Vapi → Assistant → Server URL',
    ],
  },
  {
    id: 'retell',
    name: 'Retell AI',
    tagline: 'Human-like AI phone agents',
    description: 'Production-ready voice agents with ultra-low latency. Built-in sentiment analysis and call summaries.',
    logo: '📲',
    color: '#0891b2',
    docsUrl: 'https://docs.retellai.com',
    dashboardUrl: 'https://app.retellai.com',
    setupSteps: [
      'Sign up at app.retellai.com',
      'Create an Agent — configure LLM, voice and response rules',
      'Under "Phone Numbers" → purchase/import a number and link to the agent',
      'Copy your API Key and Agent ID',
      'Paste them in the Connectors page (Integrations → Retell AI)',
      'Copy the Webhook URL below and set it in Retell → Agent → Webhook',
    ],
  },
  {
    id: 'bland',
    name: 'Bland.ai',
    tagline: 'AI phone calls at scale',
    description: 'High-volume inbound & outbound AI calls. Supports complex call flows and custom voices.',
    logo: '📣',
    color: '#059669',
    docsUrl: 'https://docs.bland.ai',
    dashboardUrl: 'https://app.bland.ai',
    setupSteps: [
      'Create an account at app.bland.ai',
      'Navigate to "Inbound" → create a new pathway for customer support',
      'Purchase or port your helpline number and attach it to the pathway',
      'Copy your API Key from the dashboard',
      'Paste it in the Connectors page (Integrations → Bland.ai)',
      'Copy the Webhook URL below and set it in Bland → Settings → Webhooks',
    ],
  },
];

// ── Reusable input style ──────────────────────────────────────────────────

const inputCls = "w-full bg-gray-900/60 border border-gray-700/60 text-gray-200 placeholder-gray-600 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand-500/60 transition-colors";

// ── Copy button ───────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border border-white/10 hover:border-brand-500/50 text-gray-400 hover:text-brand-300"
    >
      {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// ── Stats strip ───────────────────────────────────────────────────────────

function StatsStrip({ stats }: { stats?: Stats }) {
  const s = stats?.summary;
  const items = [
    { label: 'Total calls', value: s?.total_calls ?? '—', color: 'text-white' },
    { label: 'Tickets auto-created', value: s?.calls_with_tickets ?? '—', color: 'text-brand-400' },
    { label: 'Avg duration', value: s?.avg_duration ? `${Math.round(parseFloat(s.avg_duration))}s` : '—', color: 'text-white' },
    { label: 'Unique callers', value: s?.unique_callers ?? '—', color: 'text-white' },
    { label: 'Urgent calls', value: s?.urgent_calls ?? '—', color: 'text-orange-400' },
  ];
  return (
    <div className="grid grid-cols-5 gap-3 mb-6">
      {items.map(({ label, value, color }) => (
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

export function VoiceBotConfig() {
  const qc = useQueryClient();
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState<string | null>(null);
  const [testNumber, setTestNumber] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [formState, setFormState] = useState<Partial<BotConfig>>({});
  const [editMode, setEditMode] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const { data: configs } = useQuery<BotConfig[]>({
    queryKey: ['voice-bot-configs'],
    queryFn: async () => { const r = await api.get('/api/v1/voice-bot/config'); return r.data.data; },
  });

  const { data: webhookUrls } = useQuery<WebhookUrls>({
    queryKey: ['voice-bot-webhook-urls'],
    queryFn: async () => { const r = await api.get('/api/v1/voice-bot/webhook-url'); return r.data.data; },
  });

  const { data: stats } = useQuery<Stats>({
    queryKey: ['voice-bot-stats'],
    queryFn: async () => { const r = await api.get('/api/v1/voice-bot/stats'); return r.data.data; },
    staleTime: 60_000,
  });

  const { data: queues } = useQuery<TicketQueue[]>({
    queryKey: ['ticket-queues-mini'],
    queryFn: async () => { const r = await api.get('/api/v1/tickets/queues'); return r.data.data; },
  });

  const saveMut = useMutation({
    mutationFn: async (body: Partial<BotConfig>) => {
      const r = await api.put('/api/v1/voice-bot/config', {
        provider:         body.provider,
        isActive:         body.is_active,
        assistantId:      body.assistant_id,
        phoneNumber:      body.phone_number,
        greetingMessage:  body.greeting_message,
        systemPrompt:     body.system_prompt,
        language:         body.language,
        voiceId:          body.voice_id,
        autoCreateTicket: body.auto_create_ticket,
        defaultQueueId:   body.default_queue_id || null,
        defaultPriority:  body.default_priority,
        keywordUrgency:   body.keyword_urgency,
        ivrMenu:          body.ivr_menu,
        sipUri:           body.sip_uri,
      });
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['voice-bot-configs'] });
      setSaveMsg('Configuration saved!');
      setEditMode(false);
      setTimeout(() => setSaveMsg(''), 3000);
    },
  });

  const testMut = useMutation({
    mutationFn: async () => {
      const r = await api.post('/api/v1/voice-bot/test-call', {
        provider: selectedProvider,
        toNumber: testNumber,
      });
      return r.data;
    },
    onSuccess: (data) => {
      setTestResult(data.success ? '✅ Test call initiated successfully!' : `❌ ${data.error?.message ?? 'Failed'}`);
    },
    onError: (err: any) => {
      setTestResult(`❌ ${err.response?.data?.error?.message ?? 'Failed to initiate call'}`);
    },
  });

  const activeConfig = configs?.find(c => c.provider === selectedProvider);

  const startEdit = (cfg?: BotConfig) => {
    setFormState(cfg ?? {
      provider: selectedProvider ?? 'vapi',
      is_active: true,
      language: 'en-US',
      auto_create_ticket: true,
      default_priority: 'medium',
      keyword_urgency: ['urgent','emergency','critical','asap','immediately'],
    });
    setEditMode(true);
  };

  return (
    <div className="min-h-screen p-6" style={{ background: '#0d1117' }}>
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                 style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #4D8B3C 100%)' }}>
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-white font-bold text-xl">Voice Bot</h1>
              <p className="text-gray-500 text-xs">Phase 1 — Third-party AI provider integration via SIP</p>
            </div>
          </div>
          <a href="/voice-bot/calls"
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm text-brand-300 border border-brand-700/50 hover:bg-brand-900/30 transition-colors">
            <List className="w-4 h-4" />View Bot Calls
          </a>
        </div>

        {/* Stats strip */}
        <StatsStrip stats={stats} />

        {/* How it works banner */}
        <div className="mb-6 px-5 py-4 rounded-2xl border border-brand-700/30"
             style={{ background: 'rgba(41,171,226,0.06)' }}>
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-brand-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-white font-semibold text-sm mb-1">How Phase 1 works</p>
              <div className="flex items-center gap-2 flex-wrap text-xs text-gray-400">
                {[
                  'Customer calls your helpline',
                  'AI voice bot answers via SIP',
                  'Bot collects complaint details',
                  'Call ends → provider sends webhook',
                  'Ticket auto-created in CRM',
                  'Agent receives notification',
                ].map((step, i, arr) => (
                  <span key={step} className="flex items-center gap-2">
                    <span className="text-white/70">{step}</span>
                    {i < arr.length - 1 && <ChevronRight className="w-3 h-3 text-brand-600" />}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Provider selector */}
        <p className="text-xs text-gray-500 font-semibold uppercase tracking-widest mb-3">
          Select your AI voice provider
        </p>
        <div className="grid grid-cols-3 gap-4 mb-6">
          {PROVIDERS.map(p => {
            const hasConfig = configs?.some(c => c.provider === p.id && c.is_active);
            const isSelected = selectedProvider === p.id;
            return (
              <button key={p.id}
                onClick={() => { setSelectedProvider(p.id); setEditMode(false); setTestResult(null); }}
                className={`text-left p-4 rounded-2xl border transition-all ${
                  isSelected
                    ? 'border-brand-500 ring-1 ring-brand-500/30'
                    : 'border-white/10 hover:border-white/20'
                }`}
                style={{ background: isSelected ? 'rgba(41,171,226,0.08)' : 'rgba(255,255,255,0.03)' }}
              >
                <div className="flex items-start justify-between mb-3">
                  <span className="text-3xl">{p.logo}</span>
                  <div className="flex items-center gap-2">
                    {hasConfig && (
                      <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-900/40 border border-emerald-700/50 px-2 py-0.5 rounded-full">
                        <CheckCircle2 className="w-3 h-3" /> Active
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-white font-bold text-sm">{p.name}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{p.tagline}</p>
                <p className="text-[11px] text-gray-600 mt-2 line-clamp-2">{p.description}</p>
                <a href={p.docsUrl} target="_blank" rel="noreferrer"
                   onClick={e => e.stopPropagation()}
                   className="inline-flex items-center gap-1 text-[10px] text-brand-400 hover:text-brand-300 mt-2">
                  Docs <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </button>
            );
          })}
        </div>

        {selectedProvider && (() => {
          const pDef = PROVIDERS.find(p => p.id === selectedProvider)!;
          return (
            <div className="space-y-5">

              {/* Webhook URL */}
              <div className="rounded-2xl border border-white/10 p-5"
                   style={{ background: 'rgba(255,255,255,0.03)' }}>
                <div className="flex items-center gap-2 mb-4">
                  <Zap className="w-4 h-4 text-brand-400" />
                  <h3 className="text-white font-semibold text-sm">Webhook URL</h3>
                  <span className="text-xs text-gray-500">— paste this into {pDef.name}'s dashboard</span>
                </div>
                <div className="flex items-center gap-2 p-3 rounded-xl border border-dashed border-brand-600/40"
                     style={{ background: 'rgba(41,171,226,0.05)' }}>
                  <code className="flex-1 text-xs text-brand-300 break-all font-mono">
                    {(webhookUrls as any)?.[selectedProvider] ?? 'Loading…'}
                  </code>
                  {(webhookUrls as any)?.[selectedProvider] && (
                    <CopyButton text={(webhookUrls as any)[selectedProvider]} />
                  )}
                </div>
              </div>

              {/* Setup guide */}
              <div className="rounded-2xl border border-white/10 overflow-hidden"
                   style={{ background: 'rgba(255,255,255,0.03)' }}>
                <button
                  onClick={() => setShowGuide(showGuide === selectedProvider ? null : selectedProvider)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Info className="w-4 h-4 text-brand-400" />
                    <span className="text-white font-semibold text-sm">Step-by-step setup for {pDef.name}</span>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${showGuide === selectedProvider ? 'rotate-180' : ''}`} />
                </button>
                {showGuide === selectedProvider && (
                  <div className="px-5 pb-5 border-t border-white/10">
                    <ol className="mt-4 space-y-3">
                      {pDef.setupSteps.map((step, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <span className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-white"
                                style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #4D8B3C 100%)' }}>
                            {i + 1}
                          </span>
                          <p className="text-sm text-gray-300 pt-0.5">{step}</p>
                        </li>
                      ))}
                    </ol>
                    <a href={pDef.dashboardUrl} target="_blank" rel="noreferrer"
                       className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-xl text-sm font-semibold text-white border border-white/10 hover:bg-white/5 transition-colors">
                      Open {pDef.name} Dashboard <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}
              </div>

              {/* Bot configuration */}
              <div className="rounded-2xl border border-white/10 p-5"
                   style={{ background: 'rgba(255,255,255,0.03)' }}>
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2">
                    <Settings2 className="w-4 h-4 text-brand-400" />
                    <h3 className="text-white font-semibold text-sm">Bot Configuration</h3>
                  </div>
                  {!editMode && (
                    <button onClick={() => startEdit(activeConfig)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-brand-300 border border-brand-700/50 hover:bg-brand-900/30 transition-colors">
                      {activeConfig ? 'Edit' : 'Configure'}
                    </button>
                  )}
                </div>

                {editMode ? (
                  <div className="space-y-4">
                    {/* Active toggle */}
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-300">Active</span>
                      <button onClick={() => setFormState(f => ({ ...f, is_active: !f.is_active }))}>
                        {formState.is_active
                          ? <ToggleRight className="w-8 h-8 text-brand-400" />
                          : <ToggleLeft  className="w-8 h-8 text-gray-600"  />}
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">
                          {selectedProvider === 'vapi' ? 'Assistant ID' : selectedProvider === 'retell' ? 'Agent ID' : 'Pathway ID'} *
                        </label>
                        <input type="text" placeholder="From provider dashboard"
                          value={formState.assistant_id ?? ''}
                          onChange={e => setFormState(f => ({ ...f, assistant_id: e.target.value }))}
                          className={inputCls} />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Helpline Phone Number</label>
                        <input type="text" placeholder="+923001234567"
                          value={formState.phone_number ?? ''}
                          onChange={e => setFormState(f => ({ ...f, phone_number: e.target.value }))}
                          className={inputCls} />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Language</label>
                        <select value={formState.language ?? 'en-US'}
                          onChange={e => setFormState(f => ({ ...f, language: e.target.value }))}
                          className={`${inputCls} appearance-none`}>
                          {[
                            ['en-US', 'English (US)'], ['en-GB', 'English (UK)'],
                            ['ur-PK', 'Urdu (Pakistan)'], ['ar-SA', 'Arabic'],
                            ['fr-FR', 'French'], ['es-ES', 'Spanish'],
                            ['hi-IN', 'Hindi'],
                          ].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Voice ID (optional)</label>
                        <input type="text" placeholder="Provider-specific voice ID"
                          value={formState.voice_id ?? ''}
                          onChange={e => setFormState(f => ({ ...f, voice_id: e.target.value }))}
                          className={inputCls} />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Greeting Message</label>
                      <input type="text"
                        placeholder="Hello! You've reached our support line. How can I help you today?"
                        value={formState.greeting_message ?? ''}
                        onChange={e => setFormState(f => ({ ...f, greeting_message: e.target.value }))}
                        className={inputCls} />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-500 mb-1">
                        System Prompt
                        <span className="ml-1 text-gray-600">(additional instructions for the AI)</span>
                      </label>
                      <textarea rows={5}
                        placeholder={`You are a professional customer support agent for our company.\n\nYour goal is to:\n1. Greet the caller warmly\n2. Collect their name, contact number, and nature of the complaint\n3. Understand the urgency of the issue\n4. Summarise the issue clearly at the end\n\nAlways be polite and empathetic.`}
                        value={formState.system_prompt ?? ''}
                        onChange={e => setFormState(f => ({ ...f, system_prompt: e.target.value }))}
                        className={`${inputCls} resize-none text-xs font-mono`} />
                    </div>

                    {/* Ticket creation rules */}
                    <div className="border-t border-white/10 pt-4">
                      <div className="flex items-center gap-2 mb-4">
                        <Ticket className="w-4 h-4 text-brand-400" />
                        <span className="text-sm text-white font-semibold">Ticket Creation Rules</span>
                      </div>

                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <p className="text-sm text-gray-300">Auto-create ticket after every call</p>
                          <p className="text-xs text-gray-600 mt-0.5">A ticket is created in CRM as soon as the call ends</p>
                        </div>
                        <button onClick={() => setFormState(f => ({ ...f, auto_create_ticket: !f.auto_create_ticket }))}>
                          {formState.auto_create_ticket
                            ? <ToggleRight className="w-8 h-8 text-brand-400" />
                            : <ToggleLeft  className="w-8 h-8 text-gray-600"  />}
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Default Queue</label>
                          <select value={formState.default_queue_id ?? ''}
                            onChange={e => setFormState(f => ({ ...f, default_queue_id: e.target.value || undefined }))}
                            className={`${inputCls} appearance-none`}>
                            <option value="">Auto (default queue)</option>
                            {queues?.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Default Priority</label>
                          <select value={formState.default_priority ?? 'medium'}
                            onChange={e => setFormState(f => ({ ...f, default_priority: e.target.value }))}
                            className={`${inputCls} appearance-none`}>
                            <option value="urgent">Urgent</option>
                            <option value="high">High</option>
                            <option value="medium">Medium</option>
                            <option value="low">Low</option>
                          </select>
                        </div>
                      </div>

                      <div className="mt-3">
                        <label className="block text-xs text-gray-500 mb-1">
                          Urgency keywords
                          <span className="ml-1 text-gray-600">(comma-separated — escalate to Urgent priority)</span>
                        </label>
                        <input type="text"
                          value={(formState.keyword_urgency ?? []).join(', ')}
                          onChange={e => setFormState(f => ({
                            ...f,
                            keyword_urgency: e.target.value.split(',').map(s => s.trim()).filter(Boolean),
                          }))}
                          placeholder="urgent, emergency, critical, asap"
                          className={inputCls} />
                      </div>
                    </div>


                      {/* IVR Menu Builder */}
                      <div className="mt-4 border-t border-white/10 pt-4">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <p className="text-xs font-semibold text-white">IVR Menu Options</p>
                            <p className="text-xs text-gray-500 mt-0.5">Define what options are presented to the caller</p>
                          </div>
                          <button type="button"
                            onClick={() => setFormState(f => ({
                              ...f,
                              ivr_menu: [...(f.ivr_menu ?? []), {
                                option: (f.ivr_menu?.length ?? 0) + 1,
                                intent: 'complaint' as const,
                                label: 'New option',
                                ticketType: 'complaint' as const,
                                queueId: null,
                              }],
                            }))}
                            className="text-xs px-2.5 py-1 rounded-lg border border-brand-400/40 text-brand-400 hover:bg-brand-400/10">
                            + Add Option
                          </button>
                        </div>
                        <div className="space-y-2">
                          {(formState.ivr_menu ?? [
                            { option: 1, intent: 'complaint', label: 'Register a complaint',         ticketType: 'complaint', queueId: null },
                            { option: 2, intent: 'inquiry',   label: 'Product & service enquiries',  ticketType: 'inquiry',   queueId: null },
                            { option: 3, intent: 'sales',     label: 'Speak to a sales agent',       ticketType: 'sales',     queueId: null },
                          ]).map((opt: any, idx: number) => (
                            <div key={idx} className="flex items-center gap-2 bg-white/5 rounded-xl p-2.5">
                              <div className="w-7 h-7 rounded-full bg-brand-600/30 flex items-center justify-center text-brand-400 text-xs font-bold shrink-0">
                                {opt.option}
                              </div>
                              <input
                                value={opt.label}
                                onChange={e => {
                                  const menu = [...(formState.ivr_menu ?? [])];
                                  menu[idx] = { ...menu[idx], label: e.target.value };
                                  setFormState(f => ({ ...f, ivr_menu: menu }));
                                }}
                                className="flex-1 bg-transparent border border-white/10 rounded-lg px-2 py-1 text-xs text-white outline-none focus:border-brand-400/60"
                                placeholder="Option label..."
                              />
                              <select
                                value={opt.ticketType ?? opt.intent}
                                onChange={e => {
                                  const menu = [...(formState.ivr_menu ?? [])];
                                  menu[idx] = { ...menu[idx], ticketType: e.target.value as any, intent: e.target.value as any };
                                  setFormState(f => ({ ...f, ivr_menu: menu }));
                                }}
                                className="text-xs bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-white outline-none">
                                <option value="complaint">🎫 Complaint</option>
                                <option value="inquiry">💬 Inquiry</option>
                                <option value="sales">💼 Sales</option>
                                <option value="agent">👤 Live Agent</option>
                              </select>
                              <select
                                value={opt.queueId ?? ''}
                                onChange={e => {
                                  const menu = [...(formState.ivr_menu ?? [])];
                                  menu[idx] = { ...menu[idx], queueId: e.target.value || null };
                                  setFormState(f => ({ ...f, ivr_menu: menu }));
                                }}
                                className="text-xs bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-white outline-none">
                                <option value="">Default queue</option>
                                {(queues ?? []).map((q: any) => (
                                  <option key={q.id} value={q.id}>{q.name}</option>
                                ))}
                              </select>
                              <button type="button"
                                onClick={() => {
                                  const menu = (formState.ivr_menu ?? []).filter((_: any, i: number) => i !== idx);
                                  setFormState(f => ({ ...f, ivr_menu: menu }));
                                }}
                                className="text-gray-600 hover:text-red-400 p-0.5 shrink-0">
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* SIP URI */}
                      <div className="mt-3">
                        <label className="block text-xs text-gray-500 mb-1">SIP URI (optional)</label>
                        <input type="text"
                          value={formState.sip_uri ?? ''}
                          onChange={e => setFormState(f => ({ ...f, sip_uri: e.target.value }))}
                          placeholder="sip:helpline@yourprovider.com"
                          className={inputCls} />
                        <p className="text-xs text-gray-600 mt-1">SIP endpoint for direct PSTN/VoIP integration</p>
                      </div>

                    {/* Save / Cancel */}
                    <div className="flex items-center justify-between pt-2">
                      <button onClick={() => setEditMode(false)}
                        className="px-4 py-2 rounded-xl text-sm text-gray-400 hover:bg-white/5 transition-colors">
                        Cancel
                      </button>
                      <button
                        onClick={() => saveMut.mutate({ ...formState, provider: selectedProvider })}
                        disabled={saveMut.isPending}
                        className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
                        style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #1a8cbf 100%)' }}
                      >
                        {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        {saveMut.isPending ? 'Saving…' : 'Save Configuration'}
                      </button>
                    </div>
                  </div>
                ) : activeConfig ? (
                  /* Read-only summary */
                  <div className="space-y-3">
                    {[
                      { label: 'Assistant / Agent ID', value: activeConfig.assistant_id ?? '—' },
                      { label: 'Helpline Number',      value: activeConfig.phone_number  ?? '—' },
                      { label: 'Language',             value: activeConfig.language },
                      { label: 'Auto-create ticket',   value: activeConfig.auto_create_ticket ? 'Yes' : 'No' },
                      { label: 'Default priority',     value: activeConfig.default_priority },
                      { label: 'Default queue',        value: activeConfig.queue_name ?? 'Default queue' },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                        <span className="text-xs text-gray-500">{label}</span>
                        <span className="text-xs text-white font-medium">{value}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center py-8 gap-3">
                    <AlertCircle className="w-8 h-8 text-gray-600" />
                    <p className="text-gray-500 text-sm">Not configured yet</p>
                    <p className="text-gray-600 text-xs text-center max-w-xs">
                      Also make sure to add your {PROVIDERS.find(p => p.id === selectedProvider)?.name} API key in
                      the <a href="/integrations" className="text-brand-400 hover:underline">Integrations page</a>
                    </p>
                    <button onClick={() => startEdit()}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
                      style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #1a8cbf 100%)' }}>
                      Configure {PROVIDERS.find(p => p.id === selectedProvider)?.name}
                    </button>
                  </div>
                )}

                {saveMsg && (
                  <div className="mt-3 flex items-center gap-2 text-emerald-400 text-sm">
                    <CheckCircle2 className="w-4 h-4" /> {saveMsg}
                  </div>
                )}
              </div>

              {/* Test call */}
              {activeConfig && (
                <div className="rounded-2xl border border-white/10 p-5"
                     style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <div className="flex items-center gap-2 mb-4">
                    <PhoneCall className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-white font-semibold text-sm">Test Call</h3>
                    <span className="text-xs text-gray-500">— verify the integration end-to-end</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <input type="tel" placeholder="+923001234567 (your test number)"
                      value={testNumber}
                      onChange={e => setTestNumber(e.target.value)}
                      className={`${inputCls} flex-1`} />
                    <button
                      onClick={() => testMut.mutate()}
                      disabled={testMut.isPending || !testNumber}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40 shrink-0"
                      style={{ background: 'linear-gradient(135deg, #4D8B3C 0%, #3a6b2e 100%)' }}
                    >
                      {testMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
                      {testMut.isPending ? 'Calling…' : 'Initiate Test'}
                    </button>
                  </div>
                  {testResult && (
                    <p className={`mt-3 text-sm ${testResult.startsWith('✅') ? 'text-emerald-400' : 'text-red-400'}`}>
                      {testResult}
                    </p>
                  )}
                  <p className="text-xs text-gray-600 mt-2">
                    The AI bot will call the number above. When the call ends, a test ticket will be created automatically.
                  </p>
                </div>
              )}

            </div>
          );
        })()}

      </div>
    </div>
  );
}

