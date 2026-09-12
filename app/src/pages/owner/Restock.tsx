import { useMemo, useState } from 'react';
import { fmtDate, money } from '../../lib/format';
import {
  Button, Card, Checkbox, EmptyState, ErrorState, Field, Input, LoadingBlock, Modal,
  MoneyInput, Select, Tabs, Textarea, useToast,
} from '../../components/ui';
import { listBatches, listRestocks, recordBatchCost, recordRestock } from '../../api/inventory';
import { listSuppliers } from '../../api/catalogAdmin';
import { useAsync } from '../../lib/hooks';
import { select } from '../../lib/supabase';
import type { StaffProduct } from '../../types';

/**
 * Receiving and purchase-cost review (§27).
 *
 * Staff can receive a shipment but cannot price it. Each shipment creates a
 * purchase batch; FIFO consumes those batches oldest-first and it is the batch
 * cost that becomes the supplier payable. That is why cost is captured here and
 * not on the product.
 */
export default function OwnerRestock() {
  const { push } = useToast();
  const [tab, setTab] = useState<'batches' | 'receivings'>('batches');
  const [newOpen, setNewOpen] = useState(false);
  const [costFor, setCostFor] = useState<{ id: string; name: string; batch: string; quantity: number; pending: boolean } | null>(null);

  const batches = useAsync(() => listBatches({}), []);
  const restocks = useAsync(() => listRestocks(false), []);

  const pendingCount = batches.data?.pending_cost_count ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-ink">Restock</h1>
          <p className="text-sm text-brand-muted">
            Every shipment creates a batch. Batches are consumed oldest-first, and their cost becomes
            what you owe the supplier.
          </p>
        </div>
        <Button onClick={() => setNewOpen(true)}>Receive shipment</Button>
      </div>

      {pendingCount > 0 && (
        <Card className="border-state-amber/40 bg-state-amber/5">
          <div className="flex items-start gap-3">
            <span className="text-xl" aria-hidden="true">🏷️</span>
            <div className="flex-1">
              <p className="font-medium text-brand-ink">
                {pendingCount} shipment{pendingCount === 1 ? '' : 's'} waiting for a purchase cost
              </p>
              <p className="text-sm text-brand-muted mt-0.5">
                Until a cost is recorded, supplier payables for those units stay at zero. Recording the
                cost updates the payables and the cost of goods sold for any units already sold —
                history is corrected, never deleted.
              </p>
              <Button
                size="sm" variant="secondary" className="mt-2"
                onClick={() => { setTab('batches'); batches.reload(); }}
              >
                Review now
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Tabs
        tabs={[
          { id: 'batches', label: 'Purchase batches (FIFO)' },
          { id: 'receivings', label: 'Receivings' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'batches' ? (
        batches.loading ? <LoadingBlock rows={6} /> :
        batches.error ? <ErrorState message={batches.error} onRetry={batches.reload} /> :
        (batches.data?.items.length ?? 0) === 0 ? (
          <Card><EmptyState title="No batches yet" description="Receive a shipment to create the first batch." /></Card>
        ) : (
          <>
            <p className="text-xs text-brand-muted">
              Ordered oldest first within each product. The top row is sold first.
            </p>
            <Card padded={false}>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Batch</th>
                      <th>Product</th>
                      <th>Supplier</th>
                      <th className="text-right">Cost/unit</th>
                      <th className="text-right">Received</th>
                      <th className="text-right">Sold</th>
                      <th className="text-right">Left</th>
                      <th className="text-right">Value left</th>
                      <th>Requested</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {batches.data!.items.map((b) => (
                      <tr key={b.id}>
                        <td>
                          <p className="num text-sm text-brand-ink">{b.batch_number}</p>
                          <p className="text-xs text-brand-muted">{fmtDate(b.received_date)}</p>
                        </td>
                        <td>
                          <p className="text-brand-ink">{b.product_name}</p>
                          <p className="text-xs text-brand-muted">{b.product_code} · sells {money(b.selling_price)}</p>
                        </td>
                        <td className="text-brand-charcoal text-sm">{b.supplier_name}</td>
                        <td className="text-right num">
                          {b.cost_status === 'PENDING'
                            ? <span className="chip-amber">Not set</span>
                            : <>
                                {money(b.unit_cost)}
                                {b.unit_margin != null && (
                                  <span className="block text-[10px] text-brand-muted">
                                    margin {money(b.unit_margin)}
                                  </span>
                                )}
                              </>}
                        </td>
                        <td className="text-right num">{b.quantity_received}</td>
                        <td className="text-right num">{b.quantity_sold}</td>
                        <td className="text-right num font-medium">{b.quantity_remaining}</td>
                        <td className="text-right num">{money(b.value_remaining)}</td>
                        <td>
                          {b.request_count > 0 ? (
                            <span className="chip-rose" title={`${b.customers_requested} customers have requested this product.`}>
                              {b.request_count} req
                            </span>
                          ) : <span className="text-brand-muted text-xs">—</span>}
                        </td>
                        <td className="text-right">
                          <Button
                            size="sm"
                            variant={b.cost_status === 'PENDING' ? 'primary' : 'ghost'}
                            onClick={() => setCostFor({
                              id: b.id, name: b.product_name, batch: b.batch_number,
                              quantity: b.quantity_received, pending: b.cost_status === 'PENDING',
                            })}
                          >
                            {b.cost_status === 'PENDING' ? 'Set cost' : 'Change'}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )
      ) : (
        restocks.loading ? <LoadingBlock rows={6} /> :
        restocks.error ? <ErrorState message={restocks.error} onRetry={restocks.reload} /> :
        (restocks.data?.items.length ?? 0) === 0 ? (
          <Card><EmptyState title="No receivings yet" /></Card>
        ) : (
          <Card padded={false}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Restock</th>
                    <th>Product</th>
                    <th>Supplier</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Cost</th>
                    <th>Received by</th>
                    <th>Flag</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {restocks.data!.items.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <p className="num text-sm">{r.restock_number}</p>
                        <p className="text-xs text-brand-muted">{fmtDate(r.received_date)}</p>
                      </td>
                      <td className="text-brand-ink">{r.product_name}</td>
                      <td className="text-brand-charcoal text-sm">{r.supplier_name}</td>
                      <td className="text-right num">{r.quantity}</td>
                      <td className="text-right num">
                        {r.cost_pending ? <span className="chip-amber">Pending</span> : money(r.unit_cost ?? 0)}
                      </td>
                      <td className="text-brand-muted text-sm">{r.received_by_name || '—'}</td>
                      <td>
                        {r.cost_change_warning
                          ? <span className="chip-amber" title={r.cost_change_warning}>Cost changed</span>
                          : <span className="text-brand-muted text-xs">—</span>}
                      </td>
                      <td className="text-right">
                        {r.batch_id && (
                          <Button
                            size="sm" variant={r.cost_pending ? 'primary' : 'ghost'}
                            onClick={() => setCostFor({
                              id: r.batch_id!, name: r.product_name, batch: r.restock_number,
                              quantity: r.quantity, pending: r.cost_pending,
                            })}
                          >
                            {r.cost_pending ? 'Set cost' : 'Change'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )
      )}

      <ReceiveShipmentModal
        open={newOpen} onClose={() => setNewOpen(false)}
        onDone={() => { batches.reload(); restocks.reload(); }}
      />

      <RecordCostModal
        target={costFor} onClose={() => setCostFor(null)}
        onDone={() => { batches.reload(); restocks.reload(); }}
        push={push}
      />
    </div>
  );
}

function ReceiveShipmentModal({
  open, onClose, onDone,
}: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const products = useAsync(() => select<StaffProduct>('v_staff_products', { order: 'name.asc' }), [], {});
  const suppliers = useAsync(() => listSuppliers(), []);

  const [productId, setProductId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [quantity, setQuantity] = useState<number | ''>('');
  const [unitCost, setUnitCost] = useState<number | ''>('');
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10));
  const [expiryDate, setExpiryDate] = useState('');
  const [invoice, setInvoice] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const selected = useMemo(
    () => products.data?.find((p) => p.id === productId) ?? null,
    [products.data, productId],
  );

  const submit = async () => {
    if (!productId || !supplierId || !quantity) {
      push({ tone: 'error', title: 'Product, supplier and quantity are required' });
      return;
    }
    setBusy(true);
    try {
      const res = await recordRestock({
        productId, supplierId, quantity: Number(quantity),
        receivedDate, expiryDate: expiryDate || null,
        supplierInvoice: invoice || null, notes: notes || null,
        unitCost: unitCost === '' ? null : Number(unitCost),
      });
      push({
        tone: res.cost_flagged ? 'info' : 'success',
        title: `Received ${res.restock_number}`,
        body: res.cost_review_message || `${res.quantity_on_hand} units now in stock.`,
      });
      onClose(); onDone();
      setQuantity(''); setUnitCost(''); setNotes(''); setInvoice(''); setExpiryDate('');
    } catch (err) {
      push({ tone: 'error', title: 'Could not record the shipment', body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open} onClose={onClose} title="Receive a shipment" size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy}>Record shipment</Button>
        </>
      }
    >
      <Field label="Product" required>
        <Select value={productId} onChange={(e) => {
          setProductId(e.target.value);
          const p = products.data?.find((x) => x.id === e.target.value);
          if (p?.supplier_id) setSupplierId(p.supplier_id);
        }}>
          <option value="">Select a product…</option>
          {(products.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>{p.name} ({p.product_code})</option>
          ))}
        </Select>
      </Field>

      {selected && (
        <p className="text-xs text-brand-muted -mt-2 mb-3">
          Currently {selected.quantity_on_hand} in stock · selling at {money(selected.selling_price)} Birr
        </p>
      )}

      <Field label="Supplier" required>
        <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">Select a supplier…</option>
          {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </Field>

      <div className="grid sm:grid-cols-2 gap-x-4">
        <Field label="Quantity received" required>
          <Input
            type="number" min={1} value={quantity}
            onChange={(e) => setQuantity(e.target.value === '' ? '' : Number(e.target.value))}
          />
        </Field>
        <Field label="Purchase cost per unit" hint="What this supplier charges. Leave blank if unknown.">
          <MoneyInput value={unitCost} onValueChange={setUnitCost} />
        </Field>
      </div>

      <div className="grid sm:grid-cols-2 gap-x-4">
        <Field label="Received date">
          <Input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
        </Field>
        <Field label="Expiry date" hint="Optional. Expired stock cannot be sold.">
          <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
        </Field>
      </div>

      <Field label="Supplier invoice / reference">
        <Input value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="e.g. INV-4471" />
      </Field>

      <Field label="Notes">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Delivered in two boxes" />
      </Field>

      <div className="rounded-xl bg-brand-soft p-3">
        <p className="text-xs text-brand-charcoal">
          <strong>How this is used:</strong> the shipment becomes a purchase batch. When stock sells,
          the oldest batch is consumed first (FIFO) and <em>its cost</em> — not the selling price —
          becomes what you owe the supplier. Unsold stock is not payable yet.
        </p>
      </div>
    </Modal>
  );
}

function RecordCostModal({
  target, onClose, onDone, push,
}: {
  target: { id: string; name: string; batch: string; quantity: number; pending: boolean } | null;
  onClose: () => void; onDone: () => void;
  push: (t: { tone: 'success' | 'error' | 'info'; title: string; body?: string }) => void;
}) {
  const [cost, setCost] = useState<number | ''>('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmReprice, setConfirmReprice] = useState(false);

  const submit = async () => {
    if (!target || cost === '') return;
    setBusy(true);
    try {
      await recordBatchCost(target.id, Number(cost), reason || undefined);
      push({
        tone: 'success',
        title: 'Purchase cost recorded',
        body: `Payables and cost of goods sold for ${target.name} have been updated from this batch.`,
      });
      onClose(); onDone();
      setCost(''); setReason(''); setConfirmReprice(false);
    } catch (err) {
      push({ tone: 'error', title: 'Could not record the cost', body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(target)} onClose={onClose}
      title={target?.pending ? 'Record the purchase cost' : 'Change the purchase cost'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={cost === ''}>Save cost</Button>
        </>
      }
    >
      {target && (
        <div className="space-y-3">
          <p className="text-sm text-brand-charcoal">
            {target.name} · batch {target.batch} · {target.quantity} units received
          </p>
          <Field label="Cost per unit" required>
            <MoneyInput value={cost} onValueChange={setCost} />
          </Field>
          {typeof cost === 'number' && cost > 0 && (
            <p className="text-xs text-brand-muted num">
              Total batch value: {money(cost * target.quantity)} Birr
            </p>
          )}
          <Field label="Reason / invoice note" hint="Recorded in the cost history.">
            <Input
              value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Supplier invoice #4471"
            />
          </Field>
          {!target.pending && (
            <>
              <Checkbox
                label="I understand this updates existing records"
                checked={confirmReprice}
                onChange={setConfirmReprice}
                hint="Changing a cost revalues the payables and cost of goods sold for units already sold from this batch. The previous figure is kept in the cost history — nothing is deleted."
              />
            </>
          )}
          <p className="text-xs text-brand-muted">
            The selling price is <strong>not</strong> changed by this. Review pricing separately in
            Products if the margin no longer works.
          </p>
        </div>
      )}
    </Modal>
  );
}
