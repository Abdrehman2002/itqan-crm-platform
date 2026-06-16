import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Shield, Plus, Edit2, Trash2, X, Check, Loader2,
  Lock, Users, ChevronDown, ChevronUp, Info,
} from 'lucide-react';
import { api } from '../services/api';
import { useCan } from '../hooks/useRole';

// ── Types ──────────────────────────────────────────────────────────────────
interface ModuleDef {
  key: string; label: string; icon: string; levels: string[];
}
interface Role {
  id: string; name: string; description: string; color: string;
  is_system: boolean; base_role: string;
  permissions: Record<string, string>; user_count: number;
}

const BASE_ROLES = [
  { value: 'tenant_admin', label: 'Tenant Admin', desc: 'Full workspace access' },
  { value: 'manager',      label: 'Manager',      desc: 'Team & records management' },
  { value: 'agent',        label: 'Agent',        desc: 'Day-to-day CRM operations' },
  { value: 'viewer',       label: 'Viewer',       desc: 'Read-only access' },
];

const LEVEL_COLORS: Record<string, string> = {
  none: 'bg-gray-100 text-gray-400',
  view: 'bg-blue-50 text-blue-600',
  full: 'bg-green-50 text-green-700',
};

const PRESET_COLORS = [
  '#6366f1','#7c3aed','#db2777','#dc2626','#ea580c',
  '#ca8a04','#16a34a','#059669','#0891b2','#2563eb','#64748b',
];

// ── Permissions Matrix ─────────────────────────────────────────────────────
function PermissionsMatrix({
  modules, permissions, onChange, readOnly = false,
}: {
  modules: ModuleDef[];
  permissions: Record<string, string>;
  onChange?: (perms: Record<string, string>) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="grid bg-gray-50 border-b border-gray-100 px-4 py-2"
           style={{ gridTemplateColumns: '1fr repeat(3, 80px)' }}>
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Module</span>
        {['None', 'View', 'Full'].map((l) => (
          <span key={l} className="text-xs font-semibold text-gray-500 uppercase tracking-wide text-center">{l}</span>
        ))}
      </div>

      {modules.map((mod, idx) => {
        const current = permissions[mod.key] ?? 'none';
        return (
          <div key={mod.key}
               className={`grid items-center px-4 py-2.5 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
               style={{ gridTemplateColumns: '1fr repeat(3, 80px)' }}>
            <div className="flex items-center gap-2">
              <span className="text-base">{mod.icon}</span>
              <span className="text-sm font-medium text-gray-700">{mod.label}</span>
            </div>
            {['none', 'view', 'full'].map((level) => {
              const available = mod.levels.includes(level);
              const selected  = current === level;
              return (
                <div key={level} className="flex justify-center">
                  {available ? (
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() => !readOnly && onChange?.({ ...permissions, [mod.key]: level })}
                      className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all
                        ${selected
                          ? level === 'none' ? 'border-gray-400 bg-gray-400'
                            : level === 'view' ? 'border-blue-500 bg-blue-500'
                            : 'border-green-500 bg-green-500'
                          : 'border-gray-200 bg-white hover:border-gray-400'}
                        ${readOnly ? 'cursor-default' : 'cursor-pointer'}`}
                    >
                      {selected && <Check className="w-3 h-3 text-white" />}
                    </button>
                  ) : (
                    <div className="w-6 h-6 flex items-center justify-center">
                      <div className="w-1.5 h-1.5 rounded-full bg-gray-200" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-2.5 bg-gray-50 border-t border-gray-100">
        {[
          { level: 'none', label: 'Hidden — user cannot see this module' },
          { level: 'view', label: 'View only — read access' },
          { level: 'full', label: 'Full — create, edit & delete' },
        ].map(({ level, label }) => (
          <div key={level} className={`flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full ${LEVEL_COLORS[level]}`}>
            <span className="font-semibold capitalize">{level}</span>
            <span className="hidden sm:inline text-gray-400">— {label.split('—')[1]?.trim()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

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
  const [permissions, setPermissions] = useState<Record<string, string>>(
    role?.permissions ?? {},
  );
  const [error, setError] = useState('');

  // When base role changes, load defaults
  const loadDefaults = async (br: string) => {
    setBaseRole(br);
    try {
      const res = await api.get(`/api/v1/roles/modules`);
      const mods: ModuleDef[] = res.data.data;
      const defaults: Record<string, string> = {};
      // Use the defaults endpoint by creating a temp role
      const defRes = await api.post('/api/v1/roles', { name: '__temp__', base_role: br, color: '#000' }).catch(() => null);
      if (defRes) {
        setPermissions(defRes.data.data.permissions);
        await api.delete(`/api/v1/roles/${defRes.data.data.id}`).catch(() => {});
      }
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
              <h2 className="font-semibold text-gray-900">{isEdit ? (isSystem ? 'Edit Permissions' : 'Edit Role') : 'Create Custom Role'}</h2>
              {isSystem && <p className="text-xs text-amber-600 flex items-center gap-1"><Lock className="w-3 h-3" /> System role — only permissions can be changed</p>}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X className="w-5 h-5" /></button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {error && (
            <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>
          )}

          {/* Name & Color */}
          {!isSystem && (
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Role Name *</label>
                <input
                  value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Regional Manager, Territory Lead..."
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400"
                />
              </div>
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
            </div>
          )}

          {/* Description */}
          {!isSystem && (
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Description</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="Briefly describe what this role can do..."
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
            </div>
          )}

          {/* Base Role (create only) */}
          {!isEdit && (
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1.5 block">
                Start from template <span className="text-gray-400 font-normal">(sets default permissions below)</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {BASE_ROLES.map((br) => (
                  <button key={br.value} type="button" onClick={() => loadDefaults(br.value)}
                    className={`px-3 py-2 rounded-lg border text-left transition-all ${
                      baseRole === br.value ? 'border-brand-400 bg-brand-50' : 'border-gray-100 hover:border-gray-200'
                    }`}>
                    <p className="text-sm font-medium text-gray-800">{br.label}</p>
                    <p className="text-xs text-gray-400">{br.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Permissions Matrix */}
          <div>
            <label className="text-xs font-medium text-gray-600 mb-2 block flex items-center gap-1">
              Module Permissions
              <Info className="w-3 h-3 text-gray-400" />
            </label>
            <PermissionsMatrix
              modules={modules}
              permissions={permissions}
              onChange={setPermissions}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex gap-2 shrink-0">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || (!isSystem && !name.trim())}
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

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="flex items-center gap-3 p-4">
        {/* Color dot */}
        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
             style={{ background: role.color + '20', border: `2px solid ${role.color}` }}>
          <Shield className="w-4 h-4" style={{ color: role.color }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-gray-900">{role.name}</p>
            {role.is_system && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 flex items-center gap-0.5">
                <Lock className="w-2.5 h-2.5" /> System
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 truncate">{role.description || `Based on ${role.base_role}`}</p>
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

      {/* Quick permission chips */}
      {!expanded && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-3">
          {modules.map((mod) => {
            const level = role.permissions[mod.key] ?? 'none';
            if (level === 'none') return null;
            return (
              <span key={mod.key} className={`text-xs px-2 py-0.5 rounded-full ${LEVEL_COLORS[level]}`}>
                {mod.icon} {mod.label}
                {level === 'view' ? ' (view)' : ''}
              </span>
            );
          })}
        </div>
      )}

      {/* Expanded permissions matrix */}
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
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing]       = useState<Role | null>(null);
  const [deleting, setDeleting]     = useState<Role | null>(null);

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
      {/* Header */}
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
        {rolesLoading && (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 text-brand-400 animate-spin" /></div>
        )}

        {/* System Roles */}
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

        {/* Custom Roles */}
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

      {/* Create / Edit Modal */}
      {(showCreate || editing) && (
        <RoleModal
          role={editing}
          modules={modules}
          onClose={() => { setShowCreate(false); setEditing(null); }}
        />
      )}

      {/* Delete Confirm */}
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
