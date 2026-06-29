import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { formatCurrency, getStatusColor, DEFAULT_SETTINGS, INVOICE_TEMPLATES, type Invoice, type SalesSettings } from './types';
import { Mail, Download, Plus, CheckCircle2, ChevronLeft } from 'lucide-react';

export function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<Invoice>({
    queryKey: ['sales-invoice', id],
    queryFn: () => api.get(`/api/v1/sales/invoices/${id}`).then(r => r.data.data),
    enabled: !!id,
  });
  const { data: settings } = useQuery<SalesSettings>({
    queryKey: ['sales-settings'],
    queryFn: () => api.get('/api/v1/sales/settings').then(r => r.data.data ?? DEFAULT_SETTINGS),
  });

  const [showPayForm, setShowPayForm] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0]);
  const [payModeId, setPayModeId] = useState('');
  const [payBankId, setPayBankId] = useState('');
  const [payRef, setPayRef] = useState('');
  const [emailSent, setEmailSent] = useState(false);

  const s = settings ?? DEFAULT_SETTINGS;

  const patchMut = useMutation({
    mutationFn: (body: any) => api.patch(`/api/v1/sales/invoices/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales-invoice', id] }),
  });

  const paymentMut = useMutation({
    mutationFn: (body: any) => api.post(`/api/v1/sales/invoices/${id}/payments`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sales-invoice', id] }); setShowPayForm(false); setPayAmount(''); setPayRef(''); },
  });

  const sendEmail = () => {
    setEmailSent(true);
    if (inv?.status === 'draft') patchMut.mutate({ status: 'sent' });
    setTimeout(() => setEmailSent(false), 3000);
  };

  const recordPayment = () => {
    const amount = Number(payAmount);
    if (!amount || amount <= 0) return;
    const mode = s.paymentModes.find(m => m.id === payModeId) ?? s.paymentModes[0];
    const bank = s.bankAccounts.find(b => b.id === payBankId);
    paymentMut.mutate({
      amount, paymentDate: payDate,
      modeName: mode?.name ?? 'Other',
      bankAccountName: bank ? `${bank.bankName} — ${bank.accountName}` : undefined,
      reference: payRef || undefined,
    });
  };

  if (isLoading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading…</div>;
  const inv = data;
  if (!inv) return <div className="flex items-center justify-center h-64 text-gray-400">Invoice not found.</div>;

  const modeOpts = s.paymentModes.map(m => ({ value: m.id, label: m.name }));
  const bankOpts = s.bankAccounts.map(b => ({ value: b.id, label: `${b.bankName} — ${b.accountName}` }));

  // Resolve the preset template the invoice was saved with so its accent
  // colour actually shows up — previously every invoice rendered with the
  // hardcoded blue tile/number regardless of templateId.
  const tplPreset = INVOICE_TEMPLATES.find(t => t.id === inv.templateId);
  const accent = tplPreset?.accentColor ?? '#2563eb';

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
          <ChevronLeft size={16} /> Back
        </button>
        <div className="flex gap-2">
          {inv.status === 'draft' && (
            <button onClick={() => patchMut.mutate({ status: 'sent' })}
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">Mark Sent</button>
          )}
          <button onClick={sendEmail}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">
            <Mail size={14} /> {emailSent ? 'Sent!' : 'Email Invoice'}
          </button>
          <button className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">
            <Download size={14} /> PDF
          </button>
          {inv.amountDue > 0 && (
            <button onClick={() => setShowPayForm(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
              <Plus size={14} /> Record Payment
            </button>
          )}
        </div>
      </div>

      {/* Invoice Card */}
      <div className="bg-white rounded-xl border border-gray-200 p-8">
        <div className="flex justify-between items-start mb-8">
          <div>
            <div
              className="w-14 h-14 rounded-xl flex items-center justify-center text-white font-bold text-xl mb-3"
              style={{ backgroundColor: accent }}
            >
              {inv.contactName?.[0] ?? '?'}
            </div>
            <div className="text-xl font-bold text-gray-900">INVOICE</div>
            <div className="text-3xl font-black mt-1" style={{ color: accent }}>{inv.number}</div>
          </div>
          <div className="text-right space-y-1">
            <div className="text-sm text-gray-500">Issue: <span className="text-gray-900 font-medium">{new Date(inv.issueDate).toLocaleDateString()}</span></div>
            <div className="text-sm text-gray-500">Due: <span className="text-gray-900 font-medium">{new Date(inv.dueDate).toLocaleDateString()}</span></div>
            {inv.poReference && <div className="text-sm text-gray-500">PO: <span className="text-gray-900 font-medium">{inv.poReference}</span></div>}
            <div className="mt-2">
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(inv.status)}`}>{inv.status}</span>
            </div>
          </div>
        </div>

        <div className="mb-8">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Billed To</div>
          <div className="font-semibold text-gray-900">{inv.contactName}</div>
          <div className="text-sm text-gray-500">{inv.contactCompany}</div>
          <div className="text-sm text-gray-500">{inv.contactEmail}</div>
          {inv.contactBillingAddress && (
            <div className="text-sm text-gray-500">{inv.contactBillingAddress.line1}, {inv.contactBillingAddress.city}, {inv.contactBillingAddress.country}</div>
          )}
        </div>

        <table className="w-full text-sm mb-6">
          <thead>
            <tr className="bg-gray-900 text-white">
              <th className="text-left px-4 py-2.5 rounded-l-lg text-xs">Description</th>
              <th className="text-center px-4 py-2.5 text-xs">Qty</th>
              <th className="text-right px-4 py-2.5 text-xs">Unit Price</th>
              <th className="text-right px-4 py-2.5 text-xs">Tax</th>
              <th className="text-right px-4 py-2.5 rounded-r-lg text-xs">Total</th>
            </tr>
          </thead>
          <tbody>
            {(inv.lineItems ?? []).map((li: any) => (
              <tr key={li.id} className="border-b border-gray-100">
                <td className="px-4 py-3 text-gray-800">{li.description}</td>
                <td className="px-4 py-3 text-center text-gray-600">{li.quantity}</td>
                <td className="px-4 py-3 text-right text-gray-600">{formatCurrency(li.unit_price ?? li.unitPrice, inv.currency)}</td>
                <td className="px-4 py-3 text-right text-gray-600">{formatCurrency(li.tax_amount ?? li.taxAmount, inv.currency)}</td>
                <td className="px-4 py-3 text-right font-medium text-gray-900">{formatCurrency(li.total, inv.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end">
          <div className="w-64 space-y-2 text-sm">
            <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{formatCurrency(inv.subtotal, inv.currency)}</span></div>
            <div className="flex justify-between text-gray-600"><span>Tax</span><span>{formatCurrency(inv.totalTax, inv.currency)}</span></div>
            <div className="flex justify-between font-bold text-gray-900 text-base border-t border-gray-200 pt-2">
              <span>Total</span><span>{formatCurrency(inv.total, inv.currency)}</span>
            </div>
            {inv.amountPaid > 0 && <div className="flex justify-between text-green-600"><span>Paid</span><span>-{formatCurrency(inv.amountPaid, inv.currency)}</span></div>}
            {inv.amountDue > 0 && (
              <div className="flex justify-between font-bold text-red-600 text-base border-t border-gray-200 pt-2">
                <span>Balance Due</span><span>{formatCurrency(inv.amountDue, inv.currency)}</span>
              </div>
            )}
          </div>
        </div>

        {inv.notes && <div className="mt-6 text-sm text-gray-500"><div className="font-semibold text-gray-700 mb-1">Notes</div><p>{inv.notes}</p></div>}
      </div>

      {/* Payment History */}
      {(inv.payments ?? []).length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100 text-sm font-semibold text-gray-900">Payment History</div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Date','Mode','Reference','Amount'].map(h => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(inv.payments ?? []).map((p: any) => (
                <tr key={p.id} className="border-b border-gray-50">
                  <td className="px-5 py-3 text-gray-700">{new Date(p.payment_date ?? p.paymentDate).toLocaleDateString()}</td>
                  <td className="px-5 py-3 text-gray-700">{p.mode_name ?? p.modeName}</td>
                  <td className="px-5 py-3 text-gray-400">{p.reference ?? '—'}</td>
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-1 text-green-600 font-medium">
                      <CheckCircle2 size={13} /> {formatCurrency(p.amount, inv.currency)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Record Payment Form */}
      {showPayForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm font-semibold text-gray-900 mb-4">Record Payment</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[
              { label: `Amount (max ${formatCurrency(inv.amountDue, inv.currency)})`, el: <input type="number" max={inv.amountDue} value={payAmount} onChange={e => setPayAmount(e.target.value)} placeholder="0.00" className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" /> },
              { label: 'Payment Date', el: <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" /> },
              { label: 'Payment Mode', el: <select value={payModeId} onChange={e => setPayModeId(e.target.value)} className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">{modeOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select> },
              ...(bankOpts.length > 0 ? [{ label: 'Bank Account', el: <select value={payBankId} onChange={e => setPayBankId(e.target.value)} className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">{bankOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select> }] : []),
              { label: 'Reference / TXN ID', el: <input value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="Optional" className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" /> },
            ].map(({ label, el }) => (
              <div key={label} className="flex flex-col gap-1"><label className="text-xs font-medium text-gray-700">{label}</label>{el}</div>
            ))}
          </div>
          <div className="flex gap-3 mt-4 justify-end">
            <button onClick={() => setShowPayForm(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">Cancel</button>
            <button onClick={recordPayment} disabled={paymentMut.isPending}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
              Record Payment
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
