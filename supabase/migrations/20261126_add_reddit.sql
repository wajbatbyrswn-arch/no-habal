-- NO HABAL 1.1.0: إضافة منصة Reddit
-- نفّذ مرة واحدة في Supabase SQL Editor (أو via psql).
-- يوسّع قيد platform في جدول accounts، ويستبدل submit_report لقبول 'reddit'.
begin;

-- 1) قيد المنصة: نحذف القيد القديم أياً كان اسمه ثم نضيف القيد الجديد
do $$
declare old_constraint text;
begin
  select conname into old_constraint
  from pg_constraint
  where conrelid = 'public.accounts'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%platform%'
  limit 1;

  if old_constraint is not null then
    execute format('alter table public.accounts drop constraint %I', old_constraint);
  end if;
end $$;

alter table public.accounts
  add constraint accounts_platform_check
  check (platform in ('instagram', 'facebook', 'tiktok', 'x', 'reddit'));

-- 2) دالة البلاغ: نفس الدالة في schema.sql مع reddit مضافاً للتحقق
create or replace function public.submit_report(
  p_platform     text,
  p_username     text,
  p_reporter_id  text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_platform    text := lower(btrim(coalesce(p_platform, '')));
  v_username    text := public.normalize_username(p_username);
  v_reporter    text := btrim(coalesce(p_reporter_id, ''));
  v_threshold   integer;
  v_account     public.accounts%rowtype;
  v_inserted    integer;
begin
  -- التحقق من المدخلات
  if v_platform not in ('instagram', 'facebook', 'tiktok', 'x', 'reddit') then
    return json_build_object('ok', false, 'message', 'invalid_platform');
  end if;

  if char_length(v_username) not between 1 and 100 then
    return json_build_object('ok', false, 'message', 'invalid_username');
  end if;

  if char_length(v_reporter) not between 8 and 128 then
    return json_build_object('ok', false, 'message', 'invalid_reporter_id');
  end if;

  -- العتبة الفعلية (ثابتة أو تلقائية حسب عدد المستخدمين)
  v_threshold := public.get_effective_threshold();

  -- إنشاء الحساب إن لم يكن موجوداً، ثم قفل الصف لمنع سباق التحديث
  insert into public.accounts (platform, username)
  values (v_platform, v_username)
  on conflict (platform, username) do nothing;

  select * into v_account
    from public.accounts
   where platform = v_platform and username = v_username
   for update;

  -- الحسابات المحمية: لا يُسجَّل البلاغ
  if v_account.status = 'whitelisted' then
    return json_build_object(
      'ok',           true,
      'status',       v_account.status,
      'report_count', v_account.report_count,
      'threshold',    v_threshold,
      'duplicate',    false,
      'message',      'whitelisted'
    );
  end if;

  -- تسجيل البلاغ (التكرار يُرفض بقيد UNIQUE)
  insert into public.reports (account_id, reporter_id)
  values (v_account.id, v_reporter)
  on conflict (account_id, reporter_id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    return json_build_object(
      'ok',           true,
      'status',       v_account.status,
      'report_count', v_account.report_count,
      'threshold',    v_threshold,
      'duplicate',    true,
      'message',      'already_reported'
    );
  end if;

  -- زيادة العداد والاعتماد التلقائي عند بلوغ العتبة
  update public.accounts
     set report_count  = report_count + 1,
         auto_approved = case when status = 'pending' and report_count + 1 >= v_threshold
                              then true else auto_approved end,
         status        = case when status = 'pending' and report_count + 1 >= v_threshold
                              then 'approved' else status end
   where id = v_account.id
  returning * into v_account;

  return json_build_object(
    'ok',           true,
    'status',       v_account.status,
    'report_count', v_account.report_count,
    'threshold',    v_threshold,
    'duplicate',    false,
    'message',      case when v_account.status = 'approved'
                         then 'approved' else 'reported' end
  );
end;
$$;

revoke all on function public.submit_report(text, text, text) from public;
grant execute on function public.submit_report(text, text, text) to anon, authenticated;

commit;
