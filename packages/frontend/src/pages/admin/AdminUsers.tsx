import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  UserPlus, Search, MoreVertical, UserCheck, UserX, Shield,
  Mail, Trash2, RefreshCw, ChevronDown, X, Check, AlertTriangle,
} from 'lucide-react';
import { api } from '../../services/api';

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  role_name?: string;
  role_color?: string;
  custom_role_id?: string;
  department?: string;
  is_active: boolean;
  last_login_at?: string;
  created_at: string;
}

interface Role {
  id: string;
  name: string;
  color?: string;
}


function Avatar({ name, size = 8 }: { name: string; size?: number }) {
  return (
    <div
      className={`w-${size} h-${size} rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0`}
      style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #57A93C 100%)' }}
    >
      {name?.[0]?.toUpperCase()}
    </div>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
      active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-green-500' : 'bg-gray-400'}`} />
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

function RoleBadge({ role, roleName, color }: { role: string; roleName?: string; color?: string }) {
  const label = roleName ?? role;
  const bg = color ? `${color}18` : 'rgba(41,171,226,0.1)';
  const fg = color ?? '#29ABE2';
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-md" style={{ background: bg, color: fg }}>
      {label}
    </span>
  );
}

interface Department { id: string; name: string; department_type?: string; is_system?: boolean; }

// role_key encodes the selection as "system:manager" or "custom:<uuid>"
function parseRoleKey(key: string, allRoles: Role[]): { role: string; custom_role_id?: string } {
  if (key.startsWith('custom:')) {
    const customRole = allRoles.find(r => r.id === key.slice(7));
    return { role: (customRole as any)?.base_role ?? 'agent', custom_role_id: key.slice(7) };
  }
  return { role: key.replace('system:', '') };
}

// ── Invite User Modal ─────────────────────────────────────────────────────────
function InviteModal({ roles, onClose, onSuccess }: { roles: Role[]; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({ name: '', email: '', role_key: 'system:agent', department_id: '' });
  const [error, setError] = useState('');

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['departments'],
    queryFn: async () => (await api.get('/api/v1/departments')).data.data,
  });

  const systemRoles = roles.filter((r: any) => r.is_system && r.base_role !== 'tenant_admin');
  const customRoles = roles.filter((r: any) => !r.is_system);

  const mut = useMutation({
    mutationFn: () => {
      const { role, custom_role_id } = parseRoleKey(form.role_key, roles);
      const dept = departments.find(d => d.id === form.department_id);
      return api.post('/api/v1/settings/team/invite', {
        email: form.email,
        name: form.name || undefined,
        role,
        custom_role_id,
        department: dept?.name,
        departmentType: dept?.department_type,
      });
    },
    onSuccess: () => { onSuccess(); onClose(); },
    onError: (e: any) => setError(e.response?.data?.error?.message ?? 'Failed to send invite'),
  });

  const canSubmit = form.email && form.department_id && !mut.isPending;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Invite Team Member</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Full Name</label>
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Jane Smith"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Email Address *</label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="jane@company.com"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Department *</label>
            <select
              value={form.department_id}
              onChange={e => setForm(f => ({ ...f, department_id: e.target.value }))}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white"
            >
              <option value="">— Select department —</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Role *</label>
            <select
              value={form.role_key}
              onChange={e => setForm(f => ({ ...f, role_key: e.target.value }))}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white"
            >
              {systemRoles.map(r => (
                <option key={r.id} value={`system:${(r as any).base_role}`}>{r.name}</option>
              ))}
              {customRoles.length > 0 && (
                <optgroup label="Custom Roles">
                  {customRoles.map(r => (
                    <option key={r.id} value={`custom:${r.id}`}>{r.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
            <p className="text-xs text-gray-400 mt-1">Controls what this member can see and do</p>
          </div>
          {error && (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 text-red-700 rounded-xl text-sm border border-red-100">
              <AlertTriangle className="w-4 h-4 shrink-0" />{error}
            </div>
          )}
          <p className="text-xs text-gray-400 flex items-center gap-1.5">
            <Mail className="w-3.5 h-3.5" />
            An invitation email will be sent with a password-setup link (valid 7 days).
          </p>
        </div>
        <div className="flex gap-3 px-6 pb-5">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={() => mut.mutate()}
            disabled={!canSubmit}
            className="flex-1 px-4 py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #1a8cbf 100%)' }}
          >
            {mut.isPending ? 'Sending…' : 'Send Invite'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit Role Modal ───────────────────────────────────────────────────────────
function EditRoleModal({ member, roles, onClose, onSuccess }: {
  member: Member; roles: Role[]; onClose: () => void; onSuccess: () => void;
}) {
  const initialKey = member.custom_role_id
    ? `custom:${member.custom_role_id}`
    : `system:${member.role}`;
  const [roleKey, setRoleKey] = useState(initialKey);
  const [error, setError] = useState('');

  const systemRoles = roles.filter((r: any) => r.is_system && r.base_role !== 'tenant_admin');
  const customRoles = roles.filter((r: any) => !r.is_system);

  const mut = useMutation({
    mutationFn: () => {
      const { role, custom_role_id } = parseRoleKey(roleKey, roles);
      return api.patch(`/api/v1/settings/team/${member.id}`, { role, custom_role_id: custom_role_id ?? null });
    },
    onSuccess: () => { onSuccess(); onClose(); },
    onError: (e: any) => setError(e.response?.data?.error?.message ?? 'Failed to update'),
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">Change Role</h2>
            <p className="text-xs text-gray-400 mt-0.5">{member.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Role</label>
            <select
              value={roleKey}
              onChange={e => setRoleKey(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
            >
              {systemRoles.map(r => (
                <option key={r.id} value={`system:${(r as any).base_role}`}>{r.name}</option>
              ))}
              {customRoles.length > 0 && (
                <optgroup label="Custom Roles">
                  {customRoles.map(r => (
                    <option key={r.id} value={`custom:${r.id}`}>{r.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex gap-3 px-6 pb-5">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50">Cancel</button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
            className="flex-1 px-4 py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #1a8cbf 100%)' }}
          >
            {mut.isPending ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Row Actions Menu ──────────────────────────────────────────────────────────
function RowMenu({ member, onEdit, onToggleActive, onDelete }: {
  member: Member;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      {open && (
        <>
          {/* U5 — bumped both backdrop and menu z-index above the table header's
              sticky elements + status badges. Previously z-10/20 was getting
              shadowed when the list was re-rendered after a sort/filter. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-50 bg-white rounded-xl shadow-lg border border-gray-100 py-1 w-44">
            <button
              onClick={() => { setOpen(false); onEdit(); }}
              className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <Shield className="w-3.5 h-3.5 text-blue-500" /> Change Role
            </button>
            <button
              onClick={() => { setOpen(false); onToggleActive(); }}
              className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              {member.is_active
                ? <><UserX className="w-3.5 h-3.5 text-amber-500" /> Deactivate</>
                : <><UserCheck className="w-3.5 h-3.5 text-green-500" /> Activate</>}
            </button>
            <div className="border-t border-gray-100 my-1" />
            <button
              onClick={() => { setOpen(false); onDelete(); }}
              className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
            >
              <Trash2 className="w-3.5 h-3.5" /> Remove User
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Delete Confirm Modal ──────────────────────────────────────────────────────
// Browser confirm() worked fine but the DELETE endpoint now soft-deletes (see
// U6) and the user needs to understand: the row stays, the login is killed,
// historical tickets/calls/deals keep this person's name visible. A proper modal
// communicates that instead of a one-liner native dialog.
function DeleteConfirmModal({ member, onCancel, onConfirm, isPending }: {
  member: Member; onCancel: () => void; onConfirm: () => void; isPending: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" /> Remove {member.name}?
          </h2>
        </div>
        <div className="px-6 py-5 space-y-3 text-sm">
          <p className="text-gray-700">
            <strong>{member.name}</strong> will be removed from the workspace and will no longer
            be able to log in.
          </p>
          <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-900">
            <p className="font-semibold mb-1">Their history is preserved.</p>
            <p>Tickets, calls, deals, and activities they handled in the past stay visible in
              reports and dashboards under their name. Re-inviting the same email later creates a
              new account — the historical record stays linked to the original.</p>
          </div>
        </div>
        <div className="flex gap-3 px-6 pb-5">
          <button onClick={onCancel}
            className="flex-1 px-4 py-2.5 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={isPending}
            className="flex-1 px-4 py-2.5 text-sm font-semibold text-white rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60">
            {isPending ? 'Removing…' : 'Remove user'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export function AdminUsers() {
  const qc = useQueryClient();
  // Honour ?invite=1 and ?filter=active|inactive from the TA dashboard tiles so
  // clicking "Total Users" / "Active Users" / "Inactive Users" / "Invite Team
  // Member" lands here pre-configured instead of dropping the user on a blank page.
  const [params, setParams] = useSearchParams();
  const initialFilter = (params.get('filter') as 'all' | 'active' | 'inactive' | null) ?? 'all';
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>(
    ['active','inactive','all'].includes(initialFilter) ? initialFilter : 'all'
  );
  const [showInvite, setShowInvite] = useState(params.get('invite') === '1');
  const [editMember, setEditMember] = useState<Member | null>(null);
  const [deleteMember, setDeleteMember] = useState<Member | null>(null);

  // Clean the query string after we've consumed it so refreshing doesn't re-open
  // the invite modal indefinitely.
  useEffect(() => {
    if (params.get('invite') === '1' || params.get('filter')) {
      const next = new URLSearchParams(params);
      next.delete('invite');
      next.delete('filter');
      setParams(next, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: members = [], isLoading } = useQuery<Member[]>({
    queryKey: ['admin-users'],
    queryFn: async () => (await api.get('/api/v1/settings/team')).data.data,
  });

  const { data: roles = [] } = useQuery<Role[]>({
    queryKey: ['roles'],
    queryFn: async () => (await api.get('/api/v1/roles')).data.data,
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api.patch(`/api/v1/settings/team/${id}`, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/settings/team/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-users'] }); setDeleteMember(null); },
  });

  const filtered = members.filter(m => {
    const matchSearch = !search || m.name?.toLowerCase().includes(search.toLowerCase()) || m.email.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'all' || (filter === 'active' ? m.is_active : !m.is_active);
    return matchSearch && matchFilter;
  });

  const activeCount   = members.filter(m => m.is_active).length;
  const inactiveCount = members.filter(m => !m.is_active).length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-8 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Users</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {members.length} total · {activeCount} active · {inactiveCount} inactive
            </p>
          </div>
          <button
            onClick={() => setShowInvite(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-xl hover:opacity-90 transition-opacity"
            style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #1a8cbf 100%)' }}
          >
            <UserPlus className="w-4 h-4" /> Invite User
          </button>
        </div>
      </div>

      <div className="px-8 py-6">
        {/* Search + filter bar */}
        <div className="flex items-center gap-3 mb-5">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or email…"
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <div className="flex gap-1.5">
            {(['all', 'active', 'inactive'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors ${
                  filter === f
                    ? 'bg-blue-500 text-white'
                    : 'bg-white text-gray-500 border border-gray-200 hover:border-gray-300'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="py-16 text-center text-gray-400 text-sm">Loading users…</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-gray-500 font-medium">No users found</p>
              <p className="text-gray-400 text-sm mt-1">
                {search ? 'Try a different search term' : 'Invite your first team member to get started.'}
              </p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left text-xs font-semibold text-gray-500 px-5 py-3">User</th>
                  <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3 hidden md:table-cell">Role</th>
                  <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3 hidden lg:table-cell">Department</th>
                  <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3">Status</th>
                  <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3 hidden xl:table-cell">Last Login</th>
                  <th className="w-12 px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(m => (
                  <tr key={m.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <Avatar name={m.name} />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{m.name}</p>
                          <p className="text-xs text-gray-400 truncate">{m.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 hidden md:table-cell">
                      <RoleBadge role={m.role} roleName={m.role_name} color={m.role_color} />
                    </td>
                    <td className="px-4 py-3.5 hidden lg:table-cell">
                      <span className="text-sm text-gray-500">{m.department ?? '—'}</span>
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusPill active={m.is_active} />
                    </td>
                    <td className="px-4 py-3.5 hidden xl:table-cell">
                      <span className="text-xs text-gray-400">
                        {m.last_login_at
                          ? new Date(m.last_login_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                          : 'Never'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <RowMenu
                        member={m}
                        onEdit={() => setEditMember(m)}
                        onToggleActive={() => toggleActive.mutate({ id: m.id, is_active: !m.is_active })}
                        onDelete={() => setDeleteMember(m)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Legend */}
        <p className="text-xs text-gray-400 mt-4">
          Inactive users cannot log in but their data is preserved. Use "Remove" to permanently delete.
        </p>
      </div>

      {showInvite && (
        <InviteModal
          roles={roles}
          onClose={() => setShowInvite(false)}
          onSuccess={() => qc.invalidateQueries({ queryKey: ['admin-users'] })}
        />
      )}
      {editMember && (
        <EditRoleModal
          member={editMember}
          roles={roles}
          onClose={() => setEditMember(null)}
          onSuccess={() => qc.invalidateQueries({ queryKey: ['admin-users'] })}
        />
      )}
      {deleteMember && (
        <DeleteConfirmModal
          member={deleteMember}
          onCancel={() => setDeleteMember(null)}
          onConfirm={() => deleteMut.mutate(deleteMember.id)}
          isPending={deleteMut.isPending}
        />
      )}
    </div>
  );
}
