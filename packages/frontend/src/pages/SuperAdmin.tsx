/**
 * Super Admin — platform-wide workspace management
 *
 * Only accessible to users with role = 'super_admin'.
 * Lists all tenants, shows usage stats, allows creating workspaces,
 * updating plans, managing modules, suspending/activating tenants.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Shield, Plus, Search, MoreVertical, Users, TrendingUp,
  Loader2, X, Check, AlertTriangle, Building2, BarChart3,
  Package, Ban, Play,
} from 'lucide-react';
import { api } from '../services/api';
import { useIsSuperAdmin } from '../hooks/useRole';
import { Navigate } from 'react-router-dom';

const PLANS = ['free', 'starter', 'professional', 'enterprise'] as const;
const PLAN_COLORS: Record<string, string> = {
  free: 'bg-gray-100 text-gray-600',
  starter: 'bg-blue-50 text-blue-700',
  professional: 'bg-brand-50 text-brand-700',
  enterprise: 'bg-purple-50 text-purple-700',
};
const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-50 text-green-700',
  trial: 'bg-amber-50 text-amber-700',
  suspended: 'bg-red-50 text-red-600',
  cancelled: 'bg-gray-100 text-gray-500',
};

// Full module catalog — keep in sync with MODULE_CATALOG in super-admin.ts
const ALL_MODULES: Array<{ key: string; label: string; description: string; always?: boolean; icon: string }> = [
  { key: 'crm',          label: 'Core CRM',          icon: '🏢', description: 'Contacts, companies, deals, activities and analytics.',        always: true  },
  { key: 'ticketing',    label: 'Ticketing',          icon: '🎫', description: 'Support tickets, SLA, escalations, queues and CSAT surveys.'             },
  { key: 'voice',        label: 'Voice Calls',        icon: '📞', description: 'Inbound/outbound call logging, recordings and agent management.'         },
  { key: 'voicebot',     label: 'Voice Bot (AI)',     icon: '🤖', description: 'AI-powered SIP/IVR voice bot for automated interactions.'               },
  { key: 'emails',       label: 'Email Inbox',        icon: '📧', description: 'Shared team email inbox with assignment and SLA tracking.'              },
  { key: 'integrations', label: 'Integrations',       icon: '🔌', description: 'SMS gateways, webhooks, Zapier/Make and API bridges.'                  },
  { key: 'analytics',    label: 'Advanced Analytics', icon: '📊', description: 'Cross-module reports, heatmaps and performance dashboards.'             },
];

// ── Create Workspace Modal ─────────────────────────────────────────────────
function CreateWorkspaceModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', slug: '', plan: 'starter', adminEmail: '', adminName: '' });
  const [slugTouched, setSlugTouched] = useState(false);
  // Licensed modules — pre-select CRM only; super admin checks what they've sold
  const [selectedModules, setSelectedModules] = useState<string[]>(['crm']);
  const [step, setStep] = useState<'details' | 'modules'>('details');

  const mutation = useMutation({
    mutationFn: (payload: typeof form & { modules: string[] }) =>
      api.post('/super-admin/tenants', payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sa-tenants'] }); onClose(); },
  });

  const autoSlug = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const toggleModule = (key: string) => {
    if (key === 'crm') return; // always on
    setSelectedModules(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key],
    );
  };

  const detailsValid = form.name && form.slug && form.adminEmail && form.adminName;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-semibold text-gray-900">Create Workspace</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {step === 'details' ? 'Step 1 of 2 — Workspace details' : 'Step 2 of 2 — Licensed modules'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        {/* Step 1 — Details */}
        {step === 'details' && (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Company / Workspace Name</label>
              <input value={form.name}
                onChange={(e) => {
                  const name = e.target.value;
                  setForm({ ...form, name, slug: slugTouched ? form.slug : autoSlug(name) });
                }}
                placeholder="Acme Corp"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Slug (subdomain)</label>
              <div className="flex items-center border border-gray-200 rounded-lg focus-within:border-brand-400 overflow-hidden">
                <input value={form.slug}
                  onChange={(e) => { setSlugTouched(true); setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }); }}
                  placeholder="acme"
                  className="flex-1 px-3 py-2 text-sm outline-none" />
                <span className="px-3 py-2 text-xs text-gray-400 bg-gray-50 border-l border-gray-200">.crmplatform.io</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Admin Name</label>
                <input value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })}
                  placeholder="John Smith"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Plan</label>
                <select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400 capitalize">
                  {PLANS.map((p) => <option key={p} value={p} className="capitalize">{p}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Admin Email</label>
              <input value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
                type="email" placeholder="admin@acme.com"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
            </div>
          </div>
        )}

        {/* Step 2 — Module licensing */}
        {step === 'modules' && (
          <div>
            <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 mb-4">
              <p className="text-xs text-amber-700 flex items-start gap-1.5">
                <Package className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                Select only the modules this tenant has <strong>paid and agreed for</strong>. The tenant admin
                can enable/disable these for their users but cannot unlock modules not listed here.
              </p>
            </div>
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {ALL_MODULES.map((m) => {
                const isOn = selectedModules.includes(m.key);
                const locked = m.always;
                return (
                  <label key={m.key}
                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                      locked
                        ? 'bg-gray-50 border-gray-200 opacity-60 cursor-not-allowed'
                        : isOn
                        ? 'bg-brand-50 border-brand-200'
                        : 'bg-white border-gray-100 hover:border-gray-200'
                    }`}>
                    <input
                      type="checkbox"
                      checked={isOn}
                      disabled={locked}
                      onChange={() => toggleModule(m.key)}
                      className="accent-brand-600 shrink-0"
                    />
                    <span className="text-lg shrink-0">{m.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-800">{m.label}</p>
                        {locked && <span className="text-[10px] bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded-full">Always On</span>}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{m.description}</p>
                    </div>
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-gray-400 mt-3">
              {selectedModules.length} module{selectedModules.length !== 1 ? 's' : ''} selected
            </p>
          </div>
        )}

        {mutation.isError && (
          <p className="mt-3 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">
            {(mutation.error as any)?.response?.data?.error?.message ?? 'Failed to create workspace'}
          </p>
        )}

        <div className="flex gap-2 mt-6">
          {step === 'details' ? (
            <>
              <button onClick={onClose} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button
                onClick={() => setStep('modules')}
                disabled={!detailsValid}
                className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2">
                Next: Set Modules →
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setStep('details')} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">← Back</button>
              <button
                onClick={() => mutation.mutate({ ...form, modules: selectedModules })}
                disabled={mutation.isPending}
                className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Create Workspace
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tenant row actions popover ─────────────────────────────────────────────
function TenantActions({ tenant, onClose }: { tenant: any; onClose: () => void }) {
  const qc = useQueryClient();

  const planMutation = useMutation({
    mutationFn: ({ id, plan }: { id: string; plan: string }) =>
      api.patch(`/super-admin/tenants/${id}/plan`, { plan }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sa-tenants'] }); onClose(); },
  });

  const suspendMutation = useMutation({
    mutationFn: (id: string) => api.post(`/super-admin/tenants/${id}/suspend`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sa-tenants'] }); onClose(); },
  });

  const activateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/super-admin/tenants/${id}/activate`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sa-tenants'] }); onClose(); },
  });

  const modulesMutation = useMutation({
    mutationFn: ({ id, modules }: { id: string; modules: string[] }) =>
      api.patch(`/super-admin/tenants/${id}/modules`, { modules }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sa-tenants'] }); onClose(); },
  });

  const [activeModules, setActiveModules] = useState<string[]>(tenant.active_modules ?? ['crm']);
  const [showModules, setShowModules] = useState(false);

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute right-0 mt-1 w-56 bg-white rounded-xl shadow-xl border border-gray-100 py-1 z-50 overflow-hidden"
        style={{ top: '100%' }}
        onClick={(e) => e.stopPropagation()}>

        {/* Plan change */}
        <div className="px-3 py-2 border-b border-gray-50">
          <p className="text-xs font-semibold text-gray-400 mb-2">Change Plan</p>
          <div className="grid grid-cols-2 gap-1">
            {PLANS.map((p) => (
              <button key={p}
                onClick={() => planMutation.mutate({ id: tenant.id, plan: p })}
                className={`py-1 px-2 rounded text-xs capitalize transition-colors ${
                  tenant.plan === p ? 'bg-brand-100 text-brand-700 font-medium' : 'hover:bg-gray-50 text-gray-600'
                }`}>
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Modules */}
        <button onClick={() => setShowModules(!showModules)}
          className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
          <Package className="w-4 h-4 text-gray-400" />
          <span>Licensed Modules</span>
          <span className="ml-auto text-xs bg-brand-50 text-brand-600 px-1.5 py-0.5 rounded-full font-medium">
            {activeModules.length}
          </span>
        </button>
        {showModules && (
          <div className="px-3 pb-3 space-y-1.5 border-t border-gray-50 pt-2">
            <p className="text-[10px] text-gray-400 mb-2 leading-relaxed">
              Check only modules this tenant has <strong>paid for</strong>.
              Unchecked modules are hidden from their workspace.
            </p>
            {ALL_MODULES.map((m) => {
              const isOn = activeModules.includes(m.key);
              return (
                <label key={m.key} className={`flex items-start gap-2 py-1.5 px-1.5 rounded-lg cursor-pointer transition-colors ${
                  isOn ? 'bg-brand-50' : 'hover:bg-gray-50'
                }`}>
                  <input type="checkbox"
                    checked={isOn}
                    disabled={m.always}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...activeModules, m.key]
                        : activeModules.filter((x) => x !== m.key);
                      setActiveModules(next);
                    }}
                    className="accent-brand-600 mt-0.5 shrink-0" />
                  <span className="text-base shrink-0 leading-none mt-0.5">{m.icon}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-xs font-medium ${isOn ? 'text-gray-800' : 'text-gray-500'}`}>{m.label}</span>
                      {m.always && <span className="text-[9px] bg-gray-200 text-gray-500 px-1 py-0.5 rounded">Always On</span>}
                    </div>
                    <p className="text-[10px] text-gray-400 leading-relaxed mt-0.5">{m.description}</p>
                  </div>
                </label>
              );
            })}
            {modulesMutation.isError && (
              <p className="text-[10px] text-red-600 bg-red-50 px-2 py-1 rounded">
                {(modulesMutation.error as any)?.response?.data?.error?.message ?? 'Save failed'}
              </p>
            )}
            <button
              onClick={() => modulesMutation.mutate({ id: tenant.id, modules: activeModules })}
              disabled={modulesMutation.isPending}
              className="mt-1 w-full py-1.5 bg-brand-600 text-white rounded text-xs hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
              {modulesMutation.isPending ? <><Loader2 className="w-3 h-3 animate-spin" />Saving…</> : <><Check className="w-3 h-3" />Apply Licensed Modules</>}
            </button>
          </div>
        )}

        {/* Status actions */}
        <div className="border-t border-gray-50 mt-1 pt-1">
          {tenant.status !== 'suspended' ? (
            <button onClick={() => suspendMutation.mutate(tenant.id)}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50">
              <Ban className="w-4 h-4" /> Suspend Workspace
            </button>
          ) : (
            <button onClick={() => activateMutation.mutate(tenant.id)}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-green-600 hover:bg-green-50">
              <Play className="w-4 h-4" /> Reactivate Workspace
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export function SuperAdmin() {
  const isSuperAdmin = useIsSuperAdmin();
  if (!isSuperAdmin) return <Navigate to="/dashboard" replace />;

  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [openActions, setOpenActions] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['sa-tenants', search, planFilter, statusFilter, page],
    queryFn: () => api.get('/super-admin/tenants', {
      params: { page, pageSize: 20, search: search || undefined, plan: planFilter || undefined, status: statusFilter || undefined },
    }).then((r) => r.data),
  });

  const { data: metrics } = useQuery({
    queryKey: ['sa-metrics'],
    queryFn: () => api.get('/super-admin/metrics').then((r) => r.data.data),
    staleTime: 60_000,
  });

  const tenants = data?.data ?? [];
  const meta = data?.meta ?? {};

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-6 py-4 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Super Admin</h1>
              <p className="text-xs text-gray-400">Platform-wide workspace management</p>
            </div>
          </div>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700">
            <Plus className="w-4 h-4" /> New Workspace
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Metrics */}
        {metrics && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total Workspaces', value: metrics.total_tenants, icon: Building2, color: 'text-brand-600' },
              { label: 'Active',           value: metrics.active_tenants, icon: Check, color: 'text-green-600' },
              { label: 'On Trial',         value: metrics.trial_tenants, icon: AlertTriangle, color: 'text-amber-600' },
              { label: 'New (30d)',         value: metrics.new_tenants_30d, icon: TrendingUp, color: 'text-blue-600' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="bg-white rounded-xl border border-gray-100 p-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-gray-400">{label}</p>
                  <Icon className={`w-4 h-4 ${color}`} />
                </div>
                <p className="text-2xl font-bold text-gray-900">{value ?? '—'}</p>
              </div>
            ))}
          </div>
        )}

        {/* Plan breakdown */}
        {metrics && (
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Plan Distribution</p>
            <div className="grid grid-cols-4 gap-3">
              {PLANS.map((p) => (
                <div key={p} className="text-center">
                  <p className="text-xl font-bold text-gray-900">{metrics[`${p}_plan`] ?? 0}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${PLAN_COLORS[p]}`}>{p}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-48 bg-white border border-gray-200 rounded-lg px-3 py-2">
            <Search className="w-4 h-4 text-gray-400 shrink-0" />
            <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search workspaces…"
              className="flex-1 text-sm outline-none bg-transparent" />
          </div>
          <select value={planFilter} onChange={(e) => { setPlanFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none bg-white focus:border-brand-400">
            <option value="">All Plans</option>
            {PLANS.map((p) => <option key={p} value={p} className="capitalize">{p}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none bg-white focus:border-brand-400">
            <option value="">All Statuses</option>
            {['active','trial','suspended','cancelled'].map((s) => (
              <option key={s} value={s} className="capitalize">{s}</option>
            ))}
          </select>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          {isLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 text-brand-400 animate-spin" /></div>
          ) : tenants.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Building2 className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No workspaces found</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400">Workspace</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400">Plan</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400">Modules</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400">
                    <span className="flex items-center justify-end gap-3">
                      <span className="flex items-center gap-1"><Users className="w-3 h-3" />Users</span>
                      <span className="flex items-center gap-1"><Users className="w-3 h-3" />Contacts</span>
                      <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" />Deals</span>
                    </span>
                  </th>
                  <th className="w-10 px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {tenants.map((t: any) => (
                  <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-sm font-semibold text-gray-900">{t.name}</p>
                      <p className="text-xs text-gray-400 font-mono">{t.slug}.crmplatform.io</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full capitalize font-medium ${PLAN_COLORS[t.plan] ?? 'bg-gray-100 text-gray-600'}`}>
                        {t.plan}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full capitalize font-medium ${STATUS_COLORS[t.status] ?? 'bg-gray-100 text-gray-500'}`}>
                        {t.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {(t.active_modules ?? ['crm']).map((m: string) => (
                          <span key={m} className="text-xs bg-brand-50 text-brand-600 px-1.5 py-0.5 rounded capitalize">{m}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="inline-flex gap-5 text-sm text-gray-600">
                        <span className="font-medium">{t.user_count ?? 0}</span>
                        <span className="font-medium">{t.contact_count ?? 0}</span>
                        <span className="font-medium">{t.open_deals ?? 0}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 relative">
                      <button onClick={() => setOpenActions(openActions === t.id ? null : t.id)}
                        className="p-1 text-gray-400 hover:text-gray-600 rounded">
                        <MoreVertical className="w-4 h-4" />
                      </button>
                      {openActions === t.id && (
                        <TenantActions tenant={t} onClose={() => setOpenActions(null)} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {meta.total > 20 && (
          <div className="flex items-center justify-between text-sm text-gray-500">
            <span>{meta.total} workspaces</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40">Prev</button>
              <span className="px-3 py-1.5">Page {page} of {Math.ceil(meta.total / 20)}</span>
              <button disabled={page >= Math.ceil(meta.total / 20)} onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>

      {showCreate && <CreateWorkspaceModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
