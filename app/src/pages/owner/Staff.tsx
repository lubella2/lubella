import { useMemo, useState } from 'react';
import { fmtDate, money, titleCase } from '../../lib/format';
import {
  Button, Card, Checkbox, ConfirmDialog, EmptyState, ErrorState, Field, Input, LoadingBlock,
  Modal, Select, StatCard, Tabs, Textarea, useToast,
} from '../../components/ui';
import {
  createAppUser, fetchSupplierAccounts, linkSupplierUser, listStaff, listSuppliers,
  setSupplierUserStatus, updateStaff,
} from '../../api/catalogAdmin';
import { fetchStaffPerformance } from '../../api/reports';
import { useAsync } from '../../lib/hooks';
import type { AppUser, UserRole } from '../../types';

/**
 * Staff & access.
 *
 * Adding someone here creates a real login. What they can then reach is decided
 * by their role inside PostgreSQL — a staff account is refused cost data by the
 * database itself, and a supplier account sees only its own supplier's rows.
 * Nothing on this page is what enforces that (§4, §51, §52).
 */
export default function OwnerStaff() {
  const { push } = useToast();
  const [tab, setTab] = useState<'people' | 'performance' | 'suppliers'>('people');
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AppUser | null>(null);
  const [linkTarget, setLinkTarget] = useState<AppUser | null>(null);

  const staff = useAsync(() => listStaff(), []);
  const performance = useAsync(
    () => fetchStaffPerformance(
      new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10),
      new Date().toISOString().slice(0, 10),
    ),
    [],
  );
  const accounts = useAsync(() => fetchSupplierAccounts(), []);
  const suppliers = useAsync(() => listSuppliers(), []);

  const people = staff.data ?? [];

  const supplierUsers = useMemo(
    () => people.filter((p) => p.role === 'SUPPLIER'),
    [people],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-ink">Staff &amp; access</h1>
          <p className="text-sm text-brand-muted">
            Accounts, roles and the commission rate each person earns on their own sales.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>Add a person</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Accounts" value={people.length} />
        <StatCard label="Staff" value={people.filter((p) => p.role === 'STAFF').length} />
        <StatCard label="Supplier logins" value={supplierUsers.length} />
        <StatCard label="Inactive" value={people.filter((p) => !p.active).length} tone={people.some((p) => !p.active) ? 'warn' : 'default'} />
      </div>

      <Tabs
        tabs={[
          { id: 'people', label: 'Accounts', count: people.length },
          { id: 'performance', label: 'Performance', count: performance.data?.staff.length },
          { id: 'suppliers', label: 'Supplier logins', count: supplierUsers.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'people' && (
        staff.loading ? <LoadingBlock rows={5} /> :
        staff.error ? <ErrorState message={staff.error} onRetry={staff.reload} /> :
        people.length === 0 ? (
          <Card><EmptyState title="No accounts yet" description="Add the shop owner first, then staff." /></Card>
        ) : (
          <Card padded={false}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role</th>
                    <th className="text-right">Commission</th>
                    <th>Phone</th>
                    <th>Last sign-in</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.id} className={!p.active ? 'opacity-60' : ''}>
                      <td>
                        <p className="font-medium text-brand-ink">{p.full_name}</p>
                        <p className="text-xs text-brand-muted">{p.email}</p>
                      </td>
                      <td>
                        <span className={
                          p.role === 'OWNER' ? 'chip-rose' : p.role === 'STAFF' ? 'chip-slate' : 'chip-green'
                        }>
                          {titleCase(p.role)}
                        </span>
                      </td>
                      <td className="text-right num">
                        {p.role === 'STAFF'
                          ? `${(Number(p.commission_rate) * 100).toFixed(0)}%`
                          : p.role === 'OWNER' ? '0% (owner)' : '—'}
                      </td>
                      <td className="text-sm text-brand-charcoal">{p.phone || '—'}</td>
                      <td className="text-xs text-brand-muted">
                        {p.last_login_at ? fmtDate(p.last_login_at) : 'Never'}
                      </td>
                      <td>
                        {p.active ? <span className="chip-green">Active</span> : <span className="chip-slate">Inactive</span>}
                      </td>
                      <td className="text-right">
                        <div className="flex justify-end gap-1">
                          {p.role === 'SUPPLIER' && (
                            <Button size="sm" variant="ghost" onClick={() => setLinkTarget(p)}>Link</Button>
                          )}
                          <Button size="sm" variant="secondary" onClick={() => setEditTarget(p)}>Edit</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )
      )}

      {tab === 'performance' && (
        performance.loading ? <LoadingBlock rows={5} /> :
        performance.error ? <ErrorState message={performance.error} onRetry={performance.reload} /> :
        (
          <>
            <Card className="bg-brand-soft border-brand-line">
              <p className="text-xs text-brand-charcoal">
                Last 30 days. Commission is 3% of each sale's post-discount total — the discount comes
                off first, so a discount also reduces what is earned on that sale.
              </p>
            </Card>
            <Card padded={false}>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th className="text-right">Sales</th>
                      <th className="text-right">Gross</th>
                      <th className="text-right">Discounts given</th>
                      <th className="text-right">Returns</th>
                      <th className="text-right">Net sales</th>
                      <th className="text-right">Avg. sale</th>
                      <th className="text-right">Commission</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performance.data!.staff.map((s) => (
                      <tr key={s.staff_id}>
                        <td>
                          <p className="font-medium text-brand-ink">{s.full_name}</p>
                          <p className="text-xs text-brand-muted">
                            {titleCase(s.role)}{!s.active && ' · inactive'}
                          </p>
                        </td>
                        <td className="text-right num">{s.sale_count}</td>
                        <td className="text-right num">{money(s.gross_sales)}</td>
                        <td className="text-right num">{Number(s.discounts_given) > 0 ? `−${money(s.discounts_given)}` : '—'}</td>
                        <td className="text-right num">{Number(s.returns) > 0 ? `−${money(s.returns)}` : '—'}</td>
                        <td className="text-right num font-medium">{money(s.net_sales)}</td>
                        <td className="text-right num">{money(s.average_sale)}</td>
                        <td className="text-right num text-state-green">{money(s.commission)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )
      )}

      {tab === 'suppliers' && (
        <SupplierLinks
          users={supplierUsers}
          accounts={accounts.data ?? []}
          suppliers={suppliers.data ?? []}
          loading={accounts.loading}
          onChanged={() => accounts.reload()}
          onLink={(u) => setLinkTarget(u)}
        />
      )}

      <AddPersonModal
        open={addOpen} onClose={() => setAddOpen(false)}
        onDone={() => { staff.reload(); push({ tone: 'success', title: 'Account created' }); }}
      />

      <EditPersonModal
        target={editTarget} onClose={() => setEditTarget(null)}
        onDone={() => { staff.reload(); push({ tone: 'success', title: 'Account updated' }); }}
      />

      <LinkSupplierModal
        target={linkTarget} suppliers={suppliers.data ?? []}
        onClose={() => setLinkTarget(null)}
        onDone={() => { accounts.reload(); push({ tone: 'success', title: 'Supplier portal linked' }); }}
      />
    </div>
  );
}

function SupplierLinks({
  users, accounts, suppliers, loading, onChanged, onLink,
}: {
  users: AppUser[];
  accounts: Array<{ id: string; supplier_id: string; user_id: string; status: string; created_at: string }>;
  suppliers: Array<{ id: string; supplier_code: string; name: string }>;
  loading: boolean;
  onChanged: () => void;
  onLink: (u: AppUser) => void;
}) {
  const { push } = useToast();
  const [disableTarget, setDisableTarget] = useState<{ id: string; label: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const status = async (linkId: string, next: 'ACTIVE' | 'DISABLED') => {
    setBusy(true);
    try {
      await setSupplierUserStatus(linkId, next);
      push({ tone: 'success', title: next === 'ACTIVE' ? 'Access restored' : 'Access disabled' });
      onChanged();
    } catch (err) {
      push({ tone: 'error', title: 'Could not change access', body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingBlock rows={4} />;

  return (
    <>
      <Card className="bg-brand-soft border-brand-line">
        <p className="text-xs text-brand-charcoal">
          Each login is tied to exactly one supplier. The database answers a supplier's queries from
          their own supplier id, so one supplier can never read another's transactions — and disabling
          the link cuts the portal off without deleting any history.
        </p>
      </Card>

      {users.length === 0 ? (
        <Card><EmptyState title="No supplier logins" description="Create an account with the Supplier role, then link it to a supplier." /></Card>
      ) : (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Linked supplier</th>
                  <th>Status</th>
                  <th>Linked on</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const link = accounts.find((a) => a.user_id === u.id);
                  const supplier = suppliers.find((s) => s.id === link?.supplier_id);
                  return (
                    <tr key={u.id}>
                      <td>
                        <p className="font-medium text-brand-ink">{u.full_name}</p>
                        <p className="text-xs text-brand-muted">{u.email}</p>
                      </td>
                      <td className="text-sm text-brand-charcoal">
                        {supplier ? <>{supplier.name} <span className="text-xs text-brand-muted num">· {supplier.supplier_code}</span></> : <span className="text-state-amber">Not linked</span>}
                      </td>
                      <td>
                        {link
                          ? <span className={link.status === 'ACTIVE' ? 'chip-green' : 'chip-slate'}>{titleCase(link.status)}</span>
                          : <span className="chip-amber">No portal</span>}
                      </td>
                      <td className="text-xs text-brand-muted">{link ? fmtDate(link.created_at) : '—'}</td>
                      <td className="text-right whitespace-nowrap">
                        {link ? (
                          <div className="flex justify-end gap-1">
                            {link.status === 'ACTIVE' ? (
                              <Button
                                size="sm" variant="ghost" disabled={busy}
                                onClick={() => setDisableTarget({ id: link.id, label: u.full_name })}
                              >
                                Disable
                              </Button>
                            ) : (
                              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void status(link.id, 'ACTIVE')}>
                                Restore
                              </Button>
                            )}
                          </div>
                        ) : (
                          <Button size="sm" variant="primary" onClick={() => onLink(u)}>Link supplier</Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={Boolean(disableTarget)}
        title="Disable portal access?"
        message={<p>{disableTarget?.label} will no longer be able to sign in to see their transactions. Their history is kept.</p>}
        confirmLabel="Disable access"
        tone="danger"
        busy={busy}
        onClose={() => setDisableTarget(null)}
        onConfirm={() => { const t = disableTarget; setDisableTarget(null); if (t) void status(t.id, 'DISABLED'); }}
      />
    </>
  );
}

function AddPersonModal({
  open, onClose, onDone,
}: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole>('STAFF');
  const [ratePct, setRatePct] = useState(3);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (fullName.trim().length < 2 || !email.includes('@') || password.length < 8) {
      push({
        tone: 'error', title: 'Check the details',
        body: 'A name, a valid email and a password of at least 8 characters are required.',
      });
      return;
    }
    setBusy(true);
    try {
      await createAppUser({
        email: email.trim().toLowerCase(), password, fullName: fullName.trim(),
        role, phone: phone || null, commissionRate: role === 'STAFF' ? ratePct / 100 : 0,
      });
      push({
        tone: 'success', title: `${fullName.trim()} can now sign in`,
        body: role === 'SUPPLIER'
          ? 'Link this account to a supplier so they can see their transactions.'
          : 'Share the email and password with them directly.',
      });
      setFullName(''); setEmail(''); setPassword(''); setPhone('');
      onClose(); onDone();
    } catch (err) {
      push({ tone: 'error', title: 'Could not create the account', body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open} onClose={onClose} title="Add a person" size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy}>Create account</Button>
        </>
      }
    >
      <Field label="Full name" required>
        <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Selam Bekele" />
      </Field>
      <Field label="Email" required hint="Used to sign in.">
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
      </Field>
      <Field label="Temporary password" required hint="At least 8 characters. Give it to them in person.">
        <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="e.g. lubella2026" />
      </Field>
      <Field label="Phone">
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+251 …" />
      </Field>
      <Field label="Role" required>
        <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
          <option value="STAFF">Staff — sells and receives stock</option>
          <option value="OWNER">Owner — full access</option>
          <option value="SUPPLIER">Supplier — their own transactions only</option>
        </Select>
      </Field>
      {role === 'STAFF' && (
        <Field label="Commission rate" hint="Percent of the post-discount sale. The owner's rate is always 0%.">
          <div className="flex items-center gap-2">
            <Input
              type="number" min={0} max={20} step={0.5} value={ratePct}
              onChange={(e) => setRatePct(Number(e.target.value) || 0)} className="num max-w-[7rem]"
            />
            <span className="text-sm text-brand-muted">%</span>
          </div>
        </Field>
      )}
      <div className="rounded-xl bg-brand-soft p-3">
        <p className="text-xs text-brand-charcoal">
          {role === 'STAFF' && 'Staff can sell, receive stock and see quantities — but never purchase cost, profit, or expenses. That limit lives in the database, not just in this screen.'}
          {role === 'OWNER' && 'An owner account can see and do everything, including costs, profit and returns.'}
          {role === 'SUPPLIER' && 'A supplier account sees only its own supplier: its batches, its payables and its statements. Every other supplier is invisible to it.'}
        </p>
      </div>
    </Modal>
  );
}

function EditPersonModal({
  target, onClose, onDone,
}: { target: AppUser | null; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [ratePct, setRatePct] = useState(3);
  const [active, setActive] = useState(true);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  if (target && loadedFor !== target.id) {
    setLoadedFor(target.id);
    setFullName(target.full_name);
    setPhone(target.phone ?? '');
    setRatePct(Number(target.commission_rate) * 100);
    setActive(target.active);
  }

  const submit = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await updateStaff({
        userId: target.id, full_name: fullName.trim(), phone: phone || null,
        commission_rate: target.role === 'STAFF' ? ratePct / 100 : undefined,
        active, note: note || null,
      });
      setNote('');
      onClose(); onDone();
    } catch (err) {
      push({ tone: 'error', title: 'Could not update the account', body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(target)} onClose={onClose} title={target ? `Edit ${target.full_name}` : 'Edit account'} size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy}>Save changes</Button>
        </>
      }
    >
      {target && (
        <div className="space-y-1">
          <Field label="Full name" required>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          {target.role === 'STAFF' && (
            <Field label="Commission rate" hint="Applied to each sale after its discount.">
              <div className="flex items-center gap-2">
                <Input
                  type="number" min={0} max={20} step={0.5} value={ratePct}
                  onChange={(e) => setRatePct(Number(e.target.value) || 0)} className="num max-w-[7rem]"
                />
                <span className="text-sm text-brand-muted">%</span>
              </div>
            </Field>
          )}
          <Checkbox
            label="Account is active"
            checked={active}
            onChange={setActive}
            hint="Deactivating stops sign-in. Sales and commission history stay exactly as they are."
          />
          <Field label="Note" hint="Stored with the change in the audit log.">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Rate raised to 3.5% from this month" />
          </Field>
          <p className="text-xs text-brand-muted">
            Changing a rate never rewrites past commission: existing lines keep the rate they were
            earned at, and the new rate applies from the next sale.
          </p>
        </div>
      )}
    </Modal>
  );
}

function LinkSupplierModal({
  target, suppliers, onClose, onDone,
}: {
  target: AppUser | null;
  suppliers: Array<{ id: string; supplier_code: string; name: string }>;
  onClose: () => void; onDone: () => void;
}) {
  const { push } = useToast();
  const [supplierId, setSupplierId] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!target || !supplierId) {
      push({ tone: 'error', title: 'Choose a supplier' });
      return;
    }
    setBusy(true);
    try {
      await linkSupplierUser(supplierId, target.id);
      onClose(); onDone();
    } catch (err) {
      push({ tone: 'error', title: 'Could not link the account', body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(target)} onClose={onClose} title="Link a supplier login" size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={!supplierId}>Link</Button>
        </>
      }
    >
      {target && (
        <div className="space-y-3">
          <p className="text-sm text-brand-charcoal">
            {target.full_name} <span className="text-brand-muted">({target.email})</span> will see the
            transactions of the supplier you choose — and no other.
          </p>
          <Field label="Supplier" required>
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Select a supplier…</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.supplier_code})</option>)}
            </Select>
          </Field>
          <p className="text-xs text-brand-muted num">
            Read-only: batches received, units sold, payables, payments and statements. A supplier
            cannot change any figure.
          </p>
        </div>
      )}
    </Modal>
  );
}
