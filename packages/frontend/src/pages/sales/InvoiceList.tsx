import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import { formatCurrency, getStatusColor, type Invoice, type InvoiceStatus } from './types';
import { Plus, Download, Mail, MoreVertical, Eye, Trash2, Edit } from 'lucide-react';

const STATUS_FILTER = [
  { value: '', label: 'All Statuses' },
  { value: 'draft', label: 'Draft' }, { value: 'sent', label: 'Sent' },
  { value: 'partial', label: 'Partial' }, { value: 'paid', label: 'Paid' },
  { value: 'overdue', label: 'Overdue' }, { value: 'cancelled', label: 'Cancelled' },
];

export function InvoiceList() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['sales-invoices', search, status],
    queryFn: () => api.get('/api/v1/sales/invoices', { params: { search: search || undefined, status: status || undefined, pageSize: 50 } }).then(r => r.data),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/sales/invoices/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales-invoices'] }),
  });

  const invoices: Invoice[] = data?.data ?? [];

  return (
    <div className="p-6">
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search invoices…"
          className="sm:w-64 text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <select value={status} onChange={e => setStatus(e.target.value)}
          className="sm:w-44 text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          {STATUS_FILTER.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div className="flex gap-2 ml-auto">
          <button className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">
            <Download size={14} /> Export
          </button>
          <Link to="/sales/invoices/new"
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
            <Plus size={14} /> New Invoice
          </Link>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {['Invoice #','Client','Issue Date','Due Date','Total','Balance Due','Status',''].map(h => (
                <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={8} className="px-5 py-12 text-center text-gray-400">Loading…</td></tr>
            )}
            {!isLoading && invoices.length === 0 && (
              <tr><td colSpan={8} className="px-5 py-12 text-center text-gray-400">
                No invoices found. <Link to="/sales/invoices/new" className="text-blue-600 hover:underline">Create one</Link>
              </td></tr>
            )}
            {invoices.map(inv => (
              <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                <td className="px-5 py-3">
                  <Link to={`/sales/invoices/${inv.id}`} className="font-medium text-blue-600 hover:underline">{inv.number}</Link>
                </td>
                <td className="px-5 py-3 text-gray-700">{inv.contactName}</td>
                <td className="px-5 py-3 text-gray-500">{new Date(inv.issueDate).toLocaleDateString()}</td>
                <td className="px-5 py-3 text-gray-500">{new Date(inv.dueDate).toLocaleDateString()}</td>
                <td className="px-5 py-3 font-medium text-gray-900">{formatCurrency(inv.total, inv.currency)}</td>
                <td className="px-5 py-3 font-medium text-red-600">{formatCurrency(inv.amountDue, inv.currency)}</td>
                <td className="px-5 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(inv.status)}`}>
                    {inv.status}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <div className="relative flex justify-end">
                    <button onClick={() => setOpenMenu(openMenu === inv.id ? null : inv.id)}
                      className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-700">
                      <MoreVertical size={15} />
                    </button>
                    {openMenu === inv.id && (
                      <div className="absolute right-0 top-7 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1 w-40" onClick={() => setOpenMenu(null)}>
                        <Link to={`/sales/invoices/${inv.id}`} className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"><Eye size={14} /> View</Link>
                        <button className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 w-full"><Mail size={14} /> Email</button>
                        <button onClick={() => deleteMut.mutate(inv.id)}
                          className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 w-full"><Trash2 size={14} /> Delete</button>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
