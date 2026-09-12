# LuBella Cosmetics & Accessories

A shop-management web app for a cosmetics and accessories business in Addis
Ababa: a public catalogue that takes orders on WhatsApp and Telegram, a till for
staff, and the owner's full picture — stock, sales, suppliers, profit.

Built with React + TypeScript + Tailwind on top of Supabase (Postgres, Auth,
Storage) with row level security doing the real work, and deployable to Vercel as
an installable PWA.

---

## Four areas, three kinds of access

| Area | Sign-in | What it is |
|---|---|---|
| **Customer portal** | none — never | catalogue, availability, WhatsApp/Telegram ordering, product requests |
| **Staff portal** | staff login | the till, stock, receiving deliveries, own sales and commission |
| **Owner portal** | owner login | everything: money, cost, suppliers, staff, reports, settings, audit |
| **Supplier portal** | supplier login | own batches, sales, payables, payments, monthly statements |

Customers are never asked to register. Suppliers only ever see their own
records — that isolation is enforced in the database, not in the interface.

## The rules that matter

- **Sales are never deleted.** A mistake is voided, with a reason, and stays in
  the audit log.
- **Commission is 3% of the final, post-discount amount** — owner earns 0%.
- **Supplier payables accrue only on units actually sold**, at the agreed
  purchase cost — never on delivered stock, never at the selling price.
- **FIFO is mandatory.** Every unit sold is traced to the batch it came from.
- **Stock moves only when a sale or an owner-counted adjustment happens.** A
  WhatsApp order request never moves stock.
- **Expired products cannot be sold.**
- **Tithe is 10% of net profit** — zero in a loss month — and is not an operating
  expense. Neither are supplier payments.
- **Money is `numeric(14,2)`** and every figure is derived from transactions.

The full list, with the test that proves each one, is in
[`docs/05-BUSINESS-RULES.md`](docs/05-BUSINESS-RULES.md).

---

## Run it locally

```bash
# 1. database — PostgreSQL 17
sudo pg_ctlcluster 17 main start
./scripts/db.sh reset          # schema, migrations, fixture data
./scripts/db.sh test           # 226 assertions, 26 suites

# 2. gateway — a small local stand-in for Supabase (port 54321)
cd devserver && npm install && npm start

# 3. app (port 5173)
cd ../app && npm install && npm run dev
```

`RESET=1 ./scripts/db.sh test` drops and rebuilds the database first — that is
the normal way to run the suites.

Windows: run the commands above from Git Bash or WSL. If a script answers
`Permission denied` (some unzip tools drop the executable bit), run
`chmod +x scripts/*.sh` once.

### Demo logins (local fixture only)

| Role | Email | Password |
|---|---|---|
| Owner | `owner@lubella.shop` | `owner-pass` |
| Staff | `sara@lubella.shop` | `sara-pass` |
| Staff | `hana@lubella.shop` | `hana-pass` |
| Supplier A | `abc@supplier.et` | `abc-pass` |
| Supplier B | `xyz@supplier.et` | `xyz-pass` |

The customer portal needs no login at all.

### Prove the walls hold over HTTP

```bash
python3 scripts/e2e.py
```

98 checks against the running gateway with real logins: anon refusals, the staff
cost wall, another staff member's sale, supplier A vs supplier B, the POS money
path (sale → stock → commission → replay safety → return → void), supplier
payments, the P&L identity and the tithe rule.

---

## Layout

```
app/                     React + TypeScript + Tailwind PWA
  src/api/               one module per area — the only place that talks to the DB
  src/pages/             customer/ · owner/ · staff/ · supplier/ · pos/ · shared/
  src/components/        UI primitives, three logo treatments, product card
  src/lib/               supabase client, auth, formatting, async hooks
  public/                demo photos, brand assets, PWA icons, service worker
supabase/
  migrations/            0001 … 0024, then 9999_api_grants.sql (always last)
  functions/             admin-create-user Edge Function (production only)
  tests/                 fixture + business-rule and security suites
  local/                 auth shim so plain PostgreSQL behaves like Supabase
devserver/               local Supabase-shaped gateway (PostgREST subset + JWT)
scripts/db.sh            reset · test · sql · serve
scripts/e2e.py           role-by-role HTTP checks
scripts/bundle_sql.sh    builds supabase/production_bundle.sql (one-paste deploy)
scripts/verify_production.sql   11 read-only checks for a deployed database
scripts/backup.sh        weekly pg_dump with rotation
scripts/backup_to_drive.sh  same dump, then into Google Drive (desktop app or rclone)
scripts/make_icons.py    regenerates the PWA icons
docs/                    architecture, brand, business rules, deployment, go-live
```

`supabase/production_bundle.sql` is the whole database in one file, in the right
order, ending with the grants. Apply it to a fresh Supabase project with one
paste; `scripts/verify_production.sql` then proves the deployment is sound
(11 checks: RLS everywhere, the public surface is exactly two catalogue views and
18 functions, cost and supplier money are unreachable through the API).

## Deploying

Runs at **$0/month** with no traffic ceiling: Cloudflare Pages Free (commercial use
is allowed on its free tier — unlike Vercel's Hobby plan) and the Supabase free
plan, kept from pausing by `.github/workflows/keepalive.yml` and backed up weekly
by `.github/workflows/weekly-backup.yml`.

- **[`docs/07-GO-LIVE.md`](docs/07-GO-LIVE.md)** — the step-by-step walkthrough:
  decisions and costs, Supabase project, one-paste database, the first owner,
  hosting, the shop's settings, entering the catalogue, backups, and a launch
  checklist that walks owner → till → customer → supplier.
- [`docs/06-DEPLOYMENT.md`](docs/06-DEPLOYMENT.md) — the same ground as a
  reference: migrations, Storage bucket, Edge Function secrets, environment
  variables, the Telegram bot, the weekly backup.

## A note on where the logic lives

The rules of this shop are enforced in PostgreSQL — functions, constraints,
triggers and RLS policies — and only *presented* by React. A user who opens
devtools, or calls the API with `curl`, meets exactly the same limits. That is
deliberate: commission, cost, profit and supplier balances must not be
calculable only in a browser.
