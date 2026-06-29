import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Building2, Globe, Phone, Users, Plus, Search, X, Loader2, Upload,
  ChevronRight, TrendingUp, MapPin, Mail,
} from 'lucide-react';
import { api } from '../services/api';
import { formatCurrency, formatNumber } from '../utils/format';
import { useIsSuperAdmin } from '../hooks/useRole';
import { BulkUploadModal } from '../components/BulkUploadModal';

const TYPE_ICONS: Record<string, string> = {
  call: '📞', email: '📧', meeting: '🤝', task: '✅',
  note: '📝', whatsapp: '💬', sms: '📱', demo: '🖥️',
  voice_bot_call: '🤖', proposal: '📄',
};

const STAGE_SECTION_LABELS: Record<string, { label: string; key: string }[]> = {
  new:         [{ label: 'Customer Requirement', key: 'customer_requirement' }],
  qualified:   [{ label: 'Qualification Basis', key: 'qualification_basis' }, { label: 'Documents', key: 'documents' }],
  proposal:    [{ label: 'Proposal Summary', key: 'proposal_summary' }],
  negotiation: [{ label: 'Discussion Notes', key: 'discussion_notes' }],
};

function stageTypeFromName(name: string) {
  const n = (name ?? '').toLowerCase();
  if (n.includes('new') || n.includes('lead')) return 'new';
  if (n.includes('qualif')) return 'qualified';
  if (n.includes('proposal') || n.includes('sent')) return 'proposal';
  if (n.includes('negot')) return 'negotiation';
  return 'other';
}

function DealActivities({ dealId }: { dealId: string }) {
  const { data } = useQuery({
    queryKey: ['deal-activities', dealId],
    queryFn: () => api.get('/api/v1/activities', { params: { dealId, pageSize: 10 } }).then((r) => r.data.data),
  });
  if (!data?.length) return <p className="text-xs text-gray-400 italic">No correspondence recorded.</p>;
  return (
    <div className="space-y-1.5">
      {data.map((act: any) => (
        <div key={act.id} className="flex items-start gap-2 text-xs">
          <span className="shrink-0">{TYPE_ICONS[act.type] ?? '📌'}</span>
          <div className="min-w-0">
            <p className="text-gray-700 font-medium leading-tight truncate">{act.subject}</p>
            {act.body && <p className="text-gray-400 truncate">{act.body}</p>}
            {act.due_at && <p className="text-gray-400">{new Date(act.due_at).toLocaleDateString()}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

const SIZE_LABELS: Record<string, string> = {
  '1-10': '1–10 employees',
  '11-50': '11–50 employees',
  '51-200': '51–200 employees',
  '201-500': '201–500 employees',
  '501-1000': '501–1,000 employees',
  '1000+': '1,000+ employees',
};

export function Companies() {
  const qc = useQueryClient();
  const isSuperAdmin = useIsSuperAdmin();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<any | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [form, setForm] = useState({
    name: '', domain: '', industry: '', size: '', country: '', city: '', website: '', phone: '',
  });

  // Operational list (agents/managers/tenant_admin) — banks' B2B records.
  const { data: opsData, isLoading: opsLoading } = useQuery({
    queryKey: ['companies', search, page],
    queryFn: () =>
      api.get('/api/v1/companies', { params: { search: search || undefined, page, pageSize: 25 } })
        .then((r) => r.data),
    enabled: !isSuperAdmin,
  });
  // Super-admin's "Companies" is OUR clients — one row per workspace. Mapped into
  // the operational shape so the existing card layout renders unchanged.
  const { data: saData, isLoading: saLoading } = useQuery({
    queryKey: ['sa-customer-companies', search],
    queryFn: () =>
      api.get('/super-admin/customer-companies', { params: { search: search || undefined } })
         .then((r) => {
           const rows = (r.data.data ?? []).map((t: any) => ({
             id:        t.id,
             name:      t.name,
             domain:    t.slug ? `${t.slug}.amanahcx.com` : null,
             industry:  t.sector,
             size:      null,
             country:   null,
             city:      null,
             website:   t.website,
             phone:     null,
             created_at: t.created_at,
             _sa_tenant_admin_name:  t.tenant_admin_name,
             _sa_tenant_admin_email: t.tenant_admin_email,
             _sa_plan:   t.plan,
             _sa_status: t.status,
           }));
           return { data: rows, meta: { total: rows.length, page: 1, pageSize: rows.length, totalPages: 1 } };
         }),
    enabled: isSuperAdmin,
  });
  const data = isSuperAdmin ? saData : opsData;
  const isLoading = isSuperAdmin ? saLoading : opsLoading;

  // "People to contact" on the card.
  //   • Operational: existing /api/v1/contacts filtered by companyId.
  //   • Super-admin: tenant_admin + POC ("owner") of the selected workspace only.
  const { data: contacts } = useQuery({
    queryKey: ['company-contacts', selected?.id],
    queryFn: () =>
      api.get('/api/v1/contacts', { params: { companyId: selected.id, pageSize: 10 } })
        .then((r) => r.data.data),
    enabled: !!selected && !isSuperAdmin,
  });
  const { data: saPeople } = useQuery({
    queryKey: ['sa-company-people', selected?.id],
    queryFn: () =>
      api.get(`/super-admin/customer-companies/${selected.id}/people`).then((r) => r.data.data),
    enabled: !!selected && isSuperAdmin,
  });

  const { data: deals } = useQuery({
    queryKey: ['company-deals', selected?.id],
    queryFn: () =>
      api.get('/api/v1/deals', { params: { companyId: selected.id, pageSize: 10 } })
        .then((r) => r.data.data),
    enabled: !!selected && !isSuperAdmin,
  });

  const createMutation = useMutation({
    mutationFn: (body: any) => api.post('/api/v1/companies', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['companies'] });
      closeCreate();
    },
  });

  const closeCreate = () => {
    setShowCreate(false);
    setForm({ name: '', domain: '', industry: '', size: '', country: '', city: '', website: '', phone: '' });
    createMutation.reset();
  };

  const [showEdit, setShowEdit] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', domain: '', industry: '', size: '', country: '', city: '', website: '', phone: '' });
  const [expandedDealId, setExpandedDealId] = useState<string | null>(null);

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => api.patch(`/api/v1/companies/${id}`, body),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['companies'] });
      setSelected(res.data.data);
      setShowEdit(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/companies/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['companies'] });
      setSelected(null);
      setShowDeleteConfirm(false);
    },
  });

  const openEdit = () => {
    if (!selected) return;
    setEditForm({
      name:     selected.name ?? '',
      domain:   selected.domain ?? '',
      industry: selected.industry ?? '',
      size:     Object.keys(SIZE_LABELS).includes(selected.size ?? '') ? (selected.size ?? '') : '',
      country:  selected.country ?? '',
      city:     selected.city ?? '',
      website:  selected.website ?? '',
      phone:    selected.phone ?? '',
    });
    updateMutation.reset();
    setShowEdit(true);
  };

  const handleUpdate = () => {
    if (!selected) return;
    const body = Object.fromEntries(Object.entries(editForm).filter(([, v]) => v !== ''));
    if (body.website && !/^https?:\/\//i.test(body.website as string)) {
      body.website = `https://${body.website}`;
    }
    updateMutation.mutate({ id: selected.id, body });
  };

  const companies = data?.data ?? [];
  const meta = data?.meta ?? {};

  const pipelineValue = deals?.reduce((s: number, d: any) => s + (d.amount ?? 0), 0) ?? 0;

  return (
    <div className="flex h-full">
      {/* List panel */}
      <div className="flex flex-col w-full max-w-2xl border-r border-gray-100">
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Companies</h1>
              <p className="text-xs text-gray-400">{meta.total ?? 0} total</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowBulkUpload(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50"
              >
                <Upload className="w-3.5 h-3.5" /> Bulk Upload
              </button>
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white text-xs rounded-lg hover:bg-brand-700"
              >
                <Plus className="w-3.5 h-3.5" /> Add Company
              </button>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search company name or domain…"
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
            </div>
          ) : companies.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Building2 className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No companies yet</p>
              <button onClick={() => setShowCreate(true)} className="mt-2 text-xs text-brand-500 hover:underline">
                Add your first company
              </button>
            </div>
          ) : (
            companies.map((co: any) => (
              <div
                key={co.id}
                onClick={() => setSelected(co)}
                className={`flex items-center gap-3 px-5 py-3.5 cursor-pointer hover:bg-gray-50 transition-colors ${
                  selected?.id === co.id ? 'bg-brand-50 border-l-2 border-l-brand-500' : ''
                }`}
              >
                {/* Logo placeholder */}
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center shrink-0">
                  {co.domain ? (
                    <img
                      src={`https://www.google.com/s2/favicons?domain=${co.domain}&sz=32`}
                      alt={co.name}
                      className="w-5 h-5 rounded"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : (
                    <Building2 className="w-4 h-4 text-slate-500" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{co.name}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    {co.industry && <span className="text-xs text-gray-400">{co.industry}</span>}
                    {co.city && (
                      <span className="text-xs text-gray-400 flex items-center gap-0.5">
                        <MapPin className="w-3 h-3" />{co.city}
                      </span>
                    )}
                  </div>
                </div>

                <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
              </div>
            ))
          )}
        </div>

        {meta.totalPages > 1 && (
          <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
            <span>Page {meta.page} of {meta.totalPages}</span>
            <div className="flex gap-2">
              <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-gray-50">← Prev</button>
              <button disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-gray-50">Next →</button>
            </div>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {selected && (
        <div className="fixed inset-0 z-40 lg:static lg:inset-auto lg:z-auto flex lg:flex-1">
          <div className="absolute inset-0 bg-black/30 lg:hidden" onClick={() => setSelected(null)} />
          <div className="absolute right-0 top-0 h-full w-[min(480px,100vw)] bg-white shadow-2xl overflow-y-auto lg:static lg:shadow-none lg:flex-1 lg:w-auto">
            <div className="p-6 space-y-6">
              <button onClick={() => setSelected(null)} className="lg:hidden absolute top-4 right-4 text-gray-400 hover:text-gray-600 z-10">
                <X className="w-5 h-5" />
              </button>

              {/* Header */}
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center shrink-0">
                  {selected.domain ? (
                    <img src={`https://www.google.com/s2/favicons?domain=${selected.domain}&sz=64`}
                      alt={selected.name} className="w-8 h-8 rounded"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  ) : (
                    <Building2 className="w-7 h-7 text-slate-500" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-semibold text-gray-900">{selected.name}</h2>
                  {selected.industry && <p className="text-sm text-gray-500">{selected.industry}</p>}
                  {selected.website && (
                    <a href={selected.website} target="_blank" rel="noreferrer"
                      className="text-xs text-brand-600 hover:underline flex items-center gap-1 mt-1">
                      <Globe className="w-3 h-3" />{selected.website}
                    </a>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 flex-wrap">
                <button onClick={openEdit}
                  className="flex items-center gap-1.5 px-3 py-2 border border-blue-200 text-blue-600 text-sm rounded-lg hover:bg-blue-50">
                  ✏️ Edit
                </button>
                <button onClick={() => setShowDeleteConfirm(true)}
                  className="flex items-center gap-1.5 px-3 py-2 border border-red-200 text-red-600 text-sm rounded-lg hover:bg-red-50">
                  🗑️ Delete
                </button>
              </div>

              {/* Stats — operational only. Super-admin's row is one workspace = one
                  client; deals/pipeline are workspace-internal metrics, not relevant. */}
              {!isSuperAdmin && (
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Contacts', value: contacts?.length ?? 0 },
                    { label: 'Open Deals', value: deals?.filter((d: any) => d.status === 'open').length ?? 0 },
                    { label: 'Pipeline', value: formatCurrency(pipelineValue), isStr: true },
                  ].map((stat) => (
                    <div key={stat.label} className="bg-gray-50 rounded-xl p-3 text-center">
                      <p className="text-lg font-bold text-gray-900">{stat.isStr ? stat.value : formatNumber(Number(stat.value))}</p>
                      <p className="text-xs text-gray-500">{stat.label}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Details */}
              <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                {(isSuperAdmin ? [
                  { label: 'Plan',     value: selected._sa_plan ? String(selected._sa_plan).toUpperCase() : null },
                  { label: 'Status',   value: selected._sa_status ? String(selected._sa_status).toUpperCase() : null },
                  { label: 'Sector',   value: selected.industry },
                  { label: 'Domain',   value: selected.domain },
                  { label: 'Created',  value: selected.created_at ? new Date(selected.created_at).toLocaleDateString() : null },
                ] : [
                  { label: 'Phone',    value: selected.phone },
                  { label: 'Size',     value: SIZE_LABELS[selected.size] ?? selected.size },
                  { label: 'Country',  value: selected.country },
                  { label: 'City',     value: selected.city },
                  { label: 'Revenue',  value: selected.annual_revenue ? formatCurrency(selected.annual_revenue) : null },
                  { label: 'Owner',    value: selected.owner_name },
                ]).filter((r) => r.value).map((row) => (
                  <div key={row.label} className="flex justify-between text-sm">
                    <span className="text-gray-500">{row.label}</span>
                    <span className="text-gray-900 font-medium">{row.value}</span>
                  </div>
                ))}
              </div>

              {/* People to contact */}
              {isSuperAdmin ? (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">
                    People to contact <span className="text-gray-400 font-normal">({saPeople?.length ?? 0})</span>
                  </h3>
                  {(!saPeople || saPeople.length === 0) ? (
                    <p className="text-xs text-gray-400 italic">No tenant admin or recorded point of contact for this workspace yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {saPeople.map((p: any) => (
                        <div key={`${p.kind}:${p.id}`} className="flex items-start gap-2 p-2.5 bg-gray-50 rounded-lg">
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${
                            p.kind === 'tenant_admin' ? 'bg-gradient-to-br from-brand-400 to-purple-500' : 'bg-gradient-to-br from-amber-400 to-orange-500'
                          }`}>
                            {(p.name ?? '?')[0]}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium text-gray-900 truncate">{p.name || '(no name)'}</p>
                              <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full font-semibold ${
                                p.kind === 'tenant_admin' ? 'bg-brand-50 text-brand-700' : 'bg-amber-50 text-amber-700'
                              }`}>
                                {p.kind === 'tenant_admin' ? 'Tenant Admin' : 'Owner / POC'}
                              </span>
                            </div>
                            {p.title && p.kind !== 'tenant_admin' && <p className="text-xs text-gray-400">{p.title}</p>}
                            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                              {p.email && <span className="text-xs text-gray-500 flex items-center gap-1"><Mail className="w-3 h-3" />{p.email}</span>}
                              {p.phone && <span className="text-xs text-gray-500 flex items-center gap-1"><Phone className="w-3 h-3" />{p.phone}</span>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (contacts && contacts.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">
                    Contacts <span className="text-gray-400 font-normal">({contacts.length})</span>
                  </h3>
                  <div className="space-y-2">
                    {contacts.map((c: any) => (
                      <div key={c.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-400 to-purple-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                          {c.first_name[0]}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{c.first_name} {c.last_name}</p>
                          {c.job_title && <p className="text-xs text-gray-400">{c.job_title}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Open deals — expandable */}
              {deals && deals.filter((d: any) => d.status === 'open').length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">
                    Open Deals <span className="text-gray-400 font-normal">({deals.filter((d: any) => d.status === 'open').length})</span>
                  </h3>
                  <div className="space-y-2">
                    {deals.filter((d: any) => d.status === 'open').map((deal: any) => {
                      const isExpanded = expandedDealId === deal.id;
                      const cf = deal.custom_fields ?? {};
                      const stype = stageTypeFromName(deal.stage_name ?? '');
                      const stageSections = STAGE_SECTION_LABELS[stype] ?? [];
                      return (
                        <div key={deal.id} className="rounded-xl border border-gray-100 overflow-hidden">
                          <button
                            onClick={() => setExpandedDealId(isExpanded ? null : deal.id)}
                            className="w-full flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{deal.name}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                {deal.stage_name && (
                                  <span className="text-xs px-1.5 py-0.5 bg-brand-50 text-brand-600 rounded font-medium">{deal.stage_name}</span>
                                )}
                                {deal.close_date && (
                                  <span className="text-xs text-gray-400">Close: {new Date(deal.close_date).toLocaleDateString()}</span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 ml-2">
                              {deal.amount && <span className="text-sm font-semibold text-brand-600">{formatCurrency(deal.amount)}</span>}
                              <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                            </div>
                          </button>

                          {isExpanded && (
                            <div className="p-3 bg-white border-t border-gray-100 space-y-3">
                              {/* Stage-specific fields */}
                              {stageSections.map(({ label, key }) => {
                                const val = Array.isArray(cf[key]) ? cf[key].join(', ') : cf[key];
                                return (
                                  <div key={key}>
                                    <p className="text-xs font-semibold text-gray-500 mb-0.5">{label}</p>
                                    <p className="text-sm text-gray-700 whitespace-pre-wrap">
                                      {val || <span className="text-gray-400 italic">Not recorded</span>}
                                    </p>
                                  </div>
                                );
                              })}
                              {cf.notes && (
                                <div>
                                  <p className="text-xs font-semibold text-gray-500 mb-0.5">Notes</p>
                                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{cf.notes}</p>
                                </div>
                              )}
                              {/* Correspondence */}
                              <div>
                                <p className="text-xs font-semibold text-gray-500 mb-1.5">Correspondence</p>
                                <DealActivities dealId={deal.id} />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {showEdit && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg my-4 flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
              <h2 className="font-semibold text-gray-900">Edit Company</h2>
              <div className="flex items-center gap-2">
                <button onClick={handleUpdate} disabled={!editForm.name || updateMutation.isPending}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg disabled:opacity-50 hover:bg-blue-700 font-medium">
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
                <label className="text-xs font-medium text-gray-600 mb-1 block">Company Name *</label>
                <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Domain',   key: 'domain',   placeholder: 'acme.com' },
                  { label: 'Industry', key: 'industry', placeholder: 'Technology' },
                  { label: 'Phone',    key: 'phone',    placeholder: '+1 555 0100' },
                  { label: 'Website',  key: 'website',  placeholder: 'https://acme.com' },
                  { label: 'City',     key: 'city',     placeholder: 'Karachi' },
                  { label: 'Country',  key: 'country',  placeholder: 'PK' },
                ].map((f) => (
                  <div key={f.key}>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">{f.label}</label>
                    <input value={(editForm as any)[f.key]} placeholder={f.placeholder}
                      onChange={(e) => setEditForm({ ...editForm, [f.key]: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400" />
                  </div>
                ))}
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Company Size</label>
                <select value={editForm.size} onChange={(e) => setEditForm({ ...editForm, size: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400">
                  <option value="">Select size</option>
                  {Object.entries(SIZE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              {updateMutation.isError && (
                <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
                  {(updateMutation.error as any)?.response?.data?.error?.message ?? 'Failed to update company'}
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
            <h2 className="font-semibold text-gray-900 mb-2">Delete Company</h2>
            <p className="text-sm text-gray-500 mb-6">
              Are you sure you want to delete <strong>{selected.name}</strong>? This cannot be undone.
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

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-gray-900">New Company</h2>
              <button onClick={closeCreate} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Company Name *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Acme Corporation"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Domain', key: 'domain', placeholder: 'acme.com' },
                  { label: 'Industry', key: 'industry', placeholder: 'Technology' },
                  { label: 'Phone', key: 'phone', placeholder: '+1 555 0100' },
                  { label: 'Website', key: 'website', placeholder: 'https://acme.com' },
                  { label: 'City', key: 'city', placeholder: 'Karachi' },
                  { label: 'Country', key: 'country', placeholder: 'PK' },
                ].map((f) => (
                  <div key={f.key}>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">{f.label}</label>
                    <input value={(form as any)[f.key]} placeholder={f.placeholder}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
                  </div>
                ))}
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Company Size</label>
                <select value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400">
                  <option value="">Select size</option>
                  {Object.entries(SIZE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
            </div>
            {createMutation.isError && (
              <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mt-2">
                <p className="font-medium">{(createMutation.error as any)?.response?.data?.error?.message ?? 'Failed to create company'}</p>
                {((createMutation.error as any)?.response?.data?.error?.details ?? []).map((d: any, i: number) => (
                  <p key={i} className="mt-0.5">• {d.field}: {d.message}</p>
                ))}
              </div>
            )}
            <div className="flex gap-2 mt-4">
              <button onClick={closeCreate}
                className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button
                onClick={() => {
                  const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== ''));
                  if (body.website && !/^https?:\/\//i.test(body.website as string)) {
                    body.website = `https://${body.website}`;
                  }
                  createMutation.mutate(body);
                }}
                disabled={!form.name || createMutation.isPending}
                className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {createMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Create Company
              </button>
            </div>
          </div>
        </div>
      )}

      {showBulkUpload && (
        <BulkUploadModal
          endpoint="/api/v1/companies/bulk"
          title="Bulk Upload Companies"
          columns={[
            { key: 'name',                  label: 'Company name', required: true },
            { key: 'industry',              label: 'Industry' },
            { key: 'website',               label: 'Website',  hint: 'must include http:// or https://' },
            { key: 'phone',                 label: 'Phone' },
            { key: 'email',                 label: 'Email',    hint: 'stored on custom_fields.email' },
            { key: 'billing_address_line1', label: 'Street address', hint: 'stored on custom_fields.address_line1' },
            { key: 'billing_address_city',  label: 'City' },
            { key: 'billing_country',       label: 'Country' },
          ]}
          sampleRows={[
            { name: 'Acme Corp', industry: 'Technology', website: 'https://acme.com', phone: '+12025550100', email: 'hello@acme.com', billing_address_line1: '500 Park Ave', billing_address_city: 'New York', billing_country: 'USA' },
            { name: 'Karachi Textiles', industry: 'Manufacturing', website: '', phone: '+922135678901', email: '', billing_address_line1: 'Plot 12, SITE Area', billing_address_city: 'Karachi', billing_country: 'Pakistan' },
          ]}
          invalidateKeys={[['companies']]}
          onClose={() => setShowBulkUpload(false)}
        />
      )}
    </div>
  );
}
