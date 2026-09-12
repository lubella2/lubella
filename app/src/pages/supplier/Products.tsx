import { useMemo, useState } from 'react';
import { fmtDate, money } from '../../lib/format';
import {
  Card, EmptyState, ErrorState, Input, LoadingBlock, StatCard, Tabs,
} from '../../components/ui';
import { fetchSupplierOrders, fetchSupplierReceipts } from '../../api/supplier';
import { useAsync, useDebounced } from '../../lib/hooks';

/**
 * Products and batches (supplier view).
 *
 * A supplier sees what they delivered, how much of it has sold, and how much is
 * still on the shelf — never the shop's selling price or its margins. Which
 * columns exist is decided by the view in the database, so the restriction is
 * not something this page could forget to apply.
 */
export default function SupplierProducts() {
  const [tab, setTab] = useState<'batches' | 'sales'>('batches');
  const [search, setSearch] = useState('');
  const [onlyRemaining, setOnlyRemaining] = useState(false);
  const debounced = useDebounced(search, 250);

  const receipts = useAsync(() => fetchSupplierReceipts(), []);
  const orders = useAsync(() => fetchSupplierOrders(), []);

  const batches = useMemo(() => {
    const list = receipts.data ?? [];
    const term = debounced.trim().toLowerCase();
    return list.filter((b) => {
      if (onlyRemaining && b.quantity_remaining <= 0) return false;
      if (!term) return true;
      return b.product_name.toLowerCase().includes(term)
        || b.product_code.toLowerCase().includes(term)
        || b.batch_number.toLowerCase().includes(term);
    });
  }, [receipts.data, debounced, onlyRemaining]);

  const totals = useMemo(() => {
    const list = receipts.data ?? [];
    return {
      batches: list.length,
      delivered: list.reduce((s, b) => s + b.quantity_received, 0),
      sold: list.reduce((s, b) => s + b.quantity_sold, 0),
      remaining: list.reduce((s, b) => s + b.quantity_remaining, 0),
    };
  }, [receipts.data]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-brand-ink">Products &amp; batches</h1>
        <p className="text-sm text-brand-muted">
          Everything you have supplied to the shop, batch by batch.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Batches delivered" value={totals.batches} />
        <StatCard label="Units delivered" value={totals.delivered} />
        <StatCard label="Units sold" value={totals.sold} tone="brand" sub="These are what you are paid for" />
        <StatCard label="Still on the shelf" value={totals.remaining} sub="Not yet payable" />
      </div>

      <Tabs
        tabs={[
          { id: 'batches', label: 'Deliveries', count: receipts.data?.length },
          { id: 'sales', label: 'Units sold', count: orders.data?.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'batches' ? (
        <>
          <Card>
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
              <Input
                value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search product or batch" className="sm:max-w-xs"
              />
              <label className="flex items-center gap-2 text-sm text-brand-charcoal shrink-0">
                <input
                  type="checkbox" checked={onlyRemaining}
                  onChange={(e) => setOnlyRemaining(e.target.checked)}
                  className="h-5 w-5 rounded border-brand-line accent-[#D1809A]"
                />
                Only batches with stock left
              </label>
            </div>
          </Card>

          {receipts.loading ? <LoadingBlock rows={6} /> :
           receipts.error ? <ErrorState message={receipts.error} onRetry={receipts.reload} /> :
           batches.length === 0 ? (
            <Card><EmptyState title="No deliveries recorded" description="Batches appear here once the shop receives your stock." /></Card>
          ) : (
            <Card padded={false}>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Batch</th>
                      <th>Product</th>
                      <th className="text-right">Unit cost</th>
                      <th className="text-right">Delivered</th>
                      <th className="text-right">Sold</th>
                      <th className="text-right">Remaining</th>
                      <th>Expiry</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((b) => (
                      <tr key={b.id}>
                        <td>
                          <p className="num text-sm text-brand-ink">{b.batch_number}</p>
                          <p className="text-xs text-brand-muted">{fmtDate(b.received_date)}</p>
                        </td>
                        <td>
                          <p className="text-brand-ink">{b.product_name}</p>
                          <p className="text-xs text-brand-muted num">{b.product_code}</p>
                        </td>
                        <td className="text-right num">
                          {b.cost_status === 'PENDING'
                            ? <span className="chip-amber">Not set</span>
                            : money(b.unit_cost)}
                        </td>
                        <td className="text-right num">{b.quantity_received}</td>
                        <td className="text-right num">{b.quantity_sold}</td>
                        <td className="text-right num font-medium">{b.quantity_remaining}</td>
                        <td className="text-xs text-brand-muted">{b.expiry_date ? fmtDate(b.expiry_date) : '—'}</td>
                        <td>
                          {b.cost_status === 'PENDING'
                            ? <span className="chip-amber">Awaiting cost</span>
                            : b.quantity_remaining > 0
                              ? <span className="chip-green">In stock</span>
                              : <span className="chip-slate">Sold through</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      ) : (
        orders.loading ? <LoadingBlock rows={6} /> :
        orders.error ? <ErrorState message={orders.error} onRetry={orders.reload} /> :
        (orders.data?.length ?? 0) === 0 ? (
          <Card><EmptyState title="No sales yet" description="When a unit from your stock sells, it appears here." /></Card>
        ) : (
          <Card padded={false}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Product</th>
                    <th>Batch</th>
                    <th className="text-right">Units</th>
                    <th className="text-right">Unit cost</th>
                    <th className="text-right">Payable</th>
                    <th className="text-right">Paid</th>
                    <th className="text-right">Outstanding</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.data!.map((o) => (
                    <tr key={o.id} className={o.is_reversal ? 'bg-brand-blush/40' : ''}>
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
                        {o.is_reversal && <span className="block text-[10px]">reversal</span>}
                      </td>
                      <td className="text-right num">{money(o.amount_paid)}</td>
                      <td className="text-right num">{money(o.outstanding)}</td>
                      <td>
                        <span className={
                          o.status === 'PAID' ? 'chip-green' : o.status === 'PARTIAL' ? 'chip-amber' : 'chip-slate'
                        }>
                          {o.status === 'PAID' ? 'Paid' : o.status === 'PARTIAL' ? 'Partly paid' : 'Unpaid'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-4 border-t border-brand-line">
              <p className="text-xs text-brand-muted">
                A reversal line appears when the shop refunds a customer for units that came from your
                batch: the payable for those units is reversed with the sale. Nothing is deleted.
              </p>
            </div>
          </Card>
        )
      )}

      <Card>
        <p className="text-xs text-brand-charcoal">
          <strong>What you cannot see here:</strong> the shop's selling prices, its discounts, its
          costs other than your own agreed price, or any other supplier's transactions. Those are
          withheld in the database itself, not hidden on this screen.
        </p>
      </Card>
    </div>
  );
}
