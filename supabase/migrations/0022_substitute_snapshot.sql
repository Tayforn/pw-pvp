-- Заміна гравця оновлює знімок жеребки (tournaments.balance_stats):
-- прибирає вибулого зі складу команди, додає заміну з її скором/tier і
-- перераховує суму. Публічна сторінка й адмінка беруть суми команд саме зі
-- знімка (скори «заморожені» на момент жеребки — Ело дрейфує з кожним
-- результатом), тому без цього після заміни публічна сума лишалась старою.
-- Скор і tier заміни рахує клієнт (шкала балів живе в коді) і передає сюди.
drop function if exists substitute_team_member(uuid, uuid, uuid, text);

create or replace function substitute_team_member(
  p_team_id uuid, p_out_id uuid, p_in_id uuid default null, p_reason text default 'no_show',
  p_in_score int default null, p_in_tier text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  team registrations%rowtype; t tournaments%rowtype; inrow registrations%rowtype;
  teams jsonb; new_teams jsonb := '[]'::jsonb; tm jsonb; members jsonb; out_score int;
begin
  select * into team from registrations where id = p_team_id and kind = 'team';
  if not found then raise exception 'Команду не знайдено'; end if;
  select * into t from tournaments where id = team.tournament_id;
  if not (is_superadmin() or t.created_by = auth.uid()) then raise exception 'Немає прав на цей турнір'; end if;
  if not exists (select 1 from registrations where id = p_out_id and team_registration_id = p_team_id) then
    raise exception 'Гравець не в цій команді';
  end if;
  update registrations set team_registration_id = null, status = 'rejected' where id = p_out_id;
  if p_in_id is not null then
    select * into inrow from registrations r where r.id = p_in_id and r.tournament_id = t.id
      and r.kind = 'player' and r.status = 'confirmed' and r.team_registration_id is null;
    if not found then
      raise exception 'Заміна має бути підтвердженим гравцем цього турніру поза командами';
    end if;
    update registrations set team_registration_id = p_team_id where id = p_in_id;
  end if;
  update registrations
  set member_nicknames = (select array_agg(nickname order by created_at) from registrations where team_registration_id = p_team_id)
  where id = p_team_id;

  -- Знімок: команда шукається за назвою (name у знімку = nickname team-рядка).
  teams := t.balance_stats -> 'teams';
  if teams is not null and jsonb_typeof(teams) = 'array' then
    for tm in select value from jsonb_array_elements(teams) loop
      if tm ->> 'name' = team.nickname then
        select coalesce((m ->> 'score')::int, 0) into out_score
          from jsonb_array_elements(coalesce(tm -> 'members', '[]'::jsonb)) m
          where m ->> 'registrationId' = p_out_id::text;
        members := coalesce(
          (select jsonb_agg(m) from jsonb_array_elements(coalesce(tm -> 'members', '[]'::jsonb)) m
             where m ->> 'registrationId' <> p_out_id::text),
          '[]'::jsonb);
        if p_in_id is not null then
          members := members || jsonb_build_array(jsonb_build_object(
            'registrationId', p_in_id, 'nickname', inrow.nickname, 'charClass', inrow.char_class,
            'score', coalesce(p_in_score, 0), 'tier', coalesce(p_in_tier, 'D')));
        end if;
        tm := tm || jsonb_build_object(
          'members', members,
          'total', coalesce((tm ->> 'total')::int, 0) - coalesce(out_score, 0) + coalesce(p_in_score, 0));
      end if;
      new_teams := new_teams || jsonb_build_array(tm);
    end loop;
  end if;

  update tournaments
  set balance_stats = coalesce(balance_stats, '{}'::jsonb)
        || jsonb_build_object('substitutions',
             coalesce(balance_stats -> 'substitutions', '[]'::jsonb)
             || jsonb_build_object('teamId', p_team_id, 'out', p_out_id, 'in', p_in_id, 'reason', p_reason, 'at', now()))
        || case when teams is not null and jsonb_typeof(teams) = 'array' then jsonb_build_object('teams', new_teams) else '{}'::jsonb end,
      updated_at = now()
  where id = t.id;
end;
$$;
revoke execute on function substitute_team_member(uuid, uuid, uuid, text, int, text) from public, anon;
grant execute on function substitute_team_member(uuid, uuid, uuid, text, int, text) to authenticated;
