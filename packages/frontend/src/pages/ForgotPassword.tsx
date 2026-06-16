import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowLeft, CheckCircle, Loader2 } from 'lucide-react';
import { api } from '../services/api';

export function ForgotPassword() {
  const [email,      setEmail]      = useState('');
  const [tenantSlug, setTenantSlug] = useState('');
  const [loading,    setLoading]    = useState(false);
  const [sent,       setSent]       = useState(false);
  const [error,      setError]      = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!email || !tenantSlug) { setError('Both fields are required.'); return; }
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email, tenantSlug });
      setSent(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'linear-gradient(135deg, #03192a 0%, #062840 40%, #0a4162 70%, #0f5c85 100%)' }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-8"
        style={{
          background:   'rgba(255,255,255,0.06)',
          backdropFilter: 'blur(20px)',
          border:       '1px solid rgba(255,255,255,0.12)',
        }}
      >
        {/* Logo mark */}
        <div className="flex justify-center mb-6">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #4D8B3C 100%)' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M3 12L9 6L15 12L21 6" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3 18L9 12L15 18L21 12" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        {sent ? (
          /* Success state */
          <div className="text-center">
            <div className="flex justify-center mb-4">
              <CheckCircle className="w-12 h-12 text-emerald-400" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Check your inbox</h2>
            <p className="text-sm text-white/60 mb-6">
              If an account with <span className="text-white/80 font-medium">{email}</span> exists in workspace
              <span className="text-white/80 font-medium"> {tenantSlug}</span>, you'll receive a reset link shortly.
            </p>
            <Link
              to="/login"
              className="flex items-center justify-center gap-2 text-sm font-medium py-2.5 rounded-xl w-full"
              style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)' }}
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Sign In
            </Link>
          </div>
        ) : (
          /* Form state */
          <>
            <h2 className="text-xl font-bold text-white mb-1 text-center">Forgot password?</h2>
            <p className="text-sm text-white/50 text-center mb-6">
              Enter your workspace and email to receive a reset link
            </p>

            {error && (
              <div className="mb-4 px-3 py-2 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs text-center">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-white/60 mb-1.5">Workspace slug</label>
                <input
                  type="text"
                  value={tenantSlug}
                  onChange={(e) => setTenantSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="your-workspace"
                  required
                  className="w-full px-4 py-2.5 rounded-xl text-sm text-white placeholder-white/25 outline-none transition-colors"
                  style={{
                    background:   'rgba(255,255,255,0.06)',
                    border:       '1px solid rgba(255,255,255,0.15)',
                  }}
                  onFocus={(e) => (e.target.style.borderColor = '#29ABE2')}
                  onBlur={(e)  => (e.target.style.borderColor = 'rgba(255,255,255,0.15)')}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-white/60 mb-1.5">Email address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm text-white placeholder-white/25 outline-none transition-colors"
                    style={{
                      background: 'rgba(255,255,255,0.06)',
                      border:     '1px solid rgba(255,255,255,0.15)',
                    }}
                    onFocus={(e) => (e.target.style.borderColor = '#29ABE2')}
                    onBlur={(e)  => (e.target.style.borderColor = 'rgba(255,255,255,0.15)')}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-opacity disabled:opacity-60"
                style={{
                  background:  'linear-gradient(135deg, #29ABE2 0%, #1a8cbf 100%)',
                  boxShadow:   '0 0 20px rgba(41,171,226,0.35)',
                }}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                Send Reset Link
              </button>
            </form>

            <div className="mt-5 text-center">
              <Link to="/login" className="text-xs text-white/40 hover:text-white/70 flex items-center justify-center gap-1">
                <ArrowLeft className="w-3 h-3" />
                Back to Sign In
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
