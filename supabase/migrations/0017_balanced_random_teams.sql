-- Балансний фул-рандом: командний турнір, у якому гравці реєструються
-- поодинці з короткою анкетою спорядження, а команди формує адмін —
-- алгоритм працює на клієнті (src/data/balance.ts), запис результату
-- атомарний через RPC apply_balanced_teams нижче.
--
-- Представлення: згенерована команда — це рядок registrations з
-- kind='team' (сітка/подіум/чемпіон і далі ключуються на registrations.id
-- і nickname, тож нічого в них переписувати не треба); гравець — рядок
-- kind='player' з анкетою і FK team_registration_id на свою команду.
-- Gear score НЕ зберігається — рахується на читанні з дискретних відповідей
-- за версією правил tournaments.balance_rules_version (src/data/gearRules.ts);
-- знімок score на момент генерації лежить у tournaments.balance_stats.

-- ── tournaments ───────────────────────────────────────────
alter table tournaments add column if not exists team_mode text not null default 'fixed'
  check (team_mode in ('fixed', 'balanced_random'));
alter table tournaments drop constraint if exists tournaments_team_mode_requires_size;
alter table tournaments add constraint tournaments_team_mode_requires_size
  check (team_mode = 'fixed' or team_size is not null);
alter table tournaments add column if not exists balance_seed text;           -- seed формування команд
alter table tournaments add column if not exists bracket_seed text;           -- seed посіву сітки; новий при кожному решафлі
alter table tournaments add column if not exists balance_rules_version text;  -- напр. 'balance-v1.0'
alter table tournaments add column if not exists balance_stats jsonb;         -- BalanceStats (src/data/types.ts)

-- ── registrations ─────────────────────────────────────────
alter table registrations add column if not exists kind text not null default 'player' check (kind in ('player', 'team'));
alter table registrations add column if not exists team_registration_id uuid references registrations(id) on delete set null;
alter table registrations add column if not exists char_class text
  check (char_class in ('blademaster','wizard','cleric','archer','venomancer','barbarian','assassin','psychic','seeker','mystic'));
alter table registrations add column if not exists weapon_grade text
  check (weapon_grade in ('other','nirvana','r8r','cgd','r9','r9r1','rcgd','r9r2'));
alter table registrations add column if not exists weapon_refine text
  check (weapon_refine in ('w0_5','w6_7','w8_9','w10','w11','w12'));
alter table registrations add column if not exists weapon_pz boolean;               -- ПЗ-зброя (показник захисту на зброї)
alter table registrations add column if not exists armor_set text
  check (armor_set in ('other','nirvana','nirvana_r8_mix','r8','r8r','r9'));
alter table registrations add column if not exists armor_refine text                 -- «круг точки»: броня + біжа + кільця
  check (armor_refine in ('a0_4','a5','a6','a7','a8','a9','a10','a11','a12'));
alter table registrations add column if not exists special_sets text[]
  check (special_sets is null or special_sets <@ array['pz','pa','aspd']::text[]);
alter table registrations add column if not exists tract text
  check (tract in ('t1_3','t4_5','t6','t7','t8','emperor'));
alter table registrations add column if not exists genie text check (genie in ('top','lower'));  -- 100/100 | 100−
-- калібрувальні поля (v1.0 збирає, але не рахує): показник атаки/захисту з вікна персонажа без бафів
alter table registrations add column if not exists attack_level int check (attack_level is null or attack_level between 0 and 300);
alter table registrations add column if not exists defense_level int check (defense_level is null or defense_level between 0 and 300);

-- команда не входить у команду і не має анкети; анкета або повна, або відсутня
-- (attack_level/defense_level — поза цим правилом, вони необов'язкові)
alter table registrations drop constraint if exists registrations_team_shape;
alter table registrations add constraint registrations_team_shape
  check (kind = 'player' or (team_registration_id is null and char_class is null));
alter table registrations drop constraint if exists registrations_gear_all_or_none;
alter table registrations add constraint registrations_gear_all_or_none check (
  (char_class is null and weapon_grade is null and weapon_refine is null and weapon_pz is null
     and armor_set is null and armor_refine is null and special_sets is null and tract is null and genie is null)
  or
  (char_class is not null and weapon_grade is not null and weapon_refine is not null and weapon_pz is not null
     and armor_set is not null and armor_refine is not null and special_sets is not null and tract is not null and genie is not null)
);
create index if not exists registrations_team_registration_idx on registrations (team_registration_id);

-- назва команди й нік гравця — різні простори імен. Ім'я індексу те саме:
-- RegisterPage розпізнає дубль за підрядком 'registrations_tournament_nickname'.
drop index if exists registrations_tournament_nickname_uidx;
create unique index registrations_tournament_nickname_uidx on registrations (tournament_id, kind, lower(nickname));

-- ── RLS: публічна реєстрація (одночасно закриваємо дірку status='confirmed') ──
drop policy if exists registrations_insert_public on registrations;
create policy registrations_insert_public on registrations for insert
  with check (
    kind = 'player' and team_registration_id is null and status = 'pending'
    and exists (
      select 1 from tournaments t
      where t.id = registrations.tournament_id
        and t.status = 'registration_open'
        and t.event_date >= current_date
        and (t.team_mode <> 'balanced_random' or registrations.char_class is not null)
    )
  );
-- update/delete-політики (0006) не змінюються: власник/суперадмін редагує анкету через «✎».

-- ── RPC: атомарний запис сформованих команд ───────────────
-- p_teams: [{"name":"Команда 1","member_ids":["<uuid>",…]},…]; '[]' = розформувати.
-- p_drop_bracket = true: якщо сітка вже є, але без жодного результату — видалити її в тій самій транзакції.
create or replace function apply_balanced_teams(
  p_tournament_id uuid, p_seed text, p_rules_version text, p_stats jsonb, p_teams jsonb,
  p_drop_bracket boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare
  t tournaments%rowtype; team jsonb; member_ids uuid[]; all_ids uuid[] := '{}'; new_team_id uuid;
begin
  select * into t from tournaments where id = p_tournament_id;
  if not found then raise exception 'Турнір не знайдено'; end if;
  if not (is_superadmin() or t.created_by = auth.uid()) then raise exception 'Немає прав на цей турнір'; end if;
  if t.team_mode <> 'balanced_random' or t.team_size is null then raise exception 'Турнір не в режимі балансного фул-рандому'; end if;
  if exists (select 1 from bracket_matches where tournament_id = p_tournament_id) then
    if exists (select 1 from bracket_matches where tournament_id = p_tournament_id
               and winner_id is not null and participant1_id is not null and participant2_id is not null) then
      raise exception 'У сітці вже є результати — переформування заборонено, лише заміни';
    end if;
    if not p_drop_bracket then
      raise exception 'Сітку вже згенеровано — переформування видалить її (потрібне підтвердження)';
    end if;
    delete from bracket_matches where tournament_id = p_tournament_id;
    update tournaments set bracket_size = null where id = p_tournament_id;
  end if;

  update registrations set team_registration_id = null where tournament_id = p_tournament_id and kind = 'player';
  delete from registrations where tournament_id = p_tournament_id and kind = 'team';

  for team in select * from jsonb_array_elements(coalesce(p_teams, '[]'::jsonb)) loop
    select coalesce(array_agg(x::uuid), '{}') into member_ids from jsonb_array_elements_text(team->'member_ids') x;
    if coalesce(array_length(member_ids, 1), 0) <> t.team_size then
      raise exception 'Команда «%»: % гравців замість %', team->>'name', coalesce(array_length(member_ids, 1), 0), t.team_size;
    end if;
    if exists (select 1 from unnest(member_ids) mid
               where not exists (select 1 from registrations r where r.id = mid and r.tournament_id = p_tournament_id
                                   and r.kind = 'player' and r.status = 'confirmed')) then
      raise exception 'Команда «%» містить непідтвердженого або чужого гравця', team->>'name';
    end if;
    all_ids := all_ids || member_ids;
    insert into registrations (tournament_id, nickname, rules_ack, status, kind, member_nicknames)
    values (p_tournament_id, team->>'name', true, 'confirmed', 'team',
            (select array_agg(r.nickname order by array_position(member_ids, r.id)) from registrations r where r.id = any(member_ids)))
    returning id into new_team_id;
    update registrations set team_registration_id = new_team_id where id = any(member_ids);
  end loop;

  if (select count(*) from unnest(all_ids)) <> (select count(distinct x) from unnest(all_ids) x) then
    raise exception 'Гравець потрапив у дві команди';
  end if;

  update tournaments set balance_seed = p_seed, balance_rules_version = p_rules_version, balance_stats = p_stats, updated_at = now()
  where id = p_tournament_id;
end;
$$;
revoke execute on function apply_balanced_teams(uuid, text, text, jsonb, jsonb, boolean) from public, anon;
grant execute on function apply_balanced_teams(uuid, text, text, jsonb, jsonb, boolean) to authenticated;

-- ── RPC: заміна / вилучення гравця у сформованій команді (працює і коли сітка вже є) ──
-- p_in_id = null → «прибрати без заміни». Вибулий отримує status='rejected' (в UI — «вибув»),
-- щоб не потрапити в наступне переформування; факт заміни пишеться в balance_stats.substitutions.
create or replace function substitute_team_member(
  p_team_id uuid, p_out_id uuid, p_in_id uuid default null, p_reason text default 'no_show'
) returns void
language plpgsql security definer set search_path = public as $$
declare team registrations%rowtype; t tournaments%rowtype;
begin
  select * into team from registrations where id = p_team_id and kind = 'team';
  if not found then raise exception 'Команду не знайдено'; end if;
  select * into t from tournaments where id = team.tournament_id;
  if not (is_superadmin() or t.created_by = auth.uid()) then raise exception 'Немає прав на цей турнір'; end if;
  if not exists (select 1 from registrations where id = p_out_id and team_registration_id = p_team_id) then
    raise exception 'Гравець не в цій команді';
  end if;
  update registrations set team_registration_id = null, status = 'rejected' where id = p_out_id;
  if p_in_id is not null then
    if not exists (select 1 from registrations r where r.id = p_in_id and r.tournament_id = t.id
                   and r.kind = 'player' and r.status = 'confirmed' and r.team_registration_id is null) then
      raise exception 'Заміна має бути підтвердженим гравцем цього турніру поза командами';
    end if;
    update registrations set team_registration_id = p_team_id where id = p_in_id;
  end if;
  update registrations
  set member_nicknames = (select array_agg(nickname order by created_at) from registrations where team_registration_id = p_team_id)
  where id = p_team_id;
  update tournaments
  set balance_stats = coalesce(balance_stats, '{}'::jsonb) || jsonb_build_object('substitutions',
        coalesce(balance_stats->'substitutions', '[]'::jsonb)
        || jsonb_build_object('teamId', p_team_id, 'out', p_out_id, 'in', p_in_id, 'reason', p_reason, 'at', now())),
      updated_at = now()
  where id = t.id;
end;
$$;
revoke execute on function substitute_team_member(uuid, uuid, uuid, text) from public, anon;
grant execute on function substitute_team_member(uuid, uuid, uuid, text) to authenticated;

-- ── Серії: копіювати team_mode (і bracket_new_look, який теж губився) ──
create or replace function create_due_series_tournaments() returns void
language plpgsql security definer set search_path = public as $$
declare s record; next_date date; tpl record;
begin
  for s in select * from tournament_series where is_active and auto_weekday is not null loop
    next_date := current_date + ((s.auto_weekday - extract(dow from current_date)::int + 7) % 7);
    if not exists (select 1 from tournaments where series_id = s.id and event_date = next_date) then
      select bracket_type, team_size, team_mode, rules_md, prizes_md, third_place_match, bracket_new_look
        into tpl from tournaments where series_id = s.id order by event_date desc limit 1;
      insert into tournaments (series_id, name, event_date, status, rules_md, prizes_md,
                               bracket_type, team_size, team_mode, third_place_match, bracket_new_look, visibility)
      values (s.id, s.name || ' ' || to_char(next_date, 'YYYY-MM-DD'), next_date, 'registration_open',
              tpl.rules_md, tpl.prizes_md, coalesce(tpl.bracket_type, 'single_elim'), tpl.team_size,
              coalesce(tpl.team_mode, 'fixed'), coalesce(tpl.third_place_match, false),
              coalesce(tpl.bracket_new_look, true), 'public');
    end if;
  end loop;
end;
$$;
