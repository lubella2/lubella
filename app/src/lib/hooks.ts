import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './supabase';

/**
 * Small data-loading helper.
 *
 * Deliberately minimal: it exposes loading/error/data plus a refetch, so every
 * screen handles the three real states — a dashboard that silently shows zeros
 * while a request is in flight is worse than one that says it is loading, and a
 * permission refusal must be legible rather than looking like "no data".
 */
export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  permissionDenied: boolean;
  reload: () => void;
}

export function useAsync<T>(
  loader: () => Promise<T>,
  deps: unknown[] = [],
  options: { enabled?: boolean } = {},
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(options.enabled !== false);
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [nonce, setNonce] = useState(0);
  const mounted = useRef(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (options.enabled === false) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPermissionDenied(false);

    loaderRef
      .current()
      .then((result) => {
        if (cancelled) return;
        setData(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const apiError = err as ApiError;
        setPermissionDenied(Boolean(apiError?.isPermissionError));
        setError(apiError?.message || 'Could not load this information.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, options.enabled]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, permissionDenied, reload };
}

/** Delays a fast-changing value — used by the search box. */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/* ------------------------------- phone cart -------------------------------- */

export interface StoredCartLine {
  product_id: string;
  name: string;
  selling_price: number;
  quantity: number;
  image_url?: string | null;
  availability?: string;
}

/**
 * The customer's selection survives a refresh and a phone lock, so a shopper
 * who switches to WhatsApp to ask a question and comes back does not lose their
 * basket. Stored locally only — nothing is reserved or deducted (§9).
 */
export function usePersistentCart() {
  const key = 'lubella.customer-cart';
  const [lines, setLines] = useState<StoredCartLine[]>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as StoredCartLine[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(lines));
    } catch {
      /* private mode: the basket simply will not survive a refresh */
    }
  }, [lines]);

  const add = useCallback((line: StoredCartLine, replaceQuantity = false) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.product_id === line.product_id);
      if (!existing) return [...prev, line];
      return prev.map((l) =>
        l.product_id === line.product_id
          ? { ...l, quantity: replaceQuantity ? line.quantity : l.quantity + line.quantity,
              name: line.name, selling_price: line.selling_price, image_url: line.image_url,
              availability: line.availability }
          : l,
      );
    });
  }, []);

  const setQuantity = useCallback((productId: string, quantity: number) => {
    setLines((prev) =>
      quantity <= 0
        ? prev.filter((l) => l.product_id !== productId)
        : prev.map((l) => (l.product_id === productId ? { ...l, quantity } : l)),
    );
  }, []);

  const remove = useCallback((productId: string) => {
    setLines((prev) => prev.filter((l) => l.product_id !== productId));
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const total = lines.reduce((sum, l) => sum + l.selling_price * l.quantity, 0);
  const count = lines.reduce((sum, l) => sum + l.quantity, 0);

  return { lines, add, setQuantity, remove, clear, total, count };
}
