-- Заявки на балансний фул-рандом — лише через бекенд (pw-ladder, POST
-- /api/pvp/registrations): скор заявки (item_points, item_breakdown з
-- checked/server) рахує й записує сервер service-ключем, а не браузер гравця.
--
-- ВИКОНУВАТИ ТІЛЬКИ ПІСЛЯ ПЕРЕВІРКИ, ЩО ЗАЯВКИ ЧЕРЕЗ БЕКЕНД ПРОХОДЯТЬ:
--   1) на сервері в /etc/ladder-api/env задано PVP_SUPABASE_URL і
--      PVP_SUPABASE_SERVICE_KEY, бекенд перезібрано й задеплоєно, перезапущено;
--   2) тестова заявка на відкритий фул-рандом подалась із сайту, і в її
--      item_breakdown є "server": true (select item_breakdown->>'server' from
--      registrations order by created_at desc limit 1).
-- До цього сайт подає заявку напряму (запасний шлях RegisterPage — коли бекенд
-- відповідає 503/502/недоступний); після міграції прямий insert на фул-рандом
-- відхилить RLS, тож без працюючого бекенда заявки на фул-рандом зупиняться.
--
-- Що змінюється в публічному insert (anon/authenticated, політика 0032):
--   (1) турніри з team_mode = 'balanced_random' — заборонено: такі заявки пише
--       лише бекенд. service_role RLS минає й сам перевіряє те саме: турнір
--       відкритий, дата не минула, правила підтверджено, kind = 'player',
--       status = 'pending'.
--   (2) character_id is null: рядок із character_id (заявка своїм збереженим
--       персонажем) теж пише лише бекенд — він перевіряє, що персонаж належить
--       гравцю з Discord-сесією, і що в персонажа одна жива заявка на турнір.
--       Без цієї умови анонімний ключ (він є в бандлі сайту) дозволяв вставити
--       заявку з чужим character_id (його видно в публічних заявках): «Мої
--       заявки» й сторінка заявки впізнають свою заявку за character_id, тож
--       чужа «висіла» б у гравця як його, а бекенд відмовляв би йому в заявці
--       цим персонажем (already_registered).
--       Прямий insert сайту character_id не передає (перевірено в коді
--       01.10.2026): на звичайні турніри й готові команди персонажа взагалі не
--       вибрати (select персонажа в RegisterPage — лише для фул-рандому, вибір
--       скидається при зміні турніру), а submitRegistration (src/data/
--       tournaments.ts) пише character_id: null і для запасного шляху фул-рандому
--       — свій персонаж іде на бекенд за characterId. Тож умова нинішніх заявок
--       не зачіпає. Якщо колись на звичайний турнір захочеться подавати
--       персонажем — теж через бекенд.
-- Team-рядки жеребки (apply_balanced_teams, security definer), заміна
-- (substitute_team_member, security definer) і update/delete адміна (0006) не
-- чіпаються. Уже записані рядки політика insert не перевіряє.
--
-- Після міграції 0035 цей відкат не використовувати — див. «Аварійно відкрити прямий
-- insert» у шапці 0035 (тут немає умови account_tag is null).
-- Відкат (повернути прямий insert на фул-рандом, коли бекенд заявок зламався) —
-- політика з 0032 плюс умова (2) character_id is null: запасний шлях сайту
-- character_id не пише, а захист від чужого character_id лишається. Якщо на
-- pvp.thunderpw.fun задеплоєно сайт, у якому запасний шлях ще пише character_id
-- свого персонажа (до правки шляху гравця 01.10.2026), рядок «and character_id
-- is null» з відкату приберіть — тоді це рівно політика 0032.
--   drop policy if exists registrations_insert_public on registrations;
--   create policy registrations_insert_public on registrations for insert
--     with check (
--       kind = 'player' and team_registration_id is null and status = 'pending'
--       and rules_ack
--       and character_id is null
--       and exists (
--         select 1 from tournaments t
--         where t.id = registrations.tournament_id
--           and t.status = 'registration_open'
--           and t.event_date >= current_date
--           and (t.team_mode <> 'balanced_random' or registrations.char_class is not null)
--           and (t.team_mode <> 'balanced_random' or registrations.character_snapshot is not null)
--       )
--     );

drop policy if exists registrations_insert_public on registrations;
create policy registrations_insert_public on registrations for insert
  with check (
    kind = 'player' and team_registration_id is null and status = 'pending'
    and rules_ack
    -- персонажем (character_id) — лише бекенд: він перевіряє, чий персонаж
    and character_id is null
    and exists (
      select 1 from tournaments t
      where t.id = registrations.tournament_id
        and t.status = 'registration_open'
        and t.event_date >= current_date
        -- фул-рандом — лише бекенд (service_role минає RLS)
        and t.team_mode <> 'balanced_random'
    )
  );
