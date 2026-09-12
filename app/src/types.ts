/** Domain types, mirroring the database shapes the API returns. */

export type UserRole = 'OWNER' | 'STAFF' | 'SUPPLIER';
export type Availability = 'AVAILABLE' | 'LOW' | 'OUT';
export type PaymentMethod = 'CASH' | 'BANK' | 'TELEBIRR';
export type SaleStatus = 'COMPLETED' | 'PARTIALLY_RETURNED' | 'RETURNED' | 'VOIDED';
export type MovementType =
  | 'BEGINNING_STOCK' | 'RESTOCK' | 'SALE' | 'RETURN' | 'DAMAGE' | 'EXPIRED'
  | 'ADJUSTMENT' | 'VOID_REVERSAL';
export type ExpenseCategory =
  | 'RENT' | 'ELECTRICITY' | 'WATER' | 'INTERNET' | 'TRANSPORTATION' | 'MARKETING'
  | 'PACKAGING' | 'SALARIES' | 'MAINTENANCE' | 'BANK_CHARGES' | 'OTHER';
export type RequestStatus =
  | 'NEW' | 'CONTACTED' | 'CONFIRMED' | 'ORDERED_FROM_SUPPLIER'
  | 'AVAILABLE' | 'FULFILLED' | 'CANCELLED';
export type RequestSource = 'WEBSITE' | 'WHATSAPP' | 'TELEGRAM' | 'STAFF';

export interface AppUser {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  active: boolean;
  commission_rate: number;
  last_login_at: string | null;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  sort_order: number;
  active: boolean;
  product_count?: number;
}

export interface Supplier {
  id: string;
  supplier_code: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  tin_number: string | null;
  payment_terms: string | null;
  active: boolean;
}

/** Frozen, self-contained sale line. Never recomputed from current prices. */
export interface ReceiptLine {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  line_subtotal: number;
  line_discount: number;
  line_total: number;
}

export interface SaleReceipt {
  sale_id: string;
  sale_number: string;
  sale_date: string;
  subtotal: number;
  discount_amount: number;
  total_amount: number;
  amount_tendered: number | null;
  change_given: number | null;
  payment_method: PaymentMethod;
  staff_name: string;
  commission: number;
  items: ReceiptLine[];
  replayed?: boolean;
}

/** Shape of the structured INSUFFICIENT_STOCK refusal (§32). */
export interface StockConflict {
  product_id: string;
  product_name: string;
  requested: number;
  available: number;
}

export interface ReturnResult {
  return_id: string;
  return_number: string;
  return_type: 'FULL' | 'PARTIAL';
  refund_amount: number;
  cogs_reversed: number;
  commission_reversed: number;
  restocked: boolean;
  sale_number: string;
  sale_status: string;
  items: Array<{
    sale_item_id: string; product_id: string; product_name: string;
    quantity: number; refund_amount: number; cogs_reversed: number;
  }>;
}

export interface VoidResult {
  sale_id: string;
  sale_number: string;
  status: 'VOIDED';
  voided_amount: number;
  cogs_reversed: number;
  commission_reversed: number;
  reason: string;
}

/** Staff-facing product row: has quantities, never has cost. */
export interface StaffProduct {
  id: string;
  product_code: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  brand: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  image_url: string | null;
  selling_price: number;
  minimum_stock: number;
  expiry_date: string | null;
  expiry_status: 'NONE' | 'OK' | 'EXPIRING_SOON' | 'EXPIRED';
  description: string | null;
  active: boolean;
  quantity_on_hand: number;
  availability: Availability;
  is_out_of_stock: boolean;
  is_low_stock: boolean;
  created_at: string;
  updated_at: string;
}

export interface PublicProduct {
  id: string;
  product_code: string;
  name: string;
  brand: string | null;
  description: string | null;
  keywords: string | null;
  image_url: string | null;
  selling_price: number;
  featured: boolean;
  category_id: string | null;
  category_name: string | null;
  category_slug: string | null;
  created_at: string;
  is_new: boolean;
  availability: Availability;
  availability_label: string;
}

export interface CartLine {
  product_id: string;
  name: string;
  selling_price: number;
  quantity: number;
  image_url?: string | null;
  availability?: Availability;
  /** Set when the catalogue corrected the quantity to what is on the shelf. */
  adjustedFrom?: number;
}

export interface OrderMessage {
  items: Array<{ product_id: string; name: string; quantity: number; unit_price: number; line_total: number }>;
  estimated_total: number;
  estimate_note: string;
  message: string;
  links: ContactLinks;
}

export interface ContactLinks {
  whatsapp_number: string;
  telegram_username: string;
  whatsapp_url: string | null;
  telegram_url: string | null;
  message: string;
}

export interface CustomerRequestRow {
  id: string;
  requestNumber: string;
  customerName: string | null;
  customerPhone: string | null;
  product: string;
  quantity: number;
  status: RequestStatus;
  source: RequestSource;
  was_unavailable: boolean;
  created_at: string;
  updated_at: string;
  matched_product: string | null;
  owner_note: string | null;
  message: string | null;
}

export interface DemandRow {
  product_name: string;
  product_id: string | null;
  category: string | null;
  request_count: number;
  unique_customers: number;
  last_requested: string;
  first_requested: string;
  quantity_on_hand: number | null;
  availability: Availability | null;
  minimum_stock: number;
  unavailable_request: boolean;
  demand_message: string;
}

export interface BatchRow {
  id: string;
  batch_number: string;
  received_date: string;
  created_at: string;
  expiry_date: string | null;
  product_name: string;
  product_code: string;
  selling_price: number;
  supplier_id: string;
  supplier_name: string;
  unit_cost: number;
  cost_status: 'PENDING' | 'RECORDED';
  quantity_received: number;
  quantity_remaining: number;
  quantity_sold: number;
  batch_status: string;
  cost_of_units_sold: number;
  value_remaining: number;
  unit_margin: number | null;
  notes: string | null;
  request_count: number;
  customers_requested: number;
}

export interface RestockRow {
  id: string;
  restock_number: string;
  received_date: string;
  expiry_date: string | null;
  quantity: number;
  unit_cost: number | null;
  cost_pending: boolean;
  cost_flagged: boolean;
  previous_unit_cost: number | null;
  supplier_invoice: string | null;
  notes: string | null;
  batch_id: string | null;
  status: string;
  product_name: string;
  product_code: string;
  supplier_name: string;
  received_by_name: string | null;
  cost_change_warning: string | null;
}

export interface MovementRow {
  created_at: string;
  movement_type: MovementType;
  quantity: number;
  reason: string | null;
  product_name: string;
  product_code: string;
  created_by_name: string | null;
  reference_type: string | null;
  reference_id: string | null;
  unit_cost: number | null;
}

export interface OwnerDashboard {
  today: { sales: number; transactions: number; gross_profit: number };
  week: { sales: number; transactions: number };
  month: {
    sales: number; transactions: number; net_sales: number; cogs: number;
    gross_profit: number; expenses: number; commission: number;
    net_profit: number; tithe_due: number;
  };
  supplier_payable: number;
  stock: {
    units: number; value: number; low_stock: number;
    out_of_stock: number; expired: number; expiring_soon: number;
  };
  top_products: Array<{ name: string; product_code: string; units: number; revenue: number; cogs: number }>;
  sales_trend: Array<{ d: string; revenue: number }>;
  staff_performance: Array<{
    staff_id: string; full_name: string; sales_count: number;
    revenue: number; commission: number;
  }>;
  customer_requests: {
    new: number; open: number; total: number;
    recent: Array<{
      id: string; request_number: string; customer_name: string | null;
      requested_product_name: string; quantity: number; status: RequestStatus;
      source: RequestSource; created_at: string;
    }>;
  };
  customer_demand: DemandRow[];
  alerts: Array<{
    severity: 'danger' | 'warning' | 'info';
    type: string; title: string; detail: string;
    product_id?: string; batch_id?: string;
  }>;
}

export interface StaffDashboard {
  today_sales: { amount: number; transactions: number };
  my_sales_today: { amount: number; transactions: number };
  my_sales_month: { amount: number; transactions: number };
  my_commission_month: number;
  products: { available: number; low_stock: number; out_of_stock: number };
  pending_restocks: number;
  recent_sales: Array<{
    sale_number: string; sale_date: string; total_amount: number;
    discount_amount: number; payment_method: PaymentMethod; status: string;
  }>;
}

export interface SupplierSummary {
  supplier_id: string;
  products_supplied: number;
  units_supplied: number;
  units_sold: number;
  total_payable: number;
  total_paid: number;
  outstanding: number;
  units_in_stock: number;
}

export interface SupplierOrder {
  id: string;
  entry_date: string;
  quantity_sold: number;
  unit_cost: number;
  payable_amount: number;
  amount_paid: number;
  outstanding: number;
  status: 'UNPAID' | 'PARTIAL' | 'PAID';
  is_reversal: boolean;
  product_name: string;
  product_code: string;
  batch_number: string;
  received_date: string;
}

export interface SupplierReceipt {
  id: string;
  batch_number: string;
  received_date: string;
  quantity_received: number;
  quantity_sold: number;
  quantity_remaining: number;
  unit_cost: number;
  expiry_date: string | null;
  cost_status: string;
  product_name: string;
  product_code: string;
}

export interface SupplierPayment {
  id: string;
  payment_number: string;
  amount: number;
  payment_method: PaymentMethod;
  payment_date: string;
  reference: string | null;
  notes: string | null;
  created_at: string;
}

export interface SupplierStatement {
  id: string;
  statement_number: string;
  period_month: string;
  opening_outstanding: number;
  units_sold: number;
  total_payable: number;
  total_paid: number;
  outstanding: number;
  generated_at: string;
  supplier_name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
}

export interface ExpenseRow {
  id: string;
  expense_number: string;
  expense_date: string;
  category: ExpenseCategory;
  amount: number;
  payment_method: PaymentMethod;
  description: string | null;
  receipt_url: string | null;
  created_by_name: string | null;
}

export interface PnlMonth {
  period_month: string;
  gross_sales: number;
  discounts: number;
  returns: number;
  net_sales: number;
  cogs: number;
  gross_profit: number;
  operating_expenses: number;
  staff_commission: number;
  net_profit: number;
  tithe_due_10pct: number;
}

export interface TitheRow {
  period_month: string;
  net_profit: number;
  tithe_rate: number;
  tithe_amount: number;
  status: 'DUE' | 'PAID' | 'CANCELLED';
  paid_date: string | null;
  payment_method: PaymentMethod | null;
  reference: string | null;
}

export interface CommissionStaffRow {
  staff_id: string;
  full_name: string;
  commission_rate: number;
  earned: number;
  reversals: number;
  net_commission: number;
  paid: number;
  outstanding: number;
}

export interface AuditRow {
  id: string;
  user_id: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  note: string | null;
  created_at: string;
}

export interface SettingsMap {
  [key: string]: string | number | boolean | null;
}

export interface BackupStatus {
  last_run: {
    status: string; backup_type: string; started_at: string; finished_at: string | null;
    size_bytes: number | null; table_count: number | null; row_count: number | null;
    storage_files: number | null; location: string | null; notes: string | null;
  } | null;
  next_scheduled: string;
  history: Array<{ status: string; started_at: string; finished_at: string | null; size_bytes: number | null; row_count: number | null }>;
  schedule: string;
  covers: string[];
}

export interface StockPeriod {
  id: string;
  label: string;
  period_start: string;
  period_end: string;
  status: 'OPEN' | 'CLOSED';
  closed_at: string | null;
  created_at: string;
}

export interface StockCountRow {
  id: string;
  stock_period_id: string;
  period_label: string;
  product_id: string;
  product_name: string;
  product_code: string;
  expected_quantity: number;
  counted_quantity: number;
  variance: number;
  status: string;
  notes: string | null;
  created_at: string;
  confirmed_at: string | null;
}
