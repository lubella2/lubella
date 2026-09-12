/**
 * Dashboards, reports and the customer-demand analytics that drive purchasing.
 *
 * All aggregates are computed in SQL, so the browser only ever receives
 * summaries — never the underlying cost rows for a role that should not see
 * them, and never a number that was recalculated in JavaScript.
 */
import { rpc } from '../lib/supabase';
import type {
  DemandRow, OwnerDashboard, RequestSource, RequestStatus, StaffDashboard,
} from '../types';

export async function fetchOwnerDashboard(date?: string): Promise<OwnerDashboard> {
  return rpc<OwnerDashboard>('rpc_owner_dashboard', { p_date: date ?? null });
}

export async function fetchStaffDashboard(date?: string): Promise<StaffDashboard> {
  return rpc<StaffDashboard>('rpc_staff_dashboard', { p_date: date ?? null });
}

/* ---------------------------- customer requests --------------------------- */

export async function fetchCustomerRequests(params: {
  from?: string; to?: string; status?: RequestStatus | null;
  source?: RequestSource | null; productId?: string | null;
} = {}) {
  return rpc<{
    from: string; to: string;
    items: import('../types').CustomerRequestRow[];
    stats: {
      total: number; new_count: number; fulfilled: number;
      customers: number; unavailable: number;
    };
  }>('rpc_report_customer_requests', {
    p_from: params.from ?? null,
    p_to: params.to ?? null,
    p_status: params.status ?? null,
    p_source: params.source ?? null,
    p_product_id: params.productId ?? null,
  });
}

export async function updateRequestStatus(requestId: string, status: RequestStatus, note?: string) {
  return rpc<{ request_id: string; request_number: string; status: string }>(
    'rpc_update_request_status',
    { p_request_id: requestId, p_status: status, p_note: note ?? null },
  );
}

/** "12 customers have requested this product." — shown at purchasing time. */
export async function demandForProduct(productId: string) {
  return rpc<{ request_count: number; unique_customers: number; last_requested: string; message: string }>(
    'rpc_demand_for_product',
    { p_product_id: productId },
  );
}

export async function fetchCustomerDemand(days = 90, onlyUnavailable = false) {
  return rpc<{ days: number; items: DemandRow[] }>('rpc_report_customer_demand', {
    p_days: days,
    p_only_unavailable: onlyUnavailable,
  });
}

/* -------------------------------- reporting ------------------------------- */

export async function fetchProductSales(from?: string, to?: string) {
  return rpc<{
    products: Array<{
      name: string; product_code: string; category: string | null; units_sold: number;
      gross_revenue: number; discounts: number; net_revenue: number; cogs: number;
      gross_profit: number; units_returned: number;
    }>;
    demand: Array<{
      product_name: string; requests: number; customers: number; last_requested: string;
    }>;
  }>('rpc_report_product_sales', { p_from: from ?? null, p_to: to ?? null });
}

export async function fetchFifoReport(from?: string, to?: string) {
  return rpc<{
    items: Array<{
      created_at: string; product_name: string; supplier_name: string; batch_number: string;
      received_date: string; sale_number: string | null; quantity: number; unit_cost: number;
      total_cost: number; direction: string; effective_unit_cost: number;
    }>;
    totals: { cogs_out: number; reversed_in: number; allocations: number };
  }>('rpc_report_fifo_cogs', { p_from: from ?? null, p_to: to ?? null });
}

export async function fetchReturnsReport(from?: string, to?: string) {
  return rpc<{
    returns: Array<{
      return_number: string; return_date: string; sale_number: string; sale_status: string;
      return_type: string; return_amount: number; cogs_reversed: number;
      restock_decision: string; reason: string | null; processed_by_name: string | null;
      line_count: number;
    }>;
    voids: Array<{
      sale_number: string; sale_date: string; total_amount: number;
      void_reason: string | null; voided_at: string; voided_by_name: string | null;
    }>;
    note: string;
  }>('rpc_report_returns', { p_from: from ?? null, p_to: to ?? null });
}

/** Sales per staff member, paired with what they earned. Owner-only (§55). */
export async function fetchStaffPerformance(from?: string, to?: string) {
  return rpc<{
    from: string; to: string;
    staff: Array<{
      staff_id: string; full_name: string; role: 'OWNER' | 'STAFF'; active: boolean;
      commission_rate: number; sale_count: number; gross_sales: number; discounts_given: number;
      returns: number; net_sales: number; average_sale: number; commission: number;
    }>;
  }>('rpc_report_staff_performance', { p_from: from ?? null, p_to: to ?? null });
}

/** Day-by-day sales with cost and profit, for the charts and the reports page. */
export async function fetchDailySales(from?: string, to?: string) {
  return rpc<{
    from: string; to: string;
    items: Array<{
      sale_date: string; sale_count: number; net_sales: number;
      discounts: number; cogs: number; gross_profit: number;
    }>;
  }>('rpc_report_daily_sales', { p_from: from ?? null, p_to: to ?? null });
}

/** Owner-only verification that the API surface matches the intended grants. */
export async function fetchApiSurface() {
  return rpc<{ anon: string[]; authenticated: string[] }>('rpc_api_surface');
}
