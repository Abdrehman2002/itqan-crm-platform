import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  Plus, Search, Filter, Phone, Mail, Building2,
  Star, ChevronRight, Loader2, X, Upload, Tag,
} from 'lucide-react';
import { api } from '../services/api';
import { formatDate } from '../utils/format';
import { useCan } from '../hooks/useRole';
import { ContactImportModal } from '../components/ContactImportModal';
import { useSectorFields } from '../hooks/useSectorFields';
import { SectorFieldsForm } from '../components/SectorFieldsForm';

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

export function Contacts() {
  const qc = useQueryClient();
  const can = useCan();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<any | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', status: 'lead', source: 'manual' });
  const [sectorValues, setSectorValues] = useState<Record<string, any>>({});

  const { fields: sectorFields, config: sectorConfig } = useSectorFields();
  const setSectorField = (name: string, value: any) => setSectorValues(prev => ({ ...prev, [name]: value }));

  const { data, isLoading } = useQuery({
    queryKey: ['contacts', search, statusFilter, page],
    queryFn: () =>
      api.get('/api/v1/contacts', { params: { search: search || undefined, status: statusFilter || undefined, page, pageSize: 25 } })
         .then((r) => r.data),
    placeholderData: keepPreviousData,
  });

  const { data: timeline } = useQuery({
    queryKey: ['contact-timeline', selected?.id],
    queryFn: () => api.get(`/api/v1/contacts/${selected.id}/timeline`).then((r) => r.data.data),
    enabled: !!selected,
  });

  const createMutation = useMutation({
    mutationFn: (body: any) => api.post('/api/v1/contacts', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      setShowCreate(false);
      setForm({ firstName: '', lastName: '', email: '', phone: '', status: 'lead', source: 'manual' });
      setSectorValues({});
    },
  });

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
                <h1 className="text-lg font-semibold text-gray-900">{sectorConfig.contactLabelPlural}</h1>
                {sectorConfig.id !== 'other' && (
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
                  <Plus className="w-3.5 h-3.5" /> Add {sectorConfig.contactLabel}
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
                  <div className="flex items-center gap-0.5">
                    <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                    <span className="text-xs text-gray-500">{c.score}</span>
                  </div>
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

      {/* Right panel — detail / timeline */}
      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <div className="p-6 space-y-6">
            {/* Contact header */}
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-brand-400 to-purple-500 flex items-center justify-center text-white text-xl font-bold">
                {selected.first_name[0]}{selected.last_name?.[0] ?? ''}
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-semibold text-gray-900">{selected.first_name} {selected.last_name}</h2>
                {selected.job_title && <p className="text-sm text-gray-500">{selected.job_title}{selected.company_name ? ` · ${selected.company_name}` : ''}</p>}
                <div className="flex items-center gap-2 mt-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[selected.status]}`}>{selected.status}</span>
                  <span className="text-xs text-gray-400">{SOURCE_LABELS[selected.source] ?? selected.source}</span>
                  <span className="text-xs text-gray-400">Score: {selected.score}/100</span>
                </div>
              </div>
            </div>

            {/* Quick actions */}
            <div className="flex gap-2 flex-wrap">
              <button className="flex items-center gap-1.5 px-3 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700">
                <Phone className="w-4 h-4" /> Call
              </button>
              <button className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50">
                <Mail className="w-4 h-4" /> Email
              </button>
              <button
                onClick={() => navigate(`/contacts/${selected.id}`)}
                className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50"
              >
                <ChevronRight className="w-4 h-4" /> Full Profile
              </button>
            </div>

            {/* Details */}
            <div className="bg-gray-50 rounded-xl p-4 space-y-3">
              {[
                { label: 'Email', value: selected.email },
                { label: 'Phone', value: selected.phone },
                { label: 'Mobile', value: selected.mobile },
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
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400">
            <div className="text-center">
              <p className="text-sm">Select a contact to view details</p>
            </div>
          </div>
        )}
      </div>

      {showImport && <ContactImportModal onClose={() => setShowImport(false)} />}

      {/* Create contact modal */}
      {showCreate && (
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
