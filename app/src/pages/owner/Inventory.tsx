import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtDate, money, titleCase } from '../../lib/format';
import {
  Button, Card, EmptyState, ErrorState, LoadingBlock, Modal, SectionHeader, Select, StatCard, Tabs, useToast,
} from '../../components/ui';
import { fetchInventoryReport, fetchMovements, adjustStock } from '../../api/inventory';
import { useAsync } from '../../lib/hooks';
import { MovementType } from '../../types';

/**
 * Inventory (owner view).
 *
 * This is the cost-bearing view: average cost per unit and stock value at cost.
 * Staff reach the same stock through a different view that has no cost columns,
 * so the separation is structural rather than cosmetic.
 */
export default function OwnerInventory() {
  const [tab, setTab] = useState<'valuation' | 'movements'>('valuation');
  const [onlyAttention, setOnlyAttention] = useState(false);

  const inventory = useAsync(() => fetchInventoryReport({ onlyAttention }), [onlyAttention]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-ink">Inventory</h1>
          <p className="text-sm text-brand-muted">
            Stock is derived from an append-only movement ledger, never a stored number.
          </p>
        </div>
        <Link to="/admin/stock-count"><Button variant="secondary">Biweekly stock count</Button></Link>
      </div>

      {inventory.data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Stock value (at cost)" value={<>{money(inventory.data.totals.total_value)} <span className="text-xs font-normal text-brand-muted">Birr</span></>} tone="brand" />
          <StatCard label="Retail value" value={<>{money(inventory.data.totals.retail_value)} <span className="text-xs font-normal text-brand-muted">Birr</span></>} sub="If everything sells at list price" />
          <StatCard label="Units on hand" value={inventory.data.totals.total_units} />
          <StatCard label="Products" value={inventory.data.totals.sku_count} />
        </div>
      )}

      <Tabs
        tabs={[
          { id: 'valuation', label: 'Valuation' },
          { id: 'movements', label: 'Stock movements' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'valuation' ? (
        <>
          <Card>
            <label className="flex items-center gap-2 text-sm text-brand-charcoal">
              <input
                type="checkbox" checked={onlyAttention}
                onChange={(e) => setOnlyAttention(e.target.checked)}
                className="h-4 w-4 rounded border-brand-line accent-[#D1809A]"
              />
              Only show products needing attention (low, out of stock, or expiring)
            </label>
          </Card>

          {inventory.loading ? (
            <LoadingBlock rows={6} />
          ) : inventory.error ? (
            <ErrorState message={inventory.error} onRetry={inventory.reload} />
          ) : (inventory.data?.items.length ?? 0) === 0 ? (
            <Card><EmptyState title="Nothing to show" description="No products match this filter." /></Card>
          ) : (
            <Card padded={false}>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th className="text-right">On hand</th>
                      <th className="text-right">Avg. cost</th>
                      <th className="text-right">Stock value</th>
                      <th className="text-right">Selling price</th>
                      <th className="text-right">Unit margin</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.data!.items.map((p) => (
                      <tr key={p.product_code}>
                        <td>
                          <p className="font-medium text-brand-ink">{p.name}</p>
                          <p className="text-xs text-brand-muted">
                            {p.product_code} · {p.supplier_name || 'no supplier'}
                          </p>
                        </td>
                        <td className="text-right num">{p.quantity_on_hand}</td>
                        <td className="text-right num">{money(p.avg_unit_cost)}</td>
                        <td className="text-right num font-medium">{money(p.stock_value)}</td>
                        <td className="text-right num">{money(p.selling_price)}</td>
                        <td className={`text-right num ${p.unit_margin != null && p.unit_margin < 0 ? 'text-state-red' : ''}`}>
                          {p.unit_margin != null ? money(p.unit_margin) : '—'}
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {p.availability === 'OUT' && <span className="chip-red">Out</span>}
                            {p.availability === 'LOW' && <span className="chip-amber">Low</span>}
                            {p.expiry_status === 'EXPIRED' && <span className="chip-red">Expired</span>}
                            {p.expiry_status === 'EXPIRING_SOON' && <span className="chip-amber">Expires soon</span>}
                            {p.availability === 'AVAILABLE' && p.expiry_status === 'OK' && (
                              <span className="chip-green">OK</span>
                            )}
                          </div>
                        </td>
                        <td className="text-right">
                          <AdjustButton productId={p.product_id} name={p.name} onDone={inventory.reload} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      ) : (
        <MovementsTab />
      )}
    </div>
  );
}

/** Stock adjustments — always owner-only, always needing a reason (§53). */
function AdjustButton({ productId, name, onDone }: { productId: string; name: string; onDone: () => void }) {
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<MovementType>('ADJUSTMENT');
  const [quantity, setQuantity] = useState<number | ''>('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (quantity === '' || quantity === 0) {
      push({ tone: 'error', title: 'Enter a non-zero quantity' });
      return;
    }
    if (reason.trim().length < 3) {
      push({ tone: 'error', title: 'A reason is required', body: 'It is stored in the audit log.' });
      return;
    }
    setBusy(true);
    try {
      const result = await adjustStock({
        productId, quantity: Number(quantity),
        movementType: type, reason: reason.trim(),
      });
      push({
        tone: 'success', title: 'Stock adjusted',
        body: `${name} now shows ${result.quantity_on_hand} units.`,
      });
      setOpen(false);
      setQuantity(''); setReason('');
      onDone();
    } catch (err) {
      push({ tone: 'error', title: 'Adjustment failed', body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Adjust</Button>
      <Modal
        open={open} onClose={() => setOpen(false)} title={`Adjust ${name}`} size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={submit} loading={busy}>Record adjustment</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="label">Movement type</label>
            <Select value={type} onChange={(e) => setType(e.target.value as MovementType)}>
              <option value="ADJUSTMENT">Correction / count difference</option>
              <option value="DAMAGE">Damaged</option>
              <option value="EXPIRED">Expired</option>
            </Select>
          </div>
          <div>
            <label className="label">Quantity change</label>
            <input
              type="number" value={quantity}
              onChange={(e) => setQuantity(e.target.value === '' ? '' : Number(e.target.value))}
              className="input num" placeholder="e.g. -2 to remove, 3 to add"
            />
            <p className="text-xs text-brand-muted mt-1">Use a negative number to remove stock.</p>
          </div>
          <div>
            <label className="label">Reason <span className="text-state-red">*</span></label>
            <textarea
              value={reason} onChange={(e) => setReason(e.target.value)}
              className="input min-h-[70px] py-2" placeholder="e.g. Two units broken in transit"
            />
          </div>
          {type === 'EXPIRED' && (
            <p className="text-xs text-brand-muted">
              Expired stock is written off against the batches that hold it, so batch quantities stay
              in step with the ledger.
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}

function MovementsTab() {
  const [movementType, setMovementType] = useState<MovementType | null>(null);
  const [days] = useState(30);
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  const movements = useAsync(
    () => fetchMovements({ from, movementType }),
    [movementType],
  );

  const summary = movements.data?.summary ?? {};

  return (
    <div className="space-y-4">
      <Card>
        <SectionHeader
          title="Movement summary"
          subtitle={`Last ${days} days · expected stock = beginning + restock + returns − sales ± adjustments`}
        />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {['RESTOCK', 'SALE', 'RETURN', 'ADJUSTMENT', 'DAMAGE', 'EXPIRED', 'VOID_REVERSAL', 'BEGINNING_STOCK'].map((t) => (
            <button
              key={t}
              onClick={() => setMovementType(movementType === t ? null : (t as MovementType))}
              className={`rounded-xl border p-2.5 text-left transition
                ${movementType === t ? 'border-brand-rose bg-brand-blush' : 'border-brand-line bg-white'}`}
            >
              <p className="text-xs text-brand-muted">{titleCase(t)}</p>
              <p className="text-sm font-semibold num text-brand-ink">{summary[t] ?? 0}</p>
            </button>
          ))}
        </div>
      </Card>

      {movements.loading ? (
        <LoadingBlock rows={6} />
      ) : movements.error ? (
        <ErrorState message={movements.error} onRetry={movements.reload} />
      ) : (movements.data?.items.length ?? 0) === 0 ? (
        <Card><EmptyState title="No movements" description="No stock moved in this period." /></Card>
      ) : (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Product</th>
                  <th>Type</th>
                  <th className="text-right">Qty</th>
                  <th>Reason</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {movements.data!.items.map((m, i) => (
                  <tr key={`${m.reference_id}-${i}`}>
                    <td className="whitespace-nowrap text-brand-muted text-xs">{fmtDate(m.created_at)}</td>
                    <td>
                      <p className="text-brand-ink">{m.product_name}</p>
                      <p className="text-xs text-brand-muted">{m.product_code}</p>
                    </td>
                    <td><span className="chip-slate">{titleCase(m.movement_type)}</span></td>
                    <td className={`text-right num font-medium ${m.quantity < 0 ? 'text-state-red' : 'text-state-green'}`}>
                      {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                    </td>
                    <td className="text-brand-charcoal text-sm max-w-xs truncate">{m.reason || '—'}</td>
                    <td className="text-brand-muted text-sm">{m.created_by_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
