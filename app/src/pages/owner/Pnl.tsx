import { useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { fmtDate, fmtDateTime, money, monthLabel, titleCase } from '../../lib/format';
import {
  Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, LoadingBlock, Modal,
  SectionHeader, StatCard, Tabs, Textarea, useToast,
} from '../../components/ui';
import { closeMonth, fetchPnl, listPeriodCloses, reopenMonth } from '../../api/finance';
import { useAsync } from '../../lib/hooks';

/**
 * Profit & loss, and the monthly close (§39, §40, §41).
 *
 * The chain is fixed and shown to the owner rather than hidden in a tooltip:
 *   Net Sales      = Sales − Discounts − Returns
 *   Gross Profit   = Net Sales − COGS
 *   Net Profit     = Gross Profit − Operating Expenses − Staff Commission
 *   Tithe Due      = 10% of Net Profit, and nothing at all when that is negative
 *
 * Supplier payments appear on this page only as an explicit, labelled figure
 * outside the profit calculation, because paying a supplier settles stock that
 * was already counted in COGS. Treating it as an expense would double-count it.
 */
export default function OwnerPnl() {
  const { push } = useToast();
  const [tab, setTab] = useState<'months' | 'closes'>('months');
  const [range, setRange] = useState<'6' | '12' | '24'>('6');
  const [closeTarget, setCloseTarget] = useState<string | null>(null);
  const [reopenTarget, setReopenTarget] = useState<{ month: string; net: number } | null>(null);

  const from = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - (Number(range) - 1));
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  }, [range]);
  const to = new Date().toISOString().slice(0, 10);

  const pnl = useAsync(() => fetchPnl(from, to), [from, to]);
  const closes = useAsync(() => listPeriodCloses(), []);

  const months = pnl.data?.months ?? [];
  const current = months[0];

  const chartData = useMemo(
    () => [...months].reverse().map((m) => ({
      month: monthLabel(m.period_month).replace(/\s\d{4}$/, ''),
      net_sales: Number(m.net_sales),
      gross_profit: Number(m.gross_profit),
      net_profit: Number(m.net_profit),
    })),
    [months],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-ink">Profit &amp; loss</h1>
          <p className="text-sm text-brand-muted">
            Built entirely from recorded sales, returns, expenses and commission.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => current && setCloseTarget(current.period_month)}
            disabled={!current}
          >
            Close a month
          </Button>
        </div>
      </div>

      <Card>
        <div className="max-w-xs">
          <Field label="Period">
            <select className="input" value={range} onChange={(e) => setRange(e.target.value as '6' | '12' | '24')}>
              <option value="6">Last 6 months</option>
              <option value="12">Last 12 months</option>
              <option value="24">Last 24 months</option>
            </select>
          </Field>
        </div>
      </Card>

      {pnl.loading ? <LoadingBlock rows={5} /> :
       pnl.error ? <ErrorState message={pnl.error} onRetry={pnl.reload} /> :
       months.length === 0 ? (
        <Card><EmptyState title="Nothing to report yet" description="Once sales are recorded, the P&L builds itself." /></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="This month net sales" value={money(current?.net_sales ?? 0)} tone="brand" />
            <StatCard label="Gross profit" value={money(current?.gross_profit ?? 0)} tone="good" />
            <StatCard
              label="Net profit"
              tone={(current?.net_profit ?? 0) >= 0 ? 'good' : 'bad'}
              value={<>{money(current?.net_profit ?? 0)} <span className="text-xs font-normal text-brand-muted">Birr</span></>}
              sub={current ? `After ${money(current.operating_expenses)} expenses + ${money(current.staff_commission)} commission` : undefined}
            />
            <StatCard
              label="Tithe due"
              value={money(current?.tithe_due_10pct ?? 0)}
              sub={(current?.net_profit ?? 0) > 0 ? '10% of net profit' : 'No tithe on a loss'}
            />
          </div>

          <Card>
            <SectionHeader title="Net sales, gross profit and net profit" subtitle={`Last ${months.length} months`} />
            <div className="h-64 -ml-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
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
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceLine y={0} stroke="#8A8489" />
                  <Bar dataKey="net_sales" name="Net sales" fill="#D1809A" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="gross_profit" name="Gross profit" fill="#B96482" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="net_profit" name="Net profit" radius={[4, 4, 0, 0]}>
                    {chartData.map((d) => (
                      <Cell key={d.month} fill={d.net_profit >= 0 ? '#3F9D6D' : '#C8433F'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Tabs
            tabs={[
              { id: 'months', label: 'Month by month', count: months.length },
              { id: 'closes', label: 'Month closes', count: closes.data?.length },
            ]}
            active={tab}
            onChange={setTab}
          />

          {tab === 'months' ? (
            <>
              <Card padded={false}>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th className="text-right">Sales</th>
                        <th className="text-right">Discounts</th>
                        <th className="text-right">Returns</th>
                        <th className="text-right">Net sales</th>
                        <th className="text-right">COGS</th>
                        <th className="text-right">Gross profit</th>
                        <th className="text-right">Expenses</th>
                        <th className="text-right">Commission</th>
                        <th className="text-right">Net profit</th>
                        <th className="text-right">Tithe due</th>
                      </tr>
                    </thead>
                    <tbody>
                      {months.map((m) => (
                        <tr key={m.period_month}>
                          <td className="font-medium text-brand-ink whitespace-nowrap">{monthLabel(m.period_month)}</td>
                          <td className="text-right num">{money(m.gross_sales)}</td>
                          <td className="text-right num">{Number(m.discounts) > 0 ? `−${money(m.discounts)}` : '—'}</td>
                          <td className="text-right num">{Number(m.returns) > 0 ? `−${money(m.returns)}` : '—'}</td>
                          <td className="text-right num font-medium">{money(m.net_sales)}</td>
                          <td className="text-right num">{money(m.cogs)}</td>
                          <td className="text-right num">{money(m.gross_profit)}</td>
                          <td className="text-right num">{Number(m.operating_expenses) > 0 ? `−${money(m.operating_expenses)}` : '—'}</td>
                          <td className="text-right num">{Number(m.staff_commission) > 0 ? `−${money(m.staff_commission)}` : '—'}</td>
                          <td className={`text-right num font-semibold ${Number(m.net_profit) < 0 ? 'text-state-red' : 'text-state-green'}`}>
                            {money(m.net_profit)}
                          </td>
                          <td className="text-right num">{money(m.tithe_due_10pct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <div className="grid lg:grid-cols-2 gap-4">
                <Card>
                  <SectionHeader title="How these numbers are made" />
                  <dl className="space-y-2 text-sm">
                    {Object.entries(pnl.data?.formula ?? {}).map(([k, v]) => (
                      <div key={k} className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-3">
                        <dt className="font-medium text-brand-ink sm:w-36 shrink-0">{titleCase(k)}</dt>
                        <dd className="text-brand-charcoal num">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </Card>

                <Card className="bg-brand-soft border-brand-line">
                  <SectionHeader title="Supplier payments are not in here" />
                  <p className="text-sm text-brand-charcoal">
                    Paid to suppliers in this period:{' '}
                    <strong className="num">{money(pnl.data?.supplier_payments_in_period ?? 0)} Birr</strong>.
                  </p>
                  <p className="text-xs text-brand-muted mt-2">{pnl.data?.supplier_payments_note}</p>
                </Card>
              </div>
            </>
          ) : (
            <ClosesTab
              closes={closes.data ?? []}
              loading={closes.loading}
              error={closes.error}
              onReload={closes.reload}
              onClose={(month) => setCloseTarget(month)}
              onReopen={(month, net) => setReopenTarget({ month, net })}
            />
          )}
        </>
      )}

      <CloseMonthDialog
        month={closeTarget} onClose={() => setCloseTarget(null)}
        onDone={() => { closes.reload(); pnl.reload(); push({ tone: 'success', title: 'Month closed' }); }}
      />

      <ReopenMonthDialog
        target={reopenTarget} onClose={() => setReopenTarget(null)}
        onDone={() => { closes.reload(); pnl.reload(); push({ tone: 'info', title: 'Month reopened', body: 'Corrections are possible again and the reopening is in the audit log.' }); }}
      />
    </div>
  );
}

function ClosesTab({
  closes, loading, error, onReload, onClose, onReopen,
}: {
  closes: Array<{
    id: string; period_month: string; status: string; net_sales: number; cogs: number;
    gross_profit: number; expenses: number; commission: number; net_profit: number;
    closed_at: string | null; notes: string | null;
  }>;
  loading: boolean; error: string | null; onReload: () => void;
  onClose: (month: string) => void; onReopen: (month: string, net: number) => void;
}) {
  const [pick, setPick] = useState(new Date().toISOString().slice(0, 7));

  return (
    <div className="space-y-4">
      <Card className="bg-brand-soft border-brand-line">
        <p className="text-xs text-brand-charcoal">
          Closing a month freezes its figures and records them here. Stock after a close only moves
          through audited adjustments — reopening is possible, but it is logged, so a closed month is
          never quietly edited.
        </p>
      </Card>

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-56">
            <Field label="Close a month" hint="The month's figures are saved as they stand now.">
              <Input type="month" value={pick} onChange={(e) => setPick(e.target.value)} />
            </Field>
          </div>
          <div className="mb-3.5">
            <Button onClick={() => onClose(`${pick}-01`)} disabled={!pick}>Close</Button>
          </div>
        </div>
      </Card>

      {loading ? <LoadingBlock rows={4} /> :
       error ? <ErrorState message={error} onRetry={onReload} /> :
       closes.length === 0 ? (
        <Card><EmptyState title="No months closed yet" description="Closing a month is how you freeze a period." /></Card>
      ) : (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Status</th>
                  <th className="text-right">Net sales</th>
                  <th className="text-right">COGS</th>
                  <th className="text-right">Gross profit</th>
                  <th className="text-right">Expenses</th>
                  <th className="text-right">Commission</th>
                  <th className="text-right">Net profit</th>
                  <th>Closed</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {closes.map((c) => (
                  <tr key={c.id}>
                    <td className="font-medium text-brand-ink whitespace-nowrap">{monthLabel(c.period_month)}</td>
                    <td><span className={c.status === 'CLOSED' ? 'chip-slate' : 'chip-green'}>{titleCase(c.status)}</span></td>
                    <td className="text-right num">{money(c.net_sales)}</td>
                    <td className="text-right num">{money(c.cogs)}</td>
                    <td className="text-right num">{money(c.gross_profit)}</td>
                    <td className="text-right num">{money(c.expenses)}</td>
                    <td className="text-right num">{money(c.commission)}</td>
                    <td className="text-right num font-medium">{money(c.net_profit)}</td>
                    <td className="text-xs text-brand-muted">{c.closed_at ? fmtDateTime(c.closed_at) : '—'}</td>
                    <td className="text-right">
                      {c.status === 'CLOSED' && (
                        <Button size="sm" variant="ghost" onClick={() => onReopen(c.period_month, Number(c.net_profit))}>
                          Reopen
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <p className="text-xs text-brand-muted">
        Last checked: {fmtDate(new Date())} · figures above are the ones locked in at close time, and are
        never recalculated from later activity.
      </p>
    </div>
  );
}

function CloseMonthDialog({
  month, onClose, onDone,
}: { month: string | null; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!month) return;
    setBusy(true);
    try {
      await closeMonth(month, notes || undefined);
      setNotes('');
      onClose(); onDone();
    } catch (err) {
      push({ tone: 'error', title: 'Could not close the month', body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(month)} onClose={onClose} title="Close this month" size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy}>Close month</Button>
        </>
      }
    >
      {month && (
        <div className="space-y-3">
          <p className="text-sm text-brand-charcoal">
            Closing <strong>{monthLabel(month)}</strong> saves its profit-and-loss figures as they
            stand now.
          </p>
          <Field label="Notes" hint="Anything worth remembering about this month.">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <p className="text-xs text-brand-muted">
            After a close, stock changes in that month need a recorded adjustment, which keeps the
            books honest.
          </p>
        </div>
      )}
    </Modal>
  );
}

function ReopenMonthDialog({
  target, onClose, onDone,
}: { target: { month: string; net: number } | null; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const [busy, setBusy] = useState(false);

  const submit = async (reason: string) => {
    setBusy(true);
    try {
      await reopenMonth(target!.month, reason);
      onClose(); onDone();
    } catch (err) {
      push({ tone: 'error', title: 'Could not reopen the month', body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      open={Boolean(target)}
      title="Reopen this month?"
      message={
        <p>
          {target ? monthLabel(target.month) : ''} becomes editable again so a mistake can be
          corrected. The reopening is written to the audit log with your reason.
        </p>
      }
      confirmLabel="Reopen"
      requireReason
      reasonLabel="Why are you reopening it?"
      busy={busy}
      onClose={onClose}
      onConfirm={(reason) => void submit(reason)}
    />
  );
}
