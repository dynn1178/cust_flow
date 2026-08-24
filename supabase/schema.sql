-- ============================================================================
-- Journey Tag Atlas — Supabase 스키마
-- Supabase 대시보드 → SQL Editor 에 그대로 붙여넣고 Run 하세요. 여러 번 실행해도 안전합니다.
--
-- 이 스키마가 만드는 것은 전부 jta_ 접두사를 씁니다.
--   테이블   public.jta_members / public.jta_docs
--   함수     public.jta_role() / public.jta_new_user() / public.jta_keep_one_admin()
--   트리거   jta_on_auth_user_created / jta_keep_one_admin
--   버킷     jta-images
-- 프로젝트에 이미 있는 profiles·docs 같은 것과 절대 겹치지 않습니다.
--
-- 권한은 전부 RLS(행 단위 보안)로 서버에서 강제되므로 브라우저 코드를 고쳐도 뚫리지 않습니다.
-- 역할은 enum 대신 text + CHECK 로 둡니다(타입 충돌을 원천 차단).
-- ============================================================================

-- ── 회원 ────────────────────────────────────────────────────────────────────
create table if not exists public.jta_members (
  id         uuid primary key references auth.users on delete cascade,
  email      text,
  name       text,
  avatar     text,
  role       text not null default 'viewer'
             check (role in ('server_admin', 'operator', 'viewer')),
  created_at timestamptz not null default now()
);
create index if not exists jta_members_email_idx on public.jta_members (email);

-- 내 역할 (RLS 안에서 재귀하지 않도록 security definer)
create or replace function public.jta_role() returns text
language sql stable security definer set search_path = public as $$
  select m.role from public.jta_members m where m.id = auth.uid()
$$;

-- 가입하면 회원 행 자동 생성. 초기 서버관리자는 dynn1178@gmail.com
create or replace function public.jta_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.jta_members (id, email, name, avatar, role)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', new.email),
    new.raw_user_meta_data ->> 'avatar_url',
    case when lower(new.email) = 'dynn1178@gmail.com' then 'server_admin' else 'viewer' end
  )
  on conflict (id) do nothing;
  return new;
exception when others then
  return new;                     -- 회원 행 생성이 실패해도 가입 자체는 막지 않는다
end $$;

drop trigger if exists jta_on_auth_user_created on auth.users;
create trigger jta_on_auth_user_created
  after insert on auth.users
  for each row execute function public.jta_new_user();

-- 이미 가입해 둔 계정이 있어도 초기 서버관리자를 지정
insert into public.jta_members (id, email, name, avatar, role)
select u.id, lower(u.email),
       coalesce(u.raw_user_meta_data ->> 'full_name', u.email),
       u.raw_user_meta_data ->> 'avatar_url',
       'server_admin'
from auth.users u
where lower(u.email) = 'dynn1178@gmail.com'
on conflict (id) do update set role = 'server_admin';

-- 이미 가입한 나머지 계정도 일반회원으로 등록
insert into public.jta_members (id, email, name, avatar, role)
select u.id, lower(u.email),
       coalesce(u.raw_user_meta_data ->> 'full_name', u.email),
       u.raw_user_meta_data ->> 'avatar_url',
       'viewer'
from auth.users u
where lower(u.email) <> 'dynn1178@gmail.com'
on conflict (id) do nothing;

-- 마지막 서버관리자는 강등 불가 (양도할 때 후임을 먼저 올려야 함)
create or replace function public.jta_keep_one_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'server_admin' and new.role <> 'server_admin'
     and (select count(*) from public.jta_members
          where role = 'server_admin' and id <> old.id) = 0 then
    raise exception '마지막 서버관리자는 강등할 수 없습니다. 다른 사람을 먼저 서버관리자로 지정하세요.';
  end if;
  return new;
end $$;

drop trigger if exists jta_keep_one_admin on public.jta_members;
create trigger jta_keep_one_admin
  before update on public.jta_members
  for each row execute function public.jta_keep_one_admin();

-- ── 보드 문서 ───────────────────────────────────────────────────────────────
create table if not exists public.jta_docs (
  id         text primary key,
  title      text,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users
);

insert into public.jta_docs (id, title) values ('main', '고객 여정 태그 맵')
  on conflict (id) do nothing;

-- ── 접근 권한 ───────────────────────────────────────────────────────────────
grant usage on schema public to anon, authenticated;
grant select, insert, update on public.jta_members to authenticated;
grant select, insert, update on public.jta_docs    to authenticated;
grant execute on function public.jta_role() to anon, authenticated;

alter table public.jta_members enable row level security;
alter table public.jta_docs    enable row level security;

drop policy if exists jta_members_self   on public.jta_members;
drop policy if exists jta_members_staff  on public.jta_members;
drop policy if exists jta_members_update on public.jta_members;

create policy jta_members_self on public.jta_members for select
  using (id = auth.uid());                                    -- 본인 정보
create policy jta_members_staff on public.jta_members for select
  using (public.jta_role() in ('server_admin', 'operator'));  -- 회원 목록은 운영진만
create policy jta_members_update on public.jta_members for update
  using (public.jta_role() = 'server_admin') with check (true); -- 역할 변경은 서버관리자만

drop policy if exists jta_docs_read  on public.jta_docs;
drop policy if exists jta_docs_write on public.jta_docs;
drop policy if exists jta_docs_new   on public.jta_docs;

create policy jta_docs_read on public.jta_docs for select
  using (auth.uid() is not null);                             -- 로그인한 사람은 모두 열람
create policy jta_docs_write on public.jta_docs for update
  using (public.jta_role() in ('server_admin', 'operator'))
  with check (public.jta_role() in ('server_admin', 'operator'));
create policy jta_docs_new on public.jta_docs for insert
  with check (public.jta_role() in ('server_admin', 'operator'));

-- ── 이미지 저장소 (비공개 버킷 + 서명 URL) ──────────────────────────────────
insert into storage.buckets (id, name, public) values ('jta-images', 'jta-images', false)
  on conflict (id) do nothing;

drop policy if exists jta_img_read   on storage.objects;
drop policy if exists jta_img_write  on storage.objects;
drop policy if exists jta_img_update on storage.objects;
drop policy if exists jta_img_del    on storage.objects;

create policy jta_img_read on storage.objects for select
  using (bucket_id = 'jta-images' and auth.uid() is not null);
create policy jta_img_write on storage.objects for insert
  with check (bucket_id = 'jta-images' and public.jta_role() in ('server_admin', 'operator'));
create policy jta_img_update on storage.objects for update
  using (bucket_id = 'jta-images' and public.jta_role() in ('server_admin', 'operator'));
create policy jta_img_del on storage.objects for delete
  using (bucket_id = 'jta-images' and public.jta_role() in ('server_admin', 'operator'));

-- ── 확인 ────────────────────────────────────────────────────────────────────
-- select id, email, role from public.jta_members order by created_at;
-- select id, title, updated_at from public.jta_docs;
