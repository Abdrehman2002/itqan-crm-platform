import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import { formatCurrency, getStatusColor, type DashboardStats, type InvoiceStatus } from './types';
import { TrendingUp, Clock, AlertCircle, FileText } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';

const PERIOD_OPTIONS = [
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'this_quarter', label: 'This Quarter' },
  { value: 'this_year', label: 'This Year' },
];
const PIE_COLORS = ['#3b82f6','#f59e0b','#ef4444','#10b981','#6366f1'];

export function SalesDashboard() {
  const [period, setPeriod] = useState('this_month');

  const { data, isLoading } = useQuery<DashboardStats>({
    queryKey: ['sales-dashboard', period],
    queryFn: () => api.get('/api/v1/sales/dashboard', { params: { period } }).then(r => r.data.data),
  });

  const { data: recentInvoices } = useQuery<any[]>({
    queryKey: ['sales-invoices-recent'],
    queryFn: () => api.get('/api/v1/sales/invoices', { params: { pageSize: 5 } }).then(r => r.data.data),
  });

  if (isLoading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading dashboard…</div>;

  const stats = data ?? {
    totalReceivable: 0, overdueAmount: 0, paidThisMonth: 0, draftAmount: 0,
    invoicesByStatus: {} as any, agingBuckets: [], topCustomers: [], topDefaulters: [], monthlyRevenue: [],
  };

  const pieData = Object.entries(stats.invoicesByStatus ?? {}).filter(([,v]) => Number(v) > 0).map(([k,v]) => ({ name: k, value: Number(v) }));

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Sales Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">Invoice & receivables overview</p>
        </div>
        <div className="flex gap-3 items-center">
          <select value={period} onChange={e => setPeriod(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            {PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <Link to="/sales/invoices/new"
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
            + New Invoice
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: <FileText size={18} className="text-blue-600" />, bg: 'bg-blue-50', label: 'Total Receivable', value: formatCurrency(stats.totalReceivable), sub: 'All open invoices' },
          { icon: <AlertCircle size={18} className="text-red-600" />, bg: 'bg-red-50', label: 'Overdue', value: formatCurrency(stats.overdueAmount), sub: 'Past due date' },
          { icon: <TrendingUp size={18} className="text-green-600" />, bg: 'bg-green-50', label: 'Collected This Month', value: formatCurrency(stats.paidThisMonth), sub: 'Payments received' },
          { icon: <Clock size={18} className="text-amber-600" />, bg: 'bg-amber-50', label: 'Draft', value: formatCurrency(stats.draftAmount), sub: 'Not yet sent' },
        ].map(card => (
          <div key={card.label} className="bg-white rounded-xl border border-gray-200 p-5 flex items-start gap-4">
            <div className={`p-2.5 rounded-lg ${card.bg}`}>{card.icon}</div>
            <div>
              <div className="text-xs text-gray-500">{card.label}</div>
              <div className="text-lg font-bold text-gray-900 mt-0.5">{card.value}</div>
              <div className="text-xs text-gray-400 mt-0.5">{card.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm font-semibold text-gray-900 mb-4">Monthly Revenue vs Collections</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={stats.monthlyRevenue} barGap={4}>
              <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${(Number(v)/1000).toFixed(0)}k`} />
              <Tooltip formatter={(v) => formatCurrency(Number(v))} />
              <Bar dataKey="invoiced"  fill="#bfdbfe" name="Invoiced"   radius={[4,4,0,0]} />
              <Bar dataKey="collected" fill="#2563eb" name="Collected"  radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm font-semibold text-gray-900 mb-2">Invoice Status</div>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} dataKey="value" nameKey="name">
                {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Legend iconSize={10} iconType="circle" />
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Aging + Top Customers + Top Defaulters */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm font-semibold text-gray-900 mb-4">Receivable Aging</div>
          <div className="space-y-3">
            {stats.agingBuckets.map(b => (
              <div key={b.label}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-600">{b.label}</span>
                  <span className="font-medium text-gray-900">{formatCurrency(b.amount)}</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full"
                    style={{ width: `${stats.totalReceivable ? (b.amount / stats.totalReceivable) * 100 : 0}%` }} />
                </div>
                <div className="text-xs text-gray-400 mt-0.5">{b.count} invoice{b.count !== 1 ? 's' : ''}</div>
              </div>
            ))}
            {stats.agingBuckets.length === 0 && <div className="text-xs text-gray-400 text-center py-4">No open invoices</div>}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm font-semibold text-gray-900 mb-4">Top Customers</div>
          <div className="space-y-3">
            {stats.topCustomers.map((c, i) => (
              <div key={c.contactId} className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold flex items-center justify-center shrink-0">{i+1}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">{c.name}</div>
                  <div className="text-xs text-gray-400">{c.invoiceCount} invoice{c.invoiceCount !== 1 ? 's' : ''}</div>
                </div>
                <div className="text-sm font-semibold text-gray-900 shrink-0">{formatCurrency(c.amount)}</div>
              </div>
            ))}
            {stats.topCustomers.length === 0 && <div className="text-xs text-gray-400 text-center py-4">No data yet</div>}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm font-semibold text-gray-900 mb-4">Top Defaulters</div>
          <div className="space-y-3">
            {stats.topDefaulters.map((c, i) => (
              <div key={c.contactId} className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-red-100 text-red-700 text-xs font-semibold flex items-center justify-center shrink-0">{i+1}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">{c.name}</div>
                  <div className="text-xs text-gray-400">{c.invoiceCount} invoice{c.invoiceCount !== 1 ? 's' : ''}</div>
                </div>
                <div className="text-sm font-semibold text-red-600 shrink-0">{formatCurrency(c.amount)}</div>
              </div>
            ))}
            {stats.topDefaulters.length === 0 && <div className="text-xs text-gray-400 text-center py-4">No defaulters</div>}
          </div>
        </div>
      </div>

      {/* Recent Invoices */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center">
          <div className="text-sm font-semibold text-gray-900">Recent Invoices</div>
          <Link to="/sales/invoices" className="text-xs text-blue-600 hover:underline">View all</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Invoice #','Client','Due Date','Amount','Status'].map(h => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(recentInvoices ?? []).map((inv: any) => (
                <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-5 py-3">
                    <Link to={`/sales/invoices/${inv.id}`} className="font-medium text-blue-600 hover:underline">{inv.number}</Link>
                  </td>
                  <td className="px-5 py-3 text-gray-700">{inv.contact_name}</td>
                  <td className="px-5 py-3 text-gray-500">{new Date(inv.due_date).toLocaleDateString()}</td>
                  <td className="px-5 py-3 font-medium text-gray-900">{formatCurrency(inv.total, inv.currency)}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(inv.status)}`}>
                      {inv.status}
                    </span>
                  </td>
                </tr>
              ))}
              {!recentInvoices?.length && (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-gray-400 text-sm">No invoices yet. <Link to="/sales/invoices/new" className="text-blue-600">Create your first invoice</Link></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
