/**
 * TicketSla — SLA policies with multi-step reminder schedule builder
 */
import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Clock, Plus, Pencil, Trash2, Loader2, X, Bell,
  AlertTriangle, ShieldAlert, GripVertical, ChevronDown,
} from 'lucide-react';
import { api } from '../services/api';
import { useCan } from '../hooks/useRole';

// ── Types ──────────────────────────────────────────────────────────────────

interface ReminderStep {
  id:           string;
  pct:          number;
  level:        'reminder' | 'l1' | 'l2';
  label:        string;
  notifyTarget: 'assignee' | 'managers' | 'admins' | 'all';
}

interface SlaPolicy {
  id: string; name: string; description?: string; priority: string;
  first_response_hours: number; resolution_hours: number;
  reminder_pct: number; l1_escalation_pct: number; l2_escalation_pct: number;
  business_hours_only: boolean; is_active: boolean;
  reminder_schedule: ReminderStep[];
}

// ── Config maps ────────────────────────────────────────────────────────────

const PRIORITY_CFG: Record<string, { label: string; cls: string; dot: string }> = {
  urgent: { label: 'Urgent', cls: 'bg-red-100 text-red-700 border-red-200',       dot: 'bg-red-500'    },
  high:   { label: 'High',   cls: 'bg-orange-100 text-orange-700 border-orange-200', dot: 'bg-orange-500' },
  medium: { label: 'Medium', cls: 'bg-blue-100 text-blue-700 border-blue-200',     dot: 'bg-blue-500'   },
  low:    { label: 'Low',    cls: 'bg-gray-100 text-gray-500 border-gray-200',     dot: 'bg-gray-400'   },
};

const LEVEL_CFG = {
  reminder: { label: 'Reminder',    color: 'bg-amber-400',  border: 'border-amber-300',  text: 'text-amber-700',  bg: 'bg-amber-50',  Icon: Bell          },
  l1:       { label: 'L1 Escalate', color: 'bg-orange-500', border: 'border-orange-300', text: 'text-orange-700', bg: 'bg-orange-50', Icon: AlertTriangle  },
  l2:       { label: 'L2 Escalate', color: 'bg-red-600',    border: 'border-red-300',    text: 'text-red-700',    bg: 'bg-red-50',    Icon: ShieldAlert    },
};

const NOTIFY_LABELS: Record<string, string> = {
  assignee: 'Assigned Agent only',
  managers: 'Supervisors & Managers',
  admins:   'Tenant Admins only',
  all:      'Everyone (agent + managers + admins)',
};

function uid() { return Math.random().toString(36).slice(2, 10); }
function fmtHours(h: number) {
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24), r = h % 24;
  return r ? `${d}d ${r}h` : `${d}d`;
}

// Default schedule for new policies
const DEFAULT_SCHEDULE: ReminderStep[] = [
  { id: uid(), pct: 50,  level: 'reminder', label: 'First Warning to Agent',        notifyTarget: 'assignee' },
  { id: uid(), pct: 75,  level: 'reminder', label: 'Second Warning to Agent',       notifyTarget: 'assignee' },
  { id: uid(), pct: 90,  level: 'reminder', label: 'Final Warning — 90% elapsed',   notifyTarget: 'assignee' },
  { id: uid(), pct: 100, level: 'l1',       label: 'SLA Breached — Notify Managers', notifyTarget: 'managers' },
  { id: uid(), pct: 150, level: 'l2',       label: 'Critical Breach — Notify Admin',  notifyTarget: 'admins'  },
];

// ── Timeline bar ───────────────────────────────────────────────────────────

function ScheduleTimeline({ steps }: { steps: ReminderStep[] }) {
  if (!steps.length) return null;
  const maxPct   = Math.max(...steps.map(s => s.pct), 150);
  const sorted   = [...steps].sort((a, b) => a.pct - b.pct);

  return (
    <div className="mt-4">
      <p className="text-xs font-medium text-gray-500 mb-2">Timeline (% of resolution time elapsed)</p>
      <div className="relative h-6 bg-gradient-to-r from-green-100 via-amber-100 to-red-100 rounded-full border border-gray-200 overflow-visible">
        {/* 100% breach line */}
        <div className="absolute top-0 bottom-0 w-px bg-red-400 opacity-60 z-10"
             style={{ left: `${Math.min((100 / maxPct) * 100, 99)}%` }}
             title="SLA deadline (100%)">
          <div className="absolute -top-4 left-1 text-[9px] text-red-500 font-medium whitespace-nowrap">100%</div>
        </div>
        {sorted.map((step, idx) => {
          const cfg  = LEVEL_CFG[step.level];
          const left = Math.min((step.pct / maxPct) * 100, 99);
          return (
            <div key={step.id} className="absolute top-0 bottom-0 z-20"
                 style={{ left: `${left}%` }}>
              <div className={`absolute top-0 bottom-0 w-0.5 ${cfg.color}`} />
              <div className={`absolute -top-1 -left-1.5 w-3 h-3 rounded-full ${cfg.color} border-2 border-white shadow`}
                   title={`${step.pct}% — ${step.label}`} />
              <div className="absolute top-7 -translate-x-1/2 text-[9px] text-gray-500 whitespace-nowrap font-medium">
                {step.pct}%
              </div>
            </div>
          );
        })}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-2 mt-7">
        {sorted.map(step => {
          const cfg  = LEVEL_CFG[step.level];
          const LIcon = cfg.Icon;
          return (
            <div key={step.id}
              className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border ${cfg.bg} ${cfg.border} ${cfg.text}`}>
              <LIcon className="w-3 h-3 shrink-0" />
              <span className="font-medium">{step.pct}%</span>
              <span className="text-gray-500">—</span>
              <span className="truncate max-w-32">{step.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Step row editor ────────────────────────────────────────────────────────

function StepRow({
  step, idx, total, onChange, onDelete,
}: {
  step: ReminderStep; idx: number; total: number;
  onChange: (s: ReminderStep) => void; onDelete: () => void;
}) {
  const cfg  = LEVEL_CFG[step.level];
  const LIcon = cfg.Icon;

  return (
    <div className={`flex items-center gap-2 p-3 rounded-xl border ${cfg.bg} ${cfg.border} group`}>
      {/* Drag handle (visual only) */}
      <GripVertical className="w-3.5 h-3.5 text-gray-300 shrink-0 cursor-grab" />

      {/* Step number */}
      <div className={`w-5 h-5 rounded-full ${cfg.color} flex items-center justify-center text-white text-[10px] font-bold shrink-0`}>
        {idx + 1}
      </div>

      {/* % input */}
      <div className="flex items-center gap-1 shrink-0">
        <input
          type="number" min={1} max={500}
          value={step.pct}
          onChange={e => onChange({ ...step, pct: Number(e.target.value) })}
          className="w-14 text-center text-sm font-semibold border border-gray-200 bg-white rounded-lg px-1 py-1 outline-none focus:border-brand-400"
        />
        <span className="text-xs text-gray-500">%</span>
      </div>

      {/* Level dropdown */}
      <div className="relative shrink-0">
        <select
          value={step.level}
          onChange={e => onChange({ ...step, level: e.target.value as ReminderStep['level'] })}
          className={`text-xs font-semibold border rounded-lg px-2 py-1.5 outline-none cursor-pointer appearance-none pr-6 ${cfg.bg} ${cfg.border} ${cfg.text}`}
        >
          <option value="reminder">🔔 Reminder</option>
          <option value="l1">⚠️ L1 Escalate</option>
          <option value="l2">🚨 L2 Escalate</option>
        </select>
        <ChevronDown className={`absolute right-1.5 top-1.5 w-3 h-3 pointer-events-none ${cfg.text}`} />
      </div>

      {/* Label */}
      <input
        value={step.label}
        onChange={e => onChange({ ...step, label: e.target.value })}
        placeholder="Step label..."
        className="flex-1 min-w-0 text-xs border border-gray-200 bg-white rounded-lg px-2 py-1.5 outline-none focus:border-brand-400"
      />

      {/* Notify target */}
      <div className="relative shrink-0">
        <select
          value={step.notifyTarget}
          onChange={e => onChange({ ...step, notifyTarget: e.target.value as ReminderStep['notifyTarget'] })}
          className="text-xs border border-gray-200 bg-white rounded-lg px-2 py-1.5 outline-none appearance-none pr-6 text-gray-700"
        >
          <option value="assignee">Agent only</option>
          <option value="managers">Managers</option>
          <option value="admins">Admins only</option>
          <option value="all">Everyone</option>
        </select>
        <ChevronDown className="absolute right-1.5 top-1.5 w-3 h-3 text-gray-400 pointer-events-none" />
      </div>

      {/* Delete */}
      {total > 1 && (
        <button onClick={onDelete}
          className="text-gray-300 hover:text-red-500 transition-colors shrink-0 p-0.5">
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

// ── SLA Modal ──────────────────────────────────────────────────────────────

function SlaModal({ policy, onClose }: { policy?: SlaPolicy; onClose: () => void }) {
  const qc = useQueryClient();

  const [form, setForm] = useState({
    name:               policy?.name                ?? '',
    description:        policy?.description          ?? '',
    priority:           policy?.priority             ?? 'medium',
    firstResponseHours: policy?.first_response_hours ?? 4,
    resolutionHours:    policy?.resolution_hours      ?? 24,
    reminderPct:        policy?.reminder_pct          ?? 80,
    l1EscalationPct:    policy?.l1_escalation_pct     ?? 100,
    l2EscalationPct:    policy?.l2_escalation_pct     ?? 150,
    businessHoursOnly:  policy?.business_hours_only   ?? false,
    isActive:           policy?.is_active             ?? true,
  });

  // Schedule — seed from existing or default
  const [schedule, setSchedule] = useState<ReminderStep[]>(() => {
    const existing = policy?.reminder_schedule;
    if (existing && existing.length > 0) return existing;
    // Seed defaults from legacy pct fields if available
    if (policy) {
      return [
        { id: uid(), pct: policy.reminder_pct,      level: 'reminder', label: 'Warning to Agent',        notifyTarget: 'assignee' },
        { id: uid(), pct: policy.l1_escalation_pct, level: 'l1',       label: 'SLA Breached — Managers', notifyTarget: 'managers' },
        { id: uid(), pct: policy.l2_escalation_pct, level: 'l2',       label: 'Critical Breach — Admin', notifyTarget: 'admins'   },
      ];
    }
    return DEFAULT_SCHEDULE.map(s => ({ ...s, id: uid() }));
  });

  const sorted = [...schedule].sort((a, b) => a.pct - b.pct);

  const addStep = () => {
    const lastPct = sorted.length ? sorted[sorted.length - 1].pct : 75;
    setSchedule(prev => [...prev, {
      id: uid(), pct: lastPct + 25, level: 'reminder',
      label: 'New Reminder', notifyTarget: 'assignee',
    }]);
  };

  const updateStep = useCallback((id: string, updated: ReminderStep) => {
    setSchedule(prev => prev.map(s => s.id === id ? updated : s));
  }, []);

  const deleteStep = useCallback((id: string) => {
    setSchedule(prev => prev.filter(s => s.id !== id));
  }, []);

  const mutation = useMutation({
    mutationFn: () => {
      const payload = { ...form, reminderSchedule: schedule };
      return policy
        ? api.patch(`/api/v1/tickets/sla-policies/${policy.id}`, payload)
        : api.post('/api/v1/tickets/sla-policies', payload);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sla-policies'] }); onClose(); },
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.type === 'number' ? Number(e.target.value) : e.target.value }));
  const setCheck = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.checked }));

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Clock className="w-4 h-4 text-brand-500" />
            {policy ? 'Edit SLA Policy' : 'New SLA Policy'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">

          {/* Basic info */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Policy Name *</label>
              <input value={form.name} onChange={set('name')}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-400"
                placeholder="e.g. Urgent 4h SLA" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Priority</label>
              <select value={form.priority} onChange={set('priority')}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-400">
                {['urgent','high','medium','low'].map(p => (
                  <option key={p} value={p}>{PRIORITY_CFG[p].label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
              <label className="flex items-center gap-2 mt-2.5 text-sm cursor-pointer">
                <input type="checkbox" checked={form.isActive} onChange={setCheck('isActive')} className="rounded accent-brand-600" />
                Policy is active
              </label>
            </div>
          </div>

          {/* Response times */}
          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Response Times</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">First Response (hours)</label>
                <input type="number" min={0} value={form.firstResponseHours} onChange={set('firstResponseHours')}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-400" />
                <p className="text-xs text-gray-400 mt-1">From ticket creation → first agent reply</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Resolution (hours)</label>
                <input type="number" min={1} value={form.resolutionHours} onChange={set('resolutionHours')}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-400" />
                <p className="text-xs text-gray-400 mt-1">From agent acceptance → resolved</p>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer mt-3">
              <input type="checkbox" checked={form.businessHoursOnly} onChange={setCheck('businessHoursOnly')} className="rounded accent-brand-600" />
              Business hours only (Mon–Fri, 9 AM–6 PM)
            </label>
          </div>

          {/* Reminder schedule */}
          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center justify-between mb-1">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Reminder & Escalation Schedule</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Add as many steps as needed. Each fires once when the elapsed % is reached.
                </p>
              </div>
              <button onClick={addStep}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-700 shrink-0">
                <Plus className="w-3.5 h-3.5" /> Add Step
              </button>
            </div>

            {/* Column headers */}
            <div className="grid grid-cols-[20px_32px_60px_100px_1fr_110px_20px] gap-2 px-3 py-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
              <span />
              <span>#</span>
              <span>At %</span>
              <span>Type</span>
              <span>Label</span>
              <span>Notify</span>
              <span />
            </div>

            <div className="space-y-2 mt-1">
              {sorted.map((step, idx) => (
                <StepRow
                  key={step.id}
                  step={step}
                  idx={idx}
                  total={schedule.length}
                  onChange={updated => updateStep(step.id, updated)}
                  onDelete={() => deleteStep(step.id)}
                />
              ))}
            </div>

            {/* Quick preset buttons */}
            <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-dashed border-gray-200">
              <p className="text-xs text-gray-400 w-full">Quick add:</p>
              {[
                { pct: 50,  level: 'reminder' as const, label: '50% Warning', notifyTarget: 'assignee' as const },
                { pct: 75,  level: 'reminder' as const, label: '75% Warning', notifyTarget: 'assignee' as const },
                { pct: 100, level: 'l1'       as const, label: 'L1 @ Breach', notifyTarget: 'managers' as const },
                { pct: 125, level: 'l1'       as const, label: 'L1 @ 125%',   notifyTarget: 'managers' as const },
                { pct: 150, level: 'l2'       as const, label: 'L2 @ 150%',   notifyTarget: 'admins'   as const },
                { pct: 200, level: 'l2'       as const, label: 'L2 @ 200%',   notifyTarget: 'all'      as const },
              ].map(preset => {
                const exists = schedule.some(s => s.pct === preset.pct && s.level === preset.level);
                const cfg = LEVEL_CFG[preset.level];
                return (
                  <button key={`${preset.pct}-${preset.level}`}
                    disabled={exists}
                    onClick={() => setSchedule(prev => [...prev, { ...preset, id: uid() }])}
                    className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${exists
                      ? 'opacity-40 cursor-not-allowed bg-gray-50 border-gray-200 text-gray-400'
                      : `${cfg.bg} ${cfg.border} ${cfg.text} hover:opacity-80 cursor-pointer`
                    }`}>
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Live timeline preview */}
          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Preview</p>
            <ScheduleTimeline steps={schedule} />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 flex gap-2 border-t border-gray-100 pt-4">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!form.name || schedule.length === 0 || mutation.isPending}
            className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {mutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {policy ? 'Save Changes' : 'Create Policy'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Policy card ────────────────────────────────────────────────────────────

function PolicyCard({ p, onEdit, onDelete, canEdit }: {
  p: SlaPolicy; onEdit: () => void; onDelete: () => void; canEdit: boolean;
}) {
  const pc       = PRIORITY_CFG[p.priority] ?? PRIORITY_CFG.medium;
  const schedule = p.reminder_schedule ?? [];
  const sorted   = [...schedule].sort((a, b) => a.pct - b.pct);

  return (
    <div className={`bg-white rounded-2xl border p-5 ${p.is_active ? 'border-gray-100' : 'border-gray-100 opacity-60'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${pc.cls}`}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${pc.dot}`} />
              {pc.label}
            </span>
            <h3 className="font-semibold text-gray-900">{p.name}</h3>
            {!p.is_active      && <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Inactive</span>}
            {p.business_hours_only && <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">Business hrs</span>}
          </div>
          {p.description && <p className="text-sm text-gray-500">{p.description}</p>}
        </div>
        {canEdit && (
          <div className="flex gap-1 shrink-0">
            <button onClick={onEdit} className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg"><Pencil className="w-4 h-4" /></button>
            <button onClick={onDelete} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
          </div>
        )}
      </div>

      {/* Times */}
      <div className="grid grid-cols-2 gap-3 mt-3">
        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-xs text-gray-400">First Response</p>
          <p className="text-lg font-bold text-gray-800">{fmtHours(p.first_response_hours)}</p>
          <p className="text-xs text-gray-400">from ticket creation</p>
        </div>
        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-xs text-gray-400">Resolution</p>
          <p className="text-lg font-bold text-gray-800">{fmtHours(p.resolution_hours)}</p>
          <p className="text-xs text-gray-400">from agent acceptance</p>
        </div>
      </div>

      {/* Schedule steps summary */}
      {sorted.length > 0 ? (
        <div className="mt-3">
          <ScheduleTimeline steps={sorted} />
          <div className="mt-3 space-y-1">
            {sorted.map((step, idx) => {
              const cfg  = LEVEL_CFG[step.level];
              const LIcon = cfg.Icon;
              return (
                <div key={step.id}
                  className={`flex items-center gap-2.5 text-xs px-3 py-2 rounded-lg ${cfg.bg} ${cfg.border} border`}>
                  <div className={`w-5 h-5 rounded-full ${cfg.color} flex items-center justify-center text-white text-[10px] font-bold shrink-0`}>
                    {idx + 1}
                  </div>
                  <LIcon className={`w-3.5 h-3.5 shrink-0 ${cfg.text}`} />
                  <span className={`font-semibold ${cfg.text}`}>{step.pct}%</span>
                  <span className="text-gray-600 flex-1 truncate">{step.label}</span>
                  <span className="text-gray-400 text-[10px] shrink-0">→ {NOTIFY_LABELS[step.notifyTarget]}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Legacy fallback */
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
          <span className="flex items-center gap-1 bg-amber-50 border border-amber-200 text-amber-700 px-2 py-1 rounded-lg">
            <Bell className="w-3 h-3" />{p.reminder_pct}% — Reminder
          </span>
          <span className="flex items-center gap-1 bg-orange-50 border border-orange-200 text-orange-700 px-2 py-1 rounded-lg">
            <AlertTriangle className="w-3 h-3" />{p.l1_escalation_pct}% — L1 Escalation
          </span>
          <span className="flex items-center gap-1 bg-red-50 border border-red-200 text-red-700 px-2 py-1 rounded-lg">
            <ShieldAlert className="w-3 h-3" />{p.l2_escalation_pct}% — L2 Escalation
          </span>
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export function TicketSla() {
  const can = useCan();
  const qc  = useQueryClient();
  const [editing,    setEditing]    = useState<SlaPolicy | undefined>(undefined);
  const [showCreate, setShowCreate] = useState(false);

  const { data = [], isLoading } = useQuery<SlaPolicy[]>({
    queryKey: ['sla-policies'],
    queryFn:  async () => (await api.get('/api/v1/tickets/sla-policies')).data.data,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/tickets/sla-policies/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sla-policies'] }),
  });

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-brand-600" />
            <h1 className="text-xl font-semibold text-gray-900">SLA Policies</h1>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            SLA timers start when an agent <strong>accepts</strong> a ticket. Each policy has its own
            multi-step reminder and escalation schedule.
          </p>
        </div>
        {can.manageWorkspace && (
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white rounded-xl text-sm font-medium hover:bg-brand-700">
            <Plus className="w-4 h-4" /> New Policy
          </button>
        )}
      </div>

      {/* How it works */}
      <div className="bg-brand-50 rounded-2xl p-4 border border-brand-100">
        <p className="text-sm font-semibold text-brand-800 mb-2">How multi-step escalation works</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          {([
            { Icon: Bell,          color: 'text-amber-600 bg-amber-100',  title: '🔔 Reminder steps',    desc: 'Notify the assigned agent. Add as many as needed — e.g. 50%, 75%, 90%.' },
            { Icon: AlertTriangle, color: 'text-orange-600 bg-orange-100', title: '⚠️ L1 Escalation',     desc: 'Notify supervisors/managers. Fires when % threshold is crossed.' },
            { Icon: ShieldAlert,   color: 'text-red-600 bg-red-100',       title: '🚨 L2 Escalation',     desc: 'Notify admins. Used for critical or long-overdue breaches.' },
          ] as const).map(({ Icon, color, title, desc }) => (
            <div key={title} className="flex items-start gap-2 bg-white rounded-xl p-3">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
                <Icon className="w-4 h-4" />
              </div>
              <div>
                <p className="font-semibold text-gray-800">{title}</p>
                <p className="text-gray-500 mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Policies */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-300" /></div>
      ) : (
        <div className="space-y-4">
          {data.map(p => (
            <PolicyCard key={p.id} p={p}
              canEdit={can.manageWorkspace}
              onEdit={() => setEditing(p)}
              onDelete={() => { if (confirm(`Delete policy "${p.name}"?`)) deleteMutation.mutate(p.id); }}
            />
          ))}
          {data.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <Clock className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No SLA policies yet. Create one to start tracking response times.</p>
            </div>
          )}
        </div>
      )}

      {(showCreate || editing) && (
        <SlaModal
          policy={editing}
          onClose={() => { setShowCreate(false); setEditing(undefined); }}
        />
      )}
    </div>
  );
}
