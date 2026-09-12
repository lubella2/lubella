import { Link } from 'react-router-dom';
import { availabilityChip, money } from '../lib/format';
import type { PublicProduct } from '../types';

/**
 * Customer-facing product card.
 *
 * Shows availability as a band, never a number (§7). Cost, supplier and margin
 * are not merely hidden — they are absent from the payload the card receives.
 */
export function ProductCard({
  product, onOrder, compact = false,
}: {
  product: PublicProduct;
  onOrder?: (product: PublicProduct) => void;
  compact?: boolean;
}) {
  const chip = availabilityChip(product.availability);
  const outOfStock = product.availability === 'OUT';

  return (
    <div className="card overflow-hidden flex flex-col group">
      <Link to={`/products/${product.id}`} className="block relative">
        <div className={`aspect-square bg-brand-soft overflow-hidden ${compact ? '' : 'sm:aspect-[4/3]'}`}>
          {product.image_url ? (
            <img
              src={product.image_url}
              alt={product.name}
              loading="lazy"
              className="w-full h-full object-cover group-hover:scale-[1.03] transition duration-300"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-brand-line">
              <svg width="56" height="56" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2 3 7v10l9 5 9-5V7l-9-5Zm0 2.3 6.5 3.6L12 11.5 5.5 7.9 12 4.3Z" />
              </svg>
            </div>
          )}
        </div>
        <div className="absolute top-2 left-2 flex gap-1.5">
          {product.featured && <span className="chip bg-brand-rose text-white shadow-sm">Featured</span>}
          {product.is_new && !product.featured && (
            <span className="chip bg-white/95 text-brand-deep shadow-sm">New</span>
          )}
        </div>
      </Link>

      <div className="p-3 flex flex-col flex-1">
        {product.category_name && (
          <p className="text-[11px] uppercase tracking-wide text-brand-muted">{product.category_name}</p>
        )}
        <Link to={`/products/${product.id}`} className="mt-0.5">
          <h3 className="font-medium text-brand-ink leading-snug line-clamp-2 min-h-[2.6rem]">
            {product.name}
          </h3>
        </Link>
        {product.brand && <p className="text-xs text-brand-muted mt-0.5">{product.brand}</p>}

        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="font-semibold text-brand-ink num">{money(product.selling_price)} <span className="text-xs text-brand-muted font-normal">Birr</span></p>
        </div>

        <div className="mt-2">
          <span className={chip.className}>
            <span aria-hidden="true">{chip.dot}</span> {chip.label}
          </span>
        </div>

        {onOrder && (
          <button
            onClick={() => onOrder(product)}
            disabled={outOfStock}
            className={`mt-3 w-full h-10 rounded-xl text-sm font-medium transition active:scale-[0.98]
              ${outOfStock
                ? 'bg-brand-soft text-brand-muted cursor-not-allowed'
                : 'bg-brand-rose text-white hover:bg-brand-deep'}`}
          >
            {outOfStock ? 'Out of Stock' : 'Add to order'}
          </button>
        )}
      </div>
    </div>
  );
}

/** Grid used by Home, Products and Categories. */
export function ProductGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">{children}</div>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="card overflow-hidden">
      <div className="skeleton aspect-square rounded-none" />
      <div className="p-3 space-y-2">
        <div className="skeleton h-3 w-1/3" />
        <div className="skeleton h-4 w-4/5" />
        <div className="skeleton h-4 w-1/2" />
        <div className="skeleton h-10 w-full" />
      </div>
    </div>
  );
}
