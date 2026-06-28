import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, Users, Building2, TrendingUp, Phone,
  CheckSquare, BarChart3, Settings as SettingsIcon, Zap, Shield,
  LogOut, CreditCard, BarChart2, LifeBuoy, List, Clock, Mail, Bot,
  FileText, Layers, MessageCircle, Key, Bell, Lock, Loader2,
} from 'lucide-react';
import { useAuthStore } from './store/auth.store';
import { useIsSuperAdmin, useIsAdmin, useIsTenantAdmin, useHasRole } from './hooks/useRole';
import { useApplyAppearance } from './hooks/useApplyAppearance';
import { api } from './services/api';
import { NotificationBell } from './components/NotificationBell';
import { MessageToast, useMessageUnread } from './components/MessageToast';
// CallWidget pulls in livekit-client (~600kB). Lazy-load so it's only fetched
// when an operational user lands on a voice-relevant route — settings/reports
// users never download it.
const CallWidget = lazy(() => import('./components/CallWidget').then(m => ({ default: m.CallWidget })));
// EAGER imports — only the auth flow + the immediate post-login landing page
// (Dashboard) stay in the main bundle. Everything else is route-split so
// first paint after login isn't dragged down by code the user hasn't asked for.
import { Dashboard }    from './pages/Dashboard';
import { LoginPage }    from './pages/Login';
import { RegisterPage } from './pages/Register';
import { ForgotPassword }  from './pages/ForgotPassword';
import { ResetPassword }   from './pages/ResetPassword';

// LAZY imports — each becomes its own chunk, fetched on demand.
const VoiceCalls   = lazy(() => import('./pages/VoiceCalls').then(m => ({ default: m.VoiceCalls })));
const Billing      = lazy(() => import('./pages/Billing').then(m => ({ default: m.Billing })));
const Contacts     = lazy(() => import('./pages/Contacts').then(m => ({ default: m.Contacts })));
const Companies    = lazy(() => import('./pages/Companies').then(m => ({ default: m.Companies })));
const Deals        = lazy(() => import('./pages/Deals').then(m => ({ default: m.Deals })));
const Activities   = lazy(() => import('./pages/Activities').then(m => ({ default: m.Activities })));
const Analytics    = lazy(() => import('./pages/Analytics').then(m => ({ default: m.Analytics })));
const Integrations = lazy(() => import('./pages/Integrations').then(m => ({ default: m.Integrations })));
const Settings          = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const ModulesSettings   = lazy(() => import('./pages/Settings').then(m => ({ default: m.ModulesSettings })));
const RoutingSettings   = lazy(() => import('./pages/Settings').then(m => ({ default: m.RoutingSettings })));
const SuperAdmin        = lazy(() => import('./pages/SuperAdmin').then(m => ({ default: m.SuperAdmin })));
const VoiceAnalytics    = lazy(() => import('./pages/VoiceAnalytics').then(m => ({ default: m.VoiceAnalytics })));
const Tickets           = lazy(() => import('./pages/Tickets').then(m => ({ default: m.Tickets })));
const TicketQueues      = lazy(() => import('./pages/TicketQueues').then(m => ({ default: m.TicketQueues })));
const TicketSla         = lazy(() => import('./pages/TicketSla').then(m => ({ default: m.TicketSla })));
const Emails            = lazy(() => import('./pages/Emails').then(m => ({ default: m.Emails })));
const VoiceBotConfig    = lazy(() => import('./pages/VoiceBotConfig').then(m => ({ default: m.VoiceBotConfig })));
const VoiceBotCalls     = lazy(() => import('./pages/VoiceBotCalls').then(m => ({ default: m.VoiceBotCalls })));
const VoiceBotTickets   = lazy(() => import('./pages/VoiceBotTickets').then(m => ({ default: m.VoiceBotTickets })));
const ContactDetail     = lazy(() => import('./pages/ContactDetail').then(m => ({ default: m.ContactDetail })));
const RolesPage         = lazy(() => import('./pages/Roles').then(m => ({ default: m.RolesPage })));
const PersonalSettings  = lazy(() => import('./pages/PersonalSettings').then(m => ({ default: m.PersonalSettings })));
const TenantAdminDashboard = lazy(() => import('./pages/TenantAdminDashboard').then(m => ({ default: m.TenantAdminDashboard })));
const Departments       = lazy(() => import('./pages/Departments').then(m => ({ default: m.Departments })));
const AdminUsers        = lazy(() => import('./pages/admin/AdminUsers').then(m => ({ default: m.AdminUsers })));
// Sales & Invoicing module — every page lazy. Heaviest sub-tree by far.
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
const TeamReports       = lazy(() => import('./pages/TeamReports').then(m => ({ default: m.TeamReports })));
const TeamMessaging     = lazy(() => import('./pages/TeamMessaging').then(m => ({ default: m.TeamMessaging })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Was 30s — bumped to 60s so navigating between tabs doesn't refetch the
      // same data the user just looked at. Combined with refetchOnWindowFocus=false
      // this kills the "tab away → tab back → 800ms freeze" pattern.
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Inline spinner shown while a lazy chunk is fetching. Sized to fit inside the
// main content area — not full-screen so the sidebar stays interactive.
function PageFallback() {
  return (
    <div className="flex items-center justify-center h-full w-full py-24">
      <Loader2 className="w-5 h-5 text-brand-400 animate-spin" />
    </div>
  );
}

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


// Sidebar entry for /messages that paints a small red badge when there are
// unread DMs/channel messages. Splits out so the rest of the sidebar doesn't
// have to re-render every 10 seconds while the unread poll runs.
function MessagingNavLink() {
  const { unread } = useMessageUnread();
  return (
    <NavLink to="/messages"
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all relative ${
          isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'
        }`
      }
      style={({ isActive }) => isActive ? {
        background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)',
        borderLeft: '2px solid #29ABE2',
      } : {}}
    >
      <MessageCircle className="w-4 h-4 shrink-0" />
      <span className="flex-1">Messaging</span>
      {unread > 0 && (
        <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 text-[10px] font-bold bg-red-500 text-white rounded-full">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </NavLink>
  );
}

function Sidebar() {
  const { user, tenant, logout } = useAuthStore();
  const isSuperAdmin  = useIsSuperAdmin();
  const isAdmin       = useIsAdmin();
  const isTenantAdmin = useIsTenantAdmin();
  const isManager     = useHasRole('manager');

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

      {/* ── Navigation ───────────────────────────────────────────── */}
      <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto">

        {/* ── Tenant Admin sidebar ─────────────────────────────────── */}
        {isTenantAdmin && (
          <>
            {/* Dashboard */}
            <NavLink to="/admin" end
              className={({ isActive }) => `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
              style={({ isActive }) => isActive ? { background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)', borderLeft: '2px solid #29ABE2' } : {}}
            ><LayoutDashboard className="w-4 h-4 shrink-0" />Dashboard</NavLink>

            {/* People section */}
            <p className="px-3 pt-3 pb-1 text-[10px] font-bold text-brand-300/60 uppercase tracking-widest">People</p>
            <NavLink to="/admin/users"
              className={({ isActive }) => `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
              style={({ isActive }) => isActive ? { background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)', borderLeft: '2px solid #29ABE2' } : {}}
            ><Users className="w-4 h-4 shrink-0" />Users</NavLink>
            <NavLink to="/roles"
              className={({ isActive }) => `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
              style={({ isActive }) => isActive ? { background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)', borderLeft: '2px solid #29ABE2' } : {}}
            ><Shield className="w-4 h-4 shrink-0" />Roles & Permissions</NavLink>
            <NavLink to="/departments"
              className={({ isActive }) => `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
              style={({ isActive }) => isActive ? { background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)', borderLeft: '2px solid #29ABE2' } : {}}
            ><Building2 className="w-4 h-4 shrink-0" />Departments</NavLink>

            {/* Workspace section */}
            <p className="px-3 pt-3 pb-1 text-[10px] font-bold text-brand-300/60 uppercase tracking-widest">Workspace</p>
            <NavLink to="/admin/modules"
              className={({ isActive }) => `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
              style={({ isActive }) => isActive ? { background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)', borderLeft: '2px solid #29ABE2' } : {}}
            ><Layers className="w-4 h-4 shrink-0" />Modules</NavLink>
            <NavLink to="/integrations"
              className={({ isActive }) => `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
              style={({ isActive }) => isActive ? { background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)', borderLeft: '2px solid #29ABE2' } : {}}
            ><Zap className="w-4 h-4 shrink-0" />Integrations</NavLink>
            <NavLink to="/settings"
              end
              className={({ isActive }) => `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
              style={({ isActive }) => isActive ? { background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)', borderLeft: '2px solid #29ABE2' } : {}}
            ><SettingsIcon className="w-4 h-4 shrink-0" />General Settings</NavLink>
            <NavLink to="/admin/routing"
              className={({ isActive }) => `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
              style={({ isActive }) => isActive ? { background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)', borderLeft: '2px solid #29ABE2' } : {}}
            ><Clock className="w-4 h-4 shrink-0" />Routing & SLA</NavLink>

            {/* Security section */}
            <p className="px-3 pt-3 pb-1 text-[10px] font-bold text-brand-300/60 uppercase tracking-widest">Security</p>
            <NavLink to="/settings/personal"
              className={({ isActive }) => `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
              style={({ isActive }) => isActive ? { background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)', borderLeft: '2px solid #29ABE2' } : {}}
            ><Lock className="w-4 h-4 shrink-0" />Security & Password</NavLink>
            <NavLink to="/settings/notifications"
              className={({ isActive }) => `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${isActive ? 'text-white font-semibold' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
              style={({ isActive }) => isActive ? { background: 'linear-gradient(135deg, rgba(41,171,226,0.25) 0%, rgba(77,139,60,0.15) 100%)', borderLeft: '2px solid #29ABE2' } : {}}
            ><Bell className="w-4 h-4 shrink-0" />Notifications</NavLink>
          </>
        )}

        {/* ── Operational staff module nav ─────────────────────────── */}
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

        {/* Team Messaging — everyone except the platform super admin. Tenant admins
            need to message their team (broadcasts, instructions), so this is no
            longer scoped to operational roles only. */}
        {!isSuperAdmin && <MessagingNavLink />}

        {/* Integrations — admin (keeps the system/network live) or permitted users.
            Billing — Finance/Sales function only: granted by the 'billing:read'
            permission, NOT the admin role. The tenant admin never sees billing. */}
        {(() => {
          const perms = (user as any)?.permissions ?? {};
          const gatedLinks = [
            { to: '/integrations', label: 'Integrations', icon: 'Zap',        key: 'integrations:read', adminBypass: true  },
            { to: '/billing',      label: 'Billing',      icon: 'CreditCard', key: 'billing:read',      adminBypass: false },
          ].filter((l) => !isTenantAdmin && ((l.adminBypass && isAdmin) || perms[l.key] === true));
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


        {/* Roles — admins only (not tenant admin, they have it in their own sidebar) */}
        {isAdmin && !isTenantAdmin && (
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

        {/* System Settings — for non-tenant-admin users with settings:read */}
        {!isTenantAdmin && (isAdmin || (user as any)?.permissions?.['settings:read']) && (
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

        {/* SLA Policies — managers only */}
        {isManager && !isTenantAdmin && (
          <NavLink to="/tickets/sla"
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
            <Clock className="w-4 h-4" />
            SLA Policies
          </NavLink>
        )}

        {/* Routing & SLA — managers only (tenant admins have it in their own sidebar) */}
        {isManager && !isTenantAdmin && (
          <NavLink to="/admin/routing"
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
            <Clock className="w-4 h-4" />
            Routing & SLA
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

// ── Shared wrapper for standalone tenant-admin pages ─────────────────────────
function AdminPageWrapper({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-100 px-8 py-5">
        <h1 className="text-xl font-bold text-gray-900">{title}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>
      </div>
      <div className="px-8 py-6">{children}</div>
    </div>
  );
}

// ── Notifications page ────────────────────────────────────────────────────────
function NotificationsPage() {
  const categories = [
    { id: 'tickets',  label: 'Tickets',           items: ['New ticket assigned to me', 'Ticket status changed', 'Ticket SLA breached', 'Ticket resolved'] },
    { id: 'contacts', label: 'Contacts & Deals',  items: ['New contact added', 'Deal stage changed', 'Deal won / lost'] },
    { id: 'team',     label: 'Team',               items: ['New user invited', 'User activated / deactivated', 'Role changed'] },
    { id: 'system',   label: 'System',             items: ['Module enabled / disabled', 'Integration connected / disconnected'] },
  ];
  const [prefs, setPrefs] = React.useState<Record<string, Record<string, { email: boolean; inApp: boolean }>>>(() =>
    Object.fromEntries(categories.map(c => [c.id, Object.fromEntries(c.items.map(i => [i, { email: true, inApp: true }]))]))
  );
  const toggle = (cat: string, item: string, channel: 'email' | 'inApp') =>
    setPrefs(p => ({ ...p, [cat]: { ...p[cat], [item]: { ...p[cat][item], [channel]: !p[cat][item][channel] } } }));

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-6 text-xs font-semibold text-gray-500 uppercase tracking-wide justify-end pr-2">
        <span className="w-14 text-center">Email</span>
        <span className="w-14 text-center">In-App</span>
      </div>
      {categories.map(cat => (
        <div key={cat.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
            <p className="text-xs font-bold text-gray-600 uppercase tracking-wide">{cat.label}</p>
          </div>
          <div className="divide-y divide-gray-50">
            {cat.items.map(item => (
              <div key={item} className="flex items-center px-5 py-3 gap-4">
                <span className="flex-1 text-sm text-gray-700">{item}</span>
                <div className="flex gap-6 shrink-0">
                  {(['email', 'inApp'] as const).map(ch => (
                    <div key={ch} className="w-14 flex justify-center">
                      <button
                        onClick={() => toggle(cat.id, item, ch)}
                        className={`w-9 h-5 rounded-full transition-colors ${prefs[cat.id][item][ch] ? 'bg-blue-500' : 'bg-gray-200'}`}
                      >
                        <span className={`block w-3.5 h-3.5 bg-white rounded-full shadow transition-transform mx-0.5 ${prefs[cat.id][item][ch] ? 'translate-x-4' : 'translate-x-0'}`} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      <button className="px-5 py-2.5 text-sm font-semibold text-white rounded-xl" style={{ background: 'linear-gradient(135deg,#29ABE2,#1a8cbf)' }}>
        Save Preferences
      </button>
    </div>
  );
}

function AppLayout() {
  const { isAuthenticated, user } = useAuthStore();
  const isSuperAdmin = useIsSuperAdmin();
  const isTenantAdmin = useIsTenantAdmin();
  const isManager = useHasRole('manager');
  const location = useLocation();
  useApplyAppearance();
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  // CallWidget visibility:
  //   • Admins (super_admin, tenant_admin) never see it — they don't take calls.
  //   • Requires either an explicit voice permission, OR an operational sales/support role.
  //   • Only rendered on pages where placing/receiving a call is contextual —
  //     dashboard, tickets, voice, contacts, deals. Hidden on settings, reports,
  //     analytics, sales billing screens where the floating bubble was just noise.
  const perms = (user as any)?.permissions as Record<string, string | boolean> | undefined;
  const hasVoicePerm = perms?.voice === true || perms?.voice === 'full' || perms?.voice === 'view';
  const role = user?.role ?? '';
  const isOperationalRole = ['agent','line_manager','manager','support_agent','support_manager','sales_agent','sales_manager'].includes(role);
  const VOICE_ROUTES = ['/dashboard','/tickets','/voice','/contacts','/deals','/companies','/activities','/calls'];
  const onVoiceRoute = VOICE_ROUTES.some((p) => location.pathname === p || location.pathname.startsWith(`${p}/`));
  const showCallWidget = !isTenantAdmin && !isSuperAdmin && (hasVoicePerm || isOperationalRole) && onVoiceRoute;

  // Super admins have no operational (ticket/voice) dashboard — their home is the
  // platform admin console. Tenant admins are administrative-only: their home is
  // the workspace Settings console; all operational pages redirect away.
  const homePath = isSuperAdmin ? '/super-admin' : isTenantAdmin ? '/admin' : '/dashboard';

  // Operational pages are off-limits to the tenant admin (separation of duties).
  // Wrap an operational element so it bounces the admin to their console.
  const op = (el: JSX.Element) => (isTenantAdmin ? <Navigate to="/admin" replace /> : el);

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/admin"         element={isTenantAdmin ? <TenantAdminDashboard /> : <Navigate to="/dashboard" replace />} />
          <Route path="/admin/users"   element={isTenantAdmin ? <AdminUsers /> : <Navigate to="/dashboard" replace />} />
          <Route path="/admin/modules" element={isTenantAdmin ? <AdminPageWrapper title="Modules" subtitle="Enable or disable features for your workspace"><ModulesSettings /></AdminPageWrapper> : <Navigate to="/dashboard" replace />} />
          <Route path="/admin/routing" element={(isTenantAdmin || isManager) ? <AdminPageWrapper title="Routing & SLA" subtitle="Configure how tickets and calls are assigned to your team"><RoutingSettings /></AdminPageWrapper> : <Navigate to="/dashboard" replace />} />
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
          <Route path="/settings/notifications" element={<AdminPageWrapper title="Notifications" subtitle="Control which alerts and emails you receive"><NotificationsPage /></AdminPageWrapper>} />
          <Route path="/departments"       element={<Departments />} />
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
        </Suspense>
      </main>
      {/* Voice call widget — operational roles only, contextually shown.
           Wrapped in its own Suspense so the surrounding chrome stays interactive
           while the livekit chunk loads. */}
      {showCallWidget && (
        <Suspense fallback={null}>
          <CallWidget />
        </Suspense>
      )}

      {/* In-app toast for new team messages. Visible to every signed-in user
          except super_admin (who has no /messages page). Polls the unread
          endpoint every 10s; pops a small card bottom-right on count increase. */}
      {!isSuperAdmin && <MessageToast />}
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
