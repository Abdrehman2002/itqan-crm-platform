import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Pencil, Trash2, X, Check, Lock } from 'lucide-react';
import { api } from '../services/api';

interface Department {
  id: string;
  name: string;
  description?: string;
  department_type?: string;
  is_system?: boolean;
  member_count?: number;
}

const DEPT_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  sales:              { label: 'Sales',             color: '#29ABE2' },
  support:            { label: 'Support',           color: '#57A93C' },
  compliance_audit:   { label: 'Compliance',        color: '#f59e0b' },
  finance_billing:    { label: 'Finance',           color: '#8b5cf6' },
  technical_operations: { label: 'Technical',       color: '#0ea5e9' },
  operations:         { label: 'Operations',        color: '#64748b' },
};

export function Departments() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['departments'],
    queryFn: async () => {
      const res = await api.get('/api/v1/departments');
      return res.data.data as Department[];
    },
  });

  const createMut = useMutation({
    mutationFn: (body: { name: string; description: string }) => api.post('/api/v1/departments', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['departments'] }); setAdding(false); setForm({ name: '', description: '' }); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...body }: { id: string; name: string; description: string }) => api.patch(`/api/v1/departments/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['departments'] }); setEditId(null); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/departments/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['departments'] }),
  });

  const departments = data ?? [];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-100 px-8 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Departments</h1>
          <p className="text-sm text-gray-500 mt-0.5">Organise your team into departments</p>
        </div>
        <button
          onClick={() => { setAdding(true); setForm({ name: '', description: '' }); }}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-xl hover:opacity-90"
          style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #1a8cbf 100%)' }}
        >
          <Plus className="w-4 h-4" /> Add Department
        </button>
      </div>

      <div className="px-8 py-6 max-w-3xl">
        {/* Add form */}
        {adding && (
          <div className="bg-white rounded-2xl border border-blue-100 shadow-sm p-5 mb-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">New Department</h3>
            <div className="space-y-3">
              <input
                autoFocus
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Department name"
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              <input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Description (optional)"
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setAdding(false)} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
                <button
                  onClick={() => createMut.mutate(form)}
                  disabled={!form.name.trim() || createMut.isPending}
                  className="px-4 py-1.5 text-sm font-medium text-white bg-blue-500 rounded-lg disabled:opacity-50 hover:bg-blue-600"
                >
                  {createMut.isPending ? 'Creating…' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-16 text-gray-400 text-sm">Loading…</div>
        ) : departments.length === 0 && !adding ? (
          <div className="text-center py-16">
            <Building2 className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No departments yet</p>
            <p className="text-gray-400 text-sm mt-1">Create your first department to organise your team.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {departments.map(dept => (
              <div key={dept.id} className="bg-white rounded-xl border border-gray-100 px-5 py-4 flex items-center gap-4 shadow-sm">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(41,171,226,0.1)' }}>
                  <Building2 className="w-4.5 h-4.5 text-blue-500" />
                </div>
                {editId === dept.id ? (
                  <div className="flex-1 flex gap-2">
                    <input
                      autoFocus
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      className="flex-1 px-2 py-1 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-200"
                    />
                    <input
                      value={form.description}
                      onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                      placeholder="Description"
                      className="flex-1 px-2 py-1 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-200"
                    />
                    <button onClick={() => updateMut.mutate({ id: dept.id, ...form })} className="p-1.5 text-green-600 hover:text-green-700"><Check className="w-4 h-4" /></button>
                    <button onClick={() => setEditId(null)} className="p-1.5 text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-gray-900">{dept.name}</p>
                        {dept.department_type && DEPT_TYPE_LABELS[dept.department_type] && (
                          <span
                            className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                            style={{
                              background: DEPT_TYPE_LABELS[dept.department_type].color + '18',
                              color: DEPT_TYPE_LABELS[dept.department_type].color,
                            }}
                          >
                            {DEPT_TYPE_LABELS[dept.department_type].label}
                          </span>
                        )}
                        {dept.is_system && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 flex items-center gap-0.5">
                            <Lock className="w-2.5 h-2.5" /> System
                          </span>
                        )}
                      </div>
                      {dept.description && <p className="text-xs text-gray-400 mt-0.5 truncate">{dept.description}</p>}
                    </div>
                    {dept.member_count !== undefined && (
                      <span className="text-xs text-gray-400 shrink-0">{dept.member_count} member{dept.member_count !== 1 ? 's' : ''}</span>
                    )}
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => { setEditId(dept.id); setForm({ name: dept.name, description: dept.description ?? '' }); }}
                        className="p-1.5 text-gray-300 hover:text-gray-600 rounded-lg hover:bg-gray-50"
                        title="Rename"
                      ><Pencil className="w-3.5 h-3.5" /></button>
                      {!dept.is_system && (
                        <button
                          onClick={() => { if (confirm(`Delete "${dept.name}"?`)) deleteMut.mutate(dept.id); }}
                          className="p-1.5 text-gray-300 hover:text-red-500 rounded-lg hover:bg-red-50"
                          title="Delete"
                        ><Trash2 className="w-3.5 h-3.5" /></button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
