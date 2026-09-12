import { Link } from 'react-router-dom';
import { fmtDate, money, relativeDays, titleCase } from '../../lib/format';
import {
  Button, Card, EmptyState, ErrorState, LoadingBlock, SectionHeader, StatCard, StatusBadge,
} from '../../components/ui';
import { fetchStaffDashboard } from '../../api/reports';
import { useAsync } from '../../lib/hooks';
import { useAuth } from '../../lib/auth';

/**
 * Staff home.
 *
 * Shows what a shop assistant needs at the start of a shift: today's takings,
 * their own sales and commission, and what is running low. It deliberately
 * shows no cost or profit — the database would not return it anyway (§4).
 */
export default function StaffDashboard() {
  const { profile } = useAuth();
  const dash = useAsync(() => fetchStaffDashboard(), []);

  if (dash.loading) return <LoadingBlock rows={6} label="Loading your shift" />;
  if (dash.error) return <ErrorState message={dash.error} onRetry={dash.reload} />;
  if (!dash.data) return <EmptyState title="Nothing to show" />;

  const d = dash.data;
  const firstName = (profile?.full_name || 'there').split(' ')[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-ink">Hello, {firstName}</h1>
          <p className="text-sm text-brand-muted">{fmtDate(new Date())} · here is where things stand.</p>
        </div>
        <Link to="/staff/pos"><Button className="w-full sm:w-auto">Start a sale</Button></Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Shop takings today" value={<>{money(d.today_sales.amount)} <span className="text-xs font-normal text-brand-muted">Birr</span></>} tone="brand" sub={`${d.today_sales.transactions} sales`} />
        <StatCard label="My sales today" value={money(d.my_sales_today.amount)} sub={`${d.my_sales_today.transactions} sales`} />
        <StatCard label="My sales this month" value={money(d.my_sales_month.amount)} />
        <StatCard label="My commission this month" value={money(d.my_commission_month)} tone="good" sub="3% of each sale, after discount" />
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <StatCard label="Available now" value={d.products.available} tone="good" />
        <StatCard label="Running low" value={d.products.low_stock} tone={d.products.low_stock ? 'warn' : 'default'} />
        <StatCard label="Out of stock" value={d.products.out_of_stock} tone={d.products.out_of_stock ? 'bad' : 'default'} />
      </div>

      {(d.products.low_stock > 0 || d.products.out_of_stock > 0 || d.pending_restocks > 0) && (
        <Card className="border-state-amber/40 bg-state-amber/5">
          <div className="flex items-start gap-3">
            <span className="text-xl" aria-hidden="true">📦</span>
            <div className="flex-1">
              <p className="font-medium text-brand-ink">Worth telling the owner about</p>
              <ul className="text-sm text-brand-muted mt-1 space-y-0.5">
                {d.products.out_of_stock > 0 && <li>{d.products.out_of_stock} products are out of stock.</li>}
                {d.products.low_stock > 0 && <li>{d.products.low_stock} products are running low.</li>}
                {d.pending_restocks > 0 && <li>{d.pending_restocks} received shipments still need a purchase cost.</li>}
              </ul>
              <div className="flex flex-wrap gap-2 mt-2">
                <Link to="/staff/stock"><Button size="sm" variant="secondary">Check stock</Button></Link>
                {d.pending_restocks > 0 && (
                  <Link to="/staff/restock"><Button size="sm" variant="secondary">Receivings</Button></Link>
                )}
              </div>
            </div>
          </div>
        </Card>
      )}

      <Card padded={false}>
        <div className="p-4 sm:p-5 pb-0">
          <SectionHeader
            title="Your recent sales"
            subtitle="Only your own sales appear here."
            action={<Link to="/staff/my-sales"><Button size="sm" variant="ghost">See all</Button></Link>}
          />
        </div>
        {d.recent_sales.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No sales yet today"
              description="Ring one up at the till and it will appear here straight after."
              action={<Link to="/staff/pos"><Button>Open the till</Button></Link>}
            />
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Sale</th>
                  <th>When</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Discount</th>
                  <th>Payment</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d.recent_sales.map((s) => (
                  <tr key={s.sale_number}>
                    <td className="num text-sm text-brand-ink">{s.sale_number}</td>
                    <td className="text-xs text-brand-muted">{relativeDays(s.sale_date)}</td>
                    <td className="text-right num font-medium">{money(s.total_amount)}</td>
                    <td className="text-right num">
                      {Number(s.discount_amount) > 0 ? `−${money(s.discount_amount)}` : '—'}
                    </td>
                    <td className="text-sm text-brand-charcoal">{titleCase(s.payment_method)}</td>
                    <td><StatusBadge status={s.status} /></td>
                    <td className="text-right">
                      <Link to="/staff/my-sales"><Button size="sm" variant="ghost">Details</Button></Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid sm:grid-cols-3 gap-3">
        <Link to="/staff/pos" className="block">
          <Card className="h-full hover:border-brand-rose transition">
            <p className="text-2xl mb-1" aria-hidden="true">🧾</p>
            <p className="font-medium text-brand-ink">New sale</p>
            <p className="text-xs text-brand-muted mt-1">Ring up a customer and print or share a receipt.</p>
          </Card>
        </Link>
        <Link to="/staff/stock" className="block">
          <Card className="h-full hover:border-brand-rose transition">
            <p className="text-2xl mb-1" aria-hidden="true">🔍</p>
            <p className="font-medium text-brand-ink">Check stock</p>
            <p className="text-xs text-brand-muted mt-1">See what is on the shelf before promising a customer.</p>
          </Card>
        </Link>
        <Link to="/staff/my-commission" className="block">
          <Card className="h-full hover:border-brand-rose transition">
            <p className="text-2xl mb-1" aria-hidden="true">💰</p>
            <p className="font-medium text-brand-ink">My commission</p>
            <p className="text-xs text-brand-muted mt-1">What you have earned so far, after any returns.</p>
          </Card>
        </Link>
      </div>
    </div>
  );
}
