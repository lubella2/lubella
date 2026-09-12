import { useMemo, useState } from 'react';
import { fmtDate, fmtDateTime, money, monthLabel, titleCase } from '../../lib/format';
import {
  Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, LoadingBlock, Modal,
  SectionHeader, StatCard, Tabs, Textarea, useToast,
} from '../../components/ui';
import {
  confirmStockCount, generateMonthPeriods, listStockCounts, listStockPeriods,
  openStockCount, submitStockCount,
} from '../../api/inventory';
import { useAsync } from '../../lib/hooks';
import type { StockPeriod } from '../../types';

/**
 * Biweekly stock counts (§28, §29, §53).
 *
 * Two things make this cycle work:
 *   • the count is compared against what the ledger says should be there, and
 *     the difference becomes an ADJUSTMENT — never a silent overwrite;
 *   • confirming a period closes it and opens the next one, whose beginning
 *     stock is this physical count. That is what keeps periods joined up.
 * Adjustments are owner-only and always carry a reason.
 */
export default function OwnerStockCount() {
  const { push } = useToast();
  const [tab, setTab] = useState<'periods' | 'counting'>('periods');
  const [selected, setSelected] = useState<StockPeriod | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);

  const periods = useAsync(() => listStockPeriods(), []);

  const openPeriod = useMemo(
    () => (periods.data ?? []).find((p) => p.status === 'OPEN') ?? null,
    [periods.data],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-ink">Stock counts</h1>
          <p className="text-sm text-brand-muted">
            Count what is on the shelf twice a month. Differences become recorded adjustments.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setGenerateOpen(true)}>Create a month's periods</Button>
      </div>

      <Card className="bg-brand-soft border-brand-line">
        <p className="text-xs text-brand-charcoal leading-relaxed">
          <strong>How the periods join up:</strong> a period runs for half a month. When you confirm
          its count, every difference is written as an adjustment, the period closes, and the next
          period opens with its beginning stock set to what you physically counted. Nothing is
          overwritten — the ledger keeps both the expected figure and the adjustment.
        </p>
      </Card>

      {openPeriod && (
        <Card className="border-brand-rose/40">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs text-brand-muted uppercase tracking-wide">Period open now</p>
              <p className="font-semibold text-brand-ink">{openPeriod.label}</p>
              <p className="text-xs text-brand-muted">
                {fmtDate(openPeriod.period_start)} → {fmtDate(openPeriod.period_end)}
              </p>
            </div>
            <Button onClick={() => { setSelected(openPeriod); setTab('counting'); }}>Count this period</Button>
          </div>
        </Card>
      )}

      <Tabs
        tabs={[
          { id: 'periods', label: 'Periods', count: periods.data?.length },
          { id: 'counting', label: selected ? `Counting ${selected.label}` : 'Counting' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'periods' ? (
        periods.loading ? <LoadingBlock rows={5} /> :
        periods.error ? <ErrorState message={periods.error} onRetry={periods.reload} /> :
        (periods.data?.length ?? 0) === 0 ? (
          <Card>
            <EmptyState
              title="No stock periods yet"
              description="Create this month's two periods to start counting."
              action={<Button onClick={() => setGenerateOpen(true)}>Create periods</Button>}
            />
          </Card>
        ) : (
          <Card padded={false}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Dates</th>
                    <th>Status</th>
                    <th className="text-right">Lines</th>
                    <th>Closed</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {periods.data!.map((p) => (
                    <tr key={p.id}>
                      <td className="font-medium text-brand-ink">{p.label}</td>
                      <td className="text-xs text-brand-muted whitespace-nowrap">
                        {fmtDate(p.period_start)} → {fmtDate(p.period_end)}
                      </td>
                      <td>
                        <span className={p.status === 'OPEN' ? 'chip-green' : 'chip-slate'}>{titleCase(p.status)}</span>
                      </td>
                      <td className="text-right num">
                        {/* Count lines are loaded on demand inside the counting tab. */}
                        —
                      </td>
                      <td className="text-xs text-brand-muted">{p.closed_at ? fmtDateTime(p.closed_at) : '—'}</td>
                      <td className="text-right">
                        <Button
                          size="sm" variant={p.status === 'OPEN' ? 'primary' : 'ghost'}
                          onClick={() => { setSelected(p); setTab('counting'); }}
                        >
                          {p.status === 'OPEN' ? 'Count' : 'Review'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )
      ) : (
        selected ? (
          <CountingPanel
            period={selected}
            onChanged={() => { periods.reload(); }}
            onDone={(msg) => { periods.reload(); setTab('periods'); setSelected(null); push({ tone: 'success', title: msg }); }}
          />
        ) : (
          <Card><EmptyState title="Choose a period" description="Pick a period from the list to start counting." /></Card>
        )
      )}

      <GenerateModal
        open={generateOpen} onClose={() => setGenerateOpen(false)}
        onDone={() => { periods.reload(); push({ tone: 'success', title: 'Periods created' }); }}
      />
    </div>
  );
}

function CountingPanel({
  period, onChanged, onDone,
}: { period: StockPeriod; onChanged: () => void; onDone: (message: string) => void }) {
  const { push } = useToast();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [notes, setNotes] = useState('');

  const lines = useAsync(() => listStockCounts(period.id), [period.id]);

  const rows = lines.data ?? [];

  const enteredCount = Object.values(counts).filter((v) => v !== '').length;

  /** Live variance while typing; the authoritative variance is stored on confirm. */
  const variance = useMemo(() => {
    let units = 0;
    for (const r of rows) {
      const raw = counts[r.id];
      if (raw === undefined || raw === '') continue;
      units += Number(raw) - r.expected_quantity;
    }
    return { units };
  }, [counts, rows]);

  const saveCounts = async () => {
    const payload = Object.entries(counts)
      .filter(([, v]) => v !== '')
      .map(([id, v]) => {
        const line = rows.find((r) => r.id === id);
        return { product_id: line?.product_id ?? id, counted_quantity: Number(v) };
      })
      .filter((l) => l.product_id);
    if (payload.length === 0) {
      push({ tone: 'info', title: 'Nothing entered yet', body: 'Type a counted quantity against at least one product.' });
      return;
    }
    setBusy(true);
    try {
      const res = await submitStockCount(period.id, payload);
      push({
        tone: 'success',
        title: `${res.lines_updated} line${res.lines_updated === 1 ? '' : 's'} saved`,
        body: 'Saved as pending — confirm the period to turn differences into adjustments.',
      });
      setCounts({});
      lines.reload();
      onChanged();
    } catch (err) {
      push({ tone: 'error', title: 'Could not save the counts', body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const res = await confirmStockCount(period.id, notes || undefined);
      onDone(
        res.adjusted_lines > 0
          ? `${res.adjusted_lines} adjustments recorded · ${money(Math.abs(res.variance_value))} variance`
          : 'Count confirmed with no differences',
      );
    } catch (err) {
      push({ tone: 'error', title: 'Could not confirm the count', body: (err as Error).message });
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  };

  const prepare = async () => {
    setBusy(true);
    try {
      const res = await openStockCount(period.id);
      push({
        tone: 'success',
        title: res.lines_created > 0 ? `${res.lines_created} product lines prepared` : 'Lines already prepared',
        body: 'Each line shows what the ledger expects, ready for you to type what you actually count.',
      });
      lines.reload();
    } catch (err) {
      push({ tone: 'error', title: 'Could not open the count', body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <SectionHeader
          title={period.label}
          subtitle={`${fmtDate(period.period_start)} → ${fmtDate(period.period_end)} · ${period.status}`}
        />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Products to count" value={rows.length} />
          <StatCard label="Entered so far" value={enteredCount} tone={enteredCount > 0 ? 'good' : 'default'} />
          <StatCard
            label="Variance (units)"
            value={variance.units > 0 ? `+${variance.units}` : variance.units}
            tone={variance.units === 0 ? 'default' : variance.units < 0 ? 'bad' : 'warn'}
            sub="Against what the ledger expects"
          />
          <StatCard label="Already confirmed" value={rows.filter((r) => r.status === 'CONFIRMED').length} />
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          <Button variant="secondary" onClick={prepare} loading={busy} disabled={lines.loading}>
            Prepare count lines
          </Button>
          <Button onClick={saveCounts} loading={busy} disabled={enteredCount === 0}>Save entered counts</Button>
          <Button
            variant="primary"
            onClick={() => setConfirmOpen(true)}
            disabled={rows.length === 0 || rows.every((r) => r.status === 'CONFIRMED')}
          >
            Confirm &amp; close period
          </Button>
        </div>
      </Card>

      {lines.loading ? <LoadingBlock rows={8} /> :
       lines.error ? <ErrorState message={lines.error} onRetry={lines.reload} /> :
       rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No lines prepared yet"
            description="Prepare the count lines to list every active product with the quantity the ledger expects."
            action={<Button onClick={prepare} loading={busy}>Prepare count lines</Button>}
          />
        </Card>
      ) : (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="text-right">Expected</th>
                  <th className="text-right">Counted</th>
                  <th className="text-right">Variance</th>
                  <th>Status</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const raw = counts[r.id];
                  const live = raw !== undefined && raw !== '' ? Number(raw) - r.expected_quantity : null;
                  const shown = live ?? r.variance;
                  return (
                    <tr key={r.id} className={r.status === 'CONFIRMED' ? 'bg-brand-soft/60' : ''}>
                      <td>
                        <p className="text-brand-ink">{r.product_name}</p>
                        <p className="text-xs text-brand-muted num">{r.product_code}</p>
                      </td>
                      <td className="text-right num">{r.expected_quantity}</td>
                      <td className="text-right">
                        <input
                          type="number" inputMode="numeric"
                          value={raw ?? (r.counted_quantity ?? '')}
                          disabled={r.status === 'CONFIRMED'}
                          onChange={(e) => setCounts({ ...counts, [r.id]: e.target.value })}
                          className="input num w-20 text-center ml-auto"
                          aria-label={`Counted quantity for ${r.product_name}`}
                        />
                      </td>
                      <td className={`text-right num font-medium ${
                        shown === 0 ? 'text-state-green'
                          : shown == null ? 'text-brand-muted'
                          : shown < 0 ? 'text-state-red' : 'text-[#8a6318]'
                      }`}>
                        {shown == null ? '—' : shown > 0 ? `+${shown}` : shown}
                      </td>
                      <td>
                        <span className={r.status === 'CONFIRMED' ? 'chip-slate' : 'chip-amber'}>
                          {titleCase(r.status)}
                        </span>
                      </td>
                      <td className="text-xs text-brand-muted max-w-[12rem] truncate">{r.notes || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Confirm this count and close the period?"
        message={
          <div className="space-y-2">
            <p>
              Every difference between what you counted and what the ledger expects becomes a recorded
              adjustment. The period is then closed and the next one opens with its beginning stock set
              to this physical count.
            </p>
            <p className="text-xs text-brand-muted">
              Nothing is deleted: the expected figure and the adjustment both stay in the ledger, and
              this confirmation is written to the audit log.
            </p>
          </div>
        }
        confirmLabel="Confirm &amp; close"
        busy={busy}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void confirm()}
      />

      <Card>
        <SectionHeader title="Closing note" subtitle="Optional — it is stored with the confirmation." />
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Two lipsticks broken during the week" />
      </Card>
    </div>
  );
}

function GenerateModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await generateMonthPeriods(`${month}-01`);
      onClose(); onDone();
    } catch (err) {
      push({ tone: 'error', title: 'Could not create the periods', body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open} onClose={onClose} title="Create a month's stock periods" size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy}>Create periods</Button>
        </>
      }
    >
      <Field label="Month" hint="Two periods are created: the 1st–15th and the 16th–end of the month.">
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </Field>
      <p className="text-xs text-brand-muted">
        Counting {monthLabel(`${month}-01`)} twice a month keeps a small shop's stock believable: a
        discrepancy is found while it is still fresh enough to explain.
      </p>
    </Modal>
  );
}
