import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, DollarSign, Trophy, X, Loader2, ChevronDown } from 'lucide-react';
import { api } from '../services/api';
import { formatCurrency } from '../utils/format';
import { useCan } from '../hooks/useRole';

const STAGE_COLORS = [
  'border-t-slate-400', 'border-t-blue-400', 'border-t-brand-400',
  'border-t-vivid-green-400', 'border-t-emerald-400', 'border-t-amber-400',
];

export function Deals() {
  const qc = useQueryClient();
  const can = useCan();
  const [selectedPipeline, setSelectedPipeline] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [dragging, setDragging] = useState<any | null>(null);
  const [form, setForm] = useState({ name: '', amount: '', stageId: '', contactId: '', pipelineId: '' });

  const { data: pipelines } = useQuery({
    queryKey: ['pipelines'],
    queryFn: () => api.get('/api/v1/deals/pipelines').then((r) => r.data.data ?? []),
  });

  useEffect(() => {
    if (!selectedPipeline && pipelines?.[0]) setSelectedPipeline(pipelines[0].id);
  }, [pipelines, selectedPipeline]);

  const { data: board, isLoading } = useQuery({
    queryKey: ['board', selectedPipeline],
    queryFn: () => api.get(`/api/v1/deals/board/${selectedPipeline}`).then((r) => r.data.data),
    enabled: !!selectedPipeline,
  });

  const moveMutation = useMutation({
    mutationFn: ({ id, stageId }: { id: string; stageId: string }) =>
      api.patch(`/api/v1/deals/${id}/stage`, { stageId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['board'] }),
  });

  const wonMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/deals/${id}/won`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['board'] }),
  });

  const createMutation = useMutation({
    mutationFn: (body: any) => api.post('/api/v1/deals', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['board'] }); setShowCreate(false); },
  });

  const handleDrop = (stageId: string) => {
    if (!dragging || dragging.stage_id === stageId) return;
    moveMutation.mutate({ id: dragging.id, stageId });
    setDragging(null);
  };

  const stages = board?.board ?? [];
  const pipeline = board?.pipeline;

  const totalValue = stages.reduce((sum: number, s: any) => sum + (parseFloat(s.totalValue) || 0), 0);
  const totalDeals = stages.reduce((sum: number, s: any) => sum + (s.deals?.length ?? 0), 0);

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-4 shrink-0">
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-gray-900">Deals</h1>
          <p className="text-xs text-gray-400">{totalDeals} open · {formatCurrency(totalValue)} pipeline</p>
        </div>

        {/* Pipeline selector */}
        <div className="relative">
          <select
            value={selectedPipeline ?? ''}
            onChange={(e) => setSelectedPipeline(e.target.value)}
            className="appearance-none pl-3 pr-8 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400 text-gray-700"
          >
            {(pipelines ?? []).map((p: any) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
        </div>

        {can.writeRecords && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700"
          >
            <Plus className="w-4 h-4" /> Add Deal
          </button>
        )}
      </div>

      {/* Kanban board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
          </div>
        ) : (
          <div className="flex gap-3 h-full min-w-max">
            {stages.map((stage: any, idx: number) => (
              <div
                key={stage.id}
                className="flex flex-col w-64 bg-gray-50 rounded-xl shrink-0"
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(stage.id)}
              >
                {/* Stage header */}
                <div className={`p-3 border-t-2 ${STAGE_COLORS[idx % STAGE_COLORS.length]} rounded-t-xl`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{stage.name}</p>
                      <p className="text-xs text-gray-400">{stage.probability}% · {stage.deals?.length ?? 0} deals</p>
                    </div>
                    <p className="text-xs font-medium text-gray-600">{formatCurrency(parseFloat(stage.totalValue) || 0)}</p>
                  </div>
                </div>

                {/* Deal cards */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {(stage.deals ?? []).map((deal: any) => (
                    <div
                      key={deal.id}
                      draggable
                      onDragStart={() => setDragging(deal)}
                      onDragEnd={() => setDragging(null)}
                      className={`bg-white rounded-lg p-3 shadow-sm border border-gray-100 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow ${dragging?.id === deal.id ? 'opacity-50' : ''}`}
                    >
                      <p className="text-sm font-medium text-gray-900 mb-1 leading-tight">{deal.name}</p>
                      {deal.contact_name && (
                        <p className="text-xs text-gray-500 mb-2">{deal.contact_name}</p>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-brand-600">
                          {deal.amount ? formatCurrency(parseFloat(deal.amount), deal.currency) : '—'}
                        </span>
                        <button
                          onClick={() => wonMutation.mutate(deal.id)}
                          className="p-1 text-gray-300 hover:text-amber-500 transition-colors"
                          title="Mark as won"
                        >
                          <Trophy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {deal.close_date && (
                        <p className="text-xs text-gray-400 mt-1.5">
                          Close: {new Date(deal.close_date).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  ))}

                  {stage.deals?.length === 0 && (
                    <div className="text-center py-6 text-gray-300 text-xs">Drop deals here</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create deal modal */}
      {showCreate && pipeline && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-gray-900">New Deal</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Deal Name *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Enterprise package — Acme Corp"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Amount</label>
                  <div className="relative">
                    <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                    <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
                      className="w-full pl-7 pr-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Stage *</label>
                  <select value={form.stageId} onChange={(e) => setForm({ ...form, stageId: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400">
                    <option value="">Select stage</option>
                    {(pipeline.stages ?? []).map((s: any) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button onClick={() => setShowCreate(false)} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button
                onClick={() => createMutation.mutate({ ...form, pipelineId: selectedPipeline, amount: form.amount ? Number(form.amount) : undefined })}
                disabled={!form.name || !form.stageId || createMutation.isPending}
                className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {createMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Create Deal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
