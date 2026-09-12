# LuBella Platform — Architecture

## 1. Shape of the system

```
React 18 + TypeScript + Tailwind (Vite, PWA)
        │  @supabase/supabase-js  (anon key only — never a service key)
        ▼
Supabase Auth  ──►  JWT (sub = auth.users.id)
        ▼
PostgREST  /rest/v1/<table>        (row reads gated by RLS)
           /rest/v1/rpc/<fn>       (ALL money mutations)
        ▼
PostgreSQL 17   ─┬─ tables + constraints + FKs
                 ├─ views (curated, security_invoker semantics chosen per audience)
                 ├─ Row Level Security on every non-public table
                 └─ SECURITY DEFINER functions = the only writers of money
        ▼
Supabase Storage  product-images (public read) / receipts (owner-only)
```

**Hard rule:** the browser can *read* what RLS permits and can *call functions*. It can never
write a financial row directly. Every table that holds money has `revoke insert, update, delete`
from `authenticated`/`anon`; the only INSERT/UPDATE path is through a `SECURITY DEFINER` RPC
that re-checks the caller's role, locks rows, and commits or rolls back as one transaction.

## 2. Why PostgreSQL holds the logic

`rpc_complete_sale` (POS) is one database transaction that performs, in order:

1. authenticate caller + role + month-close check
2. `SELECT … FOR UPDATE` the product rows (stock concurrency)
3. validate stock, expiry, and price
4. insert `sales` + `sale_items`
5. walk `purchase_batches` oldest-first (`FOR UPDATE`) → `fifo_allocations` → COGS
6. decrement batch `quantity_remaining`
7. insert `stock_movements`
8. upsert `supplier_payables` (one per FIFO allocation — payable is derived from *cost*, never
   from selling price)
9. insert `commissions` (rate × **post-discount** line total)
10. write `audit_logs`
11. COMMIT — any exception rolls back **everything**; there is no partial sale.

Same pattern for `rpc_process_return`, `rpc_void_sale`, `rpc_record_supplier_payment`,
`rpc_record_restock`, `rpc_record_stock_count`, `rpc_close_stock_period`.

## 3. Roles

| Role | Auth | Surface |
|---|---|---|
| `OWNER` | Supabase Auth | Everything |
| `STAFF` | Supabase Auth | POS, products, stock levels, restock, own sales, own commission |
| `SUPPLIER` | Supabase Auth, linked via `supplier_users` | Own transactions only, through curated portal views |
| customer | **no account** | Public catalog views + WhatsApp/Telegram deep links + `rpc_submit_customer_request` |

There is no cashier role. `app_users.role` is the single source of truth; RLS reads it through
`public.fn_is_owner()` / `fn_current_supplier_id()`.

## 4. Cost visibility split (the core security property)

Selling price lives on `products`. **Purchase cost never does.** Cost lives on
`purchase_batches.unit_cost`. Consequences:

- Staff querying `products` cannot see any cost — the column does not exist.
- Staff have **no grant at all** on `purchase_batches`, `fifo_allocations`,
  `purchase_cost_history`, `supplier_payables`, `expenses`, `tithe_records`, `returns`,
  `audit_logs`. Browser devtools and raw REST calls return `permission denied`, not an empty
  list — the wall is in PostgreSQL, not in React.
- Suppliers read only definer-owned portal views filtered by `fn_current_supplier_id()`, with
  `selling_price`, other suppliers, and owner notes absent from the view definition.

## 5. Stock model

Append-only `stock_movements` ledger:

```
BEGINNING_STOCK + RESTOCK + RETURN − SALE − DAMAGE − EXPIRED ± ADJUSTMENT ± VOID_REVERSAL
= expected stock
```

On-hand quantity is always a `SUM()` over the ledger — there is no mutable `stock_on_hand`
column to drift out of sync. FIFO batch `quantity_remaining` is maintained in lockstep inside
the same transactions.

**Biweekly periods** (`stock_periods`): expected vs physical → difference → owner-confirmed
`ADJUSTMENT` movements. The next period's beginning stock is the previous period's physical
closing count.

## 6. Money types

`numeric(14,2)` for every monetary column, `numeric(6,4)` for rates. No floats anywhere in the
schema. Rounding is half-up at 2dp at the point of computation inside SQL, so the ledger and the
P&L can never disagree by a cent.

## 7. Environments

| Environment | Backend | Notes |
|---|---|---|
| Local dev (this workspace) | real PostgreSQL 17 + `devserver/` gateway | local shim for `auth.*`; identical migrations, identical RLS |
| Production | Supabase hosted + Vercel | `supabase db push`, env vars only |

The gateway in `devserver/` implements the small slice of the PostgREST/Auth API the app uses,
executes each request with `SET LOCAL ROLE` + `request.jwt.claims`, and therefore runs the real
policies. It exists purely so the whole stack is runnable and demonstrable offline; it is not
part of the production deployment.

## 8. Future-ready, not future-built

Additive only, no v1 code depends on them: `branch_id` on the ledger tables (multi-branch),
`customer_accounts` + `loyalty_ledger` (accounts/loyalty), `outbox_messages` (WhatsApp/Telegram
automation + notifications), `curated` views for an online store, and an `ai_*` schema for
assistant queries. All v1 tables already carry the FKs and timestamps those features need.
