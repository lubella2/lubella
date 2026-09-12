import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fmtDate, fmtDateTime, money, titleCase } from '../../lib/format';
import {
  Button, Card, Checkbox, ConfirmDialog, EmptyState, ErrorState, Field, LoadingBlock,
  Modal, SectionHeader, StatCard, StatusBadge, Textarea, useToast,
} from '../../components/ui';
import { fetchSaleDetail, processReturn, voidSale } from '../../api/pos';
import { useAsync } from '../../lib/hooks';

/**
 * One sale, in full — and the only place a sale can be undone.
 *
 * There are two ways back and both are deliberate:
 *   • Return  — goods physically come back. Revenue, stock, FIFO/COGS, the
 *               supplier payable and commission are all reversed. Partial
 *               returns are allowed per line.
 *   • Void    — the sale was rung up wrongly. It reverses the unreturned units
 *               and marks the record VOIDED; the row itself is never deleted,
 *               so the audit trail survives (§33, §38).
 * Both are owner-only in the database, not merely hidden here.
 */
export default function OwnerSaleDetail() {
  const { saleId = '' } = useParams();
  const navigate = useNavigate();
  const [returnOpen, setReturnOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);

  const detail = useAsync(() => fetchSaleDetail(saleId), [saleId]);

  if (detail.loading) return <LoadingBlock rows={6} label="Loading the sale" />;
  if (detail.error) return <ErrorState message={detail.error} onRetry={detail.reload} />;
  if (!detail.data) return <EmptyState title="Sale not found" />;

  const { sale, items, returns, commissions } = detail.data;
  const outstanding = items.reduce((sum, i) => sum + (i.quantity - i.returned_qty), 0);
  const canReturn = outstanding > 0 && sale.status !== 'VOIDED';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-brand-ink num">{sale.sale_number}</h1>
            <StatusBadge status={sale.status} />
          </div>
          <p className="text-sm text-brand-muted">
            {fmtDateTime(sale.created_at)} · sold by {sale.staff_name} · {titleCase(sale.payment_method)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => navigate(`/admin/receipt/${sale.id}`)}>Receipt</Button>
          <Button variant="secondary" onClick={() => setReturnOpen(true)} disabled={!canReturn}>
            {outstanding > 0 ? 'Process return' : 'Fully returned'}
          </Button>
          <Button variant="danger" onClick={() => setVoidOpen(true)} disabled={sale.status === 'VOIDED'}>
            Void sale
          </Button>
        </div>
      </div>

      {sale.status === 'VOIDED' && (
        <Card className="border-state-red/30 bg-state-red/5">
          <p className="font-medium text-state-red">This sale was voided</p>
          <p className="text-sm text-brand-charcoal mt-1">
            {sale.void_reason || 'No reason recorded'}
            {sale.voided_at && <> · {fmtDateTime(sale.voided_at)}</>}
          </p>
          <p className="text-xs text-brand-muted mt-2">
            The record is kept and reversed: stock went back to the shelf, cost of goods sold and any
            commission were reversed, and the supplier payable for those units was reversed with them.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Subtotal" value={money(sale.subtotal)} />
        <StatCard label="Discount" value={sale.discount_amount ? `−${money(sale.discount_amount)}` : money(0)} />
        <StatCard label="Total taken" value={<>{money(sale.total_amount)} <span className="text-xs font-normal text-brand-muted">Birr</span></>} tone="brand" />
        <StatCard label="Cost of goods" value={money(sale.cogs_amount)} sub={`Profit ${money(sale.gross_profit)}`} />
      </div>

      <Card padded={false}>
        <div className="p-4 sm:p-5 pb-0"><SectionHeader title="Items" subtitle="Costs are frozen on the line as they were at the moment of sale." /></div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Unit price</th>
                <th className="text-right">Discount</th>
                <th className="text-right">Line total</th>
                <th className="text-right">Unit cost</th>
                <th className="text-right">Line cost</th>
                <th className="text-right">Returned</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>
                    <p className="text-brand-ink">{i.product_name}</p>
                    <p className="text-xs text-brand-muted num">{i.product_code}</p>
                  </td>
                  <td className="text-right num">{i.quantity}</td>
                  <td className="text-right num">{money(i.unit_price)}</td>
                  <td className="text-right num">{Number(i.line_discount) > 0 ? `−${money(i.line_discount)}` : '—'}</td>
                  <td className="text-right num font-medium">{money(i.line_total)}</td>
                  <td className="text-right num">{money(i.unit_cogs)}</td>
                  <td className="text-right num">{money(i.line_cogs)}</td>
                  <td className="text-right num">
                    {i.returned_qty > 0
                      ? <span className="chip-amber">{i.returned_qty} · {money(i.refunded_amount)}</span>
                      : <span className="text-brand-muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <SectionHeader title="Returns against this sale" />
          {returns.length === 0
            ? <p className="text-sm text-brand-muted">No returns.</p>
            : (
              <div className="space-y-2">
                {returns.map((r) => (
                  <div key={r.id} className="rounded-xl border border-brand-line p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="num text-sm font-medium text-brand-ink">{r.return_number}</p>
                      <span className={r.return_type === 'FULL' ? 'chip-slate' : 'chip-amber'}>
                        {titleCase(r.return_type)}
                      </span>
                    </div>
                    <p className="text-xs text-brand-muted mt-1">{fmtDate(r.return_date)}</p>
                    <div className="grid grid-cols-3 gap-2 mt-2 text-sm">
                      <span className="text-brand-muted">Refunded</span>
                      <span className="text-right num col-span-2">{money(r.return_amount)}</span>
                      <span className="text-brand-muted">Cost reversed</span>
                      <span className="text-right num col-span-2">{money(r.cogs_reversed)}</span>
                      <span className="text-brand-muted">Restocked</span>
                      <span className="text-right col-span-2">{r.restock_decision === 'RESTOCKED' ? 'Yes' : 'No'}</span>
                    </div>
                    {r.reason && <p className="text-xs text-brand-muted mt-2">{r.reason}</p>}
                  </div>
                ))}
              </div>
            )}
        </Card>

        <Card>
          <SectionHeader title="Commission on this sale" subtitle="3% of the final, post-discount amount." />
          {commissions.length === 0
            ? <p className="text-sm text-brand-muted">No commission rows (the owner's rate is 0%).</p>
            : (
              <div className="space-y-2">
                {commissions.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2 rounded-xl border border-brand-line p-3">
                    <div>
                      <p className="text-sm text-brand-ink">{titleCase(c.type)}</p>
                      <p className="text-xs text-brand-muted">{fmtDate(c.sale_date)} · rate {c.rate}</p>
                    </div>
                    <p className={`num font-medium ${c.type === 'EARNED' ? 'text-state-green' : 'text-state-red'}`}>
                      {c.type === 'EARNED' ? '+' : '−'}{money(c.amount)}
                    </p>
                  </div>
                ))}
              </div>
            )}
        </Card>
      </div>

      <ReturnModal
        open={returnOpen} saleId={sale.id} saleNumber={sale.sale_number}
        items={items.filter((i) => i.quantity - i.returned_qty > 0)}
        onClose={() => setReturnOpen(false)}
        onDone={() => detail.reload()}
      />

      <VoidDialog
        open={voidOpen} saleId={sale.id} saleNumber={sale.sale_number}
        onClose={() => setVoidOpen(false)} onDone={() => detail.reload()}
      />
    </div>
  );
}

/* --------------------------------- returns --------------------------------- */

function ReturnModal({
  open, saleId, saleNumber, items, onClose, onDone,
}: {
  open: boolean; saleId: string; saleNumber: string;
  items: Array<{
    id: string; product_name: string; product_code: string;
    quantity: number; unit_price: number; returned_qty: number;
    unit_cogs: number; line_total: number; refunded_amount: number;
  }>;
  onClose: () => void; onDone: () => void;
}) {
  const { push } = useToast();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(true);
  const [busy, setBusy] = useState(false);

  const selected = useMemo(
    () => Object.entries(quantities).filter(([, q]) => q > 0).map(([id, q]) => ({ sale_item_id: id, quantity: q })),
    [quantities],
  );

  /**
   * An estimate only, mirroring the database's remaining-value rule: what is
   * left on the line after previous refunds, spread over the units still on the
   * sale. The authoritative refund is whatever rpc_process_return() returns.
   */
  const refundPreview = useMemo(() => selected.reduce((sum, sel) => {
    const item = items.find((i) => i.id === sel.sale_item_id);
    if (!item) return sum;
    const outstanding = item.quantity - item.returned_qty;
    if (outstanding <= 0) return sum;
    const perUnit = (item.line_total - item.refunded_amount) / outstanding;
    return sum + perUnit * sel.quantity;
  }, 0), [selected, items]);

  const submit = async () => {
    if (selected.length === 0) {
      push({ tone: 'error', title: 'Choose at least one item to return' });
      return;
    }
    if (reason.trim().length < 3) {
      push({ tone: 'error', title: 'A reason is required', body: 'Returns are audited.' });
      return;
    }
    setBusy(true);
    try {
      const res = await processReturn({ saleId, items: selected, reason: reason.trim(), restock });
      push({
        tone: 'success',
        title: `${res.return_number} recorded`,
        body: `${money(res.refund_amount)} refunded · cost reversed ${money(res.cogs_reversed)} · commission reversed ${money(res.commission_reversed)}.`
          + (res.restocked ? ' Goods returned to stock.' : ' Goods not restocked.'),
      });
      setQuantities({}); setReason('');
      onClose(); onDone();
    } catch (err) {
      push({ tone: 'error', title: 'Return failed', body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open} onClose={onClose} title={`Return from ${saleNumber}`} size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy}>
            Process return{selected.length > 0 ? ` · about ${money(refundPreview)}` : ''}
          </Button>
        </>
      }
    >
      <p className="text-sm text-brand-muted mb-3">
        Choose how many of each item are coming back. Leave an item at zero to keep it on the sale.
      </p>
      <div className="space-y-2">
        {items.map((i) => {
          const outstanding = i.quantity - i.returned_qty;
          return (
            <div key={i.id} className="rounded-xl border border-brand-line p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-brand-ink">{i.product_name}</p>
                  <p className="text-xs text-brand-muted num">
                    {i.product_code} · {money(i.unit_price)} each
                    {i.returned_qty > 0 && <> · {i.returned_qty} already returned</>}
                  </p>
                </div>
                <div className="shrink-0 flex items-center gap-1.5">
                  <Button
                    size="sm" variant="ghost"
                    onClick={() => setQuantities((q) => ({ ...q, [i.id]: Math.max(0, (q[i.id] ?? 0) - 1) }))}
                  >
                    −
                  </Button>
                  <input
                    type="number" min={0} max={outstanding}
                    value={quantities[i.id] ?? 0}
                    onChange={(e) => setQuantities((q) => ({
                      ...q,
                      [i.id]: Math.min(outstanding, Math.max(0, Number(e.target.value) || 0)),
                    }))}
                    className="input num w-16 text-center"
                  />
                  <Button
                    size="sm" variant="ghost"
                    onClick={() => setQuantities((q) => ({ ...q, [i.id]: Math.min(outstanding, (q[i.id] ?? 0) + 1) }))}
                  >
                    +
                  </Button>
                  <span className="text-xs text-brand-muted">of {outstanding}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4">
        <Field label="Reason" required hint="Recorded on the return and in the audit log.">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer changed their mind" />
        </Field>
        <Checkbox
          label="Return the goods to stock"
          checked={restock}
          onChange={setRestock}
          hint="Turn this off for damaged or opened items: the customer is still refunded, but the cost stays in cost of goods sold because the unit is a loss, not saleable stock."
        />
      </div>

      <div className="rounded-xl bg-brand-soft p-3 mt-2">
        <p className="text-xs text-brand-charcoal">
          A return reverses the sale's revenue, the return of stock, the FIFO cost of goods sold and
          the supplier payable for those units — and it claws back the commission that was earned on
          them. All of it happens in one database transaction.
        </p>
      </div>
    </Modal>
  );
}

/* ---------------------------------- voids ---------------------------------- */

function VoidDialog({
  open, saleId, saleNumber, onClose, onDone,
}: { open: boolean; saleId: string; saleNumber: string; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (reason.trim().length < 3) {
      push({ tone: 'error', title: 'A void needs a reason' });
      return;
    }
    setBusy(true);
    try {
      const res = await voidSale(saleId, reason.trim());
      push({
        tone: 'success',
        title: `${saleNumber} voided`,
        body: `${money(res.voided_amount)} reversed · cost ${money(res.cogs_reversed)} · commission ${money(res.commission_reversed)}.`,
      });
      setReason('');
      onClose(); onDone();
    } catch (err) {
      push({ tone: 'error', title: 'Void failed', body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <Modal
        open={open && !confirmOpen} onClose={onClose} title={`Void ${saleNumber}`} size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="danger" onClick={() => setConfirmOpen(true)} disabled={reason.trim().length < 3}>
              Continue
            </Button>
          </>
        }
      >
        <p className="text-sm text-brand-charcoal">
          Voiding reverses the units that have not already been returned: stock returns to the shelf,
          cost of goods sold and the supplier payable are reversed, and any commission is clawed back.
        </p>
        <div className="mt-3">
          <Field label="Reason" required hint="Kept with the record permanently.">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Rung up on the wrong product" />
          </Field>
        </div>
        <p className="text-xs text-brand-muted">
          The sale is never deleted — it stays in the ledger marked VOIDED so the audit trail is complete.
        </p>
      </Modal>

      <ConfirmDialog
        open={confirmOpen}
        title="Void this sale?"
        message={`This reverses ${saleNumber} and cannot be undone from this screen. The record stays in the ledger.`}
        confirmLabel="Void sale"
        tone="danger"
        busy={busy}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void submit()}
      />
    </>
  );
}
