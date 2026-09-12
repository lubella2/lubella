import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { money } from '../../lib/format';
import { Button, Card, EmptyState, Field, Input, SectionHeader, useToast } from '../../components/ui';
import { buildOrderMessage, fetchPublicSettings } from '../../api/portal';
import type { ContactLinks } from '../../types';

const CART_KEY = 'lubella.customer-cart';

interface Line { product_id: string; name: string; selling_price: number; quantity: number; image_url?: string | null }

/**
 * The order basket (§9).
 *
 * Sending the request generates a message and opens WhatsApp or Telegram. It
 * does NOT reserve stock and does NOT deduct inventory — stock only ever leaves
 * through the POS sale. The total shown is explicitly an estimate.
 */
export default function CustomerOrder() {
  const { push } = useToast();
  const [lines, setLines] = useState<Line[]>(readCart);
  const [customerName, setCustomerName] = useState('');
  const [links, setLinks] = useState<ContactLinks | null>(null);
  const [estimate, setEstimate] = useState<{ total: number; note: string } | null>(null);
  const [busy, setBusy] = useState<'whatsapp' | 'telegram' | 'preview' | null>(null);
  const [shop, setShop] = useState<Record<string, string | number | boolean | null>>({});

  useEffect(() => {
    fetchPublicSettings().then((s) => setShop(s as Record<string, string | number | boolean | null>)).catch(() => {});
  }, []);

  useEffect(() => {
    const refresh = () => setLines(readCart());
    window.addEventListener('lubella-cart-changed', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('lubella-cart-changed', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const total = useMemo(() => lines.reduce((s, l) => s + l.selling_price * l.quantity, 0), [lines]);

  const write = (next: Line[]) => {
    setLines(next);
    localStorage.setItem(CART_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event('lubella-cart-changed'));
  };

  const setQuantity = (id: string, qty: number) =>
    write(qty <= 0 ? lines.filter((l) => l.product_id !== id) : lines.map((l) => (l.product_id === id ? { ...l, quantity: qty } : l)));

  const prepare = async (channel: 'whatsapp' | 'telegram') => {
    if (lines.length === 0) return;
    setBusy(channel);
    try {
      const result = await buildOrderMessage(
        lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity })),
        { name: customerName || undefined },
      );
      setLinks(result.links);
      setEstimate({ total: result.estimated_total, note: result.estimate_note });

      const url = channel === 'whatsapp' ? result.links.whatsapp_url : result.links.telegram_url;
      if (!url) {
        push({
          tone: 'error',
          title: channel === 'whatsapp' ? 'WhatsApp is not configured' : 'Telegram is not configured',
          body: 'Please ask the shop to set its contact details in Settings.',
        });
        return;
      }
      window.open(url, '_blank', 'noopener');
      push({ tone: 'success', title: 'Your message is ready to send' });
    } catch (err) {
      push({ tone: 'error', title: 'Could not prepare the order', body: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  if (lines.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <Card>
          <EmptyState
            icon={<span className="text-4xl">🛍️</span>}
            title="Your order is empty"
            description="Browse the catalogue and add the pieces you like. You can then send the whole list in one WhatsApp message."
            action={<Link to="/products"><Button>Browse products</Button></Link>}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-5">
      <h1 className="text-xl font-semibold text-brand-ink mb-1">Your order</h1>
      <p className="text-sm text-brand-muted mb-4">
        Nothing is reserved yet — we will confirm availability and the final price with you.
      </p>

      <Card padded={false} className="overflow-hidden mb-4">
        <ul className="divide-y divide-brand-line">
          {lines.map((l) => (
            <li key={l.product_id} className="p-3 flex gap-3 items-center">
              <div className="h-16 w-16 rounded-xl bg-brand-soft overflow-hidden shrink-0">
                {l.image_url
                  ? <img src={l.image_url} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full" />}
              </div>
              <div className="flex-1 min-w-0">
                <Link to={`/products/${l.product_id}`} className="font-medium text-brand-ink truncate block">
                  {l.name}
                </Link>
                <p className="text-sm text-brand-muted num mt-0.5">{money(l.selling_price)} Birr each</p>
                <div className="flex items-center gap-2 mt-2">
                  <div className="flex items-center rounded-lg border border-brand-line">
                    <button
                      className="h-9 w-9 flex items-center justify-center text-brand-charcoal"
                      onClick={() => setQuantity(l.product_id, l.quantity - 1)}
                      aria-label={`Reduce ${l.name}`}
                    >−</button>
                    <span className="w-9 text-center num text-sm">{l.quantity}</span>
                    <button
                      className="h-9 w-9 flex items-center justify-center text-brand-charcoal"
                      onClick={() => setQuantity(l.product_id, l.quantity + 1)}
                      aria-label={`Increase ${l.name}`}
                    >+</button>
                  </div>
                  <button
                    onClick={() => setQuantity(l.product_id, 0)}
                    className="text-xs text-state-red hover:underline px-2"
                  >
                    Remove
                  </button>
                </div>
              </div>
              <p className="font-semibold text-brand-ink num shrink-0">
                {money(l.selling_price * l.quantity)}
              </p>
            </li>
          ))}
        </ul>

        <div className="border-t border-brand-line p-4 bg-brand-soft/50">
          <div className="flex items-center justify-between">
            <span className="text-sm text-brand-charcoal">Estimated Total</span>
            <span className="text-lg font-semibold text-brand-ink num">{money(total)} Birr</span>
          </div>
          <p className="text-xs text-brand-muted mt-1.5">
            This total is an estimate only until LuBella confirms your order.
          </p>
        </div>
      </Card>

      <Card className="mb-4">
        <SectionHeader title="Your details" subtitle="Optional, so we can greet you by name" />
        <Field label="Name">
          <Input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="e.g. Sara"
            autoComplete="name"
          />
        </Field>
      </Card>

      <div className="space-y-2.5">
        <Button variant="whatsapp" className="w-full" loading={busy === 'whatsapp'}
          onClick={() => prepare('whatsapp')}>
          Order via WhatsApp
        </Button>
        <Button variant="telegram" className="w-full" loading={busy === 'telegram'}
          onClick={() => prepare('telegram')}>
          Order via Telegram
        </Button>
        <Button variant="secondary" className="w-full" loading={busy === 'preview'}
          onClick={() => prepare('whatsapp')}>
          Preview the message
        </Button>
        <button
          onClick={() => write([])}
          className="w-full text-sm text-brand-muted hover:text-state-red py-2"
        >
          Clear my order
        </button>
      </div>

      {links && (
        <Card className="mt-4">
          <SectionHeader title="Message preview" subtitle="This is what will be sent" />
          <pre className="text-xs sm:text-sm whitespace-pre-wrap font-sans bg-brand-soft
                          rounded-xl p-3.5 text-brand-charcoal border border-brand-line">
            {links.message}
          </pre>
          {estimate && (
            <p className="text-xs text-brand-muted mt-2">{estimate.note}</p>
          )}
          <div className="flex flex-wrap gap-2 mt-3">
            {links.whatsapp_url && (
              <a href={links.whatsapp_url} target="_blank" rel="noopener noreferrer">
                <Button variant="whatsapp" size="sm">Open WhatsApp</Button>
              </a>
            )}
            {links.telegram_url && (
              <a href={links.telegram_url} target="_blank" rel="noopener noreferrer">
                <Button variant="telegram" size="sm">Open Telegram</Button>
              </a>
            )}
          </div>
        </Card>
      )}

      <p className="text-xs text-brand-muted mt-5 text-center">
        Questions? Message us on WhatsApp
        {shop.whatsapp_display ? <> at <strong className="text-brand-charcoal">{String(shop.whatsapp_display)}</strong></> : null}.
      </p>
    </div>
  );
}

function readCart(): Line[] {
  try {
    const raw = localStorage.getItem(CART_KEY);
    return raw ? (JSON.parse(raw) as Line[]) : [];
  } catch {
    return [];
  }
}
