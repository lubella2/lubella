import { useEffect, useMemo, useState } from 'react';
import { fmtDate, fmtDateTime, titleCase } from '../../lib/format';
import {
  Button, Card, Checkbox, EmptyState, ErrorState, Field, Input, LoadingBlock, SectionHeader,
  StatCard, Tabs, Textarea, useToast,
} from '../../components/ui';
import { fetchAdminSettings, fetchBackupStatus, recordBackupRun, updateSettings } from '../../api/catalogAdmin';
import { useAsync } from '../../lib/hooks';
import type { BackupStatus, SettingsMap } from '../../types';

/** Friendly labels and input types for the keys the database holds. */
const FIELD_SPECS: Array<{
  key: string;
  label: string;
  group: 'shop' | 'messaging' | 'money' | 'stock' | 'security';
  type: 'text' | 'number' | 'rate' | 'boolean' | 'textarea' | 'secret';
  hint?: string;
}> = [
  { key: 'shop_name', label: 'Shop name', group: 'shop', type: 'text' },
  { key: 'shop_phone', label: 'Shop phone', group: 'shop', type: 'text' },
  { key: 'shop_address', label: 'Shop address', group: 'shop', type: 'text' },
  { key: 'receipt_footer', label: 'Receipt footer', group: 'shop', type: 'textarea', hint: 'Printed at the bottom of every receipt.' },

  {
    key: 'whatsapp_number', label: 'WhatsApp order number', group: 'messaging', type: 'text',
    hint: 'Orders open a chat with this number. Change it here and every customer screen follows — nothing is hard-coded in the app.',
  },
  { key: 'telegram_username', label: 'Telegram username', group: 'messaging', type: 'text' },
  { key: 'telegram_bot_username', label: 'Telegram bot username', group: 'messaging', type: 'text' },

  { key: 'tithe_rate', label: 'Tithe rate', group: 'money', type: 'rate', hint: 'Applied to net profit each month. A loss produces no tithe.' },
  { key: 'low_stock_threshold', label: 'Default low-stock threshold', group: 'stock', type: 'number', hint: 'Used when a product has no minimum of its own.' },
  { key: 'expiry_warning_days', label: 'Expiry warning', group: 'stock', type: 'number', hint: 'Days ahead to warn about expiring stock.' },

  {
    key: 'telegram_bot_token', label: 'Telegram bot token', group: 'security', type: 'secret',
    hint: 'Never sent to a customer screen. It is kept private in the database and only readable by the owner.',
  },
];

export default function OwnerSettings() {
  const { push } = useToast();
  const [tab, setTab] = useState<'shop' | 'messaging' | 'money' | 'stock' | 'backups' | 'security'>('shop');
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  const settings = useAsync(() => fetchAdminSettings(), []);
  const backups = useAsync(() => fetchBackupStatus(), []);

  /** Seed the form from what the database holds; anything new appears too. */
  useEffect(() => {
    if (!settings.data) return;
    const seed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(settings.data)) seed[k] = v.value;
    setDraft(seed);
  }, [settings.data]);

  const extraKeys = useMemo(() => {
    if (!settings.data) return [] as string[];
    const known = new Set(FIELD_SPECS.map((f) => f.key));
    return Object.keys(settings.data).filter((k) => !known.has(k)).sort();
  }, [settings.data]);

  const dirtyKeys = useMemo(() => {
    if (!settings.data) return [] as string[];
    return Object.keys(draft).filter((k) => {
      const original = settings.data?.[k]?.value;
      return JSON.stringify(original ?? null) !== JSON.stringify(draft[k] ?? null);
    });
  }, [draft, settings.data]);

  const save = async () => {
    if (dirtyKeys.length === 0) {
      push({ tone: 'info', title: 'Nothing to save' });
      return;
    }
    setSaving(true);
    try {
      const payload: SettingsMap = {};
      for (const k of dirtyKeys) payload[k] = draft[k] as SettingsMap[string];
      const res = await updateSettings(payload);
      push({
        tone: 'success',
        title: `${res.updated} setting${res.updated === 1 ? '' : 's'} saved`,
        body: 'Changes are recorded in the audit log.',
      });
      settings.reload();
    } catch (err) {
      push({ tone: 'error', title: 'Could not save the settings', body: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const renderField = (spec: typeof FIELD_SPECS[number]) => {
    const info = settings.data?.[spec.key];
    const value = draft[spec.key];
    const isPublic = info?.is_public;

    const control = (() => {
      switch (spec.type) {
        case 'number':
          return (
            <Input
              type="number" value={String(value ?? '')}
              onChange={(e) => setDraft({ ...draft, [spec.key]: e.target.value === '' ? null : Number(e.target.value) })}
              className="num"
            />
          );
        case 'rate':
          return (
            <div className="flex items-center gap-2">
              <Input
                type="number" min={0} max={100} step={0.5}
                value={value == null ? '' : Number(value) * 100}
                onChange={(e) => setDraft({
                  ...draft,
                  [spec.key]: e.target.value === '' ? null : Number(e.target.value) / 100,
                })}
                className="num max-w-[7rem]"
              />
              <span className="text-sm text-brand-muted">%</span>
            </div>
          );
        case 'boolean':
          return (
            <Checkbox
              label={spec.label} checked={Boolean(value)}
              onChange={(v) => setDraft({ ...draft, [spec.key]: v })}
            />
          );
        case 'textarea':
          return <Textarea value={String(value ?? '')} onChange={(e) => setDraft({ ...draft, [spec.key]: e.target.value })} />;
        case 'secret':
          return (
            <Input
              type="password" value={String(value ?? '')}
              onChange={(e) => setDraft({ ...draft, [spec.key]: e.target.value })}
            />
          );
        default:
          return <Input value={String(value ?? '')} onChange={(e) => setDraft({ ...draft, [spec.key]: e.target.value })} />;
      }
    })();

    return (
      <Field
        key={spec.key}
        label={spec.label}
        hint={`${spec.hint ? `${spec.hint} ` : ''}${isPublic ? 'Public — customer screens can read this.' : 'Private — never leaves the owner side.'}`}
      >
        {control}
      </Field>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-ink">Settings</h1>
          <p className="text-sm text-brand-muted">
            Shop details, the numbers customers message, and how money and stock rules are applied.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirtyKeys.length > 0 && (
            <span className="text-xs text-[#8a6318]">{dirtyKeys.length} unsaved change{dirtyKeys.length === 1 ? '' : 's'}</span>
          )}
          <Button onClick={save} loading={saving} disabled={dirtyKeys.length === 0}>Save changes</Button>
        </div>
      </div>

      <Tabs
        tabs={[
          { id: 'shop', label: 'Shop' },
          { id: 'messaging', label: 'Ordering channels' },
          { id: 'money', label: 'Money' },
          { id: 'stock', label: 'Stock' },
          { id: 'backups', label: 'Backups' },
          { id: 'security', label: 'Private' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {settings.loading ? <LoadingBlock rows={5} /> :
       settings.error ? <ErrorState message={settings.error} onRetry={settings.reload} /> : (
        <>
          {tab !== 'backups' && (
            <Card>
              {tab === 'messaging' && (
                <div className="rounded-xl bg-brand-soft p-3 mb-4">
                  <p className="text-xs text-brand-charcoal">
                    These are the contact points customers reach when they order. They live in the
                    database, so changing the shop's WhatsApp number here updates the catalogue, the
                    product pages and the basket immediately — no code change, no redeploy.
                  </p>
                </div>
              )}
              {tab === 'money' && (
                <div className="rounded-xl bg-brand-soft p-3 mb-4">
                  <p className="text-xs text-brand-charcoal">
                    Tithe is a share of <strong>net profit</strong> and is never recorded as an
                    operating expense. Supplier payments are settlements, not expenses. Neither is
                    configurable because neither is a preference — they are how the books stay true.
                  </p>
                </div>
              )}
              {FIELD_SPECS.filter((f) => f.group === tab).map(renderField)}

              {tab === 'shop' && extraKeys.length > 0 && (
                <div className="mt-4 pt-4 border-t border-brand-line">
                  <SectionHeader title="Other stored settings" subtitle="Present in the database but not part of the guided form." />
                  <div className="space-y-2">
                    {extraKeys.map((k) => (
                      <div key={k} className="flex items-center gap-3">
                        <span className="text-sm text-brand-charcoal w-48 shrink-0">{titleCase(k.replace(/_/g, ' '))}</span>
                        <Input
                          value={String(draft[k] ?? '')}
                          onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                        />
                        <span className="text-xs text-brand-muted num shrink-0">{k}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          )}

          {tab === 'backups' && (
            <BackupPanel status={backups.data} loading={backups.loading} error={backups.error} onReload={backups.reload} />
          )}
        </>
      )}
    </div>
  );
}

/**
 * Weekly backup (§59).
 *
 * The shop's records live in PostgreSQL and images in storage; a backup that
 * only covers one of them is not a backup. The schedule is stated plainly here
 * so it is obvious what is protected and when.
 */
function BackupPanel({
  status, loading, error, onReload,
}: { status: BackupStatus | null; loading: boolean; error: string | null; onReload: () => void }) {
  const { push } = useToast();
  const [busy, setBusy] = useState(false);

  const recordRun = async () => {
    setBusy(true);
    try {
      await recordBackupRun({ status: 'SUCCESS', notes: 'Recorded from Settings' });
      push({ tone: 'success', title: 'Backup run recorded' });
      onReload();
    } catch (err) {
      push({ tone: 'error', title: 'Could not record the run', body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingBlock rows={4} />;
  if (error) return <ErrorState message={error} onRetry={onReload} />;
  if (!status) return <EmptyState title="No backup information" />;

  const last = status.last_run;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Last backup"
          value={last ? fmtDate(last.finished_at || last.started_at) : 'Never'}
          tone={last ? 'good' : 'bad'}
          sub={last?.status}
        />
        <StatCard label="Schedule" value={status.schedule} />
        <StatCard label="Next due" value={fmtDate(status.next_scheduled)} />
        <StatCard
          label="Size"
          value={last?.size_bytes ? `${(last.size_bytes / 1_048_576).toFixed(1)} MB` : '—'}
          sub={last?.row_count ? `${last.row_count.toLocaleString()} rows` : undefined}
        />
      </div>

      <Card className="bg-brand-soft border-brand-line">
        <SectionHeader title="What a backup covers" />
        <ul className="text-sm text-brand-charcoal space-y-1.5 list-disc pl-5">
          {status.covers.map((c) => <li key={c}>{c}</li>)}
        </ul>
        <p className="text-xs text-brand-muted mt-3">
          The shop does not depend on a spreadsheet for its records: sales, stock movements, supplier
          payables, commission and audit history all live in PostgreSQL and are exported on the
          schedule above. Images are copied from storage in the same run.
        </p>
      </Card>

      <Card>
        <SectionHeader
          title="Run history"
          subtitle="Each run is recorded so a missed week is visible rather than assumed."
          action={<Button size="sm" variant="secondary" onClick={recordRun} loading={busy}>Record a run</Button>}
        />
        {status.history.length === 0 ? (
          <EmptyState title="No runs recorded yet" description="The first scheduled run will appear here." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Finished</th>
                  <th>Status</th>
                  <th className="text-right">Size</th>
                  <th className="text-right">Rows</th>
                </tr>
              </thead>
              <tbody>
                {status.history.map((h, i) => (
                  <tr key={`${h.started_at}-${i}`}>
                    <td className="text-xs text-brand-muted">{fmtDateTime(h.started_at)}</td>
                    <td className="text-xs text-brand-muted">{h.finished_at ? fmtDateTime(h.finished_at) : '—'}</td>
                    <td>
                      <span className={h.status === 'SUCCESS' ? 'chip-green' : h.status === 'FAILED' ? 'chip-red' : 'chip-amber'}>
                        {titleCase(h.status)}
                      </span>
                    </td>
                    <td className="text-right num">{h.size_bytes ? `${(h.size_bytes / 1_048_576).toFixed(1)} MB` : '—'}</td>
                    <td className="text-right num">{h.row_count?.toLocaleString() ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
