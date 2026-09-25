-- Скор із ляльки (тіньовий режим і далі): «сила» персонажа в мить заявки.
--
-- Браузер гравця рахує з ляльки два числа — атаку й живучість (формули ті
-- самі, що в PW Хелпері; src/doll/model/power.ts) — і кладе їх у заявку разом
-- зі знімком ляльки (0028). Скор із них — проста арифметика з еталонами класів
-- у версії «Шкали балів», тож сторінки турніру й адмінка рахують його без
-- важкої ляльки.
--
--   doll_power = {"off": атака, "def": живучість, "pa": ПА, "pz": ПЗ, "engine": версія формул}
--
-- Необов'язкова колонка: звичайна анкета без персонажа її не пише.
-- Виконати ДО викладки фронта, що її пише.

alter table registrations add column if not exists doll_power jsonb;

alter table registrations drop constraint if exists registrations_doll_power_shape;
alter table registrations add constraint registrations_doll_power_shape check (
  doll_power is null or (
    jsonb_typeof(doll_power) = 'object'
    and jsonb_typeof(doll_power->'off') = 'number' and (doll_power->>'off')::numeric > 0
    and jsonb_typeof(doll_power->'def') = 'number' and (doll_power->>'def')::numeric > 0
    and octet_length(doll_power::text) < 512
  )
);
