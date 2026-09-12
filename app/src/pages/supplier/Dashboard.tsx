import { Link } from 'react-router-dom';
import { fmtDate, money, titleCase } from '../../lib/format';
import {
  Button, Card, EmptyState, ErrorState, LoadingBlock, SectionHeader, StatCard, StatusBadge,
} from '../../components/ui';
import { fetchSupplierOrders, fetchSupplierProfile, fetchSupplierStatements, fetchSupplierSummary } from '../../api/supplier';
import { useAsync } from '../../lib/hooks';

/**
 * Supplier home.
 *
 * Everything on this page is the signed-in supplier's own data. This is not a
 * filter applied by the screen: each view is bound to `fn_current_supplier_id()`
 * inside the database, so another supplier's rows are unreachable with any
 * token, URL or query the browser could be persuaded to send (§51).
 */
export default function SupplierDashboard() {
  const summary = useAsync(() => fetchSupplierSummary(), []);
  const profile = useAsync(() => fetchSupplierProfile(), []);
  const orders = useAsync(() => fetchSupplierOrders(), []);
  const statements = useAsync(() => fetchSupplierStatements(), []);

  const loading = summary.loading || profile.loading;
  const error = summary.error || profile.error;

  if (loading) return <LoadingBlock rows={6} label="Loading your account" />;
  if (error) return <ErrorState message={error} onRetry={() => { summary.reload(); profile.reload(); }} />;

  const s = summary.data;
  const p = profile.data;
  const recent = (orders.data ?? []).slice(0, 6);
  const latestStatement = statements.data?.[0];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-brand-ink">{p?.name || 'Your account'}</h1>
        <p className="text-sm text-brand-muted">
          {p?.supplier_code}
          {p?.contact_name ? ` · ${p.contact_name}` : ''}
          {p?.phone ? ` · ${p.phone}` : ''}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Units you supplied"
          value={s?.units_supplied ?? 0}
          sub={`${s?.products_supplied ?? 0} products`}
        />
        <StatCard
          label="Units sold to customers"
          value={s?.units_sold ?? 0}
          tone="brand"
          sub="What becomes payable"
        />
        <StatCard
          label="Still in the shop"
          value={s?.units_in_stock ?? 0}
          sub="Not payable until sold"
        />
        <StatCard
          label="Outstanding balance"
          value={<>{money(s?.outstanding ?? 0)} <span className="text-xs font-normal text-brand-muted">Birr</span></>}
          tone={Number(s?.outstanding ?? 0) > 0 ? 'warn' : 'good'}
        />
      </div>

      <Card className="bg-brand-soft border-brand-line">
        <SectionHeader title="How your balance works" />
        <p className="text-sm text-brand-charcoal">
          You are paid for the units that actually sell — at the purchase cost we agreed, never at the
          shop's selling price. Stock delivered but still on the shelf is not part of the balance yet.
          Every figure on this page comes from recorded transactions.
        </p>
        <dl className="grid grid-cols-3 gap-3 mt-3 text-sm">
          <div>
            <dt className="text-xs text-brand-muted">Charged</dt>
            <dd className="num font-medium text-brand-ink">{money(s?.total_payable ?? 0)}</dd>
          </div>
          <div>
            <dt className="text-xs text-brand-muted">Paid</dt>
            <dd className="num font-medium text-state-green">{money(s?.total_paid ?? 0)}</dd>
          </div>
          <div>
            <dt className="text-xs text-brand-muted">Outstanding</dt>
            <dd className="num font-medium text-brand-ink">{money(s?.outstanding ?? 0)}</dd>
          </div>
        </dl>
      </Card>

      {latestStatement && (
        <Card>
          <SectionHeader
            title="Latest statement"
            subtitle={`${latestStatement.statement_number} · ${fmtDate(latestStatement.period_month)}`}
            action={<Link to="/supplier/statements"><Button size="sm" variant="ghost">All statements</Button></Link>}
          />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-xs text-brand-muted">Opening</p>
              <p className="num text-brand-ink">{money(latestStatement.opening_outstanding)}</p>
            </div>
            <div>
              <p className="text-xs text-brand-muted">Payable this month</p>
              <p className="num text-brand-ink">{money(latestStatement.total_payable)}</p>
            </div>
            <div>
              <p className="text-xs text-brand-muted">Paid this month</p>
              <p className="num text-ink">{money(latestStatement.total_paid)}</p>
            </div>
            <div>
              <p className="text-xs text-brand-muted">Closing balance</p>
              <p className="num font-medium text-brand-ink">{money(latestStatement.outstanding)}</p>
            </div>
          </div>
        </Card>
      )}

      <Card padded={false}>
        <div className="p-4 sm:p-5 pb-0">
          <SectionHeader
            title="Recent activity"
            subtitle="Units sold from your batches, and what each contributed."
            action={<Link to="/supplier/transactions"><Button size="sm" variant="ghost">See all</Button></Link>}
          />
        </div>
        {recent.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No sales from your stock yet"
              description="When a unit from one of your batches sells, the payable appears here."
            />
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Product</th>
                  <th>Batch</th>
                  <th className="text-right">Units sold</th>
                  <th className="text-right">Unit cost</th>
                  <th className="text-right">Payable</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((o) => (
                  <tr key={o.id}>
                    <td className="text-xs text-brand-muted whitespace-nowrap">{fmtDate(o.entry_date)}</td>
                    <td>
                      <p className="text-brand-ink">{o.product_name}</p>
                      <p className="text-xs text-brand-muted num">{o.product_code}</p>
                    </td>
                    <td className="num text-xs text-brand-charcoal">{o.batch_number}</td>
                    <td className="text-right num">{o.quantity_sold}</td>
                    <td className="text-right num">{money(o.unit_cost)}</td>
                    <td className={`text-right num font-medium ${o.is_reversal ? 'text-state-red' : ''}`}>
                      {money(o.payable_amount)}
                    </td>
                    <td><StatusBadge status={o.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid sm:grid-cols-3 gap-3">
        <Link to="/supplier/products" className="block">
          <Card className="h-full hover:border-brand-rose transition">
            <p className="text-2xl mb-1" aria-hidden="true">📦</p>
            <p className="font-medium text-brand-ink">Products &amp; batches</p>
            <p className="text-xs text-brand-muted mt-1">What you supplied, and how much is left on the shelf.</p>
          </Card>
        </Link>
        <Link to="/supplier/payables" className="block">
          <Card className="h-full hover:border-brand-rose transition">
            <p className="text-2xl mb-1" aria-hidden="true">📄</p>
            <p className="font-medium text-brand-ink">Payables</p>
            <p className="text-xs text-brand-muted mt-1">Each payable line, and what has been settled.</p>
          </Card>
        </Link>
        <Link to="/supplier/profile" className="block">
          <Card className="h-full hover:border-brand-rose transition">
            <p className="text-2xl mb-1" aria-hidden="true">🏷️</p>
            <p className="font-medium text-brand-ink">Our details</p>
            <p className="text-xs text-brand-muted mt-1">
              {p?.payment_terms ? `Payment terms: ${titleCase(p.payment_terms)}` : 'Check your contact and TIN details.'}
            </p>
          </Card>
        </Link>
      </div>
    </div>
  );
}
