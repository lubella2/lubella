import { Link } from 'react-router-dom';
import { useCallback, useState } from 'react';
import { LogoHero } from '../../components/Logo';
import { ProductCard, ProductGrid, ProductCardSkeleton } from '../../components/ProductCard';
import { Button, Card, EmptyState, ErrorState, SectionHeader } from '../../components/ui';
import {
  buildOrderMessage,
  fetchCatalog,
  fetchFilters,
  fetchPublicSettings,
} from '../../api/portal';
import { useAsync } from '../../lib/hooks';
import type { PublicProduct } from '../../types';
import { useToast } from '../../components/ui';

/** Landing page: the shop window (§46). */
export default function CustomerHome() {
  const [settings, setSettings] = useState<Record<string, string | number | boolean | null>>({});
  const { push } = useToast();

  const featured = useAsync(() => fetchCatalog({ featured: true, limit: 8 }), []);
  const latest = useAsync(() => fetchCatalog({ limit: 8 }), []);

  useAsync(async () => {
    const s = await fetchPublicSettings();
    setSettings(s as Record<string, string | number | boolean | null>);
    return s;
  }, []);

  const quickOrder = useCallback(async (product: PublicProduct) => {
    try {
      const result = await buildOrderMessage(
        [{ product_id: product.id, quantity: 1 }],
      );
      if (result.links.whatsapp_url) {
        window.open(result.links.whatsapp_url, '_blank', 'noopener');
      } else {
        push({ tone: 'error', title: 'WhatsApp is not configured yet',
               body: 'Please add the shop WhatsApp number in Settings.' });
      }
    } catch (err) {
      push({ tone: 'error', title: 'Could not prepare the order', body: (err as Error).message });
    }
  }, [push]);

  const items = featured.data?.items ?? [];
  const fresh = latest.data?.items ?? [];

  return (
    <div>
      {/* hero */}
      <section className="bg-gradient-to-b from-white to-brand-blush px-4 pt-7 pb-6">
        <div className="max-w-5xl mx-auto">
          <LogoHero />
          <p className="text-center text-brand-charcoal mt-4 max-w-md mx-auto text-sm sm:text-base">
            Cosmetics and accessories, chosen with care. Browse the catalogue and order on
            WhatsApp — no account needed.
          </p>
          <div className="flex flex-col sm:flex-row gap-2.5 justify-center mt-5">
            <Link to="/products"><Button className="w-full sm:w-auto">Browse products</Button></Link>
            <Link to="/request">
              <Button variant="secondary" className="w-full sm:w-auto">Request a product</Button>
            </Link>
          </div>
          {settings.support_hours && (
            <p className="text-center text-xs text-brand-muted mt-3">
              Open {String(settings.support_hours)}
            </p>
          )}
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-4 pb-8">
        {/* categories shortcut */}
        <section className="mt-2 mb-7">
          <SectionHeader
            title="Shop by category"
            action={<Link to="/categories" className="text-sm text-brand-deep font-medium">See all</Link>}
          />
          <CategoryStrip />
        </section>

        {/* featured */}
        <section className="mb-8">
          <SectionHeader
            title="Featured"
            subtitle="Pieces the shop is loving right now"
            action={<Link to="/products" className="text-sm text-brand-deep font-medium">All products</Link>}
          />
          {featured.loading ? (
            <ProductGrid>{Array.from({ length: 4 }).map((_, i) => <ProductCardSkeleton key={i} />)}</ProductGrid>
          ) : featured.error ? (
            <ErrorState message={featured.error} onRetry={featured.reload} />
          ) : items.length === 0 ? (
            <Card><EmptyState title="Nothing featured yet" description="The owner can mark products as featured in Products." /></Card>
          ) : (
            <ProductGrid>
              {items.map((p) => <ProductCard key={p.id} product={p} onOrder={quickOrder} />)}
            </ProductGrid>
          )}
        </section>

        {/* new arrivals */}
        <section>
          <SectionHeader title="New arrivals" subtitle="Just added to the shop" />
          {latest.loading ? (
            <ProductGrid>{Array.from({ length: 4 }).map((_, i) => <ProductCardSkeleton key={i} />)}</ProductGrid>
          ) : (
            <ProductGrid>
              {fresh.map((p) => <ProductCard key={p.id} product={p} onOrder={quickOrder} />)}
            </ProductGrid>
          )}
        </section>

        {/* help */}
        <section className="mt-9">
          <Card className="bg-white">
            <div className="flex flex-col sm:flex-row items-start gap-4">
              <div className="text-3xl" aria-hidden="true">💬</div>
              <div className="flex-1">
                <h3 className="font-semibold text-brand-ink">Not sure what to choose?</h3>
                <p className="text-sm text-brand-muted mt-1">
                  Send the shop a message on WhatsApp or Telegram, or ask for a product we do not
                  stock yet — we will let you know when it arrives.
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  <Link to="/contact"><Button variant="secondary" size="sm">Contact the shop</Button></Link>
                  <Link to="/request"><Button variant="ghost" size="sm">Request a product</Button></Link>
                </div>
              </div>
            </div>
          </Card>
        </section>
      </div>
    </div>
  );
}

function CategoryStrip() {
  const { data, loading } = useAsync(() => fetchFilters(), []);
  const categories = (data?.categories ?? []).slice(0, 8);

  if (loading) {
    return (
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-9 w-28 shrink-0 rounded-full" />)}
      </div>
    );
  }
  if (categories.length === 0) return null;

  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
      {categories.map((c) => (
        <Link
          key={c.id}
          to={`/products?category=${c.id}`}
          className="shrink-0 rounded-full bg-white border border-brand-line px-4 h-9
                     flex items-center text-sm font-medium text-brand-charcoal hover:bg-brand-soft"
        >
          {c.name}
          {typeof c.product_count === 'number' && (
            <span className="ml-1.5 text-xs text-brand-muted">{c.product_count}</span>
          )}
        </Link>
      ))}
    </div>
  );
}
