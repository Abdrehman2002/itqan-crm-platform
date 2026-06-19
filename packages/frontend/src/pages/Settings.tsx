import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Save, Loader2, Building2, Users, Clock,
  UserPlus, Trash2, Edit2, Check, X, Search, Crown,
  ShieldCheck, UserCheck, Eye,
  Route, Tag, Plus, AlertCircle, Layers, ToggleLeft, ToggleRight,
} from 'lucide-react';
import { api } from '../services/api';
import { MilestoneSettings } from './MilestoneSettings';
import { useAuthStore } from '../store/auth.store';
import { useIsAdmin } from '../hooks/useRole';

type Tab = 'workspace' | 'modules' | 'team' | 'routing' | 'tags';

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: 'workspace', label: 'Workspace',    icon: Building2 },
  { id: 'modules',   label: 'Modules',      icon: Layers    },
  { id: 'team',      label: 'Team',         icon: Users     },
  { id: 'routing',   label: 'Routing & SLA',icon: Route     },
  { id: 'tags',      label: 'Tags',         icon: Tag       },
];

function WorkspaceSettings() {
  const { tenant } = useAuthStore();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: tenant?.name ?? '',
    domain: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    dateFormat: 'MM/DD/YYYY',
    currency: 'USD',
  });
  const [saved, setSaved] = useState(false);

  const mutation = useMutation({
    mutationFn: (body: typeof form) => api.patch('/api/v1/settings/workspace', body),
    onSuccess: () => {
      setSaved(true);
      qc.invalidateQueries({ queryKey: ['me'] });
      setTimeout(() => setSaved(false), 2000);
    },
  });

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Workspace Settings</h2>
        <p className="text-sm text-gray-500 mt-0.5">Manage your organization details and preferences.</p>
      </div>
      <div className="space-y-4">
        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">Workspace Name</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">Custom Domain</label>
          <input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })}
            placeholder="crm.yourcompany.com"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
          <p className="text-xs text-gray-400 mt-1">Point a CNAME record to <code className="bg-gray-100 px-1 rounded">app.crmplatform.io</code></p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Timezone</label>
            <select value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400">
              {['Asia/Karachi', 'UTC', 'America/New_York', 'America/Chicago', 'America/Los_Angeles',
                'Europe/London', 'Europe/Berlin', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore'].map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Date Format</label>
            <select value={form.dateFormat} onChange={(e) => setForm({ ...form, dateFormat: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400">
              {['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'].map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">Default Currency</label>
          <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400">
            {['USD', 'PKR', 'GBP', 'EUR', 'AED', 'SAR'].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>
      <button onClick={() => mutation.mutate(form)} disabled={mutation.isPending}
        className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700 disabled:opacity-50">
        {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
        {saved ? 'Saved!' : 'Save Changes'}
      </button>
    </div>
  );
}

// ── Role config ───────────────────────────────────────────────────────────────

const ROLE_CONFIG: Record<string, { label: string; icon: React.ElementType; badge: string; desc: string }> = {
  super_admin:  { label: 'Super Admin',  icon: Crown,       badge: 'bg-purple-100 text-purple-700', desc: 'Full platform access' },
  tenant_admin: { label: 'Admin',        icon: ShieldCheck, badge: 'bg-red-100 text-red-700',       desc: 'Full workspace access' },
  manager:      { label: 'Manager',      icon: UserCheck,   badge: 'bg-orange-100 text-orange-700', desc: 'Manage team & records' },
  agent:        { label: 'Agent',        icon: Users,       badge: 'bg-blue-100 text-blue-700',     desc: 'Create & edit records' },
  viewer:       { label: 'Viewer',       icon: Eye,         badge: 'bg-gray-100 text-gray-600',     desc: 'Read-only access' },
};

const ASSIGNABLE_ROLES = ['tenant_admin', 'manager', 'agent', 'viewer'];

function RoleBadge({ role }: { role: string }) {
  const cfg = ROLE_CONFIG[role] ?? ROLE_CONFIG.viewer;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.badge}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function fmtLastLogin(iso: string | null) {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30)  return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Invite modal ──────────────────────────────────────────────────────────────

function InviteModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [email,           setEmail]          = useState('');
  const [name,            setName]           = useState('');
  const [department,      setDepartment]     = useState('');
  const [departmentType,  setDepartmentType] = useState('');
  const [selectedRoleId,  setSelectedRoleId] = useState('');
  const [managerId,       setManagerId]      = useState('');
  const [error,           setError]          = useState('');

  // Fetch all roles (system + custom)
  const { data: allRoles = [] } = useQuery<any[]>({
    queryKey: ['roles'],
    queryFn: () => api.get('/api/v1/roles').then((r) => r.data.data),
  });

  // Fetch structured department types (Gap 8)
  const { data: deptTypes = [] } = useQuery<Array<{ value: string; label: string }>>({
    queryKey: ['dept-types'],
    queryFn: () => api.get('/api/v1/settings/team/department-types').then(r => r.data.data ?? []),
  });

  // Fetch team members for line manager dropdown
  const { data: allMembers = [] } = useQuery<any[]>({
    queryKey: ['team-members'],
    queryFn: () => api.get('/api/v1/settings/team').then((r) => r.data.data ?? []),
  });

  // Default to first non-admin system role
  const defaultRole = allRoles.find((r) => r.base_role === 'agent' && r.is_system);
  const roleId = selectedRoleId || defaultRole?.id || '';
  const selectedRole = allRoles.find((r) => r.id === roleId);

  const mutation = useMutation({
    mutationFn: () => api.post('/api/v1/settings/team/invite', {
      email, name,
      role: selectedRole?.base_role ?? 'agent',
      custom_role_id: roleId,
      permissions: selectedRole?.permissions,
      department:     department || undefined,
      departmentType: departmentType || undefined,
      manager_id:     managerId || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['team-members'] }); onClose(); },
    onError:   (e: any) => setError(e.response?.data?.error?.message ?? 'Failed to invite user'),
  });

  const systemRoles = allRoles.filter((r) => r.is_system && r.base_role !== 'tenant_admin');
  const customRoles = allRoles.filter((r) => !r.is_system);

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
          <div>
            <h2 className="font-semibold text-gray-900">Invite Team Member</h2>
            <p className="text-xs text-gray-400 mt-0.5">Assign a role before sending — they'll only see what you allow</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 pb-2 space-y-4">
          {error && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">{error}</div>
          )}

          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Full Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Jane Smith"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Email Address *</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@company.com"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
          </div>

          {/* Department (Gap 8: structured type dropdown) */}
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Department <span className="text-gray-400 font-normal">(optional)</span></label>
            <input value={department} onChange={(e) => setDepartment(e.target.value)}
              placeholder="e.g. Customer Support, Sales"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400 mb-2" />
            {deptTypes.length > 0 && (
              <>
                <label className="text-xs font-medium text-gray-600 mb-1 block">
                  Department Type <span className="text-gray-400 font-normal">— sets module access automatically</span>
                </label>
                <select value={departmentType} onChange={(e) => setDepartmentType(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400">
                  <option value="">— No department type —</option>
                  {deptTypes.map(dt => (
                    <option key={dt.value} value={dt.value}>{dt.label}</option>
                  ))}
                </select>
                <p className="text-[11px] text-gray-400 mt-1">Selecting a type auto-configures which modules this user can access based on their department's responsibilities.</p>
              </>
            )}
          </div>

          {/* Line Manager */}
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Line Manager <span className="text-gray-400 font-normal">(optional)</span></label>
            <select value={managerId} onChange={(e) => setManagerId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400">
              <option value="">— No line manager —</option>
              {allMembers.filter((m: any) => m.role !== 'super_admin').map((m: any) => (
                <option key={m.id} value={m.id}>{m.name} ({m.role_name ?? m.role})</option>
              ))}
            </select>
          </div>

          {/* Role selection */}
          <div>
            <label className="text-xs font-medium text-gray-600 mb-2 block">Assign Role *</label>

            {systemRoles.length > 0 && (
              <p className="text-xs text-gray-400 mb-1.5">System Roles</p>
            )}
            <div className="space-y-1.5 mb-3">
              {systemRoles.map((r) => (
                <label key={r.id} className={`flex items-center gap-3 p-2.5 rounded-xl border-2 cursor-pointer transition-colors ${
                  roleId === r.id ? 'border-brand-400 bg-brand-50' : 'border-gray-100 hover:border-gray-200'
                }`}>
                  <input type="radio" name="role" checked={roleId === r.id}
                    onChange={() => setSelectedRoleId(r.id)} className="sr-only" />
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ background: r.color }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{r.name}</p>
                    <p className="text-xs text-gray-400 truncate">{r.description}</p>
                  </div>
                  {roleId === r.id && <Check className="w-4 h-4 text-brand-500 shrink-0" />}
                </label>
              ))}
            </div>

            {customRoles.length > 0 && (
              <>
                <p className="text-xs text-gray-400 mb-1.5">Custom Roles</p>
                <div className="space-y-1.5">
                  {customRoles.map((r) => (
                    <label key={r.id} className={`flex items-center gap-3 p-2.5 rounded-xl border-2 cursor-pointer transition-colors ${
                      roleId === r.id ? 'border-brand-400 bg-brand-50' : 'border-gray-100 hover:border-gray-200'
                    }`}>
                      <input type="radio" name="role" checked={roleId === r.id}
                        onChange={() => setSelectedRoleId(r.id)} className="sr-only" />
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ background: r.color }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900">{r.name}</p>
                        <p className="text-xs text-gray-400 truncate">{r.description || r.base_role}</p>
                      </div>
                      {roleId === r.id && <Check className="w-4 h-4 text-brand-500 shrink-0" />}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex gap-2 px-6 py-4 border-t border-gray-100 shrink-0">
          <button onClick={onClose}
            className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!email || !roleId || mutation.isPending}
            className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
            Send Invite
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Member row ────────────────────────────────────────────────────────────────

function MemberRow({ member, currentUserId, isAdmin, allMembers }: {
  member: any;
  currentUserId: string;
  isAdmin: boolean;
  allMembers: any[];
}) {
  const qc = useQueryClient();
  const [editingRole,    setEditingRole]    = useState(false);
  const [editingManager, setEditingManager] = useState(false);
  const [confirmDelete,  setConfirmDelete]  = useState(false);
  const isSelf = member.id === currentUserId;
  const isSuperAdmin = member.role === 'super_admin';

  const roleMutation = useMutation({
    mutationFn: (role: string) => api.patch(`/api/v1/settings/team/${member.id}`, { role }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['team-members'] }); setEditingRole(false); },
  });

  const managerMutation = useMutation({
    mutationFn: (mgr_id: string | null) => api.patch(`/api/v1/settings/team/${member.id}`, { manager_id: mgr_id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['team-members'] }); setEditingManager(false); },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/v1/settings/team/${member.id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['team-members'] }); setConfirmDelete(false); },
  });

  const initials = member.name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() || '?';

  return (
    <div className={`flex items-center gap-4 p-4 rounded-xl border transition-colors ${
      isSelf ? 'bg-brand-50 border-brand-100' : 'bg-white border-gray-100 hover:border-gray-200'
    }`}>
      {/* Avatar */}
      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-400 to-purple-500 flex items-center justify-center text-white text-sm font-bold shrink-0">
        {initials}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-gray-900 truncate">{member.name}</p>
          {isSelf && <span className="text-xs px-1.5 py-0.5 bg-brand-100 text-brand-700 rounded-full font-medium">You</span>}
        </div>
        <p className="text-xs text-gray-400 truncate">{member.email}</p>
        {member.manager_name && (
          <p className="text-xs text-gray-400 truncate mt-0.5">Reports to: <span className="text-gray-600">{member.manager_name}</span></p>
        )}
      </div>

      {/* Last login */}
      <div className="hidden md:flex items-center gap-1 text-xs text-gray-400 shrink-0">
        <Clock className="w-3 h-3" />
        {fmtLastLogin(member.last_login_at)}
      </div>

      {/* Role — editable dropdown for admins */}
      <div className="shrink-0">
        {isAdmin && !isSelf && !isSuperAdmin && editingRole ? (
          <select
            autoFocus
            defaultValue={member.role}
            onChange={(e) => roleMutation.mutate(e.target.value)}
            onBlur={() => setEditingRole(false)}
            className="text-xs border border-brand-300 rounded-lg px-2 py-1 outline-none focus:border-brand-500 bg-white"
          >
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_CONFIG[r].label}</option>
            ))}
          </select>
        ) : (
          <button
            onClick={() => isAdmin && !isSelf && !isSuperAdmin && setEditingRole(true)}
            className={`flex items-center gap-1 ${isAdmin && !isSelf && !isSuperAdmin ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
            title={isAdmin && !isSelf && !isSuperAdmin ? 'Click to change role' : undefined}
          >
            <RoleBadge role={member.role} />
            {isAdmin && !isSelf && !isSuperAdmin && <Edit2 className="w-3 h-3 text-gray-300" />}
          </button>
        )}
      </div>

      {/* Line Manager — editable */}
      {isAdmin && !isSelf && !isSuperAdmin && (
        <div className="shrink-0">
          {editingManager ? (
            <select
              autoFocus
              defaultValue={member.manager_id ?? ''}
              onChange={(e) => managerMutation.mutate(e.target.value || null)}
              onBlur={() => setEditingManager(false)}
              className="text-xs border border-brand-300 rounded-lg px-2 py-1 outline-none focus:border-brand-500 bg-white max-w-[140px]"
            >
              <option value="">No manager</option>
              {allMembers.filter((m: any) => m.id !== member.id && m.role !== 'super_admin').map((m: any) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          ) : (
            <button
              onClick={() => setEditingManager(true)}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 cursor-pointer"
              title="Set line manager"
            >
              <UserCheck className="w-3 h-3" />
              <span className="hidden lg:inline max-w-[80px] truncate">{member.manager_name ?? 'Set manager'}</span>
            </button>
          )}
        </div>
      )}

      {/* Remove button */}
      {isAdmin && !isSelf && !isSuperAdmin && (
        <div className="shrink-0">
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <span className="text-xs text-red-600 font-medium">Remove?</span>
              <button onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="p-1 rounded bg-red-100 text-red-600 hover:bg-red-200">
                {deleteMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              </button>
              <button onClick={() => setConfirmDelete(false)} className="p-1 rounded bg-gray-100 text-gray-500 hover:bg-gray-200">
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)}
              className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Team Settings main ────────────────────────────────────────────────────────

function TeamSettings() {
  const { user } = useAuthStore();
  const isAdmin   = useIsAdmin();
  const qc        = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);
  const [search,     setSearch]     = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['team-members'],
    queryFn: () => api.get('/api/v1/settings/team').then((r) => r.data.data ?? []),
  });

  const filtered = members.filter((m: any) => {
    const matchSearch = !search ||
      m.name?.toLowerCase().includes(search.toLowerCase()) ||
      m.email?.toLowerCase().includes(search.toLowerCase());
    const matchRole = !roleFilter || m.role === roleFilter;
    return matchSearch && matchRole;
  });

  // Stats
  const total   = members.length;
  const admins  = members.filter((m: any) => ['super_admin','tenant_admin'].includes(m.role)).length;
  const managers = members.filter((m: any) => m.role === 'manager').length;
  const agents  = members.filter((m: any) => m.role === 'agent').length;
  const viewers = members.filter((m: any) => m.role === 'viewer').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Team Members</h2>
          <p className="text-sm text-gray-500 mt-0.5">Manage who has access and what they can do.</p>
        </div>
        {isAdmin && (
          <button onClick={() => setShowInvite(true)}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm rounded-xl hover:bg-brand-700 font-medium">
            <UserPlus className="w-4 h-4" />
            Invite Member
          </button>
        )}
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total',    value: total,    color: 'text-gray-800',   bg: 'bg-gray-50'       },
          { label: 'Admins',   value: admins,   color: 'text-red-700',    bg: 'bg-red-50'        },
          { label: 'Managers', value: managers, color: 'text-orange-700', bg: 'bg-orange-50'     },
          { label: 'Agents',   value: agents,   color: 'text-blue-700',   bg: 'bg-blue-50'       },
        ].map((s) => (
          <div key={s.label} className={`${s.bg} rounded-xl p-4 text-center`}>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Role permission guide */}
      <div className="bg-gray-50 rounded-xl p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Role Permissions</p>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(ROLE_CONFIG).filter(([r]) => r !== 'super_admin').map(([r, cfg]) => {
            const Icon = cfg.icon;
            return (
              <div key={r} className="flex items-center gap-2.5 p-2 bg-white rounded-lg border border-gray-100">
                <span className={`p-1.5 rounded-lg ${cfg.badge}`}><Icon className="w-3.5 h-3.5" /></span>
                <div>
                  <p className="text-xs font-semibold text-gray-800">{cfg.label}</p>
                  <p className="text-xs text-gray-400">{cfg.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400" />
        </div>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400 text-gray-700">
          <option value="">All roles</option>
          {Object.entries(ROLE_CONFIG).map(([r, cfg]) => (
            <option key={r} value={r}>{cfg.label}</option>
          ))}
        </select>
      </div>

      {/* Member list */}
      <div className="space-y-2">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">{search || roleFilter ? 'No members match your filters' : 'No team members yet'}</p>
          </div>
        ) : (
          filtered.map((m: any) => (
            <MemberRow key={m.id} member={m} currentUserId={user?.id ?? ''} isAdmin={isAdmin} allMembers={members} />
          ))
        )}
      </div>

      {showInvite && <InviteModal onClose={() => setShowInvite(false)} />}
    </div>
  );
}

// ── Routing & SLA Settings ────────────────────────────────────────────────────

function RoutingSettings() {
  const qc = useQueryClient();
  const [saved, setSaved] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['routing-settings'],
    queryFn: () => api.get('/api/v1/settings/routing').then((r) => r.data.data),
  });

  const [form, setForm] = useState<{
    per_agent_ticket_limit: number;
    routing_method: string;
    csat_expiry_days: number;
  } | null>(null);

  // Initialise form once data loads
  const formValues = form ?? (data ? {
    per_agent_ticket_limit: data.routing.per_agent_ticket_limit,
    routing_method:         data.routing.routing_method,
    csat_expiry_days:       data.csat.expiry_days,
  } : null);

  const mutation = useMutation({
    mutationFn: (body: typeof formValues) => api.patch('/api/v1/settings/routing', body),
    onSuccess: () => {
      setSaved(true);
      qc.invalidateQueries({ queryKey: ['routing-settings'] });
      setTimeout(() => setSaved(false), 2500);
    },
  });

  if (isLoading || !formValues) {
    return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 text-brand-400 animate-spin" /></div>;
  }

  const set = (k: keyof typeof formValues, v: any) => setForm({ ...formValues, [k]: v });

  return (
    <div className="space-y-8 max-w-lg">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Routing & SLA</h2>
        <p className="text-sm text-gray-500 mt-0.5">Configure how tickets are assigned and how surveys expire.</p>
      </div>

      {/* Ticket Routing */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Route className="w-4 h-4 text-brand-500" /> Ticket Routing
        </h3>

        {/* Routing Method */}
        <div>
          <label className="text-xs font-medium text-gray-600 mb-2 block">Routing Method</label>
          <div className="space-y-2">
            {([
              { value: 'random_capacity', label: 'Smart Capacity Routing', desc: 'Randomly assigns to agents under the ticket limit. Agents with 0 tickets get 2× priority.' },
              { value: 'round_robin',     label: 'Round Robin',            desc: 'Assigns tickets evenly in rotation regardless of current load.' },
              { value: 'manual',          label: 'Manual Only',            desc: 'No auto-routing. Managers assign all tickets manually.' },
            ] as const).map((opt) => (
              <label key={opt.value} className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${
                formValues.routing_method === opt.value
                  ? 'border-brand-400 bg-brand-50'
                  : 'border-gray-100 hover:border-gray-200 bg-white'
              }`}>
                <input type="radio" name="routing_method" value={opt.value}
                  checked={formValues.routing_method === opt.value}
                  onChange={() => set('routing_method', opt.value)}
                  className="mt-0.5 accent-brand-600" />
                <div>
                  <p className="text-sm font-medium text-gray-900">{opt.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{opt.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Per-agent limit */}
        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">
            Per-Agent Ticket Limit
          </label>
          <div className="flex items-center gap-3">
            <input
              type="number" min={0} max={500}
              value={formValues.per_agent_ticket_limit}
              onChange={(e) => set('per_agent_ticket_limit', Math.max(0, parseInt(e.target.value) || 0))}
              className="w-28 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400"
            />
            <span className="text-xs text-gray-400">
              {formValues.per_agent_ticket_limit === 0
                ? 'Unlimited — no cap enforced'
                : `Max ${formValues.per_agent_ticket_limit} open tickets per agent`}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-1 flex items-start gap-1">
            <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
            When all agents hit the limit, the ticket overflows to the agent with the fewest tickets.
            Set to <strong>0</strong> to disable the limit.
          </p>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-gray-100" />

      {/* CSAT */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-700">CSAT Survey Expiry</h3>
        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">Survey Link Valid For</label>
          <div className="flex items-center gap-3">
            <input
              type="number" min={1} max={90}
              value={formValues.csat_expiry_days}
              onChange={(e) => set('csat_expiry_days', Math.min(90, Math.max(1, parseInt(e.target.value) || 7)))}
              className="w-28 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400"
            />
            <span className="text-xs text-gray-400">days after ticket close (1–90)</span>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Customers who click a CSAT link after this period will see an "expired" message.
          </p>
        </div>
      </div>

      <button
        onClick={() => mutation.mutate(formValues)}
        disabled={mutation.isPending}
        className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700 disabled:opacity-50"
      >
        {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
        {saved ? 'Saved!' : 'Save Settings'}
      </button>
    </div>
  );
}

// ── Tag Management Settings ───────────────────────────────────────────────────

function TagsSettings() {
  const qc = useQueryClient();

  const { data: tags = [], isLoading } = useQuery<any[]>({
    queryKey: ['ticket-tags'],
    queryFn: () => api.get('/api/v1/tickets/tags').then((r) => r.data.data ?? []),
  });

  const [creating, setCreating]   = useState(false);
  const [newName,  setNewName]    = useState('');
  const [newColor, setNewColor]   = useState('#6b7280');
  const [newDesc,  setNewDesc]    = useState('');
  const [createErr, setCreateErr] = useState('');

  const [editId,    setEditId]    = useState<string | null>(null);
  const [editName,  setEditName]  = useState('');
  const [editColor, setEditColor] = useState('');
  const [editDesc,  setEditDesc]  = useState('');

  const createMutation = useMutation({
    mutationFn: () => api.post('/api/v1/tickets/tags', { name: newName, color: newColor, description: newDesc }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticket-tags'] });
      setCreating(false); setNewName(''); setNewColor('#6b7280'); setNewDesc(''); setCreateErr('');
    },
    onError: (e: any) => setCreateErr(e.response?.data?.error?.message ?? 'Failed to create tag'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...body }: any) => api.patch(`/api/v1/tickets/tags/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ticket-tags'] }); setEditId(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/tickets/tags/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ticket-tags'] }),
  });

  const startEdit = (t: any) => {
    setEditId(t.id); setEditName(t.name); setEditColor(t.color); setEditDesc(t.description ?? '');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Ticket Tags</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Manage reusable labels for categorising tickets across your workspace.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm rounded-xl hover:bg-brand-700 font-medium"
        >
          <Plus className="w-4 h-4" /> New Tag
        </button>
      </div>

      {/* Create form */}
      {creating && (
        <div className="border-2 border-brand-200 bg-brand-50 rounded-xl p-4 space-y-3">
          <p className="text-sm font-semibold text-gray-800">New Tag</p>
          {createErr && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{createErr}</p>}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-medium text-gray-600 mb-1 block">Name *</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. billing"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400 bg-white"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  className="w-10 h-[38px] rounded-lg border border-gray-200 cursor-pointer p-0.5 bg-white"
                />
                <input
                  type="text"
                  value={newColor}
                  maxLength={7}
                  onChange={(e) => { setNewColor(e.target.value); }}
                  className="w-24 px-2 py-2 text-xs font-mono border border-gray-200 rounded-lg outline-none focus:border-brand-400 bg-white"
                />
              </div>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Description (optional)</label>
            <input
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="What is this tag for?"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400 bg-white"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => createMutation.mutate()}
              disabled={!newName.trim() || createMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700 disabled:opacity-50"
            >
              {createMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Create Tag
            </button>
            <button
              onClick={() => { setCreating(false); setCreateErr(''); }}
              className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Tag list */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-brand-400 animate-spin" /></div>
      ) : tags.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Tag className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No tags yet. Create your first tag above.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tags.map((t: any) => (
            <div key={t.id} className="flex items-center gap-3 p-3 bg-white border border-gray-100 rounded-xl hover:border-gray-200 transition-colors">
              {editId === t.id ? (
                /* Inline edit row */
                <div className="flex-1 flex items-center gap-2 flex-wrap">
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="flex-1 min-w-0 px-2 py-1.5 text-sm border border-brand-300 rounded-lg outline-none focus:border-brand-500"
                  />
                  <input
                    type="color"
                    value={editColor}
                    onChange={(e) => setEditColor(e.target.value)}
                    className="w-9 h-9 rounded-lg border border-gray-200 cursor-pointer p-0.5"
                  />
                  <input
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    placeholder="Description"
                    className="flex-1 min-w-0 px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400"
                  />
                  <button
                    onClick={() => updateMutation.mutate({ id: t.id, name: editName, color: editColor, description: editDesc })}
                    disabled={!editName.trim() || updateMutation.isPending}
                    className="p-1.5 rounded-lg bg-brand-100 text-brand-700 hover:bg-brand-200 disabled:opacity-50"
                  >
                    {updateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={() => setEditId(null)} className="p-1.5 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                /* Display row */
                <>
                  <span
                    className="w-3.5 h-3.5 rounded-full shrink-0 ring-1 ring-black/10"
                    style={{ backgroundColor: t.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-gray-900">{t.name}</span>
                    {t.description && <span className="text-xs text-gray-400 ml-2">{t.description}</span>}
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">
                    {t.usage_count ?? 0} ticket{t.usage_count !== 1 ? 's' : ''}
                  </span>
                  <button onClick={() => startEdit(t)} className="p-1.5 rounded-lg text-gray-300 hover:text-brand-500 hover:bg-brand-50 transition-colors">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => { if (confirm(`Delete tag "${t.name}"? It will be removed from all tickets.`)) deleteMutation.mutate(t.id); }}
                    className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Module Toggles (Gap 9) ────────────────────────────────────────────────

// Extended module metadata for the settings UI
const MODULE_META: Record<string, { icon: string; warning?: string }> = {
  crm:          { icon: '🏢' },
  voice:        { icon: '📞' },
  voicebot:     { icon: '🤖' },
  ticketing:    { icon: '🎫' },
  emails:       { icon: '✉️'  },
  integrations: { icon: '🔌' },
  analytics:    { icon: '📊' },
};

function ModulesSettings() {
  const qc = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  // Returns full catalog with licensed + enabled flags per module
  const { data: modules = [], isLoading } = useQuery<any[]>({
    queryKey: ['workspace-modules'],
    queryFn:  () => api.get('/api/v1/settings/workspace/modules').then(r => r.data.data ?? []),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      api.patch('/api/v1/settings/workspace/modules', { modules: { [key]: enabled } }),
    onMutate: ({ key }) => { setSaving(key); setToggleError(null); },
    onError: (err: any) => {
      setToggleError(err?.response?.data?.error?.message ?? 'Failed to update module');
    },
    onSettled: () => {
      setSaving(null);
      qc.invalidateQueries({ queryKey: ['workspace-modules'] });
    },
  });

  // Split into licensed (can manage) and unlicensed (locked)
  const licensed   = modules.filter((m: any) => m.licensed || m.always);
  const unlicensed = modules.filter((m: any) => !m.licensed && !m.always);

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Workspace Modules</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Enable or disable features for your workspace. You can only manage modules your platform administrator
          has licensed for you.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-300" /></div>
      ) : (
        <>
          {/* Licensed modules */}
          <div className="space-y-3">
            {licensed.map((mod: any) => {
              const meta = MODULE_META[mod.key] ?? { icon: '📦' };
              const isSaving = saving === mod.key;
              const isAlways = mod.always;
              return (
                <div key={mod.key} className={`flex items-start gap-4 p-4 rounded-xl border transition-colors ${
                  mod.enabled ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-100'
                } ${isAlways ? 'opacity-60' : ''}`}>
                  <span className="text-2xl mt-0.5 shrink-0">{meta.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`text-sm font-semibold ${mod.enabled ? 'text-gray-900' : 'text-gray-500'}`}>{mod.label}</p>
                      {isAlways && (
                        <span className="text-[10px] bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded-full font-medium">Always On</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{mod.description}</p>
                  </div>
                  {isAlways ? (
                    <span className="flex items-center gap-1 text-xs text-emerald-600 font-semibold bg-emerald-50 px-2 py-1 rounded-full shrink-0">
                      <Check className="w-3 h-3" /> On
                    </span>
                  ) : (
                    <button
                      onClick={() => toggleMutation.mutate({ key: mod.key, enabled: !mod.enabled })}
                      disabled={isSaving}
                      className="shrink-0 mt-0.5"
                      title={mod.enabled ? `Disable ${mod.label}` : `Enable ${mod.label}`}
                    >
                      {isSaving ? (
                        <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
                      ) : mod.enabled ? (
                        <ToggleRight className="w-8 h-8 text-brand-600" />
                      ) : (
                        <ToggleLeft className="w-8 h-8 text-gray-300" />
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Unlicensed modules — visible but locked */}
          {unlicensed.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Not Licensed</p>
              <div className="space-y-2">
                {unlicensed.map((mod: any) => {
                  const meta = MODULE_META[mod.key] ?? { icon: '📦' };
                  return (
                    <div key={mod.key} className="flex items-start gap-4 p-4 rounded-xl border border-dashed border-gray-200 bg-gray-50 opacity-60">
                      <span className="text-2xl mt-0.5 shrink-0 grayscale">{meta.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-400">{mod.label}</p>
                        <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{mod.description}</p>
                      </div>
                      <span className="shrink-0 flex items-center gap-1 text-[10px] text-gray-400 bg-gray-100 px-2 py-1 rounded-full mt-0.5 whitespace-nowrap">
                        🔒 Not licensed
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {toggleError && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <p className="text-xs text-red-700 flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            {toggleError}
          </p>
        </div>
      )}

      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
        <p className="text-xs text-blue-700 flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Module changes take effect immediately for all users in your workspace. Disabling a module hides it
          from navigation and restricts API access — existing data is preserved and reappears when re-enabled.
          To unlock additional modules, contact your platform administrator.
        </p>
      </div>
    </div>
  );
}

const TAB_CONTENT: Record<Tab, React.FC> = {
  workspace: WorkspaceSettings,
  modules:   ModulesSettings,
  team:      TeamSettings,
  routing:   RoutingSettings,
  tags:      TagsSettings,
};

export function Settings() {
  const [tab, setTab] = useState<Tab>('workspace');
  const TabContent = TAB_CONTENT[tab];

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-52 border-r border-gray-100 p-3 space-y-0.5">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 mb-3">Workspace Settings</p>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
              tab === id ? 'bg-brand-50 text-brand-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
            }`}>
            <Icon className="w-4 h-4 shrink-0" />
            {label}
          </button>
        ))}
      </div>
      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8">
        <TabContent />
      </div>
    </div>
  );
}
