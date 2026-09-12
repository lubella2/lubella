import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { fmtDate, money } from '../../lib/format';
import {
  Button, Card, EmptyState, ErrorState, Field, Input, LoadingBlock, SectionHeader, StatCard, Tabs,
} from '../../components/ui';
import { fetchDailySales, fetchFifoReport, fetchProductSales } from '../../api/reports';
import { useAsync } from '../../lib/hooks';

/**
 * Reports.
 *
 * Three questions the shop actually asks:
 *   • what sells, and what does it earn?        → product sales
 *   • which batches made up that cost of goods? → FIFO / COGS
 *   • how did each day go?                      → daily trading
 *
 * Every figure is aggregated in SQL from the recorded transactions, so a report
 * can always be traced back to the rows that produced it.
 */
export default function OwnerReports() {
  const [tab, setTab] = useState<'products' | 'fifo' | 'daily'>('products');
  const [from, setFrom] = useState(new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  const products = useAsync(() => fetchProductSales(from, to), [from, to]);
  const fifo = useAsync(() => fetchFifoReport(from, to), [from, to]);
  const daily = useAsync(() => fetchDailySales(from, to), [from, to]);

  const chart = (daily.data?.items ?? []).map((d) => ({
    day: String(d.sale_date).slice(5),
    net_sales: Number(d.net_sales),
    gross_profit: Number(d.gross_profit),
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-ink">Reports</h1>
          <p className="text-sm text-brand-muted">
            Built from the transaction records. Nothing here is typed in or estimated.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/admin/pnl"><Button variant="secondary">Profit &amp; loss</Button></Link>
          <Link to="/admin/demand"><Button variant="secondary">Demand</Button></Link>
        </div>
      </div>

      <Card>
        <div className="grid sm:grid-cols-2 gap-3 max-w-xl">
          <Field label="From">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
      </Card>

      <Tabs
        tabs={[
          { id: 'products', label: 'Product sales', count: products.data?.products.length },
          { id: 'fifo', label: 'FIFO & cost of goods', count: fifo.data?.items.length },
          { id: 'daily', label: 'Daily trading' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'products' && (
        products.loading ? <LoadingBlock rows={6} /> :
        products.error ? <ErrorState message={products.error} onRetry={products.reload} /> :
        products.data && products.data.products.length === 0 ? (
          <Card><EmptyState title="No sales in this period" description="Widen the dates to see more." /></Card>
        ) : products.data && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard
                label="Net revenue"
                value={money(products.data.products.reduce((s, p) => s + Number(p.net_revenue), 0))}
                tone="brand"
              />
              <StatCard
                label="Cost of goods"
                value={money(products.data.products.reduce((s, p) => s + Number(p.cogs), 0))}
              />
              <StatCard
                label="Gross profit"
                tone="good"
                value={money(products.data.products.reduce((s, p) => s + Number(p.gross_profit), 0))}
              />
              <StatCard
                label="Units sold"
                value={products.data.products.reduce((s, p) => s + p.units_sold, 0)}
              />
            </div>

            <Card padded={false}>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th className="text-right">Units</th>
                      <th className="text-right">Gross</th>
                      <th className="text-right">Discounts</th>
                      <th className="text-right">Net revenue</th>
                      <th className="text-right">COGS</th>
                      <th className="text-right">Gross profit</th>
                      <th className="text-right">Returned</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.data.products.map((p) => (
                      <tr key={p.product_code}>
                        <td>
                          <p className="text-brand-ink">{p.name}</p>
                          <p className="text-xs text-brand-muted">{p.category || 'Uncategorised'}</p>
                        </td>
                        <td className="text-right num">{p.units_sold}</td>
                        <td className="text-right num">{money(p.gross_revenue)}</td>
                        <td className="text-right num">{Number(p.discounts) > 0 ? `−${money(p.discounts)}` : '—'}</td>
                        <td className="text-right num font-medium">{money(p.net_revenue)}</td>
                        <td className="text-right num">{money(p.cogs)}</td>
                        <td className={`text-right num ${Number(p.gross_profit) < 0 ? 'text-state-red' : ''}`}>
                          {money(p.gross_profit)}
                        </td>
                        <td className="text-right num">{p.units_returned > 0 ? p.units_returned : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {products.data.demand.length > 0 && (
              <Card padded={false}>
                <div className="p-4 sm:p-5 pb-0">
                  <SectionHeader
                    title="Also requested by customers"
                    subtitle="Asked for in the same period, whether or not it was in stock."
                  />
                </div>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Requested product</th>
                        <th className="text-right">Requests</th>
                        <th className="text-right">Customers</th>
                        <th>Last asked</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.data.demand.map((d, i) => (
                        <tr key={`${d.product_name}-${i}`}>
                          <td className="text-brand-ink">{d.product_name}</td>
                          <td className="text-right num">{d.requests}</td>
                          <td className="text-right num">{d.customers}</td>
                          <td className="text-xs text-brand-muted">{fmtDate(d.last_requested)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </>
        )
      )}

      {tab === 'fifo' && (
        fifo.loading ? <LoadingBlock rows={6} /> :
        fifo.error ? <ErrorState message={fifo.error} onRetry={fifo.reload} /> :
        fifo.data && (
          <>
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Cost allocated out" value={money(fifo.data.totals.cogs_out)} tone="brand" sub="Oldest batches consumed first" />
              <StatCard label="Cost reversed in" value={money(fifo.data.totals.reversed_in)} sub="Returns and voids" />
              <StatCard label="Allocations" value={fifo.data.totals.allocations} />
            </div>

            <Card className="bg-brand-soft border-brand-line">
              <p className="text-xs text-brand-charcoal">
                Each row is one allocation: which batch a sold unit came out of, what that batch's
                purchase cost was, and therefore what it contributed to cost of goods sold — and to
                what the shop owes the supplier who provided it.
              </p>
            </Card>

            {fifo.data.items.length === 0 ? (
              <Card><EmptyState title="No cost allocations in this period" /></Card>
            ) : (
              <Card padded={false}>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Product</th>
                        <th>Batch</th>
                        <th>Supplier</th>
                        <th>Sale</th>
                        <th className="text-right">Qty</th>
                        <th className="text-right">Unit cost</th>
                        <th className="text-right">Total cost</th>
                        <th>Direction</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fifo.data.items.map((f, i) => (
                        <tr key={`${f.batch_number}-${f.sale_number}-${i}`} className={f.direction === 'IN' ? 'bg-brand-blush/40' : ''}>
                          <td className="text-xs text-brand-muted whitespace-nowrap">{fmtDate(f.created_at)}</td>
                          <td className="text-sm text-brand-ink">{f.product_name}</td>
                          <td>
                            <p className="num text-xs text-brand-charcoal">{f.batch_number}</p>
                            <p className="text-xs text-brand-muted">received {fmtDate(f.received_date)}</p>
                          </td>
                          <td className="text-sm text-brand-charcoal">{f.supplier_name}</td>
                          <td className="num text-xs text-brand-muted">{f.sale_number || '—'}</td>
                          <td className="text-right num">{f.quantity}</td>
                          <td className="text-right num">{money(f.unit_cost)}</td>
                          <td className={`text-right num font-medium ${f.direction === 'IN' ? 'text-state-red' : ''}`}>
                            {f.direction === 'IN' ? '−' : ''}{money(f.total_cost)}
                          </td>
                          <td>
                            <span className={f.direction === 'IN' ? 'chip-amber' : 'chip-slate'}>
                              {f.direction === 'IN' ? 'Reversed' : 'Consumed'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </>
        )
      )}

      {tab === 'daily' && (
        daily.loading ? <LoadingBlock rows={5} /> :
        daily.error ? <ErrorState message={daily.error} onRetry={daily.reload} /> :
        daily.data && (
          <>
            <Card>
              <SectionHeader title="Net sales and gross profit by day" subtitle={`${fmtDate(from)} → ${fmtDate(to)}`} />
              <div className="h-64 -ml-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chart} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EFE1E8" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#8A8489' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#8A8489' }} axisLine={false} tickLine={false}
                      tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                    />
                    <Tooltip
                      formatter={(value: number) => money(value)}
                      contentStyle={{ borderRadius: 12, border: '1px solid #EFE1E8', fontSize: 12 }}
                    />
                    <Line type="monotone" dataKey="net_sales" name="Net sales" stroke="#D1809A" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="gross_profit" name="Gross profit" stroke="#3F9D6D" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <div className="grid sm:grid-cols-2 gap-4">
              <Card>
                <SectionHeader title="Best days" subtitle="By net sales" />
                <div className="space-y-2">
                  {[...daily.data.items]
                    .sort((a, b) => Number(b.net_sales) - Number(a.net_sales))
                    .slice(0, 5)
                    .map((d) => (
                      <div key={d.sale_date} className="flex items-center justify-between text-sm">
                        <span className="text-brand-charcoal">{fmtDate(d.sale_date)}</span>
                        <span className="num text-brand-ink">
                          {money(d.net_sales)}
                          <span className="text-xs text-brand-muted"> · {d.sale_count} sales</span>
                        </span>
                      </div>
                    ))}
                </div>
              </Card>

              <Card>
                <SectionHeader title="Month totals" subtitle="Rolled up from the days shown" />
                <dl className="space-y-2 text-sm">
                  <Row label="Net sales" value={money(daily.data.items.reduce((s, d) => s + Number(d.net_sales), 0))} />
                  <Row label="Discounts" value={money(daily.data.items.reduce((s, d) => s + Number(d.discounts), 0))} />
                  <Row label="Cost of goods" value={money(daily.data.items.reduce((s, d) => s + Number(d.cogs), 0))} />
                  <Row label="Gross profit" value={money(daily.data.items.reduce((s, d) => s + Number(d.gross_profit), 0))} />
                  <Row label="Sales recorded" value={String(daily.data.items.reduce((s, d) => s + d.sale_count, 0))} />
                </dl>
                <p className="text-xs text-brand-muted mt-3">
                  Expenses, commission and tithe are not in these figures — see the P&amp;L for net profit.
                </p>
              </Card>
            </div>
          </>
        )
      )}

      <Card>
        <SectionHeader title="Where these numbers come from" />
        <ul className="text-sm text-brand-charcoal space-y-1.5 list-disc pl-5">
          <li>Sales, returns and voids are read from the sales records, never recalculated from today's prices.</li>
          <li>Cost of goods comes from the FIFO allocations made at the moment of each sale.</li>
          <li>Supplier payables for those same units are the batch cost — never the selling price.</li>
          <li>Reports respect the month close: a closed month's figures are the ones locked in at close.</li>
        </ul>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-brand-muted">{label}</dt>
      <dd className="num text-brand-ink">{value}</dd>
    </div>
  );
}
