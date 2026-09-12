/**
 * Supplier portal.
 *
 * Every read goes through `supplier_portal_*` views, which are filtered by
 * fn_current_supplier_id() inside the database. A supplier cannot widen these
 * results from the browser: the filter is part of the view definition, not a
 * query parameter. Selling price, LuBella margin, other suppliers and owner
 * notes are absent from the view definitions entirely.
 */
import { rpc, select } from '../lib/supabase';
import type {
  SupplierOrder, SupplierPayment, SupplierReceipt, SupplierStatement, SupplierSummary, Supplier,
} from '../types';

export async function fetchSupplierSummary(): Promise<SupplierSummary | null> {
  const rows = await select<SupplierSummary>('supplier_portal_summary', { limit: 1 });
  return rows[0] ?? null;
}

export async function fetchSupplierProfile(): Promise<Supplier | null> {
  const rows = await select<Supplier>('supplier_portal_profile', { limit: 1 });
  return rows[0] ?? null;
}

export async function fetchSupplierReceipts(): Promise<SupplierReceipt[]> {
  return select<SupplierReceipt>('supplier_portal_receipts', { order: 'received_date.desc' });
}

export async function fetchSupplierOrders(): Promise<SupplierOrder[]> {
  return select<SupplierOrder>('supplier_portal_orders', { order: 'entry_date.desc' });
}

export async function fetchSupplierPayments(): Promise<SupplierPayment[]> {
  return select<SupplierPayment>('supplier_portal_payments', { order: 'payment_date.desc' });
}

export async function fetchSupplierStatements(): Promise<SupplierStatement[]> {
  return select<SupplierStatement>('supplier_portal_statements', { order: 'period_month.desc' });
}

/**
 * The supplier keeps their own contact details current.
 *
 * The database picks the row from the caller's own supplier link and only
 * touches the four contact fields — the supplier name, TIN, payment terms and
 * the whole financial history are out of reach from a supplier session (§51).
 */
export async function updateSupplierProfile(input: {
  contactName?: string | null; phone?: string | null;
  email?: string | null; address?: string | null; notes?: string | null;
}) {
  return rpc<{ supplier_id: string; updated: boolean }>('rpc_update_supplier_contact', {
    p_contact_name: input.contactName ?? null,
    p_phone: input.phone ?? null,
    p_email: input.email ?? null,
    p_address: input.address ?? null,
    p_notes: input.notes ?? null,
  });
}
