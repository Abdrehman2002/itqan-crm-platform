import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { CURRENCIES, type BillingContact } from './types';
import { Plus, Pencil, Trash2, X, Save } from 'lucide-react';
import { v4 as uuid } from 'uuid';

const COUNTRY_OPTS = ['USA','UK','India','UAE','Singapore','Australia','Canada','Germany','Other'].map(c => ({ value: c, label: c }));
const empty = (): BillingContact => ({ id: uuid(), name: '', email: '', phone: '', company: '', currency: 'PKR', taxId: '', billingAddress: { line1: '', city: '', state: '', country: 'Pakistan', postalCode: '' } });

export function SalesContacts() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<BillingContact | null>(null);
  const [isNew, setIsNew] = useState(false);

  const { data, isLoading } = useQuery<BillingContact[]>({
    queryKey: ['billing-contacts', search],
    queryFn: () => api.get('/api/v1/sales/billing-contacts', { params: { search: search || undefined } }).then(r => r.data.data ?? []),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });

  const createMut = useMutation({
    mutationFn: (b: any) => api.post('/api/v1/sales/billing-contacts', b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['billing-contacts'] }); setEditing(null); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, ...b }: any) => api.put(`/api/v1/sales/billing-contacts/${id}`, b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['billing-contacts'] }); setEditing(null); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/sales/billing-contacts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billing-contacts'] }),
  });

  const save = () => {
    if (!editing) return;
    const payload = { name: editing.name, email: editing.email, phone: editing.phone, company: editing.company, currency: editing.currency, taxId: editing.taxId, billingAddress: editing.billingAddress };
    if (isNew) createMut.mutate(payload);
    else updateMut.mutate({ id: editing.id, ...payload });
  };

  const contacts = data ?? [];

  return (
    <div className="p-6">
      <div className="flex gap-3 mb-5">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search contacts…"
          className="sm:w-64 text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button onClick={() => { setEditing(empty()); setIsNew(true); }}
          className="ml-auto flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
          <Plus size={14} /> New Contact
        </button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Name','Email','Currency','Country',''].map(h => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={5} className="px-5 py-12 text-center text-gray-400">Loading…</td></tr>}
              {!isLoading && contacts.length === 0 && <tr><td colSpan={5} className="px-5 py-12 text-center text-gray-400">No contacts yet.</td></tr>}
              {contacts.map(c => (
                <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-5 py-3">
                    <div className="font-medium text-gray-900">{c.name}</div>
                    {c.company && <div className="text-xs text-gray-400">{c.company}</div>}
                  </td>
                  <td className="px-5 py-3 text-gray-600">{c.email}</td>
                  <td className="px-5 py-3 text-gray-600">{c.currency}</td>
                  <td className="px-5 py-3 text-gray-600">{(c.billingAddress as any)?.country}</td>
                  <td className="px-5 py-3">
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => { setEditing({ ...c }); setIsNew(false); }} className="text-gray-400 hover:text-blue-600"><Pencil size={14} /></button>
                      <button onClick={() => deleteMut.mutate(c.id)} className="text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {editing && (
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-900">{isNew ? 'New Contact' : 'Edit Contact'}</div>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-700"><X size={15} /></button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto max-h-[70vh]">
              {[
                { label: 'Full Name *', el: <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500" /> },
                { label: 'Email *', el: <input type="email" value={editing.email} onChange={e => setEditing({ ...editing, email: e.target.value })} className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500" /> },
                { label: 'Phone', el: <input value={editing.phone ?? ''} onChange={e => setEditing({ ...editing, phone: e.target.value })} className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500" /> },
                { label: 'Company', el: <input value={editing.company ?? ''} onChange={e => setEditing({ ...editing, company: e.target.value })} className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500" /> },
                { label: 'Currency', el: <select value={editing.currency} onChange={e => setEditing({ ...editing, currency: e.target.value })} className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500">{CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}</select> },
                { label: 'Tax ID / VAT', el: <input value={editing.taxId ?? ''} onChange={e => setEditing({ ...editing, taxId: e.target.value })} className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500" /> },
              ].map(({ label, el }) => <div key={label} className="flex flex-col gap-1"><label className="text-xs font-medium text-gray-700">{label}</label>{el}</div>)}

              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide pt-2">Billing Address</div>
              {[
                { label: 'Address Line 1', field: 'line1' as const },
                { label: 'City', field: 'city' as const },
                { label: 'State', field: 'state' as const },
                { label: 'Postal Code', field: 'postalCode' as const },
              ].map(({ label, field }) => (
                <div key={field} className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-700">{label}</label>
                  <input value={(editing.billingAddress as any)[field] ?? ''} onChange={e => setEditing({ ...editing, billingAddress: { ...editing.billingAddress, [field]: e.target.value } })}
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </div>
              ))}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-700">Country</label>
                <select value={editing.billingAddress.country || 'USA'} onChange={e => setEditing({ ...editing, billingAddress: { ...editing.billingAddress, country: e.target.value } })}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500">
                  {COUNTRY_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => setEditing(null)} className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">Cancel</button>
                <button onClick={save} disabled={createMut.isPending || updateMut.isPending}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  <Save size={13} /> Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
