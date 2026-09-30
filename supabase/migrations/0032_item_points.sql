-- Скор v2 «від речей» (src/doll/model/itemScore.ts): заявка персонажем несе
-- бали за речі ляльки й розклад по речах, а скор заявки = клас (за розміром
-- команди) + item_points + рівень + джин (gearRules.registrationScore).
-- Старі заявки без item_points і далі рахуються таблицею з колонок анкети
-- (0017–0026) — ті колонки й CHECK «усі або жодна» (0018) не чіпаються.
--
--   item_points    — бали за речі, 2 знаки (0..2000 — стеля з запасом над
--                    maxGearScoreOf);
--   item_breakdown — розклад: {"v":1,"ver":"balance-v1.x","sum":{…},
--                    "rows":[[cfg,слот,id каталогу,бали,"чому"],…],"warn":[…]}
--                    до 2 КБ (клієнт тримає ≤ 2000 Б; назв речей тут немає —
--                    їх підставляє каталог ляльки в адмінці й на сторінці
--                    персонажа).
--
-- Колонки необов'язкові: їх пише лише заявка персонажем (наступна викладка),
-- адмін перераховує зі знімка (update-політика 0006). Звичайна анкета й
-- team-рядки жеребки їх не пишуть. Виконати ДО викладки фронта, що їх пише.
--
-- Політика публічної заявки (тіло — 0027 + одна умова): у балансному
-- фул-рандомі заявка мусить нести знімок ляльки (character_snapshot) — саме з
-- нього адмін перевіряє item_points, бо їх рахує клієнт. Без тригера:
-- apply_balanced_teams (0017) вставляє team-рядки без знімка, а адмінські
-- правки старих рядків лишаються як були.
--
-- Рядки стандартного блоку реєстрації (rule_items.reg_block, засіяний 0027,
-- поправлений 0030/0031): «пороги свап-сетів» і «трактат в анкеті» → бали з
-- речей і трактат у кожному сеті. Міняє лише стандартний текст: якщо
-- суперадмін уже переписав рядок у вкладці «Правила», replace нічого не
-- знайде і текст лишиться як є. Знімки правил уже створених турнірів не чіпає.

-- ── (1) registrations: бали за речі й розклад ──
alter table registrations
  add column if not exists item_points numeric(7,2),
  add column if not exists item_breakdown jsonb;

alter table registrations drop constraint if exists registrations_item_points_range;
alter table registrations add constraint registrations_item_points_range
  check (item_points is null or (item_points >= 0 and item_points <= 2000));

alter table registrations drop constraint if exists registrations_item_breakdown_size;
alter table registrations add constraint registrations_item_breakdown_size
  check (item_breakdown is null or (jsonb_typeof(item_breakdown) = 'object' and octet_length(item_breakdown::text) <= 2048));

-- ── (2) публічна заявка на фул-рандом — лише зі знімком ляльки (0027:170-182 + умова) ──
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
        and (t.team_mode <> 'balanced_random' or registrations.character_snapshot is not null)
    )
  );
-- update/delete-політики (0006) не змінюються: адмін перераховує item_points через ті самі.

-- ── (3) rule_items.reg_block: рядки 4 і 5 (старі тексти — після 0030 і з сіду 0027) ──
-- Рядок 4 замінюємо в обох відомих формах: після 0030 і у вигляді сіду 0027 (якщо 0030 пропустили).
update rule_items
set text_player = replace(
  replace(
    replace(
      text_player,
      'ПЗ-сет / ПА-сет / Спів-Аспід рахуються від порогів: сумарний ПЗ ≥ 30, ПА ≥ 30, швидкість атаки ≥ 3.33 уд/с або −30 % часу активації — усе без бафів.',
      'Бали — з речей ляльки: кожна річ, надіта в Головному чи в будь-якому сеті, дає бали один раз (свап-сети — до стелі); свап-зброя — лише за свій ПЗ (до стелі); за головну рахується найдорожча зброя, де б вона не лежала.'
    ),
    'ПЗ-сет / ПА-сет / Спів-сет рахуються від порогів: сумарний ПЗ ≥ 30, ПА ≥ 30, −30 % часу співу — усе без бафів. Окремого аспд-сету немає: швидкість атаки — це Головний сет.',
    'Бали — з речей ляльки: кожна річ, надіта в Головному чи в будь-якому сеті, дає бали один раз (свап-сети — до стелі); свап-зброя — лише за свій ПЗ (до стелі); за головну рахується найдорожча зброя, де б вона не лежала.'
  ),
  'Трактат: в анкеті вказується найкращий, який береш на турнір; свап униз дозволений, угору — ні.',
  'Трактат рахується в кожному сеті, де він надітий; лялька (Головний і всі сети) має відповідати спорядженню в грі — адмін може попросити скріни інвентарю й тултіпів.'
)
where key = 'reg_block';

-- Якщо рядок 4 не замінився (суперадмін переписав текст руками) — сказати про це, а не мовчати.
do $$
begin
  if not exists (select 1 from rule_items where key = 'reg_block' and text_player like '%Бали — з речей ляльки%') then
    raise exception 'reg_block: рядок 4 не замінено — перевір, чи не переписано текст блоку руками; поправ його у вкладці «Правила»';
  end if;
end $$;
