import { useState } from 'react';
import { fmtDate, money, titleCase } from '../../lib/format';
import {
  Button, Card, EmptyState, ErrorState, Field, Input, LoadingBlock, Modal, MoneyInput,
  Select, StatCard, Tabs, Textarea, useToast,
} from '../../components/ui';
import { fetchCommissionReport, recordCommissionPayment } from '../../api/finance';
import { useAsync } from '../../lib/hooks';
import type { CommissionStaffRow, PaymentMethod } from '../../types';

/**
 * Staff commission (§35, §36).
 *
 * 3% of the final, post-discount amount — never of the pre-discount subtotal,
 * and 0% for the owner. A return or a void appends a reversal row rather than
 * editing the original earning, so the history shows what was earned, what was
 * clawed back, and what has actually been paid out.
 */
export default function OwnerCommission() {
  const { push } = useToast();
  const [from, setFrom] = useState(new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [tab, setTab] = useState<'balances' | 'lines'>('balances');
  const [payTarget, setPayTarget] = useState<CommissionStaffRow | null>(null);

  const report = useAsync(() => fetchCommissionReport({ from, to }), [from, to]);

  const staff = report.data?.staff ?? [];
  const owing = staff.filter((s) => Number(s.outstanding) > 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-brand-ink">Commission</h1>
        <p className="text-sm text-brand-muted">
          3% of what the customer actually paid, after any discount. Reversals are appended, never
          edited away.
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
        <StatCard
          label="Earned in period"
          value={money(staff.reduce((s, x) => s + Number(x.earned), 0))}
          tone="good"
        />
        <StatCard
          label="Clawed back"
          value={money(staff.reduce((s, x) => s + Number(x.reversals), 0))}
          sub="Returns and voids"
        />
        <StatCard
          label="Paid to date"
          value={money(staff.reduce((s, x) => s + Number(x.paid), 0))}
        />
        <StatCard
          label="Still owed"
          tone={owing.length ? 'warn' : 'good'}
          value={<>{money(staff.reduce((s, x) => s + Number(x.outstanding), 0))} <span className="text-xs font-normal text-brand-muted">Birr</span></>}
        />
      </div>

      <Tabs
        tabs={[
          { id: 'balances', label: 'Balances', count: staff.length },
          { id: 'lines', label: 'Commission lines', count: report.data?.lines.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {report.loading ? <LoadingBlock rows={5} /> :
       report.error ? <ErrorState message={report.error} onRetry={report.reload} /> : (
        <>
          {tab === 'balances' && (
            staff.length === 0 ? (
              <Card><EmptyState title="No staff accounts" description="Commission applies to staff, not to the owner." /></Card>
            ) : (
              <Card padded={false}>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Staff member</th>
                        <th className="text-right">Rate</th>
                        <th className="text-right">Earned</th>
                        <th className="text-right">Reversals</th>
                        <th className="text-right">Net</th>
                        <th className="text-right">Paid</th>
                        <th className="text-right">Outstanding</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {staff.map((s) => (
                        <tr key={s.staff_id}>
                          <td className="font-medium text-brand-ink">{s.full_name}</td>
                          <td className="text-right num">{(Number(s.commission_rate) * 100).toFixed(0)}%</td>
                          <td className="text-right num text-state-green">{money(s.earned)}</td>
                          <td className="text-right num text-state-red">
                            {Number(s.reversals) > 0 ? `−${money(s.reversals)}` : '—'}
                          </td>
                          <td className="text-right num font-medium">{money(s.net_commission)}</td>
                          <td className="text-right num">{money(s.paid)}</td>
                          <td className={`text-right num font-medium ${Number(s.outstanding) > 0 ? 'text-[#8a6318]' : ''}`}>
                            {money(s.outstanding)}
                          </td>
                          <td className="text-right">
                            <Button
                              size="sm"
                              variant={Number(s.outstanding) > 0 ? 'primary' : 'ghost'}
                              disabled={Number(s.outstanding) <= 0 || Number(s.commission_rate) === 0}
                              onClick={() => setPayTarget(s)}
                            >
                              Pay
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )
          )}

          {tab === 'lines' && (
            (report.data?.lines.length ?? 0) === 0 ? (
              <Card><EmptyState title="No commission activity in this period" /></Card>
            ) : (
              <>
                <Card className="bg-brand-soft border-brand-line">
                  <p className="text-xs text-brand-charcoal">
                    A sale earns commission on the amount after discount. A return or void adds a
                    negative line, so the two always add up to what is genuinely owed.
                  </p>
                </Card>
                <Card padded={false}>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Staff</th>
                          <th>Type</th>
                          <th>Sale</th>
                          <th className="text-right">Sale total</th>
                          <th className="text-right">Discount</th>
                          <th className="text-right">Rate</th>
                          <th className="text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.data!.lines.map((l, i) => (
                          <tr key={`${l.sale_number}-${l.type}-${i}`}>
                            <td className="text-xs text-brand-muted whitespace-nowrap">{fmtDate(l.sale_date)}</td>
                            <td className="text-sm text-brand-charcoal">{l.staff_name || '—'}</td>
                            <td>
                              <span className={l.type === 'EARNED' ? 'chip-green' : 'chip-red'}>
                                {titleCase(l.type)}
                              </span>
                            </td>
                            <td className="num text-sm text-brand-ink">{l.sale_number || '—'}</td>
                            <td className="text-right num">{l.total_amount != null ? money(l.total_amount) : '—'}</td>
                            <td className="text-right num">
                              {l.discount_amount != null && Number(l.discount_amount) > 0
                                ? `−${money(l.discount_amount)}` : '—'}
                            </td>
                            <td className="text-right num">{l.rate != null ? `${(Number(l.rate) * 100).toFixed(0)}%` : '—'}</td>
                            <td className={`text-right num font-medium ${l.type === 'EARNED' ? '' : 'text-state-red'}`}>
                              {l.type === 'EARNED' ? '+' : '−'}{money(l.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </>
            )
          )}
        </>
      )}

      <PayCommissionModal
        target={payTarget} periodStart={from} periodEnd={to}
        onClose={() => setPayTarget(null)}
        onDone={() => { report.reload(); push({ tone: 'success', title: 'Commission payment recorded' }); }}
      />
    </div>
  );
}

function PayCommissionModal({
  target, periodStart, periodEnd, onClose, onDone,
}: {
  target: CommissionStaffRow | null; periodStart: string; periodEnd: string;
  onClose: () => void; onDone: () => void;
}) {
  const { push } = useToast();
  const [amount, setAmount] = useState<number | ''>('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!target || amount === '' || Number(amount) <= 0) {
      push({ tone: 'error', title: 'Enter an amount greater than zero' });
      return;
    }
    setBusy(true);
    try {
      const res = await recordCommissionPayment({
        staffId: target.staff_id, amount: Number(amount),
        periodStart, periodEnd, paymentMethod: method,
        paymentDate: date, reference: reference || null, notes: notes || null,
      });
      push({
        tone: 'success',
        title: `${res.payment_number} recorded`,
        body: res.remaining_due > 0
          ? `${money(res.amount)} paid · ${money(res.remaining_due)} still owed.`
          : 'Commission fully settled for this period.',
      });
      setAmount(''); setReference(''); setNotes('');
      onClose(); onDone();
    } catch (err) {
      push({ tone: 'error', title: 'Could not record the payment', body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(target)} onClose={onClose} title="Pay commission" size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={amount === ''}>Record payment</Button>
        </>
      }
    >
      {target && (
        <div className="space-y-3">
          <div className="rounded-xl bg-brand-soft p-3">
            <p className="text-sm font-medium text-brand-ink">{target.full_name}</p>
            <p className="text-xs text-brand-muted">
              Outstanding: <span className="num">{money(target.outstanding)} Birr</span> · rate{' '}
              {(Number(target.commission_rate) * 100).toFixed(0)}% of post-discount sales
            </p>
          </div>
          <Field label="Amount" required>
            <MoneyInput value={amount} onValueChange={setAmount} />
          </Field>
          <button
            type="button"
            className="text-xs text-brand-deep hover:underline"
            onClick={() => setAmount(Number(target.outstanding))}
          >
            Pay the full outstanding {money(target.outstanding)}
          </button>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Paid by">
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
          <Field label="Reference">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <p className="text-xs text-brand-muted">
            Commission is a cost of the sale that generated it. Paying it settles what was already
            deducted from profit — it is not recorded again as an expense.
          </p>
        </div>
      )}
    </Modal>
  );
}
