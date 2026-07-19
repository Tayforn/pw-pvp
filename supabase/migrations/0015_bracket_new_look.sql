-- Перемикач вигляду сітки single_elim (дзеркальна vs колонки по раундах,
-- див. src/components/BracketView.tsx) — окремо на кожен турнір, за
-- замовчуванням true (новий вигляд), щоб не міняти поведінку вже існуючих
-- турнірів заднім числом.
alter table tournaments add column if not exists bracket_new_look boolean not null default true;
