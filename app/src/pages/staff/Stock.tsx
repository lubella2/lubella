import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtDate, money, titleCase } from '../../lib/format';
import {
  Button, Card, EmptyState, ErrorState, FilterChips, Input, LoadingBlock, SectionHeader,
  StatCard, Tabs,
} from '../../components/ui';
import { fetchMovements } from '../../api/inventory';
import { useAsync, useDebounced } from '../../lib/hooks';
import { select } from '../../lib/supabase';
import type { StaffProduct } from '../../types';

/**
 * Staff stock view.
 *
 * Answers the two questions asked at the counter: "do we have one?" and "where
 * did it go?". Quantities are real, but purchase cost is not part of this screen
 * or the view behind it — the staff view carries no cost column at all (§4).
 */
export default function StaffStock() {
  const [tab, setTab] = useState<'onhand' | 'movements'>('onhand');
  const [search, setSearch] = useState('');
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [expiryOnly, setExpiryOnly] = useState(false);
  const debounced = useDebounced(search, 250);

  const products = useAsync(() => select<StaffProduct>('v_staff_products', { order: 'name.asc' }), []);

  const rows = useMemo(() => {
    const list = products.data ?? [];
    const term = debounced.trim().toLowerCase();
    return list.filter((p) => {
      if (onlyAttention && !p.is_low_stock && !p.is_out_of_stock) return false;
      if (expiryOnly && p.expiry_status !== 'EXPIRED' && p.expiry_status !== 'EXPIRING_SOON') return false;
      if (!term) return true;
      return p.name.toLowerCase().includes(term)
        || p.product_code.toLowerCase().includes(term)
        || (p.brand || '').toLowerCase().includes(term);
    });
  }, [products.data, debounced, onlyAttention, expiryOnly]);

  const stats = useMemo(() => {
    const list = products.data ?? [];
    return {
      units: list.reduce((s, p) => s + p.quantity_on_hand, 0),
      low: list.filter((p) => p.is_low_stock).length,
      out: list.filter((p) => p.is_out_of_stock).length,
      expiring: list.filter((p) => p.expiry_status === 'EXPIRING_SOON').length,
      expired: list.filter((p) => p.expiry_status === 'EXPIRED').length,
    };
  }, [products.data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-ink">Stock</h1>
          <p className="text-sm text-brand-muted">
            Quantities on the shelf, and the movements that explain them.
          </p>
        </div>
        <Link to="/staff/restock"><Button variant="secondary">Receive a shipment</Button></Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label="Units on hand" value={stats.units} />
        <StatCard label="Available" value={(products.data?.length ?? 0) - stats.low - stats.out} tone="good" />
        <StatCard label="Low" value={stats.low} tone={stats.low ? 'warn' : 'default'} />
        <StatCard label="Out" value={stats.out} tone={stats.out ? 'bad' : 'default'} />
        <StatCard label="Expiring / expired" value={`${stats.expiring} / ${stats.expired}`} tone={stats.expired ? 'bad' : stats.expiring ? 'warn' : 'default'} />
      </div>

      <Tabs
        tabs={[
          { id: 'onhand', label: 'On hand', count: rows.length },
          { id: 'movements', label: 'Movements' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'onhand' ? (
        <>
          <Card>
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
              <Input
                value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, brand or code" className="sm:max-w-xs"
              />
              <label className="flex items-center gap-2 text-sm text-brand-charcoal shrink-0">
                <input
                  type="checkbox" checked={onlyAttention}
                  onChange={(e) => setOnlyAttention(e.target.checked)}
                  className="h-5 w-5 rounded border-brand-line accent-[#D1809A]"
                />
                Needs attention
              </label>
              <label className="flex items-center gap-2 text-sm text-brand-charcoal shrink-0">
                <input
                  type="checkbox" checked={expiryOnly}
                  onChange={(e) => setExpiryOnly(e.target.checked)}
                  className="h-5 w-5 rounded border-brand-line accent-[#D1809A]"
                />
                Expiry issues
              </label>
            </div>
          </Card>

          {products.loading ? <LoadingBlock rows={8} /> :
           products.error ? <ErrorState message={products.error} onRetry={products.reload} /> :
           rows.length === 0 ? (
            <Card><EmptyState title="Nothing matched" description="Try a different search or clear the filters." /></Card>
          ) : (
            <Card padded={false}>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th className="text-right">On hand</th>
                      <th className="text-right">Minimum</th>
                      <th className="text-right">Selling price</th>
                      <th>Availability</th>
                      <th>Expiry</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <p className="text-brand-ink">{p.name}</p>
                          <p className="text-xs text-brand-muted num">
                            {p.product_code}{p.brand ? ` · ${p.brand}` : ''}
                          </p>
                        </td>
                        <td className={`text-right num font-medium ${p.is_out_of_stock ? 'text-state-red' : p.is_low_stock ? 'text-[#8a6318]' : ''}`}>
                          {p.quantity_on_hand}
                        </td>
                        <td className="text-right num text-brand-muted">{p.minimum_stock}</td>
                        <td className="text-right num">{money(p.selling_price)}</td>
                        <td>
                          {p.is_out_of_stock ? <span className="chip-red">Out of stock</span>
                            : p.is_low_stock ? <span className="chip-amber">Low stock</span>
                            : <span className="chip-green">Available</span>}
                        </td>
                        <td>
                          {p.expiry_status === 'EXPIRED' ? (
                            <span className="chip-red">Expired {fmtDate(p.expiry_date)}</span>
                          ) : p.expiry_status === 'EXPIRING_SOON' ? (
                            <span className="chip-amber">Expires {fmtDate(p.expiry_date)}</span>
                          ) : p.expiry_date ? (
                            <span className="text-xs text-brand-muted">{fmtDate(p.expiry_date)}</span>
                          ) : (
                            <span className="text-xs text-brand-muted">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {stats.expired > 0 && (
            <Card className="border-state-red/30 bg-state-red/5">
              <p className="text-sm text-brand-charcoal">
                <strong className="text-state-red">Expired stock cannot be sold.</strong> The till refuses
                it. Tell the owner so it can be written off properly — a stock adjustment keeps the batch
                records in step.
              </p>
            </Card>
          )}
        </>
      ) : (
        <MovementsTab />
      )}
    </div>
  );
}

function MovementsTab() {
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const [type, setType] = useState<string | null>(null);

  const from = useMemo(
    () => new Date(Date.now() - Number(days) * 86_400_000).toISOString().slice(0, 10),
    [days],
  );

  const movements = useAsync(
    () => fetchMovements({ from, movementType: (type as never) ?? null }),
    [from, type],
  );
  const summary = movements.data?.summary ?? {};

  const items = movements.data?.items ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <SectionHeader
          title="What moved"
          subtitle="Sales take stock out; returns and receivings put it back. Adjustments only ever come from the owner."
        />
        <div className="flex flex-wrap gap-2 mb-3">
          <FilterChips
            allLabel="All types" value={type} onChange={setType}
            options={[
              { value: 'SALE', label: 'Sold' },
              { value: 'RESTOCK', label: 'Received' },
              { value: 'RETURN', label: 'Returned' },
              { value: 'ADJUSTMENT', label: 'Adjusted' },
              { value: 'DAMAGE', label: 'Damaged' },
              { value: 'EXPIRED', label: 'Expired' },
            ]}
          />
        </div>
        <div className="flex gap-2">
          {(['7', '30', '90'] as const).map((d) => (
            <Button
              key={d} size="sm"
              variant={days === d ? 'primary' : 'secondary'}
              onClick={() => setDays(d)}
            >
              {d} days
            </Button>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {['SALE', 'RESTOCK', 'RETURN', 'ADJUSTMENT'].map((t) => (
          <StatCard
            key={t}
            label={titleCase(t)}
            value={summary[t] ?? 0}
            sub="units in this period"
            tone={t === 'SALE' ? 'brand' : t === 'RETURN' || t === 'RESTOCK' ? 'good' : 'default'}
          />
        ))}
      </div>

      {movements.loading ? <LoadingBlock rows={6} /> :
       movements.error ? <ErrorState message={movements.error} onRetry={movements.reload} /> :
       items.length === 0 ? (
        <Card><EmptyState title="No movements in this period" /></Card>
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
                  <th>Reason / reference</th>
                </tr>
              </thead>
              <tbody>
                {items.map((m, i) => (
                  <tr key={`${m.reference_id}-${i}`}>
                    <td className="text-xs text-brand-muted whitespace-nowrap">{fmtDate(m.created_at)}</td>
                    <td>
                      <p className="text-brand-ink">{m.product_name}</p>
                      <p className="text-xs text-brand-muted num">{m.product_code}</p>
                    </td>
                    <td><span className="chip-slate">{titleCase(m.movement_type)}</span></td>
                    <td className={`text-right num font-medium ${m.quantity < 0 ? 'text-state-red' : 'text-state-green'}`}>
                      {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                    </td>
                    <td className="text-xs text-brand-muted max-w-[18rem] truncate">{m.reason || '—'}</td>
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
