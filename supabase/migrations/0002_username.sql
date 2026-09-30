-- ══════════════════════════════════════════════════════════════════════════
-- Elara AI — Migration 0002: username  (FIXED)
-- ══════════════════════════════════════════════════════════════════════════

-- 1. Columns
alter table public.profiles
  add column if not exists username text;

alter table public.profiles
  add column if not exists display_name text;

comment on column public.profiles.username is
  'Lowercase handle chosen at signup. NULL for guest and OAuth users. Unique case-insensitively.';

-- 2. Format constraint
alter table public.profiles
  drop constraint if exists profiles_username_format;

alter table public.profiles
  add constraint profiles_username_format
  check (username is null or username ~ '^[a-z0-9_]{3,20}$');

-- 3. Case-insensitive unique index
create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username));

-- 4. Validate constraint
do $$
begin
  perform 1
  from public.profiles
  where username is not null
    and username !~ '^[a-z0-9_]{3,20}$'
  limit 1;
  if found then
    raise notice
      'profiles_username_format: pre-existing rows violate the format. Backfill or fix them, then re-run.';
  end if;
end $$;

alter table public.profiles
  validate constraint profiles_username_format;

-- 5. handle_new_user — NEVER raises
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
  v_display  text;
  v_avatar   text;
begin
  begin
    select case
             when u ~ '^[a-z0-9_]{3,20}$' then u
             else null
           end
      into v_username
      from (
        select lower(
                 regexp_replace(
                   coalesce(new.raw_user_meta_data ->> 'username', ''),
                   '[^a-z0-9_]', '', 'g'
                 )
               ) as u
      ) as cleaned;

    select nullif(left(d, 120), '')
      into v_display
      from (
        select coalesce(
                 nullif(new.raw_user_meta_data ->> 'full_name', ''),
                 nullif(new.raw_user_meta_data ->> 'name', '')
               ) as d
      ) as named;

    select nullif(a, 300)
      into v_avatar
      from (
        select coalesce(new.raw_user_meta_data ->> 'avatar_url', '') as a
      ) as pic;
  exception
    when others then
      v_username := null;
      v_display  := null;
      v_avatar   := null;
  end;

  insert into public.profiles (id, email, username, display_name, avatar_url, is_guest)
  values (
    new.id,
    new.email,
    v_username,
    coalesce(
      v_display,
      nullif(split_part(coalesce(new.email, ''), '@', 1), '')
    ),
    v_avatar,
    coalesce(new.is_anonymous, false)
  )
  on conflict (id) do nothing;

  insert into public.settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 6. ON DELETE CASCADE — ONLY public tables (FIXED)
do $$
declare
  t record;
begin
  for t in
    select c.conrelid::regclass::text as tbl, c.conname
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    where c.contype = 'f'
      and c.confrelid = 'auth.users'::regclass
      and c.confdeltype <> 'c'
      and n.nspname = 'public'
  loop
    execute format('alter table %s drop constraint %I', t.tbl, t.conname);
  end loop;
end $$;

alter table public.profiles
  drop constraint if exists profiles_user_id_fkey;
alter table public.profiles
  add constraint profiles_user_id_fkey
  foreign key (id) references auth.users (id) on delete cascade;

alter table public.settings
  drop constraint if exists settings_user_id_fkey;
alter table public.settings
  add constraint settings_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

alter table public.conversations
  drop constraint if exists conversations_user_id_fkey;
alter table public.conversations
  add constraint conversations_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

alter table public.messages
  drop constraint if exists messages_user_id_fkey;
alter table public.messages
  add constraint messages_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

do $$
declare
  t record;
begin
  for t in
    select c.conrelid::regclass::text as tbl, c.conname
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    where c.contype = 'f'
      and c.confrelid = 'public.conversations'::regclass
      and c.confdeltype <> 'c'
      and n.nspname = 'public'
  loop
    execute format('alter table %s drop constraint %I', t.tbl, t.conname);
  end loop;
end $$;

alter table public.messages
  drop constraint if exists messages_conversation_id_fkey;
alter table public.messages
  add constraint messages_conversation_id_fkey
  foreign key (conversation_id) references public.conversations (id) on delete cascade;

-- 7. RLS (unchanged, owner-only)
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Done.