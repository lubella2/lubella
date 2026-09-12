import { useMemo, useState } from 'react';
import { fmtDate, money, titleCase } from '../../lib/format';
import {
  Button, Card, EmptyState, ErrorState, Field, Input, LoadingBlock, StatCard, StatusBadge, Tabs,
} from '../../components/ui';
import { fetchSupplierOrders, fetchSupplierPayments, fetchSupplierReceipts } from '../../api/supplier';
import { useAsync } from '../../lib/hooks';

/**
 * Transactions.
 *
 * The full, chronological record of the relationship: what the shop received
 * from this supplier, what sold, what was reversed, and what has been paid.
 * Read-only by design — a supplier cannot post or amend a transaction.
 */
export default function SupplierTransactions() {
  const [tab, setTab] = useState<'sales' | 'deliveries' | 'payments'>('sales');
  const [from, setFrom] = useState(new Date(Date.now() - 179 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  const orders = useAsync(() => fetchSupplierOrders(), []);
  const receipts = useAsync(() => fetchSupplierReceipts(), []);
  const payments = useAsync(() => fetchSupplierPayments(), []);

  const inRange = <T extends { entry_date?: string; received_date?: string; payment_date?: string }>(rows: T[]) =>
    rows.filter((r) => {
      const d = r.entry_date ?? r.received_date ?? r.payment_date ?? '';
      return d >= from && d <= to;
    });

  const sales = useMemo(() => inRange(orders.data ?? []), [orders.data, from, to]);
  const deliveries = useMemo(() => inRange(receipts.data ?? []), [receipts.data, from, to]);
  const paid = useMemo(() => inRange(payments.data ?? []), [payments.data, from, to]);

  const totals = useMemo(() => ({
    charge: sales.filter((s) => !s.is_reversal).reduce((s, o) => s + Number(o.payable_amount), 0),
    reversed: sales.filter((s) => s.is_reversal).reduce((s, o) => s + Math.abs(Number(o.payable_amount)), 0),
    paid: paid.reduce((s, p) => s + Number(p.amount), 0),
    units: sales.reduce((s, o) => s + o.quantity_sold, 0),
  }), [sales, paid]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-brand-ink">Transactions</h1>
        <p className="text-sm text-brand-muted">
          Every movement on your account, with the batch and date behind it.
        </p>
      </div>

      <Card>
        <div className="grid sm:grid-cols-2 gap-3 max-w-md">
          <Field label="From">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Charged (cost of units sold)" value={money(totals.charge)} tone="brand" sub={`${totals.units} units`} />
        <StatCard label="Reversed" value={money(totals.reversed)} tone={totals.reversed > 0 ? 'warn' : 'default'} sub="Customer refunds" />
        <StatCard label="Paid to you" value={money(totals.paid)} tone="good" />
        <StatCard label="Deliveries in period" value={deliveries.length} />
      </div>

      <Tabs
        tabs={[
          { id: 'sales', label: 'Units sold', count: sales.length },
          { id: 'deliveries', label: 'Deliveries', count: deliveries.length },
          { id: 'payments', label: 'Payments received', count: paid.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'sales' && (
        orders.loading ? <LoadingBlock rows={6} /> :
        orders.error ? <ErrorState message={orders.error} onRetry={orders.reload} /> :
        sales.length === 0 ? (
          <Card><EmptyState title="Nothing sold in this period" description="Widen the dates to see earlier activity." /></Card>
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
                    <th className="text-right">Charged</th>
                    <th className="text-right">Paid</th>
                    <th className="text-right">Outstanding</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((o) => (
                    <tr key={o.id} className={o.is_reversal ? 'bg-brand-blush/40' : ''}>
                      <td className="text-xs text-brand-muted whitespace-nowrap">{fmtDate(o.entry_date)}</td>
                      <td>
                        <p className="text-brand-ink">{o.product_name}</p>
                        <p className="text-xs text-brand-muted num">{o.product_code}</p>
                      </td>
                      <td className="num text-xs text-brand-charcoal">
                        {o.batch_number}
                        <span className="block text-brand-muted">received {fmtDate(o.received_date)}</span>
                      </td>
                      <td className="text-right num">{o.quantity_sold}</td>
                      <td className="text-right num">{money(o.unit_cost)}</td>
                      <td className={`text-right num font-medium ${o.is_reversal ? 'text-state-red' : ''}`}>
                        {money(o.payable_amount)}
                      </td>
                      <td className="text-right num">{money(o.amount_paid)}</td>
                      <td className="text-right num">{money(o.outstanding)}</td>
                      <td><StatusBadge status={o.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )
      )}

      {tab === 'deliveries' && (
        receipts.loading ? <LoadingBlock rows={6} /> :
        receipts.error ? <ErrorState message={receipts.error} onRetry={receipts.reload} /> :
        deliveries.length === 0 ? (
          <Card><EmptyState title="No deliveries in this period" /></Card>
        ) : (
          <Card padded={false}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Received</th>
                    <th>Batch</th>
                    <th>Product</th>
                    <th className="text-right">Quantity</th>
                    <th className="text-right">Unit cost</th>
                    <th className="text-right">Sold so far</th>
                    <th>Expiry</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((b) => (
                    <tr key={b.id}>
                      <td className="text-xs text-brand-muted whitespace-nowrap">{fmtDate(b.received_date)}</td>
                      <td className="num text-xs text-brand-charcoal">{b.batch_number}</td>
                      <td>
                        <p className="text-brand-ink">{b.product_name}</p>
                        <p className="text-xs text-brand-muted num">{b.product_code}</p>
                      </td>
                      <td className="text-right num">{b.quantity_received}</td>
                      <td className="text-right num">
                        {b.cost_status === 'PENDING' ? <span className="chip-amber">Pending</span> : money(b.unit_cost)}
                      </td>
                      <td className="text-right num">{b.quantity_sold}</td>
                      <td className="text-xs text-brand-muted">{b.expiry_date ? fmtDate(b.expiry_date) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )
      )}

      {tab === 'payments' && (
        payments.loading ? <LoadingBlock rows={5} /> :
        payments.error ? <ErrorState message={payments.error} onRetry={payments.reload} /> :
        paid.length === 0 ? (
          <Card>
            <EmptyState
              title="No payments in this period"
              description="Payments the shop makes against your balance are listed here with their date and method."
            />
          </Card>
        ) : (
          <>
            <Card padded={false}>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Payment</th>
                      <th>Date</th>
                      <th className="text-right">Amount</th>
                      <th>Method</th>
                      <th>Reference</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paid.map((p) => (
                      <tr key={p.id}>
                        <td className="num text-sm text-brand-ink">{p.payment_number}</td>
                        <td className="text-xs text-brand-muted whitespace-nowrap">{fmtDate(p.payment_date)}</td>
                        <td className="text-right num font-medium">{money(p.amount)}</td>
                        <td className="text-sm text-brand-charcoal">{titleCase(p.payment_method)}</td>
                        <td className="text-xs text-brand-muted">{p.reference || '—'}</td>
                        <td className="text-xs text-brand-muted max-w-[14rem] truncate">{p.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card className="bg-brand-soft border-brand-line">
              <p className="text-xs text-brand-charcoal">
                Payments settle payable lines oldest first. If you believe a payment is missing, quote
                the payment number — every one is recorded against the lines it cleared.
              </p>
            </Card>
          </>
        )
      )}

      <div className="flex justify-end">
        <Button
          variant="secondary"
          onClick={() => {
            orders.reload(); receipts.reload(); payments.reload();
          }}
        >
          Refresh
        </Button>
      </div>
    </div>
  );
}
