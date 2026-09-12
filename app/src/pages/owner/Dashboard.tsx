import { Link } from 'react-router-dom';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtDateShort, money, moneyShort, relativeDays, titleCase } from '../../lib/format';
import {
  Card, EmptyState, ErrorState, LoadingBlock, SectionHeader, StatCard, StatusBadge,
} from '../../components/ui';
import { fetchOwnerDashboard } from '../../api/reports';
import { useAsync } from '../../lib/hooks';

/**
 * Owner dashboard (§43).
 *
 * Everything here is an aggregate computed in SQL. The alert list is the
 * operational to-do: low stock, expiry, unpriced shipments, supplier balances
 * and unmet customer demand.
 */
export default function OwnerDashboard() {
  const { data, loading, error, permissionDenied, reload } = useAsync(() => fetchOwnerDashboard(), []);

  if (loading) return <LoadingBlock rows={6} />;
  if (permissionDenied) {
    return <ErrorState message="Your account does not have access to the owner dashboard." />;
  }
  if (error || !data) return <ErrorState message={error || 'Could not load the dashboard.'} onRetry={reload} />;

  const trend = data.sales_trend.map((t) => ({ ...t, label: fmtDateShort(t.d) }));
  const alerts = data.alerts;

  return (
    <div className="space-y-5">
      {/* ------------------------------ sales ----------------------------- */}
      <section>
        <SectionHeader title="Sales" subtitle="Net of returns, excluding voided sales" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="Today" tone="brand"
            value={<>{money(data.today.sales)} <span className="text-xs font-normal text-brand-muted">Birr</span></>}
            sub={`${data.today.transactions} transaction${data.today.transactions === 1 ? '' : 's'}`}
          />
          <StatCard
            label="This week"
            value={<>{money(data.week.sales)} <span className="text-xs font-normal text-brand-muted">Birr</span></>}
            sub={`${data.week.transactions} transactions`}
          />
          <StatCard
            label="This month"
            value={<>{money(data.month.sales)} <span className="text-xs font-normal text-brand-muted">Birr</span></>}
            sub={`${data.month.transactions} transactions`}
          />
          <StatCard
            label="Gross profit (month)" tone="good"
            value={<>{money(data.month.gross_profit)} <span className="text-xs font-normal text-brand-muted">Birr</span></>}
            sub="Net sales − cost of goods sold"
          />
        </div>
      </section>

      {/* ---------------------------- profitability ----------------------- */}
      <section className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <SectionHeader
            title="Sales trend"
            subtitle="Last 14 days"
            action={<Link to="/admin/reports" className="text-sm text-brand-deep font-medium">Reports</Link>}
          />
          <div className="h-44 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="roseFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#D1809A" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#D1809A" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="label" tick={{ fontSize: 10, fill: '#8A8489' }} axisLine={false}
                  tickLine={false} interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#8A8489' }} axisLine={false} tickLine={false}
                  width={44} tickFormatter={(v) => moneyShort(Number(v))}
                />
                <Tooltip
                  formatter={(v: number) => [`${money(v)} Birr`, 'Net sales']}
                  contentStyle={{ borderRadius: 12, border: '1px solid #EFE1E8', fontSize: 12 }}
                />
                <Area type="monotone" dataKey="revenue" stroke="#D1809A" strokeWidth={2} fill="url(#roseFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <SectionHeader title="This month" subtitle="Profit & loss summary" />
          <dl className="text-sm space-y-2">
            <Line label="Net sales" value={data.month.net_sales} />
            <Line label="Cost of goods sold" value={-data.month.cogs} />
            <div className="border-t border-brand-line pt-2">
              <Line label="Gross profit" value={data.month.gross_profit} bold />
            </div>
            <Line label="Operating expenses" value={-data.month.expenses} />
            <Line label="Staff commission" value={-data.month.commission} />
            <div className="border-t border-brand-line pt-2">
              <Line label="Net profit" value={data.month.net_profit} bold tone={data.month.net_profit >= 0 ? 'good' : 'bad'} />
            </div>
            <div className="pt-1">
              <Line
                label="Tithe due (10% of net profit)"
                value={data.month.tithe_due}
                muted
              />
              {data.month.net_profit <= 0 && (
                <p className="text-xs text-brand-muted mt-1">No tithe due — the month is not profitable.</p>
              )}
            </div>
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to="/admin/pnl" className="text-sm text-brand-deep font-medium">Full P&amp;L →</Link>
          </div>
        </Card>
      </section>

      {/* ------------------------------ stock ---------------------------- */}
      <section>
        <SectionHeader
          title="Stock & liabilities"
          action={<Link to="/admin/inventory" className="text-sm text-brand-deep font-medium">Inventory</Link>}
        />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Stock units" value={data.stock.units} sub="Across active products" />
          <StatCard label="Stock value (at cost)" value={<>{money(data.stock.value)} <span className="text-xs font-normal text-brand-muted">Birr</span></>} tone="brand" />
          <StatCard
            label="Supplier payable"
            value={<>{money(data.supplier_payable)} <span className="text-xs font-normal text-brand-muted">Birr</span></>}
            sub={<Link to="/admin/credit-book" className="text-brand-deep">Credit book →</Link>}
            tone="warn"
          />
          <StatCard
            label="Needs attention"
            value={data.stock.low_stock + data.stock.out_of_stock + data.stock.expired + data.stock.expiring_soon}
            sub={`${data.stock.low_stock} low · ${data.stock.out_of_stock} out · ${data.stock.expired} expired`}
            tone={data.stock.out_of_stock + data.stock.expired > 0 ? 'bad' : 'default'}
          />
        </div>
      </section>

      {/* ------------------------------ alerts ---------------------------- */}
      <section className="grid lg:grid-cols-2 gap-4">
        <Card>
          <SectionHeader
            title="Alerts"
            subtitle="Things that need a decision"
            action={<span className="chip-rose">{alerts.length}</span>}
          />
          {alerts.length === 0 ? (
            <EmptyState icon={<span className="text-2xl">✅</span>} title="Nothing needs attention" description="Stock, expiry and supplier balances are all in order." />
          ) : (
            <ul className="divide-y divide-brand-line max-h-80 overflow-y-auto -mx-1">
              {alerts.slice(0, 14).map((a, i) => (
                <li key={i} className="py-2.5 px-1 flex items-start gap-3">
                  <span className="text-base leading-none mt-0.5" aria-hidden="true">
                    {a.severity === 'danger' ? '🔴' : a.severity === 'warning' ? '🟡' : 'ℹ️'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-brand-ink truncate">{a.title}</p>
                    <p className="text-xs text-brand-muted">{a.detail}</p>
                  </div>
                  <span className="chip-slate shrink-0">{titleCase(a.type)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* --------------------------- demand ---------------------------- */}
        <Card>
          <SectionHeader
            title="Most requested products"
            subtitle="What customers asked for (last 90 days)"
            action={<Link to="/admin/demand" className="text-sm text-brand-deep font-medium">Demand →</Link>}
          />
          {data.customer_demand.length === 0 ? (
            <EmptyState
              title="No customer requests yet"
              description="Requests from the shop page and from WhatsApp appear here, ranked by demand."
            />
          ) : (
            <ul className="divide-y divide-brand-line">
              {data.customer_demand.slice(0, 6).map((d) => (
                <li key={d.product_name} className="py-2.5 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-brand-ink truncate">{d.product_name}</p>
                    <p className="text-xs text-brand-muted">
                      {d.unique_customers} customer{d.unique_customers === 1 ? '' : 's'} · last {relativeDays(d.last_requested)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold num text-brand-deep">{d.request_count}</p>
                    <p className="text-[10px] text-brand-muted uppercase">requests</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {/* --------------------- requests + staff + top --------------------- */}
      <section className="grid lg:grid-cols-3 gap-4">
        <Card>
          <SectionHeader
            title="Customer requests"
            subtitle={`${data.customer_requests.new} new · ${data.customer_requests.open} open`}
            action={<Link to="/admin/requests" className="text-sm text-brand-deep font-medium">All →</Link>}
          />
          {data.customer_requests.recent.length === 0 ? (
            <p className="text-sm text-brand-muted py-3">No requests yet.</p>
          ) : (
            <ul className="divide-y divide-brand-line">
              {data.customer_requests.recent.map((r) => (
                <li key={r.id} className="py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-brand-ink truncate">{r.requested_product_name}</p>
                    <StatusBadge status={r.status} />
                  </div>
                  <p className="text-xs text-brand-muted mt-0.5">
                    {r.request_number} · {r.customer_name || 'Anonymous'} · ×{r.quantity} ·{' '}
                    {relativeDays(r.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionHeader title="Top products" subtitle="By revenue this month" />
          {data.top_products.length === 0 ? (
            <p className="text-sm text-brand-muted py-3">No sales this month yet.</p>
          ) : (
            <ul className="divide-y divide-brand-line">
              {data.top_products.map((p, i) => (
                <li key={p.product_code} className="py-2.5 flex items-center gap-3">
                  <span className="h-6 w-6 rounded-full bg-brand-blush text-brand-deep text-xs
                                   font-semibold flex items-center justify-center shrink-0">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-brand-ink truncate">{p.name}</p>
                    <p className="text-xs text-brand-muted num">{p.units} sold</p>
                  </div>
                  <p className="text-sm num font-medium shrink-0">{money(p.revenue)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionHeader
            title="Staff performance"
            subtitle="This month"
            action={<Link to="/admin/staff" className="text-sm text-brand-deep font-medium">Staff →</Link>}
          />
          {data.staff_performance.length === 0 ? (
            <p className="text-sm text-brand-muted py-3">No staff accounts yet.</p>
          ) : (
            <ul className="divide-y divide-brand-line">
              {data.staff_performance.map((s) => (
                <li key={s.staff_id} className="py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-brand-ink truncate">{s.full_name}</p>
                    <p className="text-sm num shrink-0">{money(s.revenue)}</p>
                  </div>
                  <p className="text-xs text-brand-muted num">
                    {s.sales_count} sales · {money(s.commission)} Birr commission
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}

function Line({
  label, value, bold, muted, tone,
}: {
  label: string; value: number; bold?: boolean; muted?: boolean;
  tone?: 'good' | 'bad';
}) {
  const colour = tone === 'good' ? 'text-state-green' : tone === 'bad' ? 'text-state-red' : 'text-brand-ink';
  return (
    <div className="flex justify-between gap-3">
      <dt className={`${muted ? 'text-brand-muted text-xs' : 'text-brand-charcoal'} ${bold ? 'font-semibold' : ''}`}>
        {label}
      </dt>
      <dd className={`num ${bold ? 'font-semibold' : ''} ${colour}`}>{money(value)}</dd>
    </div>
  );
}
