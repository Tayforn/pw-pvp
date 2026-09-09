-- Ручна корекція скору гравця адміном (± бали з причиною): єдиний спосіб
-- урахувати скіл, поки немає історії матчів. У бали команди й у жеребку входить.
--
-- Окрема таблиця, а не колонки в registrations: registrations читається
-- публічно (registrations_select using(true), 0001), а примітка адміна
-- («слабкий у ПвП», «підозра на …») гравцям бачитись не має. Тут RLS —
-- лише адміни: суперадмін усе, ГМ — свої турніри (як registrations_admin_write
-- у 0006). Анонімний select повертає порожньо, тож публічні сторінки нічого
-- не бачать.
create table if not exists registration_adjustments (
  registration_id uuid primary key references registrations(id) on delete cascade,
  tournament_id uuid not null references tournaments(id) on delete cascade,
  score_adjust int not null default 0 check (score_adjust between -100 and 100),
  note text check (note is null or char_length(note) <= 200),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create index if not exists registration_adjustments_tournament_idx on registration_adjustments (tournament_id);

alter table registration_adjustments enable row level security;

drop policy if exists registration_adjustments_admin on registration_adjustments;
create policy registration_adjustments_admin on registration_adjustments for all
  using (
    is_superadmin()
    or exists (select 1 from tournaments t where t.id = registration_adjustments.tournament_id and t.created_by = auth.uid())
  )
  with check (
    is_superadmin()
    or exists (select 1 from tournaments t where t.id = registration_adjustments.tournament_id and t.created_by = auth.uid())
  );

-- Хто і коли міняв — проставляє БД, клієнту довіряти не треба.
create or replace function registration_adjustments_stamp() returns trigger
language plpgsql as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists registration_adjustments_stamp on registration_adjustments;
create trigger registration_adjustments_stamp
  before insert or update on registration_adjustments
  for each row execute function registration_adjustments_stamp();
