/**
 * Routing and access control for the four areas (§2).
 *
 * <RequireRole> is a routing convenience: it stops a signed-in user landing on
 * a screen that is not theirs and shows a clear message rather than a wall of
 * errors. It is not the security boundary — the database refuses the data
 * regardless of which route is reached.
 */
import { Suspense, lazy, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import {
  AppShell, CustomerShell, FullPageLoader, LoginShell, OWNER_NAV, STAFF_NAV, SupplierShell,
} from './layouts/Shells';
import { Button } from './components/ui';
import { Link } from 'react-router-dom';
import type { UserRole } from './types';

/* ---------------------------------------------------------------------------
 * Pages are loaded per area. The public shop is what most visitors open on a
 * phone, so it should not carry the owner portal's charts and tables with it.
 * ------------------------------------------------------------------------- */
const CustomerHome = lazy(() => import('./pages/customer/Home'));
const CustomerProducts = lazy(() => import('./pages/customer/Products'));
const CustomerProductDetail = lazy(() => import('./pages/customer/ProductDetail'));
const CustomerCategories = lazy(() => import('./pages/customer/Categories'));
const CustomerOrder = lazy(() => import('./pages/customer/Order'));
const CustomerRequest = lazy(() => import('./pages/customer/RequestProduct'));
const CustomerContact = lazy(() => import('./pages/customer/Contact'));

const Login = lazy(() => import('./pages/Login'));

const OwnerDashboard = lazy(() => import('./pages/owner/Dashboard'));
const OwnerProducts = lazy(() => import('./pages/owner/Products'));
const OwnerInventory = lazy(() => import('./pages/owner/Inventory'));
const OwnerRestock = lazy(() => import('./pages/owner/Restock'));
const OwnerSuppliers = lazy(() => import('./pages/owner/Suppliers'));
const OwnerCreditBook = lazy(() => import('./pages/owner/CreditBook'));
const OwnerSales = lazy(() => import('./pages/owner/Sales'));
const OwnerSaleDetail = lazy(() => import('./pages/owner/SaleDetail'));
const OwnerReturns = lazy(() => import('./pages/owner/Returns'));
const OwnerStaff = lazy(() => import('./pages/owner/Staff'));
const OwnerCommission = lazy(() => import('./pages/owner/Commission'));
const OwnerExpenses = lazy(() => import('./pages/owner/Expenses'));
const OwnerPnl = lazy(() => import('./pages/owner/Pnl'));
const OwnerTithe = lazy(() => import('./pages/owner/Tithe'));
const OwnerRequests = lazy(() => import('./pages/owner/Requests'));
const OwnerDemand = lazy(() => import('./pages/owner/Demand'));
const OwnerReports = lazy(() => import('./pages/owner/Reports'));
const OwnerSettings = lazy(() => import('./pages/owner/Settings'));
const OwnerAudit = lazy(() => import('./pages/owner/Audit'));
const OwnerStockCount = lazy(() => import('./pages/owner/StockCount'));

const StaffDashboard = lazy(() => import('./pages/staff/Dashboard'));
const StaffProducts = lazy(() => import('./pages/staff/Products'));
const StaffStock = lazy(() => import('./pages/staff/Stock'));
const StaffRestock = lazy(() => import('./pages/staff/Restock'));
const StaffMySales = lazy(() => import('./pages/staff/MySales'));
const StaffMyCommission = lazy(() => import('./pages/staff/MyCommission'));

const SupplierDashboard = lazy(() => import('./pages/supplier/Dashboard'));
const SupplierProducts = lazy(() => import('./pages/supplier/Products'));
const SupplierTransactions = lazy(() => import('./pages/supplier/Transactions'));
const SupplierPayables = lazy(() => import('./pages/supplier/Payables'));
const SupplierPayments = lazy(() => import('./pages/supplier/Payments'));
const SupplierStatements = lazy(() => import('./pages/supplier/Statements'));
const SupplierProfile = lazy(() => import('./pages/supplier/Profile'));

const PosScreen = lazy(() => import('./pages/pos/PosScreen'));
const ReceiptPage = lazy(() => import('./pages/pos/Receipt'));

function RequireRole({ allow, children }: { allow: UserRole[]; children: ReactNode }) {
  const { profile, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullPageLoader label="Checking your access" />;
  if (!profile) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!allow.includes(profile.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-brand-blush">
        <div className="card p-6 max-w-sm text-center">
          <p className="text-3xl mb-2" aria-hidden="true">🔒</p>
          <h1 className="font-semibold text-brand-ink">This area is not available to your account</h1>
          <p className="text-sm text-brand-muted mt-2">
            You are signed in as {profile.role === 'OWNER' ? 'the owner' : profile.role.toLowerCase()}.
            If you think this is wrong, ask the shop owner to check your access.
          </p>
          <Link to="/" className="inline-block mt-4"><Button variant="secondary">Back to the shop</Button></Link>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-brand-blush">
      <div className="card p-6 max-w-sm text-center">
        <p className="text-3xl mb-2" aria-hidden="true">🧭</p>
        <h1 className="font-semibold text-brand-ink">Page not found</h1>
        <p className="text-sm text-brand-muted mt-2">That link does not lead anywhere in LuBella.</p>
        <Link to="/" className="inline-block mt-4"><Button>Go to the shop</Button></Link>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<FullPageLoader label="Loading" />}>
      <Routes>
      {/* -------- public customer portal: no account required (§5) -------- */}
      <Route element={<CustomerShell />}>
        <Route index element={<CustomerHome />} />
        <Route path="products" element={<CustomerProducts />} />
        <Route path="products/:productId" element={<CustomerProductDetail />} />
        <Route path="categories" element={<CustomerCategories />} />
        <Route path="order" element={<CustomerOrder />} />
        <Route path="request" element={<CustomerRequest />} />
        <Route path="contact" element={<CustomerContact />} />
      </Route>

      <Route path="/login" element={<LoginShell><Login /></LoginShell>} />

      {/* ---------------------------- owner ---------------------------- */}
      <Route path="/admin" element={<RequireRole allow={['OWNER']}><AppShell nav={OWNER_NAV} title="LuBella Admin" /></RequireRole>}>
        <Route index element={<OwnerDashboard />} />
        <Route path="pos" element={<PosScreen />} />
        <Route path="products" element={<OwnerProducts />} />
        <Route path="inventory" element={<OwnerInventory />} />
        <Route path="restock" element={<OwnerRestock />} />
        <Route path="suppliers" element={<OwnerSuppliers />} />
        <Route path="credit-book" element={<OwnerCreditBook />} />
        <Route path="sales" element={<OwnerSales />} />
        <Route path="sales/:saleId" element={<OwnerSaleDetail />} />
        <Route path="returns" element={<OwnerReturns />} />
        <Route path="staff" element={<OwnerStaff />} />
        <Route path="commission" element={<OwnerCommission />} />
        <Route path="expenses" element={<OwnerExpenses />} />
        <Route path="pnl" element={<OwnerPnl />} />
        <Route path="tithe" element={<OwnerTithe />} />
        <Route path="requests" element={<OwnerRequests />} />
        <Route path="demand" element={<OwnerDemand />} />
        <Route path="reports" element={<OwnerReports />} />
        <Route path="stock-count" element={<OwnerStockCount />} />
        <Route path="settings" element={<OwnerSettings />} />
        <Route path="audit" element={<OwnerAudit />} />
        <Route path="receipt/:saleId" element={<ReceiptPage />} />
      </Route>

      {/* ---------------------------- staff ---------------------------- */}
      <Route path="/staff" element={<RequireRole allow={['STAFF', 'OWNER']}><AppShell nav={STAFF_NAV} title="LuBella" /></RequireRole>}>
        <Route index element={<StaffDashboard />} />
        <Route path="pos" element={<PosScreen />} />
        <Route path="products" element={<StaffProducts />} />
        <Route path="stock" element={<StaffStock />} />
        <Route path="restock" element={<StaffRestock />} />
        <Route path="my-sales" element={<StaffMySales />} />
        <Route path="my-commission" element={<StaffMyCommission />} />
        <Route path="receipt/:saleId" element={<ReceiptPage />} />
      </Route>

      {/* --------------------------- supplier -------------------------- */}
      <Route path="/supplier" element={<RequireRole allow={['SUPPLIER']}><SupplierShell /></RequireRole>}>
        <Route index element={<SupplierDashboard />} />
        <Route path="products" element={<SupplierProducts />} />
        <Route path="transactions" element={<SupplierTransactions />} />
        <Route path="payables" element={<SupplierPayables />} />
        <Route path="payments" element={<SupplierPayments />} />
        <Route path="statements" element={<SupplierStatements />} />
        <Route path="profile" element={<SupplierProfile />} />
      </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
