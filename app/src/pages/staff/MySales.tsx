import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtDate, fmtTime, money, titleCase } from '../../lib/format';
import {
  Button, Card, EmptyState, ErrorState, Field, Input, LoadingBlock, StatCard, StatusBadge,
  Tabs,
} from '../../components/ui';
import { fetchMySales } from '../../api/pos';
import { useAsync } from '../../lib/hooks';

/**
 * A staff member's own sales.
 *
 * Scoped by the database to the signed-in user's own sales (`rpc_my_sales`
 * filters on the caller's id), and the payload carries no cost or profit keys at
 * all — those are the owner's figures (§4, §55).
 */
export default function StaffMySales() {
  const [from, setFrom] = useState(new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [tab, setTab] = useState<'sales' | 'today'>('sales');

  const sales = useAsync(() => fetchMySales(200), []);

  const today = new Date().toISOString().slice(0, 10);

  const rows = useMemo(() => {
    const list = sales.data?.items ?? [];
    return list.filter((s) => {
      if (tab === 'today' && s.sale_date !== today) return false;
      if (tab === 'sales' && (s.sale_date < from || s.sale_date > to)) return false;
      return true;
    });
  }, [sales.data, tab, from, to, today]);

  const totals = sales.data?.month_totals;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-ink">My sales</h1>
          <p className="text-sm text-brand-muted">
            Your own sales only. A voided or returned sale stays visible with its status, so the record
            always matches the till.
          </p>
        </div>
        <Link to="/staff/pos"><Button>New sale</Button></Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Sales this month" value={totals?.sale_count ?? 0} />
        <StatCard label="Net sales this month" value={<>{money(totals?.net_sales ?? 0)} <span className="text-xs font-normal text-brand-muted">Birr</span></>} tone="brand" />
        <StatCard label="Discounts given" value={money(totals?.discounts ?? 0)} />
        <StatCard label="Commission earned" value={money(totals?.commission ?? 0)} tone="good" sub="After discount, 3%" />
      </div>

      <Card>
        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1 max-w-xs">
            <Field label="From">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
          </div>
          <div className="flex-1 max-w-xs">
            <Field label="To">
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
        </div>
      </Card>

      <Tabs
        tabs={[
          { id: 'sales', label: 'In this period', count: rows.length },
          { id: 'today', label: "Today's sales" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {sales.loading ? <LoadingBlock rows={6} /> :
       sales.error ? <ErrorState message={sales.error} onRetry={sales.reload} /> :
       rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No sales to show"
            description="Sales you ring up at the till appear here with their receipts."
            action={<Link to="/staff/pos"><Button>Open the till</Button></Link>}
          />
        </Card>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {rows.map((s) => (
              <Card key={s.id} className={s.status === 'VOIDED' ? 'opacity-70' : ''}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="num font-medium text-brand-ink">{s.sale_number}</p>
                    <p className="text-xs text-brand-muted">
                      {fmtDate(s.sale_date)} · {fmtTime(s.created_at)} · {s.line_count} item{s.line_count === 1 ? '' : 's'}
                    </p>
                  </div>
                  <StatusBadge status={s.status} />
                </div>

                <div className="mt-3 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-brand-muted">Subtotal</span>
                    <span className="num">{money(s.subtotal)}</span>
                  </div>
                  {Number(s.discount_amount) > 0 && (
                    <div className="flex justify-between">
                      <span className="text-brand-muted">Discount</span>
                      <span className="num text-state-red">−{money(s.discount_amount)}</span>
                    </div>
                  )}
                  {Number(s.returned_amount) > 0 && (
                    <div className="flex justify-between">
                      <span className="text-brand-muted">Returned</span>
                      <span className="num text-state-red">−{money(s.returned_amount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between pt-1 border-t border-brand-line">
                    <span className="font-medium text-brand-ink">Total</span>
                    <span className="num font-semibold text-brand-ink">{money(s.total_amount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-brand-muted">Commission</span>
                    <span className="num text-state-green">{money(Number(s.net_amount) * 0.03)}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between mt-3">
                  <span className="text-xs text-brand-muted">{titleCase(s.payment_method)}</span>
                  <Link to={`/staff/receipt/${s.id}`}>
                    <Button size="sm" variant="secondary">Receipt</Button>
                  </Link>
                </div>
              </Card>
            ))}
          </div>
          <p className="text-xs text-brand-muted">
            The commission shown per sale is an estimate of 3% of the post-discount amount; your
            commission page shows what the shop has actually recorded against your name.
          </p>
        </>
      )}
    </div>
  );
}
