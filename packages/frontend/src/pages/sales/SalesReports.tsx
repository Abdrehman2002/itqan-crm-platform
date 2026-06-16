import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';
import { formatCurrency, getStatusColor, type Invoice, type BillingContact } from './types';
import { Download, BarChart2, FileText, Users, Clock } from 'lucide-react';

type Tab = 'all' | 'pending' | 'customer' | 'aging';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'all',      label: 'All Invoices',    icon: <FileText size={14} /> },
  { id: 'pending',  label: 'Pending',         icon: <Clock size={14} /> },
  { id: 'customer', label: 'Customer-wise',   icon: <Users size={14} /> },
  { id: 'aging',    label: 'Receivable Aging',icon: <BarChart2 size={14} /> },
];

const PERIODS = [
  { value: 'this_month', label: 'This Month' }, { value: 'last_month', label: 'Last Month' },
  { value: 'this_quarter', label: 'This Quarter' }, { value: 'this_year', label: 'This Year' },
  { value: 'custom', label: 'Custom Range' },
];

const AGING_BUCKETS = [
  { label: 'Current',    filter: (d: string) => new Date(d) >= new Date() },
  { label: '1–30 days',  filter: (d: string) => { const days = Math.floor((Date.now()-new Date(d).getTime())/86400000); return days>=1&&days<=30; } },
  { label: '31–60 days', filter: (d: string) => { const days = Math.floor((Date.now()-new Date(d).getTime())/86400000); return days>=31&&days<=60; } },
  { label: '61–90 days', filter: (d: string) => { const days = Math.floor((Date.now()-new Date(d).getTime())/86400000); return days>=61&&days<=90; } },
  { label: '90+ days',   filter: (d: string) => Math.floor((Date.now()-new Date(d).getTime())/86400000) > 90 },
];

export function SalesReports() {
  const [tab, setTab] = useState<Tab>('all');
  const [period, setPeriod] = useState('this_month');
  const [contactFilter, setContactFilter] = useState('all');

  const { data: invoicesData } = useQuery({
    queryKey: ['sales-invoices-all'],
    queryFn: () => api.get('/api/v1/sales/invoices', { params: { pageSize: 200 } }).then(r => r.data.data ?? []),
  });
  const { data: contacts } = useQuery<BillingContact[]>({
    queryKey: ['billing-contacts'],
    queryFn: () => api.get('/api/v1/sales/billing-contacts').then(r => r.data.data ?? []),
  });

  const allInvoices: Invoice[] = invoicesData ?? [];
  const contactOpts = [{ value: 'all', label: 'All Customers' }, ...(contacts ?? []).map(c => ({ value: c.id, label: c.name }))];

  const filtered = allInvoices.filter(inv => {
    if (contactFilter !== 'all' && inv.billingContactId !== contactFilter) return false;
    if (tab === 'pending') return inv.status !== 'paid' && inv.status !== 'cancelled';
    return true;
  });

  const overdue = allInvoices.filter(inv => inv.status !== 'paid' && inv.status !== 'cancelled' && inv.amountDue > 0);

  const customerSummary = (contacts ?? []).map(c => {
    const cinvs = allInvoices.filter(inv => inv.billingContactId === c.id);
    return {
      contact: c,
      invoices: cinvs,
      total: cinvs.reduce((s,i) => s+i.total, 0),
      paid: cinvs.reduce((s,i) => s+i.amountPaid, 0),
      due: cinvs.reduce((s,i) => s+i.amountDue, 0),
    };
  }).filter(s => s.invoices.length > 0);

  const InvoiceTable = ({ rows }: { rows: Invoice[] }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-100">
          <tr>
            {['Invoice #','Client','Issue Date','Due Date','Total','Paid','Balance','Status'].map(h => (
              <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(inv => (
            <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50">
              <td className="px-5 py-3 font-medium text-blue-600">{inv.number}</td>
              <td className="px-5 py-3 text-gray-700">{inv.contactName}</td>
              <td className="px-5 py-3 text-gray-500">{new Date(inv.issueDate).toLocaleDateString()}</td>
              <td className="px-5 py-3 text-gray-500">{new Date(inv.dueDate).toLocaleDateString()}</td>
              <td className="px-5 py-3 font-medium text-gray-900">{formatCurrency(inv.total, inv.currency)}</td>
              <td className="px-5 py-3 text-green-600">{formatCurrency(inv.amountPaid, inv.currency)}</td>
              <td className="px-5 py-3 font-medium text-red-600">{formatCurrency(inv.amountDue, inv.currency)}</td>
              <td className="px-5 py-3"><span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(inv.status)}`}>{inv.status}</span></td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-gray-50 border-t border-gray-200">
          <tr>
            <td colSpan={4} className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Totals</td>
            <td className="px-5 py-3 font-bold text-gray-900">{formatCurrency(rows.reduce((s,i)=>s+i.total,0))}</td>
            <td className="px-5 py-3 font-bold text-green-600">{formatCurrency(rows.reduce((s,i)=>s+i.amountPaid,0))}</td>
            <td className="px-5 py-3 font-bold text-red-600">{formatCurrency(rows.reduce((s,i)=>s+i.amountDue,0))}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${tab===t.id ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
        <select value={period} onChange={e => setPeriod(e.target.value)}
          className="w-40 text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          {PERIODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        {(tab === 'all' || tab === 'pending') && (
          <select value={contactFilter} onChange={e => setContactFilter(e.target.value)}
            className="w-44 text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            {contactOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        <button className="ml-auto flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">
          <Download size={14} /> Export CSV
        </button>
      </div>

      {(tab === 'all' || tab === 'pending') && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center">
            <div className="text-sm font-semibold text-gray-900">{tab === 'all' ? 'All Invoices' : 'Pending Invoices'}</div>
            <div className="text-sm text-gray-500">{filtered.length} invoices — Due: {formatCurrency(filtered.reduce((s,i)=>s+i.amountDue,0))}</div>
          </div>
          <InvoiceTable rows={filtered} />
        </div>
      )}

      {tab === 'customer' && (
        <div className="space-y-4">
          {customerSummary.map(({ contact, invoices: cinvs, total, paid, due }) => (
            <div key={contact.id} className="bg-white rounded-xl border border-gray-200">
              <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center">
                <div>
                  <div className="text-sm font-semibold text-gray-900">{contact.name}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{contact.email} · {cinvs.length} invoice{cinvs.length!==1?'s':''}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-gray-900">{formatCurrency(total, contact.currency)}</div>
                  <div className="text-xs text-green-600">{formatCurrency(paid, contact.currency)} paid</div>
                  {due > 0 && <div className="text-xs text-red-600">{formatCurrency(due, contact.currency)} due</div>}
                </div>
              </div>
              <InvoiceTable rows={cinvs} />
            </div>
          ))}
          {customerSummary.length === 0 && <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">No customer data yet.</div>}
        </div>
      )}

      {tab === 'aging' && (
        <div className="space-y-4">
          {AGING_BUCKETS.map(bucket => {
            const rows = overdue.filter(inv => bucket.filter(inv.dueDate));
            const total = rows.reduce((s,i) => s+i.amountDue, 0);
            return (
              <div key={bucket.label} className="bg-white rounded-xl border border-gray-200">
                <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center">
                  <div className="text-sm font-semibold text-gray-900">{bucket.label}</div>
                  <div className="text-sm font-bold text-gray-900">{formatCurrency(total)} — {rows.length} invoice{rows.length!==1?'s':''}</div>
                </div>
                {rows.length > 0 ? <InvoiceTable rows={rows} /> : (
                  <div className="px-5 py-6 text-center text-sm text-gray-400">No invoices in this bucket.</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
