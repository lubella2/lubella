import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtDate, fmtDateTime, money, titleCase } from '../../lib/format';
import {
  Button, Card, EmptyState, ErrorState, Field, Input, LoadingBlock, SectionHeader, StatCard, Tabs,
} from '../../components/ui';
import { fetchReturnsReport } from '../../api/reports';
import { fetchSales } from '../../api/pos';
import { useAsync } from '../../lib/hooks';
import { select } from '../../lib/supabase';

/**
 * Returns and voids (§33, §38).
 *
 * Two different corrections live here, and the difference matters:
 *   • a RETURN is a real customer bringing goods back — it reverses revenue,
 *     stock, FIFO/COGS, the supplier payable and commission;
 *   • a VOID is the owner undoing a mistake — it reverses the same things but
 *     the sale record stays, marked VOIDED, and is never deleted.
 * Neither is available to staff at any layer.
 */
export default function OwnerReturns() {
  const [tab, setTab] = useState<'returns' | 'voids' | 'eligible'>('returns');
  const [from, setFrom] = useState(new Date(Date.now() - 59 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  const report = useAsync(() => fetchReturnsReport(from, to), [from, to]);
  const sales = useAsync(() => fetchSales({ from, to }), [from, to]);

  const eligible = (sales.data?.items ?? []).filter(
    (s) => s.status !== 'VOIDED' && Number(s.total_amount) - Number(s.returned_amount) > 0,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-ink">Returns &amp; voids</h1>
          <p className="text-sm text-brand-muted">
            Refunds, cost reversals and commission claw-backs. Owner only — staff cannot reach either
            action.
          </p>
        </div>
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

      {report.data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Returns" value={report.data.returns.length} />
          <StatCard
            label="Refunded"
            value={money(report.data.returns.reduce((s, r) => s + Number(r.return_amount), 0))}
            tone="warn"
          />
          <StatCard
            label="Cost reversed"
            value={money(report.data.returns.reduce((s, r) => s + Number(r.cogs_reversed), 0))}
          />
          <StatCard label="Voids" value={report.data.voids.length} tone={report.data.voids.length ? 'bad' : 'default'} />
        </div>
      )}

      <Tabs
        tabs={[
          { id: 'returns', label: 'Returns', count: report.data?.returns.length },
          { id: 'voids', label: 'Voided sales', count: report.data?.voids.length },
          { id: 'eligible', label: 'Eligible to return', count: eligible.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {report.loading ? <LoadingBlock rows={6} /> :
       report.error ? <ErrorState message={report.error} onRetry={report.reload} /> : (
        <>
          {tab === 'returns' && (
            report.data!.returns.length === 0 ? (
              <Card><EmptyState title="No returns in this period" description="Nothing has come back from a customer." /></Card>
            ) : (
              <Card padded={false}>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Return</th>
                        <th>Sale</th>
                        <th>Type</th>
                        <th className="text-right">Refund</th>
                        <th className="text-right">Cost reversed</th>
                        <th>Restocked</th>
                        <th>Processed by</th>
                        <th>Reason</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {report.data!.returns.map((r) => (
                        <tr key={r.return_number}>
                          <td>
                            <p className="num text-sm text-brand-ink">{r.return_number}</p>
                            <p className="text-xs text-brand-muted">{fmtDate(r.return_date)}</p>
                          </td>
                          <td className="num text-sm text-brand-charcoal">{r.sale_number}</td>
                          <td><span className={r.return_type === 'FULL' ? 'chip-slate' : 'chip-amber'}>{titleCase(r.return_type)}</span></td>
                          <td className="text-right num">{money(r.return_amount)}</td>
                          <td className="text-right num">{money(r.cogs_reversed)}</td>
                          <td>
                            {r.restock_decision === 'RESTOCKED'
                              ? <span className="chip-green">Yes</span>
                              : <span className="chip-red">No — written off</span>}
                          </td>
                          <td className="text-sm text-brand-muted">{r.processed_by_name || '—'}</td>
                          <td className="text-xs text-brand-muted max-w-[16rem] truncate">{r.reason || '—'}</td>
                          <td className="text-right">
                            <Link to={`/admin/sales/${(sales.data?.items ?? []).find((s) => s.sale_number === r.sale_number)?.id ?? ''}`}>
                              <Button size="sm" variant="ghost">Sale</Button>
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )
          )}

          {tab === 'voids' && (
            report.data!.voids.length === 0 ? (
              <Card><EmptyState title="No voided sales" description="Nothing has been voided in this period." /></Card>
            ) : (
              <Card padded={false}>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Sale</th>
                        <th>Sale date</th>
                        <th className="text-right">Amount</th>
                        <th>Voided</th>
                        <th>By</th>
                        <th>Reason</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {report.data!.voids.map((v) => (
                        <tr key={v.sale_number}>
                          <td className="num text-sm text-brand-ink">{v.sale_number}</td>
                          <td className="text-xs text-brand-muted">{fmtDate(v.sale_date)}</td>
                          <td className="text-right num">{money(v.total_amount)}</td>
                          <td className="text-xs text-brand-muted">{fmtDateTime(v.voided_at)}</td>
                          <td className="text-sm text-brand-charcoal">{v.voided_by_name || '—'}</td>
                          <td className="text-xs text-brand-muted max-w-[18rem] truncate">{v.void_reason || '—'}</td>
                          <td className="text-right">
                            <Link to={`/admin/sales/${(sales.data?.items ?? []).find((s) => s.sale_number === v.sale_number)?.id ?? ''}`}>
                              <Button size="sm" variant="ghost">Sale</Button>
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )
          )}

          {tab === 'eligible' && (
            <>
              <Card className="bg-brand-soft border-brand-line">
                <p className="text-xs text-brand-charcoal">
                  Sales with value still on them. Open one to refund specific items — partially
                  returned sales stay here until everything is back.
                </p>
              </Card>
              {eligible.length === 0 ? (
                <Card><EmptyState title="Nothing eligible" description="Every sale in this period is either fully returned or voided." /></Card>
              ) : (
                <Card padded={false}>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Sale</th>
                          <th>Staff</th>
                          <th className="text-right">Total</th>
                          <th className="text-right">Already returned</th>
                          <th className="text-right">Remaining</th>
                          <th>Payment</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {eligible.map((s) => (
                          <tr key={s.id}>
                            <td>
                              <p className="num text-sm text-brand-ink">{s.sale_number}</p>
                              <p className="text-xs text-brand-muted">{fmtDate(s.sale_date)}</p>
                            </td>
                            <td className="text-sm text-brand-charcoal">{s.staff_name}</td>
                            <td className="text-right num">{money(s.total_amount)}</td>
                            <td className="text-right num">{money(s.returned_amount)}</td>
                            <td className="text-right num font-medium">
                              {money(s.total_amount - s.returned_amount)}
                            </td>
                            <td className="text-sm text-brand-charcoal">{titleCase(s.payment_method)}</td>
                            <td className="text-right">
                              <Link to={`/admin/sales/${s.id}`}>
                                <Button size="sm" variant="secondary">Open &amp; return</Button>
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </>
          )}
        </>
      )}

      {report.data?.note && (
        <Card>
          <SectionHeader title="How reversals are recorded" />
          <p className="text-sm text-brand-charcoal">{report.data.note}</p>
        </Card>
      )}

      <QuickLookup />
    </div>
  );
}

/** Find any sale by number without hunting through the ledger. */
function QuickLookup() {
  const [query, setQuery] = useState('');
  const [saleId, setSaleId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    setBusy(true);
    setError(null);
    try {
      const rows = await select<{ id: string }>('v_staff_sales', {
        columns: 'id', filters: { sale_number: query.trim().toUpperCase() }, limit: 1,
      });
      if (rows.length === 0) {
        setError('No sale with that number.');
        setSaleId(null);
      } else {
        setSaleId(rows[0].id);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <SectionHeader title="Find a sale by number" subtitle="Useful when a customer brings back a receipt." />
      <div className="flex flex-col sm:flex-row gap-2 sm:items-end max-w-xl">
        <div className="flex-1">
          <Field label="Sale number">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. S-000042" className="num" />
          </Field>
        </div>
        <div className="mb-3.5 flex gap-2">
          <Button onClick={search} loading={busy} disabled={query.trim().length < 3}>Find</Button>
          {saleId && <Link to={`/admin/sales/${saleId}`}><Button variant="secondary">Open</Button></Link>}
        </div>
      </div>
      {error && <p className="text-sm text-state-red">{error}</p>}
    </Card>
  );
}
