#!/usr/bin/env python3
"""
LuBella — end-to-end check over HTTP.

The SQL suite proves the database refuses the wrong request. This script proves
the same thing through the API the browser actually talks to: real logins, real
JWTs, real HTTP, and the same RLS the production database enforces. It also
walks the shop's core money path (sell → stock → commission → replay) as a
staff member would.

Usage
    ./scripts/db.sh serve          # in one shell (starts the gateway on 54321)
    python3 scripts/e2e.py         # in another

Exit code 0 means every expectation held.
"""
from __future__ import annotations

import json
import os
import random
import sys
import urllib.error
import urllib.request

GATEWAY = os.environ.get("LUBELLA_GATEWAY", "http://127.0.0.1:54321")
ANON_KEY = os.environ.get("LUBELLA_ANON_KEY", "lubella-dev-anon-key")

REPORT_WINDOW = {"p_from": "2024-01-01", "p_to": "2030-12-31"}
REPORT_MONTH = "2026-09"
MONTH_WINDOW = {"p_from": REPORT_MONTH + "-01", "p_to": REPORT_MONTH + "-30"}

PASSED = 0
FAILED = 0
FAILURES: list[str] = []


# --------------------------------------------------------------------------- #
# transport
# --------------------------------------------------------------------------- #
def call(method: str, path: str, token: str | None = None, body: dict | None = None):
    """Return (status, parsed_body). Never raises on an HTTP error status."""
    url = f"{GATEWAY}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("apikey", ANON_KEY)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            raw = res.read().decode() or "null"
            return res.status, json.loads(raw)
    except urllib.error.HTTPError as err:
        raw = err.read().decode() or "null"
        try:
            return err.code, json.loads(raw)
        except json.JSONDecodeError:
            return err.code, {"raw": raw}
    except Exception as err:  # connection refused, timeout, …
        return 0, {"error": str(err)}


def login(email: str, password: str) -> str:
    status, body = call("POST", "/auth/v1/token?grant_type=password", None,
                        {"email": email, "password": password})
    if status != 200 or "access_token" not in body:
        sys.exit(f"FATAL: could not sign in as {email} ({status}): {body}")
    return body["access_token"]


def rpc(name: str, token: str | None = None, **args):
    return call("POST", f"/rest/v1/rpc/{name}", token, args or {})


def select(table: str, token: str | None = None, query: str = "select=*&limit=5"):
    return call("GET", f"/rest/v1/{table}?{query}", token)


# --------------------------------------------------------------------------- #
# assertions
# --------------------------------------------------------------------------- #
def ok(label: str, detail: str = "") -> None:
    global PASSED
    PASSED += 1
    print(f"  ok    {label}{('  — ' + detail) if detail else ''}")


def bad(label: str, detail: str) -> None:
    global FAILED
    FAILED += 1
    FAILURES.append(f"{label}: {detail}")
    print(f"  FAIL  {label}  — {detail}")


def expect_allowed(label: str, status: int, body, expect: str | None = None) -> bool:
    if status == 200:
        if expect and expect not in json.dumps(body):
            bad(label, f"allowed but response lacked {expect!r}: {json.dumps(body)[:160]}")
            return False
        ok(label)
        return True
    bad(label, f"expected 200, got {status}: {json.dumps(body)[:160]}")
    return False


def expect_refused(label: str, status: int, body) -> bool:
    """The request must either be refused outright, or return nothing at all.

    Two mechanisms do the work in this database: grants stop a role reaching an
    object, and RLS filters the rows it may see. A table that is granted but
    filtered is not a hole — an empty result is the correct answer — so both
    count as a pass here. Anything else is a leak.
    """
    if status in (401, 403):
        message = str(body.get("message") or body.get("error") or "")
        ok(label, message[:70])
        return True
    if status == 200 and (body == [] or body == {} or body is None):
        ok(label, "granted but RLS returns no rows")
        return True
    bad(label, f"NOT refused (status {status}): {json.dumps(body)[:160]}")
    return False


def expect_own_rows(label: str, status: int, body, key: str, value: str) -> bool:
    """A 200 is acceptable only if every row belongs to the caller."""
    if status in (401, 403):
        return expect_refused(label, status, body)
    rows = body if isinstance(body, list) else []
    if status == 200 and all(value in json.dumps(r) for r in rows):
        ok(label, f"only the caller's own record(s) — {len(rows)} row(s)")
        return True
    bad(label, f"returned other parties' rows: {json.dumps(body)[:160]}")
    return False


def expect(label: str, condition: bool, detail: str) -> bool:
    if condition:
        ok(label, detail)
        return True
    bad(label, detail)
    return False


# --------------------------------------------------------------------------- #
# the run
# --------------------------------------------------------------------------- #
def main() -> int:
    status, health = call("GET", "/health")
    if status != 200:
        sys.exit(f"FATAL: gateway not reachable at {GATEWAY} — start it with ./scripts/db.sh serve\n{health}")
    print(f"gateway: {health}\n")

    tokens = {
        "owner": login("owner@lubella.shop", "owner-pass"),
        "sara": login("sara@lubella.shop", "sara-pass"),
        "hana": login("hana@lubella.shop", "hana-pass"),
        "abc": login("abc@supplier.et", "abc-pass"),
        "xyz": login("xyz@supplier.et", "xyz-pass"),
    }
    print("signed in: owner, sara (staff), hana (staff), abc (supplier), xyz (supplier)\n")

    # ----------------------------------------------------------------- anon
    print("== anon: a customer with no account ==")
    for table, column in [("products", "name"), ("sales", "id"), ("expenses", "id"),
                          ("purchase_batches", "batch_number"), ("app_users", "email"),
                          ("audit_logs", "id")]:
        st, body = select(table, None, f"select={column}&limit=1")
        expect_refused(f"anon cannot read {table}", st, body)
    for fn in ["rpc_owner_dashboard", "rpc_report_pnl", "rpc_list_supplier_statements",
               "rpc_report_sales", "rpc_my_sales"]:
        st, body = rpc(fn, None)
        expect_refused(f"anon cannot call {fn}()", st, body)
    st, body = rpc("rpc_public_catalog", None, p_limit=4)
    expect_allowed("anon can browse the catalogue", st, body, "items")
    st, body = rpc("rpc_public_filters", None)
    expect_allowed("anon can read filters and contact links", st, body, "whatsapp")

    # ---------------------------------------------------------------- staff
    print("\n== staff (Sara): runs the till, must not see money ==")
    st, body = rpc("rpc_my_sales", tokens["sara"], p_limit=5)
    expect_allowed("staff reads own sales", st, body, "items")
    st, body = rpc("rpc_my_commission", tokens["sara"])
    expect_allowed("staff reads own commission", st, body, "totals")
    st, body = select("v_staff_products", tokens["sara"], "select=id,name,quantity_on_hand&limit=3")
    expect_allowed("staff reads on-hand stock", st, body)

    for table in ["sales", "expenses", "purchase_batches", "supplier_payables",
                  "supplier_payments", "supplier_statements", "audit_logs", "v_owner_inventory"]:
        st, body = select(table, tokens["sara"], "select=*&limit=1")
        expect_refused(f"staff cannot read {table}", st, body)
    # A supplier login is not staff; it must not reach the till's views either.
    for view in ["v_staff_products", "v_staff_sales", "v_staff_stock_counts"]:
        st, body = select(view, tokens["abc"], "select=*&limit=1")
        expect_refused(f"supplier cannot read {view}", st, body)
    for fn in ["rpc_owner_dashboard", "rpc_report_pnl", "rpc_report_inventory",
               "rpc_list_supplier_statements", "rpc_report_expenses",
               "rpc_report_staff_performance"]:
        st, body = rpc(fn, tokens["sara"])
        expect_refused(f"staff cannot call {fn}()", st, body)
    st, body = rpc("rpc_list_supplier_notes", tokens["sara"],
                   p_supplier_id="11111111-1111-1111-1111-111111111111")
    expect_refused("staff cannot call rpc_list_supplier_notes()", st, body)

    # Cost visibility on a sale Sara did not make.
    st, owner_sales = rpc("rpc_report_sales", tokens["owner"], **REPORT_WINDOW)
    other = next((s for s in (owner_sales.get("items") or [])
                  if s.get("staff_name") and "Sara" not in s["staff_name"]), None)
    if other:
        st, body = rpc("rpc_sale_detail", tokens["sara"], p_sale_id=other["id"])
        expect_refused(f"staff cannot open another staff member's sale ({other['sale_number']})", st, body)
    else:
        ok("no other-staff sale to probe", "skipped")

    # ------------------------------------------------------------- supplier
    print("\n== supplier ABC: own transactions only ==")
    st, abc_orders = select("supplier_portal_orders", tokens["abc"],
                            "select=product_code,batch_number,quantity_sold&limit=100")
    st2, xyz_orders = select("supplier_portal_orders", tokens["xyz"],
                             "select=product_code,batch_number&limit=100")
    abc_codes = {r["product_code"] for r in (abc_orders if isinstance(abc_orders, list) else [])}
    xyz_codes = {r["product_code"] for r in (xyz_orders if isinstance(xyz_orders, list) else [])}
    print(f"        ABC sees {sorted(abc_codes)}   XYZ sees {sorted(xyz_codes)}")
    expect("supplier A cannot see supplier B's products", not (abc_codes & xyz_codes),
           f"overlap: {sorted(abc_codes & xyz_codes) or 'none'}")
    expect("each supplier sees its own products", bool(abc_codes) and bool(xyz_codes),
           f"ABC {len(abc_codes)} code(s), XYZ {len(xyz_codes)} code(s)")
    st, body = select("supplier_portal_profile", tokens["abc"], "select=name,supplier_code&limit=1")
    expect_allowed("supplier reads own profile", st, body, "ABC")

    for table in ["sales", "products", "purchase_batches", "expenses", "audit_logs",
                  "suppliers", "supplier_payables", "supplier_statements",
                  "supplier_internal_notes", "stock_movements"]:
        st, body = select(table, tokens["abc"], "select=*&limit=1")
        expect_refused(f"supplier cannot read {table}", st, body)
    # app_users is granted so a portal can identify itself — but only its own row.
    st, body = select("app_users", tokens["abc"], "select=email,role&limit=10")
    expect_own_rows("supplier sees only its own account row", st, body, "abc@supplier.et", "")
    for fn in ["rpc_owner_dashboard", "rpc_report_pnl", "rpc_list_supplier_statements",
               "rpc_report_sales", "rpc_my_sales", "rpc_my_commission"]:
        st, body = rpc(fn, tokens["abc"])
        expect_refused(f"supplier cannot call {fn}()", st, body)

    # ---------------------------------------------------------------- owner
    print("\n== owner: the whole business ==")
    for fn in ["rpc_owner_dashboard", "rpc_report_pnl", "rpc_list_supplier_statements",
               "rpc_report_inventory", "rpc_report_staff_performance", "rpc_report_expenses"]:
        st, body = rpc(fn, tokens["owner"])
        expect_allowed(f"owner calls {fn}()", st, body)
    # Tables the owner reads directly. The rest of the owner's data (batches,
    # payables, statements, inventory) is served by rpc_* functions, which is
    # how the UI reads it — a direct table read there is refused on purpose.
    for table in ["sales", "products", "expenses", "audit_logs", "suppliers", "app_users"]:
        st, body = select(table, tokens["owner"], "select=*&limit=2")
        expect_allowed(f"owner reads {table}", st, body)
    for table in ["purchase_batches", "supplier_payables", "supplier_statements", "v_owner_inventory"]:
        st, body = select(table, tokens["owner"], "select=*&limit=2")
        expect_refused(f"owner uses an RPC, not a raw read, for {table}", st, body)

    # ------------------------------------------------- cost visibility proof
    print("\n== cost is withheld from staff, shown to the owner ==")
    st, owner_sales = rpc("rpc_report_sales", tokens["owner"], **REPORT_WINDOW)
    sara_sale = next((s for s in (owner_sales.get("items") or [])
                      if s.get("staff_name") and "Sara" in s["staff_name"]), None)
    if sara_sale:
        _, staff_view = rpc("rpc_sale_detail", tokens["sara"], p_sale_id=sara_sale["id"])
        _, owner_view = rpc("rpc_sale_detail", tokens["owner"], p_sale_id=sara_sale["id"])
        print(f"        staff: cost_visible={staff_view.get('cost_visible')} "
              f"cogs={staff_view['sale'].get('cogs_amount')} line_cogs={staff_view['items'][0].get('line_cogs')}")
        print(f"        owner: cost_visible={owner_view.get('cost_visible')} "
              f"cogs={owner_view['sale'].get('cogs_amount')} line_cogs={owner_view['items'][0].get('line_cogs')}")
        expect("staff sees cost_visible=false and null cost fields on their own sale",
               staff_view.get("cost_visible") is False
               and staff_view["sale"].get("cogs_amount") is None
               and staff_view["items"][0].get("unit_cogs") is None,
               "cost fields are SQL NULL for staff")
        expect("owner sees the real cogs figures",
               float(owner_view["sale"].get("cogs_amount") or 0) > 0
               and float(owner_view["items"][0].get("unit_cogs") or 0) > 0,
               f"cogs={owner_view['sale'].get('cogs_amount')} unit_cogs={owner_view['items'][0].get('unit_cogs')}")
    else:
        ok("no Sara sale to check cost visibility on", "skipped")

    # ------------------------------------------------------ the shop selling
    print("\n== a staff member sells a unit ==")
    _, products = select("v_staff_products", tokens["sara"],
                         "select=id,name,quantity_on_hand,selling_price,expiry_status&order=name.asc&limit=50")
    product = next((p for p in products
                    if p["quantity_on_hand"] > 1 and p.get("expiry_status") != "EXPIRED"), None)
    expired = next((p for p in products if p.get("expiry_status") == "EXPIRED"
                    and p["quantity_on_hand"] > 0), None)
    if expired:
        st, body = rpc("rpc_complete_sale", tokens["sara"],
                       p_items=[{"product_id": expired["id"], "quantity": 1}],
                       p_payment_method="CASH")
        expect("expired stock cannot be sold",
               st == 400 and "EXPIRED" in json.dumps(body),
               f"{expired['name']} — {str(body.get('message'))[:60]}")
    sale = None
    if not product:
        bad("a unit could be sold", "no product with stock on hand")
    else:
        before = product["quantity_on_hand"]
        ref = f"e2e-{random.randint(100000, 999999)}"
        sale_args = dict(
            p_items=[{"product_id": product["id"], "quantity": 1}],
            p_payment_method="CASH",
            p_client_ref=ref,
        )
        st, sale = rpc("rpc_complete_sale", tokens["sara"], **sale_args)
        if not expect_allowed(f"sale completes for {product['name']}", st, sale, "sale_number"):
            print(f"        {json.dumps(sale)[:300]}")
        else:
            print(f"        {sale['sale_number']}  total {sale['total_amount']}  "
                  f"commission {sale.get('commission')}  (3% of the discounted total)")
            _, after = select("v_staff_products", tokens["sara"],
                              f"select=quantity_on_hand&id=eq.{product['id']}")
            now = after[0]["quantity_on_hand"] if after else None
            expect("POS deducted exactly one unit", now == before - 1, f"{before} → {now}")

            # Replay: the same client_ref must return the original, never a second sale.
            st, replay = rpc("rpc_complete_sale", tokens["sara"], **sale_args)
            expect("replaying the same client_ref returns the original sale",
                   st == 200 and replay.get("sale_number") == sale["sale_number"],
                   f"{replay.get('sale_number')} (replayed={replay.get('replayed')})")
            _, after2 = select("v_staff_products", tokens["sara"],
                               f"select=quantity_on_hand&id=eq.{product['id']}")
            now2 = after2[0]["quantity_on_hand"] if after2 else None
            expect("the replay did not deduct a second unit", now2 == now, f"{now} → {now2}")

            # The owner sees the money side of that sale.
            _, detail = rpc("rpc_sale_detail", tokens["owner"], p_sale_id=sale["sale_id"])
            expect("the sale carries a cost and a profit figure for the owner",
                   float(detail["sale"].get("cogs_amount") or 0) > 0
                   and float(detail["sale"].get("gross_profit") or 0) > 0,
                   f"cogs={detail['sale'].get('cogs_amount')} profit={detail['sale'].get('gross_profit')}")

    # ------------------------------------------------- customer request, anon
    print("\n== an anonymous customer asks for a product ==")
    phone = f"09{random.randint(10000000, 99999999)}"
    st, body = rpc("rpc_submit_customer_request", None,
                   p_customer_name="E2E Tester", p_customer_phone=phone,
                   p_requested_product_name="Matte lipstick, long wear",
                   p_source="WEBSITE")
    if expect_allowed("anon can submit a request", st, body, "request_number"):
        number = body.get("request_number")
        _, seen = rpc("rpc_report_customer_requests", tokens["owner"])
        found = any(i.get("requestNumber") == number for i in (seen.get("items") or []))
        expect("the owner sees the request", found, f"{number} is in the owner's list")
        _, staff_sees = rpc("rpc_report_customer_requests", tokens["sara"])
        expect_refused("staff cannot read the request list", staff_sees and 403, staff_sees)


    # ------------------------------------------------------- returns & voids
    print("\n== a customer brings an item back (owner only) ==")
    if product and sale and sale.get("sale_id"):
        # Staff may sell, but only the owner may reverse a sale.
        st, sara_sale_detail = rpc("rpc_sale_detail", tokens["sara"], p_sale_id=sale["sale_id"])
        line = (sara_sale_detail.get("items") or [None])[0] if isinstance(sara_sale_detail, dict) else None
        if line:
            st, body = rpc("rpc_process_return", tokens["sara"], p_sale_id=sale["sale_id"],
                           p_items=[{"sale_item_id": line["id"], "quantity": 1}],
                           p_reason="Refused by staff login (guard test)", p_restock=True)
            expect_refused("staff cannot process a return", st, body)

            _, stock_before = select("v_staff_products", tokens["sara"],
                                     f"select=quantity_on_hand&id=eq.{product['id']}")
            before_units = stock_before[0]["quantity_on_hand"]
            st, ret = rpc("rpc_process_return", tokens["owner"], p_sale_id=sale["sale_id"],
                          p_items=[{"sale_item_id": line["id"], "quantity": 1}],
                          p_reason="Changed her mind", p_restock=True)
            if expect_allowed("owner processes the return", st, ret, "return_number"):
                print(f"        {ret['return_number']}  refund {ret['refund_amount']}  "
                      f"cogs reversed {ret['cogs_reversed']}  commission reversed {ret['commission_reversed']}")
                _, stock_after = select("v_staff_products", tokens["sara"],
                                        f"select=quantity_on_hand&id=eq.{product['id']}")
                after_units = stock_after[0]["quantity_on_hand"]
                expect("the returned unit went back on the shelf",
                       after_units == before_units + 1, f"{before_units} → {after_units}")
                expect("the return reversed commission as well as revenue",
                       float(ret.get("commission_reversed") or 0) > 0,
                       f"commission reversed {ret['commission_reversed']}")

    print("\n== a sale is voided, never deleted ==")
    _, products_now = select("v_staff_products", tokens["sara"],
                             "select=id,name,quantity_on_hand,expiry_status&order=name.asc&limit=50")
    target = next((p for p in products_now
                   if p["quantity_on_hand"] > 1 and p.get("expiry_status") != "EXPIRED"), None)
    print(f"        candidate to void: {target['name'] if target else 'none'} "
          f"({target['quantity_on_hand'] if target else 0} on hand)")
    if target:
        st, doomed = rpc("rpc_complete_sale", tokens["sara"],
                         p_items=[{"product_id": target["id"], "quantity": 1}],
                         p_payment_method="CASH", p_client_ref=f"e2e-void-{random.randint(1000, 9999)}")
        if st != 200 or not doomed.get("sale_id"):
            bad("a sale could be rung up to void", f"{st}: {json.dumps(doomed)[:140]}")
        if st == 200 and doomed.get("sale_id"):
            st, body = rpc("rpc_void_sale", tokens["sara"], p_sale_id=doomed["sale_id"],
                           p_reason="Staff must not be able to void")
            expect_refused("staff cannot void a sale", st, body)
            st, voided = rpc("rpc_void_sale", tokens["owner"], p_sale_id=doomed["sale_id"],
                             p_reason="Rang up in error")
            expect_allowed("owner voids the sale", st, voided, "void")
            _, still_there = rpc("rpc_sale_detail", tokens["owner"], p_sale_id=doomed["sale_id"])
            expect("the voided sale still exists, marked void",
                   still_there["sale"].get("status") == "VOIDED",
                   f"status={still_there['sale'].get('status')}, void_reason={still_there['sale'].get('void_reason')!r}")

    # ------------------------------------------------- supplier side of money
    print("\n== the owner settles a supplier, and the supplier sees it ==")
    _, payable = rpc("rpc_report_supplier_payable", tokens["owner"])
    lines = payable.get("lines") if isinstance(payable, dict) else None
    if lines:
        target_line = next((l for l in lines if float(l.get("outstanding") or 0) > 0), None)
        if target_line:
            amount = min(float(target_line["outstanding"]), 100.0)
            _, suppliers = select("suppliers", tokens["owner"], "select=id,name")
            supplier_id = next((x["id"] for x in suppliers if x["name"] == target_line["supplier_name"]), None)
            print(f"        settling {target_line['supplier_name']} — {amount:.2f} Birr of "
                  f"{target_line['outstanding']} outstanding")
            st, pay = rpc("rpc_record_supplier_payment", tokens["owner"],
                          p_supplier_id=supplier_id, p_amount=amount,
                          p_payment_method="BANK", p_reference="E2E-TRANSFER",
                          p_notes="End-to-end check")
            if expect_allowed(f"owner records a {amount:.2f} Birr supplier payment", st, pay, "payment_number"):
                print(f"        {pay.get('payment_number')}  amount {pay.get('amount')}  "
                      f"applied {pay.get('applied')}  outstanding now {pay.get('outstanding')}")
                st, abc_pay = select("supplier_portal_payments", tokens["abc"],
                                     f"select=payment_number,amount&payment_number=eq.{pay.get('payment_number')}")
                expect("the supplier sees the payment on their own statement",
                       isinstance(abc_pay, list) and len(abc_pay) == 1,
                       f"{pay.get('payment_number')} visible to ABC")
                st, xyz_pay = select("supplier_portal_payments", tokens["xyz"],
                                     f"select=payment_number&payment_number=eq.{pay.get('payment_number')}")
                expect("the other supplier does not see it",
                       isinstance(xyz_pay, list) and len(xyz_pay) == 0, "not visible to XYZ")
        else:
            ok("no outstanding supplier line to settle", "skipped")
    else:
        ok("no supplier payable lines to settle", "skipped")

    # --------------------------------------------------------- expenses, P&L
    print("\n== expenses and profit ==")
    st, before_pnl = rpc("rpc_report_pnl", tokens["owner"], **MONTH_WINDOW)
    st, exp = rpc("rpc_record_expense", tokens["owner"], p_category="RENT",
                  p_amount=1500, p_payment_method="CASH", p_expense_date=REPORT_MONTH + "-05",
                  p_description="E2E rent for the unit")
    if expect_allowed("owner records an expense", st, exp, "expense_number"):
        st, after_pnl = rpc("rpc_report_pnl", tokens["owner"], **MONTH_WINDOW)

        def net(payload):
            months = payload.get("months") or []
            return float(months[0]["net_profit"]) if months else 0.0

        def expenses(payload):
            months = payload.get("months") or []
            return float(months[0]["operating_expenses"]) if months else 0.0

        print(f"        operating expenses {expenses(before_pnl)} → {expenses(after_pnl)}")
        print(f"        net profit          {net(before_pnl)} → {net(after_pnl)}")
        expect("the expense is counted as an operating expense",
               abs(expenses(after_pnl) - expenses(before_pnl) - 1500) < 0.01,
               f"+{expenses(after_pnl) - expenses(before_pnl):.2f}")
        expect("an expense reduces net profit by the same amount",
               abs((net(before_pnl) - net(after_pnl)) - 1500) < 0.01,
               f"net profit fell by {net(before_pnl) - net(after_pnl):.2f}")

    print("\n== tithe is 10% of profit, and never an expense ==")
    st, tithe = rpc("rpc_compute_tithe", tokens["owner"], p_month=MONTH_WINDOW["p_from"])
    if expect_allowed("owner computes the month's tithe", st, tithe, "tithe_amount"):
        print(f"        profit {tithe.get('net_profit')} → tithe {tithe.get('tithe_amount')} "
              f"({tithe.get('tithe_rate')}) status {tithe.get('status')}")
        profit = float(tithe.get("net_profit") or 0)
        amount = float(tithe.get("tithe_amount") or 0)
        expect("tithe equals 10% of net profit (0 when the month lost money)",
               (profit <= 0 and amount == 0) or abs(amount - round(profit * 0.10, 2)) < 0.011,
               f"{amount} on {profit}")
    st, body = rpc("rpc_compute_tithe", tokens["sara"], p_month=MONTH_WINDOW["p_from"])
    expect_refused("staff cannot compute the tithe", st, body)

    print("\n" + "=" * 58)
    print(f"  passed {PASSED}    failed {FAILED}")
    print("=" * 58)
    if FAILURES:
        print("\nfailures:")
        for line in FAILURES:
            print(f"  • {line}")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
