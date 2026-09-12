import { useMemo, useState } from 'react';
import { fmtDate } from '../../lib/format';
import {
  Button, Card, EmptyState, ErrorState, Field, Input, LoadingBlock, Modal, Select, StatCard,
  Tabs, Textarea, useToast,
} from '../../components/ui';
import { listRestocks, recordRestock } from '../../api/inventory';
import { listSuppliers } from '../../api/catalogAdmin';
import { useAsync } from '../../lib/hooks';
import { select } from '../../lib/supabase';
import type { StaffProduct } from '../../types';

/**
 * Receiving stock (staff).
 *
 * Staff record what arrived: which product, from which supplier, how many, and
 * when it expires. What they cannot do is price it — a purchase cost entered
 * here is ignored by the database and the batch is left pending for the owner
 * to cost. That is deliberate: the cost becomes the supplier payable and the
 * cost of goods sold, so it is the owner's figure to set (§27).
 */
export default function StaffRestock() {
  const { push } = useToast();
  const [tab, setTab] = useState<'receive' | 'recent'>('receive');
  const [receiveOpen, setReceiveOpen] = useState(false);

  const restocks = useAsync(() => listRestocks(false), []);
  const products = useAsync(() => select<StaffProduct>('v_staff_products', { order: 'name.asc' }), []);

  const lowStock = useMemo(
    () => (products.data ?? []).filter((p) => p.is_low_stock || p.is_out_of_stock),
    [products.data],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-ink">Receiving stock</h1>
          <p className="text-sm text-brand-muted">
            Record shipments as they arrive. Each one becomes a batch that sells oldest-first.
          </p>
        </div>
        <Button onClick={() => setReceiveOpen(true)}>Receive a shipment</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Receivings recorded" value={restocks.data?.items.length ?? 0} />
        <StatCard
          label="Waiting for a cost"
          value={(restocks.data?.items ?? []).filter((r) => r.cost_pending).length}
          tone={(restocks.data?.items ?? []).some((r) => r.cost_pending) ? 'warn' : 'good'}
          sub="The owner sets purchase costs"
        />
        <StatCard label="Products running low" value={lowStock.filter((p) => p.is_low_stock).length} tone={lowStock.length ? 'warn' : 'default'} />
        <StatCard label="Out of stock" value={lowStock.filter((p) => p.is_out_of_stock).length} tone={lowStock.filter((p) => p.is_out_of_stock).length ? 'bad' : 'default'} />
      </div>

      <Card className="bg-brand-soft border-brand-line">
        <p className="text-xs text-brand-charcoal leading-relaxed">
          <strong>Why no price field for staff:</strong> the purchase cost of a batch is what the shop
          owes the supplier and what the goods cost when they sell. Receiving the shipment is a
          counter job; pricing it is the owner's, and the database enforces that split rather than
          relying on who is looking at the screen.
        </p>
      </Card>

      <Tabs
        tabs={[
          { id: 'receive', label: 'What needs restocking', count: lowStock.length },
          { id: 'recent', label: 'Recent receivings', count: restocks.data?.items.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'receive' ? (
        lowStock.length === 0 ? (
          <Card><EmptyState title="Everything is above its minimum" description="Nothing needs restocking right now." /></Card>
        ) : (
          <Card padded={false}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Supplier</th>
                    <th className="text-right">On hand</th>
                    <th className="text-right">Minimum</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lowStock.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <p className="text-brand-ink">{p.name}</p>
                        <p className="text-xs text-brand-muted num">{p.product_code}</p>
                      </td>
                      <td className="text-sm text-brand-charcoal">{p.supplier_name || '—'}</td>
                      <td className="text-right num font-medium">{p.quantity_on_hand}</td>
                      <td className="text-right num text-brand-muted">{p.minimum_stock}</td>
                      <td>
                        {p.is_out_of_stock ? <span className="chip-red">Out of stock</span> : <span className="chip-amber">Low</span>}
                      </td>
                      <td className="text-right">
                        <Button size="sm" variant="secondary" onClick={() => setReceiveOpen(true)}>Receive</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )
      ) : (
        restocks.loading ? <LoadingBlock rows={6} /> :
        restocks.error ? <ErrorState message={restocks.error} onRetry={restocks.reload} /> :
        (restocks.data?.items.length ?? 0) === 0 ? (
          <Card>
            <EmptyState
              title="No shipments recorded yet"
              description="When stock arrives, record it here so the shop knows what is on the shelf."
              action={<Button onClick={() => setReceiveOpen(true)}>Receive a shipment</Button>}
            />
          </Card>
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
                    <th>Expiry</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {restocks.data!.items.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <p className="num text-sm text-brand-ink">{r.restock_number}</p>
                        <p className="text-xs text-brand-muted">{fmtDate(r.received_date)}</p>
                      </td>
                      <td className="text-brand-ink">{r.product_name}</td>
                      <td className="text-sm text-brand-charcoal">{r.supplier_name}</td>
                      <td className="text-right num font-medium">+{r.quantity}</td>
                      <td className="text-xs text-brand-muted">{r.expiry_date ? fmtDate(r.expiry_date) : '—'}</td>
                      <td>
                        {r.cost_pending
                          ? <span className="chip-amber">Awaiting cost from the owner</span>
                          : <span className="chip-green">Costed</span>}
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
        open={receiveOpen} onClose={() => setReceiveOpen(false)}
        onDone={() => { restocks.reload(); products.reload(); push({ tone: 'success', title: 'Shipment recorded' }); }}
      />
    </div>
  );
}

function ReceiveShipmentModal({
  open, onClose, onDone,
}: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const products = useAsync(() => select<StaffProduct>('v_staff_products', { order: 'name.asc' }), [], { enabled: open });
  const suppliers = useAsync(() => listSuppliers(), [], { enabled: open });

  const [productId, setProductId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [quantity, setQuantity] = useState<number | ''>('');
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10));
  const [expiryDate, setExpiryDate] = useState('');
  const [invoice, setInvoice] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const selected = products.data?.find((p) => p.id === productId) ?? null;

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
      });
      push({
        tone: res.cost_pending ? 'info' : 'success',
        title: `Recorded ${res.restock_number}`,
        body: res.cost_pending
          ? 'The owner will set the purchase cost. Stock is available now.'
          : `${res.quantity_on_hand} units now in stock.`,
      });
      setQuantity(''); setNotes(''); setInvoice(''); setExpiryDate('');
      onClose(); onDone();
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
        <Select
          value={productId}
          onChange={(e) => {
            setProductId(e.target.value);
            const p = products.data?.find((x) => x.id === e.target.value);
            if (p?.supplier_id) setSupplierId(p.supplier_id);
          }}
        >
          <option value="">Select a product…</option>
          {(products.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>{p.name} ({p.product_code})</option>
          ))}
        </Select>
      </Field>

      {selected && (
        <p className="text-xs text-brand-muted -mt-2 mb-3">
          Currently {selected.quantity_on_hand} in stock
          {selected.supplier_name ? ` · usual supplier ${selected.supplier_name}` : ''}
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
        <Field label="Expiry date" hint="If the box has one. Expired stock cannot be sold.">
          <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
        </Field>
      </div>

      <Field label="Received date">
        <Input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
      </Field>

      <Field label="Supplier invoice or delivery note">
        <Input value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="e.g. INV-4471" />
      </Field>

      <Field label="Notes">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. One carton slightly damaged" />
      </Field>

      <div className="rounded-xl bg-brand-soft p-3">
        <p className="text-xs text-brand-charcoal">
          You are recording what physically arrived. The owner adds what it cost, and that cost is what
          the shop will owe the supplier once the units sell — never the selling price.
        </p>
      </div>
    </Modal>
  );
}
