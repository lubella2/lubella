import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { fmtDate, fmtTime, money } from '../../lib/format';
import { Button, Card, ErrorState, LoadingBlock, useToast } from '../../components/ui';
import { Logo } from '../../components/Logo';
import { fetchSaleDetail, type SaleDetail } from '../../api/pos';
import { fetchPublicSettings } from '../../api/portal';
import { useAsync } from '../../lib/hooks';
import { useAuth } from '../../lib/auth';
import type { SaleReceipt } from '../../types';

/**
 * Receipt (§56).
 *
 * Printable, downloadable and shareable. The receipt is built from the frozen
 * sale record — line prices and totals are the ones stored at the time of sale,
 * so changing a product's price later cannot rewrite a customer's history (§26).
 */
export default function Receipt() {
  const { saleId } = useParams<{ saleId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { push } = useToast();
  const { isOwner, profile } = useAuth();
  const preloaded = (location.state as { receipt?: SaleReceipt } | null)?.receipt;
  const printRef = useRef<HTMLDivElement>(null);
  const [shop, setShop] = useState<Record<string, string | number | boolean | null>>({});

  const detail = useAsync(() => fetchSaleDetail(saleId!), [saleId], { enabled: !preloaded });
  useEffect(() => {
    fetchPublicSettings().then((s) => setShop(s as Record<string, string | number | boolean | null>)).catch(() => {});
  }, []);

  const sale = detail.data?.sale;
  /** Receipt lines, whether they came from the till or were re-read from the sale. */
  type ReceiptRow = {
    product_name: string;
    unit_price: number;
    line_total: number;
    line_discount: number;
    quantity: number;
  };
  const items: ReceiptRow[] = (preloaded?.items ?? detail.data?.items ?? []).map((l) => ({
    product_name: l.product_name,
    unit_price: Number(l.unit_price),
    line_total: Number(l.line_total),
    line_discount: Number(l.line_discount ?? 0),
    quantity: Number(l.quantity ?? 1),
  }));

  const share = async () => {
    const text = buildShareText(preloaded, sale, items, shop);
    if (navigator.share) {
      try {
        await navigator.share({ title: 'LuBella receipt', text });
        return;
      } catch {
        /* user dismissed the share sheet */
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      push({ tone: 'success', title: 'Receipt copied', body: 'Paste it into WhatsApp or Telegram.' });
    } catch {
      push({ tone: 'error', title: 'Could not copy', body: 'Please take a screenshot instead.' });
    }
  };

  if (!preloaded && detail.loading) return <LoadingBlock rows={5} />;
  if (!preloaded && detail.error) return <ErrorState message={detail.error} onRetry={detail.reload} />;

  const base = profile?.role === 'OWNER' ? '/admin' : '/staff';
  const totalAmount = preloaded?.total_amount ?? sale?.total_amount ?? 0;
  const discount = preloaded?.discount_amount ?? sale?.discount_amount ?? 0;
  const subtotal = preloaded?.subtotal ?? sale?.subtotal ?? 0;
  const saleNumber = preloaded?.sale_number ?? sale?.sale_number ?? '';
  const staffName = preloaded?.staff_name ?? sale?.staff_name ?? '';
  const paymentMethod = preloaded?.payment_method ?? sale?.payment_method ?? 'CASH';
  const createdAt = preloaded ? undefined : sale?.created_at;
  const saleDate = preloaded?.sale_date ?? sale?.sale_date ?? '';

  return (
    <div className="max-w-md mx-auto">
      <div className="no-print flex items-center justify-between gap-3 mb-4">
        <button onClick={() => navigate(-1)} className="text-sm text-brand-muted hover:text-brand-deep">
          ← Back
        </button>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={share}>Share</Button>
          <Button size="sm" onClick={() => window.print()}>Print / Save PDF</Button>
        </div>
      </div>

      <div ref={printRef} className="card p-4 sm:p-5 receipt-print">
        <div className="text-center border-b border-dashed border-brand-line pb-4">
          <Logo size={30} showStrapline className="justify-center" />
          <p className="text-xs text-brand-muted mt-2">{String(shop.address || '')}</p>
          {shop.phone ? <p className="text-xs text-brand-muted">{String(shop.phone)}</p> : null}
        </div>

        <div className="py-3 border-b border-dashed border-brand-line text-sm">
          <Row label="Sale number" value={saleNumber} mono />
          <Row label="Date" value={fmtDate(saleDate)} />
          <Row label="Time" value={createdAt ? fmtTime(createdAt) : fmtTime(new Date())} />
          <Row label="Served by" value={staffName} />
        </div>

        <table className="w-full py-3 text-sm">
          <thead>
            <tr className="border-b border-dashed border-brand-line">
              <th className="text-left font-medium text-brand-muted py-2">Item</th>
              <th className="text-center font-medium text-brand-muted py-2">Qty</th>
              <th className="text-right font-medium text-brand-muted py-2">Price</th>
              <th className="text-right font-medium text-brand-muted py-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((l, i) => (
              <tr key={i} className="border-b border-brand-line/60 last:border-0">
                <td className="py-2 pr-2">
                  <span className="text-brand-ink">{l.product_name}</span>
                  {l.line_discount > 0 && (
                    <span className="block text-xs text-state-red num">
                      −{money(l.line_discount)} discount
                    </span>
                  )}
                </td>
                <td className="text-center num py-2">{l.quantity}</td>
                <td className="text-right num py-2">{money(l.unit_price)}</td>
                <td className="text-right num py-2 font-medium">{money(l.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="border-t border-dashed border-brand-line pt-3 text-sm space-y-1.5">
          <Row label="Subtotal" value={money(subtotal)} mono />
          {discount > 0 && <Row label="Discount" value={`−${money(discount)}`} mono />}
          <div className="flex justify-between items-baseline pt-1.5 border-t border-brand-line">
            <span className="font-semibold text-brand-ink">Total</span>
            <span className="font-semibold text-brand-ink num text-base">{money(totalAmount)} Birr</span>
          </div>
          <Row label="Payment" value={paymentMethod === 'CASH' ? 'Cash' : paymentMethod === 'BANK' ? 'Bank' : 'Telebirr'} />
          {preloaded?.amount_tendered != null && (
            <Row label="Cash received" value={money(preloaded.amount_tendered)} mono />
          )}
          {preloaded?.change_given != null && (
            <Row label="Change" value={money(preloaded.change_given)} mono />
          )}
        </div>

        <div className="border-t border-dashed border-brand-line mt-4 pt-3 text-center">
          <p className="text-sm text-brand-charcoal">
            {String(shop.receipt_footer || 'Thank you for shopping with LuBella!')}
          </p>
          <p className="text-xs text-brand-muted mt-1.5">
            Keep this receipt for any exchange. Availability confirmed at the time of sale.
          </p>
        </div>

        {sale?.status === 'VOIDED' && (
          <div className="mt-3 rounded-xl bg-state-red/10 border border-state-red/25 p-3 text-center">
            <p className="text-sm font-semibold text-state-red">VOIDED</p>
            {sale.void_reason && <p className="text-xs text-brand-charcoal mt-0.5">{sale.void_reason}</p>}
          </div>
        )}
        {sale?.status === 'PARTIALLY_RETURNED' || sale?.status === 'RETURNED' ? (
          <div className="mt-3 rounded-xl bg-state-amber/10 border border-state-amber/30 p-3 text-center">
            <p className="text-sm font-semibold text-[#8a6318]">
              {sale.status === 'RETURNED' ? 'Fully returned' : 'Partially returned'}
            </p>
            {sale.returned_amount > 0 && (
              <p className="text-xs text-brand-charcoal mt-0.5 num">
                {money(sale.returned_amount)} Birr refunded
              </p>
            )}
          </div>
        ) : null}
      </div>

      {/* Owner-only: the cost side and the reversal controls. */}
      {detail.data && !preloaded && isOwner && (
        <Card className="mt-4 no-print">
          <p className="section-title mb-2">Owner information</p>
          <Row label="Cost of goods sold" value={money(sale?.cogs_amount ?? 0)} mono />
          <Row label="Gross profit" value={money(sale?.gross_profit ?? 0)} mono />
          <Row label="Status" value={sale?.status ?? ''} />
          {detail.data.commissions.map((c) => (
            <Row key={c.id} label={`Commission (${c.type})`} value={`${money(c.amount)} @ ${(c.rate * 100).toFixed(0)}%`} mono />
          ))}
          <div className="flex flex-wrap gap-2 mt-3">
            <Link to={`/admin/sales/${saleId}`}><Button size="sm" variant="secondary">Full sale detail</Button></Link>
            <Link to="/admin/returns"><Button size="sm" variant="ghost">Returns &amp; voids</Button></Link>
          </div>
        </Card>
      )}

      {!isOwner && !preloaded && detail.data && (
        <p className="text-xs text-brand-muted text-center mt-4 no-print">
          {detail.data.note}
        </p>
      )}

      <div className="no-print mt-4 text-center">
        <Link to={`${base}/pos`}><Button variant="secondary">New sale</Button></Link>
      </div>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span className="text-brand-muted">{label}</span>
      <span className={`text-brand-ink text-right ${mono ? 'num' : ''}`}>{value}</span>
    </div>
  );
}

function buildShareText(
  preloaded: SaleReceipt | undefined,
  sale: SaleDetail['sale'] | undefined,
  items: Array<{ product_name: string; quantity: number; unit_price?: number; line_total?: number }>,
  shop: Record<string, string | number | boolean | null>,
): string {
  const lines = [
    String(shop.shop_name || 'LuBella Cosmetics & Accessories'),
    `Receipt ${preloaded?.sale_number ?? sale?.sale_number ?? ''}`,
    fmtDate(preloaded?.sale_date ?? sale?.sale_date ?? new Date()),
    '',
  ];
  for (const l of items) {
    lines.push(`${l.product_name} × ${l.quantity}`);
  }
  lines.push('');
  lines.push(`Total: ${money(preloaded?.total_amount ?? sale?.total_amount ?? 0)} Birr`);
  lines.push(String(shop.receipt_footer || 'Thank you for shopping with LuBella!'));
  return lines.join('\n');
}
