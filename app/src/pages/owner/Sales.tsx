import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtDate, fmtTime, money, titleCase } from '../../lib/format';
import {
  Button, Card, EmptyState, ErrorState, Field, FilterChips, Input, LoadingBlock,
  Pager, Select, StatCard, StatusBadge,
} from '../../components/ui';
import { fetchSales } from '../../api/pos';
import { listStaff } from '../../api/catalogAdmin';
import { useAsync } from '../../lib/hooks';
import type { PaymentMethod, SaleStatus } from '../../types';

const PAGE_SIZE = 25;

/**
 * Sales ledger.
 *
 * Owner-only, because each row carries cost and profit. The same underlying
 * sales are visible to staff only through rpc_my_sales, which returns no cost
 * columns at all — the difference is enforced by the database, not by this
 * screen (§4, §55).
 */
export default function OwnerSales() {
  const [from, setFrom] = useState(new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [staffId, setStaffId] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [status, setStatus] = useState<SaleStatus | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const sales = useAsync(
    () => fetchSales({ from, to, staffId, paymentMethod: method }),
    [from, to, staffId, method],
  );
  const staff = useAsync(() => listStaff(), []);

  const rows = useMemo(() => {
    const list = sales.data?.items ?? [];
    const term = search.trim().toLowerCase();
    return list.filter((s) => {
      if (status && s.status !== status) return false;
      if (!term) return true;
      return s.sale_number.toLowerCase().includes(term)
        || s.staff_name.toLowerCase().includes(term);
    });
  }, [sales.data, search, status]);

  const paged = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const totals = sales.data?.totals;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-ink">Sales</h1>
          <p className="text-sm text-brand-muted">
            Every sale stays on the record. A mistake is voided or returned, never deleted.
          </p>
        </div>
        <Link to="/admin/returns"><Button variant="secondary">Returns &amp; voids</Button></Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Net sales" value={<>{money(totals?.net_sales ?? 0)} <span className="text-xs font-normal text-brand-muted">Birr</span></>} tone="brand" sub={`${totals?.sale_count ?? 0} sales`} />
        <StatCard label="Discounts given" value={money(totals?.discounts ?? 0)} />
        <StatCard label="Cost of goods sold" value={money(totals?.cogs ?? 0)} />
        <StatCard
          label="Gross profit" tone={(totals?.gross_profit ?? 0) >= 0 ? 'good' : 'bad'}
          value={<>{money(totals?.gross_profit ?? 0)} <span className="text-xs font-normal text-brand-muted">Birr</span></>}
        />
      </div>

      <Card>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="From">
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} />
          </Field>
          <Field label="Staff member">
            <Select value={staffId ?? ''} onChange={(e) => { setStaffId(e.target.value || null); setPage(0); }}>
              <option value="">Everyone</option>
              {(staff.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </Select>
          </Field>
          <Field label="Payment method">
            <Select value={method ?? ''} onChange={(e) => { setMethod((e.target.value || null) as PaymentMethod | null); setPage(0); }}>
              <option value="">All methods</option>
              <option value="CASH">Cash</option>
              <option value="BANK">Bank</option>
              <option value="TELEBIRR">Telebirr</option>
            </Select>
          </Field>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder="Search sale number or staff" className="sm:max-w-xs" />
          <FilterChips
            allLabel="Any status" value={status} onChange={(v) => { setStatus(v); setPage(0); }}
            options={[
              { value: 'COMPLETED', label: 'Completed' },
              { value: 'PARTIALLY_RETURNED', label: 'Partially returned' },
              { value: 'RETURNED', label: 'Returned' },
              { value: 'VOIDED', label: 'Voided' },
            ]}
          />
        </div>
      </Card>

      {sales.loading ? <LoadingBlock rows={8} /> :
       sales.error ? <ErrorState message={sales.error} onRetry={sales.reload} /> :
       rows.length === 0 ? (
        <Card><EmptyState title="No sales in this period" description="Try widening the dates or clearing the filters." /></Card>
      ) : (
        <>
          <Card padded={false}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Sale</th>
                    <th>Staff</th>
                    <th className="text-right">Subtotal</th>
                    <th className="text-right">Discount</th>
                    <th className="text-right">Net</th>
                    <th className="text-right">Cost</th>
                    <th className="text-right">Profit</th>
                    <th>Payment</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {paged.map((s) => (
                    <tr key={s.id} className={s.status === 'VOIDED' ? 'opacity-60' : ''}>
                      <td>
                        <Link to={`/admin/sales/${s.id}`} className="num text-sm font-medium text-brand-ink hover:text-brand-deep">
                          {s.sale_number}
                        </Link>
                        <p className="text-xs text-brand-muted">
                          {fmtDate(s.sale_date)} {fmtTime(s.created_at)} · {s.line_count} item{s.line_count === 1 ? '' : 's'}
                        </p>
                      </td>
                      <td className="text-sm text-brand-charcoal">{s.staff_name}</td>
                      <td className="text-right num">{money(s.subtotal)}</td>
                      <td className="text-right num">
                        {Number(s.discount_amount) > 0 ? `−${money(s.discount_amount)}` : '—'}
                      </td>
                      <td className="text-right num font-medium">
                        {money(s.net_amount)}
                        {Number(s.returned_amount) > 0 && (
                          <span className="block text-[10px] text-state-red">
                            −{money(s.returned_amount)} returned
                          </span>
                        )}
                      </td>
                      <td className="text-right num">{money(s.cogs_amount)}</td>
                      <td className={`text-right num ${Number(s.gross_profit) < 0 ? 'text-state-red' : ''}`}>
                        {money(s.gross_profit)}
                      </td>
                      <td className="text-sm text-brand-charcoal">{titleCase(s.payment_method)}</td>
                      <td><StatusBadge status={s.status} /></td>
                      <td className="text-right">
                        <Link to={`/admin/sales/${s.id}`}>
                          <Button size="sm" variant="ghost">Open</Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Pager page={page} pageSize={PAGE_SIZE} total={rows.length} onPage={setPage} />
        </>
      )}
    </div>
  );
}
