# LuBella — Deployment

Two pieces in production:

```
React + TS (Vite, on Vercel)  →  Supabase
                                  ├── Auth (email + password)
                                  ├── Postgres + RLS + RPC functions
                                  ├── Storage (product images)
                                  └── Edge Function: admin-create-user
```

The browser only ever holds the **anon key**, which is powerless on its own:
every table, view and function re-checks the caller's role inside PostgreSQL.
The **service-role key** exists only inside the Edge Function.

> **New to this?** [`07-GO-LIVE.md`](07-GO-LIVE.md) is the same deployment written
> as a step-by-step walkthrough with decisions, costs, a launch checklist and
> troubleshooting. This file is the reference; that one is the procedure.
>
> **Hosting note.** Vercel's free *Hobby* plan is restricted to personal,
> non-commercial projects, and Vercel enforces that. A shop taking money needs
> **Vercel Pro** (~$20/seat/month), or Netlify / Cloudflare Pages on their free
> tiers — `app/public/_redirects` already ships the SPA fallback for those.

---

## 1. Supabase project

1. Create a project at supabase.com. Note the project ref (it is in the URL).
2. From **Project settings → API**, copy:
   - Project URL → `VITE_SUPABASE_URL`
   - `anon` public key → `VITE_SUPABASE_ANON_KEY`
   - `service_role` key → used only as a function secret in step 5.

### Apply the database

The migrations are plain SQL and are meant to be applied **in filename order**,
with `supabase/migrations/9999_api_grants.sql` **last** — it is the file that
decides which role may execute what, and it revokes before it grants.

**Fastest path — one file, one paste.** `supabase/production_bundle.sql` is the
24 migrations concatenated in filename order, ending with the grants file. Paste
it into the Supabase SQL editor (New query → Run), or:

```bash
export DATABASE_URL="postgres://postgres.<ref>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/production_bundle.sql
```

Regenerate it after adding a migration with `./scripts/bundle_sql.sh`.

**File by file** (identical result, easier to see what ran):

```bash
# first run only: everything
for f in supabase/migrations/*.sql; do echo "→ $f"; psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done

# later: any new migration, then the grants file again
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/00XX_your_change.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/9999_api_grants.sql
```

**Then prove it** — read-only, 11 checks, every line must say PASS:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify_production.sql
```

Do **not** apply `supabase/local/0000_local_shim.sql` or anything in
`supabase/tests/` to production — the shim fakes Supabase's `auth` schema, and
the tests create fixture data.

### The first owner

The first account to register becomes the owner, and after that only an owner
may create accounts. Create it once, directly:

Create the auth user in the dashboard (**Authentication → Users → Add user**, tick
*Auto confirm user*), copy its UID, then register it as the owner in the SQL
editor:

```sql
-- after the migrations; replace the UID with the one from the dashboard
select public.rpc_register_app_user(
  'paste-the-user-uid-here'::uuid,
  'you@lubella.shop', 'LuBella Owner', 'OWNER', null, 0
);
```

`auth.create_user()` exists only in the local test shim
(`supabase/local/0000_local_shim.sql`), not on hosted Supabase.

Everyone else (staff, other owners, supplier logins) is created from the app:
**Staff & Access → Add person**, or **Suppliers → Link a supplier login**.

### Storage

Create a bucket named `product-images`. Public read, authenticated write:

```sql
insert into storage.buckets (id, name, public) values ('product-images', 'product-images', true);

create policy "product images are readable by anyone"
  on storage.objects for select using (bucket_id = 'product-images');

create policy "staff and owner may upload product images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and public.fn_is_internal());
```

Customer request photos go to the same bucket under `requests/`.

### Auth settings

- **Email provider**: on. Turn **Confirm email** off if you want accounts to work
  immediately (the shop creates accounts for staff in person); leave it on if you
  prefer the confirmation step.
- **Allow new users to sign up**: **off**. Accounts are created by the owner.
- Password minimum length: 8 or more.

### The Edge Function

```bash
supabase functions deploy admin-create-user --project-ref <ref>
supabase secrets set SUPABASE_URL=https://<ref>.supabase.co \
                     SUPABASE_ANON_KEY=<anon key> \
                     SUPABASE_SERVICE_ROLE_KEY=<service role key>
```

The function checks that the caller is the owner (by asking the database), and
only then creates the auth user. If the profile write fails it deletes the
half-created auth user, so no orphan accounts are left behind.

---

## 2. Vercel

1. Import the GitHub repository. **Root directory: `app`**.
2. Framework preset: **Vite**. Build `npm run build`, output `dist`.
3. Environment variables (Production + Preview):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy. `app/vercel.json` already rewrites every path to `index.html`, so deep
   links such as `/supplier/payables` work on a refresh.

After the first deploy, add the Vercel domain to **Supabase → Authentication →
URL configuration** (Site URL and redirect URLs).

---

## 3. WhatsApp and Telegram

Both are configured in the app, not in code — the WhatsApp number is never
hard-coded in a component.

- **WhatsApp**: Settings → Messaging → *WhatsApp number*, in international format
  (`+251911223344`). Every "Order on WhatsApp" link is built from this, and the
  customer's cart becomes the message body.
- **Telegram**: create a bot with @BotFather, then set *Telegram bot username*.
  The **bot token** is a private setting: it is readable only by the owner and is
  never included in anything a customer can fetch. The bot turns a request into a
  message for the owner's DM (or a group, via *Telegram order destination*).

Neither channel moves stock. An order that arrives on WhatsApp becomes a real
sale only when it is rung up at the till, which is what keeps stock and money
consistent.

---

## 4. Weekly backup

The shop backs up weekly, and the app tracks that it happened:

- Settings → **Backups** shows the last run, the schedule, when the next one is
  due, what a backup covers, and the run history.
- After taking a backup, press **Record a run** — this writes a `backup_runs`
  row, which is what the owner's dashboard reads.

Recommended: Supabase's daily backups (paid plans) plus a weekly
`pg_dump` to storage you control:

```bash
# what scripts/backup.sh does, with rotation and a run reminder
DATABASE_URL="$DATABASE_URL" ./scripts/backup.sh

# the same, then straight into Google Drive and pruned there
DATABASE_URL="$DATABASE_URL" DRIVE_REMOTE=gdrive ./scripts/backup_to_drive.sh      # rclone
DATABASE_URL="$DATABASE_URL" DRIVE_DIR="$HOME/Google Drive/My Drive/LuBella Backups" \
  ./scripts/backup_to_drive.sh                                                     # desktop app

# the same thing by hand
pg_dump "$DATABASE_URL" --no-owner | gzip > "lubella-$(date +%F).sql.gz"
```

Restore it at least once before you need it:

```bash
gunzip -c lubella-2026-09-12.sql.gz | psql "$DATABASE_URL" -v ON_ERROR_STOP=1
psql "$DATABASE_URL" -f supabase/migrations/9999_api_grants.sql
psql "$DATABASE_URL" -f scripts/verify_production.sql      # passed 11 / failed 0
```

Note the `--no-owner` **without** `--no-privileges`: a dump stripped of privileges
restores a database whose ANON surface has silently widened back to the
PostgreSQL default. Keep the grants; re-apply the grants file anyway as a belt
and braces after a restore.

Keep dumps outside the Vercel/Supabase project (object storage, or a second
provider). Google Sheets is not a backup.

---

## 5. After deploying — smoke checklist

Sign in and walk the shop once:

1. **Owner** — Dashboard shows today's figures; Products lists the catalogue;
   Settings shows the shop name and the WhatsApp number you set.
2. **Till** — sell something; stock drops by exactly one; the receipt prints.
3. **Staff** — sign in as a staff member: no costs, no profit, no P&L, and the
   Sales page shows only their own sales.
4. **Customer** — open the site signed out: catalogue and availability badges
   (🟢 🟡 🔴) are visible, an order opens WhatsApp with the cart in the message,
   and a product request submits without any login.
5. **Supplier** — sign in as a supplier: only their own batches, sales, payables,
   payments and statements.
6. **Install** — open the site on a phone and use "Add to Home Screen"; it opens
   without browser chrome.

If any of those fail, check `docs/05-BUSINESS-RULES.md` first — the rule is
probably working and the screen is wrong.

---

## 6. Local development

```bash
sudo pg_ctlcluster 17 main start      # PostgreSQL 17
./scripts/db.sh reset                 # schema + migrations + fixture
cd devserver && npm install && npm start   # gateway on :54321
python3 scripts/e2e.py                # role-by-role HTTP checks (98 assertions)
cd ../app && npm install && npm run dev    # app on :5173
```

`RESET=1 ./scripts/db.sh test` runs the SQL suites (226 assertions).
The app talks to `/api` on its own origin; the Vite dev server proxies that to
the dev gateway, so the browser never calls `localhost` directly and the same
code runs unchanged in the preview and in production.
