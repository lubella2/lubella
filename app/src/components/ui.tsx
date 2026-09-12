/**
 * Shared UI primitives.
 *
 * Mobile-first: everything is sized for a thumb, sheets rise from the bottom on
 * small screens, and tables degrade into stacked rows rather than sideways
 * scrolling forever.
 */
import {
  createContext, useCallback, useContext, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode,
  type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { money, statusChip, titleCase } from '../lib/format';
import { useAuth } from '../lib/auth';

/* ----------------------------------- Card ---------------------------------- */

export function Card({
  children, className = '', padded = true,
}: { children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <div className={`card ${padded ? 'p-4 sm:p-5' : ''} ${className}`}>{children}</div>
  );
}

export function SectionHeader({
  title, subtitle, action,
}: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-3">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-brand-ink truncate">{title}</h2>
        {subtitle && <p className="text-sm text-brand-muted mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/* --------------------------------- Buttons --------------------------------- */

export function Button({
  variant = 'primary', size = 'md', icon, children, className = '', loading, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'whatsapp' | 'telegram';
  size?: 'sm' | 'md';
  icon?: ReactNode;
  loading?: boolean;
}) {
  const variants: Record<string, string> = {
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    ghost: 'btn-ghost',
    danger: 'btn-danger',
    whatsapp: 'btn-whatsapp',
    telegram: 'btn-telegram',
  };
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={`${variants[variant]} ${size === 'sm' ? 'btn-sm' : ''} ${className}`}
    >
      {loading ? <Spinner size={16} /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label, children, className = '', ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center h-11 w-11 rounded-xl
                  text-brand-charcoal hover:bg-brand-soft active:scale-95 transition
                  disabled:opacity-40 disabled:pointer-events-none ${className}`}
    >
      {children}
    </button>
  );
}

/* --------------------------------- Feedback -------------------------------- */

export function Spinner({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`} width={size} height={size} viewBox="0 0 24 24"
      fill="none" aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function LoadingBlock({ label = 'Loading…', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label={label}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-14 w-full" />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function EmptyState({
  icon, title, description, action,
}: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="text-center py-10 px-4">
      {icon && <div className="flex justify-center mb-3 text-brand-rose">{icon}</div>}
      <p className="font-medium text-brand-ink">{title}</p>
      {description && <p className="text-sm text-brand-muted mt-1 max-w-md mx-auto">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-state-red/25 bg-state-red/5 p-4">
      <p className="text-sm text-state-red font-medium">Something went wrong</p>
      <p className="text-sm text-brand-charcoal mt-1">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>Try again</Button>
      )}
    </div>
  );
}

/* ---------------------------------- Toasts --------------------------------- */

type Toast = { id: number; tone: 'success' | 'error' | 'info'; title: string; body?: string };
const ToastContext = createContext<{ push: (t: Omit<Toast, 'id'>) => void } | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { ...t, id }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), t.tone === 'error' ? 7000 : 4200);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div
        className="fixed left-0 right-0 bottom-0 z-[60] p-3 space-y-2 pointer-events-none
                   sm:left-auto sm:right-4 sm:bottom-4 sm:w-96"
        role="status" aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-xl px-4 py-3 shadow-lift animate-fade-up
              border ${t.tone === 'success' ? 'bg-white border-state-green/30'
                : t.tone === 'error' ? 'bg-white border-state-red/30'
                : 'bg-white border-brand-line'}`}
          >
            <div className="flex items-start gap-2.5">
              <span className="text-lg leading-none mt-0.5" aria-hidden="true">
                {t.tone === 'success' ? '✅' : t.tone === 'error' ? '⚠️' : 'ℹ️'}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-brand-ink">{t.title}</p>
                {t.body && <p className="text-sm text-brand-muted mt-0.5 break-words">{t.body}</p>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

/* ---------------------------------- Inputs --------------------------------- */

export function Field({
  label, hint, error, children, required,
}: { label: string; hint?: string; error?: string; children: ReactNode; required?: boolean }) {
  return (
    <div className="mb-3.5">
      <label className="label">
        {label} {required && <span className="text-state-red">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-brand-muted mt-1">{hint}</p>}
      {error && <p className="text-xs text-state-red mt-1">{error}</p>}
    </div>
  );
}

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={`input ${className}`} />;
}

export function MoneyInput({
  value, onValueChange, className = '', ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: number | string;
  onValueChange: (v: number | '') => void;
}) {
  return (
    <div className="relative">
      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-muted text-sm num">Birr</span>
      <input
        {...rest}
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        value={value}
        onChange={(e) => onValueChange(e.target.value === '' ? '' : Number(e.target.value))}
        className={`input pl-14 num ${className}`}
      />
    </div>
  );
}

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={`input appearance-none bg-white pr-9 ${className}`}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%238A8489' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 0.85rem center',
      }}
    >
      {children}
    </select>
  );
}

export function Textarea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={`input min-h-[88px] py-2.5 leading-relaxed ${className}`} />;
}

export function Checkbox({
  label, checked, onChange, hint, disabled,
}: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id} className={`flex items-start gap-3 py-2 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <input
        id={id} type="checkbox" checked={checked} disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-5 w-5 rounded border-brand-line text-brand-rose
                   focus:ring-brand-rose/40 accent-[#D1809A]"
      />
      <span className="min-w-0">
        <span className="text-sm text-brand-ink">{label}</span>
        {hint && <span className="block text-xs text-brand-muted mt-0.5">{hint}</span>}
      </span>
    </label>
  );
}

/* ------------------------------- Bottom sheet ------------------------------ */

export function Modal({
  open, onClose, title, children, footer, size = 'md',
}: {
  open: boolean; onClose: () => void; title: string;
  children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  const widths = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-brand-ink/40 backdrop-blur-[2px]"
        onClick={onClose} aria-hidden="true"
      />
      <div
        role="dialog" aria-modal="true" aria-label={title}
        className={`relative w-full ${widths[size]} bg-white rounded-t-2xl sm:rounded-2xl
                    shadow-lift animate-slide-up sm:animate-fade-up max-h-[92vh]
                    flex flex-col overflow-hidden`}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-brand-line shrink-0">
          <h3 className="font-semibold text-brand-ink truncate">{title}</h3>
          <button
            onClick={onClose} aria-label="Close"
            className="h-9 w-9 -mr-1.5 rounded-lg hover:bg-brand-soft flex items-center
                       justify-center text-brand-muted shrink-0"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1">{children}</div>
        {footer && (
          <div className="px-5 py-3.5 border-t border-brand-line bg-brand-soft/50 shrink-0
                          flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open, onClose, onConfirm, title, message, confirmLabel = 'Confirm',
  tone = 'primary', requireReason = false, reasonLabel = 'Reason', busy = false,
}: {
  open: boolean; onClose: () => void; onConfirm: (reason: string) => void;
  title: string; message: ReactNode; confirmLabel?: string;
  tone?: 'primary' | 'danger'; requireReason?: boolean; reasonLabel?: string; busy?: boolean;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (!open) setReason(''); }, [open]);

  return (
    <Modal
      open={open} onClose={onClose} title={title} size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={() => onConfirm(reason)}
            disabled={busy || (requireReason && reason.trim().length < 3)}
            loading={busy}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-brand-charcoal space-y-3">
        {message}
        {requireReason && (
          <Field label={reasonLabel} required hint="This is stored permanently in the audit log.">
            <Textarea
              value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Explain briefly why…"
            />
          </Field>
        )}
      </div>
    </Modal>
  );
}

/* ---------------------------------- Bits ----------------------------------- */

export function Badge({
  children, className = '',
}: { children: ReactNode; className?: string }) {
  return <span className={className || 'chip-rose'}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={statusChip(status)}>{titleCase(status)}</span>;
}

export function StatCard({
  label, value, sub, tone = 'default', icon,
}: {
  label: string; value: ReactNode; sub?: ReactNode;
  tone?: 'default' | 'good' | 'warn' | 'bad' | 'brand'; icon?: ReactNode;
}) {
  const tones = {
    default: 'text-brand-ink',
    good: 'text-state-green',
    warn: 'text-[#8a6318]',
    bad: 'text-state-red',
    brand: 'text-brand-deep',
  };
  return (
    <div className="card p-3.5 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-brand-muted uppercase tracking-wide">{label}</p>
        {icon && <span className="text-brand-rose shrink-0">{icon}</span>}
      </div>
      <p className={`mt-1.5 text-xl sm:text-2xl font-semibold num ${tones[tone]}`}>{value}</p>
      {sub && <p className="text-xs text-brand-muted mt-1">{sub}</p>}
    </div>
  );
}

export function MoneyDelta({ value, label }: { value: number; label?: string }) {
  const positive = value >= 0;
  return (
    <span className={`chip ${positive ? 'chip-green' : 'chip-red'}`}>
      <span aria-hidden="true">{positive ? '▲' : '▼'}</span>
      {money(Math.abs(value))}
      {label && <span className="opacity-70">{label}</span>}
    </span>
  );
}

export function Tabs<T extends string>({
  tabs, active, onChange,
}: { tabs: Array<{ id: T; label: string; count?: number }>; active: T; onChange: (id: T) => void }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`shrink-0 rounded-full px-3.5 h-9 text-sm font-medium transition
            ${active === t.id
              ? 'bg-brand-rose text-white shadow-sm'
              : 'bg-white text-brand-charcoal border border-brand-line hover:bg-brand-soft'}`}
        >
          {t.label}
          {typeof t.count === 'number' && (
            <span className={`ml-1.5 text-xs ${active === t.id ? 'opacity-85' : 'text-brand-muted'}`}>
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function FilterChips<T extends string>({
  options, value, onChange, allLabel = 'All',
}: {
  options: Array<{ value: T; label: string }>;
  value: T | null; onChange: (v: T | null) => void; allLabel?: string;
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto no-scrollbar py-1">
      <button
        onClick={() => onChange(null)}
        className={`shrink-0 rounded-full px-3 h-8 text-xs font-medium border transition
          ${value === null ? 'bg-brand-charcoal text-white border-brand-charcoal'
            : 'bg-white text-brand-charcoal border-brand-line'}`}
      >
        {allLabel}
      </button>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`shrink-0 rounded-full px-3 h-8 text-xs font-medium border transition
            ${value === o.value ? 'bg-brand-charcoal text-white border-brand-charcoal'
              : 'bg-white text-brand-charcoal border-brand-line'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Pagination for long ledgers — simple prev/next, sized for a thumb. */
export function Pager({
  page, pageSize, total, onPage,
}: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 pt-3">
      <p className="text-xs text-brand-muted">
        Page {page + 1} of {pages} · {total} rows
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button size="sm" variant="secondary" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

/**
 * Renders a value only when the caller holds the role.
 *
 * Layer 1 of §52. Note this hides UI, it does not secure data: the queries that
 * feed these values are themselves refused by PostgreSQL for the wrong role.
 */
export function RoleGate({
  allow, children, fallback = null,
}: { allow: Array<'OWNER' | 'STAFF' | 'SUPPLIER'>; children: ReactNode; fallback?: ReactNode }) {
  const { role } = useAuth();
  return role && allow.includes(role) ? <>{children}</> : <>{fallback}</>;
}

export function Drawer({
  open, onClose, title, children,
}: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      {children}
    </Modal>
  );
}
