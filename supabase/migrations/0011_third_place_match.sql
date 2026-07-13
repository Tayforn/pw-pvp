-- Матч за 3-тє місце (лише single_elim): програні півфіналісти грають
-- окремий bracket_matches-рядок з bracket_side='third_place'. Прогрес туди
-- йде тим самим механізмом loser_next_match_id/slot, що вже використовує
-- нижня сітка double_elim (setMatchWinner у src/data/bracket.ts).
alter table tournaments add column if not exists third_place_match boolean not null default false;

alter table bracket_matches drop constraint if exists bracket_matches_bracket_side_check;
alter table bracket_matches add constraint bracket_matches_bracket_side_check
  check (bracket_side in ('winners', 'losers', 'final', 'third_place'));
