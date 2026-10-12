-- =========================================================
-- 0036: ставки в юанях на матч і на переможця турніру (тоталізатор).
--
-- Юані — ігрова валюта: сайт їх не списує й не виплачує. Ставка — запис:
--   1) гравець (вхід через Discord) ставить на сайті → status 'pending' (очікує оплати);
--   2) передає юані скарбнику турніру в грі → суперадмін у вкладці «Ставки» ставить 'paid';
--   3) у пул і в коефіцієнти йдуть ЛИШЕ оплачені ставки (bet_pools) — неоплачена «ставка»
--      не зсуне коефіцієнт;
--   4) після результату сайт рахує виграш (src/data/betMath.ts), суперадмін платить у грі й
--      ставить «виплачено» (payout_at / payout_amount).
--
-- Тоталізатор: переможці ділять увесь пул ринку мінус комісія (tournaments.bet_commission_pct,
-- за замовчуванням 0) пропорційно ставкам. Клан нічим не ризикує. Ніхто не поставив на
-- переможця або на програвшого — усім повернення. Виплати не зберігаються, а рахуються з
-- результату (як Ело в ratings.ts): переможця змінили заднім числом — сума «до виплати»
-- перерахується сама, а вже записана payout_amount покаже розбіжність.
--
-- Хто що бачить:
--   * bets — лише суперадмін (select/update/delete); insert — лише функція place_bet, яку
--     викликає бекенд (pw-ladder, POST /api/pvp/bets) service-ключем: хто ставить, знає лише
--     Discord-сесія бекенда, anon-ключ із бандла сайту ставку не підробить;
--   * bet_pools — суми оплачених ставок на кожного учасника ринку; читають усі (коефіцієнти),
--     хто саме ставив — не видно.
--
-- Учасник не ставить проти себе: у своєму матчі (і на переможця турніру, де сам грає) — лише
-- на свою перемогу. Свою сторону place_bet шукає за міткою акаунта (account_tag, 0035 — її
-- рахує бекенд) і за ніком у Discord (нік заявки, нік у складі готової команди).
--
-- Прийом ставок на матч закривається: кнопкою суперадміна («Бій почався» → bets_closed_at),
-- автоматично — щойно в матчі з'явився рахунок серії чи переможець. Ринок «переможець турніру»
-- закривається, коли закрито перший справжній матч (обидва учасники), або кнопкою.
--
-- Порядок: спершу ця міграція, потім бекенд із маршрутами ставок, потім фронт.
-- Ідемпотентна.
-- =========================================================

-- ── Налаштування ставок турніру ──────────────────────────────────────
alter table tournaments
  add column if not exists bets_enabled boolean not null default false,
  add column if not exists bet_commission_pct numeric(5, 2) not null default 0,
  add column if not exists bet_min_stake bigint not null default 1000000,
  add column if not exists bet_max_stake bigint,
  add column if not exists bet_treasurer text,
  add column if not exists outright_bets_closed_at timestamptz;

alter table tournaments drop constraint if exists tournaments_bet_settings_check;
alter table tournaments add constraint tournaments_bet_settings_check check (
  bet_commission_pct between 0 and 50
  and bet_min_stake >= 1
  and (bet_max_stake is null or bet_max_stake >= bet_min_stake)
  and (bet_treasurer is null or char_length(bet_treasurer) <= 40)
);

alter table bracket_matches add column if not exists bets_closed_at timestamptz;

-- Налаштування ставок міняє лише суперадмін (ГМ-власник турніру — ні). Вкладений апдейт із
-- тригера bracket_matches (закриття ринку турніру) дозволено; SQL-редактор (auth.uid() null) — теж.
create or replace function tournaments_bet_guard() returns trigger
language plpgsql as $$
begin
  if pg_trigger_depth() > 1 or auth.uid() is null or is_superadmin() then return new; end if;
  if new.bets_enabled is distinct from old.bets_enabled
     or new.bet_commission_pct is distinct from old.bet_commission_pct
     or new.bet_min_stake is distinct from old.bet_min_stake
     or new.bet_max_stake is distinct from old.bet_max_stake
     or new.bet_treasurer is distinct from old.bet_treasurer
     or new.outright_bets_closed_at is distinct from old.outright_bets_closed_at then
    raise exception 'Налаштування ставок міняє лише суперадмін.';
  end if;
  return new;
end;
$$;
drop trigger if exists tournaments_bet_guard on tournaments;
create trigger tournaments_bet_guard before update on tournaments
  for each row execute function tournaments_bet_guard();

-- ── Ставки ────────────────────────────────────────────────────────────
create table if not exists bets (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  -- 'match' — на переможця матчу (match_id), 'tournament' — на переможця турніру
  market text not null check (market in ('match', 'tournament')),
  -- сітку перегенерували — матч зник, ставка (market='match', match_id null) — повернення
  match_id uuid references bracket_matches(id) on delete set null,
  pick_id uuid references registrations(id) on delete set null,
  -- назва учасника на мить ставки — для таблиці адміна, навіть коли заявку видалено
  pick_name text not null check (char_length(pick_name) between 1 and 80),
  stake bigint not null check (stake > 0 and stake <= 100000000000),
  -- гравець ладдера (ladder_players.id) і його нік у Discord на мить ставки
  player_id text not null check (char_length(player_id) between 1 and 64),
  player_nick text not null check (char_length(player_nick) between 1 and 64),
  -- з якого персонажа гравець переказує юані (необовʼязково) — щоб скарбник знайшов переказ
  game_nick text check (game_nick is null or char_length(game_nick) between 1 and 40),
  status text not null default 'pending' check (status in ('pending', 'paid', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  paid_by uuid,
  payout_at timestamptz,
  payout_amount bigint check (payout_amount is null or payout_amount >= 0),
  payout_by uuid,
  admin_note text check (admin_note is null or char_length(admin_note) <= 200)
);
create index if not exists bets_tournament_idx on bets (tournament_id, created_at desc);
create index if not exists bets_player_idx on bets (player_id, created_at desc);
create index if not exists bets_match_idx on bets (match_id);

alter table bets enable row level security;
drop policy if exists bets_superadmin_select on bets;
create policy bets_superadmin_select on bets for select using (is_superadmin());
drop policy if exists bets_superadmin_update on bets;
create policy bets_superadmin_update on bets for update using (is_superadmin()) with check (is_superadmin());
drop policy if exists bets_superadmin_delete on bets;
create policy bets_superadmin_delete on bets for delete using (is_superadmin());
-- insert-політики немає: ставки пише лише place_bet (security definer, лише service_role).

-- Що в ставці записано на мить подачі — не міняється; оплату й виплату штампує база.
create or replace function bets_stamp() returns trigger
language plpgsql as $$
begin
  if new.tournament_id is distinct from old.tournament_id
     or new.market is distinct from old.market
     or new.stake is distinct from old.stake
     or new.player_id is distinct from old.player_id
     or new.created_at is distinct from old.created_at
     -- match_id / pick_id міняє лише on delete set null (сітку чи заявку видалено)
     or (new.match_id is distinct from old.match_id and new.match_id is not null)
     or (new.pick_id is distinct from old.pick_id and new.pick_id is not null) then
    raise exception 'Ставку змінювати не можна — лише статус, оплату й виплату.';
  end if;
  if new.status = 'paid' and old.status is distinct from 'paid' then
    new.paid_at := now();
    new.paid_by := auth.uid();
  elsif new.status <> 'paid' then
    new.paid_at := null;
    new.paid_by := null;
  end if;
  if new.payout_amount is null then
    new.payout_at := null;
    new.payout_by := null;
  elsif new.payout_amount is distinct from old.payout_amount then
    new.payout_at := now();
    new.payout_by := auth.uid();
  end if;
  return new;
end;
$$;
drop trigger if exists bets_stamp on bets;
create trigger bets_stamp before update on bets
  for each row execute function bets_stamp();

-- ── Пули (публічно): сума оплачених ставок на кожного учасника ринку ──
-- match_id null — ринок «переможець турніру». Окремий id — первинний ключ потрібен realtime
-- (replica identity): без нього delete з таблиці в публікації падає.
create table if not exists bet_pools (
  id bigint generated always as identity primary key,
  tournament_id uuid not null references tournaments(id) on delete cascade,
  match_id uuid references bracket_matches(id) on delete cascade,
  pick_id uuid not null references registrations(id) on delete cascade,
  total bigint not null default 0,
  bets int not null default 0
);
create unique index if not exists bet_pools_key_uidx
  on bet_pools (tournament_id, coalesce(match_id, '00000000-0000-0000-0000-000000000000'::uuid), pick_id);

alter table bet_pools enable row level security;
drop policy if exists bet_pools_select on bet_pools;
create policy bet_pools_select on bet_pools for select using (true);
-- пише лише тригер нижче (security definer)

create or replace function refresh_bet_pool(p_tournament uuid, p_market text, p_match uuid, p_pick uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s bigint; n int;
begin
  -- ставка на матч, що зник із сітки, у жоден пул не йде (і не в пул турніру)
  if p_pick is null or (p_market = 'match' and p_match is null) then return; end if;
  if p_market = 'tournament' then p_match := null; end if;
  select coalesce(sum(stake), 0), count(*) into s, n
    from bets
   where tournament_id = p_tournament and market = p_market and status = 'paid'
     and match_id is not distinct from p_match and pick_id = p_pick;
  if n = 0 then
    delete from bet_pools
     where tournament_id = p_tournament and match_id is not distinct from p_match and pick_id = p_pick;
  -- каскадне видалення турніру / заявки / матчу: рядка-власника вже немає — пул не відновлюємо
  elsif exists (select 1 from tournaments where id = p_tournament)
     and exists (select 1 from registrations where id = p_pick)
     and (p_match is null or exists (select 1 from bracket_matches where id = p_match)) then
    insert into bet_pools (tournament_id, match_id, pick_id, total, bets)
    values (p_tournament, p_match, p_pick, s, n)
    on conflict (tournament_id, coalesce(match_id, '00000000-0000-0000-0000-000000000000'::uuid), pick_id)
    do update set total = excluded.total, bets = excluded.bets;
  end if;
end;
$$;
revoke execute on function refresh_bet_pool(uuid, text, uuid, uuid) from public, anon, authenticated;

create or replace function bets_pool_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform refresh_bet_pool(old.tournament_id, old.market, old.match_id, old.pick_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform refresh_bet_pool(new.tournament_id, new.market, new.match_id, new.pick_id);
  end if;
  return null;
end;
$$;
drop trigger if exists bets_pool_sync on bets;
create trigger bets_pool_sync after insert or update or delete on bets
  for each row execute function bets_pool_sync();

-- ── Автозакриття прийому ставок ──────────────────────────────────────
-- Рахунок серії чи переможець у матчі — бій іде або вже був: прийом на матч закрито.
create or replace function bracket_matches_bets_close() returns trigger
language plpgsql as $$
begin
  if new.bets_closed_at is null and (
       (new.winner_id is not null and new.winner_id is distinct from old.winner_id)
       or (new.score is not null and new.score is distinct from old.score)
     ) then
    new.bets_closed_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists bracket_matches_bets_close on bracket_matches;
create trigger bracket_matches_bets_close before update on bracket_matches
  for each row execute function bracket_matches_bets_close();

-- Закрили справжній матч (обидва учасники, не bye) — турнір почався: ринок «переможець турніру» теж.
create or replace function bracket_matches_outright_close() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.bets_closed_at is not null and old.bets_closed_at is null
     and new.participant1_id is not null and new.participant2_id is not null then
    update tournaments set outright_bets_closed_at = now()
     where id = new.tournament_id and outright_bets_closed_at is null;
  end if;
  return null;
end;
$$;
drop trigger if exists bracket_matches_outright_close on bracket_matches;
create trigger bracket_matches_outright_close after update on bracket_matches
  for each row execute function bracket_matches_outright_close();

-- ── Прийом ставки (викликає лише бекенд, service_role) ───────────────
-- Помилки — raise exception (SQLSTATE P0001) з текстом для гравця: бекенд показує його як є.
create or replace function place_bet(
  p_tournament_id uuid,
  p_match_id uuid,
  p_pick_id uuid,
  p_stake bigint,
  p_player_id text,
  p_player_nick text,
  p_game_nick text default null,
  p_account_tag text default null
) returns bets
language plpgsql security definer set search_path = public as $$
declare
  t tournaments%rowtype;
  m bracket_matches%rowtype;
  pick_name text;
  nick text := lower(trim(coalesce(p_player_nick, '')));
  my_sides uuid[];
  live int;
  res bets%rowtype;
begin
  -- share-блокування: ставки йдуть паралельно, а закриття ринку турніру (update) чекає на них
  select * into t from tournaments where id = p_tournament_id for share;
  if not found then raise exception 'Турнір не знайдено.'; end if;
  if not t.bets_enabled or t.visibility <> 'public' then raise exception 'На цей турнір ставки не приймаються.'; end if;
  if t.status in ('draft', 'completed', 'cancelled') then raise exception 'Турнір завершено або скасовано — ставки не приймаються.'; end if;
  if p_stake is null or p_stake < t.bet_min_stake then raise exception 'Ставка менша за мінімальну для цього турніру.'; end if;
  if t.bet_max_stake is not null and p_stake > t.bet_max_stake then raise exception 'Ставка більша за максимальну для цього турніру.'; end if;
  if char_length(trim(coalesce(p_player_id, ''))) = 0 or nick = '' then raise exception 'Немає гравця — увійди через Discord.'; end if;

  -- Сторони, за які грає той, хто ставить: його заявка (за міткою акаунта чи ніком) або команда.
  select coalesce(array_agg(distinct coalesce(r.team_registration_id, r.id)), '{}') into my_sides
    from registrations r
   where r.tournament_id = t.id and r.status <> 'rejected' and (
         (p_account_tag is not null and r.account_tag = p_account_tag)
      or lower(r.nickname) = nick
      or (r.kind = 'team' and exists (select 1 from unnest(coalesce(r.member_nicknames, '{}')) mn where lower(mn) = nick))
   );

  if p_match_id is not null then
    -- for update: прийом серіалізується з кнопкою «Бій почався» / записом результату
    select * into m from bracket_matches where id = p_match_id and tournament_id = t.id for update;
    if not found then raise exception 'Матч не знайдено — онови сторінку.'; end if;
    if m.participant1_id is null or m.participant2_id is null then raise exception 'Учасники матчу ще не визначені.'; end if;
    if m.winner_id is not null or m.bets_closed_at is not null then raise exception 'Прийом ставок на цей матч закрито.'; end if;
    if p_pick_id is distinct from m.participant1_id and p_pick_id is distinct from m.participant2_id then
      raise exception 'Можна ставити лише на учасника цього матчу.';
    end if;
    if (m.participant1_id = any(my_sides) or m.participant2_id = any(my_sides)) and not (p_pick_id = any(my_sides)) then
      raise exception 'Це твій матч — ставити можна лише на свою перемогу.';
    end if;
  else
    if t.outright_bets_closed_at is not null then raise exception 'Прийом ставок на переможця турніру закрито.'; end if;
    if not exists (select 1 from bracket_matches where tournament_id = t.id) then
      raise exception 'Сітки ще немає — ставки на переможця відкриються після її генерації.';
    end if;
    if exists (select 1 from bracket_matches where tournament_id = t.id
                 and participant1_id is not null and participant2_id is not null
                 and (winner_id is not null or bets_closed_at is not null)) then
      raise exception 'Турнір уже почався — прийом ставок на переможця закрито.';
    end if;
    if not exists (select 1 from bracket_matches where tournament_id = t.id
                     and (participant1_id = p_pick_id or participant2_id = p_pick_id)) then
      raise exception 'Такого учасника немає в сітці.';
    end if;
    if exists (select 1 from bracket_matches where tournament_id = t.id
                 and (participant1_id = any(my_sides) or participant2_id = any(my_sides)))
       and not (p_pick_id = any(my_sides)) then
      raise exception 'Ти граєш у цьому турнірі — ставити можна лише на свою перемогу.';
    end if;
  end if;

  select count(*) into live from bets
   where player_id = p_player_id and tournament_id = t.id
     and market = case when p_match_id is null then 'tournament' else 'match' end
     and match_id is not distinct from p_match_id and status in ('pending', 'paid');
  if live >= 5 then raise exception 'На цей ринок у тебе вже 5 ставок — більше не можна.'; end if;

  select left(nickname, 80) into pick_name from registrations where id = p_pick_id;
  if pick_name is null then raise exception 'Учасника не знайдено — онови сторінку.'; end if;

  insert into bets (tournament_id, market, match_id, pick_id, pick_name, stake, player_id, player_nick, game_nick)
  values (t.id, case when p_match_id is null then 'tournament' else 'match' end, p_match_id, p_pick_id, pick_name,
          p_stake, p_player_id, left(trim(p_player_nick), 64), nullif(left(trim(coalesce(p_game_nick, '')), 40), ''))
  returning * into res;
  return res;
end;
$$;
revoke execute on function place_bet(uuid, uuid, uuid, bigint, text, text, text, text) from public, anon, authenticated;
grant execute on function place_bet(uuid, uuid, uuid, bigint, text, text, text, text) to service_role;

-- ── Realtime ─────────────────────────────────────────────────────────
-- bet_pools — коефіцієнти наживо всім; bets — таблиця суперадміна (realtime поважає RLS:
-- anon подій зі ставок не отримує).
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'bet_pools') then
    alter publication supabase_realtime add table bet_pools;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'bets') then
    alter publication supabase_realtime add table bets;
  end if;
end;
$$;
