import { BrowserRouter, Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, Users, Building2, TrendingUp, Phone,
  CheckSquare, BarChart3, Settings as SettingsIcon, Zap, Shield,
  LogOut, CreditCard, BarChart2, LifeBuoy, List, Clock, Mail, Bot,
  FileText, Layers, MessageCircle,
} from 'lucide-react';
import { useAuthStore } from './store/auth.store';
import { useIsSuperAdmin, useIsAdmin, useIsTenantAdmin } from './hooks/useRole';
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
import { RolesPage }          from './pages/Roles';
import { PersonalSettings }   from './pages/PersonalSettings';
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
import { TeamReports }       from './pages/TeamReports';
import { TeamMessaging }     from './pages/TeamMessaging';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

// ── Icon resolver ─────────────────────────────────────────────────────────
// Maps icon name strings (from the API) to Lucide components.
const ICON_MAP: Record<string, React.ElementType> = {
  LayoutDashboard, Users, Building2, TrendingUp, Phone,
  CheckSquare, BarChart3, BarChart2, Zap, CreditCard,
  LifeBuoy, List, Clock, Shield, Mail, Bot,
  FileText, Layers, MessageCircle, Settings: SettingsIcon,
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


function Sidebar() {
  const { user, tenant, logout } = useAuthStore();
  const isSuperAdmin  = useIsSuperAdmin();
  const isAdmin       = useIsAdmin();
  const isTenantAdmin = useIsTenantAdmin();

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
      {/* Tenant admin is administrative-only — no operational module nav. */}
      <nav className="flex-1 px-2 py-4 space-y-4 overflow-y-auto">
        {!isTenantAdmin && modules.map((mod) => (
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

        {/* Team Messaging — operational staff only (not the administrative tenant admin) */}
        {!isSuperAdmin && !isTenantAdmin && (
          <NavLink to="/messages"
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
            <MessageCircle className="w-4 h-4 shrink-0" />
            Messaging
          </NavLink>
        )}

        {/* Integrations — admin (keeps the system/network live) or permitted users.
            Billing — Finance/Sales function only: granted by the 'billing:read'
            permission, NOT the admin role. The tenant admin never sees billing. */}
        {(() => {
          const perms = (user as any)?.permissions ?? {};
          const gatedLinks = [
            { to: '/integrations', label: 'Integrations', icon: 'Zap',        key: 'integrations:read', adminBypass: true  },
            { to: '/billing',      label: 'Billing',      icon: 'CreditCard', key: 'billing:read',      adminBypass: false },
          ].filter((l) => (l.adminBypass && isAdmin) || perms[l.key] === true);
          if (gatedLinks.length === 0) return null;
          return (
            <>
              {modules.length > 0 && <div className="border-t border-white/10 mx-1" />}
              <div className="space-y-0.5">
                {gatedLinks.map(({ to, label, icon }) => {
                  const Icon = resolveIcon(icon);
                  return (
                    <NavLink key={to} to={to}
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
            </>
          );
        })()}
      </nav>

      {/* ── Footer: gated admin links + user chip ─────────────────── */}
      <div className="px-2 py-3 border-t border-white/10 space-y-0.5">

        {/* Super Admin — only for super_admin role */}
        {isSuperAdmin && (
          <>
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
            <NavLink to="/sales/dashboard"
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${
                  isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'
                }`
              }
              style={({ isActive }) => isActive ? {
                background: 'rgba(99,102,241,0.2)', borderLeft: '2px solid #818CF8',
              } : {}}
            >
              <CreditCard className="w-4 h-4" />
              Sales & Invoices
            </NavLink>
            <NavLink to="/sales/reports"
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${
                  isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'
                }`
              }
              style={({ isActive }) => isActive ? {
                background: 'rgba(99,102,241,0.2)', borderLeft: '2px solid #818CF8',
              } : {}}
            >
              <BarChart2 className="w-4 h-4" />
              Reports
            </NavLink>
          </>
        )}


        {/* Roles — admins only */}
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

        {/* System Settings — only if user has settings:read permission */}
        {(isAdmin || (user as any)?.permissions?.['settings:read']) && (
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
        )}

        {/* User chip — always visible; avatar links to Personal Settings */}
        <div className="mt-2 px-2 py-2 rounded-xl bg-white/10 flex items-center gap-2">
          <NavLink to="/settings/personal" title="My Settings"
            className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-white hover:ring-2 hover:ring-white/40 transition-all"
            style={{ background: 'linear-gradient(135deg, #29ABE2 0%, #4D8B3C 100%)' }}>
            {user?.name?.[0]?.toUpperCase()}
          </NavLink>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-white truncate">{user?.name}</p>
            <p className="text-[10px] text-white/50 capitalize">{user?.role?.replace('_', ' ')}</p>
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
  const isSuperAdmin = useIsSuperAdmin();
  const isTenantAdmin = useIsTenantAdmin();
  useApplyAppearance();
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  // Super admins have no operational (ticket/voice) dashboard — their home is the
  // platform admin console. Tenant admins are administrative-only: their home is
  // the workspace Settings console; all operational pages redirect away.
  const homePath = isSuperAdmin ? '/super-admin' : isTenantAdmin ? '/settings' : '/dashboard';

  // Operational pages are off-limits to the tenant admin (separation of duties).
  // Wrap an operational element so it bounces the admin to their console.
  const op = (el: JSX.Element) => (isTenantAdmin ? <Navigate to="/settings" replace /> : el);

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="/dashboard"    element={isSuperAdmin ? <Navigate to="/super-admin" replace /> : op(<Dashboard />)} />
          <Route path="/contacts"     element={op(<Contacts />)} />
          <Route path="/companies"   element={op(<Companies />)} />
          <Route path="/deals"       element={op(<Deals />)} />
          <Route path="/voice"           element={op(<VoiceCalls />)} />
          <Route path="/voice/analytics" element={op(<VoiceAnalytics />)} />
          <Route path="/tickets"         element={op(<Tickets />)} />
          <Route path="/tickets/queues"  element={op(<TicketQueues />)} />
          <Route path="/tickets/sla"     element={op(<TicketSla />)} />
          <Route path="/emails"          element={op(<Emails />)} />
          <Route path="/messages"        element={<TeamMessaging />} />
          <Route path="/voice-bot"         element={op(<VoiceBotConfig />)} />
          <Route path="/voice-bot/calls"   element={op(<VoiceBotCalls />)} />
          <Route path="/voice-bot/tickets" element={op(<VoiceBotTickets />)} />
          <Route path="/contacts/:id"      element={op(<ContactDetail />)} />
          <Route path="/activities"  element={op(<Activities />)} />
          <Route path="/analytics"   element={op(<Analytics />)} />
          <Route path="/team-reports" element={op(<TeamReports />)} />
          <Route path="/billing"     element={op(<Billing />)} />
          <Route path="/integrations" element={<Integrations />} />
          <Route path="/settings"          element={<Settings />} />
          <Route path="/settings/personal" element={<PersonalSettings />} />
          <Route path="/roles"        element={<RolesPage />} />
          <Route path="/super-admin" element={<SuperAdmin />} />
          {/* Sales & Invoicing module */}
          <Route path="/sales/dashboard"  element={op(<SalesDashboard />)} />
          <Route path="/sales/invoices"   element={op(<InvoiceList />)} />
          <Route path="/sales/invoices/new" element={op(<InvoiceCreate />)} />
          <Route path="/sales/invoices/:id" element={op(<InvoiceDetail />)} />
          <Route path="/sales/contacts"   element={op(<SalesContacts />)} />
          <Route path="/sales/payments"   element={op(<SalesPayments />)} />
          <Route path="/sales/reports"    element={op(<SalesReports />)} />
          <Route path="/sales/templates"  element={op(<SalesTemplates />)} />
          <Route path="/sales/builder"    element={op(<SalesBuilder />)} />
          <Route path="/sales/settings"   element={op(<SalesSettingsPage />)} />
          <Route path="*"            element={<Navigate to={homePath} replace />} />
        </Routes>
      </main>
      {/* Voice call widget is operational — not for the administrative tenant admin. */}
      {!isTenantAdmin && !isSuperAdmin && <CallWidget />}
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
