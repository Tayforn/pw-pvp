-- Командні турніри: якщо team_size задано (>=2), турнір командний —
-- реєстрація вимагає назву команди (nickname) + список нікнеймів учасників.
alter table tournaments add column if not exists team_size int check (team_size is null or team_size >= 2);
alter table registrations add column if not exists member_nicknames text[];
