import { useMemo, useState } from 'react';
import { availabilityChip, money } from '../../lib/format';
import { Card, EmptyState, ErrorState, FilterChips, Input, StatCard } from '../../components/ui';
import { useAsync, useDebounced } from '../../lib/hooks';
import { select } from '../../lib/supabase';
import type { StaffProduct } from '../../types';

/**
 * Staff product list.
 *
 * Shows selling prices and real stock quantities — both are needed to serve a
 * customer at the counter. There is no purchase-cost column because the view
 * this reads from does not have one (§4).
 */
export default function StaffProducts() {
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [onlyAttention, setOnlyAttention] = useState(false);
  const debounced = useDebounced(search, 250);

  const products = useAsync(() => select<StaffProduct>('v_staff_products', { order: 'name.asc' }), []);
  const categories = useAsync(
    () => select<{ id: string; name: string }>('categories', { order: 'sort_order.asc' }),
    [],
  );

  const stats = useMemo(() => {
    const list = products.data ?? [];
    return {
      total: list.length,
      available: list.filter((p) => !p.is_out_of_stock && !p.is_low_stock).length,
      low: list.filter((p) => p.is_low_stock).length,
      out: list.filter((p) => p.is_out_of_stock).length,
    };
  }, [products.data]);

  const filtered = useMemo(() => {
    const list = products.data ?? [];
    const term = debounced.trim().toLowerCase();
    return list.filter((p) => {
      if (categoryId && p.category_id !== categoryId) return false;
      if (onlyAttention && !p.is_low_stock && !p.is_out_of_stock) return false;
      if (!term) return true;
      return p.name.toLowerCase().includes(term)
        || (p.brand || '').toLowerCase().includes(term)
        || p.product_code.toLowerCase().includes(term);
    });
  }, [products.data, debounced, categoryId, onlyAttention]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-brand-ink">Products</h1>
        <p className="text-sm text-brand-muted">Selling prices and what is on the shelf.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Products" value={stats.total} />
        <StatCard label="Available" value={stats.available} tone="good" />
        <StatCard label="Low stock" value={stats.low} tone="warn" />
        <StatCard label="Out of stock" value={stats.out} tone={stats.out > 0 ? 'bad' : 'default'} />
      </div>

      <Card>
        <div className="flex flex-col sm:flex-row gap-3">
          <Input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products" className="sm:max-w-xs"
          />
          <div className="flex-1">
            <FilterChips
              allLabel="All categories" value={categoryId} onChange={setCategoryId}
              options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-brand-charcoal shrink-0">
            <input
              type="checkbox" checked={onlyAttention}
              onChange={(e) => setOnlyAttention(e.target.checked)}
              className="h-4 w-4 rounded border-brand-line accent-[#D1809A]"
            />
            Needs attention
          </label>
        </div>
      </Card>

      {products.loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-44" />)}
        </div>
      ) : products.error ? (
        <ErrorState message={products.error} onRetry={products.reload} />
      ) : filtered.length === 0 ? (
        <Card><EmptyState title="No products matched" description="Try a different search or category." /></Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map((p) => {
            const chip = availabilityChip(p.availability);
            return (
              <Card key={p.id} padded={false} className="overflow-hidden">
                <div className="aspect-square bg-brand-soft overflow-hidden">
                  {p.image_url
                    ? <img src={p.image_url} alt={p.name} loading="lazy" className="w-full h-full object-cover" />
                    : <div className="w-full h-full" />}
                </div>
                <div className="p-3">
                  <p className="text-sm font-medium text-brand-ink leading-snug line-clamp-2 min-h-[2.4rem]">
                    {p.name}
                  </p>
                  <p className="text-xs text-brand-muted mt-0.5">{p.category_name || 'Uncategorised'}</p>
                  <p className="font-semibold text-brand-ink num mt-1.5">{money(p.selling_price)} Birr</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className={chip.className}><span aria-hidden="true">{chip.dot}</span> {chip.label}</span>
                    <span className="text-sm num text-brand-charcoal">
                      {p.quantity_on_hand}
                      <span className="text-xs text-brand-muted"> units</span>
                    </span>
                  </div>
                  {p.expiry_status === 'EXPIRED' && (
                    <p className="text-xs text-state-red mt-1.5 font-medium">Expired — cannot be sold</p>
                  )}
                  {p.expiry_status === 'EXPIRING_SOON' && (
                    <p className="text-xs text-[#8a6318] mt-1.5">Expires soon</p>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
