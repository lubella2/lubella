import { useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { fmtDate, money, monthLabel, titleCase } from '../../lib/format';
import {
  Button, Card, EmptyState, ErrorState, Field, Input, LoadingBlock, Modal,
  SectionHeader, Select, StatCard, Textarea, useToast,
} from '../../components/ui';
import { computeTithe, fetchTitheReport, recordTithePayment } from '../../api/finance';
import { useAsync } from '../../lib/hooks';
import type { PaymentMethod, TitheRow } from '../../types';

/**
 * Tithe (§41).
 *
 * Three rules the database enforces and this screen only reflects:
 *   • it is 10% of NET PROFIT — after COGS, operating expenses and commission;
 *   • a loss produces no tithe at all, never a negative one;
 *   • it is NOT an operating expense. Deducting it from profit before computing
 *     it would let the tithe shrink the very base it is charged on, so it is
 *     recorded separately from the expense ledger and shares nothing with it.
 */
export default function OwnerTithe() {
  const { push } = useToast();
  const [year, setYear] = useState(new Date().getFullYear());
  const [payTarget, setPayTarget] = useState<TitheRow | null>(null);

  const report = useAsync(() => fetchTitheReport(year), [year]);
  const months = report.data?.months ?? [];

  const totals = useMemo(() => {
    const due = months.reduce((s, m) => s + Number(m.tithe_amount), 0);
    const paid = months.filter((m) => m.status === 'PAID').reduce((s, m) => s + Number(m.tithe_amount), 0);
    const profit = months.reduce((s, m) => s + Number(m.net_profit), 0);
    return { due, paid, outstanding: due - paid, profit };
  }, [months]);

  const chart = useMemo(
    () => [...months].reverse().map((m) => ({
      month: monthLabel(m.period_month).replace(/\s\d{4}$/, ''),
      net_profit: Number(m.net_profit),
      tithe: Number(m.tithe_amount),
    })),
    [months],
  );

  const unpaid = months.filter((m) => m.status !== 'PAID' && Number(m.tithe_amount) > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-ink">Tithe</h1>
          <p className="text-sm text-brand-muted">
            10% of net profit, month by month. Loss months owe nothing.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setYear((y) => y - 1)}>← {year - 1}</Button>
          <span className="text-sm font-medium num text-brand-ink">{year}</span>
          <Button
            variant="secondary" size="sm"
            onClick={() => setYear((y) => y + 1)}
            disabled={year >= new Date().getFullYear()}
          >
            {year + 1} →
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Net profit (year)" value={money(totals.profit)} tone={totals.profit >= 0 ? 'good' : 'bad'} />
        <StatCard label="Tithe for the year" value={<>{money(totals.due)} <span className="text-xs font-normal text-brand-muted">Birr</span></>} tone="brand" />
        <StatCard label="Paid" value={money(totals.paid)} tone="good" />
        <StatCard
          label="Still due"
          value={money(totals.outstanding)}
          tone={totals.outstanding > 0 ? 'warn' : 'good'}
        />
      </div>

      <Card className="bg-brand-soft border-brand-line">
        <p className="text-xs text-brand-charcoal leading-relaxed">
          <strong>Tithe is not an expense.</strong> It is a distribution of profit, so it is kept out of
          the expense ledger entirely — otherwise it would reduce net profit, which would reduce the
          tithe, which is circular. Paying it here leaves the P&amp;L unchanged.
        </p>
      </Card>

      {unpaid.length > 0 && (
        <Card className="border-state-amber/40 bg-state-amber/5">
          <div className="flex items-start gap-3">
            <span className="text-xl" aria-hidden="true">🤲</span>
            <div className="flex-1">
              <p className="font-medium text-brand-ink">
                {unpaid.length} month{unpaid.length === 1 ? '' : 's'} with tithe outstanding
              </p>
              <p className="text-sm text-brand-muted mt-0.5">
                Total due: <span className="num">{money(unpaid.reduce((s, m) => s + Number(m.tithe_amount), 0))} Birr</span>
              </p>
              <Button size="sm" className="mt-2" onClick={() => setPayTarget(unpaid[0])}>Record a tithe payment</Button>
            </div>
          </div>
        </Card>
      )}

      {report.loading ? <LoadingBlock rows={6} /> :
       report.error ? <ErrorState message={report.error} onRetry={report.reload} /> :
       months.length === 0 ? (
        <Card><EmptyState title={`No months in ${year}`} description="Tithe follows recorded profit, so it appears once the shop has traded." /></Card>
      ) : (
        <>
          <Card>
            <SectionHeader title="Profit and tithe by month" subtitle="A month in the red adds no tithe." />
            <div className="h-60 -ml-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EFE1E8" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#8A8489' }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#8A8489' }} axisLine={false} tickLine={false}
                    tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                  />
                  <Tooltip
                    formatter={(value: number) => money(value)}
                    contentStyle={{ borderRadius: 12, border: '1px solid #EFE1E8', fontSize: 12 }}
                  />
                  <ReferenceLine y={0} stroke="#8A8489" />
                  <Bar dataKey="net_profit" name="Net profit" fill="#B96482" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="tithe" name="Tithe" fill="#3F9D6D" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card padded={false}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="text-right">Net profit</th>
                    <th className="text-right">Rate</th>
                    <th className="text-right">Tithe</th>
                    <th>Status</th>
                    <th>Paid</th>
                    <th>Reference</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {months.map((m) => (
                    <tr key={m.period_month}>
                      <td className="font-medium text-brand-ink whitespace-nowrap">{monthLabel(m.period_month)}</td>
                      <td className={`text-right num ${Number(m.net_profit) < 0 ? 'text-state-red' : ''}`}>
                        {money(m.net_profit)}
                      </td>
                      <td className="text-right num">{(Number(m.tithe_rate) * 100).toFixed(0)}%</td>
                      <td className="text-right num font-medium">{money(m.tithe_amount)}</td>
                      <td>
                        <span className={
                          m.status === 'PAID' ? 'chip-green'
                            : m.status === 'CANCELLED' ? 'chip-slate' : 'chip-amber'
                        }>
                          {titleCase(m.status)}
                        </span>
                      </td>
                      <td className="text-xs text-brand-muted">
                        {m.paid_date ? `${fmtDate(m.paid_date)}${m.payment_method ? ` · ${titleCase(m.payment_method)}` : ''}` : '—'}
                      </td>
                      <td className="text-xs text-brand-muted">{m.reference || '—'}</td>
                      <td className="text-right">
                        <Button
                          size="sm"
                          variant={m.status === 'PAID' ? 'ghost' : 'primary'}
                          disabled={Number(m.tithe_amount) <= 0}
                          onClick={() => setPayTarget(m)}
                        >
                          {m.status === 'PAID' ? 'Update' : 'Mark paid'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <Card>
        <SectionHeader title="Check a month's calculation" subtitle="Re-derives the tithe from that month's profit, straight from the records." />
        <TitheCheck onDone={() => { report.reload(); push({ tone: 'info', title: 'Checked against the records' }); }} />
      </Card>

      <PayTitheModal
        target={payTarget} onClose={() => setPayTarget(null)}
        onDone={() => { report.reload(); push({ tone: 'success', title: 'Tithe payment recorded' }); }}
      />
    </div>
  );
}

function TitheCheck({ onDone }: { onDone: () => void }) {
  const { push } = useToast();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [run, setRun] = useState(0);

  /**
   * Deliberately not fired on mount: checking a month also refreshes the stored
   * tithe row and writes an audit entry, so it happens when the owner asks for
   * it rather than as a side effect of opening the page.
   */
  const check = useAsync(
    () => computeTithe(`${month}-01`),
    [month, run],
    { enabled: run > 0 },
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-56">
          <Field label="Month" hint="Re-derives the tithe from that month's profit.">
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </Field>
        </div>
        <div className="mb-3.5">
          <Button
            variant="secondary"
            onClick={() => { setRun((r) => r + 1); push({ tone: 'info', title: 'Recomputing from the records' }); }}
            loading={check.loading}
          >
            Check now
          </Button>
        </div>
      </div>

      {run === 0 ? (
        <p className="text-sm text-brand-muted">
          Choose a month and check it to see the derivation: net profit × rate, or zero when the month
          made a loss.
        </p>
      ) : check.loading ? <LoadingBlock rows={2} /> :
       check.error ? <ErrorState message={check.error} onRetry={check.reload} /> :
       check.data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Net profit" value={money(check.data.net_profit)} tone={Number(check.data.net_profit) >= 0 ? 'good' : 'bad'} />
            <StatCard label="Rate" value={`${(Number(check.data.tithe_rate) * 100).toFixed(0)}%`} />
            <StatCard label="Tithe" value={money(check.data.tithe_amount)} />
            <StatCard label="Status" value={titleCase(check.data.status)} />
          </div>
          {check.data.message && <p className="text-sm text-brand-muted">{check.data.message}</p>}
          <Button size="sm" variant="secondary" onClick={onDone}>Refresh the table above</Button>
        </>
      )}
    </div>
  );
}

function PayTitheModal({
  target, onClose, onDone,
}: { target: TitheRow | null; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const [method, setMethod] = useState<PaymentMethod>('BANK');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const res = await recordTithePayment({
        periodMonth: target.period_month, paymentMethod: method,
        paidDate: date, reference: reference || null, notes: notes || null,
      });
      push({
        tone: 'success',
        title: `${money(res.amount)} recorded as paid`,
        body: res.note,
      });
      setReference(''); setNotes('');
      onClose(); onDone();
    } catch (err) {
      push({ tone: 'error', title: 'Could not record the tithe payment', body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(target)} onClose={onClose} title="Record a tithe payment" size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy}>Record payment</Button>
        </>
      }
    >
      {target && (
        <div className="space-y-3">
          <div className="rounded-xl bg-brand-soft p-3">
            <p className="text-sm font-medium text-brand-ink">{monthLabel(target.period_month)}</p>
            <p className="text-xs text-brand-muted">
              Net profit <span className="num">{money(target.net_profit)}</span> · tithe{' '}
              <span className="num">{money(target.tithe_amount)}</span>
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Paid from">
              <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                <option value="CASH">Cash</option>
                <option value="BANK">Bank</option>
                <option value="TELEBIRR">Telebirr</option>
              </Select>
            </Field>
            <Field label="Date">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Reference" hint="Receipt or transfer reference.">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <p className="text-xs text-brand-muted">
            This does not change the P&amp;L and it does not appear in Expenses. It only records that
            the tithe was paid.
          </p>
        </div>
      )}
    </Modal>
  );
}
