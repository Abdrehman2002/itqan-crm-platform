import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { CURRENCIES, DEFAULT_SETTINGS, type SalesSettings, type TaxRate } from './types';
import { Save, Plus, Trash2, Upload, Mail } from 'lucide-react';
import { v4 as uuid } from 'uuid';

const TERMS_OPTIONS = [
  { value: '0', label: 'Due on Receipt' }, { value: '7', label: 'Net 7' },
  { value: '15', label: 'Net 15' }, { value: '30', label: 'Net 30' },
  { value: '45', label: 'Net 45' }, { value: '60', label: 'Net 60' },
];

export function SalesSettingsPage() {
  const qc = useQueryClient();
  const { data: remote } = useQuery<SalesSettings>({
    queryKey: ['sales-settings'],
    queryFn: () => api.get('/api/v1/sales/settings').then(r => r.data.data ?? DEFAULT_SETTINGS),
  });

  const [form, setForm] = useState<SalesSettings>(DEFAULT_SETTINGS);
  const [newTaxName, setNewTaxName] = useState('');
  const [newTaxRate, setNewTaxRate] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => { if (remote) setForm(remote); }, [remote]);

  const saveMut = useMutation({
    mutationFn: (body: SalesSettings) => api.put('/api/v1/sales/settings', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sales-settings'] }); setSaved(true); setTimeout(() => setSaved(false), 2000); },
  });

  const addTax = () => {
    if (!newTaxName || !newTaxRate) return;
    setForm(f => ({ ...f, taxRates: [...f.taxRates, { id: uuid(), name: newTaxName, rate: Number(newTaxRate), isDefault: false }] }));
    setNewTaxName(''); setNewTaxRate('');
  };

  const addr = form.companyAddress ?? { line1: '', city: '', state: '', country: '', postalCode: '' };
  const setAddr = (field: string, val: string) => setForm(f => ({ ...f, companyAddress: { ...addr, [field]: val } as any }));

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-5">

      {/* Company Info */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="text-sm font-semibold text-gray-900 mb-4 pb-3 border-b border-gray-100">Company Information</div>
        <div className="flex items-center gap-4 mb-4">
          <div className="w-14 h-14 bg-blue-100 rounded-xl flex items-center justify-center text-blue-600 font-bold text-xl">
            {form.companyName?.[0] ?? 'C'}
          </div>
          <button className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">
            <Upload size={13} /> Upload Logo
          </button>
          <span className="text-xs text-gray-400">PNG or SVG, max 2MB</span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: 'Company Name', field: 'companyName', value: form.companyName ?? '' },
            { label: 'Email', field: 'companyEmail', value: form.companyEmail ?? '' },
            { label: 'Phone', field: 'companyPhone', value: form.companyPhone ?? '' },
          ].map(({ label, field, value }) => (
            <div key={field} className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-700">{label}</label>
              <input value={value} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4 mt-4">
          {[['Address Line 1','line1'],['City','city'],['State','state'],['Country','country'],['Postal Code','postalCode']].map(([label, field]) => (
            <div key={field} className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-700">{label}</label>
              <input value={(addr as any)[field] ?? ''} onChange={e => setAddr(field, e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          ))}
        </div>
      </div>

      {/* Invoice Defaults */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="text-sm font-semibold text-gray-900 mb-4 pb-3 border-b border-gray-100">Invoice Defaults</div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-700">Default Currency</label>
            <select value={form.defaultCurrency} onChange={e => setForm(f => ({ ...f, defaultCurrency: e.target.value }))}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-700">Default Payment Terms</label>
            <select value={String(form.defaultPaymentTerms)} onChange={e => setForm(f => ({ ...f, defaultPaymentTerms: Number(e.target.value) }))}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              {TERMS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-700">Invoice Prefix</label>
            <input value={form.invoicePrefix} onChange={e => setForm(f => ({ ...f, invoicePrefix: e.target.value }))} placeholder="INV-"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-700">Next Invoice Number</label>
            <input type="number" value={form.nextInvoiceNumber} onChange={e => setForm(f => ({ ...f, nextInvoiceNumber: Number(e.target.value) }))}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
      </div>

      {/* Tax Rates */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="text-sm font-semibold text-gray-900 mb-4 pb-3 border-b border-gray-100">Tax Rates</div>
        <div className="space-y-2 mb-4">
          {form.taxRates.map(t => (
            <div key={t.id} className="flex items-center gap-3 p-2.5 border border-gray-100 rounded-lg">
              <div className="flex-1"><span className="text-sm font-medium text-gray-800">{t.name}</span><span className="ml-2 text-xs text-gray-400">{t.rate}%</span></div>
              {t.isDefault ? <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">Default</span>
                : <button onClick={() => setForm(f => ({ ...f, taxRates: f.taxRates.map(r => ({ ...r, isDefault: r.id === t.id })) }))} className="text-xs text-blue-500 hover:text-blue-700">Set Default</button>}
              <button onClick={() => setForm(f => ({ ...f, taxRates: f.taxRates.filter(r => r.id !== t.id) }))} className="text-gray-300 hover:text-red-500"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 items-end">
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs font-medium text-gray-700">Tax Name</label>
            <input value={newTaxName} onChange={e => setNewTaxName(e.target.value)} placeholder="e.g. VAT 10%"
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          <div className="flex flex-col gap-1 w-24">
            <label className="text-xs font-medium text-gray-700">Rate (%)</label>
            <input type="number" value={newTaxRate} onChange={e => setNewTaxRate(e.target.value)} placeholder="10"
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          <button onClick={addTax} className="flex items-center gap-1 px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm text-gray-700">
            <Plus size={13} /> Add
          </button>
        </div>
      </div>

      {/* Email Config */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
          <div className="text-sm font-semibold text-gray-900">Email Configuration</div>
          <span className={`text-xs px-2 py-0.5 rounded ${form.smtpConfigured ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            {form.smtpConfigured ? 'Configured' : 'Not Configured'}
          </span>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer mb-3">
          <input type="checkbox" checked={form.smtpConfigured} onChange={e => setForm(f => ({ ...f, smtpConfigured: e.target.checked }))} className="rounded" />
          Enable custom SMTP
        </label>
        {!form.smtpConfigured && (
          <div className="text-xs text-gray-400 bg-gray-50 rounded-lg p-3 flex items-start gap-1.5">
            <Mail size={12} className="mt-0.5 shrink-0" />
            Emails will be sent via the platform's default mail service. Enable SMTP to use your own sender address.
          </div>
        )}
        {form.smtpConfigured && (
          <div className="grid grid-cols-2 gap-4">
            {[['SMTP Host','smtp.gmail.com'],['SMTP Port','587'],['SMTP Username','you@company.com'],['SMTP Password','']].map(([label, ph]) => (
              <div key={label} className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-700">{label}</label>
                <input placeholder={ph} type={label.includes('Password') ? 'password' : 'text'}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end pb-6">
        <button onClick={() => saveMut.mutate(form)} disabled={saveMut.isPending}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
          <Save size={14} /> {saved ? 'Saved!' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
