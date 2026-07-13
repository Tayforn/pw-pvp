-- Дозволяємо кілька переможців на одну появу евента (event_id + occurrence_date):
-- прибираємо унікальність, зроблену в 0001 під "один переможець на дату".
alter table event_results drop constraint if exists event_results_event_id_occurrence_date_key;
