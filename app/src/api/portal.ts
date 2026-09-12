/**
 * Public customer portal.
 *
 * Every call here works without an account — that is the whole point of the
 * customer experience (§5, §46). What the customer can reach is decided by the
 * database (curated views + four public RPCs), not by this file.
 */
import { rpc, select } from '../lib/supabase';
import type {
  Category, ContactLinks, OrderMessage, PublicProduct, RequestSource, SettingsMap,
} from '../types';

export interface CatalogFilters {
  search?: string;
  categoryId?: string | null;
  brand?: string | null;
  featured?: boolean | null;
  limit?: number;
  offset?: number;
}

export async function fetchCatalog(filters: CatalogFilters = {}) {
  return rpc<{ items: PublicProduct[]; count: number; limit: number; offset: number }>(
    'rpc_public_catalog',
    {
      p_search: filters.search?.trim() || null,
      p_category_id: filters.categoryId || null,
      p_brand: filters.brand || null,
      p_featured: filters.featured ?? null,
      p_limit: filters.limit ?? 60,
      p_offset: filters.offset ?? 0,
    },
  );
}

export async function fetchFilters() {
  return rpc<{ categories: Category[]; brands: string[]; settings: SettingsMap }>('rpc_public_filters');
}

/** The WhatsApp number and Telegram handle come from settings, never hard-coded. */
export async function fetchPublicSettings(): Promise<SettingsMap> {
  return rpc<SettingsMap>('fn_public_settings');
}

/**
 * Builds the order text and the WhatsApp/Telegram deep links on the server, so
 * the shop number lives in one place and the message is identical whether it is
 * generated from the web, from a bot, or by staff.
 */
export async function buildOrderMessage(
  items: Array<{ product_id: string; quantity: number }>,
  customer?: { name?: string; phone?: string },
): Promise<OrderMessage> {
  return rpc<OrderMessage>('rpc_build_order_message', {
    p_items: items,
    p_customer_name: customer?.name || null,
    p_customer_phone: customer?.phone || null,
  });
}

export interface SubmitRequestInput {
  productName: string;
  quantity: number;
  customerName?: string;
  customerPhone: string;
  productId?: string | null;
  message?: string;
  photoUrl?: string | null;
  source?: RequestSource;
}

/**
 * Records a request and returns ready-to-send links.
 *
 * Note what this does NOT do: it never moves stock. Inventory only changes
 * through the POS sale transaction (§9). A WhatsApp request is an enquiry.
 */
export async function submitRequest(input: SubmitRequestInput) {
  return rpc<{
    request_id: string;
    request_number: string;
    was_unavailable: boolean;
    message: string;
    links: ContactLinks;
  }>('rpc_submit_customer_request', {
    p_requested_product_name: input.productName,
    p_quantity: input.quantity,
    p_customer_name: input.customerName || null,
    p_customer_phone: input.customerPhone,
    p_product_id: input.productId || null,
    p_message: input.message || null,
    p_photo_url: input.photoUrl || null,
    p_source: input.source || 'WEBSITE',
  });
}

/** Convenience: the deep links for a free-form message (Contact page). */
export async function contactLinks(message: string): Promise<ContactLinks> {
  return rpc<ContactLinks>('fn_contact_links', { p_message: message });
}

/** Categories alone, for the category grid. */
export async function fetchCategories(): Promise<Category[]> {
  return select<Category>('public_categories', { order: 'sort_order.asc' });
}
