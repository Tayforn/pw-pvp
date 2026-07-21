-- Автозакриття реєстрації для турнірів, що стали "минулими": event_date вже
-- пройшла, а статус ще 'registration_open' (адмін забув закрити вручну).
-- Заявки на такі турніри й так блокуються на рівні RLS (0010_registration_open_check),
-- але сам статус лишався застарілим — беджі на /tournaments, /t/:id та в
-- адмінці показували "Реєстрація відкрита" для турнірів, що вже минули.
create or replace function close_past_tournament_registrations() returns void
language sql security definer set search_path = public as $$
  update tournaments
  set status = 'registration_closed'
  where status = 'registration_open'
    and event_date < current_date;
$$;

-- Той самий інтервал, що й create-due-series-tournaments (0014) — окреме
-- ім'я джоба, щоб cron.schedule не перезаписав існуючий.
select cron.schedule('close-past-tournament-registrations', '0 */2 * * *', 'select close_past_tournament_registrations();');
