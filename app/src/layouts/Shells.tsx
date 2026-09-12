/**
 * The four access areas of §2, each with its own navigation (§47–§50).
 *
 * Navigation is defined per role as data, so adding a screen is a one-line
 * change and no role can be shown a link it should not have. This is Layer 1 of
 * the security model — the data behind each link is still refused by PostgreSQL
 * for the wrong role.
 */
import { NavLink, Outlet, useNavigate, Link, useLocation } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import { Logo, LogoHero } from '../components/Logo';
import { useAuth } from '../lib/auth';
import { Spinner } from '../components/ui';
import { supabase } from '../lib/supabase';

/* --------------------------------- icons ---------------------------------- */
/** Inline SVG so no icon font or CDN is needed (previews block external assets). */
const I = {
  dashboard: 'M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z',
  pos: 'M3 3h18v4H3V3Zm2 6h16v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9Zm5 3v2h6v-2H10Z',
  box: 'M12 2 3 7v10l9 5 9-5V7l-9-5Zm0 2.3 6.5 3.6L12 11.5 5.5 7.9 12 4.3Z',
  layers: 'M12 2 2 7l10 5 10-5-10-5Zm0 9L2 16l10 5 10-5-10-5Z',
  truck: 'M3 6h11v9H3V6Zm12 2h3.5L21 12v3h-6V8Zm-9 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  book: 'M4 4h7v16H4V4Zm9 0h7v16h-7V4ZM6 7h3v2H6V7Zm9 0h3v2h-3V7Z',
  receipt: 'M6 2h12v20l-3-2-3 2-3-2-3 2V2Zm3 5h6v2H9V7Zm0 4h6v2H9v-2Z',
  users: 'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5Z',
  coins: 'M12 2C7 2 3 3.8 3 6v12c0 2.2 4 4 9 4s9-1.8 9-4V6c0-2.2-4-4-9-4Zm0 2c4.4 0 7 1.3 7 2s-2.6 2-7 2-7-1.3-7-2 2.6-2 7-2Z',
  chart: 'M3 20h18v2H3v-2Zm2-2V9h3v9H5Zm5 0V4h3v14h-3Zm5 0v-6h3v6h-3Z',
  wallet: 'M3 6h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Zm2-2h13v2H5V4Zm13 8a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z',
  heart: 'M12 21s-8-4.5-8-10a5 5 0 0 1 8-3 5 5 0 0 1 8 3c0 5.5-8 10-8 10Z',
  spark: 'M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6Z',
  shield: 'M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5l8-3Z',
  gear: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm9 4-2 1.5.3 2.5-2.2 1.3-2-1.5-2 1.3-2-1.3-2 1.5L7.7 16l.3-2.5L6 12l2-1.5L7.7 8l2.2-1.3 2 1.5 2-1.3 2 1.3 2-1.5 2.2 1.3-.3 2.5L21 12Z',
  list: 'M4 5h16v2H4V5Zm0 6h16v2H4v-2Zm0 6h16v2H4v-2Z',
  home: 'M12 3 2 11h3v9h6v-6h2v6h6v-9h3L12 3Z',
  basket: 'M6 7h12l1 13H5L6 7Zm3-3a3 3 0 0 1 6 0v1h-6V4Z',
  chat: 'M4 4h16v12H8l-4 4V4Z',
  phone: 'M6 3h4l2 5-2.5 1.5a11 11 0 0 0 5 5L16 12l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2Z',
  logout: 'M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5v-2H5V5h5V3Zm6 3-1.4 1.4L17.2 10H9v2h8.2l-2.6 2.6L16 16l5-5-5-5Z',
  arrow: 'M9 6l6 6-6 6',
};

function Icon({ d, className = '' }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" className={className}>
      <path d={d} />
    </svg>
  );
}

export interface NavItem {
  to: string;
  label: string;
  icon: keyof typeof I;
  ownerOnly?: boolean;
}

export const OWNER_NAV: NavItem[] = [
  { to: '/admin', label: 'Dashboard', icon: 'dashboard' },
  { to: '/admin/pos', label: 'POS', icon: 'pos' },
  { to: '/admin/products', label: 'Products', icon: 'box' },
  { to: '/admin/inventory', label: 'Inventory', icon: 'layers' },
  { to: '/admin/restock', label: 'Restock', icon: 'truck' },
  { to: '/admin/suppliers', label: 'Suppliers', icon: 'users' },
  { to: '/admin/credit-book', label: 'Credit Book', icon: 'book' },
  { to: '/admin/sales', label: 'Sales', icon: 'receipt' },
  { to: '/admin/returns', label: 'Returns & Voids', icon: 'arrow' },
  { to: '/admin/staff', label: 'Staff', icon: 'users' },
  { to: '/admin/commission', label: 'Commission', icon: 'coins' },
  { to: '/admin/expenses', label: 'Expenses', icon: 'wallet' },
  { to: '/admin/pnl', label: 'Profit & Loss', icon: 'chart' },
  { to: '/admin/tithe', label: 'Tithe', icon: 'heart' },
  { to: '/admin/requests', label: 'Customer Requests', icon: 'chat' },
  { to: '/admin/demand', label: 'Customer Demand', icon: 'spark' },
  { to: '/admin/reports', label: 'Reports', icon: 'list' },
  { to: '/admin/settings', label: 'Settings', icon: 'gear' },
  { to: '/admin/audit', label: 'Audit Log', icon: 'shield' },
];

export const STAFF_NAV: NavItem[] = [
  { to: '/staff', label: 'Dashboard', icon: 'dashboard' },
  { to: '/staff/pos', label: 'POS', icon: 'pos' },
  { to: '/staff/products', label: 'Products', icon: 'box' },
  { to: '/staff/stock', label: 'Stock', icon: 'layers' },
  { to: '/staff/restock', label: 'Restock', icon: 'truck' },
  { to: '/staff/my-sales', label: 'My Sales', icon: 'receipt' },
  { to: '/staff/my-commission', label: 'My Commission', icon: 'coins' },
];

export const CUSTOMER_NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/products', label: 'Products', icon: 'basket' },
  { to: '/categories', label: 'Categories', icon: 'layers' },
  { to: '/order', label: 'Order', icon: 'pos' },
  { to: '/request', label: 'Request Product', icon: 'spark' },
  { to: '/contact', label: 'Contact', icon: 'phone' },
];

export const SUPPLIER_NAV: NavItem[] = [
  { to: '/supplier', label: 'Dashboard', icon: 'dashboard' },
  { to: '/supplier/products', label: 'My Products', icon: 'box' },
  { to: '/supplier/transactions', label: 'Transactions', icon: 'list' },
  { to: '/supplier/payables', label: 'Payables', icon: 'book' },
  { to: '/supplier/payments', label: 'Payments', icon: 'wallet' },
  { to: '/supplier/statements', label: 'Statements', icon: 'receipt' },
  { to: '/supplier/profile', label: 'Profile', icon: 'users' },
];

/* ------------------------------- App shell -------------------------------- */

export function AppShell({ nav, title, subtitle }: { nav: NavItem[]; title: string; subtitle?: string }) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the drawer whenever the route changes.
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen flex bg-brand-blush">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col bg-white border-r border-brand-line">
        <div className="px-5 py-4 border-b border-brand-line">
          <Link to="/"><Logo size={34} showStrapline /></Link>
        </div>
        <nav className="flex-1 overflow-y-auto py-3 px-2.5">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/admin' || item.to === '/staff' || item.to === '/supplier'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 mb-0.5 text-sm font-medium transition
                 ${isActive ? 'bg-brand-blush text-brand-deep' : 'text-brand-charcoal hover:bg-brand-soft'}`}
            >
              <Icon d={I[item.icon]} className="shrink-0" />
              <span className="truncate">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-brand-line">
          <div className="flex items-center gap-2.5 px-2 py-2">
            <div className="h-9 w-9 rounded-full bg-brand-blush text-brand-deep flex items-center
                            justify-center text-sm font-semibold shrink-0">
              {profile?.full_name?.slice(0, 1).toUpperCase() || '?'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-brand-ink truncate">{profile?.full_name}</p>
              <p className="text-xs text-brand-muted">{profile?.role === 'OWNER' ? 'Owner' : 'Staff'}</p>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm
                       text-brand-charcoal hover:bg-brand-soft"
          >
            <Icon d={I.logout} /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile + desktop top bar */}
        <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-brand-line
                           px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            className="lg:hidden h-10 w-10 -ml-1 rounded-lg hover:bg-brand-soft flex items-center justify-center"
          >
            <Icon d={I.list} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold text-brand-ink truncate">{title}</h1>
            {subtitle && <p className="text-xs text-brand-muted truncate">{subtitle}</p>}
          </div>
          <div className="lg:hidden"><Logo size={26} /></div>
        </header>

        <main className="flex-1 px-4 py-4 sm:px-6 sm:py-5 max-w-[1400px] w-full mx-auto">
          <Outlet />
        </main>
      </div>

      {/* Mobile drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-brand-ink/40" onClick={() => setMenuOpen(false)} aria-hidden="true" />
          <div className="absolute inset-y-0 left-0 w-[82%] max-w-xs bg-white shadow-lift
                          flex flex-col animate-fade-up">
            <div className="px-4 py-3.5 border-b border-brand-line flex items-center justify-between">
              <Logo size={30} />
              <button
                onClick={() => setMenuOpen(false)} aria-label="Close menu"
                className="h-10 w-10 rounded-lg hover:bg-brand-soft flex items-center justify-center"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto py-2 px-2">
              {nav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to.length <= 7}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-xl px-3 py-3 mb-0.5 text-sm font-medium
                     ${isActive ? 'bg-brand-blush text-brand-deep' : 'text-brand-charcoal'}`}
                >
                  <Icon d={I[item.icon]} />
                  <span className="truncate">{item.label}</span>
                </NavLink>
              ))}
            </nav>
            <button
              onClick={handleSignOut}
              className="m-3 flex items-center gap-2.5 rounded-xl px-3 py-3 text-sm
                         text-brand-charcoal border border-brand-line"
            >
              <Icon d={I.logout} /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------- Customer shell ------------------------------ */

export function CustomerShell() {
  const location = useLocation();
  return (
    <div className="min-h-screen flex flex-col bg-brand-blush">
      <header className="bg-white/95 backdrop-blur border-b border-brand-line sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <Link to="/" aria-label="LuBella home"><Logo size={30} showStrapline /></Link>
          <nav className="hidden md:flex items-center gap-1">
            {CUSTOMER_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `px-3 py-2 rounded-lg text-sm font-medium transition
                   ${isActive ? 'bg-brand-blush text-brand-deep' : 'text-brand-charcoal hover:bg-brand-soft'}`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <Link
            to="/login"
            className="text-xs text-brand-muted hover:text-brand-deep hidden sm:block shrink-0"
          >
            Staff login
          </Link>
        </div>
      </header>

      <main className="flex-1 pb-24 md:pb-8">
        <Outlet />
      </main>

      <footer className="hidden md:block border-t border-brand-line bg-white py-6 mt-8">
        <div className="max-w-5xl mx-auto px-4 text-center">
          <Logo size={28} showStrapline className="justify-center" />
          <p className="text-xs text-brand-muted mt-3">
            Prices are shown in Birr. Availability is updated throughout the day.
          </p>
        </div>
      </footer>

      {/* Mobile bottom navigation — thumb-reachable, always visible */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-brand-line
                   grid grid-cols-5 pb-[env(safe-area-inset-bottom)]"
      >
        {CUSTOMER_NAV.filter((n) => n.to !== '/contact').slice(0, 5).map((item) => {
          const active = location.pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-medium
                ${active ? 'text-brand-rose' : 'text-brand-muted'}`}
            >
              <Icon d={I[item.icon]} className="w-[22px] h-[22px]" />
              {item.label.split(' ')[0]}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/* --------------------------- Supplier shell ------------------------------- */

export function SupplierShell() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-brand-blush">
      <header className="bg-white border-b border-brand-line sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex items-center justify-between gap-3 py-3">
            <Logo size={30} showStrapline />
            <div className="flex items-center gap-2">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium text-brand-ink leading-tight">{profile?.full_name}</p>
                <p className="text-xs text-brand-muted">Supplier account</p>
              </div>
              <button
                onClick={async () => { await signOut(); navigate('/login', { replace: true }); }}
                aria-label="Sign out"
                className="h-10 w-10 rounded-lg hover:bg-brand-soft flex items-center justify-center text-brand-charcoal"
              >
                <Icon d={I.logout} />
              </button>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto no-scrollbar pb-2">
            {SUPPLIER_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/supplier'}
                className={({ isActive }) =>
                  `shrink-0 px-3.5 py-2 rounded-lg text-sm font-medium transition
                   ${isActive ? 'bg-brand-blush text-brand-deep' : 'text-brand-charcoal hover:bg-brand-soft'}`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-5">
        <Outlet />
      </main>
    </div>
  );
}

/* ----------------------------- Login screen ------------------------------- */

export function LoginShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10 bg-brand-blush">
      <Link to="/" className="mb-7"><LogoHero /></Link>
      <div className="w-full max-w-sm card p-6">{children}</div>
      <Link to="/" className="mt-6 text-sm text-brand-muted hover:text-brand-deep">
        ← Back to the shop
      </Link>
    </div>
  );
}

export function FullPageLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-brand-blush">
      <Spinner size={28} className="text-brand-rose" />
      <p className="text-sm text-brand-muted">{label}…</p>
    </div>
  );
}

/** Keeps a signed-in user inside the area their role belongs to. */
export function RoleRedirect() {
  const { role, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (loading) return;
    if (role === 'OWNER') navigate('/admin', { replace: true });
    else if (role === 'STAFF') navigate('/staff', { replace: true });
    else if (role === 'SUPPLIER') navigate('/supplier', { replace: true });
  }, [role, loading, navigate]);
  return <FullPageLoader label="Taking you to your workspace" />;
}

/** Warm up the auth token on first paint so the first query is not delayed. */
export function useSessionWarmup() {
  useEffect(() => {
    void supabase.auth.getSession();
  }, []);
}
