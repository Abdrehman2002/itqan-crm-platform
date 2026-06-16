import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Lock, Eye, EyeOff, CheckCircle, Loader2, ArrowLeft, AlertCircle } from 'lucide-react';
import { api } from '../services/api';

export function ResetPassword() {
  const [params]    = useSearchParams();
  const navigate    = useNavigate();
  const token       = params.get('token') ?? '';

  const [password,  setPassword]  = useState('');
  const [confirm,   setConfirm]   = useState('');
  const [showPw,    setShowPw]    = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [done,      setDone]      = useState(false);
  const [error,     setError]     = useState('');

  // Password strength
  const hasLength  = password.length >= 8;
  const hasUpper   = /[A-Z]/.test(password);
  const hasNumber  = /\d/.test(password);
  const strength   = [hasLength, hasUpper, hasNumber].filter(Boolean).length;
  const strengthLabel = ['', 'Weak', 'Fair', 'Strong'][strength];
  const strengthColor = ['', 'text-red-400', 'text-amber-400', 'text-emerald-400'][strength];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!token) { setError('Invalid or missing reset token. Please request a new link.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    if (password.length < 8)  { setError('Password must be at least 8 characters.'); return; }

    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      setDone(true);
      setTimeout(() => navigate('/login'), 3000);
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message;
      setError(msg ?? 'Invalid or expired link. Please request a new password reset.');
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
          background:     'rgba(255,255,255,0.06)',
          backdropFilter: 'blur(20px)',
          border:         '1px solid rgba(255,255,255,0.12)',
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

        {done ? (
          /* Success state */
          <div className="text-center">
            <div className="flex justify-center mb-4">
              <CheckCircle className="w-12 h-12 text-emerald-400" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Password updated!</h2>
            <p className="text-sm text-white/60 mb-4">
              Your password has been changed successfully. Redirecting to sign in…
            </p>
            <Link
              to="/login"
              className="flex items-center justify-center gap-2 text-sm font-medium py-2.5 rounded-xl w-full"
              style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)' }}
            >
              <ArrowLeft className="w-4 h-4" />
              Sign In Now
            </Link>
          </div>
        ) : (
          <>
            <h2 className="text-xl font-bold text-white mb-1 text-center">Set new password</h2>
            <p className="text-sm text-white/50 text-center mb-6">Choose a strong password for your account</p>

            {/* No token warning */}
            {!token && (
              <div className="mb-4 px-3 py-2 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>No reset token found. Please use the link from your email or <Link to="/forgot-password" className="underline">request a new one</Link>.</span>
              </div>
            )}

            {error && (
              <div className="mb-4 px-3 py-2 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs text-center">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* New password */}
              <div>
                <label className="block text-xs font-medium text-white/60 mb-1.5">New password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min. 8 characters"
                    required
                    className="w-full pl-10 pr-10 py-2.5 rounded-xl text-sm text-white placeholder-white/25 outline-none transition-colors"
                    style={{
                      background: 'rgba(255,255,255,0.06)',
                      border:     '1px solid rgba(255,255,255,0.15)',
                    }}
                    onFocus={(e) => (e.target.style.borderColor = '#29ABE2')}
                    onBlur={(e)  => (e.target.style.borderColor = 'rgba(255,255,255,0.15)')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {/* Strength indicator */}
                {password && (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex gap-1 flex-1">
                      {[1,2,3].map((n) => (
                        <div
                          key={n}
                          className="h-1 flex-1 rounded-full transition-all"
                          style={{
                            background: n <= strength
                              ? (strength === 1 ? '#ef4444' : strength === 2 ? '#f59e0b' : '#10b981')
                              : 'rgba(255,255,255,0.1)',
                          }}
                        />
                      ))}
                    </div>
                    <span className={`text-xs font-medium ${strengthColor}`}>{strengthLabel}</span>
                  </div>
                )}
              </div>

              {/* Confirm password */}
              <div>
                <label className="block text-xs font-medium text-white/60 mb-1.5">Confirm password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Repeat password"
                    required
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm text-white placeholder-white/25 outline-none transition-colors"
                    style={{
                      background: 'rgba(255,255,255,0.06)',
                      border:     confirm && confirm !== password
                        ? '1px solid rgba(239,68,68,0.6)'
                        : confirm && confirm === password
                          ? '1px solid rgba(16,185,129,0.6)'
                          : '1px solid rgba(255,255,255,0.15)',
                    }}
                    onFocus={(e) => { if (!confirm || confirm === password) e.target.style.borderColor = '#29ABE2'; }}
                    onBlur={(e)  => {
                      if (confirm && confirm !== password) e.target.style.borderColor = 'rgba(239,68,68,0.6)';
                      else if (confirm && confirm === password) e.target.style.borderColor = 'rgba(16,185,129,0.6)';
                      else e.target.style.borderColor = 'rgba(255,255,255,0.15)';
                    }}
                  />
                </div>
                {confirm && confirm !== password && (
                  <p className="text-xs text-red-400 mt-1">Passwords do not match</p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading || !token}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-opacity disabled:opacity-60 mt-2"
                style={{
                  background: 'linear-gradient(135deg, #29ABE2 0%, #1a8cbf 100%)',
                  boxShadow:  '0 0 20px rgba(41,171,226,0.35)',
                }}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                Update Password
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
