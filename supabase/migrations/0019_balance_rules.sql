-- Шкала балів балансного фул-рандому, редагована з адмінки.
--
-- Версії НЕЗМІННІ: адмін не править рядок, а зберігає нову версію (insert),
-- бо турнір при формуванні команд фіксує tournaments.balance_rules_version і
-- має рахуватись тими самими балами й через місяць (спека §26). Поточна
-- версія для нових турнірів — найновіша за created_at; вбудована
-- 'balance-v1.0' живе в коді (src/data/gearRules.ts) і завжди є фолбеком.
create table if not exists balance_rules (
  version text primary key,          -- напр. 'balance-v1.1'
  rules jsonb not null,              -- GearRules (src/data/gearRules.ts): таблиці балів + пороги tier + параметри алгоритму
  note text,                         -- що змінилось (для журналу в адмінці)
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

alter table balance_rules enable row level security;
-- читають усі: публічна сторінка турніру рахує суми гіру команд за версією турніру
create policy balance_rules_select on balance_rules for select using (true);
-- створює лише суперадмін; update/delete політик немає — версії незмінні
create policy balance_rules_insert on balance_rules for insert with check (is_superadmin());

-- живі оновлення (інший адмін зберіг версію — форма підхопить без перезавантаження)
alter publication supabase_realtime add table balance_rules;
