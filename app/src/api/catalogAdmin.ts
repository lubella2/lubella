/**
 * Owner-side catalogue, staff, supplier and settings administration.
 *
 * Only the read side uses table selects; every write is an RPC so that the
 * database, not the browser, decides who may do what.
 */
import { rpc, select, supabase } from '../lib/supabase';
import type {
  AppUser, BackupStatus, Category, SettingsMap, Supplier, UserRole,
} from '../types';

/* ----------------------------- products ---------------------------------- */

export interface ProductInput {
  name: string;
  selling_price: number;
  category_id?: string | null;
  brand?: string | null;
  supplier_id?: string | null;
  image_url?: string | null;
  minimum_stock?: number;
  expiry_date?: string | null;
  description?: string | null;
  keywords?: string | null;
  featured?: boolean;
  active?: boolean;
  is_public?: boolean;
}

export async function createProduct(input: ProductInput & {
  opening_stock?: number;
  opening_cost?: number | null;
}) {
  return rpc<{ product_id: string; product_code: string; quantity_on_hand: number }>(
    'rpc_create_product',
    {
      p_name: input.name,
      p_selling_price: input.selling_price,
      p_category_id: input.category_id || null,
      p_brand: input.brand || null,
      p_supplier_id: input.supplier_id || null,
      p_image_url: input.image_url || null,
      p_minimum_stock: input.minimum_stock ?? 5,
      p_expiry_date: input.expiry_date || null,
      p_description: input.description || null,
      p_keywords: input.keywords || null,
      p_featured: input.featured ?? false,
      p_opening_stock: input.opening_stock ?? 0,
      p_opening_cost: input.opening_cost ?? null,
    },
  );
}

export async function updateProduct(productId: string, input: Partial<ProductInput> & {
  reason?: string;
}) {
  return rpc<{ product_id: string; selling_price: number }>('rpc_update_product', {
    p_product_id: productId,
    p_name: input.name ?? null,
    p_selling_price: input.selling_price ?? null,
    p_category_id: input.category_id ?? null,
    p_brand: input.brand ?? null,
    p_supplier_id: input.supplier_id ?? null,
    p_image_url: input.image_url ?? null,
    p_minimum_stock: input.minimum_stock ?? null,
    p_expiry_date: input.expiry_date ?? null,
    p_description: input.description ?? null,
    p_keywords: input.keywords ?? null,
    p_featured: input.featured ?? null,
    p_active: input.active ?? null,
    p_is_public: input.is_public ?? null,
    p_reason: input.reason ?? null,
  });
}

/* ---------------------------- categories --------------------------------- */

export async function upsertCategory(input: {
  name: string; id?: string; description?: string | null;
  image_url?: string | null; sort_order?: number; active?: boolean;
}) {
  return rpc<{ category_id: string; slug: string }>('rpc_upsert_category', {
    p_name: input.name,
    p_category_id: input.id ?? null,
    p_description: input.description ?? null,
    p_image_url: input.image_url ?? null,
    p_sort_order: input.sort_order ?? 0,
    p_active: input.active ?? null,
  });
}

/* ------------------------------ suppliers -------------------------------- */

export async function upsertSupplier(input: {
  name: string; supplier_id?: string; contact_name?: string | null;
  phone?: string | null; email?: string | null; address?: string | null;
  tin_number?: string | null; payment_terms?: string | null; active?: boolean;
}) {
  return rpc<{ supplier_id: string; supplier_code: string }>('rpc_upsert_supplier', {
    p_name: input.name,
    p_supplier_id: input.supplier_id ?? null,
    p_contact_name: input.contact_name ?? null,
    p_phone: input.phone ?? null,
    p_email: input.email ?? null,
    p_address: input.address ?? null,
    p_tin_number: input.tin_number ?? null,
    p_payment_terms: input.payment_terms ?? null,
    p_active: input.active ?? null,
  });
}

export async function linkSupplierUser(supplierId: string, userId: string, status = 'ACTIVE') {
  return rpc<{ supplier_user_id: string; status: string }>('rpc_link_supplier_user', {
    p_supplier_id: supplierId,
    p_user_id: userId,
    p_status: status,
  });
}

export async function setSupplierUserStatus(linkId: string, status: 'ACTIVE' | 'DISABLED') {
  return rpc('rpc_set_supplier_user_status', { p_supplier_user_id: linkId, p_status: status });
}

export async function fetchSupplierAccounts() {
  return select<{
    id: string; supplier_id: string; user_id: string; status: string; created_at: string;
  }>('supplier_users', { order: 'created_at.desc' });
}

/* -------------------------------- staff ---------------------------------- */

/**
 * Creates a login. The auth user is created by the server (Edge Function on
 * Supabase, gateway locally) using the service key; the browser only ever sends
 * the request and receives the result.
 */
export async function createAppUser(input: {
  email: string;
  password: string;
  fullName: string;
  role: UserRole;
  phone?: string | null;
  commissionRate?: number;
}) {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || `${window.location.origin}/api`;
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error('Your session has expired. Please sign in again.');

  const res = await fetch(`${base}/functions/v1/admin-create-user`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.message || 'Could not create the account.');
  return payload as { userId: string };
}

export async function updateStaff(input: {
  userId: string; full_name?: string; phone?: string | null;
  commission_rate?: number; active?: boolean; note?: string | null;
}) {
  return rpc('rpc_update_staff', {
    p_user_id: input.userId,
    p_full_name: input.full_name ?? null,
    p_phone: input.phone ?? null,
    p_commission_rate: input.commission_rate ?? null,
    p_active: input.active ?? null,
    p_note: input.note ?? null,
  });
}

/* ------------------------------- settings -------------------------------- */

export async function fetchAdminSettings(): Promise<Record<string, { value: unknown; is_public: boolean; description: string | null }>> {
  return rpc('rpc_settings_for_admin');
}

export async function updateSettings(settings: SettingsMap) {
  return rpc<{ updated: number; settings: SettingsMap }>('rpc_update_settings', { p_settings: settings });
}

export async function fetchBackupStatus(): Promise<BackupStatus> {
  return rpc<BackupStatus>('rpc_backup_status');
}

export async function recordBackupRun(input: {
  status: string; sizeBytes?: number | null; tableCount?: number | null;
  rowCount?: number | null; storageFiles?: number | null; location?: string | null; notes?: string | null;
}) {
  return rpc('rpc_record_backup_run', {
    p_status: input.status,
    p_size_bytes: input.sizeBytes ?? null,
    p_table_count: input.tableCount ?? null,
    p_row_count: input.rowCount ?? null,
    p_storage_files: input.storageFiles ?? null,
    p_location: input.location ?? null,
    p_notes: input.notes ?? null,
  });
}

/* -------------------------------- audit ---------------------------------- */

export async function fetchAuditLog(params: {
  action?: string | null; entityType?: string | null;
  from?: string | null; to?: string | null; limit?: number; offset?: number;
}) {
  return rpc<{ items: import('../types').AuditRow[]; count: number }>('rpc_audit_log', {
    p_action: params.action ?? null,
    p_entity_type: params.entityType ?? null,
    p_from: params.from ?? null,
    p_to: params.to ?? null,
    p_limit: params.limit ?? 100,
    p_offset: params.offset ?? 0,
  });
}

export async function fetchAuditActions(): Promise<string[]> {
  return rpc<string[]>('rpc_audit_actions');
}

/* ------------------------------ image upload ----------------------------- */

/**
 * Product images go to Supabase Storage. The database only ever stores the URL,
 * so replacing a photo cannot affect a product's id, its sales or its history
 * (§26).
 */
export async function uploadProductImage(file: File, productCode: string): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) ? ext : 'jpg';
  const path = `products/${productCode.toLowerCase()}-${Date.now()}.${safeExt}`;

  const { error } = await supabase.storage.from('product-images').upload(path, file, {
    cacheControl: '3600',
    upsert: true,
    contentType: file.type || `image/${safeExt}`,
  });
  if (error) throw new Error(error.message || 'The image could not be uploaded.');

  const { data } = supabase.storage.from('product-images').getPublicUrl(path);
  return data.publicUrl;
}

export async function listCategoriesAdmin(): Promise<Category[]> {
  return select<Category>('categories', { order: 'sort_order.asc' });
}

export async function listSuppliers(): Promise<Supplier[]> {
  return select<Supplier>('suppliers', { order: 'name.asc' });
}

export async function listStaff(): Promise<AppUser[]> {
  return select<AppUser>('app_users', { order: 'role.asc' });
}
