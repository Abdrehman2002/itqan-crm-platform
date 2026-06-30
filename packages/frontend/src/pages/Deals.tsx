import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, DollarSign, Trophy, X, Loader2, ChevronDown,
  Building2, User, Calendar,
} from 'lucide-react';
import { api } from '../services/api';
import { formatCurrency } from '../utils/format';
import { useCan } from '../hooks/useRole';

const STAGE_COLORS = [
  'border-t-slate-400', 'border-t-blue-400', 'border-t-brand-400',
  'border-t-vivid-green-400', 'border-t-emerald-400', 'border-t-amber-400',
];

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-gray-100 text-gray-500',
  medium: 'bg-blue-100 text-blue-600',
  high: 'bg-orange-100 text-orange-600',
};

const TYPE_ICONS: Record<string, string> = {
  call: '📞', email: '📧', meeting: '🤝', task: '✅',
  note: '📝', whatsapp: '💬', sms: '📱', demo: '🖥️',
  voice_bot_call: '🤖', proposal: '📄',
};

function getStageType(name: string): 'new' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'other' {
  const n = (name ?? '').toLowerCase();
  if (n.includes('new') || n.includes('lead') || n.includes('prospect')) return 'new';
  if (n.includes('qualif')) return 'qualified';
  if (n.includes('proposal') || n.includes('sent')) return 'proposal';
  if (n.includes('negot')) return 'negotiation';
  if (n.includes('won') || n.includes('closed')) return 'won';
  return 'other';
}

export function Deals() {
  const qc = useQueryClient();
  const can = useCan();
  // URL-driven open — when other pages link with ?open=<deal-id> (e.g. clickable
  // deal rows in ContactDetail) we auto-open the matching deal as soon as the
  // board for any pipeline finishes loading. We strip the param after consuming
  // it so the back button doesn't keep re-triggering it.
  const [searchParams, setSearchParams] = useSearchParams();
  const openDealParam = searchParams.get('open');
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(openDealParam);
  const [selectedPipeline, setSelectedPipeline] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [dragging, setDragging] = useState<any | null>(null);
  const [form, setForm] = useState({ name: '', amount: '', stageId: '' });

  const [selected, setSelected] = useState<any | null>(null);
  const [selectedStage, setSelectedStage] = useState<any | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showLostConfirm, setShowLostConfirm] = useState(false);
  const [lostReason, setLostReason] = useState('');
  const [editForm, setEditForm] = useState({
    name: '', amount: '', closeDate: '', priority: 'medium',
    customerRequirement: '', qualificationBasis: '', documents: '',
    proposalSummary: '', discussionNotes: '', notes: '',
  });

  const { data: pipelines } = useQuery({
    queryKey: ['pipelines'],
    queryFn: () => api.get('/api/v1/deals/pipelines').then((r) => r.data.data ?? []),
  });

  useEffect(() => {
    if (!selectedPipeline && pipelines?.[0]) setSelectedPipeline(pipelines[0].id);
  }, [pipelines, selectedPipeline]);

  // Auto-open from ?open=<deal-id>. Fetch the deal once, switch to its pipeline
  // (so the kanban shows the right board), then pop the drawer open. We swallow
  // 404s silently — the URL may point at a deleted or cross-tenant deal.
  useEffect(() => {
    if (!pendingOpenId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get(`/api/v1/deals/${pendingOpenId}`);
        const deal = res.data.data;
        if (cancelled || !deal) return;
        if (deal.pipeline_id) setSelectedPipeline(deal.pipeline_id);
        setSelected(deal);
        // Strip ?open= so refresh/back doesn't keep re-opening.
        const next = new URLSearchParams(searchParams);
        next.delete('open');
        setSearchParams(next, { replace: true });
      } catch {
        // ignore
      } finally {
        if (!cancelled) setPendingOpenId(null);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpenId]);

  const { data: board, isLoading } = useQuery({
    queryKey: ['board', selectedPipeline],
    queryFn: () => api.get(`/api/v1/deals/board/${selectedPipeline}`).then((r) => r.data.data),
    enabled: !!selectedPipeline,
  });

  // Once the board for the auto-opened deal loads, try to pin selectedStage so
  // the stage badge in the drawer shows the right column.
  useEffect(() => {
    if (!selected || selectedStage) return;
    const stages = board?.board ?? [];
    for (const s of stages) {
      if ((s.deals ?? []).some((d: any) => d.id === selected.id)) {
        setSelectedStage(s);
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, selected]);

  const { data: dealActivities } = useQuery({
    queryKey: ['deal-activities', selected?.id],
    queryFn: () =>
      api.get('/api/v1/activities', { params: { dealId: selected.id, pageSize: 20 } })
        .then((r) => r.data.data),
    enabled: !!selected,
  });

  // Helper — apply a stage move to the cached board so the card snaps to the new
  // column the instant the user releases the mouse. Backend invalidation happens
  // afterwards in onSettled, but by then the cache already matches the server.
  const applyMoveToCache = (id: string, stageId: string) => {
    qc.setQueryData(['board', selectedPipeline], (old: any) => {
      if (!old?.board) return old;
      let moved: any = null;
      const board1 = old.board.map((s: any) => ({
        ...s,
        deals: (s.deals ?? []).filter((d: any) => {
          if (d.id === id) { moved = { ...d, stage_id: stageId }; return false; }
          return true;
        }),
      }));
      if (!moved) return old;
      const board2 = board1.map((s: any) =>
        s.id === stageId ? { ...s, deals: [moved, ...(s.deals ?? [])] } : s,
      );
      return { ...old, board: board2 };
    });
  };

  const moveMutation = useMutation({
    mutationFn: ({ id, stageId }: { id: string; stageId: string }) =>
      api.patch(`/api/v1/deals/${id}/stage`, { stageId }),
    onMutate: async ({ id, stageId }) => {
      await qc.cancelQueries({ queryKey: ['board', selectedPipeline] });
      const prev = qc.getQueryData(['board', selectedPipeline]);
      applyMoveToCache(id, stageId);
      return { prev };
    },
    onError: (_e, _v, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(['board', selectedPipeline], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['board', selectedPipeline] }),
  });

  const wonMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/deals/${id}/won`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['board', selectedPipeline] }); setSelected(null); },
  });

  const lostMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/api/v1/deals/${id}/lost`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['board', selectedPipeline] });
      setSelected(null);
      setShowLostConfirm(false);
    },
  });

  const createMutation = useMutation({
    mutationFn: (body: any) => api.post('/api/v1/deals', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['board', selectedPipeline] });
      setShowCreate(false);
      setForm({ name: '', amount: '', stageId: '' });
      createMutation.reset();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => api.patch(`/api/v1/deals/${id}`, body),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['board', selectedPipeline] });
      setSelected(res.data.data);
      setShowEdit(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/deals/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['board', selectedPipeline] });
      const prev = qc.getQueryData(['board', selectedPipeline]);
      qc.setQueryData(['board', selectedPipeline], (old: any) => {
        if (!old?.board) return old;
        return {
          ...old,
          board: old.board.map((s: any) => ({
            ...s,
            deals: (s.deals ?? []).filter((d: any) => d.id !== id),
          })),
        };
      });
      return { prev };
    },
    onError: (_e, _v, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(['board', selectedPipeline], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['board', selectedPipeline] }),
    onSuccess: () => {
      setSelected(null);
      setShowDeleteConfirm(false);
    },
  });

  // Dropping into a column does three things depending on the target stage type:
  //   • 'won'  → move + auto-mark won (so status flips, not just stage_id)
  //   • 'lost' → move + open the lost-reason dialog (status flips after user types reason)
  //   • else   → just move
  // Previously only the move fired — dragging to Won didn't actually win the deal.
  const handleDrop = (stageId: string) => {
    if (!dragging || dragging.stage_id === stageId) { setDragging(null); return; }
    const targetStage = stages.find((s: any) => s.id === stageId);
    const type = getStageType(targetStage?.name ?? '');
    const dealId = dragging.id;
    moveMutation.mutate({ id: dealId, stageId });
    if (type === 'won') {
      wonMutation.mutate(dealId);
    } else if (targetStage?.name?.toLowerCase().includes('lost')) {
      // Open the lost-reason modal pre-targeted at the dropped deal.
      setSelected(dragging);
      setSelectedStage(targetStage);
      setShowLostConfirm(true);
    }
    setDragging(null);
  };

  const openDeal = (deal: any, stage: any) => {
    setSelected(deal);
    setSelectedStage(stage);
  };

  const openEdit = () => {
    if (!selected) return;
    const cf = selected.custom_fields ?? {};
    setEditForm({
      name: selected.name ?? '',
      amount: selected.amount ? String(selected.amount) : '',
      closeDate: selected.close_date ? selected.close_date.split('T')[0] : '',
      priority: selected.priority ?? 'medium',
      customerRequirement: cf.customer_requirement ?? '',
      qualificationBasis: cf.qualification_basis ?? '',
      documents: Array.isArray(cf.documents) ? cf.documents.join(', ') : (cf.documents ?? ''),
      proposalSummary: cf.proposal_summary ?? '',
      discussionNotes: cf.discussion_notes ?? '',
      notes: cf.notes ?? '',
    });
    updateMutation.reset();
    setShowEdit(true);
  };

  const handleUpdate = () => {
    if (!selected) return;
    const cf: Record<string, any> = {};
    if (editForm.customerRequirement) cf.customer_requirement = editForm.customerRequirement;
    if (editForm.qualificationBasis) cf.qualification_basis = editForm.qualificationBasis;
    if (editForm.documents) cf.documents = editForm.documents.split(',').map((s: string) => s.trim()).filter(Boolean);
    if (editForm.proposalSummary) cf.proposal_summary = editForm.proposalSummary;
    if (editForm.discussionNotes) cf.discussion_notes = editForm.discussionNotes;
    if (editForm.notes) cf.notes = editForm.notes;

    updateMutation.mutate({
      id: selected.id,
      body: {
        name: editForm.name,
        ...(editForm.amount ? { amount: Number(editForm.amount) } : {}),
        ...(editForm.closeDate ? { closeDate: editForm.closeDate } : {}),
        priority: editForm.priority,
        customFields: cf,
      },
    });
  };

  const stages = board?.board ?? [];
  const pipeline = board?.pipeline;
  const totalValue = stages.reduce((s: number, st: any) => s + (parseFloat(st.totalValue) || 0), 0);
  const totalDeals = stages.reduce((s: number, st: any) => s + (st.deals?.length ?? 0), 0);
  const stageType = getStageType(selectedStage?.name ?? '');

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-4 shrink-0">
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-gray-900">Deals</h1>
          <p className="text-xs text-gray-400">{totalDeals} open · {formatCurrency(totalValue)} pipeline</p>
        </div>
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
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700">
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
                <div className={`p-3 border-t-2 ${STAGE_COLORS[idx % STAGE_COLORS.length]} rounded-t-xl`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{stage.name}</p>
                      <p className="text-xs text-gray-400">{stage.probability}% · {stage.deals?.length ?? 0} deals</p>
                    </div>
                    <p className="text-xs font-medium text-gray-600">{formatCurrency(parseFloat(stage.totalValue) || 0)}</p>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {(stage.deals ?? []).map((deal: any) => {
                    const cf = deal.custom_fields ?? {};
                    const preview = cf.customer_requirement || cf.proposal_summary || cf.discussion_notes || cf.notes;
                    return (
                      <div
                        key={deal.id}
                        draggable
                        onDragStart={() => setDragging(deal)}
                        onDragEnd={() => setDragging(null)}
                        onClick={() => openDeal(deal, stage)}
                        className={`bg-white rounded-lg p-3 shadow-sm border cursor-pointer hover:shadow-md transition-shadow ${
                          dragging?.id === deal.id ? 'opacity-50' : ''
                        } ${selected?.id === deal.id ? 'border-brand-400 ring-1 ring-brand-400' : 'border-gray-100'}`}
                      >
                        <p className="text-sm font-medium text-gray-900 mb-1 leading-tight">{deal.name}</p>
                        {deal.contact_name && (
                          <p className="text-xs text-gray-500 mb-2">{deal.contact_name}</p>
                        )}
                        {preview && (
                          <p className="text-xs text-gray-400 mb-2 line-clamp-2">{preview}</p>
                        )}
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-brand-600">
                            {deal.amount ? formatCurrency(parseFloat(deal.amount), deal.currency) : '—'}
                          </span>
                          <button
                            onClick={(e) => { e.stopPropagation(); wonMutation.mutate(deal.id); }}
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
                    );
                  })}
                  {stage.deals?.length === 0 && (
                    <div className="text-center py-6 text-gray-300 text-xs">Drop deals here</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Deal detail drawer */}
      {selected && (
        <div className="fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-black/20" onClick={() => setSelected(null)} />
          <div className="absolute right-0 top-0 h-full w-[min(520px,100vw)] bg-white shadow-2xl overflow-y-auto">
            <div className="p-5 space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-semibold text-gray-900 leading-tight">{selected.name}</h2>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {selected.amount && (
                      <span className="text-lg font-bold text-brand-600">{formatCurrency(parseFloat(selected.amount), selected.currency)}</span>
                    )}
                    {selectedStage && (
                      <span className="text-xs px-2 py-0.5 bg-brand-50 text-brand-700 rounded-full font-medium">{selectedStage.name}</span>
                    )}
                    {selected.priority && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${PRIORITY_COLORS[selected.priority] ?? 'bg-gray-100 text-gray-500'}`}>
                        {selected.priority}
                      </span>
                    )}
                  </div>
                </div>
                <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 shrink-0 mt-1">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Actions */}
              {can.writeRecords && (
                <div className="flex gap-2 flex-wrap">
                  <button onClick={openEdit}
                    className="flex items-center gap-1.5 px-3 py-2 border border-blue-200 text-blue-600 text-sm rounded-lg hover:bg-blue-50">
                    ✏️ Edit
                  </button>
                  <button onClick={() => wonMutation.mutate(selected.id)} disabled={wonMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-2 border border-amber-200 text-amber-600 text-sm rounded-lg hover:bg-amber-50 disabled:opacity-50">
                    🏆 Won
                  </button>
                  <button onClick={() => setShowLostConfirm(true)}
                    className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50">
                    ✖ Lost
                  </button>
                  <button onClick={() => setShowDeleteConfirm(true)}
                    className="flex items-center gap-1.5 px-3 py-2 border border-red-200 text-red-600 text-sm rounded-lg hover:bg-red-50">
                    🗑️ Delete
                  </button>
                </div>
              )}

              {/* Deal details */}
              <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                {[
                  { label: 'Company',    value: selected.company_name,                                  Icon: Building2 },
                  { label: 'Contact',    value: selected.contact_name?.trim() || null,                  Icon: User },
                  { label: 'Close Date', value: selected.close_date ? new Date(selected.close_date).toLocaleDateString() : null, Icon: Calendar },
                ].filter((r) => r.value).map((row) => (
                  <div key={row.label} className="flex items-center gap-2 text-sm">
                    <row.Icon className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    <span className="text-gray-500">{row.label}</span>
                    <span className="ml-auto text-gray-900 font-medium">{row.value}</span>
                  </div>
                ))}
              </div>

              {/* Stage-specific content */}
              {(() => {
                const cf = selected.custom_fields ?? {};
                const entries: { label: string; value: string }[] = [];
                if (stageType === 'new' || stageType === 'other' || cf.customer_requirement)
                  entries.push({ label: 'Customer Requirement', value: cf.customer_requirement ?? '' });
                if (stageType === 'qualified' || cf.qualification_basis)
                  entries.push({ label: 'Qualification Basis', value: cf.qualification_basis ?? '' });
                if ((stageType === 'qualified' || cf.documents) && cf.documents)
                  entries.push({ label: 'Documents', value: Array.isArray(cf.documents) ? cf.documents.join(', ') : cf.documents });
                if (stageType === 'proposal' || cf.proposal_summary)
                  entries.push({ label: 'Proposal Summary', value: cf.proposal_summary ?? '' });
                if (stageType === 'negotiation' || cf.discussion_notes)
                  entries.push({ label: 'Discussion Notes', value: cf.discussion_notes ?? '' });
                if (cf.notes)
                  entries.push({ label: 'Notes', value: cf.notes });

                if (!entries.length) return null;
                return (
                  <div className="space-y-3">
                    {entries.map((e) => (
                      <div key={e.label} className="bg-blue-50/60 rounded-xl p-4">
                        <p className="text-xs font-semibold text-blue-700 mb-1">{e.label}</p>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">
                          {e.value || <span className="text-gray-400 italic">Not yet recorded — click Edit to add.</span>}
                        </p>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Correspondence */}
              {dealActivities && dealActivities.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">
                    Correspondence <span className="text-gray-400 font-normal">({dealActivities.length})</span>
                  </h3>
                  <div className="space-y-2">
                    {dealActivities.map((act: any) => (
                      <div key={act.id} className="flex items-start gap-2 p-3 bg-gray-50 rounded-lg">
                        <span className="text-base shrink-0">{TYPE_ICONS[act.type] ?? '📌'}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">{act.subject}</p>
                          {act.body && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{act.body}</p>}
                          {act.outcome && <p className="text-xs text-green-600 mt-0.5">Outcome: {act.outcome}</p>}
                          <p className="text-xs text-gray-400 mt-1">
                            {act.due_at
                              ? new Date(act.due_at).toLocaleDateString()
                              : new Date(act.created_at).toLocaleDateString()}
                            {act.owner_name ? ` · ${act.owner_name}` : ''}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {showEdit && selected && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
              <h2 className="font-semibold text-gray-900">Edit Deal</h2>
              <div className="flex items-center gap-2">
                <button onClick={handleUpdate} disabled={!editForm.name || updateMutation.isPending}
                  className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg disabled:opacity-50 hover:bg-blue-700 font-medium flex items-center gap-1.5">
                  {updateMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Save
                </button>
                <button onClick={() => setShowEdit(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Deal Name *</label>
                <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Amount</label>
                  <input type="number" value={editForm.amount} onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Priority</label>
                  <select value={editForm.priority} onChange={(e) => setEditForm({ ...editForm, priority: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400">
                    {['low', 'medium', 'high'].map((p) => <option key={p} value={p} className="capitalize">{p}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Close Date</label>
                <input type="date" value={editForm.closeDate} onChange={(e) => setEditForm({ ...editForm, closeDate: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400" />
              </div>

              <div className="border-t border-gray-100 pt-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Stage Details</p>

                {(stageType === 'new' || stageType === 'other') && (
                  <div className="mb-3">
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Customer Requirement</label>
                    <textarea value={editForm.customerRequirement}
                      onChange={(e) => setEditForm({ ...editForm, customerRequirement: e.target.value })}
                      placeholder="What does the customer need?"
                      rows={3} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400 resize-none" />
                  </div>
                )}
                {stageType === 'qualified' && (
                  <>
                    <div className="mb-3">
                      <label className="text-xs font-medium text-gray-600 mb-1 block">Qualification Basis</label>
                      <textarea value={editForm.qualificationBasis}
                        onChange={(e) => setEditForm({ ...editForm, qualificationBasis: e.target.value })}
                        placeholder="Why was this deal qualified?"
                        rows={3} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400 resize-none" />
                    </div>
                    <div className="mb-3">
                      <label className="text-xs font-medium text-gray-600 mb-1 block">Documents (comma separated)</label>
                      <input value={editForm.documents}
                        onChange={(e) => setEditForm({ ...editForm, documents: e.target.value })}
                        placeholder="RFP, NDA, Financial Statement"
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400" />
                    </div>
                  </>
                )}
                {stageType === 'proposal' && (
                  <div className="mb-3">
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Proposal Summary</label>
                    <textarea value={editForm.proposalSummary}
                      onChange={(e) => setEditForm({ ...editForm, proposalSummary: e.target.value })}
                      placeholder="Key points of the proposal sent..."
                      rows={4} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400 resize-none" />
                  </div>
                )}
                {stageType === 'negotiation' && (
                  <div className="mb-3">
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Discussion Notes</label>
                    <textarea value={editForm.discussionNotes}
                      onChange={(e) => setEditForm({ ...editForm, discussionNotes: e.target.value })}
                      placeholder="What's being discussed?"
                      rows={4} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400 resize-none" />
                  </div>
                )}
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Notes</label>
                  <textarea value={editForm.notes}
                    onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                    placeholder="General notes"
                    rows={3} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400 resize-none" />
                </div>
              </div>

              {updateMutation.isError && (
                <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
                  {(updateMutation.error as any)?.response?.data?.error?.message ?? 'Failed to update deal'}
                </p>
              )}
            </div>
            <div className="flex gap-2 px-6 py-4 border-t border-gray-100 shrink-0">
              <button onClick={() => setShowEdit(false)}
                className="flex-1 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={handleUpdate} disabled={!editForm.name || updateMutation.isPending}
                className="flex-1 py-2 bg-blue-600 text-white rounded-xl text-sm disabled:opacity-50 flex items-center justify-center gap-2 font-medium hover:bg-blue-700">
                {updateMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && selected && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-2">Delete Deal</h2>
            <p className="text-sm text-gray-500 mb-6">
              Delete <strong>{selected.name}</strong>? This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={() => deleteMutation.mutate(selected.id)} disabled={deleteMutation.isPending}
                className="flex-1 py-2 bg-red-600 text-white rounded-xl text-sm disabled:opacity-50 flex items-center justify-center gap-2 font-medium hover:bg-red-700">
                {deleteMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lost confirmation */}
      {showLostConfirm && selected && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-2">Mark as Lost</h2>
            <p className="text-sm text-gray-500 mb-3">Reason for losing (optional)</p>
            <textarea value={lostReason} onChange={(e) => setLostReason(e.target.value)}
              rows={3} placeholder="e.g. Budget cut, went with competitor..."
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400 resize-none mb-4" />
            <div className="flex gap-3">
              <button onClick={() => setShowLostConfirm(false)}
                className="flex-1 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={() => lostMutation.mutate({ id: selected.id, reason: lostReason })} disabled={lostMutation.isPending}
                className="flex-1 py-2 bg-gray-700 text-white rounded-xl text-sm disabled:opacity-50 flex items-center justify-center gap-2 font-medium hover:bg-gray-800">
                {lostMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Mark Lost
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-gray-900">New Deal</h2>
              <button onClick={() => { setShowCreate(false); createMutation.reset(); }}
                className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>

            {!pipeline ? (
              <div className="text-center py-8"><Loader2 className="w-5 h-5 text-brand-400 animate-spin mx-auto" /></div>
            ) : (
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
            )}

            {createMutation.isError && (
              <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mt-3">
                {(createMutation.error as any)?.response?.data?.error?.message ?? 'Failed to create deal'}
              </p>
            )}
            <div className="flex gap-2 mt-6">
              <button onClick={() => { setShowCreate(false); createMutation.reset(); }}
                className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button
                onClick={() => createMutation.mutate({
                  name: form.name,
                  stageId: form.stageId,
                  pipelineId: selectedPipeline,
                  ...(form.amount ? { amount: Number(form.amount) } : {}),
                })}
                disabled={!form.name || !form.stageId || createMutation.isPending || !pipeline}
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
