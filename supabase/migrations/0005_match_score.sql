-- Рахунок матчу (напр. "2-1") — потрібен для форматів, відмінних від bo1,
-- де перемога сама по собі не визначає рахунок серії.
alter table bracket_matches add column if not exists score text;
