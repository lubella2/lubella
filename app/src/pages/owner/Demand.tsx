import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { relativeDays } from '../../lib/format';
import {
  Button, Card, EmptyState, ErrorState, Field, LoadingBlock, SectionHeader,
  Select, StatCard, Tabs,
} from '../../components/ui';
import { fetchCustomerDemand } from '../../api/reports';
import { useAsync } from '../../lib/hooks';

/**
 * Demand analysis (§43, §44).
 *
 * The question this answers is "what should I buy next?", and the honest answer
 * comes from what customers asked for and could not get. A request recorded
 * against an out-of-stock product is worth more than a page view: someone
 * wanted it enough to ask.
 */
export default function OwnerDemand() {
  const [days, setDays] = useState<'30' | '90' | '180' | '365'>('90');
  const [onlyUnavailable, setOnlyUnavailable] = useState(false);
  const [tab, setTab] = useState<'demand' | 'cannot-supply'>('demand');

  const demand = useAsync(
    () => fetchCustomerDemand(Number(days), onlyUnavailable),
    [days, onlyUnavailable],
  );

  const rows = demand.data?.items ?? [];
  const cannotSupply = rows.filter((r) => r.unavailable_request || (r.quantity_on_hand ?? 0) <= 0);

  const chart = [...rows].slice(0, 10).reverse().map((r) => ({
    name: r.product_name.length > 18 ? `${r.product_name.slice(0, 17)}…` : r.product_name,
    requests: r.request_count,
    customers: r.unique_customers,
  }));

  const shown = tab === 'demand' ? rows : cannotSupply;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-ink">Demand</h1>
          <p className="text-sm text-brand-muted">
            What customers asked for — especially what they asked for and you did not have.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/admin/requests"><Button variant="secondary">All requests</Button></Link>
          <Link to="/admin/restock"><Button>Restock</Button></Link>
        </div>
      </div>

      <Card>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Period">
            <Select value={days} onChange={(e) => setDays(e.target.value as '30' | '90' | '180' | '365')}>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="180">Last 6 months</option>
              <option value="365">Last 12 months</option>
            </Select>
          </Field>
          <Field label="Focus" hint="A request for something already out of stock is the strongest signal.">
            <label className="flex items-center gap-2 h-11 text-sm text-brand-charcoal">
              <input
                type="checkbox" checked={onlyUnavailable}
                onChange={(e) => setOnlyUnavailable(e.target.checked)}
                className="h-5 w-5 rounded border-brand-line accent-[#D1809A]"
              />
              Only products we could not supply
            </label>
          </Field>
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Products requested" value={rows.length} />
        <StatCard
          label="Total requests"
          value={rows.reduce((s, r) => s + r.request_count, 0)}
        />
        <StatCard
          label="Could not supply"
          value={cannotSupply.length}
          tone={cannotSupply.length ? 'warn' : 'good'}
          sub="Requested while unavailable or out of stock now"
        />
        <StatCard
          label="Customers asking"
          value={rows.reduce((s, r) => s + r.unique_customers, 0)}
          sub="People, not requests"
        />
      </div>

      {demand.loading ? <LoadingBlock rows={6} /> :
       demand.error ? <ErrorState message={demand.error} onRetry={demand.reload} /> :
       rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No demand recorded yet"
            description={
              onlyUnavailable
                ? 'Nothing was requested that the shop could not supply in this period.'
                : 'Requests from the website, WhatsApp and Telegram build this picture over time.'
            }
          />
        </Card>
      ) : (
        <>
          <Card>
            <SectionHeader title="Most requested products" subtitle={`Top 10 in the last ${days} days`} />
            <div className="h-64 -ml-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EFE1E8" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#8A8489' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis
                    type="category" dataKey="name" width={120}
                    tick={{ fontSize: 11, fill: '#8A8489' }} axisLine={false} tickLine={false}
                  />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #EFE1E8', fontSize: 12 }} />
                  <Bar dataKey="requests" name="Requests" fill="#D1809A" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="customers" name="Customers" fill="#B96482" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Tabs
            tabs={[
              { id: 'demand', label: 'All demand', count: rows.length },
              { id: 'cannot-supply', label: 'Could not supply', count: cannotSupply.length },
            ]}
            active={tab}
            onChange={setTab}
          />

          {shown.length === 0 ? (
            <Card><EmptyState title="Nothing in this view" description="Every requested product was available." /></Card>
          ) : (
            <Card padded={false}>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th className="text-right">Requests</th>
                      <th className="text-right">Customers</th>
                      <th className="text-right">In stock now</th>
                      <th>Status</th>
                      <th>Last asked</th>
                      <th>What it means</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r, i) => (
                      <tr key={`${r.product_name}-${i}`}>
                        <td>
                          <p className="font-medium text-brand-ink">{r.product_name}</p>
                          <p className="text-xs text-brand-muted">{r.category || 'Uncategorised'}</p>
                        </td>
                        <td className="text-right num font-medium">{r.request_count}</td>
                        <td className="text-right num">{r.unique_customers}</td>
                        <td className="text-right num">{r.quantity_on_hand ?? '—'}</td>
                        <td>
                          {r.availability === 'OUT' ? <span className="chip-red">Out of stock</span>
                            : r.availability === 'LOW' ? <span className="chip-amber">Low stock</span>
                            : r.product_id ? <span className="chip-green">Available</span>
                            : <span className="chip-slate">Not in catalogue</span>}
                        </td>
                        <td className="text-xs text-brand-muted">{relativeDays(r.last_requested)}</td>
                        <td className="text-xs text-brand-charcoal max-w-[18rem]">{r.demand_message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card>
            <SectionHeader title="How to use this" />
            <ul className="text-sm text-brand-charcoal space-y-2 list-disc pl-5">
              <li>
                A product asked for repeatedly while out of stock is a candidate for the next restock —
                receiving it will also show in the Restock page's request counts.
              </li>
              <li>
                Requests never reserve or move stock. If two customers ask for the last unit, the
                first one to be rung up at the till gets it.
              </li>
              <li>
                Marking a request <em>available</em> tells the customer you have it; the sale itself is
                still recorded at the till so commission and stock stay correct.
              </li>
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
