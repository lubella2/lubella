import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { availabilityChip, money } from '../../lib/format';
import { useAsync } from '../../lib/hooks';
import { buildOrderMessage, fetchCatalog } from '../../api/portal';
import { Button, Card, EmptyState, ErrorState, LoadingBlock, SectionHeader, useToast } from '../../components/ui';
import { ProductCard, ProductGrid } from '../../components/ProductCard';
import type { PublicProduct } from '../../types';

/** Product detail with the ordering controls (§6, §8). */
export default function CustomerProductDetail() {
  const { productId } = useParams<{ productId: string }>();
  const navigate = useNavigate();
  const { push } = useToast();
  const [quantity, setQuantity] = useState(1);
  const [preparing, setPreparing] = useState<'whatsapp' | 'telegram' | null>(null);

  const product = useAsync(async () => {
    const result = await fetchCatalog({ limit: 200 });
    return result.items.find((p) => p.id === productId) ?? null;
  }, [productId]);

  const related = useAsync(async () => {
    const p = product.data;
    if (!p?.category_id) return { items: [] as PublicProduct[] };
    return fetchCatalog({ categoryId: p.category_id, limit: 8 });
  }, [product.data?.category_id], { enabled: Boolean(product.data?.category_id) });

  useEffect(() => { setQuantity(1); }, [productId]);

  const order = async (channel: 'whatsapp' | 'telegram') => {
    if (!product.data) return;
    setPreparing(channel);
    try {
      const result = await buildOrderMessage([{ product_id: product.data.id, quantity }]);
      const url = channel === 'whatsapp' ? result.links.whatsapp_url : result.links.telegram_url;
      if (!url) {
        push({
          tone: 'error',
          title: `${channel === 'whatsapp' ? 'WhatsApp' : 'Telegram'} is not set up yet`,
          body: 'Please ask the shop to add its contact details in Settings.',
        });
        return;
      }
      // The message is generated on the server, so the shop number is never
      // hard-coded here and the wording is identical everywhere (§8, §14).
      window.open(url, '_blank', 'noopener');
      push({ tone: 'success', title: 'Message ready', body: 'Send it and we will confirm availability.' });
    } catch (err) {
      push({ tone: 'error', title: 'Could not prepare the order', body: (err as Error).message });
    } finally {
      setPreparing(null);
    }
  };

  const addToBasket = () => {
    if (!product.data) return;
    try {
      const raw = localStorage.getItem('lubella.customer-cart');
      const cart: Array<{ product_id: string; quantity: number; name: string; selling_price: number; image_url?: string | null; availability?: string }> =
        raw ? JSON.parse(raw) : [];
      const line = cart.find((l) => l.product_id === product.data!.id);
      const next = line
        ? cart.map((l) => (l.product_id === product.data!.id ? { ...l, quantity: l.quantity + quantity } : l))
        : [...cart, {
            product_id: product.data.id, name: product.data.name,
            selling_price: product.data.selling_price, quantity,
            image_url: product.data.image_url, availability: product.data.availability,
          }];
      localStorage.setItem('lubella.customer-cart', JSON.stringify(next));
      window.dispatchEvent(new Event('lubella-cart-changed'));
      push({ tone: 'success', title: 'Added to your order', body: 'Open the order screen to send it.' });
    } catch {
      push({ tone: 'error', title: 'Could not save that', body: 'Please try again.' });
    }
  };

  if (product.loading) {
    return <div className="max-w-5xl mx-auto px-4 py-5"><LoadingBlock rows={4} /></div>;
  }
  if (product.error) {
    return <div className="max-w-5xl mx-auto px-4 py-5"><ErrorState message={product.error} onRetry={product.reload} /></div>;
  }
  if (!product.data) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-5">
        <Card>
          <EmptyState
            title="This product is no longer listed"
            description="It may have been removed from the catalogue."
            action={<Button onClick={() => navigate('/products')}>Back to products</Button>}
          />
        </Card>
      </div>
    );
  }

  const p = product.data;
  const chip = availabilityChip(p.availability);
  const outOfStock = p.availability === 'OUT';
  const maxQuantity = p.availability === 'LOW' ? 5 : 20;

  return (
    <div className="max-w-5xl mx-auto px-4 py-5">
      <button
        onClick={() => navigate(-1)}
        className="text-sm text-brand-muted hover:text-brand-deep mb-3 flex items-center gap-1"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back
      </button>

      <div className="grid md:grid-cols-2 gap-5">
        <Card padded={false} className="overflow-hidden">
          <div className="aspect-square bg-brand-soft">
            {p.image_url ? (
              <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-brand-line">
                <svg width="80" height="80" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2 3 7v10l9 5 9-5V7l-9-5Zm0 2.3 6.5 3.6L12 11.5 5.5 7.9 12 4.3Z" />
                </svg>
              </div>
            )}
          </div>
        </Card>

        <div>
          {p.category_name && (
            <Link
              to={`/products?category=${p.category_id}`}
              className="text-xs uppercase tracking-wide text-brand-muted hover:text-brand-deep"
            >
              {p.category_name}
            </Link>
          )}
          <h1 className="text-2xl font-semibold text-brand-ink mt-1 leading-tight">{p.name}</h1>
          {p.brand && <p className="text-sm text-brand-muted mt-1">{p.brand}</p>}

          <div className="mt-3 flex items-center gap-3">
            <p className="text-2xl font-semibold text-brand-ink num">
              {money(p.selling_price)} <span className="text-sm font-normal text-brand-muted">Birr</span>
            </p>
            <span className={chip.className}><span aria-hidden="true">{chip.dot}</span> {chip.label}</span>
          </div>

          {p.description && (
            <p className="text-sm text-brand-charcoal mt-3 leading-relaxed">{p.description}</p>
          )}

          {!outOfStock ? (
            <div className="mt-5">
              <label className="label" htmlFor="qty">Quantity</label>
              <div className="flex items-center gap-3">
                <div className="flex items-center rounded-xl border border-brand-line bg-white">
                  <button
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    className="h-11 w-11 flex items-center justify-center text-brand-charcoal
                               disabled:opacity-40" disabled={quantity <= 1} aria-label="Decrease quantity"
                  >
                    −
                  </button>
                  <input
                    id="qty" type="number" min={1} max={maxQuantity} value={quantity}
                    onChange={(e) => setQuantity(Math.min(maxQuantity, Math.max(1, Number(e.target.value) || 1)))}
                    className="w-14 h-11 text-center num border-x border-brand-line outline-none"
                  />
                  <button
                    onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
                    className="h-11 w-11 flex items-center justify-center text-brand-charcoal"
                    aria-label="Increase quantity"
                  >
                    +
                  </button>
                </div>
                <p className="text-sm text-brand-muted">
                  Estimated {money(p.selling_price * quantity)} Birr
                </p>
              </div>

              <div className="mt-4 space-y-2.5">
                <Button
                  variant="whatsapp" className="w-full"
                  onClick={() => order('whatsapp')} loading={preparing === 'whatsapp'}
                  icon={<WhatsAppIcon />}
                >
                  Order via WhatsApp
                </Button>
                <Button
                  variant="telegram" className="w-full"
                  onClick={() => order('telegram')} loading={preparing === 'telegram'}
                  icon={<TelegramIcon />}
                >
                  Order via Telegram
                </Button>
                <Button variant="secondary" className="w-full" onClick={addToBasket}>
                  Add to my order
                </Button>
                <Link to="/order" className="block">
                  <Button variant="ghost" className="w-full">Go to my order</Button>
                </Link>
              </div>
              <p className="text-xs text-brand-muted mt-3">
                Availability is confirmed by the shop before any payment. Your message is sent
                from your own WhatsApp or Telegram.
              </p>
            </div>
          ) : (
            <div className="mt-5">
              <div className="rounded-xl bg-state-red/5 border border-state-red/20 p-3.5">
                <p className="font-medium text-state-red">Out of Stock</p>
                <p className="text-sm text-brand-charcoal mt-1">
                  This item is not available right now. Ask us to get it in and we will message you
                  when it arrives.
                </p>
              </div>
              <Link to={`/request?product=${encodeURIComponent(p.name)}&productId=${p.id}`} className="block mt-3">
                <Button variant="primary" className="w-full">Request this product</Button>
              </Link>
            </div>
          )}
        </div>
      </div>

      {(related.data?.items?.length ?? 0) > 0 && (
        <section className="mt-8">
          <SectionHeader title="More in this category" />
          <ProductGrid>
            {(related.data?.items ?? []).filter((r) => r.id !== p.id).slice(0, 4).map((r) => (
              <ProductCard key={r.id} product={r} />
            ))}
          </ProductGrid>
        </section>
      )}
    </div>
  );
}

function WhatsAppIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-8.5 15.3L2 22l4.8-1.4A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-1.7-.1-.4-.1-1-.3-1.7-.6-2.8-1.2-4.6-4-4.7-4.2-.1-.2-.9-1.2-.9-2.3s.6-1.6.8-1.9c.2-.2.4-.3.6-.3h.5c.2 0 .4 0 .5.4l.7 1.7c.1.2 0 .4-.1.5l-.3.4c-.1.1-.2.3-.1.4.2.3.7 1.1 1.5 1.8 1 .9 1.8 1.1 2 1.2.2.1.4.1.5-.1l.7-.8c.2-.2.3-.2.5-.1l1.6.8c.4.2.5.3.5.4 0 .1 0 .6-.1 1.1Z" />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21.9 4.3 2.9 11.6c-1 .4-1 1.7.1 2l4.6 1.4 1.7 5.3c.3.9 1.3 1 1.8.4l2.5-2.6 4.6 3.4c.7.5 1.6.1 1.8-.7l3-14.2c.2-1-.7-1.7-1.1-1.3ZM9.6 15.2l-.4 3.3-1.2-3.8 9.5-6-7.9 6.5Z" />
    </svg>
  );
}
