# LuBella — Business Rules

This is the reference for how the shop's money and stock behave. Every rule
below is enforced in PostgreSQL — in a function, a constraint, a trigger or a row
level security policy — so it holds even if someone calls the API directly and
skips the interface entirely. The right-hand column names the test that proves
it, and all of them run with `RESET=1 ./scripts/db.sh test`.

Nothing in this list is implemented only in React.

---

## 1. Roles

| Area | Who | How they get in | What they can reach |
|---|---|---|---|
| Owner portal | `OWNER` | email + password | everything: money, cost, staff, suppliers, settings, audit |
| Staff portal | `STAFF` | email + password | the till, stock, receiving, their own sales and commission |
| Customer portal | anonymous | no account, ever | published catalogue, order links, product requests |
| Supplier portal | `SUPPLIER` | email + password | their own batches, sales, payables, payments, statements |

There is **no cashier role**. A customer is never asked to register or sign in.

> Note: the first account ever created becomes the owner; every later sign-up is
> created by the owner from Staff & Access. A supplier login is linked to exactly
> one supplier row, and `fn_current_supplier_id()` resolves that link inside the
> database — a supplier cannot name, guess or edit a different supplier id.

**Tests:** `Owner`, `Staff limits`, `Staff scope`, `Supplier isolation`.

---

## 2. Prices, discounts and the sale total

1. A line's price is `products.selling_price` **at the moment of the sale**. A
   later price change never rewrites history.
2. A discount is allocated across the lines in proportion to their subtotals by
   `fn_allocate_discount()`, rounding each line half-up and giving the last line
   the remainder — so the line discounts sum **exactly** to the sale discount.
   No cent is created or lost by rounding.
3. `total_amount = subtotal − discount_amount`. Tax is 0 and exists as a column
   only for future use.
4. Every sale carries a `client_ref`. If the same `client_ref` is submitted twice
   (a double tap, a retried request, a flaky connection) the original sale is
   returned with `replayed: true` — **a second sale is never created and stock is
   never deducted twice.**

**Tests:** `Discount`, `POS`, `Stock concurrency`.

---

## 3. Staff commission

- Commission is **3% of the final, post-discount amount** — never of the
  pre-discount subtotal. The owner's rate is 0%.
- The rate is per person (`app_users.commission_rate`), read at the time of the
  sale and stamped on the `commissions` row, so a later rate change does not
  rewrite past earnings.
- A return reverses the commission on the returned units; a void reverses it for
  the whole sale.
- Commission payments the shop makes to staff are recorded separately and reduce
  what is still owed.

> Why it matters: on a 2,000 Birr sale with a 200 Birr discount, commission is
> 3% of **1,800 = 54**, not 60. See the `Commission` and `Discount` suites.

**Tests:** `Commission`, `Discount`, `Returns`, `Void`.

---

## 4. FIFO and cost of goods sold

- Each delivery is one row in `purchase_batches`, carrying a `batch_number`, the
  quantity received, and the **purchase cost per unit**.
- Units always leave the oldest non-exhausted batch first. Each sale writes one
  `fifo_allocations` row per batch touched, recording product, batch, supplier,
  quantity, unit cost and total cost.
- COGS is the sum of those allocations. **Cost always comes from the batch's
  purchase cost and never from the selling price** — otherwise profit would be
  nonsense.
- Cost is only ever written to `purchase_batches.unit_cost`. Nowhere else in the
  database stores "what this cost us".

**Tests:** `FIFO`, `POS`.

---

## 5. Stock

`fn_on_hand(product)` is the single source of truth: the sum of
`stock_movements.quantity` for that product. Nothing stores a stock number that
could drift away from its movements.

Stock **decreases** only when:

| Event | Movement | Who may do it |
|---|---|---|
| A sale at the till | `SALE` | staff or owner |
| A customer return kept aside (`restock = false`) | `RETURN` | owner |
| Damaged / expired write-off | `DAMAGE` / `EXPIRY` | owner |

Stock **increases** only when:

| Event | Movement | Who |
|---|---|---|
| Receiving a delivery | `RESTOCK` | owner (staff may receive, cost is the owner's) |
| A return chosen to go back on the shelf | `RETURN` | owner |
| A stock count correction after confirming a period | `ADJUSTMENT` | owner |

- **A WhatsApp or Telegram order request never moves stock.** It is a request,
  not a sale; stock only moves when someone rings the sale up at the till.
- **Expired products cannot be sold** — the till refuses with `PRODUCT_EXPIRED`.
- Stock adjustments require a written reason.
- Counts are recorded per biweekly period; confirming a period writes the
  adjustments and the **next period's opening stock is the previous physical
  closing count**.

**Tests:** `Stock count`, `Restock`, `Expiry`, `Stock concurrency`, `POS`.

---

## 6. Supplier credit (the shop pays for what sold, not for what arrived)

- Delivering stock creates **no payable**. A `supplier_payables` row is created
  only when units from that batch are **actually sold**, and its amount is
  `quantity_sold × batch unit cost` — the purchase cost, never the selling price.
- A customer return offsets the payable for the returned units with an
  `is_reversal` row. A void does the same for unreturned units.
- `outstanding = payable_amount − amount_paid`. A payment settles the oldest
  open lines first, writing a `supplier_payment_allocations` row per line.
- **Supplier payments are not operating expenses.** They settle a liability that
  was already recognised in COGS. Counting them again would double-count the
  cost and understate profit.
- Monthly statements are generated from the transaction rows
  (`rpc_generate_supplier_statement`), never typed in.

**Tests:** `Credit book`, `Statement`, `Supplier isolation`.

---

## 7. Returns

- **Owner only.** Staff may take a sale but may not reverse one.
- The refund can never exceed what is still unrefunded on that line (the
  remaining-value rule), so repeated partial returns cannot over-refund.
- A return reverses, in one transaction: revenue, inventory (if the goods come
  back), the FIFO allocations and COGS, the supplier payable for those units, and
  the commission that was earned on them.
- Damaged goods: the customer is refunded, but the cost stays in COGS and the
  supplier payable stays — the shop bears that loss.

**Tests:** `Returns`.

---

## 8. Voids

- A sale is **never deleted**. Voiding sets `status = 'VOIDED'` and records who
  voided it, when, and why.
- Only the unreturned units are reversed; anything a customer already returned is
  left alone.
- The sale remains visible in reports and in the audit log.

**Tests:** `Void`.

---

## 9. Expenses, profit and loss

```
net_sales     = sales − discounts − returns
gross_profit  = net_sales − COGS
net_profit    = gross_profit − operating_expenses − staff_commission
```

- `rpc_report_pnl` returns these per month, with a `formula` block so the figures
  can be checked by hand.
- Operating expenses are rent, electricity, water, internet, transport,
  marketing, packaging, salaries, maintenance, bank charges, other.
- **Not** operating expenses: supplier payments (see §6) and tithe (see §10).

**Tests:** `P&L`, `Month close`.

---

## 10. Tithe

- Tithe is **10% of net profit** for the month.
- If the month made a loss, tithe is **0** — never negative, never a refund.
- Tithe is **not** an operating expense; it is recorded in `tithe_records`
  separately and never reduces the profit it is calculated from.
- Recomputing a month preserves an amount already marked `PAID`.
- The rate lives in settings (`tithe_rate`).

**Tests:** `Tithe`.

---

## 11. Customer requests (demand capture)

- Anonymous, no login. A name, a phone number and what they want.
- The phone number is normalised and rate-limited to **5 requests per phone per
  hour** (`request_rate_limit`, keyed by `md5(digits)`), so the form cannot be
  used to spam the shop.
- Requests are stored with the requested product, quantity, message, optional
  photo, source (website / WhatsApp / Telegram / staff) and a status history.
- If the product was unavailable when requested, the row is flagged
  `was_unavailable` — that flag is what the demand report counts.
- **A request never touches stock or money.**

**Tests:** `Customer request`, `Demand`, `Customer`.

---

## 12. What the public may see

- Published products only, with availability shown as 🟢 Available /
  🟡 Low stock / 🔴 Out of stock. **Never** an exact stock number.
- No cost, no supplier, no margin, no customer phone numbers, no staff names.
- The WhatsApp number, Telegram handle and shop contact details come from
  settings (`fn_public_settings()`), so the owner can change them without a
  deploy. Private rows — the Telegram **bot token** especially — are never
  reachable from a browser, in the catalogue, the message builders or anywhere
  else.

**Tests:** `Customer`, `Staff cost wall`, `Supplier isolation`.

---

## 13. Money handling

- All money is `numeric(14,2)`. No floats anywhere in the schema.
- Rounding is half-up and centralised in `fn_money()`.
- Every figure the shop shows — payables, balances, statements, P&L, commission,
  tithe — is **derived from transaction rows**, never typed in by hand.

**Tests:** `Discount`, `FIFO`, `Credit book`, `P&L`.

---

## 14. Audit and backup

- Every mutation that matters writes an `audit_logs` row: who, what, when, and
  the before/after values. The log is append-only for client roles and readable
  by the owner only.
- Month closes are audited; reopening a month is audited and marked.
- Backup runs are recorded (`backup_runs`) and viewable in Settings. The owner
  runs a **weekly** backup; the app tracks that it happened and when the next one
  is due. Backups are never Google Sheets.

**Tests:** `Owner`, `Month close`, `No direct writes`.

---

## Where each rule lives

| Rule | Enforced by | Migration |
|---|---|---|
| Sale, discount split, FIFO, commission | `rpc_complete_sale`, `fn_allocate_discount` | `0011` |
| Returns, voids | `rpc_process_return`, `rpc_void_sale` | `0011` |
| Stock movements, restock, counts, periods | `rpc_record_restock`, `rpc_adjust_stock`, `rpc_*_stock_count` | `0012` |
| Supplier payables and payments, expenses, tithe, month close | `rpc_record_supplier_payment`, `rpc_record_expense`, `rpc_compute_tithe`, `rpc_close_month` | `0013` |
| Public catalogue and requests | `rpc_public_catalog`, `rpc_submit_customer_request` | `0014` |
| Staff, settings, audit, backup | `rpc_update_staff`, `rpc_update_settings`, `rpc_audit_log`, `rpc_record_backup_run` | `0015` |
| Reports: P&L, FIFO, sales, inventory, demand | `rpc_report_*` | `0016`, `0022`, `0023` |
| Row level security | `supabase/migrations/0010_rls.sql` | `0010` |
| Grants (which role may call what) | `9999_api_grants.sql`, applied last | `9999` |

If you change a business rule, change the test first — `02_business_rules.sql`
and `03_security_rls.sql` are the specification in executable form.
