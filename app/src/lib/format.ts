/**
 * Presentation helpers.
 *
 * Nothing in this file computes money. Prices, totals, discounts, COGS,
 * commission and payables all arrive from PostgreSQL already calculated. These
 * functions only format, and are deliberately kept free of business rules so
 * that there is exactly one implementation of each rule (in SQL).
 */

const CURRENCY_LABEL = 'Birr';

/** 1234.5 -> "1,234.50" */
export function money(value: number | string | null | undefined, showLabel = false): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (n === null || n === undefined || Number.isNaN(n)) return showLabel ? `0.00 ${CURRENCY_LABEL}` : '0.00';
  const formatted = n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return showLabel ? `${formatted} ${CURRENCY_LABEL}` : formatted;
}

/** Compact form for dashboard tiles: 12,500 -> "12.5k" */
export function moneyShort(value: number | null | undefined): string {
  const n = Number(value || 0);
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(0);
}

export function currencyLabel(): string {
  return CURRENCY_LABEL;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function firstOfMonthISO(d = new Date()): string {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export function fmtDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value.length <= 10 ? `${value}T00:00:00` : value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateShort(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value.length <= 10 ? `${value}T00:00:00` : value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export function fmtDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function fmtTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function monthLabel(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value.length <= 10 ? `${value}T00:00:00` : value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

/** "3 days ago", "in 12 days" — used for demand and expiry signals. */
export function relativeDays(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  const diff = Math.round((d.getTime() - Date.now()) / 86_400_000);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  if (diff < 0) return `${Math.abs(diff)} days ago`;
  return `in ${diff} days`;
}

export type Availability = 'AVAILABLE' | 'LOW' | 'OUT';

export function availabilityChip(a: Availability | string | null | undefined): {
  label: string; dot: string; className: string;
} {
  switch (a) {
    case 'AVAILABLE':
      return { label: 'Available', dot: '🟢', className: 'chip-green' };
    case 'LOW':
      return { label: 'Low Stock', dot: '🟡', className: 'chip-amber' };
    default:
      return { label: 'Out of Stock', dot: '🔴', className: 'chip-red' };
  }
}

export function statusChip(status: string): string {
  const map: Record<string, string> = {
    NEW: 'chip-rose', CONTACTED: 'chip-slate', CONFIRMED: 'chip-amber',
    ORDERED_FROM_SUPPLIER: 'chip-amber', AVAILABLE: 'chip-green',
    FULFILLED: 'chip-green', CANCELLED: 'chip-slate',
    COMPLETED: 'chip-green', PARTIALLY_RETURNED: 'chip-amber',
    RETURNED: 'chip-amber', VOIDED: 'chip-red',
    UNPAID: 'chip-red', PARTIAL: 'chip-amber', PAID: 'chip-green',
    DUE: 'chip-amber',
    PENDING: 'chip-amber', RECORDED: 'chip-green', CONFIRMED_COUNT: 'chip-green',
    OPEN: 'chip-green', CLOSED: 'chip-slate',
    EARNED: 'chip-green', RETURN_REVERSAL: 'chip-amber',
    VOID_REVERSAL: 'chip-red', ADJUSTMENT: 'chip-slate',
  };
  return map[status] || 'chip-slate';
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('');
}

/** Percent change between two numbers, for trend badges. */
export function pctChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
