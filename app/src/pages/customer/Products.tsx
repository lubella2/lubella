import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ProductCard, ProductGrid, ProductCardSkeleton } from '../../components/ProductCard';
import { Button, Card, EmptyState, ErrorState, FilterChips, Input } from '../../components/ui';
import { fetchCatalog, fetchFilters } from '../../api/portal';
import { useAsync, useDebounced } from '../../lib/hooks';
import type { PublicProduct } from '../../types';

/** Catalogue with search, category and brand filtering (§6). */
export default function CustomerProducts() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') || '');
  const [categoryId, setCategoryId] = useState<string | null>(params.get('category'));
  const [brand, setBrand] = useState<string | null>(params.get('brand'));
  const [onlyAvailable, setOnlyAvailable] = useState(false);

  const debouncedSearch = useDebounced(search, 320);
  const filters = useAsync(() => fetchFilters(), []);

  const catalog = useAsync(
    () => fetchCatalog({
      search: debouncedSearch,
      categoryId,
      brand,
      limit: 60,
    }),
    [debouncedSearch, categoryId, brand],
  );

  // Keep the URL shareable so a customer can send a filtered link.
  useEffect(() => {
    const next = new URLSearchParams();
    if (debouncedSearch) next.set('q', debouncedSearch);
    if (categoryId) next.set('category', categoryId);
    if (brand) next.set('brand', brand);
    setParams(next, { replace: true });
  }, [debouncedSearch, categoryId, brand, setParams]);

  const items = useMemo(() => {
    const list = catalog.data?.items ?? [];
    // "Available only" is a client-side view of an already-fetched page; the
    // availability band itself comes from the database.
    return onlyAvailable ? list.filter((p) => p.availability !== 'OUT') : list;
  }, [catalog.data, onlyAvailable]);

  const addToOrder = useCallback((product: PublicProduct) => {
    const existing = readCart();
    const line = existing.find((l) => l.product_id === product.id);
    const next = line
      ? existing.map((l) => (l.product_id === product.id ? { ...l, quantity: l.quantity + 1 } : l))
      : [...existing, {
          product_id: product.id, name: product.name, selling_price: product.selling_price,
          quantity: 1, image_url: product.image_url, availability: product.availability,
        }];
    localStorage.setItem('lubella.customer-cart', JSON.stringify(next));
    window.dispatchEvent(new Event('lubella-cart-changed'));
  }, []);

  const activeFilters = (categoryId ? 1 : 0) + (brand ? 1 : 0) + (onlyAvailable ? 1 : 0);

  return (
    <div className="max-w-5xl mx-auto px-4 py-5">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-brand-ink">Products</h1>
        <p className="text-sm text-brand-muted mt-0.5">
          {catalog.loading ? 'Loading the catalogue…'
            : `${catalog.data?.count ?? 0} product${(catalog.data?.count ?? 0) === 1 ? '' : 's'} available`}
        </p>
      </div>

      {/* search */}
      <div className="relative mb-3">
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-muted" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" strokeLinecap="round" />
          </svg>
        </span>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search lipstick, perfume, earrings…"
          className="pl-11"
          aria-label="Search products"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-lg
                       hover:bg-brand-soft flex items-center justify-center text-brand-muted"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* category chips */}
      <div className="mb-2">
        <FilterChips
          allLabel="All categories"
          value={categoryId}
          onChange={setCategoryId}
          options={(filters.data?.categories ?? []).map((c) => ({ value: c.id, label: c.name }))}
        />
      </div>

      {/* brand chips (only when there is more than one) */}
      {(filters.data?.brands?.length ?? 0) > 1 && (
        <div className="mb-2">
          <FilterChips
            allLabel="All brands"
            value={brand}
            onChange={setBrand}
            options={(filters.data?.brands ?? []).map((b) => ({ value: b, label: b }))}
          />
        </div>
      )}

      <div className="flex items-center justify-between gap-3 mb-4">
        <label className="flex items-center gap-2 text-sm text-brand-charcoal">
          <input
            type="checkbox"
            checked={onlyAvailable}
            onChange={(e) => setOnlyAvailable(e.target.checked)}
            className="h-4 w-4 rounded border-brand-line accent-[#D1809A]"
          />
          Hide out of stock
        </label>
        {activeFilters > 0 && (
          <Button
            size="sm" variant="ghost"
            onClick={() => { setCategoryId(null); setBrand(null); setOnlyAvailable(false); }}
          >
            Clear filters ({activeFilters})
          </Button>
        )}
      </div>

      {catalog.loading ? (
        <ProductGrid>{Array.from({ length: 8 }).map((_, i) => <ProductCardSkeleton key={i} />)}</ProductGrid>
      ) : catalog.error ? (
        <ErrorState message={catalog.error} onRetry={catalog.reload} />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<span className="text-3xl">🔍</span>}
            title="No products matched"
            description={search
              ? `We could not find anything for “${search}”. You can ask us to get it in.`
              : 'Try a different category or clear the filters.'}
            action={
              <Link to={`/request${search ? `?product=${encodeURIComponent(search)}` : ''}`}>
                <Button variant="secondary">Request this product</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          <ProductGrid>
            {items.map((p) => <ProductCard key={p.id} product={p} onOrder={addToOrder} />)}
          </ProductGrid>
          <CartBar />
        </>
      )}
    </div>
  );
}

function readCart(): Array<{ product_id: string; quantity: number; name: string; selling_price: number; image_url?: string | null; availability?: string }> {
  try {
    const raw = localStorage.getItem('lubella.customer-cart');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Sticky bar showing what has been added, with a jump to the order screen.
 * Adding to the basket does not reserve stock — it only builds the message.
 */
export function CartBar() {
  const [count, setCount] = useState(() => readCart().reduce((s, l) => s + l.quantity, 0));

  useEffect(() => {
    const update = () => setCount(readCart().reduce((s, l) => s + l.quantity, 0));
    window.addEventListener('lubella-cart-changed', update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener('lubella-cart-changed', update);
      window.removeEventListener('storage', update);
    };
  }, []);

  if (count === 0) return null;
  return (
    <div className="fixed bottom-16 md:bottom-4 inset-x-0 z-20 px-4 pointer-events-none">
      <div className="max-w-5xl mx-auto flex justify-center">
        <Link to="/order" className="pointer-events-auto">
          <Button className="shadow-lift">
            View order · {count} item{count === 1 ? '' : 's'}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Button>
        </Link>
      </div>
    </div>
  );
}
