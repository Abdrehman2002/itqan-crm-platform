import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Building2, Globe, Phone, Users, Plus, Search, X, Loader2,
  ChevronRight, TrendingUp, MapPin,
} from 'lucide-react';
import { api } from '../services/api';
import { formatCurrency, formatNumber } from '../utils/format';

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
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<any | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: '', domain: '', industry: '', size: '', country: '', city: '', website: '', phone: '',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['companies', search, page],
    queryFn: () =>
      api.get('/api/v1/companies', { params: { search: search || undefined, page, pageSize: 25 } })
        .then((r) => r.data),
  });

  const { data: contacts } = useQuery({
    queryKey: ['company-contacts', selected?.id],
    queryFn: () =>
      api.get('/api/v1/contacts', { params: { companyId: selected.id, pageSize: 10 } })
        .then((r) => r.data.data),
    enabled: !!selected,
  });

  const { data: deals } = useQuery({
    queryKey: ['company-deals', selected?.id],
    queryFn: () =>
      api.get('/api/v1/deals', { params: { companyId: selected.id, pageSize: 10 } })
        .then((r) => r.data.data),
    enabled: !!selected,
  });

  const createMutation = useMutation({
    mutationFn: (body: any) => api.post('/api/v1/companies', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['companies'] });
      setShowCreate(false);
      setForm({ name: '', domain: '', industry: '', size: '', country: '', city: '', website: '', phone: '' });
    },
  });

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
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white text-xs rounded-lg hover:bg-brand-700"
            >
              <Plus className="w-3.5 h-3.5" /> Add Company
            </button>
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

      {/* Detail panel */}
      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center">
                {selected.domain ? (
                  <img src={`https://www.google.com/s2/favicons?domain=${selected.domain}&sz=64`}
                    alt={selected.name} className="w-8 h-8 rounded"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                ) : (
                  <Building2 className="w-7 h-7 text-slate-500" />
                )}
              </div>
              <div>
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

            {/* Stats strip */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Contacts', value: contacts?.length ?? 0, icon: Users },
                { label: 'Open Deals', value: deals?.filter((d: any) => d.status === 'open').length ?? 0, icon: TrendingUp },
                { label: 'Pipeline', value: formatCurrency(pipelineValue), icon: TrendingUp, isStr: true },
              ].map((stat) => (
                <div key={stat.label} className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-gray-900">{stat.isStr ? stat.value : formatNumber(Number(stat.value))}</p>
                  <p className="text-xs text-gray-500">{stat.label}</p>
                </div>
              ))}
            </div>

            {/* Details */}
            <div className="bg-gray-50 rounded-xl p-4 space-y-3">
              {[
                { label: 'Phone',   value: selected.phone },
                { label: 'Size',    value: SIZE_LABELS[selected.size] ?? selected.size },
                { label: 'Country', value: selected.country },
                { label: 'City',    value: selected.city },
                { label: 'Revenue', value: selected.annual_revenue ? formatCurrency(selected.annual_revenue) : null },
                { label: 'Owner',   value: selected.owner_name },
              ].filter((r) => r.value).map((row) => (
                <div key={row.label} className="flex justify-between text-sm">
                  <span className="text-gray-500">{row.label}</span>
                  <span className="text-gray-900 font-medium">{row.value}</span>
                </div>
              ))}
            </div>

            {/* Contacts */}
            {contacts && contacts.length > 0 && (
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
            )}

            {/* Open deals */}
            {deals && deals.filter((d: any) => d.status === 'open').length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Open Deals</h3>
                <div className="space-y-2">
                  {deals.filter((d: any) => d.status === 'open').map((deal: any) => (
                    <div key={deal.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{deal.name}</p>
                        <p className="text-xs text-gray-400">{deal.stage_id}</p>
                      </div>
                      {deal.amount && (
                        <span className="text-sm font-semibold text-brand-600">{formatCurrency(deal.amount)}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400">
            <div className="text-center">
              <Building2 className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Select a company to view details</p>
            </div>
          </div>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-gray-900">New Company</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600">
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
            <div className="flex gap-2 mt-6">
              <button onClick={() => setShowCreate(false)}
                className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button
                onClick={() => createMutation.mutate(form)}
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
    </div>
  );
}
