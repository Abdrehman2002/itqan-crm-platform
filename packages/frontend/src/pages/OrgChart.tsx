/**
 * OrgChart — visual org hierarchy for tenant admin & managers.
 * - Tenant admin: full company tree
 * - Manager / line_manager: own subtree
 * Each node shows online/idle/offline + direct-report count.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Crown, ShieldCheck, Users, User, ChevronDown, ChevronRight,
  Circle, Mail, Phone, Briefcase,
} from 'lucide-react';
import { api } from '../services/api';

interface OrgNode {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  whatsapp_number?: string | null;
  role: 'tenant_admin' | 'manager' | 'line_manager' | 'agent' | 'viewer';
  department: string | null;
  department_type: string | null;
  is_active: boolean;
  is_online: boolean;
  max_direct_reports: number | null;
  last_active_at: string | null;
  children: OrgNode[];
}

interface OrgData {
  roots: OrgNode[];
  managers: {
    id: string;
    name: string;
    role: string;
    department_type: string | null;
    max_direct_reports: number | null;
    direct_reports: number;
    is_online: boolean;
  }[];
}

const ROLE_META: Record<string, { label: string; color: string; Icon: typeof Crown }> = {
  tenant_admin: { label: 'Tenant Admin', color: 'bg-purple-100 text-purple-700 border-purple-200',  Icon: Crown },
  manager:      { label: 'Manager',      color: 'bg-blue-100 text-blue-700 border-blue-200',        Icon: ShieldCheck },
  line_manager: { label: 'Line Manager', color: 'bg-teal-100 text-teal-700 border-teal-200',        Icon: Users },
  agent:        { label: 'Agent',        color: 'bg-slate-100 text-slate-700 border-slate-200',     Icon: User },
  viewer:       { label: 'Viewer',       color: 'bg-gray-100 text-gray-600 border-gray-200',        Icon: User },
};

const DEPT_META: Record<string, { label: string; color: string }> = {
  sales:     { label: 'Sales',      color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  support:   { label: 'Support',    color: 'bg-sky-50 text-sky-700 border-sky-200' },
  complaint: { label: 'Complaints', color: 'bg-rose-50 text-rose-700 border-rose-200' },
};

function PresenceDot({ isOnline, lastActiveAt }: { isOnline: boolean; lastActiveAt: string | null }) {
  if (isOnline) return <Circle className="w-3 h-3 fill-emerald-500 text-emerald-500" aria-label="Online" />;
  if (!lastActiveAt) return <Circle className="w-3 h-3 fill-gray-300 text-gray-300" aria-label="Never seen" />;
  const minutes = Math.floor((Date.now() - new Date(lastActiveAt).getTime()) / 60000);
  if (minutes < 10) return <Circle className="w-3 h-3 fill-amber-400 text-amber-400" aria-label={`Idle ${minutes}m`} />;
  return <Circle className="w-3 h-3 fill-gray-300 text-gray-300" aria-label="Offline" />;
}

function NodeCard({ node, depth, expanded, onToggle }: {
  node: OrgNode; depth: number;
  expanded: Set<string>; onToggle: (id: string) => void;
}) {
  const meta = ROLE_META[node.role] ?? ROLE_META.agent;
  const deptMeta = node.department_type ? DEPT_META[node.department_type] : null;
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isOpen = expanded.has(node.id);

  return (
    <div className="relative">
      <div
        className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 bg-white hover:bg-slate-50 transition"
        style={{ marginLeft: depth * 28 }}
      >
        {hasChildren ? (
          <button onClick={() => onToggle(node.id)} className="text-gray-400 hover:text-gray-700">
            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        ) : (
          <span className="w-4 h-4 inline-block" />
        )}

        <div className={`w-9 h-9 rounded-full flex items-center justify-center border ${meta.color}`}>
          <meta.Icon className="w-4 h-4" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900 truncate">{node.name}</span>
            <PresenceDot isOnline={node.is_online} lastActiveAt={node.last_active_at} />
            {!node.is_active && <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">inactive</span>}
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className={`px-1.5 py-0.5 rounded border ${meta.color}`}>{meta.label}</span>
            {deptMeta && <span className={`px-1.5 py-0.5 rounded border ${deptMeta.color}`}>{deptMeta.label}</span>}
          </div>
          {/* Contact channels — Email + Phone + WhatsApp (per product feedback) */}
          <div className="flex items-center gap-3 text-[11px] text-gray-500 mt-1 flex-wrap">
            <a href={`mailto:${node.email}`} onClick={e => e.stopPropagation()}
               className="hover:text-cyan-600 inline-flex items-center gap-1">
              ✉️ {node.email}
            </a>
            {node.phone && (
              <a href={`tel:${node.phone}`} onClick={e => e.stopPropagation()}
                 className="hover:text-cyan-600 inline-flex items-center gap-1">
                📞 {node.phone}
              </a>
            )}
            {node.whatsapp_number && (
              <a href={`https://wa.me/${node.whatsapp_number.replace(/[^\d]/g,'')}`}
                 target="_blank" rel="noreferrer"
                 onClick={e => e.stopPropagation()}
                 className="hover:text-emerald-600 inline-flex items-center gap-1">
                💬 {node.whatsapp_number}
              </a>
            )}
          </div>
        </div>

        {hasChildren && (
          <span className="text-xs text-gray-500 px-2 py-1 rounded-full bg-slate-100">
            {node.children.length}{node.max_direct_reports ? ` / ${node.max_direct_reports}` : ''} reports
          </span>
        )}
      </div>

      {isOpen && hasChildren && (
        <div className="mt-1 space-y-1 border-l border-dashed border-gray-200" style={{ marginLeft: depth * 28 + 24 }}>
          {node.children.map(child => (
            <NodeCard key={child.id} node={child} depth={depth + 1} expanded={expanded} onToggle={onToggle} />
          ))}
        </div>
      )}
    </div>
  );
}

export function OrgChart() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { data, isLoading, error } = useQuery<{ success: boolean; data: OrgData }>({
    queryKey: ['org-tree'],
    queryFn: () => api.get('/api/v1/settings/team/tree').then(r => r.data),
    refetchInterval: 30_000, // refresh presence every 30s
  });

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const expandAll = () => {
    if (!data?.data?.roots) return;
    const ids = new Set<string>();
    const walk = (nodes: OrgNode[]) => nodes.forEach(n => { ids.add(n.id); walk(n.children ?? []); });
    walk(data.data.roots);
    setExpanded(ids);
  };

  const collapseAll = () => setExpanded(new Set());

  if (isLoading) return <div className="p-8 text-gray-500">Loading organization…</div>;
  if (error) return <div className="p-8 text-red-600">Failed to load org chart.</div>;

  const roots = data?.data?.roots ?? [];
  const managers = data?.data?.managers ?? [];
  const online = managers.filter(m => m.is_online).length;

  return (
    <div className="flex h-full">
      {/* Main org tree */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Organization</h1>
            <p className="text-sm text-gray-500">
              {managers.length} {managers.length === 1 ? 'manager' : 'managers'} · {online} online now
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={expandAll} className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-slate-50">Expand all</button>
            <button onClick={collapseAll} className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-slate-50">Collapse all</button>
          </div>
        </div>

        {roots.length === 0 ? (
          <div className="text-center text-gray-500 py-12">
            <Users className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>No team members yet. Invite a Manager from Settings → Users.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {roots.map(node => (
              <NodeCard key={node.id} node={node} depth={0} expanded={expanded} onToggle={toggle} />
            ))}
          </div>
        )}
      </div>

      {/* Sidebar: department managers + capacity */}
      <aside className="w-80 border-l border-gray-100 bg-slate-50 p-6 overflow-y-auto">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4">Department managers</h2>
        {managers.length === 0 ? (
          <p className="text-sm text-gray-500">No managers assigned yet.</p>
        ) : (
          <div className="space-y-3">
            {managers.map(m => {
              const deptMeta = m.department_type ? DEPT_META[m.department_type] : null;
              const capacity = m.max_direct_reports ?? null;
              const pct = capacity ? Math.min(100, (m.direct_reports / capacity) * 100) : null;
              return (
                <div key={m.id} className="p-3 rounded-xl bg-white border border-gray-200">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900 text-sm">{m.name}</span>
                      <PresenceDot isOnline={m.is_online} lastActiveAt={null} />
                    </div>
                    {deptMeta && <span className={`text-xs px-1.5 py-0.5 rounded ${deptMeta.color}`}>{deptMeta.label}</span>}
                  </div>
                  <div className="text-xs text-gray-500 mb-1">
                    {m.direct_reports} direct reports{capacity ? ` of ${capacity} max` : ''}
                  </div>
                  {pct !== null && (
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </aside>
    </div>
  );
}
