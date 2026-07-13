-- Створення таблиці через SQL Editor НЕ вмикає Realtime автоматично —
-- потрібно явно додати таблицю до публікації supabase_realtime, інакше
-- postgres_changes-підписки (subscribeToEventChanges / subscribeToTournamentChanges)
-- підписуються "успішно", але ніколи не отримують жодної події.
alter publication supabase_realtime add table
  events,
  event_results,
  tournament_series,
  tournaments,
  registrations,
  bracket_matches;
