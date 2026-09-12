-- ============================================================================
-- LuBella  |  Migration 0024 — A supplier keeps their own contact details
-- ============================================================================
-- The supplier portal lets a supplier keep their contact information current so
-- the shop can actually reach them. Before this, the only way was for the owner
-- to edit it, which is a silly thing to require for a phone number.
--
-- The safety of this function is in what it does NOT touch. A supplier can
-- change four contact fields on their own row and nothing else:
--   • the row is chosen by fn_current_supplier_id(), derived from the caller's
--     own link — a supplier cannot name a different supplier id;
--   • `name`, `supplier_code`, `tin_number`, `payment_terms` and `active` are
--     commercial record and remain owner-only;
--   • no financial figure is writable from a supplier session anywhere, and the
--     change is written to the audit log.
--
-- Numbered below 9999 so the API-surface grants still run last.
-- ============================================================================

create or replace function public.rpc_update_supplier_contact(
  p_contact_name text default null,
  p_phone        text default null,
  p_email        text default null,
  p_address      text default null,
  p_notes        text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_supplier_id uuid := public.fn_current_supplier_id();
  v_before jsonb;
  v_user public.app_users;
begin
  if v_supplier_id is null then
    -- fn_require_internal() lets the owner correct a supplier's details too,
    -- which is useful when a supplier phones in with a new number.
    if public.fn_is_owner() then
      raise exception 'SUPPLIER_REQUIRED: say which supplier to update by signing in as that supplier'
        using errcode = '42501';
    end if;
    perform public.fn_require_internal();
    raise exception 'NOT_A_SUPPLIER: this account is not linked to a supplier'
      using errcode = '42501';
  end if;

  select to_jsonb(s) into v_before
  from (
    select contact_name, phone, email, address
    from public.suppliers where id = v_supplier_id
  ) s;

  update public.suppliers
     set contact_name = coalesce(p_contact_name, contact_name),
         phone        = coalesce(p_phone, phone),
         email        = coalesce(p_email, email),
         address      = coalesce(p_address, address)
   where id = v_supplier_id;

  v_user := public.fn_current_user_row();

  perform public.fn_audit('SUPPLIER_CONTACT_UPDATE', 'suppliers', v_supplier_id, v_before,
    jsonb_build_object(
      'contact_name', p_contact_name, 'phone', p_phone,
      'email', p_email, 'address', p_address, 'notes', p_notes,
      'by', coalesce(v_user.full_name, 'supplier portal')));

  -- The note is stored as an internal note so the owner sees it alongside the
  -- supplier's record without it becoming part of the commercial data.
  if p_notes is not null and length(trim(p_notes)) > 0 then
    insert into public.supplier_internal_notes (supplier_id, note, created_by)
    values (v_supplier_id, 'Supplier note: ' || trim(p_notes), v_user.id);
  end if;

  return jsonb_build_object('supplier_id', v_supplier_id, 'updated', true);
end $$;
