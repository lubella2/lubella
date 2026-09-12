import { useMemo, useState } from 'react';
import { money } from '../../lib/format';
import {
  Button, Card, Checkbox, EmptyState, ErrorState, Field, FilterChips, Input, Modal,
  MoneyInput, Select, Textarea, useToast,
} from '../../components/ui';
import {
  createProduct, fetchSupplierAccounts, listCategoriesAdmin, listSuppliers,
  updateProduct, uploadProductImage, type ProductInput,
} from '../../api/catalogAdmin';
import { useAsync, useDebounced } from '../../lib/hooks';
import { select } from '../../lib/supabase';
import type { StaffProduct } from '../../types';

const EMPTY: ProductInput = {
  name: '', selling_price: 0, category_id: null, brand: '', supplier_id: null,
  image_url: null, minimum_stock: 5, expiry_date: null, description: '', keywords: '',
  featured: false, active: true, is_public: true,
};

/**
 * Product management.
 *
 * Notice what is absent from this form: there is no purchase-cost field. Cost
 * belongs to a received batch, so it is captured in Restock where the shipment
 * it belongs to can be identified — that is what keeps FIFO and supplier
 * payables correct (§25).
 */
export default function OwnerProducts() {
  const { push } = useToast();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [editing, setEditing] = useState<StaffProduct | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<ProductInput & { opening_stock?: number; opening_cost?: number | null }>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const debounced = useDebounced(search, 250);

  const products = useAsync(
    () => select<StaffProduct>('v_staff_products', { order: 'name.asc' }),
    [],
  );
  const categories = useAsync(() => listCategoriesAdmin(), []);
  const suppliers = useAsync(() => listSuppliers(), []);
  const accounts = useAsync(() => fetchSupplierAccounts(), []);

  const filtered = useMemo(() => {
    const list = products.data ?? [];
    const term = debounced.trim().toLowerCase();
    return list.filter((p) => {
      if (categoryId && p.category_id !== categoryId) return false;
      if (!term) return true;
      return p.name.toLowerCase().includes(term)
        || (p.brand || '').toLowerCase().includes(term)
        || p.product_code.toLowerCase().includes(term);
    });
  }, [products.data, debounced, categoryId]);

  const openNew = () => {
    setEditing(null);
    setDraft({ ...EMPTY, category_id: categories.data?.[0]?.id ?? null });
    setFormOpen(true);
  };

  const openEdit = async (p: StaffProduct) => {
    setEditing(p);
    setDraft({
      name: p.name, selling_price: p.selling_price, category_id: p.category_id,
      brand: p.brand, supplier_id: p.supplier_id, image_url: p.image_url,
      minimum_stock: p.minimum_stock, expiry_date: p.expiry_date,
      description: p.description, featured: false, active: p.active, is_public: true,
    });
    setFormOpen(true);
  };

  const save = async () => {
    if (!draft.name.trim()) {
      push({ tone: 'error', title: 'A product needs a name' });
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateProduct(editing.id, { ...draft, reason: 'Updated in Products' });
        push({ tone: 'success', title: `${draft.name} updated` });
      } else {
        const created = await createProduct(draft);
        push({
          tone: 'success',
          title: `${created.product_code} created`,
          body: draft.opening_stock ? `Opening stock of ${draft.opening_stock} recorded as a costed batch.` : undefined,
        });
      }
      setFormOpen(false);
      products.reload();
      if (draft.selling_price !== editing?.selling_price && editing) {
        push({ tone: 'info', title: 'Price change recorded', body: 'Past sales keep the price they were sold at.' });
      }
    } catch (err) {
      push({ tone: 'error', title: 'Could not save', body: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const url = await uploadProductImage(file, editing?.product_code || 'new');
      setDraft((d) => ({ ...d, image_url: url }));
      push({ tone: 'success', title: 'Image uploaded', body: 'Save the product to apply it.' });
    } catch (err) {
      push({ tone: 'error', title: 'Upload failed', body: (err as Error).message });
    } finally {
      setUploading(false);
    }
  };

  const ownerOfProduct = (supplierId: string | null) =>
    accounts.data?.find((a) => a.supplier_id === supplierId)?.user_id;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-ink">Products</h1>
          <p className="text-sm text-brand-muted">
            {products.data?.length ?? 0} products · selling prices only (cost lives on each received batch)
          </p>
        </div>
        <Button onClick={openNew}>Add product</Button>
      </div>

      <Card>
        <div className="flex flex-col sm:flex-row gap-3">
          <Input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, brand or code" className="sm:max-w-xs"
          />
          <div className="flex-1">
            <FilterChips
              allLabel="All categories" value={categoryId} onChange={setCategoryId}
              options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>
        </div>
      </Card>

      {products.loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-16" />)}</div>
      ) : products.error ? (
        <ErrorState message={products.error} onRetry={products.reload} />
      ) : filtered.length === 0 ? (
        <Card><EmptyState title="No products" description="Add your first product to start selling."
          action={<Button onClick={openNew}>Add product</Button>} /></Card>
      ) : (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th className="text-right">Selling price</th>
                  <th className="text-right">On hand</th>
                  <th>Supplier</th>
                  <th>Expiry</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <div className="h-9 w-9 rounded-lg bg-brand-soft overflow-hidden shrink-0">
                          {p.image_url && <img src={p.image_url} alt="" className="w-full h-full object-cover" />}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-brand-ink truncate">{p.name}</p>
                          <p className="text-xs text-brand-muted">
                            {p.product_code}{p.brand ? ` · ${p.brand}` : ''}
                            {!p.active && ' · inactive'}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="text-brand-charcoal">{p.category_name || '—'}</td>
                    <td className="text-right num">{money(p.selling_price)}</td>
                    <td className="text-right num">
                      <span className={p.is_out_of_stock ? 'text-state-red' : p.is_low_stock ? 'text-[#8a6318]' : ''}>
                        {p.quantity_on_hand}
                      </span>
                      <span className="text-brand-muted text-xs"> / min {p.minimum_stock}</span>
                    </td>
                    <td className="text-brand-charcoal text-sm">{p.supplier_name || '—'}</td>
                    <td>
                      {p.expiry_date ? (
                        <span className={
                          p.expiry_status === 'EXPIRED' ? 'chip-red'
                            : p.expiry_status === 'EXPIRING_SOON' ? 'chip-amber' : 'chip-slate'
                        }>
                          {p.expiry_status === 'EXPIRED' ? 'Expired' : p.expiry_status === 'EXPIRING_SOON' ? 'Soon' : 'OK'}
                        </span>
                      ) : <span className="text-brand-muted">—</span>}
                    </td>
                    <td className="text-right">
                      <Button size="sm" variant="secondary" onClick={() => void openEdit(p)}>Edit</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal
        open={formOpen} onClose={() => setFormOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'Add product'} size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} loading={saving}>{editing ? 'Save changes' : 'Create product'}</Button>
          </>
        }
      >
        <Field label="Product name" required>
          <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Maybelline Lipstick" />
        </Field>

        <div className="grid sm:grid-cols-2 gap-x-4">
          <Field label="Selling price" required hint="What the customer pays. Not the cost.">
            <MoneyInput value={draft.selling_price} onValueChange={(v) => setDraft({ ...draft, selling_price: v === '' ? 0 : v })} />
          </Field>
          <Field label="Minimum stock" hint="Drives the 🟡 Low Stock band customers see.">
            <Input
              type="number" min={0} value={draft.minimum_stock}
              onChange={(e) => setDraft({ ...draft, minimum_stock: Number(e.target.value) || 0 })}
            />
          </Field>
        </div>

        <div className="grid sm:grid-cols-2 gap-x-4">
          <Field label="Category">
            <Select value={draft.category_id ?? ''} onChange={(e) => setDraft({ ...draft, category_id: e.target.value || null })}>
              <option value="">No category</option>
              {(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Brand">
            <Input value={draft.brand ?? ''} onChange={(e) => setDraft({ ...draft, brand: e.target.value })} placeholder="e.g. Maybelline" />
          </Field>
        </div>

        <Field label="Supplier" hint="Used for restocking and the supplier credit book.">
          <Select value={draft.supplier_id ?? ''} onChange={(e) => setDraft({ ...draft, supplier_id: e.target.value || null })}>
            <option value="">No supplier</option>
            {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>

        {draft.supplier_id && ownerOfProduct(draft.supplier_id) && (
          <p className="text-xs text-state-green -mt-2 mb-3">
            This supplier has a portal login and will see their transactions for this product.
          </p>
        )}

        <div className="grid sm:grid-cols-2 gap-x-4">
          <Field label="Expiry date" hint="Expired products are blocked at the till.">
            <Input
              type="date" value={draft.expiry_date ?? ''}
              onChange={(e) => setDraft({ ...draft, expiry_date: e.target.value || null })}
            />
          </Field>
          <Field label="Image">
            <div className="flex items-center gap-3">
              <label className="btn-secondary btn btn-sm cursor-pointer">
                {uploading ? 'Uploading…' : draft.image_url ? 'Replace' : 'Upload'}
                <input
                  type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
                />
              </label>
              {draft.image_url && (
                <>
                  <img src={draft.image_url} alt="" className="h-10 w-10 rounded-lg object-cover border border-brand-line" />
                  <button
                    onClick={() => setDraft({ ...draft, image_url: null })}
                    className="text-xs text-state-red hover:underline"
                  >
                    Remove
                  </button>
                </>
              )}
            </div>
          </Field>
        </div>

        <Field label="Description" hint="Shown to customers.">
          <Textarea value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </Field>

        <Field label="Search keywords" hint="Extra words customers might type.">
          <Input value={draft.keywords ?? ''} onChange={(e) => setDraft({ ...draft, keywords: e.target.value })} placeholder="matte, long lasting, red" />
        </Field>

        <Checkbox
          label="Show in the customer catalogue"
          checked={draft.is_public ?? true}
          onChange={(v) => setDraft({ ...draft, is_public: v })}
          hint="Turn off to keep this product internal."
        />
        <Checkbox
          label="Feature on the home page"
          checked={draft.featured ?? false}
          onChange={(v) => setDraft({ ...draft, featured: v })}
        />
        {editing && (
          <Checkbox
            label="Product is active"
            checked={draft.active ?? true}
            onChange={(v) => setDraft({ ...draft, active: v })}
            hint="Inactive products cannot be sold."
          />
        )}

        {!editing && (
          <div className="mt-4 pt-4 border-t border-brand-line">
            <p className="section-title mb-2">Opening stock (optional)</p>
            <p className="text-xs text-brand-muted mb-3">
              Recorded as a costed purchase batch, which is what makes FIFO and supplier payables
              correct from day one. Leave at zero and receive it later through Restock.
            </p>
            <div className="grid sm:grid-cols-2 gap-x-4">
              <Field label="Quantity on hand now">
                <Input
                  type="number" min={0} value={draft.opening_stock ?? 0}
                  onChange={(e) => setDraft({ ...draft, opening_stock: Number(e.target.value) || 0 })}
                />
              </Field>
              <Field label="Purchase cost per unit" hint="What the supplier charges you.">
                <MoneyInput
                  value={draft.opening_cost ?? ''}
                  onValueChange={(v) => setDraft({ ...draft, opening_cost: v === '' ? null : v })}
                />
              </Field>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
