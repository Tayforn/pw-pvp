-- Автостворення турнірів для серій з обраним днем тижня. Поле не обов'язкове —
-- auto_weekday = null означає "не створювати автоматично" (звична серія,
-- турніри якої адмін додає вручну, як і раніше).
alter table tournament_series add column if not exists auto_weekday int check (auto_weekday between 0 and 6);
-- 0=неділя..6=субота — та сама конвенція, що й Postgres extract(dow from date).

-- Якщо цей рядок впаде з правами доступу — увімкни pg_cron вручну через
-- Dashboard → Database → Extensions замість цього рядка, решта міграції
-- відпрацює однаково.
create extension if not exists pg_cron;

-- Для кожної активної серії з auto_weekday: рахує найближчу дату (сьогодні
-- або пізніше) з таким днем тижня і, якщо на неї ще немає турніру цієї серії,
-- створює його одразу з status='registration_open'. Тому після того, як
-- дата попереднього турніру минає, наступний з'являється того ж дня —
-- реєстрація на наступну дату лишається відкритою весь час між турнірами.
-- Налаштування (тип сітки/команда/правила/призи) копіюються з останнього
-- (за event_date) турніру серії, якщо такий є; інакше — дефолти.
create or replace function create_due_series_tournaments() returns void
language plpgsql security definer set search_path = public as $$
declare
  s record;
  next_date date;
  tpl record;
begin
  for s in select * from tournament_series where is_active and auto_weekday is not null loop
    next_date := current_date + ((s.auto_weekday - extract(dow from current_date)::int + 7) % 7);

    if not exists (select 1 from tournaments where series_id = s.id and event_date = next_date) then
      select bracket_type, team_size, rules_md, prizes_md, third_place_match
        into tpl
        from tournaments
        where series_id = s.id
        order by event_date desc
        limit 1;

      insert into tournaments (
        series_id, name, event_date, status, rules_md, prizes_md,
        bracket_type, team_size, third_place_match, visibility
      ) values (
        s.id,
        s.name || ' ' || to_char(next_date, 'YYYY-MM-DD'),
        next_date,
        'registration_open',
        tpl.rules_md,
        tpl.prizes_md,
        coalesce(tpl.bracket_type, 'single_elim'),
        tpl.team_size,
        coalesce(tpl.third_place_match, false),
        'public'
      );
    end if;
  end loop;
end;
$$;

select cron.schedule('create-due-series-tournaments', '0 3 * * *', 'select create_due_series_tournaments();');
