import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  Plus, Search, Filter, Phone, Mail, Building2,
  ChevronRight, Loader2, X, Upload, Tag,
} from 'lucide-react';
import { api } from '../services/api';
import { formatDate } from '../utils/format';
import { useCan, useIsSuperAdmin } from '../hooks/useRole';
import { ContactImportModal } from '../components/ContactImportModal';
import { useSectorFields } from '../hooks/useSectorFields';
import { SectorFieldsForm } from '../components/SectorFieldsForm';
import { SECTORS } from '@crm/shared';
import { ComposeModal } from './Emails';

const STATUS_COLORS: Record<string, string> = {
  lead:        'bg-yellow-50 text-yellow-700',
  prospect:    'bg-blue-50 text-blue-700',
  customer:    'bg-green-50 text-green-700',
  churned:     'bg-red-50 text-red-700',
  unqualified: 'bg-gray-50 text-gray-500',
};

const SOURCE_LABELS: Record<string, string> = {
  voice_bot:      '🤖 Voice Bot',
  inbound_call:   '📞 Inbound Call',
  outbound_call:  '📤 Outbound Call',
  email_campaign: '📧 Email',
  website:        '🌐 Website',
  referral:       '🤝 Referral',
  manual:         '✍️ Manual',
  api:            '⚙️ API',
};

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function Contacts() {
  const qc = useQueryClient();
  const can = useCan();
  const isSuperAdmin = useIsSuperAdmin();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<any | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', status: 'lead', source: 'manual' });
  const [sectorValues, setSectorValues] = useState<Record<string, any>>({});
  // Super admin form state
  const [saForm, setSaForm] = useState({ firstName: '', lastName: '', phone: '', email: '', companyName: '', workspace: '', sector: 'other', pocName: '', pocPhone: '', pocEmail: '', remarks: '' });
  const [saFiles, setSaFiles] = useState<File[]>([]);

  const { fields: sectorFields, config: sectorConfig } = useSectorFields();
  const setSectorField = (name: string, value: any) => setSectorValues(prev => ({ ...prev, [name]: value }));

  // Super admin's "Contacts" is the SaaS owner's contact book, NOT the operational
  // contacts each workspace has. Different endpoint, different shape (kind + tenant_name
  // instead of first/last_name + status). The operational page is hidden from them.
  const { data: opsData, isLoading: opsLoading } = useQuery({
    queryKey: ['contacts', search, statusFilter, page],
    queryFn: () =>
      api.get('/api/v1/contacts', { params: { search: search || undefined, status: statusFilter || undefined, page, pageSize: 25 } })
         .then((r) => r.data),
    placeholderData: keepPreviousData,
    enabled: !isSuperAdmin,
  });
  // Map the super-admin shape to the existing row shape so the operational UI just renders.
  //   { kind, name, email, phone, tenant_name, tenant_slug, sector } → { first_name, last_name, email, phone, company_name, status, source }
  const { data: saContactsData, isLoading: saContactsLoading } = useQuery({
    queryKey: ['sa-customer-contacts', search],
    queryFn: () =>
      api.get('/super-admin/customer-contacts', { params: { search: search || undefined } })
         .then((r) => {
           const rows = (r.data.data ?? []).map((x: any) => {
             const parts = (x.name ?? '').trim().split(/\s+/);
             return {
               id: `${x.kind}:${x.id}`,
               first_name: parts[0] ?? '',
               last_name:  parts.slice(1).join(' ') || '',
               email:      x.email ?? '',
               phone:      x.phone ?? '',
               company_name: x.tenant_name,
               status:     x.kind === 'tenant_admin' ? 'customer' : 'prospect',
               source:     'manual',
               custom_fields: { workspace: x.tenant_slug, sector: x.sector, remarks: x.remarks, role: x.kind, tenant_id: x.tenant_id },
               created_at: x.created_at,
               _sa_kind: x.kind,
               _sa_tenant_id: x.tenant_id,
             };
           });
           return { data: rows, meta: { total: rows.length, page: 1, pageSize: rows.length, totalPages: 1 } };
         }),
    enabled: isSuperAdmin,
  });
  const data = isSuperAdmin ? saContactsData : opsData;
  const isLoading = isSuperAdmin ? saContactsLoading : opsLoading;

  // Timeline only makes sense for real operational contacts. Super-admin's curated
  // rows are synthesised from users/contacts joins and have no own activity history.
  const { data: timeline } = useQuery({
    queryKey: ['contact-timeline', selected?.id],
    queryFn: () => api.get(`/api/v1/contacts/${selected.id}/timeline`).then((r) => r.data.data),
    enabled: !!selected && !isSuperAdmin,
  });

  const [showEdit, setShowEdit] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [showDialer, setShowDialer] = useState(false);
  const [editForm, setEditForm] = useState({ firstName: '', lastName: '', phone: '', email: '', companyName: '', workspace: '', sector: 'other', pocName: '', pocPhone: '', pocEmail: '', remarks: '' });

  const createMutation = useMutation({
    mutationFn: (body: any) => api.post('/api/v1/contacts', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      setShowCreate(false);
      setForm({ firstName: '', lastName: '', email: '', phone: '', status: 'lead', source: 'manual' });
      setSectorValues({});
      setSaForm({ firstName: '', lastName: '', phone: '', email: '', companyName: '', workspace: '', sector: 'other', pocName: '', pocPhone: '', pocEmail: '', remarks: '' });
      setSaFiles([]);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => api.patch(`/api/v1/contacts/${id}`, body),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      setSelected(res.data.data);
      setShowEdit(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/contacts/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      setSelected(null);
      setShowDeleteConfirm(false);
    },
  });

  const openEdit = () => {
    if (!selected) return;
    const cf = selected.custom_fields ?? {};
    setEditForm({
      firstName:   selected.first_name ?? '',
      lastName:    selected.last_name ?? '',
      phone:       selected.phone ?? '',
      email:       selected.email ?? '',
      companyName: selected.company_name ?? cf.company_name ?? '',
      workspace:   cf.workspace ?? '',
      sector:      cf.sector ?? 'other',
      pocName:     cf.poc_name ?? '',
      pocPhone:    cf.poc_phone ?? '',
      pocEmail:    cf.poc_email ?? '',
      remarks:     cf.remarks ?? '',
    });
    setShowEdit(true);
  };

  const handleSaUpdate = () => {
    if (!selected) return;
    updateMutation.mutate({
      id: selected.id,
      body: {
        firstName: editForm.firstName,
        lastName:  editForm.lastName,
        phone:     editForm.phone,
        email:     editForm.email,
        customFields: {
          ...(selected.custom_fields ?? {}),
          workspace: editForm.workspace,
          sector:    editForm.sector,
          poc_name:  editForm.pocName,
          poc_phone: editForm.pocPhone,
          poc_email: editForm.pocEmail,
          remarks:   editForm.remarks,
        },
      },
    });
  };

  const handleSaCreate = () => {
    // Encode attached files as base64 for storage in custom_fields
    const filePromises = saFiles.map(f => new Promise<{ name: string; type: string; size: number; data: string }>((res) => {
      const reader = new FileReader();
      reader.onload = () => res({ name: f.name, type: f.type, size: f.size, data: reader.result as string });
      reader.readAsDataURL(f);
    }));
    Promise.all(filePromises).then((attachments) => {
      createMutation.mutate({
        firstName:    saForm.firstName,
        lastName:     saForm.lastName,
        phone:        saForm.phone,
        email:        saForm.email,
        company_name: saForm.companyName,
        status:       'lead',
        source:       'manual',
        custom_fields: {
          workspace:  saForm.workspace,
          sector:     saForm.sector,
          poc_name:   saForm.pocName,
          poc_phone:  saForm.pocPhone,
          poc_email:  saForm.pocEmail,
          remarks:    saForm.remarks,
          attachments,
        },
      });
    });
  };

  const contacts = data?.data ?? [];
  const meta = data?.meta ?? {};

  return (
    <div className="flex h-full">
      {/* Left panel — list */}
      <div className="flex flex-col w-full max-w-2xl border-r border-gray-100">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold text-gray-900">{isSuperAdmin ? 'Contacts' : sectorConfig.contactLabelPlural}</h1>
                {!isSuperAdmin && sectorConfig.id !== 'other' && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{ background: `${sectorConfig.color}15`, color: sectorConfig.color }}>
                    {sectorConfig.label}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400">{meta.total ?? 0} total</p>
            </div>
            {can.writeRecords && (
              <div className="flex gap-2">
                <button onClick={() => setShowImport(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">
                  <Upload className="w-3.5 h-3.5" /> Import
                </button>
                <button
                  onClick={() => setShowCreate(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white text-xs rounded-lg hover:bg-brand-700"
                >
                  <Plus className="w-3.5 h-3.5" /> {isSuperAdmin ? 'Add Contact' : `Add ${sectorConfig.contactLabel}`}
                </button>
              </div>
            )}
          </div>

          {/* Search + filter */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search name, email, phone…"
                className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400 text-gray-600"
            >
              <option value="">All Status</option>
              {['lead','prospect','customer','churned','unqualified'].map((s) => (
                <option key={s} value={s} className="capitalize">{s}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Contact list */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
            </div>
          ) : contacts.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <p className="text-sm">No contacts found</p>
              <button onClick={() => setShowCreate(true)} className="mt-2 text-xs text-brand-500 hover:underline">
                Create your first contact
              </button>
            </div>
          ) : (
            contacts.map((c: any) => (
              <div
                key={c.id}
                onClick={() => setSelected(c)}
                className={`flex items-center gap-3 px-5 py-3.5 cursor-pointer hover:bg-gray-50 transition-colors ${selected?.id === c.id ? 'bg-brand-50 border-l-2 border-l-brand-500' : ''}`}
              >
                {/* Avatar */}
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-400 to-purple-500 flex items-center justify-center text-white text-sm font-semibold shrink-0">
                  {c.first_name[0]}{c.last_name?.[0] ?? ''}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {c.first_name} {c.last_name ?? ''}
                    </p>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full capitalize ${STATUS_COLORS[c.status]}`}>
                      {c.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    {c.email && <span className="text-xs text-gray-400 flex items-center gap-0.5"><Mail className="w-3 h-3" />{c.email}</span>}
                    {c.company_name && <span className="text-xs text-gray-400 flex items-center gap-0.5"><Building2 className="w-3 h-3" />{c.company_name}</span>}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <ChevronRight className="w-4 h-4 text-gray-300" />
                </div>
              </div>
            ))
          )}
        </div>

        {/* Pagination */}
        {meta.totalPages > 1 && (
          <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
            <span>Page {meta.page} of {meta.totalPages}</span>
            <div className="flex gap-2">
              <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-gray-50">← Prev</button>
              <button disabled={page >= meta.totalPages} onClick={() => setPage(p => p + 1)}
                className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-gray-50">Next →</button>
            </div>
          </div>
        )}
      </div>

      {/* Right panel — detail drawer */}
      {selected && (
        <div className="fixed inset-0 z-40 lg:static lg:inset-auto lg:z-auto flex lg:flex-1">
          <div className="absolute inset-0 bg-black/30 lg:hidden" onClick={() => setSelected(null)} />
          <div className="absolute right-0 top-0 h-full w-[min(480px,100vw)] bg-white shadow-2xl overflow-y-auto lg:static lg:shadow-none lg:flex-1 lg:w-auto">
            <div className="p-6 space-y-6">
              {/* Close on narrow */}
              <button onClick={() => setSelected(null)} className="lg:hidden absolute top-4 right-4 text-gray-400 hover:text-gray-600 z-10">
                <X className="w-5 h-5" />
              </button>

              {/* Contact header */}
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-brand-400 to-purple-500 flex items-center justify-center text-white text-xl font-bold shrink-0">
                  {selected.first_name[0]}{selected.last_name?.[0] ?? ''}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-semibold text-gray-900">{selected.first_name} {selected.last_name}</h2>
                  {selected.job_title && <p className="text-sm text-gray-500">{selected.job_title}{selected.company_name ? ` · ${selected.company_name}` : ''}</p>}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[selected.status]}`}>{selected.status}</span>
                    <span className="text-xs text-gray-400">{SOURCE_LABELS[selected.source] ?? selected.source}</span>
                    </div>
                </div>
              </div>

              {/* Quick actions */}
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setShowDialer(true)}
                  disabled={!selected.phone}
                  title={selected.phone ? `Call ${selected.phone}` : 'No phone number'}
                  className="flex items-center gap-1.5 px-3 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Phone className="w-4 h-4" /> Call
                </button>
                <button
                  onClick={() => setShowCompose(true)}
                  disabled={!selected.email}
                  title={selected.email ? `Email ${selected.email}` : 'No email address'}
                  className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Mail className="w-4 h-4" /> Email
                </button>
                <button onClick={() => navigate(`/contacts/${selected.id}`)}
                  className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50">
                  <ChevronRight className="w-4 h-4" /> Full Profile
                </button>
                {can.writeRecords && (
                  <>
                    <button onClick={openEdit}
                      className="flex items-center gap-1.5 px-3 py-2 border border-blue-200 text-blue-600 text-sm rounded-lg hover:bg-blue-50">
                      ✏️ Edit
                    </button>
                    <button onClick={() => setShowDeleteConfirm(true)}
                      className="flex items-center gap-1.5 px-3 py-2 border border-red-200 text-red-600 text-sm rounded-lg hover:bg-red-50">
                      🗑️ Delete
                    </button>
                  </>
                )}
              </div>

              {/* Details */}
              <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                {[
                  { label: 'Email', value: selected.email },
                  { label: 'Phone', value: selected.phone },
                  { label: 'Mobile', value: selected.mobile },
                  { label: 'Company', value: selected.company_name || selected.custom_fields?.company_name },
                  { label: 'Owner', value: selected.owner_name },
                  { label: 'Created', value: selected.created_at ? formatDate(selected.created_at) : null },
                  { label: 'Last contact', value: selected.last_contacted_at ? formatDate(selected.last_contacted_at) : 'Never' },
                ].filter((r) => r.value).map((row) => (
                  <div key={row.label} className="flex justify-between text-sm">
                    <span className="text-gray-500">{row.label}</span>
                    <span className="text-gray-900 font-medium">{row.value}</span>
                  </div>
                ))}
              </div>

              {/* Super Admin custom fields */}
              {isSuperAdmin && selected.custom_fields && (
                (() => {
                  const cf = selected.custom_fields;
                  const rows = [
                    { label: 'Workspace', value: cf.workspace },
                    { label: 'Sector', value: cf.sector },
                    { label: 'Point of Contact', value: cf.poc_name },
                    { label: 'POC Phone', value: cf.poc_phone },
                    { label: 'POC Email', value: cf.poc_email },
                  ].filter(r => r.value);
                  if (rows.length === 0 && !cf.remarks && !(cf.attachments?.length)) return null;
                  return (
                    <div className="space-y-4">
                      {rows.length > 0 && (
                        <div className="bg-blue-50 rounded-xl p-4 space-y-3">
                          <p className="text-xs font-bold uppercase tracking-widest text-blue-400 mb-1">Additional Info</p>
                          {rows.map((row) => (
                            <div key={row.label} className="flex justify-between text-sm">
                              <span className="text-gray-500">{row.label}</span>
                              <span className="text-gray-900 font-medium">{row.value}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {cf.remarks && (
                        <div className="bg-gray-50 rounded-xl p-4">
                          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">Remarks</p>
                          <p className="text-sm text-gray-700 whitespace-pre-wrap">{cf.remarks}</p>
                        </div>
                      )}
                      {cf.attachments?.length > 0 && (
                        <div className="bg-gray-50 rounded-xl p-4">
                          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Attachments ({cf.attachments.length})</p>
                          <div className="space-y-2">
                            {cf.attachments.map((att: any, i: number) => {
                              const isImage = att.type?.startsWith('image/');
                              const icon = isImage ? '🖼️' : att.type?.startsWith('video/') ? '🎬' : att.type?.includes('pdf') ? '📄' : '📎';
                              return (
                                <div key={i} className="flex items-center gap-2 p-2 border border-gray-200 rounded-lg bg-white">
                                  <span className="text-lg shrink-0">{icon}</span>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-gray-800 truncate">{att.name}</p>
                                    <p className="text-xs text-gray-400">{(att.size / 1024).toFixed(0)} KB</p>
                                  </div>
                                  <div className="flex gap-1 shrink-0">
                                    {isImage && (
                                      <button onClick={() => { const w = window.open(); w?.document.write(`<img src="${att.data}" style="max-width:100%">`); }}
                                        className="text-xs px-2 py-1 text-blue-600 hover:bg-blue-50 rounded">View</button>
                                    )}
                                    <a href={att.data} download={att.name}
                                      className="text-xs px-2 py-1 text-gray-600 hover:bg-gray-100 rounded">↓ Save</a>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()
              )}

              {/* Timeline */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Timeline</h3>
                {!timeline ? (
                  <p className="text-xs text-gray-400">Loading…</p>
                ) : timeline.length === 0 ? (
                  <p className="text-xs text-gray-400">No activity yet</p>
                ) : (
                  <div className="space-y-3">
                    {timeline.map((item: any) => (
                      <div key={item.id} className="flex gap-3">
                        <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center shrink-0 text-xs">
                          {item.type === 'voice_call' ? '📞' : '✓'}
                        </div>
                        <div>
                          <p className="text-sm text-gray-800">{item.subject}</p>
                          <p className="text-xs text-gray-400">{formatDate(item.created_at)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showImport && <ContactImportModal onClose={() => setShowImport(false)} />}

      {/* Edit contact modal — Super Admin */}
      {showEdit && isSuperAdmin && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl my-4 flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
              <h2 className="font-semibold text-gray-900">Edit Contact</h2>
              <div className="flex items-center gap-2">
                <button onClick={handleSaUpdate} disabled={!editForm.firstName || updateMutation.isPending}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg disabled:opacity-50 hover:bg-blue-700 font-medium">
                  {updateMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Save
                </button>
                <button onClick={() => setShowEdit(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
              </div>
            </div>
            <div className="px-6 py-5 space-y-3 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">First Name *</label>
                  <input value={editForm.firstName} onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Last Name</label>
                  <input value={editForm.lastName} onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Contact Number</label>
                  <input type="tel" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Contact Email</label>
                  <input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Company Name</label>
                  <input value={editForm.companyName}
                    onChange={(e) => setEditForm({ ...editForm, companyName: e.target.value, workspace: slugify(e.target.value) })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Workspace (slug)</label>
                  <input value={editForm.workspace} onChange={(e) => setEditForm({ ...editForm, workspace: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400 bg-gray-50" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Sector</label>
                  <select value={editForm.sector} onChange={(e) => setEditForm({ ...editForm, sector: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400">
                    {SECTORS.map((s) => <option key={s.id} value={s.id}>{s.icon} {s.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Point of Contact Name</label>
                  <input value={editForm.pocName} onChange={(e) => setEditForm({ ...editForm, pocName: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">POC Phone</label>
                  <input type="tel" value={editForm.pocPhone} onChange={(e) => setEditForm({ ...editForm, pocPhone: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400" />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-gray-600 mb-1 block">POC Email</label>
                  <input type="email" value={editForm.pocEmail} onChange={(e) => setEditForm({ ...editForm, pocEmail: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400" />
                </div>
              </div>
              <div className="border-t border-gray-100 pt-4">
                <label className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2 block">Remarks</label>
                <textarea value={editForm.remarks} onChange={(e) => setEditForm({ ...editForm, remarks: e.target.value })}
                  rows={5} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400 resize-y min-h-[100px]" />
              </div>
            </div>
            <div className="flex gap-2 px-6 py-4 border-t border-gray-100">
              <button onClick={() => setShowEdit(false)}
                className="flex-1 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={handleSaUpdate} disabled={!editForm.firstName || updateMutation.isPending}
                className="flex-1 py-2 bg-blue-600 text-white rounded-xl text-sm disabled:opacity-50 flex items-center justify-center gap-2 font-medium hover:bg-blue-700">
                {updateMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Email compose */}
      {showCompose && selected && (
        <ComposeModal
          onClose={() => setShowCompose(false)}
          prefill={{
            to: selected.email,
            toName: `${selected.first_name} ${selected.last_name ?? ''}`.trim(),
            contactId: selected.id,
          }}
        />
      )}

      {/* Call dialer */}
      {showDialer && selected && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-brand-600 flex items-center justify-center mx-auto">
              <Phone className="w-8 h-8 text-white" />
            </div>
            <div>
              <p className="text-lg font-semibold text-gray-900">{selected.first_name} {selected.last_name ?? ''}</p>
              <p className="text-sm text-gray-500">{selected.phone}</p>
            </div>
            <p className="text-xs text-gray-400">Initiating outbound call via Voice system…</p>
            <div className="flex gap-3">
              <button onClick={() => setShowDialer(false)}
                className="flex-1 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button
                onClick={() => {
                  navigate(`/voice-calls?phone=${encodeURIComponent(selected.phone)}&name=${encodeURIComponent(`${selected.first_name} ${selected.last_name ?? ''}`.trim())}&contactId=${selected.id}`);
                  setShowDialer(false);
                }}
                className="flex-1 py-2 bg-brand-600 text-white rounded-xl text-sm font-medium hover:bg-brand-700"
              >
                Open Voice
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && selected && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-2">Delete Contact</h2>
            <p className="text-sm text-gray-500 mb-6">
              Are you sure you want to delete <strong>{selected.first_name} {selected.last_name}</strong>? This action cannot be undone.
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

      {/* Create contact modal — Super Admin version */}
      {showCreate && isSuperAdmin && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl my-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">New Contact</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-3 max-h-[75vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">First Name *</label>
                  <input value={saForm.firstName} onChange={(e) => setSaForm({ ...saForm, firstName: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Last Name</label>
                  <input value={saForm.lastName} onChange={(e) => setSaForm({ ...saForm, lastName: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Contact Number</label>
                  <input type="tel" value={saForm.phone} onChange={(e) => setSaForm({ ...saForm, phone: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Contact Email</label>
                  <input type="email" value={saForm.email} onChange={(e) => setSaForm({ ...saForm, email: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Company Name</label>
                  <input value={saForm.companyName}
                    onChange={(e) => setSaForm({ ...saForm, companyName: e.target.value, workspace: slugify(e.target.value) })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Workspace (slug)</label>
                  <input value={saForm.workspace} onChange={(e) => setSaForm({ ...saForm, workspace: e.target.value })}
                    placeholder="auto-filled from company name"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400 bg-gray-50" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Sector</label>
                  <select value={saForm.sector} onChange={(e) => setSaForm({ ...saForm, sector: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400">
                    {SECTORS.map((s) => (
                      <option key={s.id} value={s.id}>{s.icon} {s.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Point of Contact Name</label>
                  <input value={saForm.pocName} onChange={(e) => setSaForm({ ...saForm, pocName: e.target.value })}
                    placeholder="Name of key contact person"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">POC Phone</label>
                  <input type="tel" value={saForm.pocPhone} onChange={(e) => setSaForm({ ...saForm, pocPhone: e.target.value })}
                    placeholder="POC contact number"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400" />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-gray-600 mb-1 block">POC Email</label>
                  <input type="email" value={saForm.pocEmail} onChange={(e) => setSaForm({ ...saForm, pocEmail: e.target.value })}
                    placeholder="POC email address"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400" />
                </div>
              </div>

              {/* Remarks */}
              <div className="border-t border-gray-100 pt-4">
                <label className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2 block">Remarks</label>
                <textarea
                  value={saForm.remarks}
                  onChange={(e) => setSaForm({ ...saForm, remarks: e.target.value })}
                  placeholder="Add notes, observations, or any relevant information…"
                  rows={5}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400 resize-y min-h-[100px]"
                />

                {/* File attachment */}
                <div className="mt-3">
                  <label className="text-xs font-medium text-gray-600 mb-2 block">Attachments</label>
                  <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-xl cursor-pointer hover:bg-gray-50 transition-colors">
                    <Upload className="w-4 h-4 text-gray-400" />
                    <span className="text-xs text-gray-500">Click to attach images, documents, or media files</span>
                    <input
                      type="file"
                      multiple
                      accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
                      className="hidden"
                      onChange={(e) => {
                        const newFiles = Array.from(e.target.files ?? []);
                        setSaFiles(prev => [...prev, ...newFiles]);
                        e.target.value = '';
                      }}
                    />
                  </label>

                  {saFiles.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {saFiles.map((f, i) => (
                        <div key={i} className="flex items-center justify-between px-3 py-1.5 bg-gray-50 rounded-lg">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm">
                              {f.type.startsWith('image/') ? '🖼️' : f.type.startsWith('video/') ? '🎬' : f.type.includes('pdf') ? '📄' : '📎'}
                            </span>
                            <span className="text-xs text-gray-700 truncate">{f.name}</span>
                            <span className="text-xs text-gray-400 shrink-0">({(f.size / 1024).toFixed(0)} KB)</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setSaFiles(prev => prev.filter((_, idx) => idx !== i))}
                            className="text-gray-400 hover:text-red-500 ml-2 shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-2 px-6 py-4 border-t border-gray-100">
              <button onClick={() => { setShowCreate(false); setSaFiles([]); }}
                className="flex-1 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={handleSaCreate}
                disabled={!saForm.firstName || createMutation.isPending}
                className="flex-1 py-2 bg-blue-600 text-white rounded-xl text-sm disabled:opacity-50 flex items-center justify-center gap-2 font-medium hover:bg-blue-700"
              >
                {createMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Create Contact
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create contact modal — Tenant / User version (sector-aware) */}
      {showCreate && !isSuperAdmin && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-4">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <h2 className="font-semibold text-gray-900">
                  New {sectorConfig.contactLabel}
                </h2>
                {sectorConfig.id !== 'other' && (
                  <span className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full"
                        style={{ background: `${sectorConfig.color}15`, color: sectorConfig.color }}>
                    <Tag className="w-3 h-3" />
                    {sectorConfig.label}
                  </span>
                )}
              </div>
              <button onClick={() => { setShowCreate(false); setSectorValues({}); }} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5 max-h-[75vh] overflow-y-auto">
              {/* Core fields */}
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Basic Information</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">First Name *</label>
                    <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Last Name</label>
                    <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400" />
                  </div>
                  {[
                    { label: 'Email', key: 'email', type: 'email' },
                    { label: 'Phone', key: 'phone', type: 'tel' },
                  ].map((f) => (
                    <div key={f.key}>
                      <label className="text-xs font-medium text-gray-600 mb-1 block">{f.label}</label>
                      <input type={f.type} value={(form as any)[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400" />
                    </div>
                  ))}
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Status</label>
                    <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400">
                      {['lead','prospect','customer'].map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Source</label>
                    <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400">
                      {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* Sector-specific fields */}
              {sectorFields.length > 0 && (
                <div className="border-t border-gray-100 pt-5">
                  <SectorFieldsForm
                    fields={sectorFields}
                    values={sectorValues}
                    onChange={setSectorField}
                    sectorColor={sectorConfig.color}
                  />
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex gap-2 px-6 py-4 border-t border-gray-100">
              <button onClick={() => { setShowCreate(false); setSectorValues({}); }}
                className="flex-1 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={() => createMutation.mutate({ ...form, custom_fields: sectorValues })}
                disabled={!form.firstName || createMutation.isPending}
                className="flex-1 py-2 text-white rounded-xl text-sm disabled:opacity-50 flex items-center justify-center gap-2 font-medium"
                style={{ background: sectorConfig.color }}
              >
                {createMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Create {sectorConfig.contactLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
