-- Заявка на фул-рандом персонажем із ляльки (pvp.thunderpw.fun/characters).
--
-- Гравець, що увійшов через Discord, обирає свого збереженого персонажа:
-- анкета підставляється з нього, і перед подачею він підтверджує, що лялька
-- актуальна. Тут зберігається, ЯКИМ персонажем подано заявку і ЯКИЙ вигляд
-- він мав у мить подачі — щоб адмін міг звірити анкету з лялькою навіть
-- після того, як гравець її змінить.
--
--   character_id       — id персонажа в базі ладдера (pvp_characters.id);
--   character_rev      — його ревізія на момент подачі;
--   character_snapshot — документ ляльки на момент подачі (до 48 КБ);
--   doll_confirmed_at  — коли гравець підтвердив «дані актуальні».
--
-- Колонки необов'язкові: звичайна анкета без персонажа працює як раніше.
-- Виконати ДО викладки фронта, що їх пише.

alter table registrations
  add column if not exists character_id uuid,
  add column if not exists character_rev int,
  add column if not exists character_snapshot jsonb,
  add column if not exists doll_confirmed_at timestamptz;

alter table registrations drop constraint if exists registrations_character_snapshot_size;
alter table registrations add constraint registrations_character_snapshot_size
  check (character_snapshot is null or octet_length(character_snapshot::text) < 49152);
