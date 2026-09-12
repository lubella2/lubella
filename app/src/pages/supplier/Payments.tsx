import { useMemo, useState } from 'react';
import { fmtDate, money, titleCase } from '../../lib/format';
import {
  Button, Card, EmptyState, ErrorState, Field, Input, LoadingBlock, SectionHeader, StatCard, Tabs,
} from '../../components/ui';
import { fetchSupplierOrders, fetchSupplierPayments, fetchSupplierSummary } from '../../api/supplier';
import { useAsync } from '../../lib/hooks';

/**
 * Payments received.
 *
 * A statement of what the shop has paid against the balance — with the lines
 * each payment cleared, so a supplier can reconcile their own records without
 * asking for a printout.
 */
export default function SupplierPayments() {
  const [tab, setTab] = useState<'payments' | 'settled'>('payments');
  const [from, setFrom] = useState(new Date(Date.now() - 364 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  const payments = useAsync(() => fetchSupplierPayments(), []);
  const orders = useAsync(() => fetchSupplierOrders(), []);
  const summary = useAsync(() => fetchSupplierSummary(), []);

  const inRange = useMemo(
    () => (payments.data ?? []).filter((p) => p.payment_date >= from && p.payment_date <= to),
    [payments.data, from, to],
  );

  const settled = useMemo(
    () => (orders.data ?? []).filter((o) => Number(o.amount_paid) > 0),
    [orders.data],
  );

  const s = summary.data;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-brand-ink">Payments</h1>
        <p className="text-sm text-brand-muted">
          What the shop has paid you, and which lines those payments cleared.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Paid in this period" value={money(inRange.reduce((t, p) => t + Number(p.amount), 0))} tone="good" />
        <StatCard label="Payments recorded" value={inRange.length} />
        <StatCard label="Paid all time" value={money(s?.total_paid ?? 0)} />
        <StatCard
          label="Outstanding"
          value={money(s?.outstanding ?? 0)}
          tone={Number(s?.outstanding ?? 0) > 0 ? 'warn' : 'good'}
        />
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

      <Tabs
        tabs={[
          { id: 'payments', label: 'Payments received', count: inRange.length },
          { id: 'settled', label: 'Lines settled', count: settled.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'payments' ? (
        payments.loading ? <LoadingBlock rows={5} /> :
        payments.error ? <ErrorState message={payments.error} onRetry={payments.reload} /> :
        inRange.length === 0 ? (
          <Card>
            <EmptyState
              title="No payments in this period"
              description="Widen the dates, or check the Payables page for what is still outstanding."
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
                    {inRange.map((p) => (
                      <tr key={p.id}>
                        <td className="num text-sm text-brand-ink">{p.payment_number}</td>
                        <td className="text-xs text-brand-muted whitespace-nowrap">{fmtDate(p.payment_date)}</td>
                        <td className="text-right num font-medium">{money(p.amount)}</td>
                        <td className="text-sm text-brand-charcoal">{titleCase(p.payment_method)}</td>
                        <td className="text-xs text-brand-muted">{p.reference || '—'}</td>
                        <td className="text-xs text-brand-muted max-w-[16rem] truncate">{p.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-brand-soft">
                      <td colSpan={2} className="text-right text-sm font-medium text-brand-charcoal">Total in this period</td>
                      <td className="text-right num font-semibold text-brand-ink">
                        {money(inRange.reduce((t, p) => t + Number(p.amount), 0))}
                      </td>
                      <td colSpan={3} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
            <Card className="bg-brand-soft border-brand-line">
              <p className="text-xs text-brand-charcoal">
                A payment settles the oldest outstanding lines first. Keep the payment number as your
                reference — the shop records which lines each one cleared.
              </p>
            </Card>
          </>
        )
      ) : (
        settled.length === 0 ? (
          <Card><EmptyState title="No lines have been paid yet" description="When a payment clears a line, it appears here with its status." /></Card>
        ) : (
          <Card padded={false}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Product</th>
                    <th>Batch</th>
                    <th className="text-right">Charged</th>
                    <th className="text-right">Paid</th>
                    <th className="text-right">Outstanding</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {settled.map((o) => (
                    <tr key={o.id}>
                      <td className="text-xs text-brand-muted whitespace-nowrap">{fmtDate(o.entry_date)}</td>
                      <td className="text-brand-ink">{o.product_name}</td>
                      <td className="num text-xs text-brand-charcoal">{o.batch_number}</td>
                      <td className="text-right num">{money(o.payable_amount)}</td>
                      <td className="text-right num text-state-green">{money(o.amount_paid)}</td>
                      <td className="text-right num font-medium">{money(o.outstanding)}</td>
                      <td>
                        <span className={o.status === 'PAID' ? 'chip-green' : 'chip-amber'}>
                          {o.status === 'PAID' ? 'Settled' : 'Partly paid'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )
      )}

      <Card>
        <SectionHeader title="Something not matching?" />
        <p className="text-sm text-brand-charcoal">
          Quote the payment number and the batch number from the line in question. Both are on this
          page, and both are recorded against the actual transaction, so the shop can trace it exactly.
        </p>
        <div className="flex flex-wrap gap-2 mt-3">
          <Button
            variant="secondary"
            onClick={() => { payments.reload(); orders.reload(); summary.reload(); }}
          >
            Refresh
          </Button>
        </div>
      </Card>
    </div>
  );
}
