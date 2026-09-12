import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtDate, money, titleCase } from '../../lib/format';
import {
  Button, Card, EmptyState, ErrorState, Field, FilterChips, LoadingBlock, SectionHeader,
  Select, StatCard, Tabs,
} from '../../components/ui';
import { fetchSupplierPayables, fetchSupplierPayments } from '../../api/finance';
import { listSuppliers } from '../../api/catalogAdmin';
import { SupplierPaymentModal } from './Suppliers';
import { useAsync } from '../../lib/hooks';
import type { Supplier } from '../../types';

interface LedgerEntry {
  date: string;
  kind: 'PAYABLE' | 'REVERSAL' | 'PAYMENT';
  reference: string;
  description: string;
  charge: number;
  credit: number;
}

/**
 * Credit book.
 *
 * This is an account ledger, not an input form. Every line is a transaction
 * record: a FIFO allocation that created a payable when a unit sold (a charge),
 * the reversal created when that sale was returned (a credit against the
 * charge), or a payment that settled lines (a credit). Balances shown here are
 * the ones PostgreSQL computed — the running column is a reading of the ledger,
 * not a figure anyone can type (§21, §61).
 */
export default function OwnerCreditBook() {
  const [supplierCode, setSupplierCode] = useState<string | null>(null);
  const [scope, setScope] = useState<'open' | 'all'>('open');
  const [tab, setTab] = useState<'ledger' | 'balances'>('ledger');
  const [payOpen, setPayOpen] = useState<{ supplier: Supplier } | null>(null);

  const suppliers = useAsync(() => listSuppliers(), []);
  const payables = useAsync(() => fetchSupplierPayables(null), []);
  const payments = useAsync(() => fetchSupplierPayments(), []);

  const totals = payables.data?.totals;

  const selected = useMemo(() => {
    if (!supplierCode) return null;
    const summary = (payables.data?.suppliers ?? []).find((s) => s.supplier_code === supplierCode);
    const full = (suppliers.data ?? []).find((s) => s.supplier_code === supplierCode) ?? null;
    return summary ? { summary, full } : null;
  }, [supplierCode, payables.data, suppliers.data]);

  /** Entries for the selected supplier (or every supplier when none is chosen). */
  const ledger = useMemo<LedgerEntry[]>(() => {
    const lines = (payables.data?.lines ?? [])
      .filter((l) => !supplierCode || l.supplier_name === selected?.summary.name);
    const pays = (payments.data?.items ?? [])
      .filter((p) => !supplierCode || p.supplier_name === selected?.summary.name);

    const entries: LedgerEntry[] = [
      ...lines.map((l) => ({
        date: l.entry_date,
        kind: (l.is_reversal ? 'REVERSAL' : 'PAYABLE') as LedgerEntry['kind'],
        reference: l.batch_number,
        description: `${l.product_name} · ${l.quantity_sold} sold @ ${money(l.purchase_cost)} cost`,
        charge: l.is_reversal ? 0 : Number(l.payable_amount),
        credit: l.is_reversal ? Math.abs(Number(l.payable_amount)) : 0,
      })),
      ...pays.map((p) => ({
        date: p.payment_date,
        kind: 'PAYMENT' as const,
        reference: p.payment_number,
        description: `Payment · ${titleCase(p.payment_method)}${p.reference ? ` · ${p.reference}` : ''}`,
        charge: 0,
        credit: Number(p.amount),
      })),
    ];

    return entries.sort((a, b) => a.date.localeCompare(b.date));
  }, [payables.data, payments.data, supplierCode, selected]);

  const runningBalance = useMemo(
    () => ledger.reduce((sum, e) => sum + e.charge - e.credit, 0),
    [ledger],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-ink">Credit book</h1>
          <p className="text-sm text-brand-muted">
            What the shop owes each supplier, built line by line from goods that actually sold.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/admin/suppliers"><Button variant="secondary">Suppliers</Button></Link>
          <Button
            disabled={!selected?.full}
            onClick={() => selected?.full && setPayOpen({ supplier: selected.full })}
          >
            Record payment
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Charged (all time)" value={money(totals?.payable ?? 0)} sub="Cost of units sold, not of stock received" />
        <StatCard label="Settled" value={money(totals?.paid ?? 0)} tone="good" />
        <StatCard
          label="Outstanding" tone={(totals?.outstanding ?? 0) > 0 ? 'warn' : 'good'}
          value={<>{money(totals?.outstanding ?? 0)} <span className="text-xs font-normal text-brand-muted">Birr</span></>}
        />
        <StatCard
          label="Suppliers with a balance"
          value={(payables.data?.suppliers ?? []).filter((s) => Number(s.outstanding) > 0).length}
        />
      </div>

      <Card className="bg-brand-soft border-brand-line">
        <p className="text-xs text-brand-charcoal leading-relaxed">
          <strong>Why the charge is not the invoice total:</strong> receiving 10,000 Birr of stock
          makes none of it payable. Only the units that sell are charged, at their purchase cost,
          oldest batch first. Stock still on the shelf is not a debt yet.
        </p>
      </Card>

      <Card>
        <SectionHeader title="Choose an account" subtitle="Pick a supplier to read their ledger, or all suppliers combined." />
        <FilterChips
          allLabel="All suppliers" value={supplierCode} onChange={setSupplierCode}
          options={(payables.data?.suppliers ?? []).map((s) => ({
            value: s.supplier_code,
            label: `${s.name}${Number(s.outstanding) > 0 ? ` · ${money(s.outstanding)}` : ''}`,
          }))}
        />
      </Card>

      {selected && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Charged" value={money(selected.summary.total_payable)} />
          <StatCard label="Paid" value={money(selected.summary.total_paid)} />
          <StatCard label="Outstanding" value={money(selected.summary.outstanding)} tone={Number(selected.summary.outstanding) > 0 ? 'warn' : 'good'} />
        </div>
      )}

      <Tabs
        tabs={[
          { id: 'ledger', label: 'Ledger', count: ledger.length },
          { id: 'balances', label: 'Balances' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'ledger' ? (
        payables.loading || payments.loading ? <LoadingBlock rows={6} /> :
        payables.error ? <ErrorState message={payables.error} onRetry={payables.reload} /> :
        ledger.length === 0 ? (
          <Card>
            <EmptyState
              title="Nothing on the credit book yet"
              description="Entries appear as soon as stock from a supplier sells. Receiving stock alone does not create a charge."
            />
          </Card>
        ) : (
          <Card padded={false}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Reference</th>
                    <th>Entry</th>
                    <th className="text-right">Charged</th>
                    <th className="text-right">Settled</th>
                    <th className="text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((e, i) => {
                    const balance = ledger.slice(0, i + 1).reduce((s, x) => s + x.charge - x.credit, 0);
                    return (
                      <tr key={`${e.date}-${e.reference}-${i}`} className={e.kind === 'REVERSAL' ? 'bg-brand-blush/40' : ''}>
                        <td className="whitespace-nowrap text-xs text-brand-muted">{fmtDate(e.date)}</td>
                        <td className="num text-xs text-brand-charcoal">{e.reference}</td>
                        <td>
                          <span className={
                            e.kind === 'PAYMENT' ? 'chip-green' : e.kind === 'REVERSAL' ? 'chip-red' : 'chip-slate'
                          }>
                            {titleCase(e.kind)}
                          </span>
                          <p className="text-xs text-brand-muted mt-1">{e.description}</p>
                        </td>
                        <td className="text-right num">{e.charge ? money(e.charge) : '—'}</td>
                        <td className="text-right num text-state-green">{e.credit ? money(e.credit) : '—'}</td>
                        <td className="text-right num font-medium">{money(balance)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-brand-soft">
                    <td colSpan={3} className="text-right text-sm font-medium text-brand-charcoal">
                      Balance on this ledger
                    </td>
                    <td className="text-right num font-semibold">{money(ledger.reduce((s, e) => s + e.charge, 0))}</td>
                    <td className="text-right num font-semibold text-state-green">{money(ledger.reduce((s, e) => s + e.credit, 0))}</td>
                    <td className="text-right num font-semibold text-brand-ink">{money(runningBalance)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        )
      ) : (
        <>
          <Card>
            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
              <div className="sm:w-64">
                <Field label="Show" hint="Open balances first for chasing, all lines for a full audit.">
                  <Select value={scope} onChange={(e) => setScope(e.target.value as 'open' | 'all')}>
                    <option value="open">Outstanding only</option>
                    <option value="all">Every transaction</option>
                  </Select>
                </Field>
              </div>
            </div>
          </Card>

          {payables.loading ? <LoadingBlock rows={5} /> :
           payables.error ? <ErrorState message={payables.error} onRetry={payables.reload} /> :
           (payables.data?.suppliers ?? []).filter((s) => scope === 'all' || Number(s.outstanding) > 0).length === 0 ? (
            <Card><EmptyState title="No open balances" description="Every supplier is settled." /></Card>
          ) : (
            <Card padded={false}>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Supplier</th>
                      <th className="text-right">Charged</th>
                      <th className="text-right">Paid</th>
                      <th className="text-right">Outstanding</th>
                      <th className="text-right">Open lines</th>
                      <th>Last activity</th>
                      <th>Latest line</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(payables.data?.suppliers ?? [])
                      .filter((s) => scope === 'all' || Number(s.outstanding) > 0)
                      .sort((a, b) => Number(b.outstanding) - Number(a.outstanding))
                      .map((s) => {
                        const latest = (payables.data?.lines ?? []).find((l) => l.supplier_name === s.name);
                        return (
                          <tr key={s.supplier_code}>
                            <td>
                              <button
                                className="font-medium text-brand-ink hover:text-brand-deep"
                                onClick={() => setSupplierCode(s.supplier_code)}
                                title="Open this supplier's ledger"
                              >
                                {s.name}
                              </button>
                              <p className="text-xs text-brand-muted num">{s.supplier_code}</p>
                            </td>
                            <td className="text-right num">{money(s.total_payable)}</td>
                            <td className="text-right num">{money(s.total_paid)}</td>
                            <td className={`text-right num font-medium ${Number(s.outstanding) > 0 ? 'text-[#8a6318]' : 'text-state-green'}`}>
                              {money(s.outstanding)}
                            </td>
                            <td className="text-right num">{s.open_lines}</td>
                            <td className="text-xs text-brand-muted">{s.last_activity ? fmtDate(s.last_activity) : '—'}</td>
                            <td className="text-xs text-brand-muted max-w-[14rem] truncate">
                              {latest ? `${latest.product_name} · ${latest.batch_number}` : '—'}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      <SupplierPaymentModal
        target={payOpen} onClose={() => setPayOpen(null)}
        onDone={() => { payables.reload(); payments.reload(); }}
      />
    </div>
  );
}
