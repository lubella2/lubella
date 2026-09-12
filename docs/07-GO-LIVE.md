# LuBella — Go live, step by step

This is the walkthrough for taking the finished application from this repository
to a running shop: database, first owner, staff, suppliers, hosting, settings,
backups, and the final proof that the walls hold.

It assumes nothing except a browser, a terminal sometimes, and about
**60–90 minutes**. Part 0 (running it on your own machine) is optional; parts
1–11 are the real deployment.

```
 0. Run it locally (optional) ............ 10 min   proof the code works before you pay anyone
 1. Decisions to make first ............... 5 min   hosting + Supabase plan
 2. Supabase project ..................... 10 min
 3. Apply the database ................... 10 min   one paste, then verify
 4. The first owner ....................... 5 min
 5. Auth, Storage, Edge Function ......... 15 min
 6. Put the app on the internet .......... 15 min
 7. Set the shop's details in Settings ... 10 min   ← the WhatsApp number lives here
 8. Enter your real catalogue & stock .... 20 min
 9. Telegram ordering ..................... 5 min   plus one optional piece to build
10. Backups .............................. 10 min
11. The launch checklist ................. 15 min   owner → till → customer → supplier
```

---

## Before you start

Get these ready:

- [ ] An email address that will **own** the shop's Supabase and hosting accounts
      (use a shop address, not a personal one — you will hand this to someone one day).
- [ ] The shop's **WhatsApp number** in international format (`+2519…`).
- [ ] Your shop logo (already in the repo at `app/public/brand/`) and product photos.
- [ ] Staff list with names, emails and who earns the 3% commission.
- [ ] Supplier list with names and phone numbers.
- [ ] A card for hosting/database if you choose the paid tiers (see step 1).
- [ ] A **password manager**. You will create: Supabase account password, database
      password, owner login, host account. Write them down as you go.

Keep the owner login separate from the staff logins. The owner account can see
cost, profit and every staff member's sales; nobody else can.

---

## Step 1 — Decisions to make first

Three decisions change the instructions further down. Everything else is fixed.

### 1.1 Where the app is hosted — and can it be free?

| Host | Cost | Commercial use | What you actually get |
|---|---|---|---|
| **Cloudflare Pages** (Free) | **$0, indefinitely** | **allowed** | Unlimited static bandwidth and requests, 500 builds/month, unlimited sites, free SSL and custom domain. At the cap it *keeps serving*; only new builds are refused that month. |
| **Netlify** (Free) | **$0** | **allowed** | 300 credits/month (≈15 GB of bandwidth or ≈30 GB-hours), unlimited deploy previews, custom domain + SSL. At the cap the site pauses until the month rolls over. |
| **Vercel Pro** | ~$20 per seat / month | allowed | The most polished dashboard; `app/vercel.json` is already written for it. |
| **Vercel Hobby** | $0 | **not allowed** | Personal, non-commercial projects only — and Vercel enforces it. A shop that takes money is commercial. Do not host the shop here. |

> **Is the free tier really enough for a shop with no traffic?** Yes. The app is a
> *static* build — there is no server of ours to keep warm — so hosting costs
> nothing to serve and nothing to sit idle. The only free tier to avoid is
> Vercel's Hobby, and that is a *licensing* limit, not a traffic limit: it is
> prohibited regardless of how few visitors you have.

**Recommendation:** **Cloudflare Pages Free**, deployed from GitHub with the
repository root's `app` folder as the build root (`npm run build` → `app/dist`).
It costs $0 forever at this shop's scale, and `app/public/_redirects` — already in
the repository — handles SPA routing. Move to Vercel Pro later only if you want
its dashboard; nothing in the app has to change.

### 1.2 Supabase plan

| Plan | Cost | What matters for this shop |
|---|---|---|
| Free | $0 | 500 MB database, 1 GB storage, 5 GB egress, 50k monthly users, 500k Edge Function calls. Commercial use *is* allowed. **Pauses after 7 days with no database activity** — data is kept, you unpause from the dashboard. No downloadable backups, no point-in-time recovery. |
| Pro | ~$25 per organisation / month | 8 GB database, **never pauses**, daily backups with 7-day retention, support. |

**How much of the free plan would this shop use?** Almost none of it. A year of
sales for a shop this size is a few tens of megabytes of the 500 MB; a thousand
product photos are well under the 1 GB storage; the month's egress is a rounding
error against 5 GB unless thousands of customers browse daily. The database is
not the constraint — the *pause* and the *backups* are.

**The one real risk of free, and why it is worse when traffic is low:** after 7
days with no database request the project pauses. A busy shop never notices —
staff ringing up sales *is* database activity. A quiet shop is exactly the case
that pauses. So:

- **If your shop is being used at least weekly** (a sale, a stock count, a
  receipt): you will never hit the pause. Stay free with no further thought.
- **If it can sit untouched for a week or more** (pre-launch, a slow season, a
  break): add the keep-alive in step 10.2. It is one free daily request, and it
  removes the problem entirely.
- **If the shop is closed and you do not care for a while:** let it pause. The
  data is preserved; unpause when you reopen.

**Recommendation:** start Free, host on Cloudflare Pages Free, add the keep-alive
and the weekly dump (steps 10.1–10.2). That is a genuine **$0/month** launch with
no traffic limit. Move to Pro when one of these becomes true:

1. Real money depends on the shop being up *right now* — Pro never pauses, so you
   cannot be offline without also being offline at Supabase (a status you can see).
2. You want daily backups / point-in-time recovery rather than your own weekly
   dump.
3. You want Supabase support.

Notice which trigger is *not* on that list: traffic. Upgrading is about
not-being-surprised, not about volume.

### 1.3 A domain (optional but recommended)

`lubella-shop.com` (or `.et`) bought from any registrar and pointed at the host in
step 6. Prices vary; around $10–15/year. Without it you get a host URL like
`lubella.vercel.app`, which works fine for a soft launch. After you attach the
domain, come back to step 5.4 and add it to Supabase's allowed URLs.

---

## Step 0 — Run it locally first (optional, 10 minutes)

Skip this if you trust the code. It is here because seeing the four portals work
on your own machine, with demo data, is the cheapest way to know what you are
deploying.

You need PostgreSQL 17, Node.js 18+, and this repository.

```bash
# 1. database (creates schema, migrations, demo data)
sudo pg_ctlcluster 17 main start        # macOS with Homebrew: brew services start postgresql@17
./scripts/db.sh reset

# 2. a local stand-in for Supabase on port 54321
cd devserver && npm install && npm start

# 3. the app on http://localhost:5173
cd ../app && npm install && npm run dev
```

Open <http://localhost:5173>. Sign in with the demo accounts:

| Role | Email | Password |
|---|---|---|
| Owner | `owner@lubella.shop` | `owner-pass` |
| Staff | `sara@lubella.shop` | `sara-pass` |
| Supplier A | `abc@supplier.et` | `abc-pass` |
| Supplier B | `xyz@supplier.et` | `xyz-pass` |

The customer portal is the site you see **signed out** — no account, ever.

Two more commands prove the business rules hold:

```bash
RESET=1 ./scripts/db.sh test     # 26 suites, 226 assertions
python3 scripts/e2e.py           # 98 HTTP checks: logins, walls, POS, returns, tithe
```

Both must end with zero failures before you deploy. If they do not, stop and fix
that first — it is far easier here than in production.

---

## Step 2 — Supabase project (10 minutes)

1. Go to <https://supabase.com> → **Start your project** → sign in with GitHub or
   email.
2. **New project**:
   - **Name:** `lubella-shop`
   - **Database password:** generate a long one and **save it in your password
     manager now**. You will need it in step 3, and it is not shown again.
   - **Region:** the one closest to your customers — for Addis Ababa that is
     normally **Frankfurt (eu-central-1)**. If your project list offers a South
     Africa region, that is closer still.
3. Wait ~2 minutes for provisioning.
4. Collect four values (Project settings → **API**):
   - **Project URL** — `https://<ref>.supabase.co` → this becomes `VITE_SUPABASE_URL`
   - **anon public** key → `VITE_SUPABASE_ANON_KEY`
   - **service_role** key → used **only** as a secret for the Edge Function in
     step 5.3, never in the web app, never in a git commit.
   - **Project ref** — the `<ref>` inside the URL.
5. Get the connection string: **Connect** (top bar) → **Connection pooling** →
   **Session** mode. It looks like:

   ```
   postgres://postgres.<ref>:<database-password>@aws-0-<region>.pooler.supabase.com:5432/postgres
   ```

   Keep it handy for step 3. (The **Direct connection** also works.)

> The browser will only ever hold the **anon** key, which on its own can do
> nothing: every table, view and function re-checks the caller's role inside
> PostgreSQL. That is the design, and step 3 verifies it on your own database.

---

## Step 3 — Apply the database (10 minutes)

Everything the shop needs — 33 tables, 22 views, 103 functions and all row level
security policies — is in one generated file: **`supabase/production_bundle.sql`**
(24 migrations in order, ending with `9999_api_grants.sql`, which must always be
the last thing applied).

### 3.1 Option A — paste it into the SQL editor (easiest)

1. Supabase dashboard → **SQL Editor** → **New query**.
2. Open `supabase/production_bundle.sql`, copy its entire contents, paste, **Run**.
3. Wait for `Success. No rows returned`. It takes a few seconds.

### 3.2 Option B — the terminal (better for repeatable deploys)

Install a PostgreSQL client if you do not have one (`brew install libpq` on
macOS, the EDB "Command Line Tools" installer on Windows, `apt install
postgresql-client` on Linux), then:

```bash
export DATABASE_URL="postgres://postgres.<ref>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/production_bundle.sql
```

If you prefer the individual files (identical result, easier to see what ran):

```bash
for f in supabase/migrations/*.sql; do echo "→ $f"; psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
```

**Never apply these to production:** `supabase/local/0000_local_shim.sql` (fakes
Supabase's `auth` schema for local machines) and anything under
`supabase/tests/` (they create demo data).

### 3.3 Prove the database is safe

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify_production.sql
```

Read-only. Every line must say **PASS**:

```
 result |                        check_name
--------+----------------------------------------------------------
 PASS   | all public tables have RLS enabled
 PASS   | anon can execute exactly 18 functions
 PASS   | anon cannot read on-hand stock
 PASS   | anon cannot read sales
 PASS   | anon cannot read the settings table
 PASS   | audit and touch triggers are installed
 PASS   | shop settings were seeded
 PASS   | stock cost is not readable through the API
 PASS   | supplier money tables are not readable through the API
 PASS   | the first-run owner bootstrap function exists
 PASS   | the public (anon) surface is exactly the catalogue views
```

`passed 11  failed 0`. Re-run this after every future migration.

### 3.4 When you change the code later

```bash
./scripts/bundle_sql.sh                                   # regenerate the bundle
psql "$DATABASE_URL" -f supabase/migrations/00XX_new.sql   # your new migration
psql "$DATABASE_URL" -f supabase/migrations/9999_api_grants.sql   # grants, always last
psql "$DATABASE_URL" -f scripts/verify_production.sql      # must be 11/0 again
```

---

## Step 4 — Create the first owner (5 minutes)

The **first** account to register becomes the owner. Everyone after that is
created by the owner from inside the app. Do this before anything else.

1. Supabase dashboard → **Authentication** → **Users** → **Add user** →
   **Create new user**:
   - Email: your shop address, e.g. `owner@lubella.shop`
   - Password: a strong one — this account sees the whole business.
   - Tick **Auto confirm user**.
2. Copy the new user's **UID** from the list.
3. SQL Editor → run (replace the two values):

```sql
select public.rpc_register_app_user(
  'paste-the-user-uid-here'::uuid,   -- auth user id
  'owner@lubella.shop',              -- email
  'LuBella Owner',                   -- display name
  'OWNER',                           -- role
  null,                              -- phone (optional)
  0                                  -- commission rate: owners earn 0%
);
```

You should get a JSON row back for the new owner. The shop now has an owner, and
from this point on **only an owner can create accounts** — the database refuses a
second owner created through the API, and refuses staff creation by anyone else.

*(`auth.create_user()` exists only in the local test shim. On hosted Supabase,
create auth users from the dashboard or with the Edge Function in step 5.3.)*

---

## Step 5 — Auth, Storage and the Edge Function (15 minutes)

### 5.1 Auth settings

**Authentication → Sign In / Providers → Email:**

- Email provider: **on**
- **Confirm email: off** for the first weeks — accounts are created in person by
  the owner, and this avoids "why can't I log in" on day one. Turn it on later if
  you want the extra step.
- **Allow new users to sign up: off.** Accounts are created by the owner, not by
  strangers.
- Password minimum length: **8+**.

### 5.2 Storage bucket for product photos

SQL Editor:

```sql
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true);

create policy "product images are readable by anyone"
  on storage.objects for select using (bucket_id = 'product-images');

create policy "staff and owner may upload product images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and public.fn_is_internal());
```

Public read so the customer catalogue can show photos; uploads only by staff and
owner. Customer request photos go to the same bucket under `requests/`.

### 5.3 The Edge Function (how staff and supplier logins are created)

This is the only piece of ours that holds the service-role key, and it lives on
Supabase's servers, never in the browser.

```bash
# one-time: install the CLI (https://supabase.com/docs/guides/cli)
npm install -g supabase
supabase login
supabase link --project-ref <ref>

supabase functions deploy admin-create-user --project-ref <ref>

supabase secrets set SUPABASE_URL=https://<ref>.supabase.co \
                     SUPABASE_ANON_KEY=<anon key> \
                     SUPABASE_SERVICE_ROLE_KEY=<service_role key>
```

The function asks the database whether the caller is the owner, and only then
creates the auth user; if the profile write fails it deletes the half-created
user, so no orphans are left behind. After this, staff and supplier accounts are
created from the app: **Staff & Access → Add person**, **Suppliers → Link a
supplier login**.

<details>
<summary>No CLI? Create staff accounts by hand instead</summary>

For each person: dashboard → Authentication → Users → Add user (auto-confirm) →
copy the UID → SQL editor:

```sql
select public.rpc_register_app_user(
  '<uid>'::uuid, 'sara@lubella.shop', 'Sara', 'STAFF', '+2519…', 0.03);
```

`0.03` is the 3% commission; use `0` for someone who does not earn it. For a
supplier login use role `'SUPPLIER'` and then link the account to the supplier
record in **Suppliers → Link a supplier login** (that link is what confines them
to their own transactions).
</details>

### 5.4 Allowed URLs (after step 6)

**Authentication → URL configuration:** set **Site URL** to your live address
(`https://lubella.vercel.app` or your domain) and add the same to **Redirect
URLs**. Do this **after** the first deploy, when you know the address, then sign
in once to confirm.

---

## Step 6 — Put the app on the internet (15 minutes)

The web app builds to plain static files. Pick the host from step 1.1.

### 6.1 Vercel (Pro)

1. Push this repository to GitHub (private is fine).
2. <https://vercel.com> → **Add New… → Project** → import the repository.
3. Settings:
   - **Root Directory:** `app`  ← the repository root is not the app root
   - **Framework Preset:** Vite (build `npm run build`, output `dist`)
4. **Environment Variables** (Production and Preview):
   - `VITE_SUPABASE_URL` = `https://<ref>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = the anon key
5. **Deploy.** `app/vercel.json` already rewrites every path to `index.html`, so
   deep links like `/supplier/payables` survive a refresh.

### 6.2 Netlify or Cloudflare Pages (free tiers)

- **Base directory:** `app`
- **Build command:** `npm run build`
- **Publish directory:** `app/dist` (Netlify) / `dist`
- **Environment variables:** the same two as above.
- SPA routing: `app/public/_redirects` is already in the repository and is copied
  into the build; it sends unknown paths to `index.html`.

### 6.3 After the first deploy

- Open the URL. You should see the shop, signed out, with a catalogue — that is
  the customer portal, and it never asks anyone to register.
- Sign in as the owner you made in step 4.
- Go back to **step 5.4** and register the domain in Supabase's URL settings.
- Optional: attach your own domain in the host's dashboard, then add it to
  Supabase too.

---

## Step 7 — Set the shop's details in Settings (10 minutes)

Sign in as owner → **Settings**. These are not cosmetic; the customer portal reads
them.

- [ ] **Shop name, address, phone, email** — shown on the site and on receipts.
- [ ] **WhatsApp number** — international format, `+251911223344`. Every "Order
      on WhatsApp" button is built from this value, so it is written once, here —
      never in the code. If it is empty, WhatsApp ordering is dead on arrival.
- [ ] **WhatsApp display** — what customers see, e.g. `0911 22 33 44`.
- [ ] **Telegram username / bot username** — see step 9.
- [ ] **Receipt footer** — the thank-you line printed on every receipt.
- [ ] **Currency / VAT** — leave VAT at 0 unless you are registered; if you turn
      it on it is shown on receipts and included in the totals.
- [ ] **Low-stock threshold** — the point where the public badge turns 🟡.
- [ ] **Backup reminder day** — e.g. Sunday.

Then check the customer side: open the site signed out → add something to the
order → **Order on WhatsApp**. WhatsApp should open with the full list in the
message box. If it does not, the number in Settings is the reason.

---

## Step 8 — Enter your real catalogue and stock (20 minutes)

Order matters here, because of how the shop's rules work. Do it in this sequence:

1. **Categories** → add your groups (Lips, Face, Fragrance, Accessories…).
2. **Products** → name, brand, category, **selling price**, cost is *not* here
   (cost belongs to the batch you bought), barcode/SKU, photo, expiry date for
   anything perishable, and a low-stock threshold if it differs from the default.
   - Only **active** products appear in the public catalogue.
   - Availability is shown publicly as 🟢 Available / 🟡 Low Stock / 🔴 Out of
     Stock. Never as a number.
3. **Suppliers** → add each supplier with contact details and payment terms.
4. **Stock → Restock / Receive delivery** → record what you actually bought, per
   supplier: product, quantity, **unit purchase cost**, date, batch/expiry. This
   creates the FIFO batch; FIFO consumption, COGS and supplier payables all come
   from these batches.
   - Supplier payables accrue **only on units actually sold**, at this purchase
     cost — never on delivered stock, never at the selling price. That is why
     the unit cost you type here matters so much.
   - Existing shop stock: receive it the same way, dated as your opening stock,
     with its real cost. Nothing about "the stock I already own" should be typed
     in twice anywhere else.
5. **Staff & Access** → add each person (name, email, phone, whether they earn
   commission). They get their login from step 5.3.
6. **Suppliers → Link a supplier login** for the suppliers who should see their
   own statements.
7. **Stock counts** → do your first **physical count** and close the period. The
   next period's beginning stock is that count — from then on the biweekly rhythm
   (count → close → next period) is what keeps the stock figure honest.

What staff see from that moment: the till, products and stock levels, receiving
deliveries, their own sales and their own commission. **No costs, no profit, no
other staff member's sales** — enforced in the database, not by hiding buttons.

---

## Step 9 — Telegram ordering (5 minutes + one optional piece)

Two levels, and it is worth being precise about which one you have.

### 9.1 What works today

Settings → **Telegram username** (`lubella_shop`) and **Telegram bot username**
(the bot you create below). The customer's "Order on Telegram" button then opens
`https://t.me/<bot>?start=<the order text>`, and the app shows the customer the
full message with a copy button.

To create the bot: message **@BotFather** in Telegram → `/newbot` → name and
username → keep the **token** it gives you private. Set the bot's name, photo and
description to LuBella.

**What this does not yet do:** the bot itself does not forward the order to your
phone. Opening a bot with a `?start=` payload shows the customer "Start" and
nothing arrives anywhere until a bot server is wired up. Telegram, honestly
stated, is a **secondary channel that needs one more piece**; WhatsApp is fully
live today (the customer's whole order arrives in your WhatsApp as a normal
message).

### 9.2 The missing piece (optional, I can build it next)

A small Supabase Edge Function that receives Telegram's webhook, verifies the
bot's secret token, and forwards the order text to your personal chat or a staff
group — using the already-seeded settings `telegram_bot_token` (stored
server-side, redacted for everyone including the owner's UI) and
`telegram_order_destination` (`OWNER_DM` or `GROUP`). Say the word and it becomes
the next stage; nothing else in the app has to change.

Meanwhile, the honest recommendation: **put the WhatsApp button everywhere it
matters** — it is the channel your customers already use, and it works today.

---

## Step 10 — Backups (10 minutes)

The shop's entire history is this database. Three layers, cheapest first.

### 10.1 Weekly dump you keep yourself

`scripts/backup.sh` dumps the database, gzips it, keeps the last 8 copies, and
reminds you to record the run in the app.

```bash
export DATABASE_URL="postgres://postgres.<ref>:<password>@…pooler.supabase.com:5432/postgres"
./scripts/backup.sh
```

On a machine that is on every day (macOS/Linux), schedule it:

```bash
crontab -e
# every Sunday at 02:00
0 2 * * 0  cd /path/to/lubella && DATABASE_URL="postgres://…" ./scripts/backup.sh >> ~/lubella-backup.log 2>&1
```

Prefer the cloud (and no machine of yours has to be on)? The workflow is already
in the repository — **`.github/workflows/weekly-backup.yml`** — and runs every
Sunday at 02:00 UTC. Push the repository to GitHub and add one secret
(**Settings → Secrets and variables → Actions → New repository secret**):

```
SUPABASE_DB_URL = postgres://postgres.<ref>:<password>@…pooler.supabase.com:5432/postgres
```

Run it once by hand (**Actions → weekly-backup → Run workflow**) and check the
artifact appears. That artifact is a copy you can restore from; download one and
keep it somewhere you control at least monthly.

**Restore drill — do it once, before you need it.** A backup you have never
restored is a hope, not a backup:

```bash
# into an empty Supabase project
gunzip -c lubella-2026-09-12.sql.gz | psql "$DATABASE_URL" -v ON_ERROR_STOP=1
psql "$DATABASE_URL" -f supabase/migrations/9999_api_grants.sql
psql "$DATABASE_URL" -f scripts/verify_production.sql        # must print passed 11 / failed 0
```

That last line is not a formality. A dump taken with `--no-privileges` restores a
database whose GRANT/REVOKE state is gone — the anonymous API surface quietly
widens back to the PostgreSQL default (every function executable by everyone).
`scripts/backup.sh` therefore keeps privileges and drops only ownership, and the
restore path above was tested end to end: dump → restore → verify, 11 / 0.

Set `SUPABASE_DB_URL` in **Settings → Secrets and variables → Actions**. Artifacts
are convenient but they are not a backup strategy on their own — copy the file to
storage you control (Google Drive, Backblaze B2's free 10 GB, a private repo,
two USB sticks in two drawers). **Google Sheets is not a backup.**

Then record it in the app: **Settings → Backups → Record a run**. That row is what
the owner dashboard reads to show "last backup: …". The dashboard showing a stale
date is the reminder.

### 10.2 If you stay on the free Supabase plan: keep it awake

Free projects pause after 7 days with no database request — you unpause it
manually, and until you do the shop is offline. After a pause there is nothing
inside Supabase that could wake it up: the database is the thing that is asleep,
so the ping has to come from outside.

**`.github/workflows/keepalive.yml` is already in the repository** — one request a
day to a public read-only RPC. Enable it by adding two secrets
(**Settings → Secrets and variables → Actions**):

```
SUPABASE_URL      = https://<ref>.supabase.co
SUPABASE_ANON_KEY = <anon public key>     (safe: this RPC is public by design)
```

Then **Actions → supabase-keepalive → Run workflow** once to confirm it prints
`✓ database awake`. Two caveats worth knowing:

- **GitHub disables scheduled workflows after ~60 days of repository inactivity.**
  Pair it with an external trigger, and better still with a free uptime monitor
  (UptimeRobot, Better Stack, cron-job.org) pointed at the same URL **including the
  `apikey` header**. A monitor is the better half of the deal: it keeps the project
  awake *and* tells you when the shop is down, instead of a customer telling you.
- **Do not bother with an in-database cron (`pg_cron`).** A paused project has no
  database to run the job in.

**The cheapest arrangement of all is to not need any of this:** if the shop is used
at least once a week — a sale, a stock count, a receipt, a report — that activity
*is* the keep-alive. Staff ringing up sales is what keeps a Supabase project
awake.

### 10.4 Send the backup to Google Drive

Yes — and it is worth doing, because the whole point of an off-site copy is that
it lives somewhere other than where the shop runs. Three routes, easiest first.
All of them are **free**: Drive's free tier is 15 GB shared with your Gmail and
Photos, and a dump of this shop is around **50 KB gzipped** — twelve of them is
well under a megabyte.

#### Route A — the Google Drive desktop app (no code, no keys)

1. Install **Google Drive for desktop** on the machine that already runs the
   backup, and let it sync a folder.
2. Point the backup straight at that folder:

```bash
export DATABASE_URL="postgres://…"
export DRIVE_DIR="$HOME/Google Drive/My Drive/LuBella Backups"
export KEEP=12
./scripts/backup_to_drive.sh
```

The script dumps, copies the file into the synced folder, checks the copy, and
prunes to the newest 12 — Google's app does the uploading.

**Trade-off:** the machine has to be switched on for this to happen, and Drive's
sync means a deletion anywhere propagates everywhere. The `KEEP` rotation is what
stops that from mattering.

#### Route B — rclone on your own machine (works headless, works on a server)

`rclone` talks to Drive directly, so nothing needs to be logged in to a desktop
app.

```bash
# 1. install: brew install rclone | winget install Rclone.Rclone | rclone.org/install.sh
# 2. configure a remote called gdrive — this opens your browser once
rclone config
#      n) New remote
#      name> gdrive
#      type> drive
#      client_id> blank      (see the note below — worth ten minutes)
#      client_secret> blank
#      scope> 1              (full access to your own Drive)
#      root_folder_id> blank
#      Edit advanced config> n
#      Use auto config> y    → sign in, allow, come back to the terminal
# 3. prove it works
rclone lsd gdrive:
```

Then every backup:

```bash
DATABASE_URL="postgres://…" DRIVE_REMOTE=gdrive DRIVE_PATH="LuBella Backups" ./scripts/backup_to_drive.sh
```

It uploads, **verifies the size that actually landed in the Drive**, and deletes
the oldest copies beyond `KEEP` (default 12). Any failure exits non-zero with the
reason — a backup that silently stops running is worse than no backup.

> **The trap that breaks this after one week — read this bit.** By default a
> Google Cloud OAuth app sits in **Testing** status, and Google kills external
> refresh tokens **every 7 days** in that state. Your backup will work, then fail
> the following Sunday with `invalid_grant: Token has been expired or revoked`.
> Two ways out, both once-and-done:
>
> - **Make your own OAuth client** (Google Cloud Console → APIs & Services →
>   enable the **Google Drive API** → Credentials → Create credentials → OAuth
>   client ID → **Desktop app**). Use its client id/secret in `rclone config`.
>   Then, in **OAuth consent screen → Publishing status**, set it to
>   **In production**. You will see a "Google hasn't verified this app" warning
>   when you authorise — that is expected for a personal integration; click
>   *Advanced → Go to …* once. Tokens now live until you revoke them.
> - **If the shop's Google account is a Workspace account**, set the app's User
>   type to **Internal** instead: no verification, no warning, no expiry.
>
> Using rclone's shared built-in client id works too, but Google rate-limits it —
> fine for one request a week, and the 7-day rule still applies. Make your own.

#### Route C — fully automatic, in the cloud (recommended once Route B works)

`weekly-backup.yml` already contains the Drive step; it stays dormant until you
give it a secret. On the machine where Route B works:

```bash
base64 -w 0 ~/.config/rclone/rclone.conf     # macOS: base64 -i ~/.config/rclone/rclone.conf
```

Paste that single line into **GitHub → Settings → Secrets and variables →
Actions → New repository secret**, named **`RCLONE_CONFIG_B64`**. Optionally add
`RCLONE_DRIVE_FOLDER` to change the folder name from `LuBella Backups`.

Then **Actions → weekly-backup → Run workflow** and watch it: dump → Drive copy →
artifact. From then on it happens every Sunday at 02:00 UTC with no machine of
yours involved.

#### Two honest caveats

- **The dump does not contain your product photos.** They live in Supabase
  Storage, not in the database. If you want them in Drive as well, create **S3
  access keys** in the Supabase dashboard (Storage → S3 access keys), add a
  second rclone remote of type `s3` using the endpoint and region shown there,
  and mirror the bucket:
  `rclone sync supabase-s3:product-images gdrive:"LuBella Backups/images"`.
  Worth doing once a month rather than weekly — all your photos probably cost
  less than one thought. If the free plan's 1 GB storage is enough, the simplest
  insurance is to keep the originals on the phone or laptop you photographed them
  with.
- **A Google account is a single point of failure too.** One account, one
  password. Turn on 2-step verification, and remember that Drive copies are
  deleted *with* the account if you lose it — which is why step 10.1's local
  rotation and the workflow's artifact stay in place alongside it.

### 10.3 Pro's daily backups

If you take Supabase Pro, turn on **Database → Backups** and confirm the daily
window. Pro restores are point-in-time; combined with 10.1 you have both "the
shop as of yesterday" and "a copy I hold myself".

---

## Step 11 — The launch checklist (15 minutes)

Do this once, on a phone and on a computer, on the live site.

**Owner (your account)**
- [ ] Dashboard shows today's sales, stock alerts and the last backup date.
- [ ] Products list the catalogue; a product photo uploads from the phone camera.
- [ ] Expenses: add one small expense — net profit drops by exactly that amount.
- [ ] Reports: P&L for the month, tithe shown as 10% of net profit (0 in a loss
      month), and the tithe is **not** counted as an expense.
- [ ] Sales: a receipt opens, and a returned item reverses revenue, stock, FIFO
      cost, supplier payable and commission.
- [ ] A void keeps the sale row, marked VOIDED, with your reason — nothing is ever
      deleted.
- [ ] Settings: the WhatsApp number is yours; audit log shows your actions.

**Till (staff account)**
- [ ] Sell one item: stock drops by exactly one, receipt prints, commission
      appears at 3% of the **post-discount** total.
- [ ] A discounted sale: commission is calculated after the discount.
- [ ] An expired product cannot be sold — the till refuses it.
- [ ] Staff cannot see cost, profit, P&L or another staff member's sales. Try it
      in devtools or with `curl` on the same token: the database refuses, not just
      the screen.

**Customer (signed out, on a phone)**
- [ ] Catalogue loads, badges show 🟢 / 🟡 / 🔴 and never a stock number.
- [ ] "Order on WhatsApp" opens WhatsApp with the full order text.
- [ ] A product request submits without any login and lands in the owner's
      Requested Products list with a demand count.
- [ ] "Add to Home Screen" installs the PWA and it opens without browser chrome.

**Supplier (a supplier login)**
- [ ] Sees only their own batches, sales, payables, payments and statements.
- [ ] Cannot see any other supplier's rows — again, test with `curl`, not just the
      screen.

**Money sanity (do this once with real numbers)**
- [ ] A supplier payment reduces the payable but does **not** appear as an
      operating expense.
- [ ] Payables total = this month's statements total.

If any box fails, check `docs/05-BUSINESS-RULES.md` first: the rule is usually
working and the expectation is wrong.

---

## Cost summary

| Item | Free path | Comfortable path |
|---|---|---|
| Hosting | **Cloudflare Pages Free — commercial use allowed, unlimited static bandwidth** | Vercel Pro ~$20 / seat / month |
| Database | **Supabase Free** — 500 MB, 50k users; needs the keep-alive (10.2) and your own weekly dump | Supabase Pro ~$25 / org / month (daily backups, never pauses) |
| Domain | optional — the host's free subdomain works; a custom domain on Cloudflare Pages / Netlify costs $0 extra | ~$10–15 / year for the name itself |
| WhatsApp / Telegram | free | free |
| **Total** | **$0 / month** | **~$45 / month + domain** |

The $0 path is not a trial, and it is not against anyone's rules: Cloudflare
Pages and Netlify both allow commercial use on their free tiers, and Supabase
allows it on its free plan. You are paying in **attention** instead of money —
one keep-alive so the project does not pause, and one weekly dump you download
and keep. That is a fair trade for a shop with no traffic.

Move to Pro when you would rather pay than think about it: when being offline at
the wrong moment costs more than $25, or when you want Supabase's own daily
backups instead of your own. **Not because of traffic** — 500 MB and 5 GB of
egress are far beyond what this shop will produce for years.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| White page after deploy, or deep links 404 | Built from the repository root, or no SPA rewrite | Root directory must be `app`; keep `app/vercel.json` (Vercel) or `app/public/_redirects` (Netlify / Cloudflare) |
| Every page shows an empty catalogue / errors | Wrong or missing env vars, or the app was built before they were added | Re-check `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the host, then redeploy (they are baked in at build time) |
| "Order on WhatsApp" does nothing | WhatsApp number empty in Settings | Step 7 — set it in international format |
| Staff sees cost or profit figures | Verification was skipped, or an old migration was applied without `9999_api_grants.sql` | Run `scripts/verify_production.sql`; it must be 11/0. Grants file always goes last |
| "BOOTSTRAP: the first account must be the OWNER" | You tried to create staff before an owner existed | Do step 4 first |
| Owner sign-in works, "Add person" fails | Edge Function not deployed, or its secrets are missing | Step 5.3 |
| Supplier sees nothing at all | Login not linked to the supplier record | Suppliers → Link a supplier login |
| Supplier sees everything (or another supplier's data) | Should be impossible — this is enforced in the database | Stop and run `scripts/verify_production.sql` + `python3 scripts/e2e.py` locally; do not patch the UI |
| Project paused (free plan) | 7 days with no database request — most likely on a shop nobody used that week | Unpause in the dashboard (data is kept), then enable `.github/workflows/keepalive.yml` (step 10.2), or point a free uptime monitor at the same URL, or move to Pro |
| The site loads but nothing works: no catalogue, login or till | A paused Supabase project still serves the *static* app, so the shell looks fine while every request fails | Check the Supabase dashboard first — this is the exact failure the keep-alive prevents |
| Database password lost | — | Reset it in Project settings → Database; nothing in the app depends on it (the app uses the anon key) |

---

## What is deliberately *not* done yet

Said plainly, so nothing is discovered at the wrong moment:

1. **The Telegram bot's server half** (step 9.2). WhatsApp ordering works fully;
   Telegram needs that one Edge Function. ~1 stage of work.
2. **A production `e2e.py` run.** `scripts/e2e.py` logs in with the *demo*
   accounts from the local fixture, so it belongs on your machine, not on
   production. On production, use `scripts/verify_production.sql` plus the step 11
   checklist.
3. **SMS or email receipts to customers.** Receipts print and can be shared; there
   is no customer messaging integration.
4. **Multi-branch / multi-shop.** The data model assumes one shop.
5. **Barcode hardware.** Products have barcodes/SKUs and are searchable by them; a
   scanner that types into the search box works, a custom driver does not exist.

Everything in the original specification's "Definition of Done", other than the
Telegram bot server half, is implemented and tested — 26 database suites (226
assertions), 98 HTTP checks, and the 11 production checks above.
