-- Реєстрація дозволена лише поки турнір відкритий для реєстрації і ще не
-- пройшов (event_date не в минулому). Раніше registrations_insert_public
-- пропускала будь-який insert (with check (true)) — це перевірялося лише
-- на клієнті, тож пряме звернення до API могло створити заявку на закритий
-- чи завершений турнір.
drop policy if exists registrations_insert_public on registrations;
create policy registrations_insert_public on registrations for insert
  with check (
    exists (
      select 1 from tournaments t
      where t.id = registrations.tournament_id
        and t.status = 'registration_open'
        and t.event_date >= current_date
    )
  );
