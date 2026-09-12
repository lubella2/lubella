import { useState } from 'react';
import { fmtDate, money, titleCase } from '../../lib/format';
import {
  Card, EmptyState, ErrorState, Field, Input, LoadingBlock, SectionHeader, StatCard, Tabs,
} from '../../components/ui';
import { fetchMyCommission } from '../../api/finance';
import { useAsync } from '../../lib/hooks';
import { useAuth } from '../../lib/auth';

/**
 * A staff member's own commission (§36, §55).
 *
 * The arithmetic is the shop's: 3% of each sale's final, post-discount amount,
 * with returns and voids showing as separate reversal lines. Nothing here can be
 * edited from the staff side — it is a statement, not a form.
 */
export default function StaffMyCommission() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<'summary' | 'lines' | 'payments'>('summary');
  const [from, setFrom] = useState(new Date(Date.now() - 89 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  const commission = useAsync(() => fetchMyCommission({ from, to }), [from, to]);

  const data = commission.data;
  const rate = profile?.commission_rate ?? 0.03;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-brand-ink">My commission</h1>
        <p className="text-sm text-brand-muted">
          {(rate * 100).toFixed(0)}% of each sale you ring up, calculated on the amount the customer
          actually paid — after any discount.
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

      {commission.loading ? <LoadingBlock rows={5} /> :
       commission.error ? <ErrorState message={commission.error} onRetry={commission.reload} /> :
       !data ? <EmptyState title="Nothing to show" /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Earned" value={<>{money(data.totals.earned)} <span className="text-xs font-normal text-brand-muted">Birr</span></>} tone="good" />
            <StatCard
              label="Reversed"
              value={money(data.totals.reversed)}
              tone={Number(data.totals.reversed) > 0 ? 'warn' : 'default'}
              sub="From returns and voids"
            />
            <StatCard label="Net commission" value={money(data.totals.net)} tone="brand" />
            <StatCard
              label="Outstanding"
              value={money(data.outstanding)}
              tone={Number(data.outstanding) > 0 ? 'warn' : 'good'}
              sub={`${money(data.payments.paid)} paid to date`}
            />
          </div>

          <Tabs
            tabs={[
              { id: 'summary', label: 'Summary' },
              { id: 'lines', label: 'How it was earned', count: data.items.length },
              { id: 'payments', label: 'Payments', count: data.payments.entries.length },
            ]}
            active={tab}
            onChange={setTab}
          />

          {tab === 'summary' && (
            <Card>
              <SectionHeader title="This period" subtitle={`${fmtDate(from)} → ${fmtDate(to)}`} />
              <dl className="space-y-2 text-sm max-w-md">
                <div className="flex justify-between">
                  <dt className="text-brand-muted">Commission earned</dt>
                  <dd className="num text-brand-ink">{money(data.totals.earned)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-brand-muted">Reversed on returns and voids</dt>
                  <dd className="num text-state-red">
                    {Number(data.totals.reversed) > 0 ? `−${money(data.totals.reversed)}` : money(0)}
                  </dd>
                </div>
                <div className="flex justify-between border-t border-brand-line pt-2">
                  <dt className="font-medium text-brand-ink">Net commission</dt>
                  <dd className="num font-semibold text-brand-ink">{money(data.totals.net)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-brand-muted">Already paid</dt>
                  <dd className="num text-brand-ink">{money(data.payments.paid)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="font-medium text-brand-ink">Still owed to you</dt>
                  <dd className="num font-semibold text-state-green">{money(data.outstanding)}</dd>
                </div>
              </dl>
              <p className="text-xs text-brand-muted mt-4">
                A discount reduces the commission on that sale, because the {(rate * 100).toFixed(0)}% is
                charged on the final amount the customer paid — after the discount, not before. A return
                or a void takes back the commission that was earned on the units involved, which is why
                the reversal lines appear separately rather than editing the original.
              </p>
            </Card>
          )}

          {tab === 'lines' && (
            data.items.length === 0 ? (
              <Card><EmptyState title="No commission activity in this period" /></Card>
            ) : (
              <Card padded={false}>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Sale</th>
                        <th>Type</th>
                        <th className="text-right">Rate</th>
                        <th className="text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((l, i) => (
                        <tr key={`${l.sale_number}-${l.type}-${i}`}>
                          <td className="text-xs text-brand-muted whitespace-nowrap">{fmtDate(l.sale_date)}</td>
                          <td className="num text-sm text-brand-charcoal">
                            {l.sale_number || l.return_number || '—'}
                          </td>
                          <td>
                            <span className={l.type === 'EARNED' ? 'chip-green' : 'chip-red'}>
                              {titleCase(l.type)}
                            </span>
                            {l.note && <p className="text-xs text-brand-muted mt-0.5">{l.note}</p>}
                          </td>
                          <td className="text-right num">{(Number(l.rate) * 100).toFixed(0)}%</td>
                          <td className={`text-right num font-medium ${l.type === 'EARNED' ? 'text-state-green' : 'text-state-red'}`}>
                            {l.type === 'EARNED' ? '+' : '−'}{money(l.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-brand-soft">
                        <td colSpan={4} className="text-right text-sm font-medium text-brand-charcoal">Net for this period</td>
                        <td className="text-right num font-semibold text-brand-ink">{money(data.totals.net)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </Card>
            )
          )}

          {tab === 'payments' && (
            data.payments.entries.length === 0 ? (
              <Card>
                <EmptyState
                  title="No commission payments yet"
                  description="When the owner pays your commission, the payment appears here with its date and method."
                />
              </Card>
            ) : (
              <Card padded={false}>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Payment</th>
                        <th>Date</th>
                        <th className="text-right">Amount</th>
                        <th>Period covered</th>
                        <th>Reference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.payments.entries.map((p) => (
                        <tr key={p.payment_number}>
                          <td className="num text-sm text-brand-ink">{p.payment_number}</td>
                          <td className="text-xs text-brand-muted">{fmtDate(p.payment_date)}</td>
                          <td className="text-right num font-medium">{money(p.amount)}</td>
                          <td className="text-xs text-brand-muted">
                            {p.period_start && p.period_end
                              ? `${fmtDate(p.period_start)} → ${fmtDate(p.period_end)}`
                              : '—'}
                          </td>
                          <td className="text-xs text-brand-muted">{p.reference || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )
          )}
        </>
      )}
    </div>
  );
}
