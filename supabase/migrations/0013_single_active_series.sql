-- Спрощення до однієї активної серії (сайт більше не показує вибір серії
-- публічно) — деактивуємо всі серії, крім найстарішої вже активної,
-- і забороняємо мати більш ніж одну активну серію одночасно на рівні БД.

with keep as (
  select id from tournament_series where is_active order by created_at asc limit 1
)
update tournament_series set is_active = false
where is_active and id not in (select id from keep);

-- Частковий унікальний індекс на константному виразі: серед рядків, що
-- проходять WHERE is_active, значення виразу однакове (true) — тож БД
-- дозволить не більше одного такого рядка.
create unique index if not exists tournament_series_single_active
  on tournament_series ((true))
  where is_active;
