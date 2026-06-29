import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { formatCurrency, DEFAULT_SETTINGS, type SalesSettings, type BankAccount, type PaymentModeConfig, type PaymentMode } from './types';
import { Plus, Trash2, X, Building2, CreditCard, CheckCircle2 } from 'lucide-react';
import { v4 as uuid } from 'uuid';

const MODE_TYPES: { value: PaymentMode; label: string }[] = [
  { value: 'bank_transfer', label: 'Bank Transfer' }, { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' }, { value: 'card', label: 'Credit / Debit Card' },
  { value: 'upi', label: 'UPI / Digital Wallet' }, { value: 'custom', label: 'Custom' },
];

export function SalesPayments() {
  const qc = useQueryClient();
  const [showBankForm, setShowBankForm] = useState(false);
  const [showModeForm, setShowModeForm] = useState(false);
  const [newBank, setNewBank] = useState<Partial<BankAccount>>({ isDefault: false });
  const [newMode, setNewMode] = useState<Partial<PaymentModeConfig>>({ type: 'bank_transfer' });

  const { data: settings } = useQuery<SalesSettings>({
    queryKey: ['sales-settings'],
    queryFn: () => api.get('/api/v1/sales/settings').then(r => r.data.data ?? DEFAULT_SETTINGS),
  });
  const { data: allPayments } = useQuery<any[]>({
    queryKey: ['all-payments'],
    queryFn: () => api.get('/api/v1/sales/invoices', { params: { pageSize: 100 } }).then(r =>
      (r.data.data ?? []).flatMap((inv: any) =>
        (inv.payments ?? []).map((p: any) => ({ ...p, invoiceNumber: inv.number, contactName: inv.contact_name, currency: inv.currency }))
      ).sort((a: any, b: any) => b.payment_date?.localeCompare(a.payment_date))
    ),
  });

  const s = settings ?? DEFAULT_SETTINGS;

  const saveMut = useMutation({
    mutationFn: (body: Partial<SalesSettings>) => api.put('/api/v1/sales/settings', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales-settings'] }),
  });

  const saveBank = () => {
    if (!newBank.bankName || !newBank.accountName || !newBank.accountNumber) return;
    const bank: BankAccount = { id: uuid(), bankName: newBank.bankName!, accountName: newBank.accountName!, accountNumber: newBank.accountNumber!, swift: newBank.swift, iban: newBank.iban, isDefault: newBank.isDefault ?? false };
    saveMut.mutate({ bankAccounts: [...s.bankAccounts, bank] });
    setNewBank({ isDefault: false }); setShowBankForm(false);
  };

  const removeBank = (id: string) => saveMut.mutate({ bankAccounts: s.bankAccounts.filter(b => b.id !== id) });

  const saveMode = () => {
    if (!newMode.name) return;
    const mode: PaymentModeConfig = { id: uuid(), name: newMode.name!, type: newMode.type ?? 'custom', details: newMode.details };
    saveMut.mutate({ paymentModes: [...s.paymentModes, mode] });
    setNewMode({ type: 'bank_transfer' }); setShowModeForm(false);
  };

  const removeMode = (id: string) => saveMut.mutate({ paymentModes: s.paymentModes.filter(m => m.id !== id) });

  return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Bank Accounts */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="text-sm font-semibold text-gray-900">Bank Accounts</div>
            <button onClick={() => { setShowBankForm(!showBankForm); setShowModeForm(false); }}
              className="flex items-center gap-1 text-sm border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50 text-gray-700">
              <Plus size={13} /> Add Bank
            </button>
          </div>
          <div className="p-5 space-y-3">
            {s.bankAccounts.map(b => (
              <div key={b.id} className="flex items-start gap-3 p-3 border border-gray-100 rounded-lg">
                <div className="p-2 bg-blue-50 rounded-lg"><Building2 size={16} className="text-blue-600" /></div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-gray-900">{b.bankName}</div>
                  <div className="text-xs text-gray-500">{b.accountName}</div>
                  <div className="text-xs text-gray-400 font-mono">{b.accountNumber}</div>
                  {b.iban && <div className="text-xs text-gray-400">IBAN: {b.iban}</div>}
                  {b.swift && <div className="text-xs text-gray-400">SWIFT: {b.swift}</div>}
                </div>
                <div className="flex items-center gap-2">
                  {b.isDefault && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">Default</span>}
                  <button onClick={() => removeBank(b.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
            {showBankForm && (
              <div className="border border-blue-200 rounded-lg p-4 space-y-3 bg-blue-50/30">
                <div className="flex justify-between items-center">
                  <div className="text-sm font-semibold text-gray-700">New Bank Account</div>
                  <button onClick={() => setShowBankForm(false)}><X size={14} className="text-gray-400" /></button>
                </div>
                {[['Bank Name','bankName','e.g. HBL, Meezan, UBL'],['Account Title','accountName',''],['Account Number','accountNumber',''],['IBAN','iban','PK00 XXXX 0000 0000 0000 0000'],['SWIFT / BIC','swift','Optional']].map(([label, field, placeholder]) => (
                  <div key={field} className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-gray-700">{label}</label>
                    <input placeholder={placeholder} value={(newBank as any)[field] ?? ''} onChange={e => setNewBank({ ...newBank, [field]: e.target.value })}
                      className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                  </div>
                ))}
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={newBank.isDefault ?? false} onChange={e => setNewBank({ ...newBank, isDefault: e.target.checked })} className="rounded" />
                  Set as default
                </label>
                <div className="flex gap-2">
                  <button onClick={() => setShowBankForm(false)} className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">Cancel</button>
                  <button onClick={saveBank} className="px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">Save Bank</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Payment Modes */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="text-sm font-semibold text-gray-900">Payment Modes</div>
            <button onClick={() => { setShowModeForm(!showModeForm); setShowBankForm(false); }}
              className="flex items-center gap-1 text-sm border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50 text-gray-700">
              <Plus size={13} /> Add Mode
            </button>
          </div>
          <div className="p-5 space-y-2">
            {s.paymentModes.map(m => (
              <div key={m.id} className="flex items-center gap-3 p-2.5 border border-gray-100 rounded-lg hover:bg-gray-50">
                <CreditCard size={15} className="text-gray-400" />
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-800">{m.name}</div>
                  <div className="text-xs text-gray-400">{m.type.replace('_', ' ')}</div>
                </div>
                <button onClick={() => removeMode(m.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={13} /></button>
              </div>
            ))}
            {showModeForm && (
              <div className="border border-blue-200 rounded-lg p-4 space-y-3 bg-blue-50/30">
                <div className="flex justify-between items-center">
                  <div className="text-sm font-semibold text-gray-700">New Payment Mode</div>
                  <button onClick={() => setShowModeForm(false)}><X size={14} className="text-gray-400" /></button>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-700">Mode Name</label>
                  <input placeholder="e.g. HDFC Transfer" value={newMode.name ?? ''} onChange={e => setNewMode({ ...newMode, name: e.target.value })}
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-700">Type</label>
                  <select value={newMode.type} onChange={e => setNewMode({ ...newMode, type: e.target.value as PaymentMode })}
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500">
                    {MODE_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowModeForm(false)} className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">Cancel</button>
                  <button onClick={saveMode} className="px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">Save Mode</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Payments Ledger */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100 text-sm font-semibold text-gray-900">All Payments Received</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Date','Invoice','Client','Mode','Reference','Amount'].map(h => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(allPayments ?? []).length === 0 && <tr><td colSpan={6} className="px-5 py-12 text-center text-gray-400">No payments recorded yet.</td></tr>}
              {(allPayments ?? []).map((p: any) => (
                <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-5 py-3 text-gray-700">{new Date(p.payment_date).toLocaleDateString()}</td>
                  <td className="px-5 py-3 font-medium text-blue-600">{p.invoiceNumber}</td>
                  <td className="px-5 py-3 text-gray-700">{p.contactName}</td>
                  <td className="px-5 py-3 text-gray-600">{p.mode_name}</td>
                  <td className="px-5 py-3 text-gray-400">{p.reference ?? '—'}</td>
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-1 text-green-600 font-medium">
                      <CheckCircle2 size={13} /> {formatCurrency(p.amount, p.currency)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
