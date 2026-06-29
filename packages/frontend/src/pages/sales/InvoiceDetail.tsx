import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { formatCurrency, getInvoiceLayout, DEFAULT_SETTINGS, type Invoice, type SalesSettings } from './types';
import { InvoiceLayoutView } from './InvoiceLayouts';
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

  // Resolve the preset template the invoice was saved with — pick both the
  // accent colour AND the visual layout (classic / minimal / consulting). The
  // SWEEP-3 fix used to only apply accentColor; now layout swaps too.
  const { layout, accentColor: accent } = getInvoiceLayout(inv.templateId);

  const downloadPdf = () => {
    const apiBase = (import.meta as any).env?.VITE_API_URL || '';
    window.open(`${apiBase}/api/v1/sales/invoices/${inv.id}/pdf`, '_blank');
  };

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
          <button onClick={downloadPdf}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">
            <Download size={14} /> Export as PDF
          </button>
          {inv.amountDue > 0 && (
            <button onClick={() => setShowPayForm(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
              <Plus size={14} /> Record Payment
            </button>
          )}
        </div>
      </div>

      {/* Invoice Card — layout swaps based on the saved template (classic / minimal / consulting) */}
      <InvoiceLayoutView layout={layout} inv={inv} accent={accent} settings={s} />

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
