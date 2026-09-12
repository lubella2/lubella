-- ============================================================================
-- LuBella  |  Migration 0013 — Finance RPCs
-- ============================================================================
-- Supplier payments, commission payments, expenses, tithe and monthly close.
-- Reminder of the two rules that shape this file (spec §24, §60):
--   * a supplier payment settles a liability recognised in COGS at the time of
--     sale — it is NOT an operating expense and never enters the P&L;
--   * tithe is 10% of NET PROFIT, is never negative, and is also not an expense.
-- ============================================================================

-- ===========================================================================
-- rpc_record_supplier_payment — settles oldest outstanding payables first.
-- ===========================================================================
create or replace function public.rpc_record_supplier_payment(
  p_supplier_id    uuid,
  p_amount         numeric,
  p_payment_method public.payment_method,
  p_payment_date   date default current_date,
  p_reference      text default null,
  p_notes          text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user       public.app_users;
  v_payment_id uuid;
  v_number     text;
  v_remaining  numeric;
  v_alloc      numeric;
  v_line       record;
  v_balance    numeric;
  v_allocations jsonb := '[]'::jsonb;
  v_applied    numeric := 0;
begin
  v_user := public.fn_current_user_row();
  perform public.fn_require_owner();
  perform public.fn_require_open_period(p_payment_date);

  if coalesce(p_amount, 0) <= 0 then
    raise exception 'AMOUNT_INVALID: a payment must be greater than zero' using errcode = '22023';
  end if;

  select coalesce(sum(outstanding), 0) into v_balance
  from public.supplier_payables where supplier_id = p_supplier_id;

  if v_balance <= 0 then
    raise exception 'NOTHING_OUTSTANDING: this supplier has no outstanding balance to pay'
      using errcode = '22023';
  end if;
  if p_amount > v_balance then
    raise exception 'OVERPAYMENT: the outstanding balance is % but % was entered. Cards must not hold supplier credit.',
      v_balance, p_amount using errcode = '22023';
  end if;

  v_number := public.fn_next_number('SP', 6);
  v_remaining := public.fn_money(p_amount);

  insert into public.supplier_payments (payment_number, supplier_id, amount, payment_method,
                                        payment_date, reference, notes, created_by)
  values (v_number, p_supplier_id, public.fn_money(p_amount), p_payment_method,
          p_payment_date, p_reference, p_notes, v_user.id)
  returning id into v_payment_id;

  -- Oldest outstanding first.
  for v_line in
    select * from public.supplier_payables
    where supplier_id = p_supplier_id and outstanding > 0
    order by entry_date asc, created_at asc, id asc
    for update
  loop
    exit when v_remaining <= 0;

    v_alloc := least(v_remaining, v_line.outstanding);

    insert into public.supplier_payment_allocations (payment_id, payable_id, amount)
    values (v_payment_id, v_line.id, v_alloc);

    update public.supplier_payables
       set amount_paid = public.fn_money(amount_paid + v_alloc),
           outstanding = public.fn_money(payable_amount - (amount_paid + v_alloc)),
           status = case when public.fn_money(payable_amount - (amount_paid + v_alloc)) <= 0
                         then 'PAID'::public.payable_status
                         else 'PARTIAL'::public.payable_status end
     where id = v_line.id;

    v_allocations := v_allocations || jsonb_build_object(
      'payable_id', v_line.id, 'batch_id', v_line.purchase_batch_id,
      'quantity_sold', v_line.quantity_sold, 'amount', v_alloc);

    v_remaining := public.fn_money(v_remaining - v_alloc);
    v_applied := public.fn_money(v_applied + v_alloc);
  end loop;

  perform public.fn_audit('SUPPLIER_PAYMENT', 'supplier_payments', v_payment_id, null,
    jsonb_build_object('payment_number', v_number, 'supplier_id', p_supplier_id,
                       'amount', p_amount, 'payment_method', p_payment_method,
                       'payment_date', p_payment_date, 'reference', p_reference,
                       'allocations', v_allocations,
                       'note', 'Supplier payments are a balance-sheet settlement, not an operating expense'));

  return jsonb_build_object(
    'payment_id', v_payment_id, 'payment_number', v_number,
    'amount', public.fn_money(p_amount), 'applied', v_applied,
    'remaining_outstanding', public.fn_money(
      (select coalesce(sum(outstanding), 0) from public.supplier_payables where supplier_id = p_supplier_id)),
    'allocations', v_allocations
  );
end $$;

-- ===========================================================================
-- rpc_generate_supplier_statement — totals RECOMPUTED from transactions.
-- Nothing is ever typed into a statement (spec §21).
-- ===========================================================================
create or replace function public.rpc_generate_supplier_statement(
  p_supplier_id uuid,
  p_month       date
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user      public.app_users;
  v_month     date := date_trunc('month', p_month)::date;
  v_prev      date := (date_trunc('month', p_month) - interval '1 month')::date;
  v_opening   numeric := 0;
  v_units     int := 0;
  v_payable   numeric := 0;
  v_paid      numeric := 0;
  v_stmt_id   uuid;
  v_number    text;
  v_outstanding numeric := 0;
begin
  v_user := public.fn_current_user_row();
  perform public.fn_require_owner();

  if not exists (select 1 from public.suppliers where id = p_supplier_id) then
    raise exception 'SUPPLIER_NOT_FOUND: no supplier with id %', p_supplier_id using errcode = '23503';
  end if;

  -- Opening = everything that had been recognised up to the end of last month,
  -- minus everything paid up to the end of last month. Derived, not entered.
  select coalesce(sum(payable_amount), 0), coalesce(sum(amount_paid), 0)
    into v_payable, v_paid
  from public.supplier_payables
  where supplier_id = p_supplier_id and entry_date < v_month;

  v_opening := public.fn_money(v_payable - v_paid);

  -- This month's activity, straight from the payable lines that FIFO created.
  select coalesce(sum(payable_amount), 0), coalesce(sum(quantity_sold), 0)
    into v_payable, v_units
  from public.supplier_payables
  where supplier_id = p_supplier_id
    and entry_date >= v_month
    and entry_date < (v_month + interval '1 month')::date
    and is_reversal = false;

  select coalesce(sum(amount), 0) into v_paid
  from public.supplier_payments
  where supplier_id = p_supplier_id
    and payment_date >= v_month
    and payment_date < (v_month + interval '1 month')::date
    and voided_at is null;

  v_outstanding := public.fn_money(v_opening + v_payable - v_paid);
  v_number := public.fn_next_number('ST', 5);

  insert into public.supplier_statements
    (statement_number, supplier_id, period_month, opening_outstanding, units_sold,
     total_payable, total_paid, outstanding, generated_by)
  values (v_number, p_supplier_id, v_month, v_opening, coalesce(v_units, 0),
          public.fn_money(v_payable), public.fn_money(v_paid), v_outstanding, v_user.id)
  on conflict (supplier_id, period_month) do update
    set opening_outstanding = excluded.opening_outstanding,
        units_sold          = excluded.units_sold,
        total_payable       = excluded.total_payable,
        total_paid          = excluded.total_paid,
        outstanding         = excluded.outstanding,
        generated_at        = now(),
        generated_by        = excluded.generated_by
  returning id into v_stmt_id;

  perform public.fn_audit('SUPPLIER_STATEMENT_GENERATE', 'supplier_statements', v_stmt_id, null,
    jsonb_build_object('statement_number', v_number, 'supplier_id', p_supplier_id,
                       'period_month', v_month, 'opening_outstanding', v_opening,
                       'units_sold', coalesce(v_units, 0), 'total_payable', v_payable,
                       'total_paid', v_paid, 'outstanding', v_outstanding));

  return jsonb_build_object(
    'statement_id', v_stmt_id, 'statement_number', v_number, 'period_month', v_month,
    'opening_outstanding', v_opening, 'units_sold', coalesce(v_units, 0),
    'total_payable', public.fn_money(v_payable), 'total_paid', public.fn_money(v_paid),
    'outstanding', v_outstanding
  );
end $$;

-- ===========================================================================
-- Commission payments
-- ===========================================================================
create or replace function public.rpc_record_commission_payment(
  p_staff_id       uuid,
  p_amount         numeric,
  p_period_start   date,
  p_period_end     date,
  p_payment_method public.payment_method,
  p_payment_date   date default current_date,
  p_reference      text default null,
  p_notes          text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user     public.app_users;
  v_earned   numeric;
  v_paid     numeric;
  v_due      numeric;
  v_id       uuid;
  v_number   text;
begin
  v_user := public.fn_current_user_row();
  perform public.fn_require_owner();
  perform public.fn_require_open_period(p_payment_date);

  if coalesce(p_amount, 0) <= 0 then
    raise exception 'AMOUNT_INVALID: a commission payment must be greater than zero' using errcode = '22023';
  end if;

  select coalesce(sum(amount), 0) into v_earned
  from public.commissions
  where staff_id = p_staff_id and sale_date between p_period_start and p_period_end;

  select coalesce(sum(amount), 0) into v_paid
  from public.commission_payments
  where staff_id = p_staff_id;

  v_due := public.fn_money(v_earned - v_paid);
  if p_amount > v_due then
    raise exception 'OVERPAYMENT: commission due for this period is % but % was entered', v_due, p_amount
      using errcode = '22023';
  end if;

  v_number := public.fn_next_number('CP', 6);

  insert into public.commission_payments (payment_number, staff_id, period_start, period_end,
                                          amount, payment_method, payment_date, reference, notes, created_by)
  values (v_number, p_staff_id, p_period_start, p_period_end, public.fn_money(p_amount),
          p_payment_method, p_payment_date, p_reference, p_notes, v_user.id)
  returning id into v_id;

  perform public.fn_audit('COMMISSION_PAYMENT', 'commission_payments', v_id, null,
    jsonb_build_object('payment_number', v_number, 'staff_id', p_staff_id, 'amount', p_amount,
                       'period_start', p_period_start, 'period_end', p_period_end));

  return jsonb_build_object('payment_id', v_id, 'payment_number', v_number,
                            'amount', public.fn_money(p_amount),
                            'remaining_due', public.fn_money(v_due - p_amount));
end $$;

-- ===========================================================================
-- Expenses (owner-only)
-- ===========================================================================
create or replace function public.rpc_record_expense(
  p_category       public.expense_category,
  p_amount         numeric,
  p_payment_method public.payment_method,
  p_expense_date   date default current_date,
  p_description    text default null,
  p_receipt_url    text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user   public.app_users;
  v_id     uuid;
  v_number text;
begin
  v_user := public.fn_current_user_row();
  perform public.fn_require_owner();
  perform public.fn_require_open_period(p_expense_date);

  if coalesce(p_amount, 0) <= 0 then
    raise exception 'AMOUNT_INVALID: an expense must be greater than zero' using errcode = '22023';
  end if;

  v_number := public.fn_next_number('EXP', 6);

  insert into public.expenses (expense_number, category, amount, payment_method, expense_date,
                               description, receipt_url, created_by)
  values (v_number, p_category, public.fn_money(p_amount), p_payment_method, p_expense_date,
          p_description, p_receipt_url, v_user.id)
  returning id into v_id;

  perform public.fn_audit('EXPENSE_RECORD', 'expenses', v_id, null,
    jsonb_build_object('expense_number', v_number, 'category', p_category, 'amount', p_amount,
                       'payment_method', p_payment_method, 'expense_date', p_expense_date,
                       'description', p_description));

  return jsonb_build_object('expense_id', v_id, 'expense_number', v_number,
                            'amount', public.fn_money(p_amount));
end $$;

create or replace function public.rpc_delete_expense(p_expense_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exp public.expenses;
begin
  perform public.fn_require_owner();

  select * into v_exp from public.expenses where id = p_expense_id;
  if not found then
    raise exception 'EXPENSE_NOT_FOUND: no expense with id %', p_expense_id using errcode = '23503';
  end if;
  perform public.fn_require_open_period(v_exp.expense_date);

  -- Financial history is not destroyed: the row is voided by deleting it only
  -- after the audit entry captures it in full. (spec §53: financial history
  -- must never be destructively deleted without a trace.)
  perform public.fn_audit('EXPENSE_DELETE', 'expenses', p_expense_id, to_jsonb(v_exp), null, p_reason);
  delete from public.expenses where id = p_expense_id;

  return jsonb_build_object('expense_id', p_expense_id, 'deleted', true);
end $$;

-- ===========================================================================
-- rpc_compute_tithe — derived from the P&L, never typed in.
-- ===========================================================================
create or replace function public.rpc_compute_tithe(
  p_month date default current_date
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user   public.app_users;
  v_month  date := date_trunc('month', p_month)::date;
  v_pnl    record;
  v_rate   numeric;
  v_amount numeric;
  v_id     uuid;
begin
  v_user := public.fn_current_user_row();
  perform public.fn_require_owner();

  select * into v_pnl from public.v_pnl_monthly where period_month = v_month;
  if not found then
    return jsonb_build_object('period_month', v_month, 'net_profit', 0, 'tithe_amount', 0,
                              'status', 'DUE', 'message', 'No financial activity in this month yet.');
  end if;

  v_rate := coalesce((public.fn_setting('tithe_rate', '0.10'::jsonb))::text::numeric, 0.10);

  -- Tithe on NET PROFIT; a loss produces no tithe (spec §41).
  v_amount := case when v_pnl.net_profit > 0
                   then public.fn_money(v_pnl.net_profit * v_rate) else 0 end;

  insert into public.tithe_records (period_month, net_profit, tithe_rate, tithe_amount, created_by)
  values (v_month, v_pnl.net_profit, v_rate, v_amount, v_user.id)
  on conflict (period_month) do update
    set net_profit = excluded.net_profit,
        tithe_rate = excluded.tithe_rate,
        tithe_amount = case when tithe_records.status = 'PAID' then tithe_records.tithe_amount
                            else excluded.tithe_amount end
  returning id into v_id;

  perform public.fn_audit('TITHE_COMPUTE', 'tithe_records', v_id, null,
    jsonb_build_object('period_month', v_month, 'net_profit', v_pnl.net_profit,
                       'tithe_rate', v_rate, 'tithe_amount', v_amount));

  return jsonb_build_object(
    'period_month', v_month, 'net_profit', v_pnl.net_profit, 'tithe_rate', v_rate,
    'tithe_amount', v_amount, 'status',
    (select status from public.tithe_records where id = v_id),
    'message', case when v_pnl.net_profit > 0 then null else 'No tithe due' end
  );
end $$;

create or replace function public.rpc_record_tithe_payment(
  p_period_month   date,
  p_payment_method public.payment_method,
  p_paid_date      date default current_date,
  p_reference      text default null,
  p_notes          text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user  public.app_users;
  v_rec   public.tithe_records;
begin
  v_user := public.fn_current_user_row();
  perform public.fn_require_owner();

  select * into v_rec from public.tithe_records
   where period_month = date_trunc('month', p_period_month)::date for update;
  if not found then
    raise exception 'TITHE_NOT_FOUND: compute the tithe for that month first' using errcode = '23503';
  end if;
  if v_rec.status = 'PAID' then
    raise exception 'ALREADY_PAID: tithe for % is already recorded as paid',
      to_char(v_rec.period_month, 'Mon YYYY') using errcode = '22023';
  end if;

  update public.tithe_records
     set status = 'PAID', paid_date = p_paid_date, payment_method = p_payment_method,
         reference = p_reference, notes = p_notes
   where id = v_rec.id;

  perform public.fn_audit('TITHE_PAYMENT', 'tithe_records', v_rec.id,
    jsonb_build_object('status', v_rec.status),
    jsonb_build_object('status', 'PAID', 'amount', v_rec.tithe_amount,
                       'paid_date', p_paid_date, 'payment_method', p_payment_method,
                       'reference', p_reference));

  -- Reminder: tithe is NOT an operating expense and never enters the P&L; it is
  -- an appropriation of net profit, which is why it is applied here and not in
  -- v_pnl_monthly.
  return jsonb_build_object('tithe_id', v_rec.id, 'amount', v_rec.tithe_amount, 'status', 'PAID',
    'note', 'Tithe is an appropriation of net profit, not an operating expense.');
end $$;

-- ===========================================================================
-- Monthly close (spec §54)
-- ===========================================================================
create or replace function public.rpc_close_month(
  p_month date default current_date,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user  public.app_users;
  v_month date := date_trunc('month', p_month)::date;
  v_pnl   record;
  v_id    uuid;
begin
  v_user := public.fn_current_user_row();
  perform public.fn_require_owner();

  select * into v_pnl from public.v_pnl_monthly where period_month = v_month;

  insert into public.period_closes (period_month, status, net_sales, cogs, gross_profit,
                                    expenses, commission, net_profit, closed_by, closed_at, notes)
  values (v_month, 'CLOSED', coalesce(v_pnl.net_sales, 0), coalesce(v_pnl.cogs, 0),
          coalesce(v_pnl.gross_profit, 0), coalesce(v_pnl.operating_expenses, 0),
          coalesce(v_pnl.staff_commission, 0), coalesce(v_pnl.net_profit, 0),
          v_user.id, now(), p_notes)
  on conflict (period_month) do update
    set status = 'CLOSED', net_sales = excluded.net_sales, cogs = excluded.cogs,
        gross_profit = excluded.gross_profit, expenses = excluded.expenses,
        commission = excluded.commission, net_profit = excluded.net_profit,
        closed_by = excluded.closed_by, closed_at = now(), notes = excluded.notes
  returning id into v_id;

  perform public.fn_audit('MONTH_CLOSE', 'period_closes', v_id, null,
    jsonb_build_object('period_month', v_month, 'net_sales', v_pnl.net_sales,
                       'cogs', v_pnl.cogs, 'net_profit', v_pnl.net_profit, 'notes', p_notes));

  return jsonb_build_object('period_close_id', v_id, 'period_month', v_month, 'status', 'CLOSED',
                            'net_profit', coalesce(v_pnl.net_profit, 0));
end $$;

create or replace function public.rpc_reopen_month(p_month date, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user  public.app_users;
  v_month date := date_trunc('month', p_month)::date;
begin
  v_user := public.fn_current_user_row();
  perform public.fn_require_owner();

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'REASON_REQUIRED: reopening a closed month must record a reason' using errcode = '22023';
  end if;

  update public.period_closes
     set status = 'OPEN', reopened_at = now(), reopened_by = v_user.id,
         notes = concat_ws(E'\n', notes, 'Reopened: ' || p_reason)
   where period_month = v_month;

  if not found then
    raise exception 'MONTH_NOT_FOUND: % is not closed', to_char(v_month, 'Mon YYYY') using errcode = '23503';
  end if;

  perform public.fn_audit('MONTH_REOPEN', 'period_closes', null,
    jsonb_build_object('period_month', v_month, 'status', 'CLOSED'),
    jsonb_build_object('period_month', v_month, 'status', 'OPEN', 'reason', p_reason));

  return jsonb_build_object('period_month', v_month, 'status', 'OPEN');
end $$;
