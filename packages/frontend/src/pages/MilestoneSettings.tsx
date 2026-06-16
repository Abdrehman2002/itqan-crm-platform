/**
 * MilestoneSettings — configure step templates per ticket type
 * Route: /settings/milestones  (embedded in Settings.tsx as a tab)
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Loader2, GripVertical, CheckCircle2, X, Save } from 'lucide-react';
import { api } from '../services/api';

interface Step { id: string; label: string; description?: string; order: number; }
interface Template { id?: string; ticket_type: string; name: string; steps: Step[]; }

const TICKET_TYPES = [
  { value: 'complaint', label: '🎫 Complaint',  color: 'red',    desc: 'Customer complaints and issues'     },
  { value: 'inquiry',   label: '💬 Inquiry',    color: 'blue',   desc: 'Product and service enquiries'      },
  { value: 'sales',     label: '💼 Sales',      color: 'green',  desc: 'Sales leads and purchase requests'  },
];

const DEFAULT_STEPS: Record<string, Step[]> = {
  complaint: [
    { id: 'c1', label: 'Acknowledge & Accept',          description: 'Confirm receipt and acknowledge the complaint', order: 0 },
    { id: 'c2', label: 'Investigate Issue',              description: 'Gather information and investigate root cause',  order: 1 },
    { id: 'c3', label: 'Propose Solution',               description: 'Prepare and communicate resolution plan',        order: 2 },
    { id: 'c4', label: 'Implement Resolution',           description: 'Execute the agreed resolution',                  order: 3 },
    { id: 'c5', label: 'Confirm with Customer',          description: 'Verify customer is satisfied with the resolution', order: 4 },
  ],
  inquiry: [
    { id: 'i1', label: 'Received & Assigned',            description: 'Inquiry received and routed to the right team', order: 0 },
    { id: 'i2', label: 'Information Gathered',           description: 'All relevant information collected',             order: 1 },
    { id: 'i3', label: 'Response Sent',                  description: 'Detailed response provided to customer',         order: 2 },
    { id: 'i4', label: 'Follow-up Completed',            description: 'Customer confirmed satisfaction',                order: 3 },
  ],
  sales: [
    { id: 's1', label: 'Lead Qualified',                 description: 'Lead reviewed and qualified by sales team',      order: 0 },
    { id: 's2', label: 'Initial Contact Made',           description: 'First contact and needs assessment completed',   order: 1 },
    { id: 's3', label: 'Proposal / Demo Sent',           description: 'Product demo or proposal delivered',             order: 2 },
    { id: 's4', label: 'Negotiation in Progress',        description: 'Commercial terms being discussed',               order: 3 },
    { id: 's5', label: 'Deal Closed / Converted',        description: 'Customer confirmed and order placed',            order: 4 },
  ],
};

function uid() { return Math.random().toString(36).slice(2, 9); }

function StepEditor({ steps, onChange }: { steps: Step[]; onChange: (s: Step[]) => void }) {
  const addStep = () => onChange([...steps, { id: uid(), label: '', order: steps.length }]);
  const updateStep = (idx: number, val: Partial<Step>) =>
    onChange(steps.map((s, i) => i === idx ? { ...s, ...val } : s));
  const removeStep = (idx: number) =>
    onChange(steps.filter((_, i) => i !== idx).map((s, i) => ({ ...s, order: i })));

  return (
    <div className="space-y-2">
      {steps.map((step, idx) => (
        <div key={step.id} className="flex items-center gap-2 bg-gray-50 rounded-xl p-2.5 group">
          <GripVertical className="w-3.5 h-3.5 text-gray-300 shrink-0 cursor-grab" />
          <div className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-[10px] font-bold flex items-center justify-center shrink-0">
            {idx + 1}
          </div>
          <input
            value={step.label}
            onChange={e => updateStep(idx, { label: e.target.value })}
            placeholder="Step label *"
            className="flex-1 text-sm border border-gray-200 bg-white rounded-lg px-2.5 py-1.5 outline-none focus:border-brand-400"
          />
          <input
            value={step.description ?? ''}
            onChange={e => updateStep(idx, { description: e.target.value })}
            placeholder="Description (optional)"
            className="flex-1 text-xs border border-gray-200 bg-white rounded-lg px-2.5 py-1.5 outline-none focus:border-brand-400 text-gray-500"
          />
          <button onClick={() => removeStep(idx)} className="text-gray-300 hover:text-red-500 p-0.5">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <button onClick={addStep}
        className="w-full py-2 border border-dashed border-brand-300 rounded-xl text-xs text-brand-600 hover:bg-brand-50 transition-colors flex items-center justify-center gap-1.5">
        <Plus className="w-3.5 h-3.5" /> Add Step
      </button>
    </div>
  );
}

export function MilestoneSettings() {
  const qc = useQueryClient();
  const [activeType, setActiveType] = useState('complaint');
  const [steps, setSteps] = useState<Record<string, Step[]>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  const { data: templates = [], isLoading } = useQuery<Template[]>({
    queryKey: ['milestone-templates'],
    queryFn: async () => (await api.get('/api/v1/settings/milestone-templates')).data.data,
    onSuccess: (data: Template[]) => {
      const s: Record<string, Step[]> = {};
      const n: Record<string, string> = {};
      data.forEach(t => {
        s[t.ticket_type] = t.steps;
        n[t.ticket_type] = t.name;
      });
      setSteps(s);
      setNames(n);
    },
  });

  const saveMutation = useMutation({
    mutationFn: (ticketType: string) =>
      api.put(`/api/v1/settings/milestone-templates/${ticketType}`, {
        name:  names[ticketType] ?? ticketType,
        steps: (steps[ticketType] ?? DEFAULT_STEPS[ticketType] ?? []).map((s, i) => ({ ...s, order: i })),
      }),
    onSuccess: (_, ticketType) => {
      qc.invalidateQueries({ queryKey: ['milestone-templates'] });
      setSaved(prev => ({ ...prev, [ticketType]: true }));
      setTimeout(() => setSaved(prev => ({ ...prev, [ticketType]: false })), 2500);
    },
  });

  const getSteps = (type: string) =>
    steps[type] ?? templates.find(t => t.ticket_type === type)?.steps ?? DEFAULT_STEPS[type] ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Ticket Milestone Templates</h2>
        <p className="text-sm text-gray-500 mt-1">
          Define step-by-step milestones for each ticket type. Agents follow these steps and customers
          are notified on each completion.
        </p>
      </div>

      {/* Type tabs */}
      <div className="flex gap-2">
        {TICKET_TYPES.map(t => (
          <button key={t.value} onClick={() => setActiveType(t.value)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              activeType === t.value
                ? 'bg-brand-600 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}>
            {t.label}
            {templates.find(tmpl => tmpl.ticket_type === t.value) && (
              <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
            )}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-brand-500" /></div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
          {/* Template name */}
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Template Name</label>
            <input
              value={names[activeType] ?? TICKET_TYPES.find(t => t.value === activeType)?.label ?? ''}
              onChange={e => setNames(prev => ({ ...prev, [activeType]: e.target.value }))}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-400 w-full max-w-sm"
              placeholder="Template name..."
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Steps</p>
              <p className="text-xs text-gray-400">Agents check off each step — customers notified on completion</p>
            </div>
            <StepEditor
              steps={getSteps(activeType)}
              onChange={s => setSteps(prev => ({ ...prev, [activeType]: s }))}
            />
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-gray-100">
            <button
              onClick={() => setSteps(prev => ({ ...prev, [activeType]: DEFAULT_STEPS[activeType] ?? [] }))}
              className="text-xs text-gray-400 hover:text-gray-600">
              Reset to defaults
            </button>
            <button
              onClick={() => saveMutation.mutate(activeType)}
              disabled={saveMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-xl text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
              {saveMutation.isPending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : saved[activeType]
                  ? <CheckCircle2 className="w-3.5 h-3.5" />
                  : <Save className="w-3.5 h-3.5" />}
              {saved[activeType] ? 'Saved!' : 'Save Template'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm">
        <p className="font-medium text-blue-800 mb-1">How milestones work</p>
        <ul className="text-xs text-blue-700 space-y-1 list-disc list-inside">
          <li>When a ticket is created (manually or by voice bot), it gets a copy of this milestone template</li>
          <li>Agents check off steps as they complete them</li>
          <li>On each step completion, the customer is notified via their preferred channel</li>
          <li>A progress bar on the ticket card shows overall completion %</li>
          <li>If no template is defined, the progress bar is hidden</li>
        </ul>
      </div>
    </div>
  );
}
