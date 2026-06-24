import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Shield, Plus, Edit2, Trash2, X, Loader2,
  Lock, Users, ChevronUp, ChevronDown, AlertTriangle,
} from 'lucide-react';
import { api } from '../services/api';
import { useCan } from '../hooks/useRole';
import { useAuthStore } from '../store/auth.store';
import { PermissionsMatrix, ACTION_STYLE } from '../components/PermissionsMatrix';
import type { ActionType, ModuleDef } from '../components/PermissionsMatrix';

// ── Types ──────────────────────────────────────────────────────────────────
interface Role {
  id: string; name: string; description: string; color: string;
  is_system: boolean; base_role: string;
  permissions: Record<string, boolean>; user_count: number;
}

const BASE_ROLES = [
  { value: 'tenant_admin', label: 'Tenant Admin', desc: 'Full workspace access' },
  { value: 'manager',      label: 'Manager',      desc: 'Team & records management' },
  { value: 'agent',        label: 'Agent',        desc: 'Day-to-day CRM operations' },
  { value: 'viewer',       label: 'Viewer',       desc: 'Read-only access' },
];

const PRESET_COLORS = [
  '#6366f1','#7c3aed','#db2777','#dc2626','#ea580c',
  '#ca8a04','#16a34a','#059669','#0891b2','#2563eb','#64748b',
];

// ── Role Form Modal ────────────────────────────────────────────────────────
function RoleModal({
  role, modules, onClose,
}: {
  role?: Role | null;
  modules: ModuleDef[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!role;

  const [name,        setName]        = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [color,       setColor]       = useState(role?.color ?? '#6366f1');
  const [baseRole,    setBaseRole]    = useState(role?.base_role ?? 'agent');
  const blankPermissions = Object.fromEntries(
    modules.flatMap((m) => m.actions.map((a) => [a.key, false])),
  );
  const [permissions, setPermissions] = useState<Record<string, boolean>>(
    role?.permissions ?? blankPermissions,
  );
  const [error, setError] = useState('');

  const loadDefaults = async (br: string) => {
    setBaseRole(br);
    try {
      const res = await api.get(`/api/v1/roles/defaults/${br}`);
      if (res.data?.data) setPermissions(res.data.data);
    } catch { /* ignore */ }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (isEdit) {
        return api.patch(`/api/v1/roles/${role!.id}`, { name, description, color, permissions });
      }
      return api.post('/api/v1/roles', { name, description, color, base_role: baseRole, permissions });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles'] });
      qc.invalidateQueries({ queryKey: ['role-modules'] });
      onClose();
    },
    onError: (e: any) => setError(e.response?.data?.error?.message ?? 'Failed to save role'),
  });

  const isSystem = role?.is_system ?? false;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: color }}>
              <Shield className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">{isEdit ? 'Edit Role' : 'Create Custom Role'}</h2>
              {isSystem && <p className="text-xs text-gray-400 flex items-center gap-1"><Lock className="w-3 h-3" /> System role — display label editable · access level fixed</p>}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X className="w-5 h-5" /></button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {error && (
            <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>
          )}

          {/* Name field — always shown; color picker only for custom roles */}
          <div className="grid grid-cols-[1fr_auto] gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">
                  Display Label / Job Title {!isSystem && '*'}
                </label>
                <input
                  value={name} onChange={(e) => setName(e.target.value)}
                  placeholder={isSystem ? 'e.g. Branch Head, Senior Agent…' : 'e.g. Branch Head, Account Executive, Claims Officer…'}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400"
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  {isSystem
                    ? 'Rename to match your organisation. Access level and permissions are unchanged.'
                    : 'This is what appears in the UI. It does not affect permissions.'}
                </p>
              </div>
              {/* Color picker — hidden for system roles (structural, not customisable) */}
              {!isSystem && (
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Color</label>
                  <div className="flex gap-1.5 flex-wrap w-[180px]">
                    {PRESET_COLORS.map((c) => (
                      <button key={c} type="button" onClick={() => setColor(c)}
                        className={`w-6 h-6 rounded-full border-2 transition-all ${color === c ? 'border-gray-900 scale-110' : 'border-transparent'}`}
                        style={{ background: c }} />
                    ))}
                  </div>
                </div>
              )}
            </div>

          {!isSystem && (
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Description</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="Briefly describe what this role can do..."
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
            </div>
          )}

          {!isSystem && (
            <div>
              <label className="text-xs font-medium text-gray-600 mb-0.5 block">
                Access Level *
              </label>
              <p className="text-[11px] text-gray-400 mb-2">
                Controls what this role can see and do. The display label above is separate and can be anything.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {BASE_ROLES.map((br) => (
                  <button key={br.value} type="button" onClick={() => loadDefaults(br.value)}
                    className={`text-left px-3 py-2 rounded-lg border text-sm transition-all
                      ${baseRole === br.value ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-gray-200 hover:border-gray-300 text-gray-600'}`}>
                    <span className="font-medium">{br.label}</span>
                    <span className="text-xs block text-gray-400">{br.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-gray-600 mb-1.5 flex items-center gap-1 block">
              Module Permissions
            </label>
            <PermissionsMatrix
              modules={modules}
              permissions={permissions}
              onChange={setPermissions}
              readOnly={false}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex gap-2 shrink-0">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !name.trim()}
            className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2">
            {saveMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {isEdit ? 'Save Changes' : 'Create Role'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Role Card ──────────────────────────────────────────────────────────────
function RoleCard({ role, modules, onEdit, onDelete, canManage }: {
  role: Role; modules: ModuleDef[];
  onEdit: () => void; onDelete: () => void; canManage: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  // Build per-module summary: which modules have at least 1 enabled action
  const moduleSummary = modules
    .filter((mod) => mod.actions?.length)
    .map((mod) => {
      const enabled = mod.actions.filter((a) => role.permissions[a.key]).length;
      return { mod, enabled, total: mod.actions.length };
    })
    .filter(({ enabled }) => enabled > 0);

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="flex items-center gap-3 p-4">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
             style={{ background: role.color + '20', border: `2px solid ${role.color}` }}>
          <Shield className="w-4 h-4" style={{ color: role.color }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-900">{role.name}</p>
            {role.is_system && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 flex items-center gap-0.5">
                <Lock className="w-2.5 h-2.5" /> System
              </span>
            )}
          </div>
          {role.is_system ? (
            <p className="text-xs text-gray-400 mt-0.5">
              <span className="font-medium text-amber-600">Display name only</span>
              {' · '}Access level: <span className="capitalize font-medium text-gray-500">{role.base_role?.replace('_', ' ')}</span>
              {' · '}Rename freely — permissions stay fixed to this access level
            </p>
          ) : (
            <p className="text-xs text-gray-400 truncate">
              {role.description || `Access level: ${role.base_role?.replace('_', ' ')}`}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <Users className="w-3.5 h-3.5" />
            <span>{role.user_count} {role.user_count === 1 ? 'user' : 'users'}</span>
          </div>
          {canManage && (
            <>
              <button onClick={onEdit} className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors">
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              {!role.is_system && (
                <button onClick={onDelete} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}
          <button onClick={() => setExpanded(!expanded)}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Module chips summary */}
      {!expanded && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-3">
          {moduleSummary.map(({ mod, enabled, total }) => (
            <span key={mod.key}
              className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1
                ${enabled === total ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-600'}`}>
              {mod.icon} {mod.label}
              <span className="opacity-60 text-[10px]">{enabled}/{total}</span>
            </span>
          ))}
          {moduleSummary.length === 0 && (
            <span className="text-xs text-gray-300 italic">No access granted</span>
          )}
        </div>
      )}

      {/* Expanded full matrix */}
      {expanded && (
        <div className="px-4 pb-4">
          <PermissionsMatrix modules={modules} permissions={role.permissions} readOnly />
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export function RolesPage() {
  const qc = useQueryClient();
  const can = useCan();
  const { tenant } = useAuthStore();
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing]       = useState<Role | null>(null);
  const [deleting, setDeleting]     = useState<Role | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const pendingReview = !bannerDismissed && (tenant as any)?.settings?.pending_role_review === true;

  const dismissBanner = useMutation({
    mutationFn: () => api.patch('/api/v1/settings/tenant', { pending_role_review: false }),
    onSuccess: () => { setBannerDismissed(true); qc.invalidateQueries({ queryKey: ['tenant'] }); },
  });

  const { data: roles = [], isLoading: rolesLoading } = useQuery<Role[]>({
    queryKey: ['roles'],
    queryFn: () => api.get('/api/v1/roles').then((r) => r.data.data),
  });

  const { data: modules = [] } = useQuery<ModuleDef[]>({
    queryKey: ['role-modules'],
    queryFn: () => api.get('/api/v1/roles/modules').then((r) => r.data.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/roles/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['roles'] }); setDeleting(null); },
  });

  const systemRoles = roles.filter((r) => r.is_system);
  const customRoles = roles.filter((r) => !r.is_system);

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-gray-100 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Roles & Permissions</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              Define what each team member can see and do in the CRM
            </p>
          </div>
          {can.manageTeam && (
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700">
              <Plus className="w-4 h-4" /> Create Role
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {pendingReview && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
            <span className="text-lg shrink-0">⚠️</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-800">New permissions were added to the platform</p>
              <p className="text-xs text-amber-700 mt-0.5">
                Your roles have been automatically updated with default values for any new permission keys.
                Please review each role to confirm the defaults are correct for your organisation.
              </p>
            </div>
            <button onClick={() => dismissBanner.mutate()}
              className="shrink-0 text-amber-500 hover:text-amber-700 p-0.5">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {rolesLoading && (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 text-brand-400 animate-spin" /></div>
        )}

        {systemRoles.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">System Roles</h2>
              <div className="flex-1 h-px bg-gray-100" />
              <span className="text-xs text-gray-300 flex items-center gap-1"><Lock className="w-3 h-3" /> Built-in, cannot be deleted</span>
            </div>
            <div className="space-y-2">
              {systemRoles.map((role) => (
                <RoleCard key={role.id} role={role} modules={modules}
                  onEdit={() => setEditing(role)}
                  onDelete={() => setDeleting(role)}
                  canManage={can.manageTeam} />
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Custom Roles</h2>
            <div className="flex-1 h-px bg-gray-100" />
          </div>
          {customRoles.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed border-gray-100 rounded-xl">
              <Shield className="w-10 h-10 mx-auto mb-3 text-gray-200" />
              <p className="text-sm font-medium text-gray-400">No custom roles yet</p>
              <p className="text-xs text-gray-300 mt-1">Create roles like Regional Manager, Territory Lead, Department Head...</p>
              {can.manageTeam && (
                <button onClick={() => setShowCreate(true)}
                  className="mt-4 px-4 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700 inline-flex items-center gap-2">
                  <Plus className="w-4 h-4" /> Create your first custom role
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {customRoles.map((role) => (
                <RoleCard key={role.id} role={role} modules={modules}
                  onEdit={() => setEditing(role)}
                  onDelete={() => setDeleting(role)}
                  canManage={can.manageTeam} />
              ))}
            </div>
          )}
        </div>
      </div>

      {(showCreate || editing) && (
        <RoleModal
          role={editing}
          modules={modules}
          onClose={() => { setShowCreate(false); setEditing(null); }}
        />
      )}

      {deleting && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h3 className="font-semibold text-gray-900 mb-2">Delete "{deleting.name}"?</h3>
            <p className="text-sm text-gray-500 mb-5">
              This role will be permanently deleted. Users must be reassigned first.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setDeleting(null)} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={() => deleteMutation.mutate(deleting.id)} disabled={deleteMutation.isPending}
                className="flex-1 py-2 bg-red-500 text-white rounded-lg text-sm hover:bg-red-600 disabled:opacity-50 flex items-center justify-center gap-2">
                {deleteMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Delete Role
              </button>
            </div>
            {deleteMutation.isError && (
              <p className="text-xs text-red-500 mt-2 text-center">
                {(deleteMutation.error as any)?.response?.data?.error?.message}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
