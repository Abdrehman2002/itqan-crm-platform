import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Users, UserCheck, UserX, Shield, Building2, Layers, Zap, Mail,
  Clock, AlertTriangle, CheckCircle2, ArrowRight, UserPlus,
  Settings, BarChart3, Key, Bell, RefreshCw, Activity,
} from 'lucide-react';
import { api } from '../services/api';
import { useAuthStore } from '../store/auth.store';

function StatCard({ icon: Icon, label, value, sub, color, onClick }: {
  icon: any; label: string; value: string | number; sub?: string;
  color: string; onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`bg-white rounded-2xl p-5 border border-gray-100 shadow-sm text-left w-full transition-all hover:shadow-md hover:-translate-y-0.5 ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${color}18` }}>
          <Icon className="w-5 h-5" style={{ color }} />
        </div>
        {onClick && <ArrowRight className="w-4 h-4 text-gray-300 mt-1" />}
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-sm font-medium text-gray-700 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </button>
  );
}

function QuickAction({ icon: Icon, label, desc, color, onClick }: {
  icon: any; label: string; desc: string; color: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-4 p-4 bg-white rounded-xl border border-gray-100 hover:border-gray-200 hover:shadow-sm transition-all text-left w-full group"
    >
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${color}15` }}>
        <Icon className="w-4.5 h-4.5" style={{ color }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800">{label}</p>
        <p className="text-xs text-gray-400 truncate">{desc}</p>
      </div>
      <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors shrink-0" />
    </button>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-600">{label}</span>
      <div className={`flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${ok ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
        {ok ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
        {ok ? 'Connected' : 'Not configured'}
      </div>
    </div>
  );
}

export function TenantAdminDashboard() {
  const navigate = useNavigate();
  const { tenant } = useAuthStore();

  const { data: teamData } = useQuery({
    queryKey: ['admin-team-summary'],
    queryFn: async () => {
      const res = await api.get('/api/v1/settings/team');
      return res.data.data as any[];
    },
    staleTime: 30_000,
  });

  const { data: rolesData } = useQuery({
    queryKey: ['admin-roles-summary'],
    queryFn: async () => {
      const res = await api.get('/api/v1/roles');
      return res.data.data as any[];
    },
    staleTime: 30_000,
  });

  const { data: deptData } = useQuery({
    queryKey: ['admin-dept-summary'],
    queryFn: async () => {
      const res = await api.get('/api/v1/departments');
      return res.data.data as any[];
    },
    staleTime: 30_000,
  });

  const { data: integrations } = useQuery({
    queryKey: ['admin-integrations'],
    queryFn: async () => {
      const res = await api.get('/api/v1/connectors');
      return res.data.data as any[];
    },
    staleTime: 30_000,
  });

  const members   = teamData ?? [];
  const active    = members.filter((u: any) => u.is_active);
  const inactive  = members.filter((u: any) => !u.is_active);
  const roles     = rolesData ?? [];
  const depts     = deptData ?? [];
  const connectors = integrations ?? [];
  const connectedCount = connectors.filter((c: any) => c.status === 'active').length;

  const entitledFeatures: string[] = (tenant as any)?.entitled_features ?? [];
  const activeModules: string[]    = (tenant as any)?.active_modules ?? [];

  const emailConnected  = connectors.some((c: any) => ['sendgrid','smtp','gmail','microsoft365'].includes(c.type) && c.status === 'active');
  const smsConnected    = connectors.some((c: any) => ['twilio','vonage','jazzcash'].includes(c.type) && c.status === 'active');

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-8 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Admin Dashboard</h1>
            <p className="text-sm text-gray-500 mt-0.5">{tenant?.name} — workspace administration</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium px-3 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100 capitalize">
              {(tenant as any)?.plan ?? 'free'} plan
            </span>
            <button
              onClick={() => navigate('/settings/team')}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-xl transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #1a8cbf 100%)' }}
            >
              <UserPlus className="w-4 h-4" />
              Invite User
            </button>
          </div>
        </div>
      </div>

      <div className="px-8 py-6 space-y-6 max-w-6xl">

        {/* Stats row — all tiles route to the actual destination (was sending every
            click to General Settings before, which dropped the user one click short
            of the actual list/management page). */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={Users}     label="Total Users"    value={members.length}    sub={`${active.length} active`}      color="#29ABE2" onClick={() => navigate('/admin/users')} />
          <StatCard icon={UserCheck} label="Active Users"   value={active.length}     sub="currently enabled"              color="#57A93C" onClick={() => navigate('/admin/users?filter=active')} />
          <StatCard icon={Shield}    label="Roles"          value={roles.length}      sub="permission groups"              color="#8b5cf6" onClick={() => navigate('/roles')} />
          <StatCard icon={Building2} label="Departments"    value={depts.length}      sub="organisational units"           color="#f59e0b" onClick={() => navigate('/departments')} />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={Layers}    label="Active Modules" value={activeModules.length}  sub="licensed & enabled"         color="#06b6d4" onClick={() => navigate('/admin/modules')} />
          <StatCard icon={Zap}       label="Integrations"   value={connectedCount}        sub={`of ${connectors.length} connected`} color="#29ABE2" onClick={() => navigate('/integrations')} />
          <StatCard icon={UserX}     label="Inactive Users" value={inactive.length}       sub="access suspended"           color="#ef4444" onClick={() => navigate('/admin/users?filter=inactive')} />
          <StatCard icon={Key}       label="Features"       value={entitledFeatures.length} sub="licensed features"        color="#57A93C" onClick={() => navigate('/admin/modules')} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Quick Actions */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4">Quick Actions</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <QuickAction icon={UserPlus}   label="Invite Team Member"     desc="Add a user & assign their role"         color="#29ABE2" onClick={() => navigate('/admin/users?invite=1')} />
              <QuickAction icon={Shield}     label="Manage Roles"           desc="Create roles & set permissions"         color="#8b5cf6" onClick={() => navigate('/roles')} />
              <QuickAction icon={Building2}  label="Manage Departments"     desc="Create & assign department heads"       color="#f59e0b" onClick={() => navigate('/departments')} />
              <QuickAction icon={Layers}     label="Enable Modules"         desc="Turn features on or off"                color="#06b6d4" onClick={() => navigate('/admin/modules')} />
              <QuickAction icon={Zap}        label="Connect Integrations"   desc="Email, SMS, payments, APIs"             color="#29ABE2" onClick={() => navigate('/integrations')} />
              <QuickAction icon={Mail}       label="Email Configuration"    desc="SMTP, SendGrid, Microsoft 365"          color="#57A93C" onClick={() => navigate('/integrations')} />
              {/* Was: navigate('/admin/routing'); RoutingSettings re-renders the
                  general Settings page, so users hit "General Settings" instead of the
                  ticket-routing config they expected. /tickets/queues is the real
                  routing screen (queue-based auto-assignment + push routing). */}
              <QuickAction icon={Clock}      label="Routing & SLA"          desc="Ticket queues & SLA policies"           color="#f59e0b" onClick={() => navigate('/tickets/queues')} />
              <QuickAction icon={Settings}   label="Workspace Settings"     desc="Name, timezone, locale, branding"       color="#6b7280" onClick={() => navigate('/settings')} />
            </div>
          </div>

          {/* System Status */}
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4">System Status</h2>
              <StatusBadge ok={emailConnected}  label="Email service"     />
              <StatusBadge ok={smsConnected}    label="SMS gateway"       />
              <StatusBadge ok={depts.length > 0} label="Departments set up" />
              <StatusBadge ok={roles.length > 4} label="Custom roles"     />
              <StatusBadge ok={active.length > 1} label="Team members"   />
            </div>

            {/* Licensed Modules */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4">Licensed Modules</h2>
              {activeModules.length === 0 ? (
                <p className="text-xs text-gray-400">No modules licensed yet. Contact your platform admin.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {activeModules.map((m) => (
                    <span key={m} className="text-xs font-medium px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 capitalize">{m}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Activity audit log — surfaces the cross-domain admin trail recorded
            in system_audit_log + ticket_audit_log (UNION endpoint). User asked
            for "an audit log of all activities done by Tenant admin and sub
            admins with date / activity / user". */}
        <AuditActivityPanel />

        {/* Recent team members */}
        {members.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Team Members</h2>
              <button onClick={() => navigate('/settings?tab=team')} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                View all <ArrowRight className="w-3 h-3" />
              </button>
            </div>
            <div className="space-y-2">
              {members.slice(0, 5).map((u: any) => (
                <div key={u.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                    style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #57A93C 100%)' }}>
                    {u.name?.[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{u.name}</p>
                    <p className="text-xs text-gray-400 truncate">{u.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded-md bg-gray-100 text-gray-600 capitalize">{u.role?.replace('_',' ')}</span>
                    <span className={`w-2 h-2 rounded-full shrink-0 ${u.is_active ? 'bg-green-400' : 'bg-gray-300'}`} title={u.is_active ? 'Active' : 'Inactive'} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Audit activity panel ──────────────────────────────────────────────────
// Surfaces the combined ticket_audit_log + system_audit_log feed for the
// tenant admin. Reads /api/v1/settings/audit-log which UNIONs both.
interface AuditRow {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  actor_name: string | null;
  actor_email: string | null;
  actor_role: string | null;
  created_at: string;
  old_value?: any;
  new_value?: any;
}

function AuditActivityPanel() {
  const navigate = useNavigate();
  const { data: rows } = useQuery<AuditRow[]>({
    queryKey: ['audit-log-recent'],
    queryFn: () => api.get('/api/v1/settings/audit-log?limit=20').then((r) => r.data.data),
    refetchInterval: 30_000,
  });
  const recent = rows ?? [];

  function describe(r: AuditRow): string {
    const labelPart = r.entity_label ? ` "${r.entity_label}"` : '';
    const action = r.action.replace(/_/g, ' ');
    return `${action} ${r.entity_type}${labelPart}`;
  }

  function timeAgo(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-gray-500" />
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Activity Audit Log</h2>
        </div>
        <button onClick={() => navigate('/settings?tab=audit')} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
          View all <ArrowRight className="w-3 h-3" />
        </button>
      </div>
      {recent.length === 0 ? (
        <p className="text-xs text-gray-400">No activity yet — admin actions like user invites, role changes, and ticket updates will appear here.</p>
      ) : (
        <div className="divide-y divide-gray-50">
          {recent.slice(0, 8).map((r) => (
            <div key={r.id} className="flex items-start gap-3 py-2.5">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold text-white ${
                r.entity_type === 'user'       ? 'bg-blue-500' :
                r.entity_type === 'role'       ? 'bg-violet-500' :
                r.entity_type === 'department' ? 'bg-amber-500' :
                r.entity_type === 'ticket'     ? 'bg-emerald-500' :
                                                 'bg-gray-400'
              }`}>
                {(r.actor_name ?? '?').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900 leading-snug">
                  <span className="font-medium">{r.actor_name ?? 'System'}</span>
                  <span className="text-gray-500"> — {describe(r)}</span>
                </p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {timeAgo(r.created_at)} · {new Date(r.created_at).toLocaleString()}
                  {r.actor_role && <> · <span className="capitalize">{r.actor_role.replace('_', ' ')}</span></>}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
