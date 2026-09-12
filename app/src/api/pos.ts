/**
 * Point of sale, returns and voids.
 *
 * The client sends intent; PostgreSQL does the arithmetic. A completed sale is
 * one database transaction covering stock validation, FIFO allocation, COGS,
 * supplier payables, commission and audit — so nothing here computes money, and
 * a failure anywhere rolls the whole thing back.
 */
import { ApiError, rpc, select } from '../lib/supabase';
import type {
  PaymentMethod, ReturnResult, SaleReceipt, SaleStatus, StaffProduct, StockConflict, VoidResult,
} from '../types';

export interface CartItemInput {
  product_id: string;
  quantity: number;
}

/**
 * Extracts the structured stock refusal so the POS can show the exact prompt
 * the spec requires (§32):
 *   «Only X units are currently available… Continue with X / Cancel»
 */
export function parseStockConflict(error: unknown): StockConflict | null {
  const err = error as ApiError;
  if (!err?.message) return null;
  if (!err.message.includes('INSUFFICIENT_STOCK')) return null;
  const hinted = (err.payload as { hint?: string })?.hint;
  if (hinted) {
    try {
      return JSON.parse(hinted) as StockConflict;
    } catch {
      /* fall through to the message form */
    }
  }
  const [, payload] = err.message.split('|');
  if (payload) {
    try {
      return JSON.parse(payload) as StockConflict;
    } catch {
      return null;
    }
  }
  return null;
}

export async function completeSale(input: {
  items: CartItemInput[];
  paymentMethod: PaymentMethod;
  discountAmount?: number;
  amountTendered?: number | null;
  paymentReference?: string | null;
  clientRef?: string;
  notes?: string | null;
}): Promise<SaleReceipt> {
  return rpc<SaleReceipt>('rpc_complete_sale', {
    p_items: input.items,
    p_payment_method: input.paymentMethod,
    p_discount_amount: input.discountAmount ?? 0,
    p_client_ref: input.clientRef ?? null,
    p_amount_tendered: input.amountTendered ?? null,
    p_payment_reference: input.paymentReference ?? null,
    p_notes: input.notes ?? null,
  });
}

/** Owner-only. Full or partial, with commission and payable reversal. */
export async function processReturn(input: {
  saleId: string;
  items: Array<{ sale_item_id: string; quantity: number }>;
  reason: string;
  restock?: boolean;
}): Promise<ReturnResult> {
  return rpc<ReturnResult>('rpc_process_return', {
    p_sale_id: input.saleId,
    p_items: input.items,
    p_reason: input.reason,
    p_restock: input.restock ?? true,
  });
}

/** Owner-only. A void reverses; it never deletes. */
export async function voidSale(saleId: string, reason: string): Promise<VoidResult> {
  return rpc<VoidResult>('rpc_void_sale', { p_sale_id: saleId, p_reason: reason });
}

export interface OwnerSaleRow {
  id: string;
  sale_number: string;
  sale_date: string;
  created_at: string;
  staff_name: string;
  subtotal: number;
  discount_amount: number;
  total_amount: number;
  returned_amount: number;
  net_amount: number;
  cogs_amount: number;
  gross_profit: number;
  payment_method: PaymentMethod;
  status: SaleStatus;
  line_count: number;
}

export interface SaleListTotals {
  gross_sales: number; discounts: number; returns: number;
  net_sales: number; cogs: number; gross_profit: number; sale_count: number;
}

/** The owner's sales ledger. Cost and profit per sale are owner-only (§4). */
export async function fetchSales(params: {
  from?: string; to?: string; staffId?: string | null; paymentMethod?: PaymentMethod | null;
} = {}) {
  return rpc<{ from: string; to: string; totals: SaleListTotals; items: OwnerSaleRow[] }>('rpc_report_sales', {
    p_from: params.from ?? null,
    p_to: params.to ?? null,
    p_staff_id: params.staffId ?? null,
    p_payment_method: params.paymentMethod ?? null,
  });
}

export interface SaleDetail {
  sale: {
    id: string; sale_number: string; sale_date: string; created_at: string;
    subtotal: number; discount_amount: number; discount_percent: number;
    total_amount: number; returned_amount: number; payment_method: PaymentMethod;
    status: string; staff_id: string; staff_name: string;
    cogs_amount: number; gross_profit: number;
    void_reason: string | null; voided_at: string | null;
  };
  items: Array<{
    id: string; product_id: string; product_name: string; product_code: string;
    quantity: number; unit_price: number; line_subtotal: number;
    line_discount: number; line_total: number; unit_cogs: number;
    line_cogs: number; returned_qty: number; refunded_amount: number;
  }>;
  returns: Array<{
    id: string; return_number: string; return_date: string; return_type: string;
    return_amount: number; cogs_reversed: number; restock_decision: string;
    reason: string | null;
  }>;
  commissions: Array<{ id: string; type: string; amount: number; rate: number; sale_date: string }>;
  /** False for staff: the database withholds cost and profit on their own sales. */
  cost_visible: boolean;
  note: string | null;
}

/**
 * Sale detail for the receipt, the returns screen and the void screen.
 *
 * Read through RPCs rather than table selects: `sales.cogs_amount` and
 * `sale_items.line_cogs` are owner-only data, so staff must not be able to pull
 * them with a raw query. rpc_sale_detail() returns cost fields only when the
 * caller is the owner.
 */
export async function fetchSaleDetail(saleId: string): Promise<SaleDetail> {
  return rpc<SaleDetail>('rpc_sale_detail', { p_sale_id: saleId });
}

/** Staff-facing: their own sale history (no cost, no profit fields at all). */
export interface MySaleRow {
  id: string;
  sale_number: string;
  sale_date: string;
  created_at: string;
  subtotal: number;
  discount_amount: number;
  total_amount: number;
  returned_amount: number;
  net_amount: number;
  payment_method: PaymentMethod;
  status: SaleStatus;
  line_count: number;
}

export async function fetchMySales(limit = 50) {
  return rpc<{
    items: MySaleRow[];
    month_totals: { sale_count: number; net_sales: number; discounts: number; commission: number };
  }>('rpc_my_sales', { p_limit: limit });
}

/** Staff-facing product list for the till: quantities yes, cost no. */
export async function fetchPosProducts(): Promise<StaffProduct[]> {
  return select<StaffProduct>('v_staff_products', { order: 'name.asc' });
}
