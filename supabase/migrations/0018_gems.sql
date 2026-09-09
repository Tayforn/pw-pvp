-- Анкета балансного фул-рандому: поле «Камні» (камені у броні, до 24 штук),
-- за вартістю по зростанню: рівневі 0–9 / 10 / 11 → Сюаньки → Сюаньки/ПА →
-- ПА → Сюаньки/Лагеря → Лагеря (по 2 ПЗ, до 48 ПЗ). Бали — src/data/gearRules.ts.
alter table registrations add column if not exists gems text
  check (gems in ('g0_9','g10','g11','xuan','xuan_pa','pa','xuan_camp','camp'));

-- Уже подані анкети (0017 без каменів) отримують найнижчий варіант — інакше
-- оновлений constraint «анкета або повна, або відсутня» їх відхилить;
-- адмін може виправити через «✎» у заявках.
update registrations set gems = 'g0_9' where char_class is not null and gems is null;

alter table registrations drop constraint if exists registrations_gear_all_or_none;
alter table registrations add constraint registrations_gear_all_or_none check (
  (char_class is null and weapon_grade is null and weapon_refine is null and weapon_pz is null
     and armor_set is null and armor_refine is null and gems is null and special_sets is null and tract is null and genie is null)
  or
  (char_class is not null and weapon_grade is not null and weapon_refine is not null and weapon_pz is not null
     and armor_set is not null and armor_refine is not null and gems is not null and special_sets is not null and tract is not null and genie is not null)
);
