import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Save, Check, User, Bell, Shield, Palette, RotateCcw, Type, Pipette, Loader2,
} from 'lucide-react';
import { api } from '../services/api';
import { useAuthStore } from '../store/auth.store';
import { useIsSuperAdmin } from '../hooks/useRole';
import {
  useAppearanceStore, FONT_OPTIONS, FONT_SIZE_OPTIONS, FONT_COLOR_PRESETS,
} from '../store/appearance.store';

type Tab = 'profile' | 'appearance' | 'notifications' | 'security';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'profile',       label: 'Profile',       icon: User    },
  { id: 'appearance',    label: 'Appearance',    icon: Palette },
  { id: 'notifications', label: 'Notifications', icon: Bell    },
  { id: 'security',      label: 'Security',      icon: Shield  },
];

// ── Profile ──────────────────────────────────────────────────────────────────

function ProfileSettings() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [name, setName]   = useState(user?.name ?? '');
  const [saved, setSaved] = useState(false);

  const mutation = useMutation({
    mutationFn: (body: { name: string }) => api.patch('/api/v1/settings/profile', body),
    onSuccess: () => {
      setSaved(true);
      qc.invalidateQueries({ queryKey: ['me'] });
      setTimeout(() => setSaved(false), 2500);
    },
  });

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Profile</h2>
        <p className="text-sm text-gray-500 mt-0.5">Your personal details visible across the workspace.</p>
      </div>

      {/* Avatar placeholder */}
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-bold shrink-0"
          style={{ background: 'linear-gradient(135deg,#29ABE2,#0a4162)' }}>
          {(user?.name ?? 'U')[0].toUpperCase()}
        </div>
        <div>
          <p className="text-sm font-medium text-gray-900">{user?.name}</p>
          <p className="text-xs text-gray-400 capitalize">{user?.role?.replace('_', ' ')}</p>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">Display Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">Email</label>
          <input
            value={user?.email ?? ''}
            disabled
            className="w-full px-3 py-2 text-sm border border-gray-100 rounded-lg bg-gray-50 text-gray-400 cursor-not-allowed"
          />
          <p className="text-[11px] text-gray-400 mt-1">Contact your admin to change your email address.</p>
        </div>
      </div>

      <button
        disabled={!name.trim() || name === user?.name || mutation.isPending}
        onClick={() => mutation.mutate({ name })}
        className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700 disabled:opacity-50"
      >
        {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
        {saved ? 'Saved!' : 'Save Profile'}
      </button>
    </div>
  );
}

// ── Appearance ────────────────────────────────────────────────────────────────

function AppearanceSettings() {
  const {
    theme, setTheme, density, setDensity,
    fontFamily, setFontFamily, fontSize, setFontSize,
    fontColor, setFontColor, reset,
  } = useAppearanceStore();

  const [saved, setSaved]         = useState(false);
  const [customColor, setCustomColor] = useState(fontColor);

  return (
    <div className="space-y-8 max-w-lg">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Appearance</h2>
          <p className="text-sm text-gray-500 mt-0.5">Customize fonts, colours, and layout density. Changes apply instantly.</p>
        </div>
        <button onClick={reset} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors pt-1">
          <RotateCcw className="w-3 h-3" /> Reset defaults
        </button>
      </div>

      {/* Live Preview */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-3">Live Preview</p>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm space-y-2"
          style={{ fontFamily, fontSize, color: fontColor }}>
          <p className="font-semibold" style={{ fontSize: `calc(${fontSize} + 2px)` }}>Sample Heading</p>
          <p>This is how your workspace text will look.</p>
          <p className="opacity-60 text-[0.85em]">Secondary / muted text appears like this.</p>
          <div className="flex gap-2 pt-1">
            <span className="px-2 py-0.5 rounded-full text-[0.8em] font-medium bg-blue-50 text-blue-700">Tag</span>
            <span className="px-2 py-0.5 rounded-full text-[0.8em] font-medium bg-green-50 text-green-700">Active</span>
          </div>
        </div>
      </div>

      {/* Theme */}
      <div>
        <p className="text-sm font-medium text-gray-700 mb-3">Theme</p>
        <div className="grid grid-cols-3 gap-3">
          {([
            { value: 'light',  label: '☀️  Light'  },
            { value: 'dark',   label: '🌙  Dark'   },
            { value: 'system', label: '💻  System' },
          ] as const).map((t) => (
            <button key={t.value} onClick={() => setTheme(t.value)}
              className={`py-3 rounded-xl border-2 text-sm font-medium transition-all ${
                theme === t.value ? 'border-[#29ABE2] text-[#29ABE2] bg-blue-50 shadow-sm' : 'border-gray-200 text-gray-500 hover:border-gray-300 bg-white'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Density */}
      <div>
        <p className="text-sm font-medium text-gray-700 mb-3">Layout Density</p>
        <div className="grid grid-cols-3 gap-3">
          {([
            { value: 'compact',     label: 'Compact',     desc: 'More content' },
            { value: 'default',     label: 'Default',     desc: 'Balanced'     },
            { value: 'comfortable', label: 'Comfortable', desc: 'More space'   },
          ] as const).map((d) => (
            <button key={d.value} onClick={() => setDensity(d.value)}
              className={`py-3 px-2 rounded-xl border-2 text-sm font-medium transition-all text-center ${
                density === d.value ? 'border-[#29ABE2] text-[#29ABE2] bg-blue-50 shadow-sm' : 'border-gray-200 text-gray-500 hover:border-gray-300 bg-white'
              }`}>
              <span className="block">{d.label}</span>
              <span className="block text-[11px] font-normal opacity-60">{d.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Font Family */}
      <div>
        <p className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-1.5">
          <Type className="w-3.5 h-3.5 text-gray-400" /> Font Family
        </p>
        <div className="grid grid-cols-1 gap-2">
          {FONT_OPTIONS.map((f) => (
            <button key={f.value} onClick={() => setFontFamily(f.value)}
              className={`py-2.5 px-3 rounded-xl border-2 text-sm transition-all text-left ${
                fontFamily === f.value ? 'border-[#29ABE2] bg-blue-50 shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300'
              }`}>
              <span className={`block font-medium ${fontFamily === f.value ? 'text-[#29ABE2]' : 'text-gray-700'}`}
                style={{ fontFamily: f.value }}>{f.label}</span>
              <span className="block text-[11px] text-gray-400 mt-0.5" style={{ fontFamily: f.value }}>The quick brown fox</span>
            </button>
          ))}
        </div>
      </div>

      {/* Font Size */}
      <div>
        <p className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-1.5">
          <Type className="w-3.5 h-3.5 text-gray-400" /> Font Size
        </p>
        <div className="grid grid-cols-5 gap-2">
          {FONT_SIZE_OPTIONS.map((s) => (
            <button key={s.value} onClick={() => setFontSize(s.value)}
              className={`py-2 px-2 rounded-xl border-2 text-xs font-medium transition-all text-center ${
                fontSize === s.value ? 'border-[#29ABE2] text-[#29ABE2] bg-blue-50 shadow-sm' : 'border-gray-200 text-gray-500 hover:border-gray-300 bg-white'
              }`}>
              <span className="block" style={{ fontSize: s.value, fontFamily, color: fontColor }}>{s.value}</span>
              <span className="block text-[10px] mt-0.5 opacity-60">{s.label.split('—')[0].trim()}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Font Color */}
      <div>
        <p className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-1.5">
          <Pipette className="w-3.5 h-3.5 text-gray-400" /> Font Color
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {FONT_COLOR_PRESETS.map((c) => (
            <button key={c.value} onClick={() => { setFontColor(c.value); setCustomColor(c.value); }}
              title={c.label}
              className={`w-8 h-8 rounded-lg border-2 transition-all shadow-sm ${fontColor === c.value ? 'border-[#29ABE2] scale-110' : 'border-transparent hover:border-gray-300'}`}
              style={{ backgroundColor: c.value }} />
          ))}
        </div>
        <div className="flex items-center gap-3">
          <input type="color" value={customColor}
            onChange={(e) => { setCustomColor(e.target.value); setFontColor(e.target.value); }}
            className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer p-0.5 bg-white" />
          <input type="text" value={customColor} maxLength={7}
            onChange={(e) => { const v = e.target.value; setCustomColor(v); if (/^#[0-9a-fA-F]{6}$/.test(v)) setFontColor(v); }}
            placeholder="#111827"
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#29ABE2]/30 focus:border-[#29ABE2]" />
          <span className="text-sm font-medium" style={{ color: fontColor, fontFamily, fontSize }}>Preview</span>
        </div>
      </div>

      <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
        <button onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 2000); }}
          className="flex items-center gap-2 px-5 py-2 bg-[#29ABE2] text-white text-sm font-semibold rounded-xl hover:bg-[#1a94c9] transition-colors shadow-sm">
          {saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
          {saved ? 'Saved!' : 'Save Appearance'}
        </button>
        <p className="text-xs text-gray-400">Saved to your browser and applied immediately.</p>
      </div>
    </div>
  );
}

// ── Notifications ─────────────────────────────────────────────────────────────

function NotificationSettings() {
  const [prefs, setPrefs] = useState({
    dealWon: true, dealLost: false, newContact: true, voiceCall: true,
    weeklyReport: true, monthlyReport: false, systemAlerts: true,
  });

  const toggles: { key: keyof typeof prefs; label: string; desc: string }[] = [
    { key: 'dealWon',       label: 'Deal won',         desc: 'When a deal is marked as won' },
    { key: 'dealLost',      label: 'Deal lost',        desc: 'When a deal is marked as lost' },
    { key: 'newContact',    label: 'New contact',      desc: 'When a new contact is created' },
    { key: 'voiceCall',     label: 'Voice call ended', desc: 'When a voice call completes' },
    { key: 'weeklyReport',  label: 'Weekly report',    desc: 'Emailed every Monday at 9 AM' },
    { key: 'monthlyReport', label: 'Monthly report',   desc: 'Emailed on the 1st of each month' },
    { key: 'systemAlerts',  label: 'System alerts',    desc: 'Critical system and billing alerts' },
  ];

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Notifications</h2>
        <p className="text-sm text-gray-500 mt-0.5">Choose what you want to be notified about.</p>
      </div>
      <div className="space-y-3">
        {toggles.map(({ key, label, desc }) => (
          <div key={key} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
            <div>
              <p className="text-sm font-medium text-gray-900">{label}</p>
              <p className="text-xs text-gray-400">{desc}</p>
            </div>
            <button onClick={() => setPrefs({ ...prefs, [key]: !prefs[key] })}
              className={`w-10 h-6 rounded-full transition-colors relative ${prefs[key] ? 'bg-brand-500' : 'bg-gray-300'}`}>
              <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${prefs[key] ? 'translate-x-5' : 'translate-x-1'}`} />
            </button>
          </div>
        ))}
      </div>
      <button className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700">
        <Save className="w-3.5 h-3.5" /> Save Preferences
      </button>
    </div>
  );
}

// ── Security ──────────────────────────────────────────────────────────────────

function SecuritySettings() {
  const isSuperAdmin = useIsSuperAdmin();
  const [currentPw, setCurrentPw] = useState('');
  const [newPw,     setNewPw]     = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [saved,     setSaved]     = useState(false);

  const mutation = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      api.post('/api/v1/auth/change-password', body),
    onSuccess: () => {
      setSaved(true);
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      setTimeout(() => setSaved(false), 2500);
    },
  });

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Security</h2>
        <p className="text-sm text-gray-500 mt-0.5">Manage your password and active sessions.</p>
      </div>
      {isSuperAdmin ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex gap-3">
          <Shield className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Password changes disabled</p>
            <p className="text-xs text-amber-700 mt-0.5">Super Admin account passwords are locked for security. Contact the platform owner to reset credentials.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-gray-700">Change Password</h3>
          {[
            { label: 'Current Password', value: currentPw, set: setCurrentPw },
            { label: 'New Password',     value: newPw,     set: setNewPw     },
            { label: 'Confirm Password', value: confirmPw, set: setConfirmPw },
          ].map(({ label, value, set }) => (
            <div key={label}>
              <label className="text-xs font-medium text-gray-600 mb-1 block">{label}</label>
              <input type="password" value={value} onChange={(e) => set(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400" />
            </div>
          ))}
          <button
            disabled={!currentPw || !newPw || newPw !== confirmPw || mutation.isPending}
            onClick={() => mutation.mutate({ currentPassword: currentPw, newPassword: newPw })}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700 disabled:opacity-50">
            {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            {saved ? 'Password Updated!' : 'Update Password'}
          </button>
          {mutation.isError && (
            <p className="text-xs text-red-500">Failed to update password. Check your current password.</p>
          )}
        </div>
      )}
      <div className="border-t border-gray-100 pt-6 space-y-4">
        <h3 className="text-sm font-medium text-gray-700">Active Sessions</h3>
        <div className="space-y-2">
          {[
            { device: 'Chrome on macOS', location: 'Current session', current: true  },
            { device: 'Mobile Safari',   location: 'Last seen 2h ago', current: false },
          ].map((s, i) => (
            <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div>
                <p className="text-sm font-medium text-gray-900">{s.device}</p>
                <p className="text-xs text-gray-400">{s.location}</p>
              </div>
              {s.current
                ? <span className="text-xs text-emerald-600 font-medium">Current</span>
                : <button className="text-xs text-red-500 hover:text-red-700">Revoke</button>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const TAB_CONTENT: Record<Tab, React.FC> = {
  profile:       ProfileSettings,
  appearance:    AppearanceSettings,
  notifications: NotificationSettings,
  security:      SecuritySettings,
};

export function PersonalSettings() {
  const [tab, setTab] = useState<Tab>('profile');
  const TabContent = TAB_CONTENT[tab];

  return (
    <div className="flex h-full">
      <div className="w-52 border-r border-gray-100 p-3 space-y-0.5">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 mb-3">My Settings</p>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
              tab === id ? 'bg-brand-50 text-brand-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
            }`}>
            <Icon className="w-4 h-4 shrink-0" />
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-8">
        <TabContent />
      </div>
    </div>
  );
}
