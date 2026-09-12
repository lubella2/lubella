import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtDate, money, titleCase } from '../../lib/format';
import {
  Button, Card, EmptyState, ErrorState, FilterChips, LoadingBlock, SectionHeader, StatCard,
} from '../../components/ui';
import { fetchSupplierOrders, fetchSupplierSummary } from '../../api/supplier';
import { useAsync } from '../../lib/hooks';

type Status = 'UNPAID' | 'PARTIAL' | 'PAID';

/**
 * Payables.
 *
 * What the shop owes, line by line. Two rules are visible in the data itself:
 * the charge is the agreed purchase cost of units that sold (not the quantity
 * delivered, and not the shop's selling price), and a customer refund reverses
 * the charge for those units rather than deleting the line.
 */
export default function SupplierPayables() {
  const [status, setStatus] = useState<Status | null>(null);

  const summary = useAsync(() => fetchSupplierSummary(), []);
  const orders = useAsync(() => fetchSupplierOrders(), []);

  const rows = useMemo(() => {
    const list = orders.data ?? [];
    const filtered = status ? list.filter((o) => o.status === status) : list;
    // Unpaid first, then most recent — what a supplier actually wants to see.
    return [...filtered].sort((a, b) => {
      const weight = (s: Status) => (s === 'UNPAID' ? 0 : s === 'PARTIAL' ? 1 : 2);
      const diff = weight(a.status) - weight(b.status);
      return diff !== 0 ? diff : b.entry_date.localeCompare(a.entry_date);
    });
  }, [orders.data, status]);

  const s = summary.data;
  const open = (orders.data ?? []).filter((o) => Number(o.outstanding) > 0);
  const oldestOpen = [...open].sort((a, b) => a.entry_date.localeCompare(b.entry_date))[0];

  const ageDays = oldestOpen
    ? Math.floor((Date.now() - new Date(oldestOpen.entry_date).getTime()) / 86_400_000)
    : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-ink">Payables</h1>
          <p className="text-sm text-brand-muted">
            Charged at the agreed purchase cost for the units that actually sold.
          </p>
        </div>
        <Link to="/supplier/statements"><Button variant="secondary">Monthly statements</Button></Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total charged" value={money(s?.total_payable ?? 0)} />
        <StatCard label="Paid" value={money(s?.total_paid ?? 0)} tone="good" />
        <StatCard
          label="Outstanding"
          value={<>{money(s?.outstanding ?? 0)} <span className="text-xs font-normal text-brand-muted">Birr</span></>}
          tone={Number(s?.outstanding ?? 0) > 0 ? 'warn' : 'good'}
        />
        <StatCard
          label="Open lines"
          value={open.length}
          sub={oldestOpen ? `Oldest ${ageDays} day${ageDays === 1 ? '' : 's'} old` : 'Nothing outstanding'}
          tone={open.length > 0 && ageDays > 30 ? 'bad' : 'default'}
        />
      </div>

      {oldestOpen && ageDays > 30 && (
        <Card className="border-state-amber/40 bg-state-amber/5">
          <p className="text-sm text-brand-charcoal">
            <strong>{money(oldestOpen.outstanding)} Birr</strong> has been outstanding for more than a
            month, from the units sold on {fmtDate(oldestOpen.entry_date)}. Quote payment line{' '}
            <span className="num">{oldestOpen.batch_number}</span> if you raise it with the shop.
          </p>
        </Card>
      )}

      <Card>
        <SectionHeader title="Filter" subtitle="See everything, or just what is still open." />
        <FilterChips
          allLabel="All lines" value={status} onChange={setStatus}
          options={[
            { value: 'UNPAID', label: 'Unpaid' },
            { value: 'PARTIAL', label: 'Partly paid' },
            { value: 'PAID', label: 'Paid' },
          ]}
        />
      </Card>

      {orders.loading ? <LoadingBlock rows={6} /> :
       orders.error ? <ErrorState message={orders.error} onRetry={orders.reload} /> :
       rows.length === 0 ? (
        <Card>
          <EmptyState
            title={status ? `No ${titleCase(status).toLowerCase()} lines` : 'Nothing charged yet'}
            description={
              status
                ? 'Try a different filter to see the rest of the account.'
                : 'A payable appears only when a unit from one of your batches sells. Delivered stock that is still on the shelf is not charged.'
            }
          />
        </Card>
      ) : (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Product</th>
                  <th>Batch</th>
                  <th className="text-right">Units sold</th>
                  <th className="text-right">Unit cost</th>
                  <th className="text-right">Charged</th>
                  <th className="text-right">Paid</th>
                  <th className="text-right">Outstanding</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
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
                    </td>
                    <td className="text-right num text-state-green">{money(o.amount_paid)}</td>
                    <td className="text-right num font-medium">{money(o.outstanding)}</td>
                    <td>
                      <span className={
                        o.status === 'PAID' ? 'chip-green' : o.status === 'PARTIAL' ? 'chip-amber' : 'chip-red'
                      }>
                        {o.status === 'PAID' ? 'Paid' : o.status === 'PARTIAL' ? 'Partly paid' : 'Unpaid'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-brand-soft">
                  <td colSpan={5} className="text-right text-sm font-medium text-brand-charcoal">Totals for the lines shown</td>
                  <td className="text-right num font-semibold">{money(rows.reduce((t, o) => t + Number(o.payable_amount), 0))}</td>
                  <td className="text-right num font-semibold text-state-green">{money(rows.reduce((t, o) => t + Number(o.amount_paid), 0))}</td>
                  <td className="text-right num font-semibold">{money(rows.reduce((t, o) => t + Number(o.outstanding), 0))}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <SectionHeader title="Why the charge is what it is" />
        <ul className="text-sm text-brand-charcoal space-y-1.5 list-disc pl-5">
          <li>Charged per unit sold, at the agreed purchase cost — never at the shop's selling price.</li>
          <li>Delivered stock that has not sold is not charged; it is still on the shelf.</li>
          <li>Each batch is sold oldest first, so a charge follows the batch the unit came out of.</li>
          <li>If the shop refunds a customer, the charge for those units is reversed on the same account.</li>
        </ul>
      </Card>
    </div>
  );
}
