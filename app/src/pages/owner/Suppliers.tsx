import { useMemo, useState } from 'react';
import { fmtDate, money, monthLabel, titleCase } from '../../lib/format';
import {
  Button, Card, Drawer, EmptyState, ErrorState, Field, Input, LoadingBlock,
  Modal, MoneyInput, SectionHeader, Select, StatCard, Tabs, Textarea, useToast,
} from '../../components/ui';
import {
  fetchSupplierPayables, fetchSupplierPayments, generateSupplierStatement,
  listSupplierNotes, listSupplierStatements, recordSupplierPayment,
} from '../../api/finance';
import { fetchSupplierAccounts, listStaff, listSuppliers, upsertSupplier } from '../../api/catalogAdmin';
import { linkSupplierUser } from '../../api/catalogAdmin';
import { useAsync } from '../../lib/hooks';
import { rpc } from '../../lib/supabase';
import type { PaymentMethod, Supplier } from '../../types';

/**
 * Suppliers, the credit book's mirror image, and the settlement history.
 *
 * Everything on this page is derived from transaction records: the payable was
 * created by FIFO when a unit sold, and a payment only ever settles those
 * recorded lines. There is no "type in what I owe" field anywhere (§25, §60).
 */
export default function OwnerSuppliers() {
  const { push } = useToast();
  const [tab, setTab] = useState<'suppliers' | 'payables' | 'payments' | 'statements'>('suppliers');
  const [detail, setDetail] = useState<Supplier | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [payOpen, setPayOpen] = useState<{ supplier: Supplier } | null>(null);
  const [statementOpen, setStatementOpen] = useState<Supplier | null>(null);

  const payables = useAsync(() => fetchSupplierPayables(null), []);
  const payments = useAsync(() => fetchSupplierPayments(), []);
  const statements = useAsync(() => listSupplierStatements(null), []);
  const suppliers = useAsync(() => listSuppliers(), []);

  const totals = payables.data?.totals;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-ink">Suppliers</h1>
          <p className="text-sm text-brand-muted">
            Payables accrue per unit sold, at purchase cost. Paying a supplier is a settlement,
            never an expense.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setEditOpen(true)}>Add supplier</Button>
          <Button
            onClick={() => setPayOpen({ supplier: (suppliers.data ?? [])[0] })}
            disabled={!suppliers.data?.length}
          >
            Record payment
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total payable" value={<>{money(totals?.payable ?? 0)} <span className="text-xs font-normal text-brand-muted">Birr</span></>} tone="brand" />
        <StatCard label="Already paid" value={money(totals?.paid ?? 0)} />
        <StatCard
          label="Outstanding"
          value={<>{money(totals?.outstanding ?? 0)} <span className="text-xs font-normal text-brand-muted">Birr</span></>}
          tone={(totals?.outstanding ?? 0) > 0 ? 'warn' : 'good'}
        />
        <StatCard label="Suppliers" value={suppliers.data?.length ?? 0} />
      </div>

      <Tabs
        tabs={[
          { id: 'suppliers', label: 'Suppliers' },
          { id: 'payables', label: 'Payable lines' },
          { id: 'payments', label: 'Payments' },
          { id: 'statements', label: 'Statements' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'suppliers' && (
        payables.loading ? <LoadingBlock rows={5} /> :
        payables.error ? <ErrorState message={payables.error} onRetry={payables.reload} /> :
        (
          <Card padded={false}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>Contact</th>
                    <th className="text-right">Payable</th>
                    <th className="text-right">Paid</th>
                    <th className="text-right">Outstanding</th>
                    <th className="text-right">Open lines</th>
                    <th>Last activity</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(payables.data?.suppliers ?? []).map((s) => (
                    <tr key={s.supplier_code}>
                      <td>
                        <p className="font-medium text-brand-ink">{s.name}</p>
                        <p className="text-xs text-brand-muted num">{s.supplier_code}</p>
                      </td>
                      <td className="text-sm text-brand-charcoal">
                        {(suppliers.data ?? []).find((x) => x.supplier_code === s.supplier_code)?.contact_name || '—'}
                        <span className="block text-xs text-brand-muted">
                          {(suppliers.data ?? []).find((x) => x.supplier_code === s.supplier_code)?.phone || ''}
                        </span>
                      </td>
                      <td className="text-right num">{money(s.total_payable)}</td>
                      <td className="text-right num">{money(s.total_paid)}</td>
                      <td className={`text-right num font-medium ${s.outstanding > 0 ? 'text-[#8a6318]' : ''}`}>
                        {money(s.outstanding)}
                      </td>
                      <td className="text-right num">{s.open_lines}</td>
                      <td className="text-xs text-brand-muted">
                        {s.last_activity ? fmtDate(s.last_activity) : '—'}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        {(() => {
                          const full = (suppliers.data ?? []).find((x) => x.supplier_code === s.supplier_code);
                          if (!full) return null;
                          return (
                            <div className="flex gap-1 justify-end">
                              <Button size="sm" variant="ghost" onClick={() => setDetail(full)}>Open</Button>
                              <Button
                                size="sm" variant="secondary"
                                onClick={() => setPayOpen({ supplier: full })}
                                disabled={s.outstanding <= 0}
                              >
                                Pay
                              </Button>
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )
      )}

      {tab === 'payables' && (
        payables.loading ? <LoadingBlock rows={6} /> :
        (
          <Card padded={false}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Supplier</th>
                    <th>Product</th>
                    <th className="text-right">Units sold</th>
                    <th className="text-right">Unit cost</th>
                    <th className="text-right">Payable</th>
                    <th className="text-right">Paid</th>
                    <th className="text-right">Outstanding</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(payables.data?.lines ?? []).map((l, i) => (
                    <tr key={`${l.batch_number}-${i}`} className={l.is_reversal ? 'bg-brand-blush/40' : ''}>
                      <td className="whitespace-nowrap text-xs text-brand-muted">{fmtDate(l.entry_date)}</td>
                      <td className="text-sm text-brand-charcoal">{l.supplier_name}</td>
                      <td>
                        <p className="text-brand-ink">{l.product_name}</p>
                        <p className="text-xs text-brand-muted num">{l.batch_number}</p>
                      </td>
                      <td className="text-right num">{l.quantity_sold}</td>
                      <td className="text-right num">{money(l.purchase_cost)}</td>
                      <td className={`text-right num ${l.is_reversal ? 'text-state-red' : ''}`}>
                        {money(l.payable_amount)}
                        {l.is_reversal && <span className="block text-[10px]">reversal</span>}
                      </td>
                      <td className="text-right num">{money(l.amount_paid)}</td>
                      <td className="text-right num font-medium">{money(l.outstanding)}</td>
                      <td>
                        <span className={
                          l.status === 'PAID' ? 'chip-green' : l.status === 'PARTIAL' ? 'chip-amber' : 'chip-slate'
                        }>
                          {titleCase(l.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )
      )}

      {tab === 'payments' && (
        payments.loading ? <LoadingBlock rows={5} /> :
        payments.error ? <ErrorState message={payments.error} onRetry={payments.reload} /> :
        (payments.data?.items.length ?? 0) === 0 ? (
          <Card><EmptyState title="No payments recorded" description="Supplier payments appear here once you settle a payable." /></Card>
        ) : (
          <>
            <Card padded={false}>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Payment</th>
                      <th>Date</th>
                      <th>Supplier</th>
                      <th className="text-right">Amount</th>
                      <th>Method</th>
                      <th>Reference</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.data!.items.map((p) => (
                      <tr key={p.id}>
                        <td className="num text-sm">{p.payment_number}</td>
                        <td className="text-xs text-brand-muted whitespace-nowrap">{fmtDate(p.payment_date)}</td>
                        <td className="text-brand-ink">{p.supplier_name}</td>
                        <td className="text-right num font-medium">{money(p.amount)}</td>
                        <td className="text-sm text-brand-charcoal">{titleCase(p.payment_method)}</td>
                        <td className="text-sm text-brand-muted">{p.reference || '—'}</td>
                        <td className="text-sm text-brand-muted max-w-xs truncate">{p.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card className="bg-brand-soft border-brand-line">
              <p className="text-xs text-brand-charcoal">
                Total settled: <strong className="num">{money(payments.data!.total)} Birr</strong>. These
                payments do not appear in the P&amp;L as expenses — the cost was already recognised in
                cost of goods sold when the stock sold.
              </p>
            </Card>
          </>
        )
      )}

      {tab === 'statements' && (
        <>
          <p className="text-xs text-brand-muted">
            A statement re-adds the month's payables and payments from the transaction records at the
            moment you generate it. Re-generating the same month updates it in place.
          </p>
          {statements.loading ? <LoadingBlock rows={4} /> :
           statements.error ? <ErrorState message={statements.error} onRetry={statements.reload} /> :
           statements.data!.length === 0 ? (
            <Card>
              <EmptyState
                title="No statements yet"
                description="Generate a statement for a supplier to send them a monthly summary."
                action={<Button onClick={() => setStatementOpen((suppliers.data ?? [])[0] ?? null)}>Generate statement</Button>}
              />
            </Card>
          ) : (
            <Card padded={false}>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Statement</th>
                      <th>Month</th>
                      <th>Supplier</th>
                      <th className="text-right">Opening</th>
                      <th className="text-right">Units</th>
                      <th className="text-right">Payable</th>
                      <th className="text-right">Paid</th>
                      <th className="text-right">Outstanding</th>
                      <th>Generated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statements.data!.map((s) => (
                      <tr key={s.id}>
                        <td className="num text-sm">{s.statement_number}</td>
                        <td className="text-sm text-brand-ink">{monthLabel(s.period_month)}</td>
                        <td className="text-sm text-brand-charcoal">{s.supplier_name}</td>
                        <td className="text-right num">{money(s.opening_outstanding)}</td>
                        <td className="text-right num">{s.units_sold}</td>
                        <td className="text-right num">{money(s.total_payable)}</td>
                        <td className="text-right num">{money(s.total_paid)}</td>
                        <td className="text-right num font-medium">{money(s.outstanding)}</td>
                        <td className="text-xs text-brand-muted">{fmtDate(s.generated_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      <SupplierDetail
        supplier={detail} onClose={() => setDetail(null)}
        onPay={(s) => { setDetail(null); setPayOpen({ supplier: s }); }}
        onStatement={(s) => { setDetail(null); setStatementOpen(s); }}
        onEdit={() => { setDetail(null); setEditOpen(true); }}
        onChanged={() => { payables.reload(); suppliers.reload(); }}
      />

      <SupplierFormModal
        open={editOpen} onClose={() => setEditOpen(false)}
        onDone={() => { suppliers.reload(); payables.reload(); }}
      />

      <SupplierPaymentModal
        target={payOpen} onClose={() => setPayOpen(null)}
        onDone={() => { payables.reload(); payments.reload(); statements.reload(); }}
      />

      <StatementModal
        target={statementOpen} onClose={() => setStatementOpen(null)}
        onDone={() => { statements.reload(); payables.reload(); }}
        push={push}
      />
    </div>
  );
}

/* ------------------------------- detail drawer ----------------------------- */

function SupplierDetail({
  supplier, onClose, onPay, onStatement, onEdit, onChanged,
}: {
  supplier: Supplier | null; onClose: () => void;
  onPay: (s: Supplier) => void; onStatement: (s: Supplier) => void; onEdit: (s: Supplier) => void;
  onChanged: () => void;
}) {
  const open = Boolean(supplier);
  const orders = useAsync(
    () => supplier
      ? fetchSupplierPayables(supplier.id)
      : Promise.resolve(null),
    [supplier?.id],
    { enabled: open },
  );

  return (
    <Drawer open={open} onClose={onClose} title={supplier?.name ?? ''}>
      {supplier && (
        <div className="space-y-4">
          <Card>
            <SectionHeader
              title={supplier.supplier_code}
              subtitle={[supplier.contact_name, supplier.phone, supplier.email].filter(Boolean).join(' · ') || 'No contact details'}
              action={<Button size="sm" variant="ghost" onClick={() => onEdit(supplier)}>Edit</Button>}
            />
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-brand-muted text-xs">TIN</dt><dd className="text-brand-ink">{supplier.tin_number || '—'}</dd></div>
              <div><dt className="text-brand-muted text-xs">Terms</dt><dd className="text-brand-ink">{supplier.payment_terms || '—'}</dd></div>
              <div className="col-span-2"><dt className="text-brand-muted text-xs">Address</dt><dd className="text-brand-ink">{supplier.address || '—'}</dd></div>
            </dl>
          </Card>

          {orders.loading ? <LoadingBlock rows={3} /> : orders.data && (
            <>
              {orders.data.suppliers.filter((s) => s.supplier_code === supplier.supplier_code).map((s) => (
                <div key={s.supplier_code} className="grid grid-cols-3 gap-3">
                  <StatCard label="Payable" value={money(s.total_payable)} />
                  <StatCard label="Paid" value={money(s.total_paid)} />
                  <StatCard label="Outstanding" value={money(s.outstanding)} tone={s.outstanding > 0 ? 'warn' : 'good'} />
                </div>
              ))}

              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => onPay(supplier)}>Record payment</Button>
                <Button size="sm" variant="secondary" onClick={() => onStatement(supplier)}>Generate statement</Button>
              </div>

              <div>
                <p className="section-title mb-2">Recent payable lines</p>
                {orders.data.lines.filter((l) =>
                  l.supplier_name === supplier.name).slice(0, 8).length === 0
                  ? <p className="text-sm text-brand-muted">No units sold from this supplier yet.</p>
                  : (
                    <div className="table-wrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Date</th><th>Product</th>
                            <th className="text-right">Units</th>
                            <th className="text-right">Cost</th>
                            <th className="text-right">Payable</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {orders.data.lines
                            .filter((l) => l.supplier_name === supplier.name)
                            .slice(0, 8)
                            .map((l, i) => (
                              <tr key={`${l.batch_number}-${i}`}>
                                <td className="text-xs text-brand-muted whitespace-nowrap">{fmtDate(l.entry_date)}</td>
                                <td className="text-sm text-brand-ink">{l.product_name}</td>
                                <td className="text-right num">{l.quantity_sold}</td>
                                <td className="text-right num">{money(l.purchase_cost)}</td>
                                <td className="text-right num">{money(l.payable_amount)}</td>
                                <td>
                                  <span className={l.status === 'PAID' ? 'chip-green' : l.status === 'PARTIAL' ? 'chip-amber' : 'chip-slate'}>
                                    {titleCase(l.status)}
                                  </span>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
              </div>

              <SupplierNotes supplierId={supplier.id} onChanged={onChanged} />
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}

/** Free-text notes about a supplier. Operational notes only — never balances. */
function SupplierNotes({ supplierId, onChanged }: { supplierId: string; onChanged: () => void }) {
  const { push } = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const notes = useAsync(
    () => listSupplierNotes(supplierId),
    [supplierId],
  );

  const add = async () => {
    if (note.trim().length < 3) return;
    setBusy(true);
    try {
      await rpc('rpc_add_supplier_note', { p_supplier_id: supplierId, p_note: note.trim() });
      setNote('');
      notes.reload();
      onChanged();
      push({ tone: 'success', title: 'Note added' });
    } catch (err) {
      push({ tone: 'error', title: 'Could not add the note', body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="section-title mb-2">Notes</p>
      <div className="space-y-2 mb-3">
        {(notes.data ?? []).map((n) => (
          <div key={n.id} className="rounded-xl bg-brand-soft p-3">
            <p className="text-sm text-brand-charcoal">{n.note}</p>
            <p className="text-xs text-brand-muted mt-1">
              {n.created_by_name || 'Owner'} · {fmtDate(n.created_at)}
            </p>
          </div>
        ))}
        {notes.data?.length === 0 && <p className="text-sm text-brand-muted">No notes yet.</p>}
      </div>
      <div className="flex gap-2">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Delivery every Tuesday" />
        <Button onClick={add} loading={busy} disabled={note.trim().length < 3}>Add</Button>
      </div>
    </div>
  );
}

/* --------------------------------- modals --------------------------------- */

function SupplierFormModal({
  open, onClose, onDone,
}: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const [form, setForm] = useState({
    name: '', contact_name: '', phone: '', email: '', address: '',
    tin_number: '', payment_terms: '', notes: '',
  });
  const [busy, setBusy] = useState(false);
  const accounts = useAsync(() => fetchSupplierAccounts(), []);
  const users = useAsync(() => listStaff(), []);
  const [portalUserId, setPortalUserId] = useState('');

  /** Login accounts that hold the Supplier role and are not yet linked. */
  const linkableUsers = (users.data ?? []).filter((u) => u.role === 'SUPPLIER');
  const linkFor = (userId: string) => (accounts.data ?? []).find((a) => a.user_id === userId) ?? null;

  const submit = async () => {
    if (form.name.trim().length < 2) {
      push({ tone: 'error', title: 'A supplier needs a name' });
      return;
    }
    setBusy(true);
    try {
      const res = await upsertSupplier({ ...form, name: form.name.trim() });
      if (portalUserId) {
        // The link is a database fact: the supplier's own token is what later
        // reveals their transactions, and only theirs (§51).
        await linkSupplierUser(res.supplier_id, portalUserId);
      }
      push({
        tone: 'success',
        title: `Supplier ${res.supplier_code} saved`,
        body: portalUserId ? 'Portal access linked.' : undefined,
      });
      onClose(); onDone();
      setForm({ name: '', contact_name: '', phone: '', email: '', address: '', tin_number: '', payment_terms: '', notes: '' });
    } catch (err) {
      push({ tone: 'error', title: 'Could not save the supplier', body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open} onClose={onClose} title="Add supplier" size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy}>Save supplier</Button>
        </>
      }
    >
      <Field label="Supplier name" required>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. ABC Cosmetics Import" />
      </Field>
      <div className="grid sm:grid-cols-2 gap-x-4">
        <Field label="Contact person">
          <Input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
        </Field>
        <Field label="Phone">
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+251 …" />
        </Field>
      </div>
      <div className="grid sm:grid-cols-2 gap-x-4">
        <Field label="Email">
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="TIN number">
          <Input value={form.tin_number} onChange={(e) => setForm({ ...form, tin_number: e.target.value })} />
        </Field>
      </div>
      <Field label="Address">
        <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      </Field>
      <Field label="Payment terms" hint="Free text for your own reference, e.g. 30 days.">
        <Input value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })} />
      </Field>
      <Field label="Notes">
        <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </Field>

      <div className="mt-4 pt-4 border-t border-brand-line">
        <p className="section-title mb-1">Supplier portal access</p>
        <p className="text-xs text-brand-muted mb-3">
          A supplier with a login sees only their own transactions, payables and statements. Their
          access is read-only and scoped in the database, not by hiding menu items.
        </p>
        <Field label="Link an existing account">
          <Select value={portalUserId} onChange={(e) => setPortalUserId(e.target.value)}>
            <option value="">Not linked</option>
            {linkableUsers.map((u) => {
              const linked = linkFor(u.id);
              return (
                <option key={u.id} value={u.id}>
                  {u.full_name} · {u.email}
                  {linked ? ' (already linked elsewhere)' : ''}
                </option>
              );
            })}
          </Select>
        </Field>
        <p className="text-xs text-brand-muted">
          Create the account first in Staff &amp; Access with the Supplier role, then link it here.
          {linkableUsers.length === 0 && ' There are no accounts with the Supplier role yet.'}
        </p>
      </div>
    </Modal>
  );
}

export function SupplierPaymentModal({
  target, onClose, onDone,
}: { target: { supplier: Supplier } | null; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const [amount, setAmount] = useState<number | ''>('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const payables = useAsync(
    () => target ? fetchSupplierPayables(target.supplier.id) : Promise.resolve(null),
    [target?.supplier.id],
    { enabled: Boolean(target) },
  );

  const outstanding = useMemo(() => {
    if (!payables.data) return 0;
    return payables.data.suppliers
      .filter((s) => s.supplier_code === target?.supplier.supplier_code)
      .reduce((sum, s) => sum + Number(s.outstanding), 0);
  }, [payables.data, target]);

  const submit = async () => {
    if (!target || amount === '') return;
    if (Number(amount) <= 0) {
      push({ tone: 'error', title: 'Enter an amount greater than zero' });
      return;
    }
    setBusy(true);
    try {
      const res = await recordSupplierPayment({
        supplierId: target.supplier.id, amount: Number(amount), paymentMethod: method,
        paymentDate: date, reference: reference || null, notes: notes || null,
      });
      push({
        tone: 'success',
        title: `Payment ${res.payment_number} recorded`,
        body: res.remaining_outstanding > 0
          ? `${money(res.applied)} settled · ${money(res.remaining_outstanding)} still outstanding.`
          : 'This supplier is fully settled.',
      });
      onClose(); onDone();
      setAmount(''); setReference(''); setNotes('');
    } catch (err) {
      push({ tone: 'error', title: 'Payment failed', body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(target)} onClose={onClose} title="Record a supplier payment" size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={amount === ''}>Record payment</Button>
        </>
      }
    >
      {target && (
        <div className="space-y-3">
          <div className="rounded-xl bg-brand-soft p-3">
            <p className="text-sm font-medium text-brand-ink">{target.supplier.name}</p>
            <p className="text-xs text-brand-muted num">
              Outstanding right now: {money(outstanding)} Birr
            </p>
          </div>

          <Field label="Amount paid" required>
            <MoneyInput value={amount} onValueChange={setAmount} />
          </Field>
          {typeof amount === 'number' && amount > outstanding && (
            <p className="text-xs text-state-amber">
              That is more than the outstanding balance. The database will refuse to overpay — pay the
              recorded balance or add the difference later as a new payable.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Method">
              <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                <option value="CASH">Cash</option>
                <option value="BANK">Bank transfer</option>
                <option value="TELEBIRR">Telebirr</option>
              </Select>
            </Field>
            <Field label="Date">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Reference" hint="Cheque number, transaction id…">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>

          <p className="text-xs text-brand-muted">
            The payment is applied to the oldest unpaid lines first. It is recorded as a settlement
            and will <strong>not</strong> appear as an expense in the P&amp;L.
          </p>
        </div>
      )}
    </Modal>
  );
}

function StatementModal({
  target, onClose, onDone, push,
}: {
  target: Supplier | null; onClose: () => void; onDone: () => void;
  push: (t: { tone: 'success' | 'error' | 'info'; title: string; body?: string }) => void;
}) {
  const suppliers = useAsync(() => listSuppliers(), []);
  const [supplierId, setSupplierId] = useState('');
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<null | {
    statement_number: string; period_month: string; opening_outstanding: number;
    units_sold: number; total_payable: number; total_paid: number; outstanding: number;
  }>(null);

  const effectiveSupplier = supplierId || target?.id || '';

  const run = async () => {
    if (!effectiveSupplier) {
      push({ tone: 'error', title: 'Choose a supplier' });
      return;
    }
    setBusy(true);
    try {
      const res = await generateSupplierStatement(effectiveSupplier, `${month}-01`);
      setResult(res);
      onDone();
      push({ tone: 'success', title: `Statement ${res.statement_number} generated` });
    } catch (err) {
      push({ tone: 'error', title: 'Could not generate the statement', body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const shareText = result ? [
    `LuBella Cosmetics & Accessories`,
    `Supplier statement ${result.statement_number}`,
    `Period: ${monthLabel(result.period_month)}`,
    ``,
    `Opening balance: ${money(result.opening_outstanding)} Birr`,
    `Units sold this month: ${result.units_sold}`,
    `Payable this month: ${money(result.total_payable)} Birr`,
    `Paid this month: ${money(result.total_paid)} Birr`,
    `Outstanding: ${money(result.outstanding)} Birr`,
    ``,
    `Totals are computed from sold units at the purchase cost we agreed.`,
  ].join('\n') : '';

  return (
    <Modal
      open={Boolean(target) || Boolean(supplierId)} onClose={() => { setResult(null); onClose(); }}
      title="Generate a supplier statement" size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => { setResult(null); onClose(); }} disabled={busy}>Close</Button>
          <Button onClick={run} loading={busy}>{result ? 'Regenerate' : 'Generate'}</Button>
        </>
      }
    >
      <Field label="Supplier" required>
        <Select value={effectiveSupplier} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">Select a supplier…</option>
          {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </Field>
      <Field label="Month" required>
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </Field>

      {result && (
        <div className="rounded-xl border border-brand-line p-3 mt-2 space-y-2">
          <p className="text-sm font-medium text-brand-ink num">{result.statement_number}</p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <span className="text-brand-muted">Opening balance</span>
            <span className="text-right num">{money(result.opening_outstanding)}</span>
            <span className="text-brand-muted">Units sold</span>
            <span className="text-right num">{result.units_sold}</span>
            <span className="text-brand-muted">Payable this month</span>
            <span className="text-right num">{money(result.total_payable)}</span>
            <span className="text-brand-muted">Paid this month</span>
            <span className="text-right num">{money(result.total_paid)}</span>
            <span className="font-medium text-brand-ink">Outstanding</span>
            <span className="text-right num font-semibold">{money(result.outstanding)}</span>
          </div>
          <div className="flex gap-2 pt-1">
            <Button
              size="sm" variant="secondary"
              onClick={() => { void navigator.clipboard.writeText(shareText); push({ tone: 'success', title: 'Statement copied' }); }}
            >
              Copy as text
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
