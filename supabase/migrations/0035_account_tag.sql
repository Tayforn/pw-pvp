-- =========================================================
-- 0035: одна жива заявка з Discord-акаунта на турнір (рішення власника 01.10.2026).
--
-- Бекенд (pw-ladder, POST /api/pvp/registrations) пише в нову колонку account_tag
-- мітку акаунта: HMAC(турнір, гравець ладдера) секретом сервера. З мітки не видно,
-- хто це, і між турнірами вона різна. Частковий унікальний індекс не пускає другу
-- живу (не відхилену) заявку з тим самим account_tag на турнір — правило тримає
-- сама база: і при одночасних запитах, і коли insert завершився вже після тайм-ауту
-- бекенда, і коли адмін повертає відхилену заявку, а в акаунта вже є нова (23505).
-- Перерахунок скору адміном пише лише item_points / item_breakdown — колонку не чіпає.
-- Публічний (anon) insert account_tag не ставить: лише бекенд (service_role минає RLS).
-- Гість без входу через Discord мітки не має — його дублі, як і раніше, звіряє адмін.
--
-- Порядок: спершу ця міграція, потім бекенд, що пише account_tag (без колонки він
-- відмовляв би в заявках). Ідемпотентна. Нова колонка порожня — індекс створюється
-- без конфліктів.
--
-- Аварійно відкрити прямий insert на фул-рандом ПІСЛЯ цієї міграції (бекенд заявок
-- зламався): НЕ відкат із 0034 (там немає «account_tag is null» — anon зміг би
-- підставити чужу мітку й заблокувати гравця), а політику нижче без рядка
-- «and t.team_mode <> 'balanced_random'» плюс умови 0032 про знімок для фул-рандому.
--
-- Відкат (спершу повернути бекенд на попередню збірку — /srv/ladder-api/index.mjs.prev;
-- політика — як у 0034, бо колонку з політики треба прибрати до її видалення):
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
--           and t.team_mode <> 'balanced_random'
--       )
--     );
--   drop index if exists registrations_tournament_account_uidx;
--   alter table registrations drop constraint if exists registrations_account_tag_len;
--   alter table registrations drop column if exists account_tag;
-- =========================================================

alter table registrations add column if not exists account_tag text;

alter table registrations drop constraint if exists registrations_account_tag_len;
alter table registrations add constraint registrations_account_tag_len
  check (account_tag is null or char_length(account_tag) between 8 and 64);

create unique index if not exists registrations_tournament_account_uidx
  on registrations (tournament_id, account_tag)
  where account_tag is not null and status <> 'rejected';

-- Публічний insert — як у 0034, плюс: мітку акаунта ставить лише бекенд.
drop policy if exists registrations_insert_public on registrations;
create policy registrations_insert_public on registrations for insert
  with check (
    kind = 'player' and team_registration_id is null and status = 'pending'
    and rules_ack
    and character_id is null
    and account_tag is null
    and exists (
      select 1 from tournaments t
      where t.id = registrations.tournament_id
        and t.status = 'registration_open'
        and t.event_date >= current_date
        and t.team_mode <> 'balanced_random'
    )
  );
