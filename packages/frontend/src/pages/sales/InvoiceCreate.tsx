import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../../services/api';
import { formatCurrency, CURRENCIES, DEFAULT_SETTINGS, type LineItem, type SalesSettings, type BillingContact } from './types';
import { Plus, Trash2, Save, Send, ChevronLeft } from 'lucide-react';
import { v4 as uuid } from 'uuid';

const TERMS_OPTIONS = [
  { value: '0', label: 'Due on Receipt' }, { value: '7', label: 'Net 7' },
  { value: '15', label: 'Net 15' }, { value: '30', label: 'Net 30' },
  { value: '45', label: 'Net 45' }, { value: '60', label: 'Net 60' },
];

function mkLine(defaultTaxRate = 0): LineItem {
  return { id: uuid(), description: '', quantity: 1, unitPrice: 0, taxRate: defaultTaxRate, taxAmount: 0, total: 0 };
}

export function InvoiceCreate() {
  const navigate = useNavigate();

  const { data: settings } = useQuery<SalesSettings>({
    queryKey: ['sales-settings'],
    queryFn: () => api.get('/api/v1/sales/settings').then(r => r.data.data ?? DEFAULT_SETTINGS),
  });
  const { data: contactsData } = useQuery<BillingContact[]>({
    queryKey: ['billing-contacts'],
    queryFn: () => api.get('/api/v1/sales/billing-contacts').then(r => r.data.data ?? []),
  });

  const s = settings ?? DEFAULT_SETTINGS;
  const defaultTax = s.taxRates.find(t => t.isDefault)?.rate ?? 0;

  const [contactId, setContactId] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().split('T')[0]);
  const [payTerms, setPayTerms] = useState(String(s.defaultPaymentTerms ?? 30));
  const [poRef, setPoRef] = useState('');
  const [currency, setCurrency] = useState(s.defaultCurrency ?? 'USD');
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('Payment due within the specified terms. Late payments may attract interest.');
  const [lines, setLines] = useState<LineItem[]>([mkLine(defaultTax)]);

  const dueDate = new Date(issueDate);
  dueDate.setDate(dueDate.getDate() + Number(payTerms));
  const dueDateStr = dueDate.toISOString().split('T')[0];

  const updateLine = (id: string, field: keyof LineItem, value: string | number) => {
    setLines(prev => prev.map(li => {
      if (li.id !== id) return li;
      const updated = { ...li, [field]: value };
      const sub = updated.quantity * updated.unitPrice;
      updated.taxAmount = (sub * updated.taxRate) / 100;
      updated.total = sub + updated.taxAmount;
      return updated;
    }));
  };

  const subtotal = lines.reduce((s, li) => s + li.quantity * li.unitPrice, 0);
  const totalTax = lines.reduce((s, li) => s + li.taxAmount, 0);
  const total = subtotal + totalTax;

  const createMut = useMutation({
    mutationFn: (status: 'draft' | 'sent') => api.post('/api/v1/sales/invoices', {
      billingContactId: contactId || undefined,
      issueDate, dueDate: dueDateStr, currency, poReference: poRef || undefined,
      templateId: 'tpl-classic', lineItems: lines, subtotal, totalTax, total,
      notes: notes || undefined, terms: terms || undefined, status,
    }),
    onSuccess: (res) => navigate(`/sales/invoices/${res.data.data.id}`),
  });

  const taxOpts = (s.taxRates ?? []).map(t => ({ value: String(t.rate), label: `${t.name} (${t.rate}%)` }));
  const contactOpts = [{ value: '', label: 'Select a contact…' }, ...(contactsData ?? []).map(c => ({ value: c.id, label: c.name }))];
  const currencyOpts = CURRENCIES.map(c => ({ value: c.code, label: `${c.code} — ${c.name}` }));

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
          <ChevronLeft size={16} /> Back
        </button>
        <h1 className="text-lg font-bold text-gray-900">New Invoice</h1>
      </div>

      {/* Details */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="text-sm font-semibold text-gray-900 mb-4 pb-3 border-b border-gray-100">Invoice Details</div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { label: 'Client *', el: <select value={contactId} onChange={e => setContactId(e.target.value)} className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">{contactOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select> },
            { label: 'Currency', el: <select value={currency} onChange={e => setCurrency(e.target.value)} className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">{currencyOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select> },
            { label: 'PO Reference #', el: <input value={poRef} onChange={e => setPoRef(e.target.value)} placeholder="Optional" className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" /> },
            { label: 'Issue Date', el: <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" /> },
            { label: 'Payment Terms', el: <select value={payTerms} onChange={e => setPayTerms(e.target.value)} className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">{TERMS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select> },
            { label: 'Due Date', el: <input type="date" value={dueDateStr} readOnly className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 text-gray-500" /> },
          ].map(({ label, el }) => (
            <div key={label} className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-700">{label}</label>
              {el}
            </div>
          ))}
        </div>
      </div>

      {/* Line Items */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 text-sm font-semibold text-gray-900">Line Items</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 w-2/5">Description</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 w-16">Qty</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 w-28">Unit Price</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 w-36">Tax</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 w-28">Total</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {lines.map(li => (
                <tr key={li.id} className="border-b border-gray-50">
                  <td className="px-4 py-2"><input placeholder="Item description" value={li.description}
                    onChange={e => updateLine(li.id, 'description', e.target.value)}
                    className="w-full text-sm border-0 outline-none placeholder:text-gray-400" /></td>
                  <td className="px-4 py-2"><input type="number" min={1} value={li.quantity}
                    onChange={e => updateLine(li.id, 'quantity', Number(e.target.value))}
                    className="w-16 text-sm border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-blue-400" /></td>
                  <td className="px-4 py-2"><input type="number" min={0} value={li.unitPrice}
                    onChange={e => updateLine(li.id, 'unitPrice', Number(e.target.value))}
                    className="w-28 text-sm border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-blue-400" /></td>
                  <td className="px-4 py-2">
                    <select value={String(li.taxRate)} onChange={e => updateLine(li.id, 'taxRate', Number(e.target.value))}
                      className="w-36 text-sm border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-blue-400 bg-white">
                      {taxOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-2 text-right font-medium text-gray-900">{formatCurrency(li.total, currency)}</td>
                  <td className="px-4 py-2">
                    <button onClick={() => setLines(prev => prev.length > 1 ? prev.filter(l => l.id !== li.id) : prev)}
                      className="text-gray-300 hover:text-red-500"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-gray-100">
          <button onClick={() => setLines(prev => [...prev, mkLine(defaultTax)])}
            className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800">
            <Plus size={14} /> Add Line Item
          </button>
        </div>
        <div className="border-t border-gray-100 px-6 py-4">
          <div className="ml-auto w-64 space-y-2 text-sm">
            <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{formatCurrency(subtotal, currency)}</span></div>
            <div className="flex justify-between text-gray-600"><span>Tax</span><span>{formatCurrency(totalTax, currency)}</span></div>
            <div className="flex justify-between font-bold text-gray-900 text-base border-t border-gray-200 pt-2">
              <span>Total</span><span>{formatCurrency(total, currency)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Notes & Terms */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm font-semibold text-gray-900 mb-3">Notes</div>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Thank you for your business…"
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 min-h-[80px] resize-y focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm font-semibold text-gray-900 mb-3">Terms & Conditions</div>
          <textarea value={terms} onChange={e => setTerms(e.target.value)}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 min-h-[80px] resize-y focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 pb-6">
        <button onClick={() => navigate(-1)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">Cancel</button>
        <button onClick={() => createMut.mutate('draft')} disabled={createMut.isPending}
          className="flex items-center gap-2 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 disabled:opacity-50">
          <Save size={14} /> Save as Draft
        </button>
        <button onClick={() => createMut.mutate('sent')} disabled={createMut.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
          <Send size={14} /> Save & Send
        </button>
      </div>
    </div>
  );
}
