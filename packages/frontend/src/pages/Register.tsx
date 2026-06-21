/**
 * Multi-step self-service registration
 *  Step 1 — Select sector (industry)
 *  Step 2 — Organisation + admin account details
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, ArrowRight, ArrowLeft, Check, Plus } from 'lucide-react';
import { api } from '../services/api';
import { useAuthStore } from '../store/auth.store';
import { SECTORS } from '@crm/shared';

// ── helpers ────────────────────────────────────────────────────────────────
function slugify(v: string) {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

export function RegisterPage() {
  const navigate   = useNavigate();
  const { login }  = useAuthStore();
  const [step, setStep]       = useState<1 | 2>(1);
  const [sector, setSector]   = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const [form, setForm] = useState({
    tenantName: '',
    tenantSlug: '',
    name: '',
    email: '',
    password: '',
    confirm: '',
    phone: '',
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setForm(prev => {
      const next = { ...prev, [k]: val };
      if (k === 'tenantName') next.tenantSlug = slugify(val);
      if (k === 'tenantSlug') next.tenantSlug = slugify(val);
      return next;
    });
  };

  const selectedSector = SECTORS.find(s => s.id === sector);

  // ── Step 1: sector picker ────────────────────────────────────────────────
  if (step === 1) {
    return (
      <div className="min-h-screen flex" style={{ background: 'linear-gradient(135deg, #03192a 0%, #062840 50%, #0a4162 100%)' }}>
        {/* Left branding */}
        <div className="hidden lg:flex lg:w-2/5 flex-col items-center justify-center px-12 relative overflow-hidden">
          <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full opacity-10"
               style={{ background: 'radial-gradient(circle, #29ABE2 0%, transparent 70%)' }} />
          <div className="absolute -bottom-24 -right-16 w-64 h-64 rounded-full opacity-10"
               style={{ background: 'radial-gradient(circle, #4D8B3C 0%, transparent 70%)' }} />
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6 shadow-2xl"
               style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #4D8B3C 100%)' }}>
            <svg viewBox="0 0 24 24" className="w-9 h-9 fill-white" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white text-center mb-3">Your CRM, Your Industry</h1>
          <p className="text-blue-200 text-center text-sm leading-relaxed max-w-xs">
            We tailor the CRM to your sector — pre-loaded with the right fields, departments, and workflows from day one.
          </p>
          <div className="mt-10 space-y-3 w-full max-w-xs">
            {['Pre-built sector fields', 'Department structure auto-created', 'Role-based access built in', 'Customisable beyond defaults'].map(feat => (
              <div key={feat} className="flex items-center gap-3 text-sm text-blue-100">
                <div className="w-5 h-5 rounded-full bg-emerald-400 flex items-center justify-center shrink-0">
                  <Check className="w-3 h-3 text-white" />
                </div>
                {feat}
              </div>
            ))}
          </div>
        </div>

        {/* Right: sector grid */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 overflow-y-auto">
          <div className="w-full max-w-2xl">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-white mb-2">What best describes your business?</h2>
              <p className="text-blue-300 text-sm">Select your industry to get a CRM configured for you</p>
            </div>

            {/* Sector grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
              {SECTORS.map(s => {
                const active = sector === s.id;
                return (
                  <button key={s.id} onClick={() => setSector(s.id)}
                    className={`group relative flex flex-col items-center text-center p-4 rounded-2xl border-2 transition-all duration-200 ${
                      active
                        ? 'border-transparent shadow-lg scale-[1.03]'
                        : 'border-white/10 bg-white/5 hover:border-white/25 hover:bg-white/10'
                    }`}
                    style={active ? { background: s.color, borderColor: s.color } : {}}>
                    {active && (
                      <div className="absolute top-2 right-2 w-5 h-5 bg-white rounded-full flex items-center justify-center">
                        <Check className="w-3 h-3" style={{ color: s.color }} />
                      </div>
                    )}
                    <span className="text-3xl mb-2 leading-none">{s.icon}</span>
                    <span className={`text-sm font-semibold ${active ? 'text-white' : 'text-white/90'}`}>{s.label}</span>
                    <span className={`text-[10px] mt-1 leading-tight ${active ? 'text-white/80' : 'text-white/40'} hidden sm:block`}>
                      {s.description.slice(0, 45)}{s.description.length > 45 ? '…' : ''}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Selected summary */}
            {selectedSector && (
              <div className="mb-6 p-4 rounded-xl border border-white/10 bg-white/5 flex items-start gap-3">
                <span className="text-2xl">{selectedSector.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-white">{selectedSector.label} — Ready to go</p>
                  <p className="text-xs text-blue-200 mt-0.5">
                    Contacts labelled as <strong className="text-white">{selectedSector.contactLabel}</strong> ·{' '}
                    <strong className="text-white">{selectedSector.fields.length}</strong> pre-built fields ·{' '}
                    Departments: {selectedSector.departments.slice(0,3).join(', ')}{selectedSector.departments.length > 3 ? ', …' : ''}
                  </p>
                </div>
              </div>
            )}

            <button onClick={() => { if (sector) setStep(2); }}
              disabled={!sector}
              className="w-full py-3 rounded-xl font-semibold text-white flex items-center justify-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: sector ? 'linear-gradient(135deg, #29ABE2 0%, #4D8B3C 100%)' : undefined, backgroundColor: sector ? undefined : '#334155' }}>
              Continue <ArrowRight className="w-4 h-4" />
            </button>

            <p className="text-center text-sm text-blue-300 mt-4">
              Already have an account?{' '}
              <Link to="/login" className="text-white font-medium hover:underline">Sign in</Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Step 2: account details ──────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) { setError('Passwords do not match'); return; }
    // Match the API's full ruleset so users don't get a confusing server-side error after submit.
    if (form.password.length < 8)              { setError('Password must be at least 8 characters'); return; }
    if (!/[A-Z]/.test(form.password))           { setError('Password must contain at least one UPPERCASE letter (A-Z)'); return; }
    if (!/[a-z]/.test(form.password))           { setError('Password must contain at least one lowercase letter (a-z)'); return; }
    if (!/[0-9]/.test(form.password))           { setError('Password must contain at least one number (0-9)'); return; }
    if (!/[^A-Za-z0-9]/.test(form.password))    { setError('Password must contain at least one special character (!, @, #, etc.)'); return; }
    setLoading(true);
    try {
      await api.post('/auth/register', {
        tenantName: form.tenantName,
        tenantSlug: slugify(form.tenantSlug),
        name:       form.name,
        email:      form.email,
        password:   form.password,
        phone:      form.phone || undefined,
        sector,
      });
      // Auto-login after registration
      await login(form.email, form.password, slugify(form.tenantSlug));
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.error?.message ?? 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex" style={{ background: 'linear-gradient(135deg, #03192a 0%, #062840 50%, #0a4162 100%)' }}>
      {/* Left branding */}
      <div className="hidden lg:flex lg:w-2/5 flex-col items-center justify-center px-12 relative overflow-hidden">
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full opacity-10"
             style={{ background: 'radial-gradient(circle, #29ABE2 0%, transparent 70%)' }} />
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6 shadow-2xl"
             style={{ background: `linear-gradient(135deg, ${selectedSector?.color ?? '#29ABE2'} 0%, #4D8B3C 100%)` }}>
          <span className="text-3xl">{selectedSector?.icon ?? '🏢'}</span>
        </div>
        <h1 className="text-3xl font-bold text-white text-center mb-3">Almost there!</h1>
        <p className="text-blue-200 text-center text-sm leading-relaxed max-w-xs mb-6">
          Setting up your <strong className="text-white">{selectedSector?.label}</strong> CRM workspace
        </p>
        {selectedSector && (
          <div className="w-full max-w-xs space-y-2">
            <p className="text-xs font-semibold text-blue-300 uppercase tracking-wide mb-3">What you'll get</p>
            <div className="flex items-center gap-2 text-sm text-blue-100">
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{selectedSector.fields.length} pre-built contact fields</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-blue-100">
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{selectedSector.departments.length} default departments</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-blue-100">
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Contacts called "<strong className="text-white">{selectedSector.contactLabel}</strong>"</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-blue-100">
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Fully customisable</span>
            </div>
          </div>
        )}
      </div>

      {/* Right: form */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10">
        <div className="w-full max-w-md">
          <button onClick={() => setStep(1)}
            className="flex items-center gap-1.5 text-sm text-blue-300 hover:text-white mb-6 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to sector selection
          </button>

          {/* Sector badge */}
          {selectedSector && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-6"
                 style={{ background: `${selectedSector.color}25`, color: selectedSector.color, border: `1px solid ${selectedSector.color}40` }}>
              {selectedSector.icon} {selectedSector.label}
            </div>
          )}

          <h2 className="text-2xl font-bold text-white mb-1">Create your workspace</h2>
          <p className="text-blue-300 text-sm mb-8">14-day free trial · No credit card required</p>

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 text-sm">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Organisation */}
            <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-3">
              <p className="text-xs font-semibold text-blue-300 uppercase tracking-wide">Organisation</p>
              <div>
                <label className="block text-xs text-blue-200 mb-1">Organisation Name *</label>
                <input value={form.tenantName} onChange={set('tenantName')} required
                  placeholder={`e.g. ${selectedSector?.label ?? 'My'} Corp`}
                  className="w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-400" />
              </div>
              <div>
                <label className="block text-xs text-blue-200 mb-1">Workspace Slug *</label>
                <div className="flex items-center gap-2">
                  <input value={form.tenantSlug} onChange={set('tenantSlug')} required
                    placeholder="my-company"
                    className="flex-1 bg-white/10 border border-white/20 rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-400" />
                  <span className="text-xs text-blue-300 whitespace-nowrap">.yourcrm.com</span>
                </div>
              </div>
            </div>

            {/* Admin account */}
            <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-3">
              <p className="text-xs font-semibold text-blue-300 uppercase tracking-wide">Admin Account</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs text-blue-200 mb-1">Full Name *</label>
                  <input value={form.name} onChange={set('name')} required
                    placeholder="Your full name"
                    className="w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-400" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-blue-200 mb-1">Work Email *</label>
                  <input type="email" value={form.email} onChange={set('email')} required
                    placeholder="you@company.com"
                    className="w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-400" />
                </div>
                <div>
                  <label className="block text-xs text-blue-200 mb-1">Password *</label>
                  <input type="password" value={form.password} onChange={set('password')} required minLength={8}
                    placeholder="At least 8 chars + upper + lower + number + symbol"
                    className="w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-400" />
                  {/* Live password requirements — show only after user starts typing */}
                  {form.password.length > 0 && (() => {
                    const checks = [
                      { label: '8+ characters',   ok: form.password.length >= 8 },
                      { label: 'uppercase A-Z',   ok: /[A-Z]/.test(form.password) },
                      { label: 'lowercase a-z',   ok: /[a-z]/.test(form.password) },
                      { label: 'number 0-9',      ok: /[0-9]/.test(form.password) },
                      { label: 'symbol !@#$',     ok: /[^A-Za-z0-9]/.test(form.password) },
                    ];
                    return (
                      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                        {checks.map((c) => (
                          <span key={c.label} className={`flex items-center gap-1 ${c.ok ? 'text-emerald-300' : 'text-white/40'}`}>
                            <span className="font-mono w-3">{c.ok ? '✓' : '○'}</span> {c.label}
                          </span>
                        ))}
                      </div>
                    );
                  })()}
                </div>
                <div>
                  <label className="block text-xs text-blue-200 mb-1">Confirm Password *</label>
                  <input type="password" value={form.confirm} onChange={set('confirm')} required
                    placeholder="Repeat password"
                    className="w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-400" />
                  {/* Mismatch hint — only after user types in Confirm field */}
                  {form.confirm.length > 0 && form.confirm !== form.password && (
                    <p className="mt-1 text-[11px] text-amber-300 flex items-center gap-1">○ Passwords don't match yet</p>
                  )}
                </div>
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-3 rounded-xl font-semibold text-white flex items-center justify-center gap-2 transition-all disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #4D8B3C 100%)' }}>
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Creating workspace…</> : <>Create Workspace <ArrowRight className="w-4 h-4" /></>}
            </button>
          </form>

          <p className="text-center text-sm text-blue-300 mt-6">
            Already have an account?{' '}
            <Link to="/login" className="text-white font-medium hover:underline">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
