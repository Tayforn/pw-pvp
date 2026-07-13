-- ГМ-акаунти: обмежена адмінка, бачить/керує лише СВОЇМИ турнірами.
-- Турніри, створені ГМ-ом, за замовчуванням "unlisted" — не показуються на
-- публічних сторінках (Головна/Турніри/Серії/сайдбар), але лишаються
-- доступними напряму за посиланням (/t/:id, /register?t=:id) — це свідомо
-- НЕ обмежується через RLS (інакше й пряме посилання перестало б працювати
-- для анонімних відвідувачів), а фільтрується на рівні клієнтських запитів
-- для публічних сторінок (fetchPublicTournaments) проти адмінських
-- (fetchAdminTournaments).

alter table admins add column if not exists role text not null default 'gm' check (role in ('superadmin', 'gm'));

-- ВАЖЛИВО: постав себе (і будь-кого, хто вже був адміном до цієї міграції)
-- суперадміном вручну — інакше після цієї міграції старі акаунти стануть ГМ:
--   update admins set role = 'superadmin' where email = 'you@example.com';

alter table tournaments add column if not exists created_by uuid references auth.users(id);
alter table tournaments add column if not exists visibility text not null default 'public' check (visibility in ('public', 'unlisted'));

create or replace function is_superadmin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid() and role = 'superadmin');
$$;

-- tournaments: insert/update/delete лише для is_admin(), але апдейт/видалення
-- чужого турніру (не-суперадміном) заблоковано; insert вимагає created_by = себе.
drop policy if exists tournaments_write on tournaments;
create policy tournaments_insert on tournaments for insert
  with check (is_admin() and (is_superadmin() or created_by = auth.uid()));
create policy tournaments_update on tournaments for update
  using (is_superadmin() or created_by = auth.uid())
  with check (is_superadmin() or created_by = auth.uid());
create policy tournaments_delete on tournaments for delete
  using (is_superadmin() or created_by = auth.uid());

-- bracket_matches / registrations: адмінська зміна дозволена лише
-- суперадміну або власнику турніру, якому належить матч/заявка.
drop policy if exists bracket_matches_write on bracket_matches;
create policy bracket_matches_write on bracket_matches for all
  using (is_superadmin() or exists (select 1 from tournaments t where t.id = bracket_matches.tournament_id and t.created_by = auth.uid()))
  with check (is_superadmin() or exists (select 1 from tournaments t where t.id = bracket_matches.tournament_id and t.created_by = auth.uid()));

drop policy if exists registrations_admin_write on registrations;
create policy registrations_admin_write on registrations for update
  using (is_superadmin() or exists (select 1 from tournaments t where t.id = registrations.tournament_id and t.created_by = auth.uid()))
  with check (is_superadmin() or exists (select 1 from tournaments t where t.id = registrations.tournament_id and t.created_by = auth.uid()));

drop policy if exists registrations_admin_delete on registrations;
create policy registrations_admin_delete on registrations for delete
  using (is_superadmin() or exists (select 1 from tournaments t where t.id = registrations.tournament_id and t.created_by = auth.uid()));

-- Регулярні серії лишаються видимими всім у сайдбарі/на головній — керує
-- ними тільки суперадмін (ГМ-турніри в серії не додаються, вони одноразові).
drop policy if exists tournament_series_write on tournament_series;
create policy tournament_series_write on tournament_series for all using (is_superadmin()) with check (is_superadmin());
