/**
 * VoiceAnalytics
 *
 * Comprehensive analytics dashboard for the Voice module:
 *  - Summary KPI cards (total calls, inbound/outbound, bot-handled %, avg duration)
 *  - Daily call volume chart (area + bar, recharts)
 *  - Outcome breakdown (donut / horizontal bars)
 *  - Date range picker (7d / 30d / 90d / custom)
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from 'recharts';
import {
  Phone, PhoneIncoming, PhoneOutgoing, Bot, Clock,
  CheckCircle, XCircle, TrendingUp, Calendar,
} from 'lucide-react';
import { api } from '../services/api';

// ── Types ──────────────────────────────────────────────────────────────────
interface Summary {
  total_calls:          string;
  inbound:              string;
  outbound:             string;
  bot_handled:          string;
  completed:            string;
  missed:               string;
  failed:               string;
  avg_duration_seconds: string;
  total_minutes:        string;
}
interface DailyRow { day: string; total: string; inbound: string; outbound: string; avg_duration: string }
interface OutcomeRow { outcome: string; count: string }
interface AnalyticsData { summary: Summary; daily: DailyRow[]; outcomes: OutcomeRow[] }

// ── Date-range presets ─────────────────────────────────────────────────────
type Range = '7d' | '30d' | '90d';
const RANGES: { label: string; value: Range }[] = [
  { label: '7 days',  value: '7d'  },
  { label: '30 days', value: '30d' },
  { label: '90 days', value: '90d' },
];
function rangeToMs(r: Range) {
  return r === '7d' ? 7 : r === '30d' ? 30 : 90;
}

// ── Colour palette ─────────────────────────────────────────────────────────
const COLOURS = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#84cc16'];

// ── Helpers ────────────────────────────────────────────────────────────────
const n = (v: string | number) => Number(v) || 0;
function fmtDuration(secs: number) {
  if (!secs) return '0s';
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return m ? `${m}m ${s}s` : `${s}s`;
}
function fmtDay(d: string) {
  const dt = new Date(d);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── KPI card ───────────────────────────────────────────────────────────────
function KpiCard({
  icon: Icon, label, value, sub, color,
}: {
  icon: React.ElementType; label: string; value: string | number;
  sub?: string; color: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-start gap-4">
      <div className={`p-2.5 rounded-xl ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900 leading-tight">{value}</p>
        <p className="text-sm font-medium text-gray-600 mt-0.5">{label}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── Custom tooltip ─────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-lg p-3 text-xs">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: p.color }} />
          <span className="text-gray-600 capitalize">{p.name}:</span>
          <span className="font-medium text-gray-900">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export function VoiceAnalytics() {
  const [range, setRange] = useState<Range>('30d');

  const { from, to } = useMemo(() => {
    const t = new Date();
    const f = new Date(t.getTime() - rangeToMs(range) * 86_400_000);
    return { from: f.toISOString(), to: t.toISOString() };
  }, [range]);

  const { data, isLoading, isError } = useQuery<AnalyticsData>({
    queryKey: ['voice-analytics', range],
    queryFn: async () => {
      const res = await api.get(`/api/v1/voice/analytics?from=${from}&to=${to}`);
      return res.data.data as AnalyticsData;
    },
    refetchInterval: 60_000,
  });

  const s = data?.summary;
  const total        = n(s?.total_calls         ?? '0');
  const inbound      = n(s?.inbound             ?? '0');
  const outbound     = n(s?.outbound            ?? '0');
  const botHandled   = n(s?.bot_handled         ?? '0');
  const completed    = n(s?.completed           ?? '0');
  const missed       = n(s?.missed              ?? '0');
  const avgDuration  = n(s?.avg_duration_seconds ?? '0');
  const totalMinutes = n(s?.total_minutes        ?? '0');
  const botPct       = total ? Math.round((botHandled / total) * 100) : 0;
  const completedPct = total ? Math.round((completed  / total) * 100) : 0;

  const dailyData = (data?.daily ?? []).map((r) => ({
    day:      fmtDay(r.day),
    Inbound:  n(r.inbound),
    Outbound: n(r.outbound),
    Total:    n(r.total),
    'Avg duration (s)': n(r.avg_duration),
  }));

  const outcomeData = (data?.outcomes ?? []).map((r) => ({
    name:  r.outcome.replace(/_/g, ' '),
    value: n(r.count),
  }));

  // Summary donut: inbound vs outbound
  const directionData = total
    ? [
        { name: 'Inbound',  value: inbound  },
        { name: 'Outbound', value: outbound },
      ]
    : [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Voice Analytics</h1>
          <p className="text-sm text-gray-500 mt-0.5">Call performance and bot metrics</p>
        </div>
        <div className="flex items-center gap-2 bg-white border border-gray-100 rounded-xl p-1">
          <Calendar className="w-4 h-4 text-gray-400 ml-2" />
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                range === r.value
                  ? 'bg-brand-600 text-white'
                  : 'text-gray-500 hover:bg-gray-50'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading / error */}
      {isLoading && (
        <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
          Loading analytics…
        </div>
      )}
      {isError && (
        <div className="flex items-center justify-center h-48 text-red-500 text-sm">
          Failed to load analytics data.
        </div>
      )}

      {data && (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard
              icon={Phone}
              label="Total Calls"
              value={total.toLocaleString()}
              sub={`${rangeToMs(range)}-day period`}
              color="bg-brand-50 text-brand-600"
            />
            <KpiCard
              icon={Bot}
              label="Bot Handled"
              value={`${botPct}%`}
              sub={`${botHandled.toLocaleString()} of ${total.toLocaleString()} calls`}
              color="bg-violet-50 text-violet-600"
            />
            <KpiCard
              icon={Clock}
              label="Avg Duration"
              value={fmtDuration(avgDuration)}
              sub={`${Math.round(totalMinutes).toLocaleString()} total minutes`}
              color="bg-sky-50 text-sky-600"
            />
            <KpiCard
              icon={CheckCircle}
              label="Completed"
              value={`${completedPct}%`}
              sub={`${missed} missed · ${n(s?.failed ?? '0')} failed`}
              color="bg-emerald-50 text-emerald-600"
            />
          </div>

          {/* Second KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard
              icon={PhoneIncoming}
              label="Inbound"
              value={inbound.toLocaleString()}
              sub={total ? `${Math.round((inbound/total)*100)}% of total` : ''}
              color="bg-blue-50 text-blue-600"
            />
            <KpiCard
              icon={PhoneOutgoing}
              label="Outbound"
              value={outbound.toLocaleString()}
              sub={total ? `${Math.round((outbound/total)*100)}% of total` : ''}
              color="bg-amber-50 text-amber-600"
            />
            <KpiCard
              icon={XCircle}
              label="Missed"
              value={missed.toLocaleString()}
              sub={total ? `${Math.round((missed/total)*100)}% miss rate` : ''}
              color="bg-red-50 text-red-600"
            />
            <KpiCard
              icon={TrendingUp}
              label="Total Minutes"
              value={Math.round(totalMinutes).toLocaleString()}
              sub="voice minutes consumed"
              color="bg-teal-50 text-teal-600"
            />
          </div>

          {/* Daily call volume chart */}
          {dailyData.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 p-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Daily Call Volume</h2>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={dailyData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="inboundGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.18} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="outboundGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#10b981" stopOpacity={0.18} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    tickLine={false}
                    axisLine={false}
                    interval={Math.floor(dailyData.length / 6)}
                  />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  <Area
                    type="monotone" dataKey="Inbound"
                    stroke="#6366f1" strokeWidth={2}
                    fill="url(#inboundGrad)"
                    dot={false} activeDot={{ r: 4, strokeWidth: 0 }}
                  />
                  <Area
                    type="monotone" dataKey="Outbound"
                    stroke="#10b981" strokeWidth={2}
                    fill="url(#outboundGrad)"
                    dot={false} activeDot={{ r: 4, strokeWidth: 0 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Bottom row — direction split + outcomes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Direction donut */}
            <div className="bg-white rounded-2xl border border-gray-100 p-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Inbound vs Outbound</h2>
              {directionData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={directionData}
                      cx="50%" cy="50%"
                      innerRadius={55} outerRadius={85}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {directionData.map((_, i) => (
                        <Cell key={i} fill={COLOURS[i]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: any, n: string) => [v, n]} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[220px] flex items-center justify-center text-sm text-gray-400">
                  No data for this period
                </div>
              )}
            </div>

            {/* Outcome distribution */}
            <div className="bg-white rounded-2xl border border-gray-100 p-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Call Outcomes</h2>
              {outcomeData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={outcomeData}
                    layout="vertical"
                    margin={{ top: 0, right: 16, bottom: 0, left: 60 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                    <YAxis
                      type="category" dataKey="name"
                      tick={{ fontSize: 11, fill: '#64748b' }}
                      tickLine={false} axisLine={false} width={58}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={22}>
                      {outcomeData.map((_, i) => (
                        <Cell key={i} fill={COLOURS[i % COLOURS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[220px] flex items-center justify-center text-sm text-gray-400">
                  No outcome data yet
                </div>
              )}
            </div>
          </div>

          {/* Avg duration trend */}
          {dailyData.length > 1 && (
            <div className="bg-white rounded-2xl border border-gray-100 p-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Average Call Duration (seconds)</h2>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={dailyData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="durationGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    tickLine={false} axisLine={false}
                    interval={Math.floor(dailyData.length / 6)}
                  />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                  <Tooltip
                    content={({ active, payload, label }: any) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="bg-white border border-gray-100 rounded-xl shadow-lg p-3 text-xs">
                          <p className="font-semibold text-gray-700 mb-1">{label}</p>
                          <p className="text-gray-600">Avg duration: <strong>{fmtDuration(payload[0].value)}</strong></p>
                        </div>
                      );
                    }}
                  />
                  <Area
                    type="monotone" dataKey="Avg duration (s)"
                    stroke="#f59e0b" strokeWidth={2}
                    fill="url(#durationGrad)"
                    dot={false} activeDot={{ r: 4, strokeWidth: 0 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  );
}
