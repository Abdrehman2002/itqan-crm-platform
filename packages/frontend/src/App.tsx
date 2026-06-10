import { BrowserRouter, Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, Users, Building2, TrendingUp, Phone,
  CheckSquare, BarChart3, Settings as SettingsIcon, Zap, Shield,
  LogOut, CreditCard, BarChart2, LifeBuoy, List, Clock, Mail, Bot,
  FileText, Layers,
} from 'lucide-react';
import { useAuthStore } from './store/auth.store';
import { useIsSuperAdmin, useIsAdmin } from './hooks/useRole';
import { useApplyAppearance } from './hooks/useApplyAppearance';
import { api } from './services/api';
import { NotificationBell } from './components/NotificationBell';
import { CallWidget } from './components/CallWidget';
import { Dashboard }    from './pages/Dashboard';
import { VoiceCalls }   from './pages/VoiceCalls';
import { Billing }      from './pages/Billing';
import { LoginPage }    from './pages/Login';
import { RegisterPage } from './pages/Register';
import { Contacts }     from './pages/Contacts';
import { Companies }    from './pages/Companies';
import { Deals }        from './pages/Deals';
import { Activities }   from './pages/Activities';
import { Analytics }    from './pages/Analytics';
import { Integrations } from './pages/Integrations';
import { Settings }     from './pages/Settings';
import { SuperAdmin }       from './pages/SuperAdmin';
import { VoiceAnalytics }   from './pages/VoiceAnalytics';
import { Tickets }          from './pages/Tickets';
import { TicketQueues }     from './pages/TicketQueues';
import { TicketSla }        from './pages/TicketSla';
import { Emails }           from './pages/Emails';
import { VoiceBotConfig }  from './pages/VoiceBotConfig';
import { VoiceBotCalls }   from './pages/VoiceBotCalls';
import { VoiceBotTickets } from './pages/VoiceBotTickets';
import { ContactDetail }   from './pages/ContactDetail';
import { ForgotPassword }  from './pages/ForgotPassword';
import { ResetPassword }   from './pages/ResetPassword';
import { RolesPage }       from './pages/Roles';
// Sales & Invoicing module
import { SalesDashboard }    from './pages/sales/SalesDashboard';
import { InvoiceList }       from './pages/sales/InvoiceList';
import { InvoiceCreate }     from './pages/sales/InvoiceCreate';
import { InvoiceDetail }     from './pages/sales/InvoiceDetail';
import { SalesContacts }     from './pages/sales/SalesContacts';
import { SalesPayments }     from './pages/sales/SalesPayments';
import { SalesReports }      from './pages/sales/SalesReports';
import { SalesTemplates }    from './pages/sales/SalesTemplates';
import { SalesBuilder }      from './pages/sales/SalesBuilder';
import { SalesSettingsPage } from './pages/sales/SalesSettings';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

// ── Icon resolver ─────────────────────────────────────────────────────────
// Maps icon name strings (from the API) to Lucide components.
const ICON_MAP: Record<string, React.ElementType> = {
  LayoutDashboard, Users, Building2, TrendingUp, Phone,
  CheckSquare, BarChart3, BarChart2, Zap, CreditCard,
  LifeBuoy, List, Clock, Shield, Mail, Bot,
  FileText, Layers, Settings: SettingsIcon,
};
function resolveIcon(name: string): React.ElementType {
  return ICON_MAP[name] ?? LayoutDashboard;
}

// ── Module nav item type ──────────────────────────────────────────────────
interface NavItem {
  path: string;
  label: string;
  icon: string;
}
interface ActiveModule {
  id: string;
  label: string;
  icon: string;
  navItems: NavItem[];
}

// ── Static bottom nav items (always visible) ──────────────────────────────
const BOTTOM_NAV = [
  { to: '/integrations', label: 'Integrations', icon: 'Zap' },
  { to: '/billing',      label: 'Billing',      icon: 'CreditCard' },
];

function Sidebar() {
  const { user, tenant, logout } = useAuthStore();
  const isSuperAdmin = useIsSuperAdmin();
  const isAdmin      = useIsAdmin();

  // Fetch active modules from the API — drives the sidebar dynamically
  const { data: modulesData } = useQuery<ActiveModule[]>({
    queryKey: ['modules'],
    queryFn: async () => {
      const res = await api.get('/api/v1/modules');
      return res.data.data;
    },
    staleTime: 60_000,
  });

  const modules: ActiveModule[] = modulesData ?? [];

  return (
    <div className="w-56 flex flex-col h-full" style={{ background: 'linear-gradient(180deg, #062840 0%, #0a4162 60%, #0f5c85 100%)' }}>

      {/* ── Logo / Workspace ──────────────────────────────────────── */}
      <div className="px-4 py-5 border-b border-white/10">
        {/* Wordmark */}
        <div className="flex items-center gap-2.5 mb-3">
          {/* Brand icon: the X-shape from the logo, simplified */}
          <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
               style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #4D8B3C 100%)' }}>
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white" xmlns="http://www.w3.org/2000/svg">
              {/* Simplified X chevron from the logo */}
              <path d="M5 5 L10 12 L5 19 H9 L12 14.5 L15 19 H19 L14 12 L19 5 H15 L12 9.5 L9 5 Z" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-white leading-tight truncate">Vivid Solutions</p>
            <p className="text-[10px] text-brand-300 font-medium">&amp; Services</p>
          </div>
        </div>

        {/* Workspace chip */}
        <div className="bg-white/10 rounded-xl px-3 py-2">
          <p className="text-xs font-semibold text-white truncate">{tenant?.name ?? 'Workspace'}</p>
          <p className="text-[10px] capitalize mt-0.5" style={{ color: '#F5C518' }}>
            {tenant?.plan ?? 'free'} plan
          </p>
        </div>
      </div>

      {/* ── Dynamic module navigation ─────────────────────────────── */}
      <nav className="flex-1 px-2 py-4 space-y-4 overflow-y-auto">
        {modules.map((mod) => (
          <div key={mod.id}>
            {modules.length > 1 && (
              <p className="px-3 mb-1 text-[10px] font-bold text-brand-300/60 uppercase tracking-widest">
                {mod.label}
              </p>
            )}
            <div className="space-y-0.5">
              {mod.navItems.map((item) => {
                const Icon = resolveIcon(item.icon);
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${
                        isActive
                          ? 'text-white font-semibold shadow-sm'
                          : 'text-white/60 hover:text-white hover:bg-white/10'
                      }`
                    }
                    style={({ isActive }) => isActive ? {
                      background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)',
                      borderLeft: '2px solid #29ABE2',
                    } : {}}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    {item.label}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}

        {modules.length > 0 && <div className="border-t border-white/10 mx-1" />}

        <div className="space-y-0.5">
          {BOTTOM_NAV.map(({ to, label, icon }) => {
            const Icon = resolveIcon(icon);
            return (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${
                    isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'
                  }`
                }
                style={({ isActive }) => isActive ? {
                  background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)',
                  borderLeft: '2px solid #29ABE2',
                } : {}}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </NavLink>
            );
          })}
        </div>
      </nav>

      {/* ── Footer: Super Admin + Settings + User ─────────────────── */}
      <div className="px-2 py-3 border-t border-white/10 space-y-0.5">
        {isSuperAdmin && (
          <NavLink to="/super-admin"
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${
                isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'
              }`
            }
            style={({ isActive }) => isActive ? {
              background: 'rgba(245,197,24,0.15)', borderLeft: '2px solid #F5C518',
            } : {}}
          >
            <Shield className="w-4 h-4" />
            Super Admin
          </NavLink>
        )}
        {isAdmin && (
          <NavLink to="/roles"
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${
                isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'
              }`
            }
            style={({ isActive }) => isActive ? {
              background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)',
              borderLeft: '2px solid #29ABE2',
            } : {}}
          >
            <Shield className="w-4 h-4" />
            Roles
          </NavLink>
        )}
        <NavLink to="/settings"
          className={({ isActive }) =>
            `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${
              isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'
            }`
          }
          style={({ isActive }) => isActive ? {
            background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)',
            borderLeft: '2px solid #29ABE2',
          } : {}}
        >
          <SettingsIcon className="w-4 h-4" />
          Settings
        </NavLink>

        {/* User chip */}
        <div className="mt-2 px-3 py-2.5 rounded-xl bg-white/10 flex items-center gap-2">
          <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-white"
               style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #4D8B3C 100%)' }}>
            {user?.name?.[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-white truncate">{user?.name}</p>
            <p className="text-[10px] text-white/50 capitalize">{user?.role}</p>
          </div>
          <NotificationBell />
          <button onClick={logout} title="Log out"
            className="text-white/40 hover:text-white p-0.5 rounded transition-colors">
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function AppLayout() {
  const { isAuthenticated } = useAuthStore();
  useApplyAppearance();
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="/dashboard"    element={<Dashboard />} />
          <Route path="/contacts"     element={<Contacts />} />
          <Route path="/companies"   element={<Companies />} />
          <Route path="/deals"       element={<Deals />} />
          <Route path="/voice"           element={<VoiceCalls />} />
          <Route path="/voice/analytics" element={<VoiceAnalytics />} />
          <Route path="/tickets"         element={<Tickets />} />
          <Route path="/tickets/queues"  element={<TicketQueues />} />
          <Route path="/tickets/sla"     element={<TicketSla />} />
          <Route path="/emails"          element={<Emails />} />
          <Route path="/voice-bot"         element={<VoiceBotConfig />} />
          <Route path="/voice-bot/calls"   element={<VoiceBotCalls />} />
          <Route path="/voice-bot/tickets" element={<VoiceBotTickets />} />
          <Route path="/contacts/:id"      element={<ContactDetail />} />
          <Route path="/activities"  element={<Activities />} />
          <Route path="/analytics"   element={<Analytics />} />
          <Route path="/billing"     element={<Billing />} />
          <Route path="/integrations" element={<Integrations />} />
          <Route path="/settings"     element={<Settings />} />
          <Route path="/roles"        element={<RolesPage />} />
          <Route path="/super-admin" element={<SuperAdmin />} />
          {/* Sales & Invoicing module */}
          <Route path="/sales/dashboard"  element={<SalesDashboard />} />
          <Route path="/sales/invoices"   element={<InvoiceList />} />
          <Route path="/sales/invoices/new" element={<InvoiceCreate />} />
          <Route path="/sales/invoices/:id" element={<InvoiceDetail />} />
          <Route path="/sales/contacts"   element={<SalesContacts />} />
          <Route path="/sales/payments"   element={<SalesPayments />} />
          <Route path="/sales/reports"    element={<SalesReports />} />
          <Route path="/sales/templates"  element={<SalesTemplates />} />
          <Route path="/sales/builder"    element={<SalesBuilder />} />
          <Route path="/sales/settings"   element={<SalesSettingsPage />} />
          <Route path="*"            element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
      <CallWidget />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login"           element={<LoginPage />} />
          <Route path="/register"        element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password"  element={<ResetPassword />} />
          <Route path="/*"               element={<AppLayout />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
