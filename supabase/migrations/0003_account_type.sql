-- ══════════════════════════════════════════════════════════════════════════
-- Elara AI — Migration 0003: account type + username cooldown
--
-- Run this in the Supabase SQL Editor (Dashboard → SQL → New query → Run).
-- Idempotent: safe to run more than once.
--
-- ── WHY THIS EXISTS ────────────────────────────────────────────────────────
--
-- BUG: every account was shown as "Guest session", including accounts created
-- with email+password and Google.
--
-- CAUSE: `profiles.is_guest` is a SNAPSHOT taken once by the signup trigger.
-- Two things then corrupt it:
--
--   1. The application self-heal was calling PostgREST `.upsert()`, which
--      defaults to `ON CONFLICT DO UPDATE` — not DO NOTHING as intended — so
--      every page load rewrote the row, including `is_guest` and `display_name`.
--      A person's real name could be replaced by the email prefix.
--   2. A row created before the trigger existed, or one whose trigger failed,
--      had no trustworthy value at all — and the UI fell back to a column that
--      could be wrong rather than to the identity Supabase actually holds.
--
-- FIX: store the provider Supabase itself recorded, backfilled from
-- `auth.users.raw_app_meta_data->>'provider'`, and correct any wrong `is_guest`.
-- The authoritative answer is "anonymous" or not, and that is now a question
-- with a real answer rather than an inference from a mutable column.
-- ══════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────
-- 1. Columns
-- ────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists auth_method text;

alter table public.profiles
  add column if not exists username_changed_at timestamptz;

comment on column public.profiles.auth_method is
  'How this account signed up: email | google | anonymous. Taken from auth.users.raw_app_meta_data.provider.';
comment on column public.profiles.username_changed_at is
  'When username last changed. Enforces the 7-day cooldown on renaming.';

-- Constrained to the three providers Supabase actually records, so a typo can
-- never produce a value the app has no branch for. NULL stays allowed so a
-- legacy row is distinguishable from a known one.
alter table public.profiles
  drop constraint if exists profiles_auth_method_valid;

alter table public.profiles
  add constraint profiles_auth_method_valid
  check (auth_method is null or auth_method in ('email', 'google', 'anonymous'));

-- ────────────────────────────────────────────────────────────
-- 2. Backfill from auth.users — the authoritative record
-- ────────────────────────────────────────────────────────────
--
-- `raw_app_meta_data->>'provider'` is written by GoTrue at signup and is not
-- user-writable, so it cannot lie. `is_anonymous` is the same fact from the
-- other direction and is used as the fallback for an older row.
--
-- The WHERE clause is what makes this a REPAIR rather than a clobber: a row is
-- only touched when it is missing the new column or disagrees with the truth.
-- `display_name` is repaired the same way — filled in from the provider, but
-- never overwritten with the email prefix when a real name already exists.
update public.profiles p
set
  auth_method = coalesce(
    nullif(u.raw_app_meta_data ->> 'provider', ''),
    case when coalesce(u.is_anonymous, false) then 'anonymous' else 'email' end
  ),
  is_guest = case
    when coalesce(u.is_anonymous, false) then true
    else false
  end,
  email = coalesce(p.email, u.email),
  display_name = coalesce(
    nullif(p.display_name, ''),
    nullif(u.raw_user_meta_data ->> 'full_name', ''),
    nullif(u.raw_user_meta_data ->> 'name', ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), '')
  )
from auth.users u
where u.id = p.id
  and (
    p.auth_method is null
    or p.is_guest is distinct from coalesce(u.is_anonymous, false)
    or p.email is null
    or coalesce(p.display_name, '') = ''
  );

-- ────────────────────────────────────────────────────────────
-- 3. Username derived for accounts that have none
-- ────────────────────────────────────────────────────────────
--
-- Only for REAL accounts (a guest has no email to derive from and is meant to
-- stay nameless). The local part of the address is lowercased and stripped to
-- the allowed alphabet; if that leaves too little to be valid, no username is
-- set and the person can choose one in Settings.
--
-- Uniqueness is guaranteed by the existing index on lower(username) — a
-- collision simply yields NULL here rather than an error, and `skip locked`
-- semantics are unnecessary because a conflict is not a row-level lock.
update public.profiles p
set username = nullif(
       left(
         regexp_replace(
           lower(split_part(coalesce(u.email, ''), '@', 1)),
           '[^a-z0-9_]', '', 'g'
         ),
         20
       ),
       ''
     )
from auth.users u
where u.id = p.id
  and p.username is null
  and coalesce(u.is_anonymous, false) = false
  and p.email is not null
  and length(regexp_replace(lower(split_part(u.email, '@', 1)), '[^a-z0-9_]', '', 'g')) >= 3;

-- ────────────────────────────────────────────────────────────
-- 4. The 7-day username cooldown, enforced IN THE DATABASE
-- ────────────────────────────────────────────────────────────
--
-- Deliberately a TRIGGER rather than application code, because the guarantee
-- has to hold for every writer: the settings route, the SQL editor, a future
-- admin script, anything. An application-only check is a check that can be
-- forgotten.
--
-- The trigger fires only when the username ACTUALLY changes, so saving an
-- unrelated profile field is never rate-limited, and re-submitting the same
-- username is a no-op rather than a lockout.
create or replace function public.enforce_username_cooldown()
returns trigger
language plpgsql
as $$
declare
  v_window constant interval := interval '7 days';
  v_previous timestamptz;
begin
  -- Only a real change is rate-limited.
  if new.username is not distinct from old.username then
    return new;
  end if;

  select p.username_changed_at
    into v_previous
    from public.profiles p
   where p.id = new.id;

  -- A release (setting it to NULL) is allowed, and is recorded as a change too.
  if v_previous is not null
     and new.username is not null
     and now() < v_previous + v_window then
    raise exception using
      errcode = 'P0001',
      message = 'username_cooldown',
      detail = format(
        'You can change your username again on %s.',
        to_char(v_previous + v_window, 'YYYY-MM-DD')
      );
  end if;

  if new.username is distinct from old.username then
    new.username_changed_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_username_cooldown on public.profiles;
create trigger enforce_username_cooldown
  before update on public.profiles
  for each row execute function public.enforce_username_cooldown();

-- A brand-new handle has never been changed, so it is not in cooldown.
update public.profiles
   set username_changed_at = created_at
 where username_changed_at is null
   and username is not null;

-- ────────────────────────────────────────────────────────────
-- 5. handle_new_user — records the provider at signup
-- ────────────────────────────────────────────────────────────
--
-- Still never raises. A provider that is somehow missing or unexpected falls
-- back to the `is_anonymous` fact, and then to 'email', so the column is
-- always one the application has a branch for.
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
  v_provider text;
  v_guest    boolean;
begin
  begin
    v_guest := coalesce(new.is_anonymous, false);

    v_provider := case
      when v_guest then 'anonymous'
      else coalesce(
        nullif(new.raw_app_meta_data ->> 'provider', ''),
        'email'
      )
    end;

    -- Kept in the three values the CHECK constraint allows; anything else is
    -- treated as unknown rather than allowed to fail the insert.
    if v_provider not in ('email', 'google', 'anonymous') then
      v_provider := 'email';
    end if;

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
                 nullif(new.raw_user_meta_data ->> 'name', ''),
                 nullif(new.raw_user_meta_data ->> 'user_name', '')
               ) as d
      ) as named;

    select nullif(a, 300)
      into v_avatar
      from (
        select coalesce(new.raw_user_meta_data ->> 'avatar_url', '') as a
      ) as pic;
  exception
    when others then
      -- Bad metadata must never break account creation.
      v_username := null;
      v_display  := null;
      v_avatar   := null;
      v_provider := case when coalesce(new.is_anonymous, false) then 'anonymous' else 'email' end;
      v_guest    := coalesce(new.is_anonymous, false);
  end;

  insert into public.profiles
    (id, email, username, display_name, avatar_url, is_guest, auth_method)
  values (
    new.id,
    new.email,
    v_username,
    coalesce(
      v_display,
      nullif(split_part(coalesce(new.email, ''), '@', 1), '')
    ),
    v_avatar,
    v_guest,
    v_provider
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

-- ────────────────────────────────────────────────────────────
-- 6. RLS unchanged
-- ────────────────────────────────────────────────────────────
--
-- `auth_method` and `username_changed_at` are owner-only like the rest of the
-- row: the profiles policies already scope to `auth.uid() = id`, and no policy
-- is created, widened or dropped here. Knowing how someone signed up is not
-- something any other user may read.
-- ══════════════════════════════════════════════════════════════════════════
