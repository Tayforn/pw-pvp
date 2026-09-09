-- Уточнення анкети за відгуком гільдії:
--  1. чистий R8 (без рекасту) прибрано з сетів броні — він гірший за Нірвану;
--     наявні анкети з 'r8' переводяться в 'nirvana_r8_mix' (адмін виправить через «✎»);
--  2. джин — шість градацій за рівнем замість «100/100 | 100−»;
--  3. камені окремо в кожному свап-сеті (special_set_gems: {"pz":"pa","aspd":"xuan"});
--  4. бали за ЦГД/РЦГД/R9/R9R1/R9R2 залежать від класу — це в balance_rules
--     (weaponGradeByClass), схема не змінюється.

-- ── 1. сет броні без 'r8' ──
update registrations set armor_set = 'nirvana_r8_mix' where armor_set = 'r8';
alter table registrations drop constraint if exists registrations_armor_set_check;
alter table registrations add constraint registrations_armor_set_check
  check (armor_set in ('other','nirvana','nirvana_r8_mix','r8r','r9'));

-- ── 2. джин за рівнем ──
alter table registrations drop constraint if exists registrations_genie_check;
update registrations set genie = case genie when 'top' then 'g100' when 'lower' then 'g60' else genie end
  where genie in ('top', 'lower');
alter table registrations add constraint registrations_genie_check
  check (genie in ('g60','g61_70','g71_80','g81_90','g91_99','g100'));

-- ── 3. камені у свап-сетах ──
alter table registrations add column if not exists special_set_gems jsonb not null default '{}'::jsonb
  check (jsonb_typeof(special_set_gems) = 'object');
