import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  CreditCard, Building2, Smartphone, Banknote, ArrowRight,
  CheckCircle, AlertCircle, FileText, TrendingUp, Users,
  Phone, Zap, BarChart3, ChevronDown, ChevronUp,
} from 'lucide-react';
import { api } from '../services/api';
import { useAuthStore } from '../store/auth.store';
import { useCan } from '../hooks/useRole';
import type { Currency, PaymentProvider } from '@crm/shared';

type Plan = 'starter' | 'professional' | 'enterprise';
type Cycle = 'monthly' | 'annual';

const PLAN_FEATURES: Record<Plan, string[]> = {
  starter:      ['5 seats', '5,000 contacts', '3 pipelines', 'Voice bot (100 min/mo)', 'API access', 'Webhooks'],
  professional: ['25 seats', '50,000 contacts', '10 pipelines', 'Voice bot (1,000 min/mo)', 'SSO', 'Audit log', 'Priority support'],
  enterprise:   ['Unlimited everything', 'Custom voice minutes', 'Dedicated onboarding', 'SLA guarantee', 'Custom integrations'],
};

const PROVIDERS: Record<string, Array<{ id: PaymentProvider; label: string; icon: any; note: string }>> = {
  PKR: [
    { id: 'raast',     label: 'Raast',       icon: Banknote,    note: 'Instant — any Pakistani bank (HBL, MCB, UBL, Meezan…)' },
    { id: 'jazzcash',  label: 'JazzCash',    icon: Smartphone,  note: 'Jazz/Warid mobile wallet' },
    { id: 'easypaisa', label: 'Easypaisa',   icon: Smartphone,  note: 'Telenor mobile wallet' },
    { id: 'wise',      label: 'Wise',        icon: Building2,   note: 'Bank transfer — good for businesses' },
  ],
  USD: [
    { id: 'stripe', label: 'Card (Visa/Mastercard)', icon: CreditCard, note: 'Instant — all major cards' },
    { id: 'wise',   label: 'Wise',                   icon: Building2,  note: 'Bank transfer — low fees for international' },
  ],
  GBP: [
    { id: 'stripe', label: 'Card (Visa/Mastercard)', icon: CreditCard, note: 'Instant' },
    { id: 'wise',   label: 'Wise',                   icon: Building2,  note: 'UK bank transfer' },
  ],
  EUR: [
    { id: 'stripe', label: 'Card',  icon: CreditCard, note: 'Instant' },
    { id: 'wise',   label: 'Wise',  icon: Building2,  note: 'SEPA transfer' },
  ],
  AED: [
    { id: 'stripe', label: 'Card',  icon: CreditCard, note: 'Instant' },
    { id: 'wise',   label: 'Wise',  icon: Building2,  note: 'UAE bank transfer' },
  ],
  SAR: [
    { id: 'stripe', label: 'Card',  icon: CreditCard, note: 'Instant' },
    { id: 'wise',   label: 'Wise',  icon: Building2,  note: 'Saudi bank transfer' },
  ],
};

const CURRENCY_LABELS: Record<string, string> = {
  PKR: '🇵🇰 PKR', USD: '🇺🇸 USD', GBP: '🇬🇧 GBP', EUR: '🇪🇺 EUR', AED: '🇦🇪 AED', SAR: '🇸🇦 SAR',
};

const USAGE_ICONS: Record<string, any> = {
  contacts: Users, seats: Users, pipelines: TrendingUp,
  voiceMinutesPerMonth: Phone, apiCallsPerMonth: Zap,
};

function formatAmount(amount: number, currency: string): string {
  const display = amount / 100;
  if (currency === 'PKR') return `₨ ${display.toLocaleString('en-PK')}`;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(display);
}

function UsageMeter({ item }: { item: any }) {
  const unlimited = item.limit === -1;
  const pct = unlimited || item.limit === 0 ? 0 : Math.min(100, Math.round((item.used / item.limit) * 100));
  const warn = pct >= 80;
  const Icon = USAGE_ICONS[item.key] ?? BarChart3;

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${warn ? 'text-amber-500' : 'text-gray-400'}`} />
          <span className="text-xs font-medium text-gray-600">{item.label}</span>
        </div>
        <span className={`text-xs font-semibold ${warn ? 'text-amber-600' : 'text-gray-500'}`}>
          {item.used.toLocaleString()} {unlimited ? '' : `/ ${item.limit === 0 ? '—' : item.limit.toLocaleString()}`}
          {unlimited && <span className="text-brand-500 ml-1">∞</span>}
        </span>
      </div>
      {!unlimited && item.limit > 0 && (
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              pct >= 90 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-400' : 'bg-brand-500'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

export function Billing() {
  const { tenant } = useAuthStore();
  const can = useCan();

  const [selectedPlan, setSelectedPlan] = useState<Plan>('professional');
  const [cycle, setCycle] = useState<Cycle>('monthly');
  const [currency, setCurrency] = useState<string>(
    tenant?.settings?.locale === 'pk' || (tenant?.settings as any)?.currency === 'PKR' ? 'PKR' : 'USD',
  );
  const [provider, setProvider] = useState<PaymentProvider | null>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [billingDetails, setBillingDetails] = useState({
    name: tenant?.name ?? '', email: '', phone: '', ntn: '',
    address: { line1: '', city: '', country: currency === 'PKR' ? 'PK' : 'US' },
  });

  const { data: pricingData } = useQuery({
    queryKey: ['billing-pricing', currency],
    queryFn: () => api.get(`/api/v1/billing/pricing?currency=${currency}`).then((r) => r.data.data),
  });

  const { data: usageData } = useQuery({
    queryKey: ['billing-usage'],
    queryFn: () => api.get('/api/v1/billing/usage').then((r) => r.data.data),
    staleTime: 60_000,
  });

  const { data: subscription } = useQuery({
    queryKey: ['billing-subscription'],
    queryFn: () => api.get('/api/v1/billing/subscription').then((r) => r.data.data),
  });

  const { data: invoices } = useQuery({
    queryKey: ['billing-invoices'],
    queryFn: () => api.get('/api/v1/billing/invoices').then((r) => r.data.data),
  });

  const checkoutMutation = useMutation({
    mutationFn: () => api.post('/api/v1/billing/checkout', {
      plan: selectedPlan, billingCycle: cycle, currency, provider, billingDetails,
    }),
    onSuccess: (res) => {
      const payment = res.data.data.payment;
      if (payment.redirectUrl) {
        window.location.href = payment.redirectUrl;
      } else if (payment.bankDetails) {
        alert(
          `Transfer ${formatAmount(payment.amount ?? 0, currency)} to:\n\n` +
          `Bank: ${payment.bankDetails.bankName}\nAccount: ${payment.bankDetails.accountNumber}\n` +
          `IBAN: ${payment.bankDetails.iban}\nReference: ${payment.bankDetails.reference}\n\n` +
          `Your plan activates once payment is confirmed.`,
        );
      }
    },
  });

  const pricing       = pricingData?.pricing ?? [];
  const availableProviders = PROVIDERS[currency] ?? PROVIDERS.USD;
  const isPKR         = currency === 'PKR';
  const currentPlan   = tenant?.plan ?? 'free';

  const getPriceForPlan = (plan: Plan) =>
    pricing.find((p: any) => p.plan === plan && p.billingCycle === cycle && p.currency === currency);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6 pb-12">

      {/* ── Page header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Plans & Billing</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Current plan: <span className="font-semibold text-brand-600 capitalize">{currentPlan}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={currency}
            onChange={(e) => { setCurrency(e.target.value); setProvider(null); }}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 outline-none focus:border-brand-400"
          >
            {Object.entries(CURRENCY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          {can.manageWorkspace && (
            <button
              onClick={() => setShowUpgrade(!showUpgrade)}
              className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700"
            >
              {showUpgrade ? <><ChevronUp className="w-4 h-4" /> Hide Plans</> : <><TrendingUp className="w-4 h-4" /> Upgrade Plan</>}
            </button>
          )}
        </div>
      </div>

      {/* ── Active subscription banner ── */}
      {subscription && (
        <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
          <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-green-800">
              Active — <span className="capitalize">{subscription.plan}</span> plan
            </p>
            <p className="text-xs text-green-600 mt-0.5">
              Renews {new Date(subscription.current_period_end).toLocaleDateString()} · Paid via {subscription.provider?.toUpperCase()}
            </p>
          </div>
          {can.manageWorkspace && (
            <button
              onClick={() => api.post('/api/v1/billing/subscription/cancel')}
              className="text-xs text-red-500 hover:text-red-600 hover:underline shrink-0"
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {/* ── Usage meters ── */}
      {usageData && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Usage — {new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {usageData.usage.map((item: any) => (
              <UsageMeter key={item.key} item={item} />
            ))}
          </div>
          {usageData.usage.some((u: any) => u.limit > 0 && u.used / u.limit >= 0.8) && (
            <div className="mt-3 flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 px-4 py-2 rounded-xl">
              <AlertCircle className="w-4 h-4 shrink-0" />
              Some limits are near capacity. Consider upgrading your plan.
            </div>
          )}
        </div>
      )}

      {/* ── Plan cards + upgrade flow ── */}
      {showUpgrade && (
        <div className="space-y-5">
          {/* Billing cycle toggle */}
          <div className="flex items-center justify-center gap-3">
            {(['monthly', 'annual'] as Cycle[]).map((c) => (
              <button key={c}
                onClick={() => setCycle(c)}
                className={`relative px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
                  cycle === c ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                }`}>
                {c === 'monthly' ? 'Monthly' : 'Annual'}
                {c === 'annual' && (
                  <span className="absolute -top-2 -right-2 text-xs bg-emerald-500 text-white px-1.5 py-0.5 rounded-full">-20%</span>
                )}
              </button>
            ))}
          </div>

          {/* Plan cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(['starter', 'professional', 'enterprise'] as Plan[]).map((plan) => {
              const p = getPriceForPlan(plan);
              const isSelected = selectedPlan === plan;
              const isCurrent  = currentPlan === plan;

              return (
                <div key={plan} onClick={() => setSelectedPlan(plan)}
                  className={`relative cursor-pointer rounded-2xl border-2 p-5 transition-all ${
                    isSelected ? 'border-brand-500 shadow-lg shadow-brand-100' : 'border-gray-100 hover:border-gray-300'
                  }`}>
                  {plan === 'professional' && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs bg-brand-600 text-white px-3 py-1 rounded-full font-medium">
                      Most Popular
                    </div>
                  )}
                  {isCurrent && (
                    <span className="absolute top-3 right-3 text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Current</span>
                  )}
                  <h3 className="text-lg font-bold text-gray-900 capitalize">{plan}</h3>
                  <div className="mt-2 mb-4">
                    {plan === 'enterprise' ? (
                      <p className="text-2xl font-bold text-gray-900">Custom</p>
                    ) : p ? (
                      <>
                        <p className="text-2xl font-bold text-gray-900">{formatAmount(p.displayAmount * 100, currency)}</p>
                        <p className="text-xs text-gray-400">/ {cycle === 'annual' ? 'year' : 'month'}</p>
                      </>
                    ) : (
                      <p className="text-sm text-gray-400">—</p>
                    )}
                  </div>
                  <ul className="space-y-1.5">
                    {PLAN_FEATURES[plan].map((f) => (
                      <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                        <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />{f}
                      </li>
                    ))}
                  </ul>
                  {isSelected && <div className="mt-4 h-1 w-full bg-brand-500 rounded-full" />}
                </div>
              );
            })}
          </div>

          {/* Payment method */}
          {selectedPlan !== 'enterprise' && (
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Payment Method</h3>
              {isPKR && (
                <p className="text-xs text-amber-600 mb-3 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  Prices include 18% GST as required by FBR. NTN required for tax invoices.
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {availableProviders.map(({ id, label, icon: Icon, note }) => (
                  <button key={id} onClick={() => setProvider(id)}
                    className={`flex items-start gap-3 p-3 rounded-xl border-2 text-left transition-all ${
                      provider === id ? 'border-brand-500 bg-brand-50' : 'border-gray-100 hover:border-gray-300'
                    }`}>
                    <div className={`p-2 rounded-lg ${provider === id ? 'bg-brand-100' : 'bg-gray-100'}`}>
                      <Icon className={`w-4 h-4 ${provider === id ? 'text-brand-600' : 'text-gray-500'}`} />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">{label}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{note}</p>
                    </div>
                    {provider === id && <CheckCircle className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />}
                  </button>
                ))}
              </div>

              {isPKR && provider && (
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">NTN (for tax invoice)</label>
                    <input placeholder="0000000-0" value={billingDetails.ntn}
                      onChange={(e) => setBillingDetails({ ...billingDetails, ntn: e.target.value })}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-brand-400" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Mobile number</label>
                    <input placeholder="+92 3XX XXXXXXX" value={billingDetails.phone}
                      onChange={(e) => setBillingDetails({ ...billingDetails, phone: e.target.value })}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-brand-400" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Billing email *</label>
                    <input type="email" placeholder="accounts@yourcompany.pk" value={billingDetails.email}
                      onChange={(e) => setBillingDetails({ ...billingDetails, email: e.target.value })}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-brand-400" />
                  </div>
                </div>
              )}

              {!isPKR && provider && (
                <div className="mt-4">
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Billing email *</label>
                  <input type="email" placeholder="billing@yourcompany.com" value={billingDetails.email}
                    onChange={(e) => setBillingDetails({ ...billingDetails, email: e.target.value })}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-brand-400" />
                </div>
              )}

              {provider && (
                <button
                  onClick={() => checkoutMutation.mutate()}
                  disabled={checkoutMutation.isPending || !billingDetails.email}
                  className="mt-5 w-full flex items-center justify-center gap-2 px-5 py-3 bg-brand-600 text-white rounded-xl font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
                >
                  {checkoutMutation.isPending ? 'Processing…' : <><ArrowRight className="w-4 h-4" /> Proceed to Payment</>}
                </button>
              )}
            </div>
          )}

          {selectedPlan === 'enterprise' && (
            <div className="bg-gray-50 rounded-2xl p-6 text-center">
              <p className="text-sm text-gray-600 mb-3">Enterprise pricing is custom. Let's talk.</p>
              <a href="mailto:sales@yourcrm.com"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700">
                Contact Sales <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          )}
        </div>
      )}

      {/* ── Invoice history ── */}
      {(invoices?.length ?? 0) > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Invoice History</h2>
          <div className="space-y-2">
            {(invoices ?? []).map((inv: any) => (
              <div key={inv.id} className="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
                <div className="flex items-center gap-3">
                  <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{inv.invoice_number}</p>
                    <p className="text-xs text-gray-400">
                      {new Date(inv.created_at).toLocaleDateString()} · {inv.provider?.toUpperCase()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    inv.status === 'paid' ? 'bg-green-100 text-green-700' :
                    inv.status === 'open' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
                  }`}>{inv.status}</span>
                  <span className="text-sm font-semibold text-gray-900">
                    {formatAmount(inv.total, inv.currency)}
                  </span>
                  <a href={`/api/v1/billing/invoices/${inv.id}/pdf`} target="_blank" rel="noreferrer"
                    className="text-xs text-brand-600 hover:underline">PDF</a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
