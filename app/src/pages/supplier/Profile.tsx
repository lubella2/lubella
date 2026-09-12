import { useEffect, useState } from 'react';
import { fmtDate, titleCase } from '../../lib/format';
import {
  Button, Card, EmptyState, ErrorState, Field, Input, LoadingBlock, SectionHeader, Textarea, useToast,
} from '../../components/ui';
import { fetchSupplierProfile, updateSupplierProfile } from '../../api/supplier';
import { useAsync } from '../../lib/hooks';
import { useAuth } from '../../lib/auth';

/**
 * The supplier's own details.
 *
 * A supplier can keep their contact information and delivery notes current, and
 * nothing else. Commercial terms — the price agreed per batch — are set by the
 * shop, and the account balance is derived from transactions, so neither is
 * editable from here.
 */
export default function SupplierProfile() {
  const { push } = useToast();
  const { profile } = useAuth();
  const supplier = useAsync(() => fetchSupplierProfile(), []);

  const [form, setForm] = useState({
    contact_name: '', phone: '', email: '', address: '', notes: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!supplier.data) return;
    setForm({
      contact_name: supplier.data.contact_name ?? '',
      phone: supplier.data.phone ?? '',
      email: supplier.data.email ?? '',
      address: supplier.data.address ?? '',
      notes: '',
    });
  }, [supplier.data]);

  if (supplier.loading) return <LoadingBlock rows={5} />;
  if (supplier.error) return <ErrorState message={supplier.error} onRetry={supplier.reload} />;
  if (!supplier.data) return <EmptyState title="No supplier record" description="This account is not linked to a supplier yet. Ask the shop owner to link it." />;

  const s = supplier.data;

  const save = async () => {
    setSaving(true);
    try {
      await updateSupplierProfile({
        contactName: form.contact_name || null,
        phone: form.phone || null,
        email: form.email || null,
        address: form.address || null,
        notes: form.notes || null,
      });
      push({ tone: 'success', title: 'Your details were updated', body: 'The shop can see the new contact information.' });
      setForm((f) => ({ ...f, notes: '' }));
      supplier.reload();
    } catch (err) {
      push({ tone: 'error', title: 'Could not save your details', body: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-brand-ink">Our details</h1>
        <p className="text-sm text-brand-muted">
          Signed in as {profile?.full_name} ({profile?.email}).
        </p>
      </div>

      <Card>
        <SectionHeader
          title={s.name}
          subtitle={`Supplier code ${s.supplier_code}`}
          action={<span className={s.active ? 'chip-green' : 'chip-slate'}>{s.active ? 'Active' : 'Inactive'}</span>}
        />
        <dl className="grid sm:grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-brand-muted">TIN number</dt>
            <dd className="text-brand-ink num">{s.tin_number || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-brand-muted">Payment terms</dt>
            <dd className="text-brand-ink">{s.payment_terms ? titleCase(s.payment_terms) : '—'}</dd>
          </div>
        </dl>
        <p className="text-xs text-brand-muted mt-3">
          Your supplier name, TIN and payment terms are held by the shop and can only be changed by the
          owner — they are part of the commercial record.
        </p>
      </Card>

      <Card>
        <SectionHeader title="Update your contact details" subtitle="Keep these current so the shop can reach you." />
        <div className="grid sm:grid-cols-2 gap-x-4">
          <Field label="Contact person">
            <Input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+251 …" />
          </Field>
        </div>
        <Field label="Email">
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Address">
          <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </Field>
        <Field label="Note to the shop" hint="Optional message that appears with your details.">
          <Textarea
            value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="e.g. Deliveries on Tuesdays and Fridays"
          />
        </Field>
        <Button onClick={save} loading={saving}>Save details</Button>
      </Card>

      <Card className="bg-brand-soft border-brand-line">
        <SectionHeader title="Your account and access" />
        <ul className="text-sm text-brand-charcoal space-y-1.5 list-disc pl-5">
          <li>
            This login shows only your own supplier's transactions, batches, payables, payments and
            statements — no other supplier's data is reachable, whatever the browser asks for.
          </li>
          <li>
            Everything you see is read-only except your contact details. The shop's selling prices,
            its other costs and its profit are not available to supplier accounts.
          </li>
          <li>
            If you believe a figure is wrong, quote the batch number or payment number from the
            relevant page so the shop can trace it to the transaction.
          </li>
          <li>
            Access can be suspended by the shop without deleting any history — records stay intact and
            become visible again if the link is restored.
          </li>
        </ul>
        <p className="text-xs text-brand-muted mt-3">
          Statement of your account as at {fmtDate(new Date())}. Figures are derived from recorded
          transactions, not entered by hand.
        </p>
      </Card>
    </div>
  );
}
