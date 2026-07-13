-- pw-events + pw-pvp shared Supabase schema
-- Run this once in the Supabase project's SQL editor (Dashboard → SQL Editor → New query → Run).
-- One Supabase project is shared by BOTH pw-events and pw-pvp (same URL + anon key in both .env files).

-- =========================================================
-- Shared: admin allow-list
-- =========================================================
create table if not exists admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;

alter table admins enable row level security;
create policy admins_select on admins for select using (is_admin());
-- no insert/update/delete policy: manage the allow-list from the SQL editor / service-role only.

-- =========================================================
-- pw-events
-- =========================================================
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  emoji text,
  color text not null default 'gold',
  start_min int not null check (start_min between 0 and 1435),
  duration_min int not null check (duration_min > 0),
  recur_kind text not null check (recur_kind in ('once', 'weekly')),
  recur_date date,
  recur_days_mask int,
  skip_dates date[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_recur_shape check (
    (recur_kind = 'once' and recur_date is not null and recur_days_mask is null) or
    (recur_kind = 'weekly' and recur_days_mask is not null and recur_date is null)
  )
);

create table if not exists event_results (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  occurrence_date date not null,
  winner text not null,
  notes text,
  created_at timestamptz not null default now(),
  unique (event_id, occurrence_date)
);

alter table events enable row level security;
alter table event_results enable row level security;

create policy events_select on events for select using (true);
create policy events_write on events for all using (is_admin()) with check (is_admin());

create policy event_results_select on event_results for select using (true);
create policy event_results_write on event_results for all using (is_admin()) with check (is_admin());

-- =========================================================
-- pw-pvp
-- =========================================================
create table if not exists tournament_series (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists tournaments (
  id uuid primary key default gen_random_uuid(),
  series_id uuid references tournament_series(id) on delete set null,
  name text not null,
  event_date date not null,
  status text not null default 'draft'
    check (status in ('draft', 'registration_open', 'registration_closed', 'in_progress', 'completed', 'cancelled')),
  rules_md text,
  prizes_md text,
  bracket_type text not null default 'single_elim' check (bracket_type in ('single_elim', 'double_elim')),
  bracket_size int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists registrations (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  nickname text not null check (char_length(trim(nickname)) between 1 and 40),
  rules_ack boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  created_at timestamptz not null default now()
);

-- unique() table constraints only accept plain columns, not expressions like
-- lower(nickname) — that requires a separate unique index instead.
create unique index if not exists registrations_tournament_nickname_uidx
  on registrations (tournament_id, lower(nickname));

create table if not exists bracket_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  bracket_side text not null default 'winners' check (bracket_side in ('winners', 'losers', 'final')),
  round int not null,
  slot int not null,
  format text not null default 'bo1',
  participant1_id uuid references registrations(id) on delete set null,
  participant2_id uuid references registrations(id) on delete set null,
  winner_id uuid references registrations(id) on delete set null,
  next_match_id uuid references bracket_matches(id) on delete set null,
  next_match_slot int check (next_match_slot in (1, 2)),
  loser_next_match_id uuid references bracket_matches(id) on delete set null,
  loser_next_match_slot int check (loser_next_match_slot in (1, 2)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table tournament_series enable row level security;
alter table tournaments enable row level security;
alter table registrations enable row level security;
alter table bracket_matches enable row level security;

create policy tournament_series_select on tournament_series for select using (true);
create policy tournament_series_write on tournament_series for all using (is_admin()) with check (is_admin());

create policy tournaments_select on tournaments for select using (true);
create policy tournaments_write on tournaments for all using (is_admin()) with check (is_admin());

create policy registrations_select on registrations for select using (true);
-- anyone may submit a registration; the unique index above (tournament_id, lower(nickname))
-- is what actually prevents the same character from registering twice for the same tournament.
create policy registrations_insert_public on registrations for insert with check (true);
create policy registrations_admin_write on registrations for update using (is_admin()) with check (is_admin());
create policy registrations_admin_delete on registrations for delete using (is_admin());

create policy bracket_matches_select on bracket_matches for select using (true);
create policy bracket_matches_write on bracket_matches for all using (is_admin()) with check (is_admin());

-- =========================================================
-- After running this: make yourself an admin.
-- 1. Sign up once via Supabase Auth (either the app's own login form after you wire up
--    supabase.auth.signUp, or Dashboard -> Authentication -> Users -> Add user).
-- 2. Then run, with your account's email:
--      insert into admins (user_id, email)
--      select id, email from auth.users where email = 'you@example.com';
-- =========================================================
