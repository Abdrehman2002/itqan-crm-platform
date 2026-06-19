/**
 * Operational Dashboard — 3-role aware
 *
 * Agent        → personal calls (handled by me), tickets (assigned/created by me),
 *                CRM activities (created by me)
 * Manager      → AI Voice Bot section + Human Agents section, side-by-side
 * Tenant Admin → Users & Roles overview, Voice Bot health, Email health
 */

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Phone, PhoneCall, PhoneMissed, Ticket,
  TrendingUp, Star, Users, AlertTriangle, ShieldAlert,
  CheckCircle2, Loader2, ArrowUpRight, Bot, MessageSquare,
  BarChart2, Activity, Headphones, Timer, ThumbsUp,
  UserCheck, Inbox, RefreshCw, CalendarCheck, Mail,
  ClipboardList, FileText, UserPlus, Clock, Shield,
  ToggleLeft, ToggleRight, Wifi, WifiOff, UserX,
  TrendingDown, Hash, Tag, ChevronRight, Zap, AlertOctagon,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from 'recharts';
import { api } from '../services/api';
import { useAuthStore } from '../store/auth.store';

// ── Brand ─────────────────────────────────────────────────────────────────
const C = {
  cyan:   '#29ABE2',
  green:  '#4D8B3C',
  gold:   '#F5C518',
  navy:   '#062840',
  red:    '#ef4444',
  orange: '#f97316',
  purple: '#8b5cf6',
};

const TICKET_TYPE_COLOR: Record<string, string> = {
  sales: C.green, support: C.cyan, complaint: C.orange, general: C.purple,
};
const TICKET_TYPE_LABEL: Record<string, string> = {
  sales: 'Sales', support: 'Support', complaint: 'Complaint', general: 'General',
};

// ── Helpers ───────────────────────────────────────────────────────────────
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
function ago(d: string | null | undefined) {
  if (!d) return 'Never';
  const diff = Date.now() - new Date(d).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(d).toLocaleDateString();
}
function fmtSecs(s: number | null | undefined): string {
  if (!s || s <= 0) return '—';
  const m = Math.floor(s / 60), sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}
function pct(a: number, b: number) { return !b ? 0 : Math.min(100, Math.round((a / b) * 100)); }

// ── Shared UI ─────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon: Icon, accent, trend }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; accent: string; trend?: 'up'|'warn';
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${accent}18` }}>
          <Icon className="w-5 h-5" style={{ color: accent }} />
        </div>
        {trend === 'warn' && <AlertTriangle className="w-4 h-4 text-orange-400" />}
        {trend === 'up'   && <ArrowUpRight  className="w-4 h-4 text-emerald-500" />}
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-sm text-gray-500 mt-0.5">{label}</p>
      {sub && <p className={`text-xs mt-1 font-medium ${trend === 'warn' ? 'text-orange-500' : trend === 'up' ? 'text-emerald-600' : 'text-gray-400'}`}>{sub}</p>}
    </div>
  );
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct(value, max)}%`, background: color }} />
    </div>
  );
}

function TicketTypePill({ type }: { type: string }) {
  const color = TICKET_TYPE_COLOR[type] ?? C.purple;
  return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full capitalize" style={{ background: `${color}18`, color }}>{TICKET_TYPE_LABEL[type] ?? type}</span>;
}

function PriorityDot({ p }: { p: string }) {
  const c = p === 'urgent' ? 'bg-red-500' : p === 'high' ? 'bg-orange-400' : p === 'medium' ? 'bg-yellow-400' : 'bg-gray-300';
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 mt-1.5 ${c}`} />;
}

const STATUS_STYLE: Record<string, string> = {
  open: 'bg-blue-50 text-blue-700', assigned: 'bg-indigo-50 text-indigo-700',
  accepted: 'bg-cyan-50 text-cyan-700', in_progress: 'bg-amber-50 text-amber-700',
  pending: 'bg-orange-50 text-orange-700', resolved: 'bg-emerald-50 text-emerald-700',
  closed: 'bg-gray-50 text-gray-500',
};

function SentimentRing({ score }: { score: number | null }) {
  const v = Math.min(100, Math.max(0, score ?? 0));
  const color = v >= 70 ? C.green : v >= 40 ? C.gold : C.red;
  return (
    <div className="relative w-16 h-16 mx-auto">
      <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
        <circle cx="18" cy="18" r="15" fill="none" stroke="#f1f5f9" strokeWidth="3" />
        <circle cx="18" cy="18" r="15" fill="none" strokeWidth="3" stroke={color}
          strokeDasharray={`${v * 0.94} 100`} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-bold" style={{ color }}>{score ?? '—'}</span>
      </div>
    </div>
  );
}

const ACT_CFG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  call:    { icon: Phone,         color: C.cyan,    label: 'Call'    },
  email:   { icon: Mail,          color: C.green,   label: 'Email'   },
  meeting: { icon: CalendarCheck, color: C.purple,  label: 'Meeting' },
  task:    { icon: ClipboardList, color: C.gold,    label: 'Task'    },
  note:    { icon: FileText,      color: '#94a3b8', label: 'Note'    },
};

// ══════════════════════════════════════════════════════════════════════════
// AGENT VIEW
// ══════════════════════════════════════════════════════════════════════════
function AgentDashboard({ d, department, deptType }: { d: any; department: string | null; deptType: string | null }) {
  const calls      = d.callStats        ?? {};
  const tickets    = d.myTickets        ?? {};
  const sentiment  = d.sentiment        ?? {};
  const actStats   = d.activityStats    ?? {};
  const breakdown  = (d.ticketBreakdown  ?? []) as any[];
  const recent     = (d.recentTickets    ?? []) as any[];
  const activities = (d.recentActivities ?? []) as any[];

  const { data: tatData } = useQuery({
    queryKey: ['agent-tat-dashboard'],
    queryFn: () => api.get('/api/v1/tickets/dashboard/agent').then(r => r.data.data),
    refetchInterval: 30_000,
  });

  const callsToday     = Number(calls.calls_today     ?? 0);
  const completedToday = Number(calls.completed_today ?? 0);
  const droppedToday   = Number(calls.dropped_today   ?? 0);
  const inQueue        = Number(calls.calls_in_queue  ?? 0);
  const dropRate       = callsToday > 0 ? Math.round((droppedToday / callsToday) * 100) : 0;
  const assignedToMe   = Number(tickets.assigned_to_me ?? 0);
  const createdByMe    = Number(tickets.created_by_me  ?? 0);

  const deptCfg   = department ? (DEPT_CONFIG[department] ?? null) : null;
  const deptLabel = deptCfg?.label ?? null;  // e.g. "Sales", "Support", "Complaints"

  const funnelData = [
    { name: 'Open',       value: Number(tickets.open         ?? 0), fill: '#3b82f6' },
    { name: 'In Progress',value: Number(tickets.in_progress  ?? 0), fill: C.cyan    },
    { name: 'Pending',    value: Number(tickets.pending      ?? 0), fill: C.orange  },
    { name: 'Resolved ✓', value: Number(tickets.resolved_today ?? 0), fill: C.green },
  ];

  return (
    <div className="space-y-5">

      {/* My Calls */}
      <SectionHeader icon={Phone} label="My Calls — Today (Calls I Received)" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Calls Received"  value={callsToday}       sub={`${completedToday} answered`}           icon={PhoneCall}   accent={C.cyan}  trend="up" />
        <StatCard label="Avg Talk Time"   value={fmtSecs(calls.avg_duration_today)} sub="per answered call"     icon={Timer}       accent={C.green} />
        <StatCard label="In Queue Now"    value={inQueue}          sub={inQueue > 0 ? 'Waiting' : 'Queue clear'} icon={Headphones}  accent={inQueue > 0 ? C.orange : C.green} trend={inQueue > 0 ? 'warn' : undefined} />
        <StatCard label="Drop Rate"       value={`${dropRate}%`}   sub={`${droppedToday} unanswered`}           icon={PhoneMissed} accent={dropRate > 20 ? C.red : C.gold}   trend={dropRate > 20 ? 'warn' : undefined} />
      </div>

      {/* My Tickets */}
      <SectionHeader
        icon={Ticket}
        label={deptLabel ? `My ${deptLabel} Tickets (Assigned to Me + Created by Me)` : 'My Tickets (Assigned to Me + Created by Me)'}
        accent={deptCfg?.color}
      />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Assigned to Me"  value={assignedToMe}              sub={`${createdByMe} I created`}  icon={UserCheck}    accent={C.cyan}   />
        <StatCard label="Open"            value={tickets.open        ?? 0}  sub="Need attention"              icon={Inbox}        accent="#3b82f6"  trend={Number(tickets.open) > 5 ? 'warn' : undefined} />
        <StatCard label="In Progress"     value={tickets.in_progress ?? 0}  sub="Actively working"            icon={Activity}     accent={C.gold}   trend="up" />
        <StatCard label="Resolved Today"  value={tickets.resolved_today ?? 0} sub="Closed this shift"        icon={CheckCircle2} accent={C.green}  trend="up" />
      </div>

      {/* Department TAT Dashboard */}
      {tatData && <TATPanel tat={tatData} deptType={deptType} />}

      {/* My CRM Activities */}
      <SectionHeader icon={CalendarCheck} label="My CRM Activities (Created by Me)" accent={C.green} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Created Today"  value={actStats.created_today ?? 0} sub={`${actStats.total ?? 0} total`}     icon={UserPlus}      accent={C.purple} trend="up" />
        <StatCard label="Due Today"      value={actStats.due_today     ?? 0} sub="Need action"                        icon={Clock}         accent={C.gold}   trend={Number(actStats.due_today) > 0 ? 'warn' : undefined} />
        <StatCard label="Overdue"        value={actStats.overdue       ?? 0} sub="Past due date"                      icon={AlertTriangle} accent={C.red}    trend={Number(actStats.overdue) > 0 ? 'warn' : undefined} />
        <StatCard label="Completed"      value={actStats.completed     ?? 0} sub={`${actStats.pending ?? 0} pending`} icon={CheckCircle2}  accent={C.green}  trend="up" />
      </div>

      {/* Main 3-col */}
      <div className="grid grid-cols-3 gap-4">
        {/* Ticket breakdown by type */}
        <div className="col-span-2 bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">
              {deptLabel ? `${deptLabel} Tickets` : 'Tickets by Category'}
            </h3>
            {Number(tickets.sla_breached) > 0 && (
              <span className="flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-50 px-2.5 py-1 rounded-full">
                <ShieldAlert className="w-3.5 h-3.5" />{tickets.sla_breached} SLA breached
              </span>
            )}
          </div>
          <div className="flex gap-3 mb-4">
            <div className="flex-1 bg-cyan-50 rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-cyan-700">{assignedToMe}</p>
              <p className="text-xs text-cyan-500 font-medium">Assigned to me</p>
            </div>
            <div className="flex-1 bg-purple-50 rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-purple-700">{createdByMe}</p>
              <p className="text-xs text-purple-500 font-medium">Created by me</p>
            </div>
          </div>
          {breakdown.length === 0
            ? <p className="text-sm text-gray-400 text-center py-6">No tickets yet</p>
            : <div className="space-y-4">
                {breakdown.map((row: any) => {
                  const total = Number(row.total), resolved = Number(row.resolved) + Number(row.closed);
                  const active = Number(row.in_progress) + Number(row.accepted ?? 0);
                  const open   = Number(row.open) + Number(row.assigned ?? 0);
                  const color  = TICKET_TYPE_COLOR[row.ticket_type] ?? C.purple;
                  return (
                    <div key={row.ticket_type}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <TicketTypePill type={row.ticket_type} />
                          <span className="text-sm font-medium text-gray-700">{total}</span>
                        </div>
                        <div className="flex gap-3 text-xs text-gray-500">
                          <span><span className="w-2 h-2 rounded-full bg-blue-400 inline-block mr-1" />{open} open</span>
                          <span><span className="w-2 h-2 rounded-full bg-amber-400 inline-block mr-1" />{active} active</span>
                          <span><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block mr-1" />{resolved} resolved</span>
                        </div>
                      </div>
                      <ProgressBar value={resolved} max={total} color={color} />
                      <p className="text-[10px] text-gray-400 mt-1">{pct(resolved, total)}% resolved</p>
                    </div>
                  );
                })}
              </div>
          }
          {funnelData.some(f => f.value > 0) && (
            <div className="mt-4 border-t border-gray-100 pt-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Status Funnel</p>
              <ResponsiveContainer width="100%" height={80}>
                <BarChart data={funnelData} margin={{ left: -20 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 11 }} />
                  <Bar dataKey="value" radius={[6,6,0,0]} maxBarSize={28} name="Tickets">
                    {funnelData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Performance */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm flex flex-col gap-4">
          <h3 className="font-semibold text-gray-900">My Performance</h3>
          <div className="text-center">
            <p className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-2">Avg Sentiment</p>
            <SentimentRing score={Number(sentiment.avg_sentiment ?? 0)} />
            <div className="flex justify-center gap-3 mt-3 text-[10px]">
              <span className="flex items-center gap-1 text-emerald-600"><ThumbsUp className="w-3 h-3" />{sentiment.positive_calls ?? 0}</span>
              <span className="flex items-center gap-1 text-gray-400"><MessageSquare className="w-3 h-3" />{sentiment.neutral_calls ?? 0}</span>
              <span className="flex items-center gap-1 text-red-400"><PhoneMissed className="w-3 h-3" />{sentiment.negative_calls ?? 0}</span>
            </div>
          </div>
          <div className="border-t border-gray-100 pt-3">
            <p className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-2">CSAT Rating</p>
            {sentiment.avg_rating
              ? <div className="flex items-center gap-2"><Star className="w-5 h-5 text-yellow-400 fill-yellow-400" /><span className="text-2xl font-bold text-gray-900">{sentiment.avg_rating}</span><span className="text-xs text-gray-400">/ 5 ({sentiment.total_ratings ?? 0})</span></div>
              : <p className="text-xs text-gray-400">No ratings yet</p>
            }
          </div>
          <div className="border-t border-gray-100 pt-3 space-y-2">
            <p className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-1">Activity Mix</p>
            {(['call','email','meeting','task'] as const).map(type => {
              const cfg  = ACT_CFG[type];
              const Icon = cfg.icon;
              const val  = Number(actStats[`${type}s`] ?? 0);
              return (
                <div key={type} className="flex items-center gap-2">
                  <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: cfg.color }} />
                  <div className="flex-1"><ProgressBar value={val} max={Number(actStats.total ?? 0) || 1} color={cfg.color} /></div>
                  <span className="text-xs text-gray-500 w-5 text-right">{val}</span>
                </div>
              );
            })}
          </div>
          <div className="border-t border-gray-100 pt-3">
            <p className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-1">Bot Calls Today</p>
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-purple-500" />
              <span className="text-xl font-bold text-gray-900">{calls.bot_calls_today ?? 0}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom row: open tickets + activities */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Ticket className="w-4 h-4" style={{ color: C.cyan }} />My Open Tickets</h3>
            <Link to="/tickets" className="text-xs font-medium hover:underline" style={{ color: C.cyan }}>View all →</Link>
          </div>
          {recent.length === 0
            ? <div className="flex flex-col items-center py-8 gap-2"><CheckCircle2 className="w-8 h-8 text-gray-200" /><p className="text-gray-400 text-sm">No open tickets — great work!</p></div>
            : <div className="divide-y divide-gray-50">
                {recent.map((t: any) => (
                  <Link key={t.id} to="/tickets" className="flex items-start gap-3 py-2.5 hover:bg-gray-50 rounded-xl px-2 transition-colors">
                    <PriorityDot p={t.priority} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        <span className="text-xs font-mono text-gray-400">{t.ticket_number}</span>
                        <TicketTypePill type={t.ticket_type ?? 'support'} />
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${t.my_role === 'assigned' ? 'bg-cyan-50 text-cyan-600' : 'bg-purple-50 text-purple-600'}`}>
                          {t.my_role === 'assigned' ? 'assigned' : 'created'}
                        </span>
                      </div>
                      <p className="text-sm text-gray-800 truncate">{t.subject}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_STYLE[t.status] ?? 'bg-gray-50 text-gray-500'}`}>{t.status.replace('_', ' ')}</span>
                      <span className="text-[10px] text-gray-400">{ago(t.created_at)}</span>
                    </div>
                  </Link>
                ))}
              </div>
          }
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2"><CalendarCheck className="w-4 h-4" style={{ color: C.green }} />My Activities</h3>
            <Link to="/activities" className="text-xs font-medium hover:underline" style={{ color: C.green }}>View all →</Link>
          </div>
          {activities.length === 0
            ? <div className="flex flex-col items-center py-8 gap-2"><CalendarCheck className="w-8 h-8 text-gray-200" /><p className="text-gray-400 text-sm">No activities logged yet</p></div>
            : <div className="divide-y divide-gray-50">
                {activities.map((a: any) => {
                  const cfg  = ACT_CFG[a.type] ?? ACT_CFG.note;
                  const Icon = cfg.icon;
                  const isOverdue = a.status === 'pending' && a.due_at && new Date(a.due_at) < new Date();
                  return (
                    <div key={a.id} className="flex items-start gap-3 py-2.5 px-2 hover:bg-gray-50 rounded-xl transition-colors">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: `${cfg.color}15` }}>
                        <Icon className="w-3.5 h-3.5" style={{ color: cfg.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800 truncate font-medium">{a.subject}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-gray-400 capitalize">{cfg.label}</span>
                          {a.contact_name?.trim() && <span className="text-[10px] text-gray-400">· {a.contact_name.trim()}</span>}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${a.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : isOverdue ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}>
                          {isOverdue ? 'overdue' : a.status}
                        </span>
                        <span className="text-[10px] text-gray-400">{ago(a.created_at)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
          }
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// DEPARTMENT TAT PANEL — used inside both AgentDashboard and ManagerDashboard
// ══════════════════════════════════════════════════════════════════════════
function TATPanel({ tat, deptType, isManager = false }: {
  tat: any; deptType: string | null; isManager?: boolean;
}) {
  if (!tat) return null;
  const assigned       = Number(tat.assigned       ?? 0);
  const accepted       = Number(tat.accepted        ?? 0);
  const pending        = Number(tat.pending         ?? 0);
  const resolved       = Number(tat.resolved        ?? 0);
  const withinTat      = Number(tat.within_tat      ?? 0);
  const approachingTat = Number(tat.approaching_tat ?? 0);
  const breachedTat    = Number(tat.breached_tat    ?? 0);

  const isSupport = !deptType || deptType === 'support';
  const accent    = isSupport ? '#29ABE2' : '#4D8B3C';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${accent}18` }}>
          <Ticket className="w-4 h-4" style={{ color: accent }} />
        </div>
        <h2 className="font-bold text-gray-900">
          {isManager ? 'Team Ticket Dashboard' : 'My Ticket Dashboard'}
          {deptType && <span className="ml-2 text-xs font-normal text-gray-400 capitalize">({deptType.replace('_', ' ')})</span>}
        </h2>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <p className="text-2xl font-bold text-gray-900">{assigned}</p>
          <p className="text-xs text-gray-500 mt-1">Assigned</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <p className="text-2xl font-bold text-blue-600">{accepted}</p>
          <p className="text-xs text-gray-500 mt-1">Accepted</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <p className="text-2xl font-bold text-amber-600">{pending}</p>
          <p className="text-xs text-gray-500 mt-1">Pending</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <p className="text-2xl font-bold text-emerald-600">{resolved}</p>
          <p className="text-xs text-gray-500 mt-1">Resolved</p>
        </div>
        <div className="bg-emerald-50 rounded-xl border border-emerald-100 p-4 shadow-sm">
          <p className="text-2xl font-bold text-emerald-700">{withinTat}</p>
          <p className="text-xs text-emerald-600 mt-1">Within TAT</p>
        </div>
        <div className={`rounded-xl border p-4 shadow-sm ${approachingTat > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-100'}`}>
          <div className="flex items-center gap-1">
            <p className={`text-2xl font-bold ${approachingTat > 0 ? 'text-amber-700' : 'text-gray-900'}`}>{approachingTat}</p>
            {approachingTat > 0 && <Zap className="w-4 h-4 text-amber-500" />}
          </div>
          <p className={`text-xs mt-1 ${approachingTat > 0 ? 'text-amber-600 font-medium' : 'text-gray-500'}`}>Approaching TAT</p>
        </div>
        <div className={`rounded-xl border p-4 shadow-sm ${breachedTat > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100'}`}>
          <div className="flex items-center gap-1">
            <p className={`text-2xl font-bold ${breachedTat > 0 ? 'text-red-700' : 'text-gray-900'}`}>{breachedTat}</p>
            {breachedTat > 0 && <AlertOctagon className="w-4 h-4 text-red-500" />}
          </div>
          <p className={`text-xs mt-1 ${breachedTat > 0 ? 'text-red-600 font-medium' : 'text-gray-500'}`}>Breached TAT</p>
        </div>
      </div>
      {breachedTat > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
          <AlertOctagon className="w-3.5 h-3.5 shrink-0" />
          <span><strong>{breachedTat}</strong> ticket{breachedTat !== 1 ? 's have' : ' has'} breached the SLA deadline. Immediate action required.</span>
          <Link to="/tickets?filter=breached" className="ml-auto underline font-medium whitespace-nowrap flex items-center gap-0.5">
            View all <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// MANAGER TEAM TABLE — per-agent breakdown with drill-down link
// ══════════════════════════════════════════════════════════════════════════
function TeamBreakdownTable({ agents }: { agents: any[] }) {
  if (!agents.length) return null;
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
        <Users className="w-4 h-4 text-gray-400" />
        <h3 className="font-semibold text-gray-900 text-sm">Team Breakdown — Direct Reports</h3>
        <span className="ml-auto text-xs text-gray-400">Click an agent to drill down</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
              <th className="px-4 py-2.5 text-left font-medium">Agent</th>
              <th className="px-3 py-2.5 text-center font-medium">Assigned</th>
              <th className="px-3 py-2.5 text-center font-medium">Accepted</th>
              <th className="px-3 py-2.5 text-center font-medium">Pending</th>
              <th className="px-3 py-2.5 text-center font-medium">Resolved</th>
              <th className="px-3 py-2.5 text-center font-medium text-emerald-600">Within TAT</th>
              <th className="px-3 py-2.5 text-center font-medium text-amber-600">Approaching</th>
              <th className="px-3 py-2.5 text-center font-medium text-red-600">Breached</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a, i) => {
              const breached    = Number(a.breached_tat    ?? 0);
              const approaching = Number(a.approaching_tat ?? 0);
              return (
                <tr key={a.id} className={`border-b border-gray-50 hover:bg-blue-50/40 transition-colors ${i % 2 === 1 ? 'bg-gray-50/40' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 text-sm">{a.name}</div>
                    {a.department && <div className="text-[10px] text-gray-400 capitalize">{a.department}</div>}
                  </td>
                  <td className="px-3 py-3 text-center font-semibold text-gray-700">{a.assigned ?? 0}</td>
                  <td className="px-3 py-3 text-center font-semibold text-blue-600">{a.accepted ?? 0}</td>
                  <td className="px-3 py-3 text-center font-semibold text-amber-600">{a.pending ?? 0}</td>
                  <td className="px-3 py-3 text-center font-semibold text-emerald-600">{a.resolved ?? 0}</td>
                  <td className="px-3 py-3 text-center">
                    <span className="font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full text-xs">{a.within_tat ?? 0}</span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    {approaching > 0
                      ? <span className="font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full text-xs flex items-center gap-1 justify-center"><Zap className="w-3 h-3" />{approaching}</span>
                      : <span className="text-gray-400 text-xs">—</span>}
                  </td>
                  <td className="px-3 py-3 text-center">
                    {breached > 0
                      ? <span className="font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded-full text-xs flex items-center gap-1 justify-center"><AlertOctagon className="w-3 h-3" />{breached}</span>
                      : <span className="text-gray-400 text-xs">—</span>}
                  </td>
                  <td className="px-3 py-3">
                    <Link to={`/tickets?assignee=${a.id}`} className="text-blue-500 hover:text-blue-700">
                      <ChevronRight className="w-4 h-4" />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// MANAGER VIEW  — Bot Section + Human Section side by side
// ══════════════════════════════════════════════════════════════════════════
function ManagerDashboard({ d, department, deptType }: { d: any; department: string | null; deptType: string | null }) {
  const bot   = d.botStats   ?? {};
  const human = d.humanStats ?? {};

  const { data: teamData } = useQuery({
    queryKey: ['manager-team-dashboard'],
    queryFn: () => api.get('/api/v1/tickets/dashboard/team').then(r => r.data.data),
    refetchInterval: 30_000,
  });
  const hCalls   = human.calls      ?? {};
  const hTickets = human.tickets    ?? {};
  const hActs    = human.activities ?? {};
  const agents   = (human.agentLeaderboard ?? []) as any[];
  const recentT  = (human.recentTickets    ?? []) as any[];

  const deptCfg   = department ? (DEPT_CONFIG[department] ?? null) : null;
  const deptLabel = deptCfg?.label ?? null;  // e.g. "Sales", "Support", "Complaints"

  const botCategories = (bot.categories ?? []) as any[];
  const botSentPie = [
    { name: 'Positive', value: Number(bot.positive ?? 0), color: C.green  },
    { name: 'Neutral',  value: Number(bot.neutral  ?? 0), color: C.gold   },
    { name: 'Negative', value: Number(bot.negative ?? 0), color: C.orange },
    { name: 'Urgent',   value: Number(bot.urgent   ?? 0), color: C.red    },
  ].filter(x => x.value > 0);

  const hDropRate = (() => {
    const comp = Number(hCalls.completed_calls ?? 0), drop = Number(hCalls.dropped_calls ?? 0);
    return (comp + drop) > 0 ? Math.round((drop / (comp + drop)) * 100) : 0;
  })();

  const ticketTypePie = [
    { name: 'Sales',      value: Number(hTickets.sales_tickets     ?? 0), color: C.green  },
    { name: 'Support',    value: Number(hTickets.support_tickets   ?? 0), color: C.cyan   },
    { name: 'Complaint',  value: Number(hTickets.complaint_tickets ?? 0), color: C.orange },
  ].filter(x => x.value > 0);

  return (
    <div className="space-y-5">

      {/* ── Team TAT Rollup ────────────────────────────────── */}
      {teamData && (
        <>
          <TATPanel tat={teamData.totals} deptType={deptType} isManager />
          <TeamBreakdownTable agents={teamData.agents ?? []} />
        </>
      )}

      {/* ── Two-column panels: Bot | Human ─────────────────── */}
      <div className="grid grid-cols-2 gap-5">

        {/* ── AI VOICE BOT ──────────────────────────────────── */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${C.purple}18` }}>
              <Bot className="w-4 h-4" style={{ color: C.purple }} />
            </div>
            <h2 className="font-bold text-gray-900">
              AI Voice Bot{deptLabel ? ` — ${deptLabel}` : ''}
            </h2>
            {bot.config && (
              <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${bot.config.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                {bot.config.is_active ? <><Wifi className="w-3 h-3"/>Active</> : <><WifiOff className="w-3 h-3"/>Inactive</>}
              </span>
            )}
            {bot.config?.provider && <span className="text-[10px] text-gray-400 capitalize">{bot.config.provider}</span>}
          </div>

          {/* Bot KPIs */}
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Total Bot Calls"   value={bot.calls_30d      ?? 0}  sub="Last 30 days"             icon={Bot}         accent={C.purple} />
            <StatCard label="Calls Today"        value={bot.calls_today    ?? 0}  sub={`${bot.completed ?? 0} completed`} icon={PhoneCall}   accent={C.cyan}   trend="up" />
            <StatCard label="Tickets Created"    value={bot.tickets_created ?? 0} sub="Auto-generated"           icon={Ticket}      accent={C.green}  trend="up" />
            <StatCard label="Untriaged"          value={bot.untriaged      ?? 0}  sub="No ticket linked"         icon={AlertTriangle} accent={bot.untriaged > 0 ? C.orange : C.green} trend={Number(bot.untriaged) > 0 ? 'warn' : undefined} />
            <StatCard label="Avg Call Duration"  value={fmtSecs(bot.avg_duration_secs)} sub="Bot handled"        icon={Timer}       accent={C.gold}   />
            <StatCard label="Failed Calls"       value={bot.failed         ?? 0}  sub="Error / no answer"        icon={PhoneMissed} accent={Number(bot.failed) > 0 ? C.red : C.green} trend={Number(bot.failed) > 0 ? 'warn' : undefined} />
          </div>

          {/* Bot sentiment pie */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <h3 className="font-semibold text-gray-900 mb-3">Bot Call Sentiment</h3>
            {botSentPie.length > 0
              ? <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie data={botSentPie} cx="50%" cy="50%" innerRadius={40} outerRadius={60} paddingAngle={3} dataKey="value">
                      {botSentPie.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 11 }} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              : <p className="text-sm text-gray-400 text-center py-8">No calls yet</p>
            }
          </div>

          {/* Bot category breakdown */}
          {botCategories.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><Tag className="w-4 h-4" style={{ color: C.purple }} />Bot Call Categories</h3>
              <div className="space-y-3">
                {botCategories.map((cat: any) => (
                  <div key={cat.category}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-700 capitalize font-medium">{cat.category}</span>
                      <span className="text-gray-400">{cat.with_ticket}/{cat.total} ticketed</span>
                    </div>
                    <ProgressBar value={Number(cat.with_ticket)} max={Number(cat.total) || 1} color={C.purple} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── HUMAN AGENTS ──────────────────────────────────── */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${C.cyan}18` }}>
              <Headphones className="w-4 h-4" style={{ color: C.cyan }} />
            </div>
            <h2 className="font-bold text-gray-900">
              Human Agents{deptLabel ? ` — ${deptLabel}` : ''}
            </h2>
            <span className="text-[10px] text-gray-400">{agents.length} agent{agents.length !== 1 ? 's' : ''}</span>
          </div>

          {/* Human call KPIs */}
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Calls Handled"    value={hCalls.completed_calls   ?? 0} sub={`${hCalls.calls_today ?? 0} today`}         icon={PhoneCall}   accent={C.cyan}   trend="up" />
            <StatCard label="Avg Talk Time"    value={fmtSecs(hCalls.avg_duration_secs)} sub="per completed call"                     icon={Timer}       accent={C.green}  />
            <StatCard label="Queue Now"        value={hCalls.calls_in_queue    ?? 0} sub={Number(hCalls.calls_in_queue) > 0 ? 'Waiting' : 'Clear'} icon={Headphones} accent={Number(hCalls.calls_in_queue) > 0 ? C.orange : C.green} trend={Number(hCalls.calls_in_queue) > 0 ? 'warn' : undefined} />
            <StatCard label="Drop Rate"        value={`${hDropRate}%`}               sub={`${hCalls.dropped_calls ?? 0} missed`}      icon={PhoneMissed} accent={hDropRate > 15 ? C.red : C.gold} trend={hDropRate > 15 ? 'warn' : undefined} />
            <StatCard label="Active Tickets"   value={hTickets.active          ?? 0} sub={`${hTickets.open ?? 0} open`}               icon={Inbox}       accent={C.cyan}   />
            <StatCard label="SLA Breached"     value={hTickets.sla_breached    ?? 0} sub="Needs action"                               icon={ShieldAlert} accent={Number(hTickets.sla_breached) > 0 ? C.red : C.green} trend={Number(hTickets.sla_breached) > 0 ? 'warn' : undefined} />
          </div>

          {/* Ticket type pie + activities */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <h3 className="font-semibold text-gray-900 mb-3">
              {deptLabel ? `${deptLabel} Tickets` : 'Tickets by Type'}
            </h3>
            {ticketTypePie.length > 0
              ? <>
                  <ResponsiveContainer width="100%" height={140}>
                    <PieChart>
                      <Pie data={ticketTypePie} cx="50%" cy="50%" innerRadius={35} outerRadius={55} paddingAngle={3} dataKey="value">
                        {ticketTypePie.map((e, i) => <Cell key={i} fill={e.color} />)}
                      </Pie>
                      <Tooltip contentStyle={{ border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 11 }} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="grid grid-cols-3 gap-2 mt-2 text-center">
                    {ticketTypePie.map(t => (
                      <div key={t.name} className="rounded-lg p-2" style={{ background: `${t.color}10` }}>
                        <p className="text-lg font-bold" style={{ color: t.color }}>{t.value}</p>
                        <p className="text-[10px] font-medium" style={{ color: t.color }}>{t.name}</p>
                      </div>
                    ))}
                  </div>
                </>
              : <p className="text-sm text-gray-400 text-center py-4">No tickets</p>
            }
          </div>

          {/* Team activity summary */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><CalendarCheck className="w-4 h-4" style={{ color: C.green }} />Team CRM Activities</h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Total', value: hActs.total, color: C.cyan },
                { label: 'Completed', value: hActs.completed, color: C.green },
                { label: 'Overdue', value: hActs.overdue, color: C.red },
                { label: 'Created Today', value: hActs.created_today, color: C.purple },
              ].map(r => (
                <div key={r.label} className="rounded-xl p-3 text-center" style={{ background: `${r.color}10` }}>
                  <p className="text-xl font-bold" style={{ color: r.color }}>{r.value ?? 0}</p>
                  <p className="text-[10px] font-medium" style={{ color: r.color }}>{r.label}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 space-y-2">
              {(['call','email','meeting','task'] as const).map(type => {
                const cfg  = ACT_CFG[type];
                const Icon = cfg.icon;
                const val  = Number(hActs[`act_${type}s`] ?? 0);
                return (
                  <div key={type} className="flex items-center gap-2">
                    <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: cfg.color }} />
                    <div className="flex-1"><ProgressBar value={val} max={Number(hActs.total ?? 0) || 1} color={cfg.color} /></div>
                    <span className="text-xs text-gray-500 w-6 text-right">{val}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Agent Leaderboard (full width) ─────────────────── */}
      {agents.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <UserCheck className="w-4 h-4" style={{ color: C.cyan }} />
              Agent Performance Leaderboard{deptLabel ? ` — ${deptLabel}` : ''}
            </h3>
            <span className="text-xs text-gray-400">{agents.length} agents</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  {['Agent','Calls Today','Avg Talk','Tickets Active','Resolved','SLA Breach','Activities','Sentiment','Status'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {agents.map((a: any) => {
                  const sentColor = Number(a.avg_sentiment) >= 70 ? 'text-emerald-600' : Number(a.avg_sentiment) >= 40 ? 'text-amber-600' : 'text-red-500';
                  return (
                    <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                               style={{ background: a.is_active ? 'linear-gradient(135deg,#29ABE2,#4D8B3C)' : '#d1d5db' }}>
                            {a.name?.[0]?.toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900 text-xs">{a.name}</p>
                            <p className="text-[10px] text-gray-400 truncate max-w-[90px]">{a.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-semibold text-gray-900">{a.calls_today ?? 0}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{fmtSecs(a.avg_call_duration)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900">{a.tickets_active ?? 0}</span>
                          <div className="w-14"><ProgressBar value={Number(a.tickets_active ?? 0)} max={Math.max(Number(a.tickets_assigned ?? 1), 1)} color={C.cyan} /></div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-emerald-600 font-medium">{a.tickets_resolved ?? 0}</td>
                      <td className="px-4 py-3">
                        {Number(a.sla_breached) > 0
                          ? <span className="flex items-center gap-1 text-red-600 text-xs font-semibold"><AlertTriangle className="w-3 h-3" />{a.sla_breached}</span>
                          : <span className="text-emerald-500 text-xs">✓</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{a.activities_today ?? 0}<span className="text-gray-400 text-[10px] ml-1">today</span></td>
                      <td className={`px-4 py-3 font-semibold text-sm ${sentColor}`}>{a.avg_sentiment ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${a.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>
                          {a.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Recent open tickets ─────────────────────────────── */}
      {recentT.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <Ticket className="w-4 h-4" style={{ color: C.cyan }} />
              {deptLabel ? `Open ${deptLabel} Tickets` : 'Open Tickets'}
            </h3>
            <Link to="/tickets" className="text-xs font-medium hover:underline" style={{ color: C.cyan }}>View all →</Link>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {recentT.map((t: any) => (
              <div key={t.id} className="flex items-start gap-3 p-3 hover:bg-gray-50 rounded-xl border border-gray-50 transition-colors">
                <PriorityDot p={t.priority} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                    <span className="text-[10px] font-mono text-gray-400">{t.ticket_number}</span>
                    <TicketTypePill type={t.ticket_type ?? 'support'} />
                  </div>
                  <p className="text-xs text-gray-800 truncate font-medium">{t.subject}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{t.assignee_name ?? 'Unassigned'} · {ago(t.created_at)}</p>
                </div>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full capitalize shrink-0 ${STATUS_STYLE[t.status] ?? 'bg-gray-50 text-gray-500'}`}>{t.status.replace('_',' ')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// TENANT ADMIN VIEW — Users / Roles / Bot Health / Email Health
// ══════════════════════════════════════════════════════════════════════════
function TenantAdminDashboard({ d }: { d: any }) {
  const stats  = d.tenantAdminStats ?? {};
  const users  = stats.users      ?? {};
  const bot    = stats.botHealth  ?? null;
  const email  = stats.emailHealth ?? {};
  const people = (stats.recentUsers ?? []) as any[];

  const ROLE_COLOR: Record<string, string> = {
    tenant_admin: C.purple, manager: C.cyan, agent: C.green, viewer: C.gold,
  };

  const roleBreakdown = [
    { role: 'tenant_admin', label: 'Admins',   count: Number(users.admins   ?? 0) },
    { role: 'manager',      label: 'Managers', count: Number(users.managers ?? 0) },
    { role: 'agent',        label: 'Agents',   count: Number(users.agents   ?? 0) },
    { role: 'viewer',       label: 'Viewers',  count: Number(users.viewers  ?? 0) },
  ];

  const deliveryRate = (() => {
    const total = Number(email.last_24h ?? 0);
    const ok    = Number(email.delivered_24h ?? 0);
    return total > 0 ? Math.round((ok / total) * 100) : 100;
  })();

  return (
    <div className="space-y-5">

      {/* ── User Stats ─────────────────────────────────────── */}
      <SectionHeader icon={Users} label="Users & Roles" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Total Users"    value={users.total    ?? 0} sub={`${users.active ?? 0} active`}           icon={Users}      accent={C.cyan}   trend="up" />
        <StatCard label="Active Now"     value={users.active_today ?? 0} sub="Logged in last 24h"                  icon={UserCheck}  accent={C.green}  trend="up" />
        <StatCard label="Inactive Users" value={users.inactive ?? 0} sub="Disabled accounts"                       icon={UserX}      accent={users.inactive > 0 ? C.orange : C.green} trend={Number(users.inactive) > 0 ? 'warn' : undefined} />
        <StatCard label="New (30d)"      value={users.new_30d  ?? 0} sub="Recently joined"                         icon={UserPlus}   accent={C.purple} trend="up" />
      </div>

      {/* Role + Department breakdown + user list */}
      <div className="grid grid-cols-3 gap-4">

        {/* Role & Department distribution */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm space-y-5">

          {/* Roles */}
          <div>
            <h3 className="font-semibold text-gray-900 mb-3">Role Distribution</h3>
            <div className="space-y-3">
              {roleBreakdown.map(r => (
                <div key={r.role}>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="font-medium capitalize" style={{ color: ROLE_COLOR[r.role] }}>{r.label}</span>
                    <span className="text-gray-400">{r.count}</span>
                  </div>
                  <ProgressBar value={r.count} max={Number(users.total ?? 1)} color={ROLE_COLOR[r.role]} />
                </div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-gray-100 flex justify-between text-xs">
              <div className="text-center"><p className="text-lg font-bold text-emerald-600">{users.active_7d ?? 0}</p><p className="text-gray-400 mt-0.5">Active 7d</p></div>
              <div className="text-center"><p className="text-lg font-bold text-gray-900">{users.total ?? 0}</p><p className="text-gray-400 mt-0.5">Total</p></div>
              <div className="text-center"><p className="text-lg font-bold text-orange-500">{users.inactive ?? 0}</p><p className="text-gray-400 mt-0.5">Inactive</p></div>
            </div>
          </div>

          {/* Department breakdown */}
          <div className="border-t border-gray-100 pt-4">
            <h3 className="font-semibold text-gray-900 mb-3">Department Breakdown</h3>
            <div className="space-y-3">
              {([
                { key: 'dept_sales',      dept: 'sales',      label: 'Sales'      },
                { key: 'dept_support',    dept: 'support',    label: 'Support'    },
                { key: 'dept_complaints', dept: 'complaints', label: 'Complaints' },
                { key: 'dept_unassigned', dept: null,         label: 'Unassigned' },
              ] as const).map(r => {
                const dc    = r.dept ? DEPT_CONFIG[r.dept] : null;
                const color = dc?.color ?? '#9ca3af';
                const count = Number((users as any)[r.key] ?? 0);
                return (
                  <div key={r.key}>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="font-medium capitalize" style={{ color }}>{r.label}</span>
                      <span className="text-gray-400">{count}</span>
                    </div>
                    <ProgressBar value={count} max={Number(users.total ?? 1)} color={color} />
                  </div>
                );
              })}
            </div>
          </div>

          <Link to="/settings" className="flex items-center justify-center gap-1.5 w-full py-2 bg-gray-50 hover:bg-gray-100 rounded-xl text-xs font-medium text-gray-600 transition-colors">
            <Shield className="w-3.5 h-3.5" /> Manage Roles & Departments
          </Link>
        </div>

        {/* User list */}
        <div className="col-span-2 bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">All Users</h3>
            <Link to="/settings" className="text-xs font-medium hover:underline" style={{ color: C.cyan }}>Manage →</Link>
          </div>
          <div className="space-y-1">
            {people.map((u: any) => (
              <div key={u.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 rounded-xl transition-colors">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                     style={{ background: u.is_active ? `linear-gradient(135deg,${ROLE_COLOR[u.role] ?? C.cyan},${C.navy})` : '#d1d5db' }}>
                  {u.name?.[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{u.name}</p>
                  <p className="text-xs text-gray-400 truncate">{u.email}</p>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full capitalize" style={{ background: `${ROLE_COLOR[u.role] ?? C.purple}18`, color: ROLE_COLOR[u.role] ?? C.purple }}>
                  {u.role.replace('_',' ')}
                </span>
                {u.department && (() => {
                  const dc = DEPT_CONFIG[u.department?.toLowerCase()] ?? null;
                  return dc
                    ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full capitalize shrink-0"
                            style={{ background: `${dc.color}15`, color: dc.color }}>
                        {dc.label}
                      </span>
                    : null;
                })()}
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${u.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>
                  {u.is_active ? 'Active' : 'Inactive'}
                </span>
                <span className="text-[10px] text-gray-400 shrink-0 w-20 text-right">{ago(u.last_login_at)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── System Health: Bot + Email ──────────────────────── */}
      <SectionHeader icon={Wifi} label="System Health" />
      <div className="grid grid-cols-2 gap-5">

        {/* Voice Bot health */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <Bot className="w-4 h-4" style={{ color: C.purple }} />
              Voice Bot
            </h3>
            {bot
              ? <span className={`flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full ${bot.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                  {bot.is_active ? <><ToggleRight className="w-3.5 h-3.5" />Active</> : <><ToggleLeft className="w-3.5 h-3.5" />Inactive</>}
                </span>
              : <span className="text-xs text-gray-400 bg-gray-50 px-2.5 py-1 rounded-full">Not configured</span>
            }
          </div>
          {bot ? (
            <>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-purple-50 rounded-xl p-3 text-center">
                  <p className="text-xl font-bold text-purple-700">{bot.total_calls ?? 0}</p>
                  <p className="text-[10px] text-purple-500 font-medium">Total Calls</p>
                </div>
                <div className="bg-blue-50 rounded-xl p-3 text-center">
                  <p className="text-xl font-bold text-blue-700">{bot.calls_24h ?? 0}</p>
                  <p className="text-[10px] text-blue-500 font-medium">Last 24h</p>
                </div>
              </div>
              <div className="space-y-2 text-sm text-gray-700">
                <div className="flex items-center gap-2 py-1.5 border-b border-gray-50">
                  <Hash className="w-3.5 h-3.5 text-gray-400" />
                  <span className="text-gray-500 text-xs">Provider</span>
                  <span className="ml-auto font-medium capitalize text-xs">{bot.provider}</span>
                </div>
                {bot.phone_number && (
                  <div className="flex items-center gap-2 py-1.5 border-b border-gray-50">
                    <Phone className="w-3.5 h-3.5 text-gray-400" />
                    <span className="text-gray-500 text-xs">Helpline</span>
                    <span className="ml-auto font-medium text-xs">{bot.phone_number}</span>
                  </div>
                )}
                {Number(bot.failed_calls) > 0 && (
                  <div className="flex items-center gap-2 py-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-orange-400" />
                    <span className="text-orange-600 text-xs font-medium">{bot.failed_calls} failed calls</span>
                  </div>
                )}
              </div>
              <Link to="/voice-bot" className="mt-4 flex items-center justify-center gap-1.5 w-full py-2 bg-purple-50 hover:bg-purple-100 rounded-xl text-xs font-medium text-purple-700 transition-colors">
                <Bot className="w-3.5 h-3.5" /> Configure Voice Bot
              </Link>
            </>
          ) : (
            <div className="flex flex-col items-center py-8 gap-3">
              <Bot className="w-10 h-10 text-gray-200" />
              <p className="text-sm text-gray-400">No voice bot configured</p>
              <Link to="/voice-bot" className="px-4 py-2 bg-purple-50 text-purple-700 text-xs font-semibold rounded-xl hover:bg-purple-100">Set Up Voice Bot</Link>
            </div>
          )}
        </div>

        {/* Email health */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <Mail className="w-4 h-4" style={{ color: C.green }} />
              Email
            </h3>
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${deliveryRate >= 95 ? 'bg-emerald-50 text-emerald-700' : deliveryRate >= 80 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'}`}>
              {deliveryRate}% delivery
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-emerald-50 rounded-xl p-3 text-center">
              <p className="text-xl font-bold text-emerald-700">{email.delivered_24h ?? 0}</p>
              <p className="text-[10px] text-emerald-500 font-medium">Delivered (24h)</p>
            </div>
            <div className={`rounded-xl p-3 text-center ${Number(email.failed_24h) > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
              <p className={`text-xl font-bold ${Number(email.failed_24h) > 0 ? 'text-red-600' : 'text-gray-400'}`}>{email.failed_24h ?? 0}</p>
              <p className={`text-[10px] font-medium ${Number(email.failed_24h) > 0 ? 'text-red-400' : 'text-gray-400'}`}>Failed (24h)</p>
            </div>
          </div>
          <div className="space-y-2">
            {[
              { label: 'Total Sent',  value: email.total,     color: C.cyan  },
              { label: 'Delivered',   value: email.delivered, color: C.green },
              { label: 'Failed',      value: email.failed,    color: C.red   },
              { label: 'Queued',      value: email.queued,    color: C.gold  },
            ].map(r => (
              <div key={r.label} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                <span className="text-xs text-gray-500">{r.label}</span>
                <span className="text-sm font-bold" style={{ color: r.color }}>{r.value ?? 0}</span>
              </div>
            ))}
          </div>
          <div className="mt-3">
            <ProgressBar value={Number(email.delivered ?? 0)} max={Number(email.total ?? 0) || 1} color={C.green} />
            <p className="text-[10px] text-gray-400 mt-1">{pct(Number(email.delivered ?? 0), Number(email.total ?? 0) || 1)}% overall delivery rate</p>
          </div>
          <Link to="/emails" className="mt-4 flex items-center justify-center gap-1.5 w-full py-2 bg-emerald-50 hover:bg-emerald-100 rounded-xl text-xs font-medium text-emerald-700 transition-colors">
            <Mail className="w-3.5 h-3.5" /> View Email Logs
          </Link>
        </div>
      </div>

    </div>
  );
}

// ── Section header helper ─────────────────────────────────────────────────
function SectionHeader({ icon: Icon, label, accent }: { icon: React.ElementType; label: string; accent?: string }) {
  return (
    <p className="text-xs font-bold uppercase tracking-widest flex items-center gap-2"
       style={{ color: accent ?? '#9ca3af' }}>
      <Icon className="w-3.5 h-3.5" /> {label}
    </p>
  );
}

// ── Skeleton ───────────────────────────────────────────────────────────────
function Skeleton() {
  return (
    <div className="grid grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-gray-100 p-5 h-28 animate-pulse">
          <div className="w-10 h-10 bg-gray-100 rounded-xl mb-4" />
          <div className="h-5 bg-gray-100 rounded w-1/2 mb-2" />
          <div className="h-3 bg-gray-50 rounded w-3/4" />
        </div>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ROOT
// ══════════════════════════════════════════════════════════════════════════
// Department display config
const DEPT_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  sales:      { label: 'Sales',      color: C.green,  bg: '#f0fdf4', border: '#bbf7d0' },
  support:    { label: 'Support',    color: C.cyan,   bg: '#f0f9ff', border: '#bae6fd' },
  complaints: { label: 'Complaints', color: C.orange, bg: '#fff7ed', border: '#fed7aa' },
  complaint:  { label: 'Complaints', color: C.orange, bg: '#fff7ed', border: '#fed7aa' },
};

export function Dashboard() {
  const { user } = useAuthStore();
  const role       = user?.role ?? 'agent';
  const department = user?.department?.toLowerCase() ?? null;
  const deptType   = (user as any)?.department_type ?? null;
  const deptCfg    = department ? (DEPT_CONFIG[department] ?? null) : null;

  const { data, isLoading, dataUpdatedAt, refetch, isFetching } = useQuery({
    queryKey: ['ops-dashboard'],
    queryFn: () => api.get('/api/v1/analytics/ops-dashboard').then(r => r.data.data),
    refetchInterval: 30_000,
  });

  const isTenantAdmin = role === 'tenant_admin';
  const isManager     = ['manager','line_manager','super_admin'].includes(role);

  const roleLabel = role === 'tenant_admin' ? 'Admin View'
    : role === 'manager'      ? 'Manager View'
    : role === 'line_manager' ? 'Line Manager View'
    : role === 'super_admin'  ? 'Super Admin View'
    : role === 'agent'        ? 'Agent View'
    : 'Viewer View';

  // Quick action bar varies by role
  const quickLinks: { label: string; to: string; icon: React.ElementType; color: string }[] = isTenantAdmin
    ? [
        { label: 'Manage Users',   to: '/settings',       icon: Users,  color: C.cyan   },
        { label: 'Roles',          to: '/roles',          icon: Shield, color: C.purple },
        { label: 'Voice Bot',      to: '/voice-bot',      icon: Bot,    color: C.purple },
        { label: 'Email Logs',     to: '/emails',         icon: Mail,   color: C.green  },
      ]
    : isManager
    ? [
        { label: 'New Ticket',  to: '/tickets',            icon: Ticket,      color: C.orange },
        { label: 'Voice Calls', to: '/voice',              icon: PhoneCall,   color: C.cyan   },
        { label: 'Bot Calls',   to: '/voice-bot',          icon: Bot,         color: C.purple },
        { label: 'Reports',     to: '/sales/reports',      icon: BarChart2,   color: C.gold   },
      ]
    : [
        { label: 'New Ticket',  to: '/tickets',            icon: Ticket,      color: C.orange },
        { label: 'Voice Calls', to: '/voice',              icon: PhoneCall,   color: C.cyan   },
        { label: 'Bot Calls',   to: '/voice-bot',          icon: Bot,         color: C.purple },
        { label: 'New Invoice', to: '/sales/invoices/new', icon: TrendingUp,  color: C.green  },
      ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="px-6 py-6 max-w-[1400px] mx-auto space-y-6">

        {/* Greeting */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {greeting()}, {user?.name?.split(' ')[0] ?? 'there'} 👋
            </h1>
            <p className="text-gray-500 text-sm mt-0.5">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              {' · '}<span className="font-semibold capitalize" style={{ color: C.cyan }}>{roleLabel}</span>
              {deptCfg && <>{' · '}<span className="font-semibold" style={{ color: deptCfg.color }}>{deptCfg.label} Dept</span></>}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {Number(data?.myTickets?.sla_breached) > 0 && (
              <Link to="/tickets" className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 border border-red-200 text-red-700 rounded-full text-xs font-semibold hover:bg-red-100 transition-colors">
                <ShieldAlert className="w-3.5 h-3.5" />{data.myTickets.sla_breached} SLA breach{data.myTickets.sla_breached !== '1' ? 'es' : ''}
              </Link>
            )}
            {Number(data?.callStats?.calls_in_queue ?? data?.humanStats?.calls?.calls_in_queue) > 0 && (
              <Link to="/voice" className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 border border-orange-200 text-orange-700 rounded-full text-xs font-semibold hover:bg-orange-100 transition-colors">
                <Headphones className="w-3.5 h-3.5" />Calls in queue
              </Link>
            )}
            <div className="flex items-center gap-2 text-xs text-gray-400">
              {dataUpdatedAt > 0 && <span>Updated {ago(new Date(dataUpdatedAt).toISOString())}</span>}
              <button onClick={() => refetch()} disabled={isFetching}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600 disabled:opacity-40">
                <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        </div>

        {/* Quick links */}
        <div className="flex items-center gap-2 flex-wrap">
          {quickLinks.map(({ label, to, icon: Icon, color }) => (
            <Link key={label} to={to}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:border-gray-300 hover:shadow-sm transition-all">
              <Icon className="w-4 h-4" style={{ color }} />{label}
            </Link>
          ))}
        </div>

        {/* Department scope banner — shown when user belongs to a department */}
        {deptCfg && !isTenantAdmin && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium"
               style={{ background: deptCfg.bg, borderColor: deptCfg.border, color: deptCfg.color }}>
            <Tag className="w-4 h-4 shrink-0" style={{ color: deptCfg.color }} />
            <span>
              Showing <strong>{deptCfg.label}</strong> department data only —
              all metrics are filtered to <strong>{deptCfg.label.toLowerCase()}</strong> tickets and calls.
            </span>
            <span className="ml-auto text-xs opacity-60">Department-scoped view</span>
          </div>
        )}

        {/* Role-aware content */}
        {isLoading
          ? <Skeleton />
          : !data
          ? <div className="flex flex-col items-center py-20 gap-3 text-gray-400"><Loader2 className="w-8 h-8 animate-spin" /><p className="text-sm">Loading dashboard…</p></div>
          : isTenantAdmin
          ? <TenantAdminDashboard d={data} />
          : isManager
          ? <ManagerDashboard d={data} department={department} deptType={deptType} />
          : <AgentDashboard d={data} department={department} deptType={deptType} />
        }

        <div className="h-4" />
      </div>
    </div>
  );
}
