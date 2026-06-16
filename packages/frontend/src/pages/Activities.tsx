import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckSquare, Clock, Plus, AlertTriangle, Calendar, CheckCircle2, Loader2, X } from 'lucide-react';
import { api } from '../services/api';
import { formatDate } from '../utils/format';
import { useCan } from '../hooks/useRole';

const TYPE_ICONS: Record<string, string> = {
  call: '📞', email: '📧', meeting: '🤝', task: '✅',
  note: '📝', whatsapp: '💬', sms: '📱', demo: '🖥️',
  voice_bot_call: '🤖', proposal: '📄',
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'text-gray-400', normal: 'text-blue-500',
  high: 'text-orange-500', urgent: 'text-red-600',
};

export function Activities() {
  const qc = useQueryClient();
  const can = useCan();
  const [tab, setTab] = useState<'today' | 'overdue' | 'all'>('today');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ type: 'task', subject: '', dueAt: '', priority: 'normal', body: '' });

  const { data: todayData } = useQuery({
    queryKey: ['activities', 'today'],
    queryFn: () => api.get('/api/v1/activities/today').then((r) => r.data.data),
    refetchInterval: 60_000,
  });

  const { data: overdueData } = useQuery({
    queryKey: ['activities', 'overdue'],
    queryFn: () => api.get('/api/v1/activities/overdue').then((r) => r.data.data),
    refetchInterval: 60_000,
  });

  const { data: allData } = useQuery({
    queryKey: ['activities', 'all'],
    queryFn: () => api.get('/api/v1/activities', { params: { pageSize: 50 } }).then((r) => r.data.data),
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/activities/${id}/complete`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['activities'] }); },
  });

  const createMutation = useMutation({
    mutationFn: (body: any) => api.post('/api/v1/activities', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['activities'] }); setShowCreate(false); setForm({ type: 'task', subject: '', dueAt: '', priority: 'normal', body: '' }); },
  });

  const items = tab === 'today' ? todayData : tab === 'overdue' ? overdueData : allData;
  const overdueCount = overdueData?.length ?? 0;

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Activities</h1>
          {overdueCount > 0 && (
            <p className="text-xs text-red-500 flex items-center gap-1 mt-0.5">
              <AlertTriangle className="w-3 h-3" />{overdueCount} overdue
            </p>
          )}
        </div>
        {can.writeRecords && (
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700">
            <Plus className="w-4 h-4" /> Add Task
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-100 px-5 shrink-0">
        {[
          { key: 'today',   label: "Today's Schedule", icon: Calendar },
          { key: 'overdue', label: `Overdue ${overdueCount > 0 ? `(${overdueCount})` : ''}`, icon: AlertTriangle },
          { key: 'all',     label: 'All Activities', icon: CheckSquare },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key as any)}
            className={`flex items-center gap-1.5 px-4 py-3 text-sm border-b-2 transition-colors ${
              tab === key
                ? 'border-brand-500 text-brand-600 font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon className={`w-3.5 h-3.5 ${key === 'overdue' && overdueCount > 0 ? 'text-red-500' : ''}`} />
            {label}
          </button>
        ))}
      </div>

      {/* Activity list */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
        {!items ? (
          <div className="flex items-center justify-center h-40"><Loader2 className="w-5 h-5 text-brand-400 animate-spin" /></div>
        ) : items.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <CheckCircle2 className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">{tab === 'today' ? "You're all clear for today 🎉" : 'No activities found'}</p>
          </div>
        ) : (
          items.map((act: any) => {
            const isOverdue = act.due_at && new Date(act.due_at) < new Date() && act.status === 'pending';
            return (
              <div key={act.id} className={`flex items-start gap-3 px-5 py-3.5 hover:bg-gray-50 ${isOverdue ? 'bg-red-50/30' : ''}`}>
                <button
                  onClick={() => completeMutation.mutate(act.id)}
                  disabled={act.status === 'completed' || completeMutation.isPending}
                  className="mt-0.5 shrink-0"
                >
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                    act.status === 'completed'
                      ? 'bg-green-500 border-green-500'
                      : isOverdue
                        ? 'border-red-400 hover:bg-red-50'
                        : 'border-gray-300 hover:border-brand-400'
                  }`}>
                    {act.status === 'completed' && <CheckCircle2 className="w-3 h-3 text-white fill-white" />}
                  </div>
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{TYPE_ICONS[act.type] ?? '📌'}</span>
                    <p className={`text-sm font-medium ${act.status === 'completed' ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                      {act.subject}
                    </p>
                    <span className={`text-xs font-medium capitalize ${PRIORITY_COLORS[act.priority]}`}>
                      {act.priority !== 'normal' ? act.priority : ''}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 mt-0.5">
                    {act.contact_name && <span className="text-xs text-gray-400">👤 {act.contact_name}</span>}
                    {act.deal_name && <span className="text-xs text-gray-400">💼 {act.deal_name}</span>}
                    {act.owner_name && <span className="text-xs text-gray-400">by {act.owner_name}</span>}
                  </div>
                </div>

                {act.due_at && (
                  <div className={`shrink-0 flex items-center gap-1 text-xs ${isOverdue ? 'text-red-500' : 'text-gray-400'}`}>
                    <Clock className="w-3 h-3" />
                    {formatDate(act.due_at)}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-gray-900">New Activity</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Type</label>
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400">
                    {Object.entries(TYPE_ICONS).map(([k, v]) => (
                      <option key={k} value={k}>{v} {k.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Priority</label>
                  <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400">
                    {['low','normal','high','urgent'].map((p) => <option key={p} value={p} className="capitalize">{p}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Subject *</label>
                <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  placeholder="e.g. Follow up on proposal"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Due Date</label>
                <input type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Notes</label>
                <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })}
                  rows={3} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400 resize-none" />
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button onClick={() => setShowCreate(false)} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={() => createMutation.mutate({ ...form, dueAt: form.dueAt || undefined })}
                disabled={!form.subject || createMutation.isPending}
                className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {createMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
