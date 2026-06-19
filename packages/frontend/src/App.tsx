import { lazy, Suspense, useEffect } from 'react';
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
import { useHeartbeat } from './hooks/useHeartbeat';
import { api } from './services/api';
import { NotificationBell } from './components/NotificationBell';
import { CallWidget } from './components/CallWidget';

// Auth pages load eagerly (entry point — avoids a loading flash on login).
import { LoginPage }    from './pages/Login';
import { RegisterPage } from './pages/Register';
import { ForgotPassword }  from './pages/ForgotPassword';
import { ResetPassword }   from './pages/ResetPassword';

// Authenticated app pages are code-split via React.lazy so the initial bundle
// stays small and each route loads on demand. (Pages use named exports.)
const Dashboard       = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const VoiceCalls      = lazy(() => import('./pages/VoiceCalls').then(m => ({ default: m.VoiceCalls })));
const Billing         = lazy(() => import('./pages/Billing').then(m => ({ default: m.Billing })));
const Contacts        = lazy(() => import('./pages/Contacts').then(m => ({ default: m.Contacts })));
const Companies       = lazy(() => import('./pages/Companies').then(m => ({ default: m.Companies })));
const Deals           = lazy(() => import('./pages/Deals').then(m => ({ default: m.Deals })));
const Activities      = lazy(() => import('./pages/Activities').then(m => ({ default: m.Activities })));
const Analytics       = lazy(() => import('./pages/Analytics').then(m => ({ default: m.Analytics })));
const Integrations    = lazy(() => import('./pages/Integrations').then(m => ({ default: m.Integrations })));
const Settings        = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const SuperAdmin      = lazy(() => import('./pages/SuperAdmin').then(m => ({ default: m.SuperAdmin })));
const VoiceAnalytics  = lazy(() => import('./pages/VoiceAnalytics').then(m => ({ default: m.VoiceAnalytics })));
const Tickets         = lazy(() => import('./pages/Tickets').then(m => ({ default: m.Tickets })));
const TicketQueues    = lazy(() => import('./pages/TicketQueues').then(m => ({ default: m.TicketQueues })));
const TicketSla       = lazy(() => import('./pages/TicketSla').then(m => ({ default: m.TicketSla })));
const Emails          = lazy(() => import('./pages/Emails').then(m => ({ default: m.Emails })));
const VoiceBotConfig  = lazy(() => import('./pages/VoiceBotConfig').then(m => ({ default: m.VoiceBotConfig })));
const VoiceBotCalls   = lazy(() => import('./pages/VoiceBotCalls').then(m => ({ default: m.VoiceBotCalls })));
const VoiceBotTickets = lazy(() => import('./pages/VoiceBotTickets').then(m => ({ default: m.VoiceBotTickets })));
const ContactDetail   = lazy(() => import('./pages/ContactDetail').then(m => ({ default: m.ContactDetail })));
const RolesPage       = lazy(() => import('./pages/Roles').then(m => ({ default: m.RolesPage })));
const OrgChart        = lazy(() => import('./pages/OrgChart').then(m => ({ default: m.OrgChart })));
const TeamReports     = lazy(() => import('./pages/TeamReports').then(m => ({ default: m.TeamReports })));
const PersonalSettings = lazy(() => import('./pages/PersonalSettings').then(m => ({ default: m.PersonalSettings })));
// Sales & Invoicing module
const SalesDashboard    = lazy(() => import('./pages/sales/SalesDashboard').then(m => ({ default: m.SalesDashboard })));
const InvoiceList       = lazy(() => import('./pages/sales/InvoiceList').then(m => ({ default: m.InvoiceList })));
const InvoiceCreate     = lazy(() => import('./pages/sales/InvoiceCreate').then(m => ({ default: m.InvoiceCreate })));
const InvoiceDetail     = lazy(() => import('./pages/sales/InvoiceDetail').then(m => ({ default: m.InvoiceDetail })));
const SalesContacts     = lazy(() => import('./pages/sales/SalesContacts').then(m => ({ default: m.SalesContacts })));
const SalesPayments     = lazy(() => import('./pages/sales/SalesPayments').then(m => ({ default: m.SalesPayments })));
const SalesReports      = lazy(() => import('./pages/sales/SalesReports').then(m => ({ default: m.SalesReports })));
const SalesTemplates    = lazy(() => import('./pages/sales/SalesTemplates').then(m => ({ default: m.SalesTemplates })));
const SalesBuilder      = lazy(() => import('./pages/sales/SalesBuilder').then(m => ({ default: m.SalesBuilder })));
const SalesSettingsPage = lazy(() => import('./pages/sales/SalesSettings').then(m => ({ default: m.SalesSettingsPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,            // serve cached data for 1 min before refetching
      gcTime: 5 * 60_000,           // keep unused data cached for 5 min
      retry: 1,
      refetchOnWindowFocus: false,  // avoid noisy refetches when tabbing back
    },
  },
});

// Lightweight fallback shown while a lazy-loaded route chunk is fetched.
function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full w-full py-20">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-brand-400" />
    </div>
  );
}

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

        {/*
          Hardcoded bottom nav (Integrations, Billing) intentionally removed.
          These items now flow through /api/v1/modules with role-based filtering
          (tenant_admin sees them in their Admin module; nobody else does).
        */}
      </nav>

      {/* ── Footer: Settings + Super Admin (Settings/Roles moved into the
           dynamic Admin module for tenant_admin — keep this minimal). ── */}
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
        <NavLink to="/personal-settings"
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
          My Profile
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

// Warm the most-used route chunks during browser idle time so navigation to
// them is instant. The dynamic imports are deduped, so this is cheap.
function prefetchCommonRoutes() {
  void import('./pages/Dashboard');
  void import('./pages/Contacts');
  void import('./pages/Companies');
  void import('./pages/Deals');
  void import('./pages/Tickets');
  void import('./pages/Activities');
  void import('./pages/Analytics');
}

function AppLayout() {
  useHeartbeat();   // ping /auth/heartbeat every 30s while a tab is open (presence tracking)
  const { isAuthenticated } = useAuthStore();
  useApplyAppearance();

  useEffect(() => {
    if (!isAuthenticated) return;
    const ric = (window as any).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 400));
    const id = ric(prefetchCommonRoutes);
    return () => (window as any).cancelIdleCallback?.(id);
  }, [isAuthenticated]);

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Suspense fallback={<PageLoader />}>
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
          <Route path="/organization"    element={<OrgChart />} />
          <Route path="/team-reports"    element={<TeamReports />} />
          <Route path="/personal-settings" element={<PersonalSettings />} />
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
          {/* Tenant-admin sidebar deep-links — all surface inside the Settings page tabs for now */}
          <Route path="/users"        element={<Settings />} />
          <Route path="/departments"  element={<Settings />} />
          <Route path="/modules"      element={<Settings />} />
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
        </Suspense>
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
