import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuthStore } from '../store/auth.store';

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const [form, setForm] = useState({ email: '', password: '', tenantSlug: 'vextria' });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Auto-detect slug only from a real tenant subdomain (e.g. acme.yourcrm.com).
  // On *.vercel.app, localhost, or a bare domain, show the Workspace field instead.
  const host = window.location.hostname;
  const detectedSlug = host.split('.')[0];
  const isSubdomain = detectedSlug !== 'localhost' && detectedSlug !== 'www'
    && !host.endsWith('.vercel.app') && host.split('.').length > 2;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(form.email, form.password, isSubdomain ? undefined : form.tenantSlug);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.error?.message ?? 'Invalid credentials. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex"
      style={{ background: 'linear-gradient(135deg, #03192a 0%, #062840 40%, #0a4162 70%, #0f5c85 100%)' }}
    >
      {/* ── Left panel: branding ─────────────────────────────────────── */}
      <div className="hidden lg:flex lg:w-1/2 flex-col items-center justify-center px-16 relative overflow-hidden">
        {/* Decorative circles */}
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full opacity-10"
             style={{ background: 'radial-gradient(circle, #29ABE2 0%, transparent 70%)' }} />
        <div className="absolute -bottom-24 -right-16 w-80 h-80 rounded-full opacity-10"
             style={{ background: 'radial-gradient(circle, #4D8B3C 0%, transparent 70%)' }} />

        {/* Logo mark */}
        <div
          className="w-20 h-20 rounded-3xl flex items-center justify-center mb-8 shadow-2xl"
          style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #4D8B3C 100%)' }}
        >
          <svg viewBox="0 0 24 24" className="w-11 h-11 fill-white" xmlns="http://www.w3.org/2000/svg">
            <path d="M5 5 L10 12 L5 19 H9 L12 14.5 L15 19 H19 L14 12 L19 5 H15 L12 9.5 L9 5 Z" />
          </svg>
        </div>

        {/* Wordmark */}
        <h1 className="text-4xl font-extrabold text-white tracking-tight mb-2">
          Vivid Solutions
        </h1>
        <p className="text-lg font-medium mb-10" style={{ color: '#F5C518' }}>
          &amp; Services
        </p>

        {/* Tagline */}
        <p className="text-white/60 text-center text-base max-w-xs leading-relaxed">
          The unified workspace for customer relationships, support, and growth.
        </p>

        {/* Feature bullets */}
        <div className="mt-12 space-y-4 w-full max-w-xs">
          {[
            { dot: '#29ABE2', text: 'Full CRM — contacts, deals & pipelines' },
            { dot: '#4D8B3C', text: 'Integrated voice & ticketing support' },
            { dot: '#F5C518', text: 'Real-time analytics & SLA tracking' },
          ].map(({ dot, text }) => (
            <div key={text} className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: dot }} />
              <span className="text-white/70 text-sm">{text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Right panel: form ────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">

          {/* Mobile logo (shown only on small screens) */}
          <div className="flex lg:hidden flex-col items-center mb-8">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 shadow-lg"
              style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #4D8B3C 100%)' }}
            >
              <svg viewBox="0 0 24 24" className="w-8 h-8 fill-white" xmlns="http://www.w3.org/2000/svg">
                <path d="M5 5 L10 12 L5 19 H9 L12 14.5 L15 19 H19 L14 12 L19 5 H15 L12 9.5 L9 5 Z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-white">Vivid Solutions</h2>
            <p className="text-sm font-medium" style={{ color: '#F5C518' }}>&amp; Services</p>
          </div>

          {/* Card */}
          <div
            className="rounded-3xl p-8 shadow-2xl border"
            style={{
              background: 'rgba(255,255,255,0.05)',
              backdropFilter: 'blur(24px)',
              borderColor: 'rgba(255,255,255,0.1)',
            }}
          >
            <div className="mb-7">
              <h2 className="text-2xl font-bold text-white">Welcome back</h2>
              <p className="text-white/50 text-sm mt-1">Sign in to your workspace to continue</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">

              {/* Workspace slug — only when not on subdomain */}
              {!isSubdomain ? (
                <div>
                  <label className="block text-xs font-semibold text-white/70 mb-1.5 tracking-wide uppercase">
                    Workspace
                  </label>
                  <div
                    className="flex rounded-xl overflow-hidden border focus-within:border-brand-400 transition-colors"
                    style={{ borderColor: 'rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)' }}
                  >
                    <input
                      type="text"
                      placeholder="your-company"
                      value={form.tenantSlug}
                      onChange={(e) => setForm({ ...form, tenantSlug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                      className="flex-1 px-3 py-2.5 text-sm bg-transparent text-white placeholder-white/25 outline-none"
                      required
                    />
                    <span
                      className="px-3 flex items-center text-xs border-l"
                      style={{ color: '#29ABE2', borderColor: 'rgba(255,255,255,0.1)' }}
                    >
                      .vivid.app
                    </span>
                  </div>
                </div>
              ) : (
                <div
                  className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl border"
                  style={{ background: 'rgba(41,171,226,0.1)', borderColor: 'rgba(41,171,226,0.25)' }}
                >
                  <div className="w-2 h-2 rounded-full" style={{ background: '#29ABE2' }} />
                  <span className="text-sm font-semibold text-white">{detectedSlug}</span>
                  <span className="text-xs ml-auto" style={{ color: '#29ABE2' }}>workspace detected</span>
                </div>
              )}

              {/* Email */}
              <div>
                <label className="block text-xs font-semibold text-white/70 mb-1.5 tracking-wide uppercase">
                  Email address
                </label>
                <input
                  type="email"
                  placeholder="you@company.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl border text-sm bg-transparent text-white placeholder-white/25 outline-none focus:border-brand-400 transition-colors"
                  style={{ borderColor: 'rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)' }}
                  required
                />
              </div>

              {/* Password */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-white/70 tracking-wide uppercase">
                    Password
                  </label>
                  <Link to="/forgot-password" className="text-xs transition-colors hover:opacity-80"
                     style={{ color: '#29ABE2' }}>
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className="w-full px-3 py-2.5 pr-10 rounded-xl border text-sm bg-transparent text-white placeholder-white/25 outline-none focus:border-brand-400 transition-colors"
                    style={{ borderColor: 'rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)' }}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(!showPw)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/70 transition-colors"
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div
                  className="flex items-start gap-2.5 px-4 py-3 rounded-xl border text-sm"
                  style={{
                    background: 'rgba(239,68,68,0.1)',
                    borderColor: 'rgba(239,68,68,0.25)',
                    color: '#fca5a5',
                  }}
                >
                  <span className="mt-0.5 text-red-400">⚠</span>
                  {error}
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl font-semibold text-sm text-white transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg hover:shadow-xl active:scale-[0.99]"
                style={{
                  background: loading
                    ? 'rgba(41,171,226,0.5)'
                    : 'linear-gradient(135deg, #29ABE2 0%, #1a8cbf 100%)',
                  boxShadow: '0 4px 20px rgba(41,171,226,0.3)',
                }}
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>

            {/* Divider + register */}
            <div className="mt-6 pt-6 border-t text-center" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
              <p className="text-sm text-white/40">
                Don't have an account?{' '}
                <Link
                  to="/register"
                  className="font-semibold transition-colors hover:opacity-80"
                  style={{ color: '#F5C518' }}
                >
                  Start free trial →
                </Link>
              </p>
            </div>
          </div>

          {/* Footer note */}
          <p className="mt-6 text-center text-xs text-white/25">
            © {new Date().getFullYear()} Vivid Solutions &amp; Services. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
