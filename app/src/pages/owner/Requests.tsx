import { useState } from 'react';
import { fmtDate, fmtDateTime, relativeDays, titleCase } from '../../lib/format';
import {
  Button, Card, Drawer, EmptyState, ErrorState, Field, FilterChips, Input, LoadingBlock,
  SectionHeader, Select, StatCard, StatusBadge, Textarea, useToast,
} from '../../components/ui';
import { fetchCustomerRequests, updateRequestStatus } from '../../api/reports';
import { useAsync } from '../../lib/hooks';
import { rpc } from '../../lib/supabase';
import type { CustomerRequestRow, RequestSource, RequestStatus } from '../../types';

/**
 * Customer requests (§20, §44).
 *
 * A request is an enquiry, never a sale: recording one moves no stock. It is
 * also where demand is captured — a request for something the shop was out of
 * is flagged, which is what makes the demand report worth reading when you are
 * deciding what to buy next.
 */
const STATUSES: RequestStatus[] = [
  'NEW', 'CONTACTED', 'CONFIRMED', 'ORDERED_FROM_SUPPLIER', 'AVAILABLE', 'FULFILLED', 'CANCELLED',
];

export default function OwnerRequests() {
  const { push } = useToast();
  const [from, setFrom] = useState(new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<RequestStatus | null>(null);
  const [source, setSource] = useState<RequestSource | null>(null);
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const requests = useAsync(
    () => fetchCustomerRequests({ from, to, status, source }),
    [from, to, status, source],
  );

  const rows = (requests.data?.items ?? []).filter((r) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return (r.customerName || '').toLowerCase().includes(term)
      || (r.product || '').toLowerCase().includes(term)
      || r.requestNumber.toLowerCase().includes(term)
      || (r.customerPhone || '').includes(term);
  });

  const stats = requests.data?.stats;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-ink">Customer requests</h1>
          <p className="text-sm text-brand-muted">
            What customers asked for, including the things you did not have. None of it moved stock.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => { setStatus('NEW'); setFrom(new Date(Date.now() - 89 * 86_400_000).toISOString().slice(0, 10)); }}
        >
          Show new only
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Requests" value={stats?.total ?? 0} />
        <StatCard label="Waiting (new)" value={stats?.new_count ?? 0} tone={(stats?.new_count ?? 0) > 0 ? 'warn' : 'good'} />
        <StatCard label="Fulfilled" value={stats?.fulfilled ?? 0} tone="good" />
        <StatCard
          label="Asked for while out of stock"
          value={stats?.unavailable ?? 0}
          sub="These are the strongest buy signals"
        />
      </div>

      <Card>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="From">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Search">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, phone, product or number" />
          </Field>
        </div>
        <FilterChips
          allLabel="Any status" value={status} onChange={setStatus}
          options={STATUSES.map((s) => ({ value: s, label: titleCase(s) }))}
        />
        <FilterChips
          allLabel="Any channel" value={source} onChange={setSource}
          options={[
            { value: 'WEBSITE', label: 'Website' },
            { value: 'WHATSAPP', label: 'WhatsApp' },
            { value: 'TELEGRAM', label: 'Telegram' },
            { value: 'STAFF', label: 'Asked in shop' },
          ]}
        />
      </Card>

      {requests.loading ? <LoadingBlock rows={6} /> :
       requests.error ? <ErrorState message={requests.error} onRetry={requests.reload} /> :
       rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No requests in this period"
            description="Requests arrive from the website, from WhatsApp or Telegram, or when staff write one down for a customer."
          />
        </Card>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {rows.map((r) => (
              <RequestCard key={r.id} row={r} onOpen={() => setOpenId(r.id)} onChanged={requests.reload} />
            ))}
          </div>
          <p className="text-xs text-brand-muted">
            Showing {rows.length} of {stats?.total ?? rows.length} requests.
          </p>
        </>
      )}

      <RequestDrawer
        requestId={openId} onClose={() => setOpenId(null)}
        onChanged={() => { requests.reload(); push({ tone: 'success', title: 'Request updated' }); }}
      />
    </div>
  );
}

function RequestCard({
  row, onOpen, onChanged,
}: { row: CustomerRequestRow; onOpen: () => void; onChanged: () => void }) {
  const { push } = useToast();
  const [busy, setBusy] = useState(false);

  const setStatus = async (next: RequestStatus) => {
    setBusy(true);
    try {
      await updateRequestStatus(row.id, next);
      push({ tone: 'success', title: `${row.requestNumber} marked ${titleCase(next).toLowerCase()}` });
      onChanged();
    } catch (err) {
      push({ tone: 'error', title: 'Could not update the request', body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={row.was_unavailable ? 'border-state-amber/40' : ''}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="num text-xs text-brand-muted">{row.requestNumber}</p>
          <p className="font-medium text-brand-ink truncate">{row.product}</p>
          <p className="text-xs text-brand-muted">
            {row.quantity} × · asked {relativeDays(row.created_at)} via {titleCase(row.source)}
          </p>
        </div>
        {row.was_unavailable && <span className="chip-amber shrink-0">Out of stock</span>}
      </div>

      <div className="flex items-center gap-2 mt-2">
        <StatusBadge status={row.status} />
        {row.matched_product && (
          <span className="text-xs text-brand-muted truncate">→ {row.matched_product}</span>
        )}
      </div>

      <div className="mt-3 space-y-1 text-sm">
        <p className="text-brand-charcoal">
          {row.customerName || 'Unnamed customer'}
          {row.customerPhone && <span className="text-brand-muted num"> · {row.customerPhone}</span>}
        </p>
        {row.message && <p className="text-xs text-brand-muted line-clamp-2">{row.message}</p>}
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        {row.status === 'NEW' && (
          <Button size="sm" disabled={busy} onClick={() => void setStatus('CONTACTED')}>Mark contacted</Button>
        )}
        {row.status === 'CONTACTED' && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void setStatus('ORDERED_FROM_SUPPLIER')}>
            Order from supplier
          </Button>
        )}
        {['CONFIRMED', 'ORDERED_FROM_SUPPLIER'].includes(row.status) && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void setStatus('AVAILABLE')}>
            Customer can collect
          </Button>
        )}
        {['AVAILABLE', 'CONFIRMED'].includes(row.status) && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void setStatus('FULFILLED')}>
            Fulfilled
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onOpen}>Details</Button>
      </div>
      <p className="text-xs text-brand-muted mt-2">
        Marking a request fulfilled does not create a sale — ring the sale up at the till so stock and
        commission stay correct.
      </p>
    </Card>
  );
}

interface RequestDetail {
  id: string;
  request_number: string;
  customer_name: string | null;
  customer_phone: string | null;
  requested_product_name: string;
  quantity: number;
  message: string | null;
  photo_url: string | null;
  source: RequestSource;
  status: RequestStatus;
  was_unavailable: boolean;
  owner_note: string | null;
  created_at: string;
  updated_at: string;
  product_id: string | null;
  product_name: string | null;
  product_code: string | null;
  product_price: number | null;
  category_name: string | null;
  availability: string | null;
  quantity_on_hand: number | null;
  handled_by_name: string | null;
  same_product_requests: number;
  same_customer_requests: number;
}

function RequestDrawer({
  requestId, onClose, onChanged,
}: { requestId: string | null; onClose: () => void; onChanged: () => void }) {
  const { push } = useToast();
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<RequestStatus>('NEW');
  const [busy, setBusy] = useState(false);

  const detail = useAsync(
    () => requestId
      ? rpc<RequestDetail>('rpc_request_detail', { p_request_id: requestId })
      : Promise.resolve(null),
    [requestId],
    { enabled: Boolean(requestId) },
  );

  const submit = async () => {
    const d = detail.data;
    if (!d) return;
    setBusy(true);
    try {
      await updateRequestStatus(d.id, status, note || undefined);
      setNote('');
      onClose(); onChanged();
    } catch (err) {
      push({ tone: 'error', title: 'Could not update the request', body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const copyContact = () => {
    const d = detail.data;
    if (!d) return;
    void navigator.clipboard.writeText(
      d.customer_phone || d.customer_name || d.request_number,
    );
    push({ tone: 'success', title: 'Contact detail copied' });
  };

  return (
    <Drawer open={Boolean(requestId)} onClose={onClose} title={detail.data?.request_number ?? 'Request'}>
      {detail.loading ? <LoadingBlock rows={5} /> :
       detail.error ? <ErrorState message={detail.error} onRetry={detail.reload} /> :
       detail.data && (
        <div className="space-y-4">
          <Card>
            <SectionHeader
              title={detail.data.requested_product_name}
              subtitle={`${detail.data.quantity} requested · ${titleCase(detail.data.source)} · ${fmtDate(detail.data.created_at)}`}
              action={<StatusBadge status={detail.data.status} />}
            />
            {detail.data.was_unavailable && (
              <p className="text-xs text-[#8a6318] bg-state-amber/10 rounded-lg p-2">
                This was asked for while the product was unavailable — a buy signal for restocking.
              </p>
            )}
            <dl className="grid grid-cols-2 gap-3 text-sm mt-2">
              <div>
                <dt className="text-xs text-brand-muted">Customer</dt>
                <dd className="text-brand-ink">
                  {detail.data.customer_name || 'Unnamed'}{' '}
                  {detail.data.customer_phone && (
                    <span className="block num text-brand-muted">{detail.data.customer_phone}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-brand-muted">Matched product</dt>
                <dd className="text-brand-ink">
                  {detail.data.product_name
                    ? `${detail.data.product_name} (${detail.data.product_code})`
                    : 'Not in the catalogue'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-brand-muted">Stock right now</dt>
                <dd className="text-brand-ink num">
                  {detail.data.quantity_on_hand != null
                    ? `${detail.data.quantity_on_hand} units · ${detail.data.availability}`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-brand-muted">Category</dt>
                <dd className="text-brand-ink">{detail.data.category_name || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-brand-muted">Times this product was requested</dt>
                <dd className="text-brand-ink num">{detail.data.same_product_requests}</dd>
              </div>
              <div>
                <dt className="text-xs text-brand-muted">Requests from this customer</dt>
                <dd className="text-brand-ink num">{detail.data.same_customer_requests}</dd>
              </div>
            </dl>
            {detail.data.message && (
              <p className="text-sm text-brand-charcoal mt-3 rounded-lg bg-brand-soft p-3">{detail.data.message}</p>
            )}
            {detail.data.handled_by_name && (
              <p className="text-xs text-brand-muted mt-2">Last handled by {detail.data.handled_by_name}</p>
            )}
          </Card>

          <Card>
            <SectionHeader title="Update this request" />
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value as RequestStatus)}>
                {STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
              </Select>
            </Field>
            <Field label="Note" hint="Kept with the request so anyone can see what was agreed.">
              <Textarea
                value={note} onChange={(e) => setNote(e.target.value)}
                placeholder={
                  detail.data.owner_note
                    ? `Current note: ${detail.data.owner_note}`
                    : 'e.g. Told her we will have it by Friday'
                }
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button onClick={submit} loading={busy}>Save update</Button>
              <Button variant="secondary" onClick={copyContact}>Copy contact</Button>
            </div>
            <p className="text-xs text-brand-muted mt-3">
              Phone numbers are only visible to signed-in staff and the owner — the public catalogue
              never exposes them.
            </p>
          </Card>

          <p className="text-xs text-brand-muted">
            Last changed {fmtDateTime(detail.data.updated_at)}.
          </p>
        </div>
      )}
    </Drawer>
  );
}
