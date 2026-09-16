-- Анкета фул-рандому: ШГ і Вознєс — окремі шмотки, кожна з власною точкою.
--
-- Бали рахуються на читанні (src/data/gearRules.ts, shgVoznesScore): ШГ 15 і
-- Вознєс 10 за наявність, +5 якщо є обидві, +1 за кожен рівень точки кожної;
-- значення редагуються в адмінці («Шкала балів») як і решта ваг.
--
-- Колонки не входять у registrations_gear_all_or_none: наявні анкети
-- отримують «немає шмотки» (false / null) і лишаються валідними.
-- Виконати ДО викладки фронта, що пише ці колонки.

alter table registrations
  add column if not exists shg boolean not null default false,
  add column if not exists shg_refine smallint,
  add column if not exists voznes boolean not null default false,
  add column if not exists voznes_refine smallint;

-- Точка є тоді й лише тоді, коли є шмотка; діапазон 0–12.
alter table registrations drop constraint if exists registrations_shg_refine_check;
alter table registrations add constraint registrations_shg_refine_check check (
  (shg and shg_refine is not null and shg_refine between 0 and 12) or (not shg and shg_refine is null)
);
alter table registrations drop constraint if exists registrations_voznes_refine_check;
alter table registrations add constraint registrations_voznes_refine_check check (
  (voznes and voznes_refine is not null and voznes_refine between 0 and 12) or (not voznes and voznes_refine is null)
);
