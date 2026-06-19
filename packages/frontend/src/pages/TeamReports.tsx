import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid,
} from 'recharts';
import {
  Users, ChevronDown, Download, FileSpreadsheet,
  FileText, Calendar, BarChart3, Activity, TrendingUp,
} from 'lucide-react';
import { api } from '../services/api';

// ── Period helpers ────────────────────────────────────────────────────────────

const PERIODS = [
  { value: '7d',     label: 'Last 7 days' },
  { value: '30d',    label: 'Last 30 days' },
  { value: '90d',    label: 'Last 90 days' },
  { value: 'ytd',    label: 'Year to date' },
  { value: 'custom', label: 'Custom range…' },
];

// ── Report catalogue (scaffold for future reports) ────────────────────────────

const REPORT_CATALOGUE = [
  {
    id:    'team-activity',
    label: 'Team Activity Report',
    desc:  'Activities, tasks and call logs across your reporting line',
    icon:  Activity,
    ready: true,
  },
  {
    id:    'pipeline',
    label: 'Pipeline Performance',
    desc:  'Deals created, won, lost and revenue per team member',
    icon:  TrendingUp,
    ready: false,
  },
  {
    id:    'contacts',
    label: 'Contact Acquisition',
    desc:  'New contacts and companies created over the period',
    icon:  Users,
    ready: false,
  },
  {
    id:    'tickets',
    label: 'Ticket Handling',
    desc:  'Ticket volume, SLA compliance and resolution rates',
    icon:  BarChart3,
    ready: false,
  },
];

// ── Small components ──────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color = 'text-gray-900' }: {
  label: string; value: any; sub?: string; color?: string;
}) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value ?? '—'}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Download helpers ──────────────────────────────────────────────────────────

function buildExportParams(period: string, from: string, to: string, reporteeId: string) {
  const p: Record<string, string> = { period };
  if (period === 'custom') { p.from = from; p.to = to; }
  if (reporteeId) p.reporteeId = reporteeId;
  return new URLSearchParams(p).toString();
}

async function downloadCSV(qs: string) {
  const res = await fetch(`/api/v1/analytics/team-export?${qs}&format=csv`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('crm-auth') ? JSON.parse(sessionStorage.getItem('crm-auth') || '{}')?.state?.token ?? '' : ''}` },
  });
  // Get token from zustand sessionStorage
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'team-report.csv'; a.click();
  URL.revokeObjectURL(url);
}

async function downloadJSON(qs: string): Promise<any[]> {
  const res = await api.get(`/api/v1/analytics/team-export?${qs}&format=json`);
  return res.data?.data ?? [];
}

function arrayToCSV(rows: any[]): string {
  if (!rows.length) return '';
  const hdrs = Object.keys(rows[0]);
  const esc  = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [hdrs.map(esc).join(','), ...rows.map(r => hdrs.map(h => esc(r[h])).join(','))].join('\n');
}

async function triggerDownload(format: string, qs: string) {
  if (format === 'csv') {
    // Use fetch with auth header from sessionStorage
    const stored = sessionStorage.getItem('crm-auth');
    const token  = stored ? JSON.parse(stored)?.state?.token ?? '' : '';
    const res    = await fetch(`/api/v1/analytics/team-export?${qs}&format=csv`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: 'team-report.csv' });
    a.click(); URL.revokeObjectURL(url);
    return;
  }

  // For Excel/PDF/Word we fetch JSON data and use browser-side generation
  const rows = await downloadJSON(qs);
  if (!rows.length) return;

  if (format === 'excel') {
    // Build a minimal HTML table and wrap as .xls (opens in Excel)
    const hdrs = Object.keys(rows[0]);
    const hRow = hdrs.map(h => `<th>${h}</th>`).join('');
    const body = rows.map(r => `<tr>${hdrs.map(h => `<td>${r[h] ?? ''}</td>`).join('')}</tr>`).join('');
    const html = `<html><head><meta charset="UTF-8"></head><body><table><thead><tr>${hRow}</tr></thead><tbody>${body}</tbody></table></body></html>`;
    const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
    const url  = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href: url, download: 'team-report.xls' }).click();
    URL.revokeObjectURL(url);
    return;
  }

  if (format === 'pdf') {
    // Open a print-optimised window — browser prints to PDF
    const hdrs = Object.keys(rows[0]);
    const hRow = hdrs.map(h => `<th style="border:1px solid #ccc;padding:6px 10px;background:#f3f4f6;font-size:11px">${h}</th>`).join('');
    const body = rows.map(r =>
      `<tr>${hdrs.map(h => `<td style="border:1px solid #eee;padding:6px 10px;font-size:11px">${r[h] ?? ''}</td>`).join('')}</tr>`,
    ).join('');
    const html = `<!DOCTYPE html><html><head><title>Team Report</title>
      <style>body{font-family:Arial,sans-serif;padding:20px}h1{font-size:16px}table{border-collapse:collapse;width:100%}
      @media print{.no-print{display:none}}</style></head>
      <body><h1>Team Report</h1><p style="color:#666;font-size:12px">Generated ${new Date().toLocaleString()}</p>
      <button class="no-print" onclick="window.print()" style="margin-bottom:12px;padding:6px 14px;cursor:pointer">Print / Save as PDF</button>
      <table><thead><tr>${hRow}</tr></thead><tbody>${body}</tbody></table></body></html>`;
    const w = window.open('', '_blank');
    w?.document.write(html); w?.document.close();
    return;
  }

  if (format === 'word') {
    // Minimal Word-compatible HTML (.doc)
    const hdrs = Object.keys(rows[0]);
    const hRow = hdrs.map(h => `<th>${h}</th>`).join('');
    const body = rows.map(r => `<tr>${hdrs.map(h => `<td>${r[h] ?? ''}</td>`).join('')}</tr>`).join('');
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
      <head><meta charset="UTF-8"><title>Team Report</title></head>
      <body><h1>Team Report</h1><p>Generated ${new Date().toLocaleString()}</p>
      <table border="1" cellspacing="0" cellpadding="4"><thead><tr>${hRow}</tr></thead><tbody>${body}</tbody></table></body></html>`;
    const blob = new Blob([html], { type: 'application/msword' });
    Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'team-report.doc' }).click();
  }
}

// ── Download menu ─────────────────────────────────────────────────────────────

function DownloadMenu({ qs }: { qs: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const options = [
    { fmt: 'csv',   icon: FileText,        label: 'CSV' },
    { fmt: 'excel', icon: FileSpreadsheet, label: 'Excel (.xls)' },
    { fmt: 'pdf',   icon: FileText,        label: 'PDF (print)' },
    { fmt: 'word',  icon: FileText,        label: 'Word (.doc)' },
  ];

  const handle = async (fmt: string) => {
    setOpen(false); setBusy(true);
    try { await triggerDownload(fmt, qs); } finally { setBusy(false); }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        disabled={busy}
        className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 disabled:opacity-50"
      >
        <Download className="w-3.5 h-3.5 text-gray-500" />
        <span className="text-gray-700">{busy ? 'Preparing…' : 'Export'}</span>
        <ChevronDown className="w-3 h-3 text-gray-400" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white border border-gray-100 rounded-xl shadow-lg z-20 py-1 min-w-[150px]">
          {options.map(({ fmt, icon: Icon, label }) => (
            <button key={fmt} onClick={() => handle(fmt)}
              className="flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
              <Icon className="w-3.5 h-3.5 text-gray-400" />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function TeamReports() {
  const [activeReport, setActiveReport] = useState('team-activity');
  const [period,       setPeriod]       = useState('30d');
  const [customFrom,   setCustomFrom]   = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10);
  });
  const [customTo,     setCustomTo]     = useState(() => new Date().toISOString().slice(0, 10));
  const [reporteeId,   setReporteeId]   = useState('');

  const qs = buildExportParams(period, customFrom, customTo, reporteeId);

  const { data: reportees = [] } = useQuery<any[]>({
    queryKey: ['team-reportees'],
    queryFn: () => api.get('/api/v1/analytics/team-reportees').then((r: any) => r.data.data ?? []),
  });

  const queryParams: Record<string, string> = { period };
  if (period === 'custom') { queryParams.from = customFrom; queryParams.to = customTo; }
  if (reporteeId) queryParams.reporteeId = reporteeId;

  const { data, isLoading, error } = useQuery<any>({
    queryKey: ['team-summary', period, customFrom, customTo, reporteeId],
    queryFn: () => api.get('/api/v1/analytics/team-summary', { params: queryParams })
      .then((r: any) => r.data.data),
    retry: false,
  });

  const stats: any[] = data?.stats ?? [];
  const trend: any[] = (data?.trend ?? []).map((r: any) => ({
    day:   new Date(r.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    count: Number(r.count),
  }));

  const totals = stats.reduce((acc, u) => ({
    contacts:   acc.contacts   + Number(u.contacts_created ?? 0),
    deals:      acc.deals      + Number(u.deals_created    ?? 0),
    deals_won:  acc.deals_won  + Number(u.deals_won        ?? 0),
    revenue:    acc.revenue    + Number(u.revenue          ?? 0),
    activities: acc.activities + Number(u.activities_total ?? 0),
    done:       acc.done       + Number(u.activities_done  ?? 0),
    overdue:    acc.overdue    + Number(u.overdue          ?? 0),
  }), { contacts: 0, deals: 0, deals_won: 0, revenue: 0, activities: 0, done: 0, overdue: 0 });

  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  const fmtCurrency = (n: number) =>
    n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000 ? `$${(n / 1000).toFixed(1)}k`
    : `$${n.toFixed(0)}`;

  const noAccess = (error as any)?.response?.status === 403;

  return (
    <div className="flex h-full">
      {/* ── Left sidebar: report catalogue ─────────────────────────────── */}
      <div className="w-56 shrink-0 border-r border-gray-100 bg-white flex flex-col">
        <div className="px-4 py-4 border-b border-gray-50">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Reports</p>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {REPORT_CATALOGUE.map(({ id, label, icon: Icon, ready }) => (
            <button
              key={id}
              onClick={() => ready && setActiveReport(id)}
              className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-sm transition-colors ${
                activeReport === id
                  ? 'bg-brand-50 text-brand-700 font-semibold border-r-2 border-brand-500'
                  : ready
                    ? 'text-gray-600 hover:bg-gray-50'
                    : 'text-gray-300 cursor-default'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{label}</span>
              {!ready && (
                <span className="ml-auto text-[10px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full">Soon</span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* ── Main content ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-5 max-w-5xl">
          {/* Header + filters */}
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-xl font-bold text-gray-900">Team Activity Report</h1>
              <p className="text-sm text-gray-400 mt-0.5">Consolidated view across your full reporting line</p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Member filter */}
              <div className="relative">
                <select value={reporteeId} onChange={e => setReporteeId(e.target.value)}
                  className="pl-3 pr-8 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400 bg-white appearance-none">
                  <option value="">All team members</option>
                  {reportees.map((r: any) => (
                    <option key={r.id} value={r.id}>
                      {r.name}{r.manager_name ? ` (reports to ${r.manager_name})` : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              </div>

              {/* Period filter */}
              <div className="relative">
                <select value={period} onChange={e => setPeriod(e.target.value)}
                  className="pl-3 pr-8 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-brand-400 bg-white appearance-none">
                  {PERIODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              </div>

              {/* Custom date range */}
              {period === 'custom' && (
                <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-xl px-3 py-1.5">
                  <Calendar className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                    className="text-sm outline-none bg-transparent" />
                  <span className="text-gray-300">–</span>
                  <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                    className="text-sm outline-none bg-transparent" />
                </div>
              )}

              <DownloadMenu qs={qs} />
            </div>
          </div>

          {/* No reportees — still shows own data */}

          {isLoading && (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Loading…</div>
          )}

          {!isLoading && !noAccess && data && (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Contacts Created" value={fmt(totals.contacts)} />
                <StatCard label="Deals Won" value={fmt(totals.deals_won)}
                  sub={`of ${fmt(totals.deals)} created`} color="text-green-600" />
                <StatCard label="Revenue" value={fmtCurrency(totals.revenue)} color="text-brand-600" />
                <StatCard label="Activities" value={fmt(totals.activities)}
                  sub={`${fmt(totals.done)} completed · ${fmt(totals.overdue)} overdue`}
                  color={totals.overdue > 0 ? 'text-orange-600' : 'text-gray-900'} />
              </div>

              {/* Activity trend */}
              {trend.length > 0 && (
                <div className="bg-white border border-gray-100 rounded-xl p-5">
                  <h2 className="text-sm font-semibold text-gray-700 mb-4">Activity Trend</h2>
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={trend} margin={{ top: 0, right: 8, bottom: 0, left: -20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                      <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Line type="monotone" dataKey="count" stroke="#29ABE2" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Per-member table */}
              {stats.length > 0 && (
                <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-50 flex items-center gap-2">
                    <Users className="w-4 h-4 text-gray-400" />
                    <h2 className="text-sm font-semibold text-gray-700">Per Member Breakdown</h2>
                    <span className="ml-auto text-xs text-gray-400">{stats.length} member{stats.length !== 1 ? 's' : ''}</span>
                  </div>

                  {/* Bar chart */}
                  <div className="px-5 py-4 border-b border-gray-50">
                    <ResponsiveContainer width="100%" height={150}>
                      <BarChart
                        data={stats.map(u => ({
                          name:       u.name.split(' ')[0],
                          activities: Number(u.activities_total ?? 0),
                          done:       Number(u.activities_done ?? 0),
                        }))}
                        margin={{ top: 0, right: 8, bottom: 0, left: -20 }}
                      >
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip />
                        <Bar dataKey="activities" name="Total"     fill="#e2e8f0" radius={[4,4,0,0]} />
                        <Bar dataKey="done"        name="Completed" fill="#29ABE2" radius={[4,4,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-50">
                          <th className="text-left px-5 py-3 text-xs font-medium text-gray-400">Member</th>
                          <th className="text-left px-4 py-3 text-xs font-medium text-gray-400">Reports To</th>
                          <th className="text-right px-4 py-3 text-xs font-medium text-gray-400">Contacts</th>
                          <th className="text-right px-4 py-3 text-xs font-medium text-gray-400">Deals</th>
                          <th className="text-right px-4 py-3 text-xs font-medium text-gray-400">Revenue</th>
                          <th className="text-right px-4 py-3 text-xs font-medium text-gray-400">Activities</th>
                          <th className="text-right px-4 py-3 text-xs font-medium text-gray-400">Done</th>
                          <th className="text-right px-4 py-3 text-xs font-medium text-gray-400">Overdue</th>
                          <th className="text-right px-5 py-3 text-xs font-medium text-gray-400">Tickets</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.map((u: any) => (
                          <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2">
                                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-400 to-purple-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                                  {u.name?.split(' ').map((n: string) => n[0]).join('').slice(0,2).toUpperCase()}
                                </div>
                                <div>
                                  <p className="font-medium text-gray-900 text-xs">{u.name}</p>
                                  {u.role_name && <p className="text-[10px] text-gray-400">{u.role_name}</p>}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-500">{u.manager_name ?? <span className="text-gray-300">—</span>}</td>
                            <td className="px-4 py-3 text-right text-gray-700">{u.contacts_created ?? 0}</td>
                            <td className="px-4 py-3 text-right text-gray-700">
                              <span className="text-green-600 font-medium">{u.deals_won ?? 0}</span>
                              <span className="text-gray-400">/{u.deals_created ?? 0}</span>
                            </td>
                            <td className="px-4 py-3 text-right text-gray-700 font-medium">{fmtCurrency(Number(u.revenue ?? 0))}</td>
                            <td className="px-4 py-3 text-right text-gray-700">{u.activities_total ?? 0}</td>
                            <td className="px-4 py-3 text-right"><span className="text-green-600">{u.activities_done ?? 0}</span></td>
                            <td className="px-4 py-3 text-right">
                              {Number(u.overdue ?? 0) > 0
                                ? <span className="text-orange-500 font-medium">{u.overdue}</span>
                                : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="px-5 py-3 text-right text-gray-700">{u.tickets_handled ?? 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {stats.length === 0 && (
                <div className="bg-white border border-gray-100 rounded-xl p-10 text-center">
                  <Users className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                  <p className="text-sm font-medium text-gray-500">No data for this period</p>
                  <p className="text-xs text-gray-400 mt-1">Try a wider date range or select a different team member.</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
