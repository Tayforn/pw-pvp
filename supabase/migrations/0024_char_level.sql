-- Анкета фул-рандому: рівень персонажа.
--
-- Бали рахуються на читанні (src/data/gearRules.ts, таблиця level; редагується
-- в адмінці «Шкала балів»): 90–100 — 0, 101 — 1, 102 — 2, 103 — 4, 104 — 7, 105 — 10.
--
-- Колонка не входить у registrations_gear_all_or_none: анкети, подані раніше,
-- лишаються валідними з char_level = null (рахується як 90–100). Нова анкета
-- без рівня не подається — це перевіряє форма.
-- Виконати ДО викладки фронта, що пише цю колонку.

alter table registrations
  add column if not exists char_level text;

alter table registrations drop constraint if exists registrations_char_level_check;
alter table registrations add constraint registrations_char_level_check check (
  char_level is null or char_level in ('l90_100', 'l101', 'l102', 'l103', 'l104', 'l105')
);
