-- Довідник рядків правил турніру (вкладка «Правила» в адмінці) + знімок
-- обраних рядків у турнірі (tournaments.rule_flags).
--
-- Текст правил турніру збирається з рядків довідника (rule_items): суперадмін
-- редагує підписи, тексти гравцю, дефолти й формати; попап «Правила…» у
-- редакторі турніру бере рядки звідси і зберігає ЗНІМОК тексту в
-- tournaments.rule_flags разом зі згенерованим rules_md — тому пізніша правка
-- довідника старих турнірів не чіпає. Версій довідник не має: правки на місці,
-- по рядку (last write wins); системні рядки (is_system) не видаляються, лише
-- архівуються — за party_buffs / kx / reserve стоїть код жеребки
-- (src/data/ruleFlags.ts).
--
-- Що робить, по порядку: (1) таблиця rule_items з RLS і realtime; (2) стартові
-- 10 рядків — ті самі, що BUILTIN_RULE_ITEMS у src/data/ruleCatalog.ts (тест
-- звіряє тексти; тексти гравцю — дослівно зі старого шаблону standardRules.ts і
-- живих правил); (3) колонки турніру rule_flags / rule_flags_updated_at зі
-- штампом часу зміни (бейдж «правила змінено після заявки»); (4) серія копіює
-- rule_flags разом із rules_md; (5) публічна реєстрація вимагає rules_ack.
--
-- Виконати ДО деплою фронту: редактор турніру пише rule_flags без фолбеку
-- (читання з фолбеком є — tournaments.ts), а форма заявки вже шле rules_ack.

-- ── (1) rule_items ────────────────────────────────────────
create table if not exists rule_items (
  key text primary key,                                   -- системний ключ з коду або 'c_' + 8 hex (доданий адміном)
  grp text not null check (grp in ('battle', 'registration', 'squads')),
  kind text not null check (kind in ('flag', 'choice', 'number', 'text')),
  label_admin text not null,                              -- підпис в адмінці
  text_player text not null,                              -- текст гравцю; для kind='number' — шаблон із {value}; для 'choice' — тексти у варіантах
  options jsonb,                                          -- для 'choice': [{value, label, text}]; порожній text = «не згадувати»
  default_value jsonb,                                    -- галочка/текст: true|false; вибір: "value"; число: 15
  visible_for text[] not null default '{solo,fixed,balanced}',  -- 1х1 / готові команди / балансний фул-рандом
  affects text check (affects is null or affects in ('party_buffs', 'kx', 'reserve')),  -- лише системні: читає жеребка
  is_system boolean not null default false,
  sort int not null default 0,
  archived boolean not null default false,
  updated_at timestamptz default now(),
  updated_by uuid references auth.users(id)
);

alter table rule_items enable row level security;
-- читають усі: текст і так публічний (сторінка «Правила», сторінка турніру)
drop policy if exists rule_items_select on rule_items;
create policy rule_items_select on rule_items for select to anon, authenticated using (true);
-- правлять лише суперадміни (довідник глобальний і йде на публічну сторінку); ГМ обирає рядки в попапі свого турніру
drop policy if exists rule_items_insert on rule_items;
create policy rule_items_insert on rule_items for insert with check (is_superadmin());
drop policy if exists rule_items_update on rule_items;
create policy rule_items_update on rule_items for update using (is_superadmin()) with check (is_superadmin());
-- системні рядки видалити не можна — лише archived = true
drop policy if exists rule_items_delete on rule_items;
create policy rule_items_delete on rule_items for delete using (is_superadmin() and not is_system);

-- Хто і коли міняв — проставляє БД (як у registration_adjustments, 0021).
create or replace function rule_items_stamp() returns trigger
language plpgsql as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists rule_items_stamp on rule_items;
create trigger rule_items_stamp
  before insert or update on rule_items
  for each row execute function rule_items_stamp();

-- живі оновлення (другий суперадмін зберіг рядок — вкладка підхопить).
-- Через do-блок: решта файлу повторно виконувана (if not exists / on conflict /
-- or replace), а «add table» вдруге падає з «already member of publication»
-- і зупиняє скрипт, який власник виконує вручну частинами.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'rule_items') then
    alter publication supabase_realtime add table rule_items;
  end if;
end;
$$;

-- ── (2) стартові рядки = BUILTIN_RULE_ITEMS (src/data/ruleCatalog.ts) ──
insert into rule_items (key, grp, kind, label_admin, text_player, options, default_value, visible_for, affects, is_system, sort) values
  ('no_spark3', 'battle', 'flag', 'Без 3 ци (третю вспишку не використовуємо)', 'Без 3 ци.',
   null, 'true'::jsonb, '{solo,fixed,balanced}', null, true, 10),
  ('self_only', 'battle', 'flag', 'Тільки селфи', 'Тільки селфи.',
   null, 'true'::jsonb, '{solo,fixed,balanced}', null, true, 20),
  ('potions', 'battle', 'choice', 'Аптека', '',
   '[{"value":"all","label":"вся","text":"Вся аптека — дозволена."},
     {"value":"none","label":"заборонена","text":"Аптека заборонена."}]'::jsonb,
   '"all"'::jsonb, '{solo,fixed,balanced}', null, true, 30),
  ('kite', 'battle', 'number', 'Кайт / інвіз не довше ніж [N] с', 'Дозволено до {value} секунд кайта / інвіза.',
   null, '15'::jsonb, '{solo,fixed,balanced}', null, true, 40),
  ('party_buffs', 'battle', 'flag', 'Бафи лише від своєї пачки (ПА/ПЗ бафи Стража в чужій пачці — не можна)',
   'Бафи — лише від своєї пачки; ПА/ПЗ бафи Стража в пачках, де його нема, — не дозволено.',
   null, 'true'::jsonb, '{fixed,balanced}', 'party_buffs', true, 50),
  ('bd_wine', 'battle', 'choice', 'БД вино', '',
   '[{"value":"skip","label":"не згадувати","text":""},
     {"value":"allowed","label":"дозволено","text":"БД вино дозволено."},
     {"value":"forbidden","label":"заборонено","text":"БД вино заборонено."}]'::jsonb,
   '"skip"'::jsonb, '{solo,fixed,balanced}', null, true, 60),
  ('kx', 'battle', 'choice', 'КХ-бафи', '',
   '[{"value":"unset","label":"не задано","text":""},
     {"value":"kx","label":"усі під КХ","text":"Усі під КХ-бафами."},
     {"value":"noKx","label":"без КХ","text":"Без КХ-бафів."}]'::jsonb,
   '"unset"'::jsonb, '{balanced}', 'kx', true, 70),
  ('reg_block', 'registration', 'flag', 'Стандартний блок про реєстрацію й анкету (5 рядків)',
   E'Ти не обираєш собі команду — команди формує система випадково після закриття реєстрації, вирівнюючи спорядження і класи.\n'
   'Реєстрація індивідуальна: один персонаж — одна заявка. Заявки на кількох персонажів або від одного гравця під різними ніками відхиляються.\n'
   'Анкета спорядження заповнюється чесно — адмін перевіряє спорядження в грі. Неправдиві дані — дискваліфікація, місце займає гравець із резерву.\n'
   'ПЗ-сет / ПА-сет / Спів-Аспід рахуються від порогів: сумарний ПЗ ≥ 30, ПА ≥ 30, швидкість атаки ≥ 3.33 уд/с або −30 % часу активації — усе без бафів.\n'
   'Трактат: в анкеті вказується найкращий, який береш на турнір; свап униз дозволений, угору — ні.',
   null, 'true'::jsonb, '{balanced}', null, true, 10),
  ('squads_fixed', 'squads', 'flag', 'Склади публікуються і не міняються на прохання; заміни — лише адмін',
   'Склади команд публікуються на сторінці турніру і не змінюються на прохання гравців. Заміни робить лише адмін — у разі неявки або дискваліфікації.',
   null, 'true'::jsonb, '{balanced}', null, true, 10),
  ('reserve', 'squads', 'choice', 'Резерв', '',
   '[{"value":"latest","label":"останні за часом реєстрації","text":"Гравці, які не потрапили в команди через кількість (останні за часом реєстрації), утворюють резерв і заміняють тих, хто не з''явився на старт."},
     {"value":"random","label":"випадково","text":"Гравці, які не потрапили в команди через кількість (обрані випадково жеребкою), утворюють резерв і заміняють тих, хто не з''явився на старт."}]'::jsonb,
   '"latest"'::jsonb, '{balanced}', 'reserve', true, 20)
on conflict (key) do nothing;

-- ── (3) tournaments: знімок обраних рядків + час зміни правил ──
alter table tournaments add column if not exists rule_flags jsonb;             -- TournamentRuleFlags (src/data/ruleFlags.ts); null = старий турнір, лише rules_md
alter table tournaments add column if not exists rule_flags_updated_at timestamptz;

-- Час останньої зміни тексту правил проставляє БД: і при зміні знімка, і при
-- правці rules_md у textarea старого турніру — бейдж «правила змінено після
-- заявки» порівнює його з created_at заявки.
create or replace function tournaments_rules_stamp() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.rule_flags is not null or new.rules_md is not null then new.rule_flags_updated_at := now(); end if;
  elsif new.rule_flags is distinct from old.rule_flags or new.rules_md is distinct from old.rules_md then
    new.rule_flags_updated_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists tournaments_rules_stamp on tournaments;
create trigger tournaments_rules_stamp
  before insert or update on tournaments
  for each row execute function tournaments_rules_stamp();

-- ── (4) серія копіює rule_flags (0017:181-199 + одна колонка) ──
-- Явний список колонок: без rule_flags автостворений турнір отримав би лише
-- rules_md без прапорців — та сама діра, що колись була з bracket_new_look.
create or replace function create_due_series_tournaments() returns void
language plpgsql security definer set search_path = public as $$
declare s record; next_date date; tpl record;
begin
  for s in select * from tournament_series where is_active and auto_weekday is not null loop
    next_date := current_date + ((s.auto_weekday - extract(dow from current_date)::int + 7) % 7);
    if not exists (select 1 from tournaments where series_id = s.id and event_date = next_date) then
      select bracket_type, team_size, team_mode, rules_md, prizes_md, third_place_match, bracket_new_look, rule_flags
        into tpl from tournaments where series_id = s.id order by event_date desc limit 1;
      insert into tournaments (series_id, name, event_date, status, rules_md, prizes_md,
                               bracket_type, team_size, team_mode, third_place_match, bracket_new_look, visibility, rule_flags)
      values (s.id, s.name || ' ' || to_char(next_date, 'YYYY-MM-DD'), next_date, 'registration_open',
              tpl.rules_md, tpl.prizes_md, coalesce(tpl.bracket_type, 'single_elim'), tpl.team_size,
              coalesce(tpl.team_mode, 'fixed'), coalesce(tpl.third_place_match, false),
              coalesce(tpl.bracket_new_look, true), 'public', tpl.rule_flags);
    end if;
  end loop;
end;
$$;

-- ── (5) публічна реєстрація вимагає підтвердження правил (0017:70-80 + rules_ack) ──
-- Форма й так шле rules_ack = true; це захист від стороннього клієнта.
-- RegisterPage мапить відмову RLS у зрозуміле повідомлення.
drop policy if exists registrations_insert_public on registrations;
create policy registrations_insert_public on registrations for insert
  with check (
    kind = 'player' and team_registration_id is null and status = 'pending'
    and rules_ack
    and exists (
      select 1 from tournaments t
      where t.id = registrations.tournament_id
        and t.status = 'registration_open'
        and t.event_date >= current_date
        and (t.team_mode <> 'balanced_random' or registrations.char_class is not null)
    )
  );
