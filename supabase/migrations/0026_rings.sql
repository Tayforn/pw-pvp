-- Анкета фул-рандому: два кільця.
--
-- Грейди за зростанням: moon (Луна і нижче) · pks (ПКС / Долоня) ·
-- silver (Срібний місяць / Північна зірка) · r9 · r9r1. Для R9R1 окремо
-- вказується точка 0–12 (як у ШГ/Вознєса). Бали рахуються на читанні
-- (src/data/gearRules.ts, ringsScore; редагуються в адмінці «Шкала балів»).
--
-- Колонки не входять у registrations_gear_all_or_none: анкети, подані раніше,
-- лишаються валідними з кільцями null (0 балів). Нова анкета без обох кілець
-- не подається — перевіряє форма. Виконати ДО викладки фронта, що пише ці колонки.

alter table registrations
  add column if not exists ring1 text,
  add column if not exists ring1_refine smallint,
  add column if not exists ring2 text,
  add column if not exists ring2_refine smallint;

alter table registrations drop constraint if exists registrations_ring1_check;
alter table registrations add constraint registrations_ring1_check check (
  (ring1 is null or ring1 in ('moon', 'pks', 'silver', 'r9', 'r9r1'))
  and ((ring1 = 'r9r1' and ring1_refine is not null and ring1_refine between 0 and 12)
       or (ring1 is distinct from 'r9r1' and ring1_refine is null))
);
alter table registrations drop constraint if exists registrations_ring2_check;
alter table registrations add constraint registrations_ring2_check check (
  (ring2 is null or ring2 in ('moon', 'pks', 'silver', 'r9', 'r9r1'))
  and ((ring2 = 'r9r1' and ring2_refine is not null and ring2_refine between 0 and 12)
       or (ring2 is distinct from 'r9r1' and ring2_refine is null))
);
