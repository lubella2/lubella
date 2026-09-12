/**
 * Inventory: receiving, cost review, adjustments and the biweekly count cycle.
 *
 * Note the shape of `recordRestock`: it accepts an optional unit cost, and the
 * database decides whether to honour it. A staff member passing a cost has it
 * silently ignored and the batch is left cost-pending for the owner — the rule
 * lives in SQL, not in a disabled input field (§27).
 */
import { rpc, select } from '../lib/supabase';
import type {
  BatchRow, MovementType, RestockRow, StockCountRow, StockPeriod,
} from '../types';

export interface RestockInput {
  productId: string;
  supplierId: string;
  quantity: number;
  receivedDate?: string;
  expiryDate?: string | null;
  supplierInvoice?: string | null;
  notes?: string | null;
  /** Honoured for the owner only; ignored for staff. */
  unitCost?: number | null;
}

export interface RestockResult {
  restock_id: string;
  restock_number: string;
  batch_id: string;
  quantity_on_hand: number;
  cost_pending: boolean;
  cost_flagged: boolean;
  cost_review_message: string | null;
}

export async function recordRestock(input: RestockInput): Promise<RestockResult> {
  return rpc<RestockResult>('rpc_record_restock', {
    p_product_id: input.productId,
    p_supplier_id: input.supplierId,
    p_quantity: input.quantity,
    p_received_date: input.receivedDate ?? null,
    p_expiry_date: input.expiryDate ?? null,
    p_supplier_invoice: input.supplierInvoice ?? null,
    p_notes: input.notes ?? null,
    p_unit_cost: input.unitCost ?? null,
  });
}

export async function recordBatchCost(batchId: string, unitCost: number, reason?: string) {
  return rpc<{ batch_id: string; unit_cost: number; cost_status: string }>(
    'rpc_record_batch_cost',
    { p_batch_id: batchId, p_unit_cost: unitCost, p_reason: reason ?? null },
  );
}

export async function listBatches(params: {
  productId?: string | null; supplierId?: string | null;
  onlyPendingCost?: boolean; limit?: number;
} = {}) {
  return rpc<{ items: BatchRow[]; pending_cost_count: number }>('rpc_list_batches', {
    p_product_id: params.productId ?? null,
    p_supplier_id: params.supplierId ?? null,
    p_only_pending_cost: params.onlyPendingCost ?? false,
    p_limit: params.limit ?? 200,
  });
}

export async function listRestocks(onlyPendingCost = false) {
  return rpc<{ items: RestockRow[] }>('rpc_list_restocks', {
    p_only_pending_cost: onlyPendingCost,
    p_limit: 200,
  });
}

export async function adjustStock(input: {
  productId: string;
  quantity: number;              // signed delta
  movementType: MovementType;
  reason: string;
  unitCost?: number | null;
  stockPeriodId?: string | null;
}) {
  return rpc<{ movement_id: string; quantity_change: number; quantity_on_hand: number }>(
    'rpc_adjust_stock',
    {
      p_product_id: input.productId,
      p_quantity: input.quantity,
      p_movement_type: input.movementType,
      p_reason: input.reason,
      p_damage_expiry_cost: input.unitCost ?? null,
      p_stock_period_id: input.stockPeriodId ?? null,
    },
  );
}

/* ----------------------------- stock periods ----------------------------- */

export async function listStockPeriods(): Promise<StockPeriod[]> {
  return select<StockPeriod>('v_staff_stock_periods', { order: 'period_start.desc' });
}

export async function generateMonthPeriods(month?: string) {
  return rpc<{ month: string; period_ids: string[] }>('rpc_generate_month_periods', {
    p_month: month ?? null,
  });
}

export async function openStockCount(periodId: string, categoryId?: string | null) {
  return rpc<{ stock_period_id: string; lines_created: number }>('rpc_open_stock_count', {
    p_stock_period_id: periodId,
    p_category_id: categoryId ?? null,
  });
}

export async function submitStockCount(
  periodId: string,
  lines: Array<{ product_id: string; counted_quantity: number }>,
) {
  return rpc<{ stock_period_id: string; lines_updated: number }>('rpc_submit_stock_count', {
    p_stock_period_id: periodId,
    p_lines: lines,
  });
}

export async function confirmStockCount(periodId: string, notes?: string) {
  return rpc<{
    stock_period_id: string; confirmed: boolean; adjusted_lines: number;
    variance_units: number; variance_value: number;
  }>('rpc_confirm_stock_count', {
    p_stock_period_id: periodId,
    p_confirm: true,
    p_notes: notes ?? null,
  });
}

export async function listStockCounts(periodId: string) {
  return select<StockCountRow>('v_staff_stock_counts', {
    filters: { stock_period_id: periodId },
    order: 'product_name.asc',
  });
}

/* ------------------------------- movements ------------------------------- */

export async function fetchMovements(params: {
  from?: string; to?: string; productId?: string | null; movementType?: MovementType | null;
} = {}) {
  return rpc<{
    items: import('../types').MovementRow[];
    summary: Record<string, number>;
  }>('rpc_report_stock_movements', {
    p_from: params.from ?? null,
    p_to: params.to ?? null,
    p_product_id: params.productId ?? null,
    p_movement_type: params.movementType ?? null,
  });
}

export async function fetchInventoryReport(params: { categoryId?: string | null; onlyAttention?: boolean } = {}) {
  return rpc<{
    items: Array<{
      product_id: string;
      product_code: string; name: string; category_name: string | null; supplier_name: string | null;
      quantity_on_hand: number; avg_unit_cost: number; stock_value: number; selling_price: number;
      unit_margin: number | null; availability: string; expiry_status: string;
      expiry_date: string | null; minimum_stock: number;
    }>;
    totals: { total_value: number; total_units: number; sku_count: number; retail_value: number };
  }>('rpc_report_inventory', {
    p_category_id: params.categoryId ?? null,
    p_only_attention: params.onlyAttention ?? false,
  });
}
