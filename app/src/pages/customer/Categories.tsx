import { Link } from 'react-router-dom';
import { Card, ErrorState, LoadingBlock } from '../../components/ui';
import { fetchFilters } from '../../api/portal';
import { useAsync } from '../../lib/hooks';

/** Category grid (§5). */
export default function CustomerCategories() {
  const { data, loading, error, reload } = useAsync(() => fetchFilters(), []);

  return (
    <div className="max-w-5xl mx-auto px-4 py-5">
      <h1 className="text-xl font-semibold text-brand-ink">Categories</h1>
      <p className="text-sm text-brand-muted mt-1 mb-4">Browse the shop by what you are looking for.</p>

      {loading ? (
        <LoadingBlock rows={4} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {(data?.categories ?? []).map((c) => (
            <Link key={c.id} to={`/products?category=${c.id}`}>
              <Card className="hover:shadow-lift transition h-full">
                <div className="flex flex-col h-full">
                  <div className="flex-1">
                    <h2 className="font-medium text-brand-ink">{c.name}</h2>
                    {c.description && (
                      <p className="text-xs text-brand-muted mt-1 line-clamp-2">{c.description}</p>
                    )}
                  </div>
                  <p className="text-xs text-brand-deep mt-3 font-medium">
                    {c.product_count ?? 0} product{(c.product_count ?? 0) === 1 ? '' : 's'} →
                  </p>
                </div>
              </Card>
            </Link>
          ))}
          {(data?.categories ?? []).length === 0 && (
            <Card className="col-span-2 sm:col-span-3 text-center py-8">
              <p className="text-brand-muted text-sm">No categories have been set up yet.</p>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
