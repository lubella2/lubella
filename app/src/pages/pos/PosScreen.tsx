import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { availabilityChip, money } from '../../lib/format';
import {
  Button, Card, EmptyState, ErrorState, Field, FilterChips, Input, MoneyInput, Modal,
  useToast,
} from '../../components/ui';
import { completeSale, parseStockConflict, type CartItemInput } from '../../api/pos';
import { useAsync } from '../../lib/hooks';
import { select } from '../../lib/supabase';
import type { PaymentMethod, SaleReceipt, StaffProduct } from '../../types';
import { useAuth } from '../../lib/auth';

interface CartLine extends CartItemInput {
  name: string;
  selling_price: number;
  quantity_on_hand: number;
  image_url: string | null;
}

/**
 * Point of sale (§31–§35).
 *
 * The cart is local state; the money is not. Complete Sale sends intent to
 * PostgreSQL, which re-checks stock, allocates FIFO, computes COGS, records the
 * supplier payable and the commission in a single transaction. If the stock
 * check fails, nothing is written and the exact shortfall comes back so the
 * cashier can continue with what is actually on the shelf (§32).
 */
export default function PosScreen() {
  const navigate = useNavigate();
  const { push } = useToast();
  const { profile } = useAuth();

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState<number | ''>(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [amountTendered, setAmountTendered] = useState<number | ''>('');
  const [paymentReference, setPaymentReference] = useState('');
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<{ product_name: string; requested: number; available: number; product_id: string } | null>(null);
  // Idempotency key: a retry after a dropped connection returns the original
  // sale instead of charging the customer twice.
  const clientRef = useRef<string>(crypto.randomUUID());

  const products = useAsync(async () => {
    const rows = await select<StaffProduct>('v_staff_products', { order: 'name.asc' });
    return rows;
  }, []);

  const categories = useAsync(async () => {
    const rows = await select<{ id: string; name: string }>('categories', { order: 'sort_order.asc' });
    return rows;
  }, []);

  const filtered = useMemo(() => {
    const list = products.data ?? [];
    const term = search.trim().toLowerCase();
    return list.filter((p) => {
      if (categoryId && p.category_id !== categoryId) return false;
      if (!term) return true;
      return (
        p.name.toLowerCase().includes(term) ||
        (p.brand || '').toLowerCase().includes(term) ||
        (p.category_name || '').toLowerCase().includes(term) ||
        (p.supplier_name || '').toLowerCase().includes(term) ||
        p.product_code.toLowerCase().includes(term)
      );
    });
  }, [products.data, search, categoryId]);

  const subtotal = useMemo(() => cart.reduce((s, l) => s + l.selling_price * l.quantity, 0), [cart]);
  const discountValue = typeof discount === 'number' ? Math.min(discount, subtotal) : 0;
  const total = Math.max(0, subtotal - discountValue);
  const change = typeof amountTendered === 'number' ? amountTendered - total : null;

  const addToCart = (product: StaffProduct) => {
    if (product.is_out_of_stock) {
      push({ tone: 'error', title: `${product.name} is out of stock` });
      return;
    }
    setCart((prev) => {
      const existing = prev.find((l) => l.product_id === product.id);
      if (existing) {
        if (existing.quantity + 1 > product.quantity_on_hand) {
          push({
            tone: 'error',
            title: `Only ${product.quantity_on_hand} available`,
            body: `${product.name} cannot be increased further.`,
          });
          return prev;
        }
        return prev.map((l) => (l.product_id === product.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, {
        product_id: product.id, name: product.name, selling_price: product.selling_price,
        quantity: 1, quantity_on_hand: product.quantity_on_hand, image_url: product.image_url,
      }];
    });
  };

  const setQuantity = (productId: string, quantity: number) => {
    setCart((prev) =>
      quantity <= 0
        ? prev.filter((l) => l.product_id !== productId)
        : prev.map((l) => (l.product_id === productId ? { ...l, quantity } : l)),
    );
  };

  const resetSale = () => {
    setCart([]);
    setDiscount(0);
    setAmountTendered('');
    setPaymentReference('');
    clientRef.current = crypto.randomUUID();
  };

  const submitSale = async () => {
    if (cart.length === 0) return;
    setBusy(true);
    setConflict(null);
    try {
      const receipt: SaleReceipt = await completeSale({
        items: cart.map((l) => ({ product_id: l.product_id, quantity: l.quantity })),
        paymentMethod,
        discountAmount: discountValue,
        amountTendered: typeof amountTendered === 'number' ? amountTendered : null,
        paymentReference: paymentReference.trim() || null,
        clientRef: clientRef.current,
      });

      setCheckoutOpen(false);
      resetSale();
      products.reload();
      push({
        tone: 'success',
        title: receipt.replayed ? 'This sale was already completed' : `Sale ${receipt.sale_number} completed`,
        body: `${money(receipt.total_amount)} Birr · ${receipt.payment_method}`,
      });
      const base = profile?.role === 'OWNER' ? '/admin' : '/staff';
      navigate(`${base}/receipt/${receipt.sale_id}`, { state: { receipt } });
    } catch (err) {
      const stockIssue = parseStockConflict(err);
      if (stockIssue) {
        // §32: the precise prompt, with the real available quantity.
        setConflict(stockIssue);
      } else {
        push({ tone: 'error', title: 'Sale not completed', body: (err as Error).message });
      }
    } finally {
      setBusy(false);
    }
  };

  /** §32: "Continue with X" — correct just that product, leave the rest alone. */
  const continueWithAvailable = () => {
    if (!conflict) return;
    const { product_id, available } = conflict;
    setCart((prev) =>
      available <= 0
        ? prev.filter((l) => l.product_id !== product_id)
        : prev.map((l) => (l.product_id === product_id ? { ...l, quantity: available, quantity_on_hand: available } : l)),
    );
    setConflict(null);
    products.reload();
    push({ tone: 'info', title: 'Cart updated', body: 'The rest of the order is unchanged.' });
  };

  const cartCount = cart.reduce((s, l) => s + l.quantity, 0);

  return (
    <div className="pb-24 lg:pb-0">
      <div className="lg:grid lg:grid-cols-[1fr_380px] lg:gap-5">
        {/* ----------------------------- catalogue ---------------------------- */}
        <div>
          <div className="sticky top-[57px] lg:top-[57px] z-20 bg-brand-blush pt-1 pb-2 -mx-4 px-4 lg:mx-0 lg:px-0">
            <div className="relative mb-2">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-muted" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" strokeLinecap="round" />
                </svg>
              </span>
              <Input
                value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products, brands, suppliers…"
                className="pl-11" aria-label="Search products"
              />
            </div>
            <FilterChips
              allLabel="All categories"
              value={categoryId}
              onChange={setCategoryId}
              options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>

          {products.loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-40" />)}
            </div>
          ) : products.error ? (
            <ErrorState message={products.error} onRetry={products.reload} />
          ) : filtered.length === 0 ? (
            <Card><EmptyState title="No products found" description="Try a different search or category." /></Card>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {filtered.map((p) => {
                const chip = availabilityChip(p.availability);
                const inCart = cart.find((l) => l.product_id === p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => addToCart(p)}
                    disabled={p.is_out_of_stock}
                    className={`card p-2.5 text-left transition active:scale-[0.98] relative
                      ${p.is_out_of_stock ? 'opacity-60' : 'hover:shadow-lift'}`}
                  >
                    {inCart && (
                      <span className="absolute top-2 right-2 z-10 h-6 min-w-6 px-1.5 rounded-full
                                       bg-brand-rose text-white text-xs font-semibold flex items-center justify-center">
                        {inCart.quantity}
                      </span>
                    )}
                    <div className="aspect-square rounded-xl bg-brand-soft overflow-hidden mb-2">
                      {p.image_url
                        ? <img src={p.image_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                        : <div className="w-full h-full" />}
                    </div>
                    <p className="text-sm font-medium text-brand-ink leading-snug line-clamp-2 min-h-[2.4rem]">
                      {p.name}
                    </p>
                    <p className="text-sm font-semibold text-brand-ink num mt-1">{money(p.selling_price)}</p>
                    <div className="flex items-center justify-between mt-1.5 gap-1">
                      <span className={chip.className}>
                        <span aria-hidden="true">{chip.dot}</span> {p.quantity_on_hand}
                      </span>
                      {p.expiry_status === 'EXPIRED' && <span className="chip-red">Expired</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ------------------------------- cart ------------------------------- */}
        <div className="hidden lg:block">
          <div className="sticky top-[70px]">
            <CartPanel
              cart={cart} subtotal={subtotal} discount={discount} setDiscount={setDiscount}
              total={total} onQuantity={setQuantity} onClear={resetSale}
              onCheckout={() => setCheckoutOpen(true)}
            />
          </div>
        </div>
      </div>

      {/* mobile cart bar */}
      {cartCount > 0 && (
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 p-3 bg-white border-t border-brand-line
                        pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <Button className="w-full" onClick={() => setCartOpen(true)}>
            View cart · {cartCount} item{cartCount === 1 ? '' : 's'} · {money(total)} Birr
          </Button>
        </div>
      )}

      {/* mobile cart sheet */}
      <Modal open={cartOpen} onClose={() => setCartOpen(false)} title="Current sale"
        footer={
          <>
            <Button variant="ghost" onClick={resetSale} disabled={cart.length === 0}>Clear</Button>
            <Button onClick={() => { setCartOpen(false); setCheckoutOpen(true); }} disabled={cart.length === 0}>
              Continue to payment
            </Button>
          </>
        }
      >
        <CartLines cart={cart} onQuantity={setQuantity} />
        <TotalsBlock subtotal={subtotal} discount={discount} setDiscount={setDiscount} total={total} />
      </Modal>

      {/* checkout */}
      <Modal
        open={checkoutOpen} onClose={() => setCheckoutOpen(false)} title="Payment"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCheckoutOpen(false)} disabled={busy}>Back</Button>
            <Button onClick={submitSale} loading={busy} disabled={cart.length === 0}>
              Complete sale · {money(total)} Birr
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl bg-brand-soft p-3.5">
            <div className="flex justify-between text-sm">
              <span className="text-brand-charcoal">Items</span>
              <span className="num">{cartCount}</span>
            </div>
            <div className="flex justify-between text-sm mt-1">
              <span className="text-brand-charcoal">Subtotal</span>
              <span className="num">{money(subtotal)}</span>
            </div>
            {discountValue > 0 && (
              <div className="flex justify-between text-sm mt-1 text-state-red">
                <span>Discount</span><span className="num">−{money(discountValue)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold text-brand-ink mt-2 pt-2 border-t border-brand-line">
              <span>Total</span><span className="num">{money(total)} Birr</span>
            </div>
          </div>

          <Field label="Payment method" required>
            <div className="grid grid-cols-3 gap-2">
              {(['CASH', 'BANK', 'TELEBIRR'] as PaymentMethod[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setPaymentMethod(m)}
                  className={`h-12 rounded-xl border text-sm font-medium transition
                    ${paymentMethod === m
                      ? 'bg-brand-rose text-white border-brand-rose'
                      : 'bg-white border-brand-line text-brand-charcoal'}`}
                >
                  {m === 'CASH' ? 'Cash' : m === 'BANK' ? 'Bank' : 'Telebirr'}
                </button>
              ))}
            </div>
          </Field>

          {paymentMethod === 'CASH' && (
            <>
              <Field label="Cash received" hint="Used to work out the change.">
                <MoneyInput
                  value={amountTendered} onValueChange={setAmountTendered}
                  placeholder={money(total)}
                />
              </Field>
              {change !== null && change >= 0 && (
                <div className="rounded-xl bg-state-green/10 border border-state-green/25 px-3.5 py-2.5">
                  <p className="text-sm text-state-green font-medium num">Change: {money(change)} Birr</p>
                </div>
              )}
              {change !== null && change < 0 && (
                <div className="rounded-xl bg-state-red/10 border border-state-red/25 px-3.5 py-2.5">
                  <p className="text-sm text-state-red font-medium num">
                    Short by {money(Math.abs(change))} Birr
                  </p>
                </div>
              )}
            </>
          )}

          {paymentMethod !== 'CASH' && (
            <Field label="Reference" hint="Transaction or transfer number.">
              <Input
                value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)}
                placeholder={paymentMethod === 'TELEBIRR' ? 'Telebirr ref' : 'Bank ref'}
              />
            </Field>
          )}

          <div className="rounded-xl border border-brand-line p-3">
            <Field label="Discount" hint="Any amount may be given — commission is calculated after it.">
              <MoneyInput value={discount} onValueChange={setDiscount} />
            </Field>
            {subtotal > 0 && discountValue > 0 && (
              <p className="text-xs text-brand-muted">
                {((discountValue / subtotal) * 100).toFixed(1)}% off ·{' '}
                {profile?.role === 'OWNER'
                  ? 'owner sales earn no commission'
                  : `commission at ${((profile?.commission_rate ?? 0.03) * 100).toFixed(0)}% on ${money(total)}`}
              </p>
            )}
          </div>
        </div>
      </Modal>

      {/* stock conflict (§32) */}
      <Modal
        open={Boolean(conflict)} onClose={() => setConflict(null)} title="Not enough stock" size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConflict(null)}>Cancel</Button>
            <Button onClick={continueWithAvailable}>
              Continue with {conflict?.available ?? 0}
            </Button>
          </>
        }
      >
        {conflict && (
          <p className="text-sm text-brand-charcoal">
            Only <strong>{conflict.available} unit{conflict.available === 1 ? '' : 's'}</strong> of{' '}
            <strong>{conflict.product_name}</strong> {conflict.available === 1 ? 'is' : 'are'} currently
            available. The customer can purchase a maximum of {conflict.available} unit
            {conflict.available === 1 ? '' : 's'}.
            <br /><br />
            Continue with {conflict.available}? The rest of the cart will be left unchanged.
          </p>
        )}
      </Modal>
    </div>
  );
}

/* ------------------------------- sub components ---------------------------- */

function CartLines({
  cart, onQuantity,
}: { cart: CartLine[]; onQuantity: (id: string, q: number) => void }) {
  if (cart.length === 0) {
    return (
      <p className="text-sm text-brand-muted text-center py-6">
        The cart is empty. Tap a product to add it.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-brand-line">
      {cart.map((l) => (
        <li key={l.product_id} className="py-2.5 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-brand-ink truncate">{l.name}</p>
            <p className="text-xs text-brand-muted num">
              {money(l.selling_price)} × {l.quantity} = {money(l.selling_price * l.quantity)}
            </p>
          </div>
          <div className="flex items-center rounded-lg border border-brand-line shrink-0">
            <button className="h-9 w-9 flex items-center justify-center" onClick={() => onQuantity(l.product_id, l.quantity - 1)} aria-label="Decrease">−</button>
            <span className="w-8 text-center num text-sm">{l.quantity}</span>
            <button className="h-9 w-9 flex items-center justify-center" onClick={() => onQuantity(l.product_id, l.quantity + 1)} aria-label="Increase">+</button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function TotalsBlock({
  subtotal, discount, setDiscount, total,
}: {
  subtotal: number; discount: number | ''; total: number;
  setDiscount: (v: number | '') => void;
}) {
  return (
    <div className="mt-3 pt-3 border-t border-brand-line space-y-2">
      <div className="flex justify-between text-sm">
        <span className="text-brand-charcoal">Subtotal</span>
        <span className="num">{money(subtotal)}</span>
      </div>
      <Field label="Discount">
        <MoneyInput value={discount} onValueChange={setDiscount} />
      </Field>
      <div className="flex justify-between font-semibold text-brand-ink">
        <span>Total</span><span className="num">{money(total)} Birr</span>
      </div>
    </div>
  );
}

function CartPanel({
  cart, subtotal, discount, setDiscount, total, onQuantity, onClear, onCheckout,
}: {
  cart: CartLine[]; subtotal: number; discount: number | ''; total: number;
  setDiscount: (v: number | '') => void;
  onQuantity: (id: string, q: number) => void;
  onClear: () => void; onCheckout: () => void;
}) {
  return (
    <Card padded={false} className="overflow-hidden flex flex-col max-h-[calc(100vh-90px)]">
      <div className="px-4 py-3 border-b border-brand-line flex items-center justify-between">
        <h2 className="font-semibold text-brand-ink">
          Current sale
          {cart.length > 0 && (
            <span className="ml-2 text-sm font-normal text-brand-muted">
              {cart.reduce((s, l) => s + l.quantity, 0)} items
            </span>
          )}
        </h2>
        {cart.length > 0 && (
          <button onClick={onClear} className="text-xs text-brand-muted hover:text-state-red">Clear</button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4">
        <CartLines cart={cart} onQuantity={onQuantity} />
      </div>

      {cart.length > 0 && (
        <div className="px-4 pb-4 border-t border-brand-line pt-3">
          <TotalsBlock subtotal={subtotal} discount={discount} setDiscount={setDiscount} total={total} />
          <Button className="w-full mt-3" onClick={onCheckout}>
            Payment · {money(total)} Birr
          </Button>
        </div>
      )}
    </Card>
  );
}
