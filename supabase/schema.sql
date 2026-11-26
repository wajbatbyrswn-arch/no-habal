-- ============================================================================
--  NO HABAL — Supabase Schema (المرحلة 1)
--  الجداول + دالة submit_report + سياسات RLS
--
--  طريقة التشغيل: Supabase Dashboard → SQL Editor → الصق الملف كاملاً → Run
--  الملف idempotent: يمكن تشغيله أكثر من مرة دون أخطاء.
--
--  بعد التشغيل، لتعيين أدمن (مرة واحدة):
--    1) أنشئ المستخدم من Authentication → Users → Add user
--    2) نفّذ:
--       insert into public.admins (user_id)
--       select id from auth.users where email = 'admin@example.com';
-- ============================================================================

create extension if not exists pgcrypto;  -- gen_random_uuid()


-- ----------------------------------------------------------------------------
-- 1) جدول accounts — قائمة منفصلة لكل منصة عبر UNIQUE(platform, username)
-- ----------------------------------------------------------------------------
create table if not exists public.accounts (
  id            uuid        primary key default gen_random_uuid(),
  platform      text        not null
                check (platform in ('instagram', 'facebook', 'tiktok', 'x', 'reddit')),
  username      text        not null
                check (char_length(username) between 1 and 100),
  status        text        not null default 'pending'
                check (status in ('pending', 'approved', 'whitelisted')),
  report_count  integer     not null default 0
                check (report_count >= 0),
  created_at    timestamptz not null default now(),
  constraint accounts_platform_username_key unique (platform, username)
);

-- true = اعتُمد تلقائياً بالعتبة؛ التراجع عن بلاغ يعيده إلى pending فقط في هذه الحالة
alter table public.accounts add column if not exists auto_approved boolean not null default false;

-- فهرس لسحب القوائم المعتمدة حسب المنصة (يستخدمه service-worker للمزامنة)
create index if not exists accounts_platform_status_idx
  on public.accounts (platform, status);


-- توحيد اليوزر: إزالة @ والمسافات وتحويله لأحرف صغيرة
-- حتى لا يصبح "@Foo" و "foo" حسابين مختلفين (يشمل الإضافة اليدوية من الأدمن).
create or replace function public.normalize_username(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(btrim(coalesce(p, '')), '^@+', ''));
$$;

create or replace function public.accounts_normalize_trg()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.username := public.normalize_username(new.username);
  new.platform := lower(btrim(new.platform));
  return new;
end;
$$;

drop trigger if exists accounts_normalize on public.accounts;
create trigger accounts_normalize
  before insert or update of username, platform on public.accounts
  for each row execute function public.accounts_normalize_trg();


-- ----------------------------------------------------------------------------
-- 2) جدول reports — بلاغ واحد فقط لكل (حساب، مُبلِّغ)
-- ----------------------------------------------------------------------------
create table if not exists public.reports (
  id           uuid        primary key default gen_random_uuid(),
  account_id   uuid        not null references public.accounts (id) on delete cascade,
  reporter_id  text        not null
               check (char_length(reporter_id) between 8 and 128),
  created_at   timestamptz not null default now(),
  constraint reports_account_reporter_key unique (account_id, reporter_id)
);

create index if not exists reports_reporter_idx on public.reports (reporter_id);


-- ----------------------------------------------------------------------------
-- 3) جدول settings — key/value
-- ----------------------------------------------------------------------------
create table if not exists public.settings (
  key         text        primary key,
  value       text        not null,
  updated_at  timestamptz not null default now()
);

-- threshold_mode: 'fixed'  → العتبة = auto_approve_threshold
--                 'auto'   → العتبة = max(auto_threshold_min, ceil(active_users_count × auto_threshold_percent / 100))
insert into public.settings (key, value) values
  ('auto_approve_threshold', '20'),
  ('active_users_count',     '0'),
  ('threshold_mode',         'fixed'),
  ('auto_threshold_percent', '5'),
  ('auto_threshold_min',     '3')
on conflict (key) do nothing;

create or replace function public.setting_int(p_key text, p_default integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case when value ~ '^\d{1,9}$' then value::integer end
       from public.settings where key = p_key),
    p_default);
$$;

create or replace function public.get_effective_threshold()
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mode text;
begin
  select value into v_mode from public.settings where key = 'threshold_mode';
  if v_mode = 'auto' then
    return greatest(
      public.setting_int('auto_threshold_min', 3),
      ceil(public.setting_int('active_users_count', 0)
           * public.setting_int('auto_threshold_percent', 5) / 100.0)::integer,
      1);
  end if;
  return greatest(public.setting_int('auto_approve_threshold', 20), 1);
end;
$$;

revoke all on function public.setting_int(text, integer) from public, anon, authenticated;
revoke all on function public.get_effective_threshold() from public;
grant execute on function public.get_effective_threshold() to anon, authenticated;

-- عند تغيير أي إعداد: اعتمد فوراً الحسابات المعلقة التي بلغت العتبة الجديدة
create or replace function public.settings_apply_threshold_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.accounts
     set status = 'approved', auto_approved = true
   where status = 'pending'
     and report_count >= public.get_effective_threshold();
  return null;
end;
$$;

revoke all on function public.settings_apply_threshold_trg() from public, anon, authenticated;

drop trigger if exists settings_apply_threshold on public.settings;
create trigger settings_apply_threshold
  after insert or update on public.settings
  for each statement execute function public.settings_apply_threshold_trg();


-- ----------------------------------------------------------------------------
-- 4) جدول admins — يحدد من هو الأدمن بين مستخدمي Supabase Auth
-- ----------------------------------------------------------------------------
create table if not exists public.admins (
  user_id     uuid        primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- security definer: تقرأ جدول admins متجاوزة RLS لتجنب التكرار اللانهائي في السياسات
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;


-- ----------------------------------------------------------------------------
-- 5) دالة RPC: submit_report
--    - تمنع تكرار البلاغ لنفس reporter_id
--    - تتجاهل الحسابات whitelisted
--    - تزيد report_count
--    - تعتمد الحساب تلقائياً عند بلوغ auto_approve_threshold
--    - تعيد JSON: { ok, status, report_count, threshold, duplicate, message }
-- ----------------------------------------------------------------------------
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


-- ----------------------------------------------------------------------------
-- 6) Row Level Security
--    - accounts: قراءة عامة لـ approved فقط، والأدمن صلاحيات كاملة
--    - reports / settings / admins: للأدمن فقط
--    - الإضافة لا تكتب مباشرة في أي جدول؛ كل الكتابة عبر submit_report
-- ----------------------------------------------------------------------------
alter table public.accounts enable row level security;
alter table public.reports  enable row level security;
alter table public.settings enable row level security;
alter table public.admins   enable row level security;

-- accounts ------------------------------------------------------------------
drop policy if exists "accounts_public_read_approved" on public.accounts;
create policy "accounts_public_read_approved"
  on public.accounts for select
  to anon, authenticated
  using (status = 'approved');

drop policy if exists "accounts_admin_all" on public.accounts;
create policy "accounts_admin_all"
  on public.accounts for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- reports -------------------------------------------------------------------
drop policy if exists "reports_admin_all" on public.reports;
create policy "reports_admin_all"
  on public.reports for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- settings ------------------------------------------------------------------
drop policy if exists "settings_admin_all" on public.settings;
create policy "settings_admin_all"
  on public.settings for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- admins: الأدمن يرى قائمة الأدمن فقط؛ الإضافة/الحذف من SQL Editor --------
drop policy if exists "admins_admin_read" on public.admins;
create policy "admins_admin_read"
  on public.admins for select
  to authenticated
  using (public.is_admin());


-- صلاحيات الجداول على مستوى الأدوار (RLS يفلتر الصفوف فوقها)
revoke all on public.accounts, public.reports, public.settings, public.admins from anon;
grant select on public.accounts to anon;

grant select, insert, update, delete on public.accounts, public.reports, public.settings to authenticated;
grant select on public.admins to authenticated;


-- ----------------------------------------------------------------------------
-- 7) installs + ping_user — عدّ المستخدمين النشطين (للعتبة التلقائية)
--    النشط = ظهر خلال آخر 30 يوماً. الإضافة تستدعي ping_user عند التثبيت ومرة يومياً.
-- ----------------------------------------------------------------------------
create table if not exists public.installs (
  reporter_id  text        primary key check (char_length(reporter_id) between 8 and 128),
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now()
);

create index if not exists installs_last_seen_idx on public.installs (last_seen);

alter table public.installs enable row level security;

drop policy if exists "installs_admin_read" on public.installs;
create policy "installs_admin_read"
  on public.installs for select
  to authenticated
  using (public.is_admin());

revoke all on public.installs from anon;
grant select on public.installs to authenticated;

create or replace function public.ping_user(p_reporter_id text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reporter text := btrim(coalesce(p_reporter_id, ''));
  v_active   integer;
begin
  if char_length(v_reporter) not between 8 and 128 then
    return json_build_object('ok', false, 'message', 'invalid_reporter_id');
  end if;

  insert into public.installs (reporter_id) values (v_reporter)
  on conflict (reporter_id) do update set last_seen = now()
    where public.installs.last_seen < now() - interval '1 hour';

  select count(*) into v_active
    from public.installs
   where last_seen > now() - interval '30 days';

  update public.settings
     set value = v_active::text, updated_at = now()
   where key = 'active_users_count'
     and value is distinct from v_active::text;

  return json_build_object('ok', true, 'active_users', v_active,
                           'threshold', public.get_effective_threshold());
end;
$$;

revoke all on function public.ping_user(text) from public;
grant execute on function public.ping_user(text) to anon, authenticated;


-- ----------------------------------------------------------------------------
-- 8) withdraw_report — التراجع عن بلاغ
--    - يحذف بلاغ هذا المستخدم وينقص العداد
--    - إن كان الحساب اعتُمد تلقائياً ونزل تحت العتبة → يعود pending
--    - الاعتماد/الحماية اليدوية من الأدمن لا تتغير
--    - حساب معلّق بلا أي بلاغ يُحذف
-- ----------------------------------------------------------------------------
create or replace function public.withdraw_report(
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
  v_platform  text := lower(btrim(coalesce(p_platform, '')));
  v_username  text := public.normalize_username(p_username);
  v_reporter  text := btrim(coalesce(p_reporter_id, ''));
  v_threshold integer := public.get_effective_threshold();
  v_account   public.accounts%rowtype;
  v_deleted   integer;
begin
  select * into v_account
    from public.accounts
   where platform = v_platform and username = v_username
   for update;

  if not found then
    return json_build_object('ok', true, 'withdrawn', false, 'message', 'not_found');
  end if;

  delete from public.reports
   where account_id = v_account.id and reporter_id = v_reporter;
  get diagnostics v_deleted = row_count;

  if v_deleted = 0 then
    return json_build_object('ok', true, 'withdrawn', false, 'status', v_account.status,
      'report_count', v_account.report_count, 'threshold', v_threshold,
      'message', 'no_report');
  end if;

  update public.accounts
     set report_count  = greatest(report_count - 1, 0),
         status        = case when status = 'approved' and auto_approved
                                   and report_count - 1 < v_threshold
                              then 'pending' else status end,
         auto_approved = case when status = 'approved' and auto_approved
                                   and report_count - 1 < v_threshold
                              then false else auto_approved end
   where id = v_account.id
  returning * into v_account;

  if v_account.report_count = 0 and v_account.status = 'pending' then
    delete from public.accounts where id = v_account.id;
  end if;

  return json_build_object('ok', true, 'withdrawn', true, 'status', v_account.status,
    'report_count', v_account.report_count, 'threshold', v_threshold,
    'message', 'withdrawn');
end;
$$;

revoke all on function public.withdraw_report(text, text, text) from public;
grant execute on function public.withdraw_report(text, text, text) to anon, authenticated;
