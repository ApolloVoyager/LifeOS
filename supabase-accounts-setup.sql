-- =====================================================================
-- LifeOS — Accounts / per-user data setup for Supabase
-- Run these blocks IN ORDER in the Supabase SQL Editor.
-- Full step-by-step runbook is in SETUP_ACCOUNTS.md.
-- =====================================================================


-- ---------------------------------------------------------------------
-- STEP 1 — Schema + auth plumbing (run first; RLS still OFF)
-- ---------------------------------------------------------------------

-- profiles: one row per user. `approved` gates all access.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

-- Auto-create a (pending) profile whenever someone signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Approval check used by every RLS policy.
create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select approved from public.profiles where id = auth.uid()), false);
$$;

-- Add the per-user column (nullable for now so existing rows survive).
alter table public.app_state add column if not exists user_id uuid references auth.users(id) on delete cascade;


-- ---------------------------------------------------------------------
-- STEP 2 — Create your master account (DASHBOARD, not SQL)
--   Authentication -> Users -> "Add user" -> enter your email + password.
--   Then copy that user's UUID (the "User UID" column) for Step 3.
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- STEP 3 — Migrate existing data to your master account
--   Replace MASTER_UUID below with the UUID from Step 2 (keep the quotes).
-- ---------------------------------------------------------------------

update public.app_state set user_id = 'MASTER_UUID' where user_id is null;
update public.profiles  set approved = true        where id = 'MASTER_UUID';

-- Lock the column down and make (user_id, key) the primary key.
alter table public.app_state alter column user_id set not null;
alter table public.app_state drop constraint app_state_pkey;
alter table public.app_state add primary key (user_id, key);


-- ---------------------------------------------------------------------
-- STEP 4 — Enable Row Level Security + policies (run LAST)
-- ---------------------------------------------------------------------

alter table public.app_state enable row level security;
drop policy if exists "app_state own rows" on public.app_state;
create policy "app_state own rows" on public.app_state
  for all
  using (user_id = auth.uid() and public.is_approved())
  with check (user_id = auth.uid() and public.is_approved());
alter table public.profiles enable row level security;
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select using (id = auth.uid());

-- (Optional) Storage policy for per-user progress photos.
-- Only needed if you later switch the `progress-photos` bucket to private.
-- The app uploads to "<user_id>/photo_....jpg" so these scope by folder:
--
-- create policy "own photos read" on storage.objects for select
--   using (bucket_id = 'progress-photos'
--          and (storage.foldername(name))[1] = auth.uid()::text);
-- create policy "own photos write" on storage.objects for insert
--   with check (bucket_id = 'progress-photos'
--               and (storage.foldername(name))[1] = auth.uid()::text);
-- create policy "own photos delete" on storage.objects for delete
--   using (bucket_id = 'progress-photos'
--          and (storage.foldername(name))[1] = auth.uid()::text);
