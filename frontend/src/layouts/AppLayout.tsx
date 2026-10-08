import { NavLink, Outlet } from 'react-router-dom';
import clsx from 'clsx';
import {
  LayoutGrid,
  Sparkles,
  FolderKanban,
  CalendarCheck2,
  NotebookPen,
  CreditCard,
  FileText,
  Percent,
  Package,
  Users,
  Truck,
  Landmark,
  Settings,
  Lock,
  Unlock,
  LogOut,
  Menu,
  X,
  IndianRupee,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import kkrLogo from '../assets/kkr-logo.png';
import { useAppearance } from '../contexts/AppearanceContext';
import { useAuth } from '../contexts/AuthContext';
import { useRoleNavigation } from '../hooks/useRoleNavigation';

export function AppLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const { appearance, setPreference } = useAppearance();
  const collapsed = appearance.sidebarCollapsed;
  const setCollapsed = (value: boolean) => setPreference('sidebarCollapsed', value);
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigation = useRoleNavigation();

  useEffect(() => {
    setHoverExpanded(false);
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const effectiveCollapsed = collapsed && !hoverExpanded;

  const gatewayItems = navigation.filter((item) => ['/', '/dashboard', '/ai-search'].includes(item.path));
  const masterItems = navigation.filter((item) => ['/clients', '/vendors', '/materials', '/workers'].includes(item.path));
  const voucherItems = navigation.filter((item) => ['/gst-invoices', '/payments', '/site-expenses', '/office'].includes(item.path));
  const reportItems = navigation.filter((item) => ['/profit-loss', '/projects', '/milestones', '/notes'].includes(item.path));
  const adminItems = navigation.filter((item) => ['/settings', '/users'].includes(item.path));

  const getIcon = (path: string) => {
    if (path === '/' || path === '/dashboard') return LayoutGrid;
    if (path === '/ai-search') return Sparkles;
    if (path === '/projects') return FolderKanban;
    if (path === '/milestones') return CalendarCheck2;
    if (path === '/notes') return NotebookPen;
    if (path === '/payments') return CreditCard;
    if (path === '/gst-invoices') return FileText;
    if (path === '/site-expenses') return IndianRupee;
    if (path === '/profit-loss') return Percent;
    if (path === '/materials') return Package;
    if (path === '/workers') return Users;
    if (path === '/vendors') return Truck;
    if (path === '/clients') return Users;
    if (path === '/office') return Landmark;
    if (path === '/users') return ShieldCheck;
    if (path === '/settings') return Settings;
    return LayoutGrid;
  };

  const renderNavGroup = (title: string | null, items: typeof navigation, isMobile: boolean = false) => {
    if (items.length === 0) return null;
    return (
      <div className="space-y-1.5 my-2.5">
        {title ? (
          effectiveCollapsed && !isMobile ? (
            <hr className="border-[var(--nav-border)] mx-1 my-2" />
          ) : (
            <p className="px-2.5 text-[10px] font-black uppercase tracking-wider text-[var(--nav-group-label)] mb-1">{title}</p>
          )
        ) : null}
        {items.map((item) => {
          const Icon = getIcon(item.path);
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm sm:text-[13px] xl:text-sm font-bold transition group relative',
                  effectiveCollapsed && !isMobile && 'justify-center px-0',
                  isActive
                    ? 'bg-[var(--nav-active-bg)] text-[var(--nav-active-text)] font-extrabold'
                    : 'text-[var(--nav-text)] hover:bg-[var(--nav-hover-bg)] hover:text-[var(--nav-text-strong)]'
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={clsx('h-[17px] w-[17px] shrink-0 transition', isActive ? 'text-[var(--nav-active-text)]' : 'text-[var(--nav-icon)] group-hover:text-[var(--nav-text-strong)]')} />
                  <span className={clsx('truncate', effectiveCollapsed && !isMobile && 'hidden')}>{item.label}</span>
                  {effectiveCollapsed && !isMobile && (
                    <div className="pointer-events-none absolute left-full ml-3 z-50 hidden rounded-md bg-[var(--nav-tooltip-bg)] px-2.5 py-1 text-xs font-bold text-white shadow-xl group-hover:block whitespace-nowrap">
                      {item.label}
                    </div>
                  )}
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    );
  };

  return (
    <div className="app-shell min-h-0 bg-[var(--shell-bg)] font-sans text-slate-900">
      {/* Mobile Top Navbar Header */}
      <header className="lg:hidden sticky top-0 z-40 flex shrink-0 items-center justify-between border-b border-[var(--nav-border)] bg-[var(--nav-bg)] px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-amber-600 via-amber-700 to-amber-900 flex items-center justify-center text-white shadow-xs font-black text-[11px] shrink-0 tracking-wider">
            ERP
          </div>
          <div className="min-w-0">
            <p className="font-extrabold text-sm text-[var(--nav-text-strong)] leading-tight truncate">Billing ERP</p>
            <p className="text-[9px] text-[var(--nav-muted)] font-bold uppercase tracking-wider truncate">Tally Edition</p>
          </div>
        </div>

        <button
          type="button"
          className="p-2 rounded-xl text-[var(--nav-text)] hover:bg-[var(--nav-hover-bg)] hover:text-[var(--nav-text-strong)] transition"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle Navigation Menu"
        >
          {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>

      {/* Mobile Menu Slide-out Overlay Drawer */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative w-72 max-w-[80vw] bg-[var(--nav-bg)] border-r border-[var(--nav-border)] p-4 flex flex-col justify-between overflow-y-auto shadow-2xl z-10">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-[var(--nav-border-soft)] mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-amber-600 via-amber-700 to-amber-900 flex items-center justify-center text-white shadow-sm font-black text-xs shrink-0 tracking-wider">
                    ERP
                  </div>
                  <div>
                    <p className="font-extrabold text-sm text-[var(--nav-text-strong)] leading-tight">Billing ERP</p>
                    <p className="text-[9px] text-[var(--nav-muted)] font-bold uppercase tracking-wider">Tally Edition</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="p-1 rounded-lg text-[var(--nav-text)] hover:bg-[var(--nav-hover-bg)]"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {renderNavGroup(null, gatewayItems, true)}
              {renderNavGroup('MASTERS', masterItems, true)}
              {renderNavGroup('VOUCHERS', voucherItems, true)}
              {renderNavGroup('REPORTS', reportItems, true)}
              {renderNavGroup('ADMIN', adminItems, true)}
            </div>

            {user && (
              <div className="pt-3 border-t border-[var(--nav-border-soft)] mt-4 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="font-bold text-xs text-[var(--nav-text-strong)] truncate">{user.name}</p>
                  <p className="text-[10px] text-[var(--nav-muted)] capitalize">{user.role}</p>
                </div>
                <button
                  type="button"
                  onClick={logout}
                  className="text-[var(--nav-danger)] hover:text-rose-700 p-1.5 rounded-lg hover:bg-[var(--nav-hover-bg)]"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Desktop + Fluid Layout Container */}
      <div className="flex min-h-0 min-w-0 flex-1 w-full relative">
        {/* Desktop Sidebar Navigation */}
        <aside
          className={clsx(
            'hidden lg:flex fixed inset-y-0 left-0 z-30 h-full max-h-full min-h-0 border-r border-[var(--nav-border)] bg-[var(--nav-bg)] px-2.5 py-4 text-[var(--nav-text-strong)] overflow-y-auto shadow-sm transition-all duration-300 flex-col justify-between',
            effectiveCollapsed ? 'w-16' : 'w-48'
          )}
          onMouseEnter={() => { if (collapsed) setHoverExpanded(true); }}
          onMouseLeave={() => { if (collapsed) setHoverExpanded(false); }}
        >
          <div>
            {/* Header */}
            <div className="py-1 mb-2 border-b border-[var(--nav-border-soft)] pb-2.5">
              <div className={clsx("flex items-center gap-2.5 transition-all", effectiveCollapsed ? "justify-center" : "px-1")}>
                <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-amber-600 via-amber-700 to-amber-900 flex items-center justify-center text-white shadow-sm font-black text-xs shrink-0 tracking-wider ring-1 ring-amber-500/30">
                  ERP
                </div>
                {!effectiveCollapsed && (
                  <div className="min-w-0 text-left">
                    <p className="font-extrabold text-[13px] text-[var(--nav-text-strong)] leading-tight tracking-tight truncate">Billing ERP</p>
                    <p className="text-[9px] text-[var(--nav-muted)] font-bold uppercase tracking-widest truncate">Tally Edition</p>
                  </div>
                )}
              </div>
            </div>

            {/* Navigation Groups */}
            {renderNavGroup(null, gatewayItems)}
            {renderNavGroup('MASTERS', masterItems)}
            {renderNavGroup('VOUCHERS', voucherItems)}
            {renderNavGroup('REPORTS', reportItems)}
            {renderNavGroup('ADMIN', adminItems)}
          </div>

          {/* Bottom Footer Section */}
          <div className="pt-3 border-t border-[var(--nav-border-soft)] mt-auto">
            {effectiveCollapsed ? (
              <button
                type="button"
                className="w-full flex items-center justify-center py-2 text-[var(--nav-toggle-idle)] hover:text-[var(--nav-text-strong)] hover:bg-[var(--nav-hover-bg)] rounded-xl transition"
                onClick={() => setCollapsed(false)}
                title="Lock Sidebar"
              >
                <Lock className="h-4 w-4 shrink-0" />
              </button>
            ) : (
              <div className="flex items-center bg-[var(--nav-toggle-track)] p-1 rounded-xl border border-[var(--nav-border-soft)] gap-0.5">
                <button
                  type="button"
                  onClick={() => setCollapsed(false)}
                  className={clsx(
                    "flex-1 flex items-center justify-center gap-1 py-1.5 px-1.5 text-[10px] font-black rounded-lg transition",
                    !collapsed
                      ? "bg-[var(--nav-active-bg)] text-[var(--nav-active-text)] shadow-xs"
                      : "text-[var(--nav-toggle-idle)] hover:text-[var(--nav-text-strong)]"
                  )}
                >
                  <Lock className="h-3 w-3 shrink-0" />
                  Lock
                </button>
                <button
                  type="button"
                  onClick={() => setCollapsed(true)}
                  className={clsx(
                    "flex-1 flex items-center justify-center gap-1 py-1.5 px-1.5 text-[10px] font-black rounded-lg transition",
                    collapsed
                      ? "bg-[var(--nav-active-bg)] text-[var(--nav-active-text)] shadow-xs"
                      : "text-[var(--nav-toggle-idle)] hover:text-[var(--nav-text-strong)]"
                  )}
                >
                  <Unlock className="h-3 w-3 shrink-0" />
                  Unlock
                </button>
              </div>
            )}

            {user && !effectiveCollapsed && (
              <div className="flex items-center justify-between px-2.5 py-2 rounded-xl bg-[var(--nav-user-bg)] text-xs">
                <div className="min-w-0">
                  <p className="font-bold text-[var(--nav-text-strong)] truncate">{user.name}</p>
                  <p className="text-[10px] text-[var(--nav-muted)] capitalize">{user.role}</p>
                </div>
                <button
                  type="button"
                  onClick={logout}
                  className="text-[var(--nav-danger)] hover:text-rose-700 p-1"
                  title="Logout"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* Main Content View Area - Fluid Margins & Responsive Width */}
        <main
          className={clsx(
            'app-main flex-1 transition-all duration-300 w-full px-3 py-4 sm:px-6 sm:py-6 lg:px-8',
            effectiveCollapsed ? 'lg:ml-16' : 'lg:ml-48'
          )}
        >
          <div className="app-page mx-auto space-y-6 max-w-[1800px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
