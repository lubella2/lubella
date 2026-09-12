/**
 * Money owed, money earned, money spent — all owner-only.
 *
 * Two rules are encoded in the shape of this module and cannot be broken from
 * the client:
 *   • a supplier payment settles payables; it is never an expense (§24, §60);
 *   • tithe is computed from net profit by the database, never entered (§41).
 */
import { rpc, select } from '../lib/supabase';
import type {
  CommissionStaffRow, ExpenseCategory, ExpenseRow, PaymentMethod, PnlMonth, TitheRow,
} from '../types';

/* ---------------------------- supplier payables --------------------------- */

export async function fetchSupplierPayables(supplierId?: string | null) {
  return rpc<{
    suppliers: Array<{
      supplier_code: string; name: string; total_payable: number; total_paid: number;
      outstanding: number; open_lines: number; last_activity: string | null;
    }>;
    lines: Array<{
      entry_date: string; supplier_name: string; product_name: string; batch_number: string;
      quantity_sold: number; purchase_cost: number; payable_amount: number;
      amount_paid: number; outstanding: number; status: string; is_reversal: boolean;
    }>;
    totals: { payable: number; paid: number; outstanding: number };
  }>('rpc_report_supplier_payable', { p_supplier_id: supplierId ?? null });
}

export async function fetchSupplierPayments() {
  return rpc<{ total: number; note: string; items: Array<{
    id: string; payment_number: string; supplier_name: string; amount: number;
    payment_method: PaymentMethod; payment_date: string; reference: string | null;
    notes: string | null;
  }> }>('rpc_report_supplier_payments', {});
}

export async function recordSupplierPayment(input: {
  supplierId: string; amount: number; paymentMethod: PaymentMethod;
  paymentDate?: string; reference?: string | null; notes?: string | null;
}) {
  return rpc<{
    payment_id: string; payment_number: string; amount: number;
    applied: number; remaining_outstanding: number;
  }>('rpc_record_supplier_payment', {
    p_supplier_id: input.supplierId,
    p_amount: input.amount,
    p_payment_method: input.paymentMethod,
    p_payment_date: input.paymentDate ?? null,
    p_reference: input.reference ?? null,
    p_notes: input.notes ?? null,
  });
}

export async function generateSupplierStatement(supplierId: string, month: string) {
  return rpc<{
    statement_id: string; statement_number: string; period_month: string;
    opening_outstanding: number; units_sold: number; total_payable: number;
    total_paid: number; outstanding: number;
  }>('rpc_generate_supplier_statement', { p_supplier_id: supplierId, p_month: month });
}

/**
 * Statements are an owner-only table with no direct grant, so they are read
 * through the definer RPC rather than by selecting the table (§10, §54).
 */
export async function listSupplierStatements(supplierId?: string | null): Promise<import('../types').SupplierStatement[]> {
  const res = await rpc<{ items: import('../types').SupplierStatement[] }>(
    'rpc_list_supplier_statements',
    { p_supplier_id: supplierId ?? null, p_limit: 200 },
  );
  return res.items;
}

/**
 * Internal notes about a supplier (owner only). Notes are never a substitute
 * for a balance: anything financial is derived from recorded transactions.
 */
export async function listSupplierNotes(supplierId: string) {
  const res = await rpc<{ items: Array<{
    id: string; supplier_id: string; note: string; created_at: string;
    created_by_name: string | null;
  }> }>('rpc_list_supplier_notes', { p_supplier_id: supplierId, p_limit: 50 });
  return res.items;
}

/* ------------------------------- commission ------------------------------- */

/**
 * A staff member's own commission.
 *
 * Scoped inside the database to the caller's own rows (`where staff_id =
 * auth.uid()`), and read-only: staff can see what they earned and what was
 * reversed, but cannot alter either (§36).
 */
export interface MyCommission {
  items: Array<{
    id: string; sale_date: string; type: string; amount: number; rate: number;
    note: string | null; created_at: string; sale_number: string | null;
    sale_total: number | null; sale_discount: number | null; return_number: string | null;
  }>;
  totals: { earned: number; reversed: number; net: number };
  payments: {
    paid: number;
    entries: Array<{
      payment_number: string; amount: number; payment_date: string;
      reference: string | null; period_start: string | null; period_end: string | null;
    }>;
  };
  outstanding: number;
}

export async function fetchMyCommission(params: { from?: string; to?: string } = {}): Promise<MyCommission> {
  return rpc<MyCommission>('rpc_my_commission', {
    p_from: params.from ?? null,
    p_to: params.to ?? null,
  });
}

export async function fetchCommissionReport(params: { from?: string; to?: string; staffId?: string | null } = {}) {
  return rpc<{
    staff: CommissionStaffRow[];
    lines: Array<{
      sale_date: string; staff_name: string; type: string; amount: number; rate: number;
      sale_number: string | null; total_amount: number | null; discount_amount: number | null;
      note: string | null;
    }>;
  }>('rpc_report_commission', {
    p_from: params.from ?? null,
    p_to: params.to ?? null,
    p_staff_id: params.staffId ?? null,
  });
}

export async function recordCommissionPayment(input: {
  staffId: string; amount: number; periodStart: string; periodEnd: string;
  paymentMethod: PaymentMethod; paymentDate?: string;
  reference?: string | null; notes?: string | null;
}) {
  return rpc<{ payment_id: string; payment_number: string; amount: number; remaining_due: number }>(
    'rpc_record_commission_payment',
    {
      p_staff_id: input.staffId,
      p_amount: input.amount,
      p_period_start: input.periodStart,
      p_period_end: input.periodEnd,
      p_payment_method: input.paymentMethod,
      p_payment_date: input.paymentDate ?? null,
      p_reference: input.reference ?? null,
      p_notes: input.notes ?? null,
    },
  );
}

/* -------------------------------- expenses -------------------------------- */

export async function recordExpense(input: {
  category: ExpenseCategory; amount: number; paymentMethod: PaymentMethod;
  expenseDate?: string; description?: string | null; receiptUrl?: string | null;
}) {
  return rpc<{ expense_id: string; expense_number: string; amount: number }>('rpc_record_expense', {
    p_category: input.category,
    p_amount: input.amount,
    p_payment_method: input.paymentMethod,
    p_expense_date: input.expenseDate ?? null,
    p_description: input.description ?? null,
    p_receipt_url: input.receiptUrl ?? null,
  });
}

export async function deleteExpense(expenseId: string, reason: string) {
  return rpc('rpc_delete_expense', { p_expense_id: expenseId, p_reason: reason });
}

export async function fetchExpenseReport(from?: string, to?: string) {
  return rpc<{
    items: ExpenseRow[];
    by_category: Array<{ category: ExpenseCategory; total: number; entries: number }>;
    total: number;
  }>('rpc_report_expenses', { p_from: from ?? null, p_to: to ?? null });
}

/* ---------------------------------- P&L ----------------------------------- */

export async function fetchPnl(from?: string, to?: string) {
  return rpc<{
    months: PnlMonth[];
    formula: Record<string, string>;
    supplier_payments_in_period: number;
    supplier_payments_note: string;
  }>('rpc_report_pnl', { p_from: from ?? null, p_to: to ?? null });
}

/* --------------------------------- tithe ---------------------------------- */

export async function computeTithe(month?: string) {
  return rpc<{
    period_month: string; net_profit: number; tithe_rate: number;
    tithe_amount: number; status: string; message: string | null;
  }>('rpc_compute_tithe', { p_month: month ?? null });
}

export async function recordTithePayment(input: {
  periodMonth: string; paymentMethod: PaymentMethod;
  paidDate?: string; reference?: string | null; notes?: string | null;
}) {
  return rpc<{ tithe_id: string; amount: number; status: string; note: string }>(
    'rpc_record_tithe_payment',
    {
      p_period_month: input.periodMonth,
      p_payment_method: input.paymentMethod,
      p_paid_date: input.paidDate ?? null,
      p_reference: input.reference ?? null,
      p_notes: input.notes ?? null,
    },
  );
}

export async function fetchTitheReport(year?: number): Promise<{ year: number; months: TitheRow[]; note: string }> {
  return rpc('rpc_report_tithe', { p_year: year ?? new Date().getFullYear() });
}

/* ------------------------------ month close ------------------------------- */

export async function closeMonth(month?: string, notes?: string) {
  return rpc('rpc_close_month', { p_month: month ?? null, p_notes: notes ?? null });
}

export async function reopenMonth(month: string, reason: string) {
  return rpc('rpc_reopen_month', { p_month: month, p_reason: reason });
}

export async function listPeriodCloses() {
  return select<{
    id: string; period_month: string; status: string; net_sales: number; cogs: number;
    gross_profit: number; expenses: number; commission: number; net_profit: number;
    closed_at: string | null; notes: string | null;
  }>('period_closes', { order: 'period_month.desc' });
}
