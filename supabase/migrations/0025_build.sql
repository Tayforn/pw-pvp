-- Анкета фул-рандому: збірка персонажа (ДД / гібрид / кон).
--
-- Гір-скор від збірки не залежить (шмот той самий), але рольовий шар
-- формування команд (balance.ts, teams-ls-v2) множить «урон» гравця на
-- коефіцієнт збірки з версії шкали (balance.composition.buildKill):
-- кон-Сін у топ-шмоті не вбиває, тож пачці з ним потрібна друга загроза.
--
-- Колонка не входить у registrations_gear_all_or_none: анкети, подані
-- раніше, лишаються валідними з build = null (рахується як ДД). Нова
-- анкета без збірки не подається — перевіряє форма. Виконати ДО викладки
-- фронта, що пише цю колонку.

alter table registrations
  add column if not exists build text;

alter table registrations drop constraint if exists registrations_build_check;
alter table registrations add constraint registrations_build_check check (
  build is null or build in ('dd', 'hybrid', 'con')
);
