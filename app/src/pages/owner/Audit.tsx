import { useMemo, useState } from 'react';
import { fmtDateTime, titleCase } from '../../lib/format';
import {
  Button, Card, EmptyState, ErrorState, Field, Input, LoadingBlock, Modal, Select, StatCard, useToast,
} from '../../components/ui';
import { fetchAuditActions, fetchAuditLog } from '../../api/catalogAdmin';
import { fetchApiSurface } from '../../api/reports';
import { useAsync } from '../../lib/hooks';
import type { AuditRow } from '../../types';

const PAGE = 100;

/**
 * Audit log (§58) and the access-surface check (§52).
 *
 * Every consequential action writes a row: who did it, what it touched, what
 * changed, and why. This page is read-only by design — an audit trail you can
 * edit is not an audit trail.
 */
export default function OwnerAudit() {
  const { push } = useToast();
  const [action, setAction] = useState<string>('');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [detail, setDetail] = useState<AuditRow | null>(null);
  const [surfaceOpen, setSurfaceOpen] = useState(false);

  const log = useAsync(
    () => fetchAuditLog({
      action: action || null, entityType: entityType || null,
      from: from || null, to: to || null, limit: PAGE, offset,
    }),
    [action, entityType, from, to, offset],
  );
  const actions = useAsync(() => fetchAuditActions(), []);

  const items = log.data?.items ?? [];
  const total = log.data?.count ?? 0;

  const grouped = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of items) counts.set(row.action, (counts.get(row.action) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [items]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-ink">Audit log</h1>
          <p className="text-sm text-brand-muted">
            Who changed what, and when. Entries are written by the database, not by the screen that
            triggered them.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setSurfaceOpen(true)}>Check access surface</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Entries (filtered)" value={total} />
        {grouped.slice(0, 3).map(([name, count]) => (
          <StatCard key={name} label={titleCase(name.replace(/_/g, ' '))} value={count} />
        ))}
      </div>

      <Card>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="Action">
            <Select value={action} onChange={(e) => { setAction(e.target.value); setOffset(0); }}>
              <option value="">All actions</option>
              {(actions.data ?? []).map((a) => <option key={a} value={a}>{titleCase(a.replace(/_/g, ' '))}</option>)}
            </Select>
          </Field>
          <Field label="Entity">
            <Input
              value={entityType} placeholder="e.g. sales, expenses"
              onChange={(e) => { setEntityType(e.target.value); setOffset(0); }}
            />
          </Field>
          <Field label="From">
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setOffset(0); }} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setOffset(0); }} />
          </Field>
        </div>
        {(action || entityType || from || to) && (
          <Button
            size="sm" variant="ghost"
            onClick={() => { setAction(''); setEntityType(''); setFrom(''); setTo(''); setOffset(0); }}
          >
            Clear filters
          </Button>
        )}
      </Card>

      {log.loading ? <LoadingBlock rows={8} /> :
       log.error ? <ErrorState message={log.error} onRetry={log.reload} /> :
       items.length === 0 ? (
        <Card><EmptyState title="No audit entries match" description="Try widening the dates or clearing the action filter." /></Card>
      ) : (
        <>
          <Card padded={false}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>Action</th>
                    <th>Entity</th>
                    <th>What changed</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row.id}>
                      <td className="text-xs text-brand-muted whitespace-nowrap">{fmtDateTime(row.created_at)}</td>
                      <td className="text-sm text-brand-charcoal">{row.actor_email || 'System'}</td>
                      <td><span className="chip-slate">{titleCase(row.action.replace(/_/g, ' '))}</span></td>
                      <td className="text-xs text-brand-muted num">
                        {row.entity_type}
                        {row.entity_id && <span className="block">{row.entity_id.slice(0, 8)}…</span>}
                      </td>
                      <td className="text-xs text-brand-charcoal max-w-[22rem]">
                        <Summary row={row} />
                      </td>
                      <td className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => setDetail(row)}>Details</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-brand-muted">
              Showing {offset + 1}–{Math.min(offset + PAGE, total)} of {total} entries.
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                Newer
              </Button>
              <Button size="sm" variant="secondary" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>
                Older
              </Button>
            </div>
          </div>
        </>
      )}

      <Modal
        open={Boolean(detail)} onClose={() => setDetail(null)}
        title={detail ? titleCase(detail.action.replace(/_/g, ' ')) : 'Entry'} size="lg"
        footer={<Button variant="ghost" onClick={() => setDetail(null)}>Close</Button>}
      >
        {detail && (
          <div className="space-y-3 text-sm">
            <dl className="grid grid-cols-2 gap-3">
              <div><dt className="text-xs text-brand-muted">When</dt><dd className="text-brand-ink">{fmtDateTime(detail.created_at)}</dd></div>
              <div><dt className="text-xs text-brand-muted">By</dt><dd className="text-brand-ink">{detail.actor_email || 'System'}</dd></div>
              <div><dt className="text-xs text-brand-muted">Entity</dt><dd className="text-brand-ink num">{detail.entity_type}</dd></div>
              <div className="min-w-0"><dt className="text-xs text-brand-muted">Record</dt><dd className="text-brand-ink num truncate">{detail.entity_id || '—'}</dd></div>
            </dl>
            {detail.note && (
              <div className="rounded-xl bg-brand-soft p-3">
                <p className="text-xs text-brand-muted mb-1">Note</p>
                <p className="text-brand-charcoal">{detail.note}</p>
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-brand-muted mb-1">Before</p>
                <pre className="text-xs bg-brand-soft rounded-xl p-3 overflow-auto max-h-64 num">
{JSON.stringify(detail.old_value ?? {}, null, 2)}
                </pre>
              </div>
              <div>
                <p className="text-xs text-brand-muted mb-1">After</p>
                <pre className="text-xs bg-brand-soft rounded-xl p-3 overflow-auto max-h-64 num">
{JSON.stringify(detail.new_value ?? {}, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <AccessSurfaceModal
        open={surfaceOpen} onClose={() => setSurfaceOpen(false)}
        onCopied={() => push({ tone: 'success', title: 'Access list copied' })}
      />
    </div>
  );
}

/** One-line readable digest of the JSON diff, so the table is scannable. */
function Summary({ row }: { row: AuditRow }) {
  const after = row.new_value || {};
  const keys = Object.keys(after).slice(0, 3);
  if (keys.length === 0) return <span className="text-brand-muted">{row.note || '—'}</span>;
  return (
    <span className="num">
      {keys.map((k) => `${k}: ${formatValue((after as Record<string, unknown>)[k])}`).join(' · ')}
      {Object.keys(after).length > keys.length && ` +${Object.keys(after).length - keys.length} more`}
    </span>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return '{…}';
  return String(v);
}

/**
 * The access surface (§52, layer 3).
 *
 * Shows exactly which functions each client role may execute, read straight from
 * PostgreSQL's own privilege catalog. It exists so the claim "staff cannot reach
 * cost data" can be verified rather than trusted.
 */
function AccessSurfaceModal({
  open, onClose, onCopied,
}: { open: boolean; onClose: () => void; onCopied: () => void }) {
  const surface = useAsync(() => fetchApiSurface(), [], { enabled: open });

  return (
    <Modal
      open={open} onClose={onClose} title="What each role can reach" size="xl"
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              if (!surface.data) return;
              void navigator.clipboard.writeText(JSON.stringify(surface.data, null, 2));
              onCopied();
            }}
          >
            Copy list
          </Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </>
      }
    >
      <p className="text-sm text-brand-charcoal mb-3">
        Privileges are read from the database itself. The customer-facing role should reach exactly
        four functions: the catalogue, the filters, the order-message builder and the request form.
        Everything else requires a signed-in user, and each of those functions re-checks the caller's
        role internally.
      </p>
      {surface.loading ? <LoadingBlock rows={4} /> :
       surface.error ? <ErrorState message={surface.error} onRetry={surface.reload} /> :
       surface.data && (
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <p className="section-title mb-2">Anonymous customer ({surface.data.anon.length})</p>
            <ul className="text-xs num space-y-1 max-h-72 overflow-auto">
              {surface.data.anon.map((f) => (
                <li key={f} className="rounded-lg bg-brand-soft px-2.5 py-1.5 text-brand-charcoal">{f}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="section-title mb-2">Signed-in users ({surface.data.authenticated.length})</p>
            <ul className="text-xs num space-y-1 max-h-72 overflow-auto">
              {surface.data.authenticated.map((f) => (
                <li key={f} className="rounded-lg bg-white border border-brand-line px-2.5 py-1.5 text-brand-charcoal">{f}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  );
}
