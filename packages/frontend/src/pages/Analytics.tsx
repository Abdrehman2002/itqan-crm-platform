import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, AreaChart, Area, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  TrendingUp, TrendingDown, DollarSign, Users, Phone, Trophy,
  Calendar, ChevronDown,
} from 'lucide-react';
import { api } from '../services/api';
import { formatCurrency, formatNumber } from '../utils/format';

type Range = '7d' | '30d' | '90d' | '12m';
const RANGE_MONTHS: Record<Range, number> = { '7d': 0.25, '30d': 1, '90d': 3, '12m': 12 };
const COLORS = ['#29ABE2', '#4D8B3C', '#F5C518', '#10b981', '#f97316', '#ef4444'];

function StatCard({
  label, value, sub, icon: Icon, trend, color = 'brand',
}: {
  label: string; value: string; sub?: string; icon: any; trend?: number; color?: string;
}) {
  const colorMap: Record<string, string> = {
    brand:   'bg-brand-50 text-brand-500',
    green:   'bg-vivid-green-50 text-vivid-green-600',
    emerald: 'bg-emerald-50 text-emerald-500',
    cyan:    'bg-cyan-50 text-cyan-500',
  };
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div className={`p-2.5 rounded-lg ${colorMap[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
        {trend !== undefined && (
          <span className={`text-xs font-medium flex items-center gap-0.5 ${trend >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            {trend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {Math.abs(trend)}%
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-gray-900 mt-3">{value}</p>
      <p className="text-sm text-gray-500 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

export function Analytics() {
  const [range, setRange] = useState<Range>('30d');
  const months = RANGE_MONTHS[range];

  const { data: stats } = useQuery({
    queryKey: ['analytics', 'dashboard'],
    queryFn: () => api.get('/api/v1/analytics/dashboard').then((r) => r.data.data),
    refetchInterval: 60_000,
  });

  const { data: revenue } = useQuery({
    queryKey: ['analytics', 'revenue', months],
    queryFn: () => api.get(`/api/v1/analytics/revenue?months=${Math.ceil(months)}`).then((r) => r.data.data),
  });

  const { data: leaderboard } = useQuery({
    queryKey: ['analytics', 'leaderboard', range],
    queryFn: () => {
      const from = new Date(Date.now() - months * 30 * 86_400_000).toISOString();
      return api.get(`/api/v1/analytics/leaderboard?from=${from}`).then((r) => r.data.data);
    },
  });

  const { data: sources } = useQuery({
    queryKey: ['analytics', 'sources'],
    queryFn: () => api.get('/api/v1/analytics/contact-sources').then((r) => r.data.data),
  });

  const { data: voiceStats } = useQuery({
    queryKey: ['analytics', 'voice', range],
    queryFn: () => {
      const from = new Date(Date.now() - months * 30 * 86_400_000).toISOString();
      return api.get(`/api/v1/voice/analytics?from=${from}`).then((r) => r.data.data);
    },
  });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
        <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl">
          {(['7d', '30d', '90d', '12m'] as Range[]).map((r) => (
            <button key={r} onClick={() => setRange(r)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                range === r ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Total Contacts" value={formatNumber(stats?.total_contacts ?? 0)}
          sub={`+${stats?.new_contacts_30d ?? 0} new`} icon={Users} color="brand" />
        <StatCard label="Pipeline Value" value={formatCurrency(stats?.pipeline_value ?? 0)}
          sub={`${stats?.open_deals ?? 0} open deals`} icon={TrendingUp} color="green" />
        <StatCard label={`Revenue (${range})`} value={formatCurrency(stats?.revenue_30d ?? 0)}
          sub={`${stats?.deals_won_30d ?? 0} deals won`} icon={DollarSign} color="emerald" />
        <StatCard label={`Voice Calls (${range})`} value={formatNumber(voiceStats?.total_calls ?? 0)}
          sub={`${voiceStats?.bot_handled ?? 0} bot-handled`} icon={Phone} color="cyan" />
      </div>

      {/* Revenue chart + Sources pie */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Revenue Over Time</h3>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={revenue ?? []}>
              <defs>
                <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="period" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} />
              <Area type="monotone" dataKey="revenue" stroke="#6366f1" fill="url(#rev)" strokeWidth={2} name="Revenue" />
              <Area type="monotone" dataKey="deals_won" stroke="#10b981" fill="none" strokeWidth={1.5}
                strokeDasharray="4 2" name="Deals Won" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Lead Sources</h3>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={sources ?? []} dataKey="count" nameKey="source"
                cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3}>
                {(sources ?? []).map((_: any, i: number) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="mt-3 space-y-1.5">
            {(sources ?? []).slice(0, 5).map((s: any, i: number) => (
              <div key={s.source} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                  <span className="text-xs text-gray-600 capitalize">{s.source.replace(/_/g, ' ')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-900 font-medium">{s.count}</span>
                  {s.converted > 0 && (
                    <span className="text-xs text-emerald-600">{Math.round((s.converted / s.count) * 100)}%</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Voice analytics */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Voice Call Breakdown</h3>
          {voiceStats ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Inbound', value: voiceStats.inbound, color: 'bg-blue-500' },
                  { label: 'Outbound', value: voiceStats.outbound, color: 'bg-brand-500' },
                  { label: 'Bot Handled', value: voiceStats.bot_handled, color: 'bg-vivid-green-500' },
                  { label: 'Transferred', value: (voiceStats.total_calls ?? 0) - (voiceStats.bot_handled ?? 0), color: 'bg-amber-500' },
                ].map((item) => (
                  <div key={item.label} className="bg-gray-50 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <div className={`w-2 h-2 rounded-full ${item.color}`} />
                      <span className="text-xs text-gray-500">{item.label}</span>
                    </div>
                    <p className="text-xl font-bold text-gray-900">{formatNumber(item.value ?? 0)}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Avg call duration</span>
                <span className="font-medium text-gray-900">{voiceStats.avg_duration_seconds ?? 0}s</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Total minutes used</span>
                <span className="font-medium text-gray-900">{formatNumber(voiceStats.total_minutes ?? 0)} min</span>
              </div>
            </div>
          ) : (
            <div className="text-center text-gray-400 py-8 text-sm">No voice data for this period</div>
          )}
        </div>

        {/* Agent leaderboard */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Agent Leaderboard</h3>
          <div className="space-y-3">
            {(leaderboard ?? []).slice(0, 6).map((agent: any, i: number) => (
              <div key={agent.id} className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                  style={{ background: i < 3 ? ['#f59e0b', '#94a3b8', '#cd7c3a'][i] : '#e5e7eb', color: i < 3 ? 'white' : '#6b7280' }}>
                  {i + 1}
                </div>
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-400 to-purple-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                  {agent.name?.[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{agent.name}</p>
                  <p className="text-xs text-gray-400">{agent.deals_won} won · {agent.calls_made} calls</p>
                </div>
                <span className="text-sm font-semibold text-brand-600 shrink-0">
                  {formatCurrency(agent.revenue ?? 0)}
                </span>
              </div>
            ))}
            {(!leaderboard || leaderboard.length === 0) && (
              <div className="text-center text-gray-400 py-6 text-sm">No data for this period</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
