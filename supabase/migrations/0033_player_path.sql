-- Шлях гравця: причина відхилення заявки й повторна подача після відхилення.
--
--   (1) registrations.reject_reason — причина, яку адмін (необовʼязково)
--       вказує при відхиленні (RegistrationsPanel); гравець бачить її у статусі
--       заявки («Мої заявки», сторінка заявки й банер на сторінці турніру).
--       До 200 символів; null — без причини. Пише адмін update-політикою 0006
--       (власник турніру / суперадмін), публічне читання — як у всієї таблиці.
--   (2) Унікальний індекс «один нік — одна заявка на турнір» стає частковим:
--       відхилена заявка (status = 'rejected') більше не блокує повторну подачу
--       з тим самим ніком. Імʼя індексу те саме (registrations_tournament_nickname_uidx) —
--       за ним сайт впізнає дубль («уже зареєстрований»). Вибулий після заміни
--       (substitute_team_member, 0022) теж має status = 'rejected' — його нік
--       так само звільняється, але реєстрація на той час уже закрита.
--
-- Обидві операції ідемпотентні (повторний запуск нічого не ламає). Сайт працює
-- й до цієї міграції: reject_reason читається як null, причина при відхиленні
-- не зберігається (адмін бачить попередження), а повторна подача з тим самим
-- ніком падає на дублі — гравцю пояснюємо, що адмін має видалити відхилену заявку.
--
-- Якщо (2) впаде на «could not create unique index» — на якомусь турнірі вже є
-- дві не відхилені заявки з однаковим ніком (руками в базі): спершу знайдіть їх
--   select tournament_id, kind, lower(nickname), count(*) from registrations
--   where status <> 'rejected' group by 1, 2, 3 having count(*) > 1;

-- ── (1) причина відхилення ──
alter table registrations add column if not exists reject_reason text;

alter table registrations drop constraint if exists registrations_reject_reason_len;
alter table registrations add constraint registrations_reject_reason_len
  check (reject_reason is null or char_length(reject_reason) <= 200);

-- ── (2) частковий унікальний індекс (форма — як у 0017, плюс where) ──
drop index if exists registrations_tournament_nickname_uidx;
create unique index registrations_tournament_nickname_uidx
  on registrations (tournament_id, kind, lower(nickname))
  where status <> 'rejected';
