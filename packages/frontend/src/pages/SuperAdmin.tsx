/**
 * Super Admin — platform-wide workspace management
 *
 * Only accessible to users with role = 'super_admin'.
 * Lists all tenants, shows usage stats, allows creating workspaces,
 * updating plans, managing modules, suspending/activating tenants.
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Shield, Plus, Search, MoreVertical, Users, TrendingUp,
  Loader2, X, Check, AlertTriangle, Building2, BarChart3,
  Package, Ban, Play, KeyRound, Edit2, Trash2, RefreshCw,
} from 'lucide-react';
import { api } from '../services/api';
import { useIsSuperAdmin } from '../hooks/useRole';
import { Navigate, useLocation } from 'react-router-dom';
import { PermissionsMatrix } from '../components/PermissionsMatrix';
import type { ModuleDef } from '../components/PermissionsMatrix';

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

const SYSTEM_ROLES_META = [
  { base_role: 'tenant_admin', name: 'Admin',   color: '#dc2626', desc: 'Full workspace access' },
  { base_role: 'manager',      name: 'Manager', color: '#d97706', desc: 'Team management & records' },
  { base_role: 'agent',        name: 'Agent',   color: '#2563eb', desc: 'Day-to-day CRM operations' },
  { base_role: 'viewer',       name: 'Viewer',  color: '#6b7280', desc: 'Read-only access' },
];

// ── Shared Roles Step (used in Create modal and standalone Manage Roles modal) ─
function RolesStep({
  modules,
  rolePerms,
  onChange,
}: {
  modules: ModuleDef[];
  rolePerms: Record<string, Record<string, boolean>>;
  onChange: (base_role: string, perms: Record<string, boolean>) => void;
}) {
  const [activeTab, setActiveTab] = useState('agent');
  return (
    <div>
      <p className="text-xs text-gray-500 mb-3">
        Configure default permissions for each role in this tenant. The tenant admin can further adjust them later.
      </p>
      {/* Role tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-100 pb-0">
        {SYSTEM_ROLES_META.map((r) => (
          <button
            key={r.base_role}
            type="button"
            onClick={() => setActiveTab(r.base_role)}
            className={`px-3 py-2 text-xs font-medium rounded-t-lg border-b-2 transition-colors ${
              activeTab === r.base_role
                ? 'border-brand-500 text-brand-700 bg-brand-50'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: r.color }} />
            {r.name}
          </button>
        ))}
      </div>
      {/* Active role permissions */}
      {SYSTEM_ROLES_META.filter((r) => r.base_role === activeTab).map((r) => (
        <div key={r.base_role}>
          <p className="text-xs text-gray-400 mb-3">{r.desc}</p>
          <div className="max-h-64 overflow-y-auto">
            <PermissionsMatrix
              modules={modules}
              permissions={rolePerms[r.base_role] ?? {}}
              onChange={(perms) => onChange(r.base_role, perms)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Manage Roles modal (for existing tenants) ──────────────────────────────
function TenantRolesModal({ tenant, onClose }: { tenant: any; onClose: () => void }) {
  const { data: modules = [] } = useQuery<ModuleDef[]>({
    queryKey: ['role-modules'],
    queryFn: () => api.get('/api/v1/roles/modules').then((r) => r.data.data),
  });

  const { data: existingRoles = [] } = useQuery<any[]>({
    queryKey: ['sa-tenant-roles', tenant.id],
    queryFn: () => api.get(`/super-admin/tenants/${tenant.id}/roles`).then((r) => r.data.data),
  });

  const [rolePerms, setRolePerms] = useState<Record<string, Record<string, boolean>>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (existingRoles.length > 0 && !loaded) {
      const map: Record<string, Record<string, boolean>> = {};
      for (const r of existingRoles) {
        if (r.base_role) map[r.base_role] = r.permissions ?? {};
      }
      setRolePerms(map);
      setLoaded(true);
    }
  }, [existingRoles, loaded]);

  const saveMutation = useMutation({
    mutationFn: () => api.post(`/super-admin/tenants/${tenant.id}/roles`, { roles: buildRolesPayload(rolePerms) }),
    onSuccess: onClose,
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-semibold text-gray-900">Manage Roles — {tenant.name}</h2>
            <p className="text-xs text-gray-400 mt-0.5">Configure default permissions for each role in this workspace</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        {modules.length === 0 ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
        ) : (
          <RolesStep
            modules={modules}
            rolePerms={rolePerms}
            onChange={(base_role, perms) => setRolePerms((p) => ({ ...p, [base_role]: perms }))}
          />
        )}
        {saveMutation.isError && (
          <p className="mt-3 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">
            {(saveMutation.error as any)?.response?.data?.error?.message ?? 'Save failed'}
          </p>
        )}
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
            className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2">
            {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Save Role Permissions
          </button>
        </div>
      </div>
    </div>
  );
}

function buildRolesPayload(rolePerms: Record<string, Record<string, boolean>>) {
  return SYSTEM_ROLES_META.map((r) => ({
    base_role: r.base_role,
    name: r.name,
    color: r.color,
    permissions: rolePerms[r.base_role] ?? {},
  }));
}

// ── Create Workspace Modal ─────────────────────────────────────────────────
function CreateWorkspaceModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', slug: '', plan: 'starter', adminEmail: '', adminName: '' });
  const [slugTouched, setSlugTouched] = useState(false);
  const [selectedModules, setSelectedModules] = useState<string[]>(['crm']);
  const [step, setStep] = useState<'details' | 'modules' | 'roles'>('details');
  const [rolePerms, setRolePerms] = useState<Record<string, Record<string, boolean>>>({});

  const { data: modules = [] } = useQuery<ModuleDef[]>({
    queryKey: ['role-modules'],
    queryFn: () => api.get('/api/v1/roles/modules').then((r) => r.data.data),
  });

  // Load defaults when entering roles step
  useEffect(() => {
    if (step !== 'roles' || Object.keys(rolePerms).length > 0 || modules.length === 0) return;
    const blank = Object.fromEntries(modules.flatMap((m) => m.actions.map((a) => [a.key, false])));
    Promise.all(
      SYSTEM_ROLES_META.map((r) =>
        api.get(`/api/v1/roles/defaults/${r.base_role}`)
          .then((res) => [r.base_role, res.data.data ?? blank] as [string, Record<string, boolean>])
          .catch(() => [r.base_role, blank] as [string, Record<string, boolean>])
      )
    ).then((entries) => setRolePerms(Object.fromEntries(entries)));
  }, [step, modules]);

  const mutation = useMutation({
    mutationFn: (payload: typeof form & { modules: string[]; roles: any[] }) =>
      api.post('/super-admin/tenants', payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sa-tenants'] }); onClose(); },
  });

  const autoSlug = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const toggleModule = (key: string) => {
    if (key === 'crm') return;
    setSelectedModules(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key],
    );
  };

  const detailsValid = form.name && form.slug && form.adminEmail && form.adminName;

  const STEP_LABELS: Record<string, string> = {
    details: 'Step 1 of 3 — Workspace details',
    modules: 'Step 2 of 3 — Licensed modules',
    roles:   'Step 3 of 3 — Role permissions',
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-semibold text-gray-900">Create Workspace</h2>
            <p className="text-xs text-gray-400 mt-0.5">{STEP_LABELS[step]}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-5">
          {(['details','modules','roles'] as const).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                step === s ? 'bg-brand-600 text-white' :
                (['details','modules','roles'].indexOf(step) > i) ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-400'
              }`}>{i + 1}</div>
              {i < 2 && <div className="h-px w-6 bg-gray-200" />}
            </div>
          ))}
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
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
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
                    <input type="checkbox" checked={isOn} disabled={locked} onChange={() => toggleModule(m.key)} className="accent-brand-600 shrink-0" />
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

        {/* Step 3 — Role permissions */}
        {step === 'roles' && (
          modules.length === 0 ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
          ) : (
            <RolesStep
              modules={modules}
              rolePerms={rolePerms}
              onChange={(base_role, perms) => setRolePerms((p) => ({ ...p, [base_role]: perms }))}
            />
          )
        )}

        {mutation.isError && (
          <p className="mt-3 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">
            {(mutation.error as any)?.response?.data?.error?.message ?? 'Failed to create workspace'}
          </p>
        )}

        <div className="flex gap-2 mt-6">
          {step === 'details' && (
            <>
              <button onClick={onClose} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={() => setStep('modules')} disabled={!detailsValid}
                className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2">
                Next: Set Modules →
              </button>
            </>
          )}
          {step === 'modules' && (
            <>
              <button onClick={() => setStep('details')} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">← Back</button>
              <button onClick={() => setStep('roles')}
                className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 flex items-center justify-center gap-2">
                Next: Set Role Permissions →
              </button>
            </>
          )}
          {step === 'roles' && (
            <>
              <button onClick={() => setStep('modules')} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">← Back</button>
              <button
                onClick={() => mutation.mutate({ ...form, modules: selectedModules, roles: buildRolesPayload(rolePerms) })}
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
  const [showManageRoles, setShowManageRoles] = useState(false);

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

        {/* Manage Roles */}
        <button onClick={() => setShowManageRoles(true)}
          className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
          <KeyRound className="w-4 h-4 text-gray-400" />
          <span>Manage Role Permissions</span>
        </button>

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
      {showManageRoles && (
        <TenantRolesModal tenant={tenant} onClose={() => { setShowManageRoles(false); onClose(); }} />
      )}
    </div>
  );
}

// ── Dashboard tab ─────────────────────────────────────────────────────────
const PLAN_COLORS_BAR: Record<string, string> = {
  free: 'bg-gray-300', starter: 'bg-blue-400',
  professional: 'bg-brand-500', enterprise: 'bg-purple-500',
};
const PLAN_LABELS = ['free','starter','professional','enterprise'];

function DashboardTab() {
  const { data: m, isLoading } = useQuery({
    queryKey: ['sa-metrics'],
    queryFn: () => api.get('/super-admin/metrics').then((r) => r.data.data),
    staleTime: 60_000,
  });

  if (isLoading || !m) {
    return <div className="flex justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }

  const totalActive = parseInt(m.active_tenants) || 0;
  const planMax = Math.max(...PLAN_LABELS.map((p) => parseInt(m[`${p}_plan`]) || 0), 1);
  const maxGrowth = Math.max(...(m.monthlyGrowth ?? []).map((r: any) => parseInt(r.count)), 1);

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Workspaces', value: m.total_tenants,    sub: `${m.new_tenants_30d} new this month`, color: 'bg-brand-500',  icon: Building2 },
          { label: 'Active Tenants',   value: m.active_tenants,   sub: `${m.trial_tenants} on trial`,          color: 'bg-green-500',  icon: Check },
          { label: 'Est. MRR',         value: `£${(m.mrr ?? 0).toLocaleString()}`, sub: 'active plans only',  color: 'bg-purple-500', icon: TrendingUp },
          { label: 'Platform Users',   value: m.total_users,      sub: `${m.new_users_30d} joined (30d)`,      color: 'bg-blue-500',   icon: Users },
        ].map(({ label, value, sub, color, icon: Icon }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-gray-400 font-medium">{label}</p>
              <div className={`w-7 h-7 ${color} rounded-lg flex items-center justify-center`}>
                <Icon className="w-3.5 h-3.5 text-white" />
              </div>
            </div>
            <p className="text-2xl font-bold text-gray-900">{value ?? '—'}</p>
            <p className="text-xs text-gray-400 mt-1">{sub}</p>
          </div>
        ))}
      </div>

      {/* Suspended alert */}
      {parseInt(m.suspended_tenants) > 0 && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-700">
            <strong>{m.suspended_tenants}</strong> workspace{m.suspended_tenants !== '1' ? 's are' : ' is'} currently suspended
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Plan distribution */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Plan Distribution</p>
          <div className="space-y-3">
            {PLAN_LABELS.map((p) => {
              const count = parseInt(m[`${p}_plan`]) || 0;
              const pct   = totalActive > 0 ? Math.round((count / planMax) * 100) : 0;
              return (
                <div key={p} className="flex items-center gap-3">
                  <span className="text-xs font-medium text-gray-500 w-24 capitalize shrink-0">{p}</span>
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${PLAN_COLORS_BAR[p]}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-gray-700 w-6 text-right shrink-0">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Monthly growth chart */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">New Tenants — Last 6 Months</p>
          {(m.monthlyGrowth ?? []).length === 0 ? (
            <p className="text-sm text-gray-300 text-center py-8">No data yet</p>
          ) : (
            <div className="flex items-end gap-2 h-28">
              {(m.monthlyGrowth ?? []).map((row: any) => {
                const h = Math.max(4, Math.round((parseInt(row.count) / maxGrowth) * 100));
                return (
                  <div key={row.month} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-xs font-semibold text-gray-600">{row.count}</span>
                    <div className="w-full bg-brand-500 rounded-t-md" style={{ height: `${h}%` }} />
                    <span className="text-[10px] text-gray-400">{row.month}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Module adoption */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Module Adoption (Active Tenants)</p>
          <div className="space-y-2.5">
            {(m.moduleAdoption ?? []).map((row: any) => {
              const pct = totalActive > 0 ? Math.round((parseInt(row.cnt) / totalActive) * 100) : 0;
              return (
                <div key={row.module} className="flex items-center gap-3">
                  <span className="text-xs font-medium text-gray-600 w-24 capitalize shrink-0">{row.module}</span>
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-brand-400 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-gray-500 w-16 text-right shrink-0">{row.cnt} ({pct}%)</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent tenants */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Recently Created Workspaces</p>
          <div className="space-y-2">
            {(m.recentTenants ?? []).map((t: any) => (
              <div key={t.id} className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-brand-600">{t.name[0]?.toUpperCase()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{t.name}</p>
                  <p className="text-[10px] text-gray-400">{new Date(t.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full capitalize font-medium shrink-0 ${PLAN_COLORS[t.plan] ?? 'bg-gray-100 text-gray-500'}`}>{t.plan}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full capitalize font-medium shrink-0 ${STATUS_COLORS[t.status] ?? 'bg-gray-100 text-gray-500'}`}>{t.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sync Entitlements Modal ────────────────────────────────────────────────
function SyncEntitlementsModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [applyModules, setApplyModules]     = useState(true);
  const [applyPermissions, setApplyPermissions] = useState(true);
  const [result, setResult] = useState<any>(null);

  const { data: preview, isLoading } = useQuery({
    queryKey: ['sync-preview'],
    queryFn: () => api.get('/super-admin/sync-entitlements/preview').then((r) => r.data.data),
  });

  const applyMutation = useMutation({
    mutationFn: () => api.post('/super-admin/sync-entitlements/apply', {
      apply_modules: applyModules,
      apply_permissions: applyPermissions,
    }),
    onSuccess: (res) => {
      setResult(res.data.data);
      qc.invalidateQueries({ queryKey: ['sa-tenants'] });
    },
  });

  const hasChanges = (preview?.moduleChanges?.length ?? 0) + (preview?.roleChanges?.length ?? 0) > 0;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-semibold text-gray-900">Sync Entitlements</h2>
            <p className="text-xs text-gray-400 mt-0.5">Review and apply module + permission updates across all tenants</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        {result ? (
          /* ── Done state ── */
          <div className="text-center py-8">
            <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-3">
              <Check className="w-6 h-6 text-green-600" />
            </div>
            <p className="font-semibold text-gray-900 mb-1">Sync complete</p>
            <div className="flex justify-center gap-6 mt-3 text-sm text-gray-600">
              <span><strong>{result.modulesUpdated}</strong> tenants got new modules</span>
              <span><strong>{result.rolesUpdated}</strong> roles updated</span>
              <span><strong>{result.tenantsNotified}</strong> tenants notified to review</span>
            </div>
            <button onClick={onClose} className="mt-6 px-6 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700">Done</button>
          </div>
        ) : isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
        ) : !hasChanges ? (
          <div className="text-center py-10 text-gray-400">
            <Check className="w-10 h-10 mx-auto mb-2 text-green-400" />
            <p className="text-sm font-medium text-gray-600">Everything is up to date</p>
            <p className="text-xs mt-1">All tenants have the correct modules and permission keys for their plan</p>
          </div>
        ) : (
          <>
            {/* Options */}
            <div className="flex gap-3 mb-5">
              <label className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer flex-1 ${applyModules ? 'border-brand-200 bg-brand-50' : 'border-gray-200'}`}>
                <input type="checkbox" checked={applyModules} onChange={(e) => setApplyModules(e.target.checked)} className="accent-brand-600" />
                <div>
                  <p className="text-sm font-medium text-gray-800">Module entitlements</p>
                  <p className="text-xs text-gray-400">{preview?.moduleChanges?.length ?? 0} tenants affected</p>
                </div>
              </label>
              <label className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer flex-1 ${applyPermissions ? 'border-brand-200 bg-brand-50' : 'border-gray-200'}`}>
                <input type="checkbox" checked={applyPermissions} onChange={(e) => setApplyPermissions(e.target.checked)} className="accent-brand-600" />
                <div>
                  <p className="text-sm font-medium text-gray-800">Permission keys</p>
                  <p className="text-xs text-gray-400">{preview?.roleChanges?.length ?? 0} tenants have roles with missing keys</p>
                </div>
              </label>
            </div>

            {/* Module changes */}
            {applyModules && preview?.moduleChanges?.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Modules to assign</p>
                <div className="border border-gray-100 rounded-xl overflow-hidden">
                  {preview.moduleChanges.map((c: any, i: number) => (
                    <div key={c.tenant_id} className={`flex items-center gap-3 px-4 py-2.5 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{c.tenant_name}</p>
                      </div>
                      <div className="flex gap-1 flex-wrap justify-end">
                        {c.add_modules.map((m: string) => (
                          <span key={m} className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full">+ {m}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Role permission changes */}
            {applyPermissions && preview?.roleChanges?.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Roles with missing permission keys</p>
                <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mb-2">
                  <p className="text-xs text-blue-700">
                    Missing keys are filled using the role's <strong>base role defaults</strong> — system roles (Admin/Manager/Agent/Viewer) and <strong>all custom roles</strong> via their assigned base role. Tenant admins will be notified to review.
                  </p>
                </div>
                <div className="border border-gray-100 rounded-xl overflow-hidden">
                  {preview.roleChanges.map((c: any, i: number) => (
                    <div key={c.tenant_id} className={`flex items-center gap-3 px-4 py-2.5 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{c.tenant_name}</p>
                        <p className="text-xs text-gray-400">{c.roles_affected} role{c.roles_affected !== 1 ? 's' : ''} affected</p>
                      </div>
                      <div className="flex gap-1 flex-wrap justify-end">
                        {c.sample_keys.map((k: string) => (
                          <span key={k} className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded font-mono">{k}</span>
                        ))}
                        {c.sample_keys.length === 5 && <span className="text-xs text-gray-400">…</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {applyMutation.isError && (
              <p className="mb-3 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                {(applyMutation.error as any)?.response?.data?.error?.message ?? 'Sync failed'}
              </p>
            )}

            <div className="flex gap-2 mt-4">
              <button onClick={onClose} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button
                onClick={() => applyMutation.mutate()}
                disabled={applyMutation.isPending || (!applyModules && !applyPermissions)}
                className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {applyMutation.isPending ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Applying…</> : 'Apply Changes'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Platform permission definitions (for sub-admin roles) ─────────────────
export const PLATFORM_MODULE_DEFS: ModuleDef[] = [
  { key: 'tenants', label: 'Tenant Management', icon: '🏢', actions: [
    { key: 'tenants:view',    label: 'View all tenants & metrics',       type: 'read'   },
    { key: 'tenants:create',  label: 'Create new tenant workspaces',     type: 'write'  },
    { key: 'tenants:suspend', label: 'Suspend & reactivate tenants',     type: 'danger' },
  ]},
  { key: 'modules', label: 'Module & Plan Control', icon: '📦', actions: [
    { key: 'modules:manage', label: 'Assign & revoke licensed modules',  type: 'write'  },
    { key: 'plans:manage',   label: 'Change tenant subscription plans',  type: 'write'  },
  ]},
  { key: 'roles', label: 'Roles & Access', icon: '🔑', actions: [
    { key: 'roles:manage',      label: 'Configure tenant role permissions', type: 'write'  },
    { key: 'sub_admins:manage', label: 'Create & manage sub-admin accounts',type: 'write'  },
  ]},
  { key: 'billing', label: 'Billing', icon: '💳', actions: [
    { key: 'billing:view',   label: 'View invoices & payment history',   type: 'read'   },
    { key: 'billing:manage', label: 'Generate & manage tenant invoices', type: 'write'  },
  ]},
  { key: 'production', label: 'Production', icon: '🚀', actions: [
    { key: 'platform:push', label: 'Push changes to production',         type: 'danger' },
  ]},
];

const PRESET_COLORS_PLATFORM = [
  '#6366f1','#7c3aed','#db2777','#dc2626','#ea580c',
  '#ca8a04','#16a34a','#0891b2','#2563eb','#64748b',
];

// ── Sub-Admin Role modal ───────────────────────────────────────────────────
function PlatformRoleModal({ role, onClose }: { role?: any; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!role;
  const blank = Object.fromEntries(PLATFORM_MODULE_DEFS.flatMap((m) => m.actions.map((a) => [a.key, false])));
  const [name, setName]             = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [color, setColor]           = useState(role?.color ?? '#6366f1');
  const [permissions, setPermissions] = useState<Record<string, boolean>>(role?.permissions ?? blank);

  const mutation = useMutation({
    mutationFn: () => isEdit
      ? api.patch(`/super-admin/platform-roles/${role.id}`, { name, description, color, permissions })
      : api.post('/super-admin/platform-roles', { name, description, color, permissions }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['platform-roles'] }); onClose(); },
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-gray-900">{isEdit ? 'Edit Sub-Admin Role' : 'Create Sub-Admin Role'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-4 mb-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Role Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Support Admin"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Color</label>
              <div className="flex gap-1.5 flex-wrap">
                {PRESET_COLORS_PLATFORM.map((c) => (
                  <button key={c} type="button" onClick={() => setColor(c)}
                    className={`w-6 h-6 rounded-full border-2 transition-all ${color === c ? 'border-gray-900 scale-110' : 'border-transparent'}`}
                    style={{ background: c }} />
                ))}
              </div>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this role's responsibilities"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
          </div>
        </div>

        <div className="mb-1">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Platform Permissions</p>
          <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-3">
            <p className="text-xs text-amber-700">
              ⚠️ <strong>Push to production</strong> should only be granted to trusted senior admins.
              Sub-admins without this permission can test and configure but cannot deploy.
            </p>
          </div>
          <PermissionsMatrix modules={PLATFORM_MODULE_DEFS} permissions={permissions} onChange={setPermissions} />
        </div>

        {mutation.isError && (
          <p className="mt-3 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">
            {(mutation.error as any)?.response?.data?.error?.message ?? 'Save failed'}
          </p>
        )}
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={!name || mutation.isPending}
            className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2">
            {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {isEdit ? 'Save Changes' : 'Create Role'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sub-Admin Roles tab ────────────────────────────────────────────────────
function PlatformRolesTab() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<{ open: boolean; role?: any }>({ open: false });

  const { data: roles = [], isLoading } = useQuery<any[]>({
    queryKey: ['platform-roles'],
    queryFn: () => api.get('/super-admin/platform-roles').then((r) => r.data.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/super-admin/platform-roles/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-roles'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-800">Sub-Admin Roles</p>
          <p className="text-xs text-gray-400 mt-0.5">Define what sub-admins are allowed to do on the platform</p>
        </div>
        <button onClick={() => setModal({ open: true })}
          className="flex items-center gap-2 px-3 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700">
          <Plus className="w-4 h-4" /> New Role
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
      ) : roles.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 py-16 text-center text-gray-400">
          <Shield className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No sub-admin roles yet</p>
          <p className="text-xs mt-1">Create a role to start assigning sub-admins</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {roles.map((role) => {
            const enabledCount = Object.values(role.permissions ?? {}).filter(Boolean).length;
            const totalCount   = PLATFORM_MODULE_DEFS.flatMap((m) => m.actions).length;
            return (
              <div key={role.id} className="bg-white rounded-xl border border-gray-100 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl shrink-0 flex items-center justify-center text-white text-sm font-bold"
                      style={{ background: role.color }}>
                      {role.name[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{role.name}</p>
                      {role.description && <p className="text-xs text-gray-400 mt-0.5">{role.description}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                      {enabledCount} / {totalCount} permissions
                    </span>
                    {role.permissions?.['platform:push'] && (
                      <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded-full font-medium">
                        🚀 Can push to prod
                      </span>
                    )}
                    <button onClick={() => setModal({ open: true, role })}
                      className="p-1.5 text-gray-400 hover:text-brand-600 rounded-lg hover:bg-brand-50 transition-colors">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => deleteMutation.mutate(role.id)}
                      className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {/* Permission summary */}
                <div className="mt-3 flex gap-1.5 flex-wrap">
                  {PLATFORM_MODULE_DEFS.map((mod) => {
                    const en = mod.actions.filter((a) => role.permissions?.[a.key]).length;
                    if (en === 0) return null;
                    return (
                      <span key={mod.key} className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
                        {mod.icon} {mod.label} ({en}/{mod.actions.length})
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal.open && <PlatformRoleModal role={modal.role} onClose={() => setModal({ open: false })} />}
    </div>
  );
}

// ── Sub-Admins tab ─────────────────────────────────────────────────────────
function SubAdminsTab() {
  const qc = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);

  const { data: subAdmins = [], isLoading } = useQuery<any[]>({
    queryKey: ['sub-admins'],
    queryFn: () => api.get('/super-admin/sub-admins').then((r) => r.data.data),
  });

  const { data: platformRoles = [] } = useQuery<any[]>({
    queryKey: ['platform-roles'],
    queryFn: () => api.get('/super-admin/platform-roles').then((r) => r.data.data),
  });

  const { data: tenants = [] } = useQuery<any[]>({
    queryKey: ['sa-tenants-all'],
    queryFn: () => api.get('/super-admin/tenants', { params: { pageSize: 200 } }).then((r) => r.data.data),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api.patch(`/super-admin/sub-admins/${id}`, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sub-admins'] }),
  });

  const assignRole = useMutation({
    mutationFn: ({ id, platform_role_id }: { id: string; platform_role_id: string | null }) =>
      api.patch(`/super-admin/sub-admins/${id}`, { platform_role_id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sub-admins'] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/super-admin/sub-admins/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sub-admins'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-800">Sub-Admins</p>
          <p className="text-xs text-gray-400 mt-0.5">Platform staff who support tenant operations</p>
        </div>
        <button onClick={() => setShowInvite(true)}
          className="flex items-center gap-2 px-3 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700">
          <Plus className="w-4 h-4" /> Invite Sub-Admin
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
      ) : subAdmins.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 py-16 text-center text-gray-400">
          <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No sub-admins yet</p>
          <p className="text-xs mt-1">Invite your first support admin to get started</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400">Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400">Platform Role</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400">Status</th>
                <th className="w-24 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {subAdmins.map((u: any) => (
                <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-gray-900">{u.name}</p>
                    <p className="text-xs text-gray-400">{u.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={u.platform_role_id ?? ''}
                      onChange={(e) => assignRole.mutate({ id: u.id, platform_role_id: e.target.value || null })}
                      className="text-xs px-2 py-1 border border-gray-200 rounded-lg outline-none focus:border-brand-400 bg-white"
                    >
                      <option value="">No role assigned</option>
                      {platformRoles.map((r: any) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleActive.mutate({ id: u.id, is_active: !u.is_active })}
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.is_active ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                      {u.is_active ? 'Active' : 'Disabled'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => remove.mutate(u.id)}
                      className="p-1 text-gray-400 hover:text-red-600 rounded transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showInvite && (
        <InviteSubAdminModal tenants={tenants} platformRoles={platformRoles} onClose={() => setShowInvite(false)} />
      )}
    </div>
  );
}

function InviteSubAdminModal({ tenants, platformRoles, onClose }: { tenants: any[]; platformRoles: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', email: '', platform_role_id: '', tenant_id: '' });

  const mutation = useMutation({
    mutationFn: () => api.post('/super-admin/sub-admins', {
      name: form.name,
      email: form.email,
      platform_role_id: form.platform_role_id || undefined,
      tenant_id: form.tenant_id,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sub-admins'] }); onClose(); },
  });

  const valid = form.name && form.email && form.tenant_id;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-gray-900">Invite Sub-Admin</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Full Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Jane Smith"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Email</label>
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
              type="email" placeholder="jane@company.com"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Home Tenant <span className="text-gray-400">(workspace they log in from)</span></label>
            <select value={form.tenant_id} onChange={(e) => setForm({ ...form, tenant_id: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400 bg-white">
              <option value="">Select workspace…</option>
              {tenants.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Platform Role <span className="text-gray-400">(optional)</span></label>
            <select value={form.platform_role_id} onChange={(e) => setForm({ ...form, platform_role_id: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400 bg-white">
              <option value="">No role yet</option>
              {platformRoles.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        </div>
        {mutation.isError && (
          <p className="mt-3 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">
            {(mutation.error as any)?.response?.data?.error?.message ?? 'Failed to invite sub-admin'}
          </p>
        )}
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={!valid || mutation.isPending}
            className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2">
            {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Invite Sub-Admin
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Platform Billing Tab ──────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  draft:     'bg-gray-100 text-gray-600',
  sent:      'bg-blue-50 text-blue-700',
  paid:      'bg-green-50 text-green-700',
  overdue:   'bg-red-50 text-red-700',
  cancelled: 'bg-yellow-50 text-yellow-700',
};

function CreateInvoiceModal({ tenants, onClose }: { tenants: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [tenantId, setTenantId] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd]     = useState('');
  const [dueDate, setDueDate]         = useState('');
  const [currency, setCurrency]       = useState('GBP');
  const [notes, setNotes]             = useState('');
  const [items, setItems] = useState([{ description: 'Monthly subscription', quantity: 1, unit_price: 0 }]);

  const total = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);

  const mutation = useMutation({
    mutationFn: () => api.post('/super-admin/platform-invoices', {
      tenant_id: tenantId, period_start: periodStart, period_end: periodEnd,
      due_date: dueDate, currency, items, notes: notes || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['platform-invoices'] }); onClose(); },
  });

  function addItem() { setItems([...items, { description: '', quantity: 1, unit_price: 0 }]); }
  function removeItem(i: number) { setItems(items.filter((_, idx) => idx !== i)); }
  function updateItem(i: number, field: string, value: any) {
    setItems(items.map((item, idx) => idx === i ? { ...item, [field]: value } : item));
  }

  const canSave = tenantId && periodStart && periodEnd && dueDate && items.every(i => i.description && i.unit_price > 0);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">New Platform Invoice</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          {/* Tenant */}
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Tenant (Bill To)</label>
            <select value={tenantId} onChange={e => setTenantId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand-400">
              <option value="">Select tenant…</option>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name} — {t.plan}</option>)}
            </select>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Period Start', value: periodStart, set: setPeriodStart },
              { label: 'Period End',   value: periodEnd,   set: setPeriodEnd   },
              { label: 'Due Date',     value: dueDate,     set: setDueDate     },
            ].map(({ label, value, set }) => (
              <div key={label}>
                <label className="text-xs font-medium text-gray-600 mb-1 block">{label}</label>
                <input type="date" value={value} onChange={e => set(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand-400" />
              </div>
            ))}
          </div>

          {/* Currency */}
          <div className="w-32">
            <label className="text-xs font-medium text-gray-600 mb-1 block">Currency</label>
            <select value={currency} onChange={e => setCurrency(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand-400">
              {['GBP','USD','EUR','PKR'].map(c => <option key={c}>{c}</option>)}
            </select>
          </div>

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-600">Line Items</label>
              <button onClick={addItem} className="text-xs text-brand-600 hover:text-brand-700 font-medium">+ Add item</button>
            </div>
            <div className="space-y-2">
              {items.map((item, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <input value={item.description} onChange={e => updateItem(i, 'description', e.target.value)}
                    placeholder="Description" className="col-span-6 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand-400" />
                  <input type="number" value={item.quantity} min={1} onChange={e => updateItem(i, 'quantity', Number(e.target.value))}
                    className="col-span-2 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand-400 text-center" />
                  <input type="number" value={item.unit_price} step="0.01" min={0} onChange={e => updateItem(i, 'unit_price', Number(e.target.value))}
                    placeholder="Price" className="col-span-3 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand-400" />
                  <button onClick={() => removeItem(i)} disabled={items.length === 1} className="col-span-1 text-gray-300 hover:text-red-400 disabled:opacity-30">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-3">
              <span className="text-sm font-semibold text-gray-900">Total: {currency} {total.toFixed(2)}</span>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Notes (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand-400 resize-none" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
          <button disabled={!canSave || mutation.isPending} onClick={() => mutation.mutate()}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50">
            {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Create Invoice
          </button>
        </div>
      </div>
    </div>
  );
}

function RecordPaymentModal({ invoice, onClose }: { invoice: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [amount, setAmount]     = useState(String(Number(invoice.amount) - Number(invoice.amount_paid || 0)));
  const [date, setDate]         = useState(new Date().toISOString().split('T')[0]);
  const [method, setMethod]     = useState('bank_transfer');
  const [reference, setRef]     = useState('');

  const mutation = useMutation({
    mutationFn: () => api.post(`/super-admin/platform-invoices/${invoice.id}/payments`, {
      amount: Number(amount), payment_date: date, method, reference: reference || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['platform-invoices'] }); onClose(); },
  });

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Record Payment</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <p className="text-sm text-gray-500">Invoice {invoice.invoice_number} · {invoice.currency} {Number(invoice.amount).toFixed(2)}</p>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Amount Received</label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} step="0.01" min={0}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand-400" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Payment Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand-400" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Method</label>
            <select value={method} onChange={e => setMethod(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand-400">
              {['bank_transfer','card','cheque','cash','other'].map(m => <option key={m} value={m}>{m.replace('_',' ')}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Reference (optional)</label>
            <input value={reference} onChange={e => setRef(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand-400" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
          <button disabled={!amount || !date || mutation.isPending} onClick={() => mutation.mutate()}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
            {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Record Payment
          </button>
        </div>
      </div>
    </div>
  );
}

function PlatformBillingTab({ tenants }: { tenants: any[] }) {
  const qc = useQueryClient();
  const [showCreate, setShowCreate]   = useState(false);
  const [payInvoice, setPayInvoice]   = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [tenantFilter, setTenantFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['platform-invoices', statusFilter, tenantFilter],
    queryFn: () => api.get('/super-admin/platform-invoices', {
      params: { status: statusFilter || undefined, tenant_id: tenantFilter || undefined, pageSize: 50 },
    }).then(r => r.data),
  });

  const invoices: any[] = data?.data ?? [];

  const markStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/super-admin/platform-invoices/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-invoices'] }),
  });

  const deleteInvoice = useMutation({
    mutationFn: (id: string) => api.delete(`/super-admin/platform-invoices/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-invoices'] }),
  });

  // Summary KPIs
  const totalOutstanding = invoices.filter(i => ['sent','overdue'].includes(i.status))
    .reduce((s, i) => s + Number(i.amount) - Number(i.amount_paid || 0), 0);
  const totalPaid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.amount), 0);
  const overdueCount = invoices.filter(i => i.status === 'overdue').length;

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Outstanding',   value: `£${totalOutstanding.toFixed(2)}`, color: 'text-amber-600'  },
          { label: 'Collected',     value: `£${totalPaid.toFixed(2)}`,        color: 'text-green-600'  },
          { label: 'Overdue',       value: String(overdueCount),              color: 'text-red-600'    },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-xs text-gray-400 mb-1">{k.label}</p>
            <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-2">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand-400 bg-white">
            <option value="">All statuses</option>
            {['draft','sent','paid','overdue','cancelled'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={tenantFilter} onChange={e => setTenantFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand-400 bg-white">
            <option value="">All tenants</option>
            {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700">
          <Plus className="w-4 h-4" /> New Invoice
        </button>
      </div>

      {/* Invoice table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {['Invoice #','Tenant','Period','Amount','Paid','Due Date','Status','Actions'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
            )}
            {!isLoading && invoices.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400 text-sm">No invoices yet. Create one to get started.</td></tr>
            )}
            {invoices.map(inv => {
              const amtPaid = Number(inv.amount_paid || 0);
              const balance = Number(inv.amount) - amtPaid;
              return (
                <tr key={inv.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{inv.invoice_number}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900 text-xs">{inv.tenant_name}</p>
                    <span className="text-[10px] capitalize text-gray-400">{inv.tenant_plan}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {inv.period_start?.slice(0,10)} – {inv.period_end?.slice(0,10)}
                  </td>
                  <td className="px-4 py-3 font-semibold text-gray-900 text-xs">{inv.currency} {Number(inv.amount).toFixed(2)}</td>
                  <td className="px-4 py-3 text-xs text-green-600">{amtPaid > 0 ? `${inv.currency} ${amtPaid.toFixed(2)}` : '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{inv.due_date?.slice(0,10)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_BADGE[inv.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {inv.status === 'draft' && (
                        <button onClick={() => markStatus.mutate({ id: inv.id, status: 'sent' })}
                          title="Mark as Sent" className="p-1 rounded text-blue-500 hover:bg-blue-50 text-xs font-medium">
                          Send
                        </button>
                      )}
                      {['sent','overdue'].includes(inv.status) && balance > 0 && (
                        <button onClick={() => setPayInvoice(inv)}
                          title="Record Payment" className="p-1 rounded text-green-600 hover:bg-green-50 text-xs font-medium">
                          Pay
                        </button>
                      )}
                      {inv.status === 'sent' && (
                        <button onClick={() => markStatus.mutate({ id: inv.id, status: 'overdue' })}
                          title="Mark Overdue" className="p-1 rounded text-red-500 hover:bg-red-50 text-xs font-medium">
                          Overdue
                        </button>
                      )}
                      {inv.status === 'draft' && (
                        <button onClick={() => { if(confirm('Delete this draft?')) deleteInvoice.mutate(inv.id); }}
                          className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showCreate && <CreateInvoiceModal tenants={tenants} onClose={() => setShowCreate(false)} />}
      {payInvoice  && <RecordPaymentModal invoice={payInvoice} onClose={() => setPayInvoice(null)} />}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export function SuperAdmin() {
  const isSuperAdmin = useIsSuperAdmin();
  if (!isSuperAdmin) return <Navigate to="/dashboard" replace />;

  const qc = useQueryClient();
  // Hash-synced tab so the SuperAdminSidebar links (e.g. /super-admin#tenants)
  // actually switch tabs instead of just changing the URL fragment silently.
  const location = useLocation();
  const tabFromHash = (h: string): 'dashboard' | 'tenants' | 'roles' | 'sub-admins' | 'billing' => {
    const v = h.replace(/^#/, '');
    return (['dashboard','tenants','roles','sub-admins','billing'] as const).includes(v as any)
      ? (v as any) : 'dashboard';
  };
  const [activeTab, setActiveTabState] = useState<'dashboard' | 'tenants' | 'roles' | 'sub-admins' | 'billing'>(tabFromHash(location.hash));
  // Keep state and URL hash in lockstep: clicking a sidebar link updates state;
  // clicking a tab button updates the URL hash so deep-links + back/forward work.
  useEffect(() => { setActiveTabState(tabFromHash(location.hash)); }, [location.hash]);
  const setActiveTab = (t: typeof activeTab) => {
    setActiveTabState(t);
    if (location.hash !== `#${t}`) window.history.replaceState(null, '', `#${t}`);
  };
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [showSync, setShowSync]     = useState(false);
  const [openActions, setOpenActions] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['sa-tenants', search, planFilter, statusFilter, page],
    queryFn: () => api.get('/super-admin/tenants', {
      params: { page, pageSize: 20, search: search || undefined, plan: planFilter || undefined, status: statusFilter || undefined },
    }).then((r) => r.data),
  });

  const tenants = data?.data ?? [];
  const meta = data?.meta ?? {};

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-6 py-4 shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Super Admin</h1>
              <p className="text-xs text-gray-400">Platform-wide workspace management</p>
            </div>
          </div>
          {activeTab === 'tenants' && (
            <div className="flex gap-2">
              <button onClick={() => setShowSync(true)}
                className="flex items-center gap-2 px-3 py-2 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50">
                <RefreshCw className="w-4 h-4" /> Sync Entitlements
              </button>
              <button onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700">
                <Plus className="w-4 h-4" /> New Workspace
              </button>
            </div>
          )}
        </div>
        {/* Tabs */}
        <div className="flex gap-1">
          {([
            { key: 'dashboard',  label: 'Dashboard',        icon: BarChart3  },
            { key: 'tenants',    label: 'Tenants',          icon: Building2  },
            { key: 'billing',    label: 'Billing',          icon: TrendingUp },
            { key: 'roles',      label: 'Sub-Admin Roles',  icon: Shield     },
            { key: 'sub-admins', label: 'Sub-Admins',       icon: Users      },
          ] as const).map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg transition-colors ${
                activeTab === key
                  ? 'bg-brand-50 text-brand-700 font-semibold'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}>
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {activeTab === 'dashboard'  && <DashboardTab />}
        {activeTab === 'billing'    && <PlatformBillingTab tenants={tenants} />}
        {activeTab === 'roles'      && <PlatformRolesTab />}
        {activeTab === 'sub-admins' && <SubAdminsTab />}

        {/* Filters */}
        {activeTab === 'tenants' && <div className="flex gap-3 flex-wrap">
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
        </div>}

        {/* Table */}
        {activeTab === 'tenants' && <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
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
        </div>}

        {/* Pagination */}
        {activeTab === 'tenants' && meta.total > 20 && (
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
      {showSync   && <SyncEntitlementsModal onClose={() => setShowSync(false)} />}
    </div>
  );
}
