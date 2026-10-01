// =========================================================
// «Шкала балів» → «Перевірка чернетки»: контрольні архетипи, щоб одразу бачити,
// куди зсунуться tier після правки.
//  • V2_ARCHETYPES — за скором v2 «від речей» (src/doll/model/itemScore.ts):
//    та сама арифметика, але без каталогу ляльки (адмінка чанк ляльки не
//    вантажить), тож камені — одним класом у всіх гніздах, а шолом і накидка
//    без ШГ/Вознєса — з точкою броні. Орієнтир для порогів tier, не заявка.
//  • TABLE_ARCHETYPES — табличний скор старих заявок (computeGearScoreWith);
//    заявки персонажем так не рахуються.
// =========================================================

import type { ArmorRefine, ArmorSet, CharClass, CharLevel, Genie, PlayerGear, RingGrade, Tract, WeaponGrade, WeaponRefine } from '../../data/types';
import { classPointsFor, weaponGradeScore, type GemClass, type ScoringRules } from '../../data/gearRules';

export interface V2Archetype {
  name: string;
  cls: CharClass;
  level: CharLevel;
  /** головна зброя: грейд, точка, абілка (код ac з каталогу) */
  weapon: { grade: WeaponGrade; refine: WeaponRefine; abil?: string };
  /** 4 речі броні (наручі, нагрудник, поножі, взуття) одним грейдом і точкою; ту саму точку мають шолом і накидка без ШГ/Вознєса */
  armor: { grade: ArmorSet; refine: ArmorRefine };
  /** клас каменя в усіх 30 гніздах (зброя 2, броня й збірник 7 × 4); null — без каменів */
  gem: GemClass | null;
  /** точка ШГ / Вознєса; null — речі немає */
  shg: number | null;
  voznes: number | null;
  /** надіті кільця (рахуються два найкращі) */
  rings: { grade: RingGrade; refine: number }[];
  tract: Tract;
  genie: Genie;
  /** свап-сети: речі броні кожного, яких немає в Головному (разом — під стелю swapTotalCap) */
  sets: { pieces: number; grade: ArmorSet; refine: ArmorRefine; gem: GemClass | null }[];
  /** ПЗ усіх свап-зброй разом (до стелі weaponPzCap) */
  swapPz: number;
}

export const V2_ARCHETYPES: V2Archetype[] = [
  {
    name: 'Топ (сін): R9R2 +12 з «Уничтоженный пруд» і Лагерями, 4 речі R8R +12 з Лагерями, ШГ +12, Вознєс +12, 2 кільця R9R1 +12, Імператор, джин 100, рівень 105; ПЗ-сет Нірвана +8 з Лагерями, свап-зброя 24 ПЗ',
    cls: 'assassin', level: 'l105', weapon: { grade: 'r9r2', refine: 'w12', abil: 'ka' }, armor: { grade: 'r8r', refine: 'a12' }, gem: 'campPz', shg: 12, voznes: 12,
    rings: [{ grade: 'r9r1', refine: 12 }, { grade: 'r9r1', refine: 12 }], tract: 'emperor', genie: 'g100',
    sets: [{ pieces: 4, grade: 'nirvana', refine: 'a8', gem: 'campPz' }], swapPz: 24,
  },
  {
    name: 'Сильний (лук): R9R1 +11 з «Уничтоженный пруд», R8R +10, ПА-камені, ШГ +8, 2 кільця R9, Гегемонія, джин 100, рівень 104; ПЗ-сет Нірвана +6 з Лагерями, свап-зброя 12 ПЗ',
    cls: 'archer', level: 'l104', weapon: { grade: 'r9r1', refine: 'w11', abil: 'ka' }, armor: { grade: 'r8r', refine: 'a10' }, gem: 'topPa', shg: 8, voznes: null,
    rings: [{ grade: 'r9', refine: 0 }, { grade: 'r9', refine: 0 }], tract: 't8', genie: 'g100',
    sets: [{ pieces: 4, grade: 'nirvana', refine: 'a6', gem: 'campPz' }], swapPz: 12,
  },
  {
    name: 'Типовий (маг): ЦГД +10, R8R +10, камені 12 рів., кільце Срібний місяць, трактат 7, джин 81–90, рівень 103',
    cls: 'wizard', level: 'l103', weapon: { grade: 'cgd', refine: 'w10' }, armor: { grade: 'r8r', refine: 'a10' }, gem: 'g12', shg: null, voznes: null,
    rings: [{ grade: 'silver', refine: 0 }], tract: 't7', genie: 'g81_90', sets: [], swapPz: 0,
  },
  {
    name: 'Середній (прист): R8R +10, Нірвана +8, камені 10 рів., 2 кільця ПКС, трактат 6, джин до 60, рівень 101; свап-зброя 15 ПЗ',
    cls: 'cleric', level: 'l101', weapon: { grade: 'r8r', refine: 'w10' }, armor: { grade: 'nirvana', refine: 'a8' }, gem: 'g10', shg: null, voznes: null,
    rings: [{ grade: 'pks', refine: 0 }, { grade: 'pks', refine: 0 }], tract: 't6', genie: 'g60', sets: [], swapPz: 15,
  },
  {
    name: 'Слабкий (танк): Нірвана +8, Нірвана +7, без каменів, кільця Луна, трактат 4–5, джин до 60, рівень 90–100',
    cls: 'barbarian', level: 'l90_100', weapon: { grade: 'nirvana', refine: 'w8_9' }, armor: { grade: 'nirvana', refine: 'a7' }, gem: null, shg: null, voznes: null,
    rings: [], tract: 't4_5', genie: 'g60', sets: [], swapPz: 0,
  },
];

/** Бали за один камінь — як gemPoints в itemScore.ts: ПЗ/ПА-камені за курсом u
 * (бал за камінь на +1 ПЗ) × одиниці каменя (Лагеря +2 → 2u, інші ПЗ/ПА → u),
 * решта — за рівнем із doll.gemPoints. */
function gemPointsOf(k: GemClass | null, r: ScoringRules): number {
  if (!k) return 0;
  const u = r.doll.gemPoints.pz1;
  if (k === 'campPz') return 2 * u;
  if (k === 'pz1' || k === 'topPa') return u;
  return r.doll.gemPoints[k];
}

/** Скор архетипу за v2 для команди такого розміру (ціле, як registrationScore). */
export function v2ArchetypeScore(a: V2Archetype, r: ScoringRules, teamSize: number): number {
  const g = gemPointsOf(a.gem, r);
  const abil = a.weapon.abil ? Math.max(0, r.abilityPoints[a.weapon.abil] ?? 0) : 0;
  const weapon = weaponGradeScore(a.cls, a.weapon.grade, r) + r.weaponRefine[a.weapon.refine] + abil + 2 * g;
  const pieceRefine = r.armorRefine[a.armor.refine] / 6;
  // наручі, нагрудник, поножі, взуття: чверть сету + шоста точки + 4 камені кожна
  const armor = r.armorSet[a.armor.grade] + 4 * pieceRefine + 16 * g;
  // шолом і накидка: ШГ/Вознєс — своя таблиця за точку, інакше шоста точки броні; збірник — лише камені
  const head = a.shg == null ? pieceRefine : r.shg + r.shgRefinePerLevel * a.shg;
  const cape = a.voznes == null ? pieceRefine : r.voznes + r.voznesRefinePerLevel * a.voznes;
  const pair = a.shg != null && a.voznes != null ? r.shgVoznesBonus : 0;
  const rest = 12 * g;
  const rings = a.rings
    .map((x) => r.rings[x.grade] + (x.grade === 'r9r1' ? r.ringRefinePerLevel * x.refine : 0))
    .sort((x, y) => y - x)
    .slice(0, 2)
    .reduce((s, x) => s + x, 0);
  const setsRaw = a.sets.reduce((s, set) => s + set.pieces * (r.armorSet[set.grade] / 4 + r.armorRefine[set.refine] / 6 + 4 * gemPointsOf(set.gem, r)), 0);
  const sets = r.swapTotalCap == null ? setsRaw : Math.min(r.swapTotalCap, setsRaw);
  const swap = Math.min(r.weaponPzCap, a.swapPz * r.doll.gemPoints.pz1);
  const items = weapon + armor + head + cape + rest + pair + rings + r.tract[a.tract] + sets + swap;
  return Math.round(classPointsFor(r, a.cls, teamSize) + items + r.level[a.level] + r.genie[a.genie]);
}

/** Табличні архетипи (анкета старих заявок) — рахуються computeGearScoreWith. */
export const TABLE_ARCHETYPES: { name: string; gear: PlayerGear }[] = [
  { name: 'Топ (сін): R9R2 +12, R8R +12, Лагеря, всі сети з Лагерями, Імператор, джин 100/100', gear: { charClass: 'assassin', charLevel: 'l90_100', build: 'dd', weaponGrade: 'r9r2', weaponRefine: 'w12', weaponPz: false, armorSet: 'r8r', armorRefine: 'a12', gems: 'camp', specialSets: ['pz', 'pa', 'aspd'], specialSetGems: { pz: 'camp', pa: 'camp', aspd: 'camp' }, tract: 'emperor', genie: 'g100', shg: false, shgRefine: null, voznes: false, voznesRefine: null, ring1: null, ring1Refine: null, ring2: null, ring2Refine: null } },
  { name: 'Сильний (лук): R9R1 +11, R8R +10, ПА-камні, ПЗ+ПА з ПА-камінням, Гегемонія, джин 100/100', gear: { charClass: 'archer', charLevel: 'l90_100', build: 'dd', weaponGrade: 'r9r1', weaponRefine: 'w11', weaponPz: false, armorSet: 'r8r', armorRefine: 'a10', gems: 'pa', specialSets: ['pz', 'pa'], specialSetGems: { pz: 'pa', pa: 'pa' }, tract: 't8', genie: 'g100', shg: false, shgRefine: null, voznes: false, voznesRefine: null, ring1: null, ring1Refine: null, ring2: null, ring2Refine: null } },
  { name: 'Типовий (маг): ЦГД +10, R8R +10, Сюаньки, ПА-сет із Сюаньками, трактат 7', gear: { charClass: 'wizard', charLevel: 'l90_100', build: 'dd', weaponGrade: 'cgd', weaponRefine: 'w10', weaponPz: false, armorSet: 'r8r', armorRefine: 'a10', gems: 'xuan', specialSets: ['pa'], specialSetGems: { pa: 'xuan' }, tract: 't7', genie: 'g60', shg: false, shgRefine: null, voznes: false, voznesRefine: null, ring1: null, ring1Refine: null, ring2: null, ring2Refine: null } },
  { name: 'Середній (прист): R8R +10 з ПЗ-зброєю, Нірвана/R8R (мікс) +8, камні 10, Спів, трактат 6', gear: { charClass: 'cleric', charLevel: 'l90_100', build: 'dd', weaponGrade: 'r8r', weaponRefine: 'w10', weaponPz: true, armorSet: 'nirvana_r8_mix', armorRefine: 'a8', gems: 'g10', specialSets: ['aspd'], specialSetGems: { aspd: 'g10' }, tract: 't6', genie: 'g60', shg: false, shgRefine: null, voznes: false, voznesRefine: null, ring1: null, ring1Refine: null, ring2: null, ring2Refine: null } },
  { name: 'Слабкий (танк): Нірвана +8 з ПЗ-зброєю, Нірвана +7, трактат 4–5', gear: { charClass: 'barbarian', charLevel: 'l90_100', build: 'dd', weaponGrade: 'nirvana', weaponRefine: 'w8_9', weaponPz: true, armorSet: 'nirvana', armorRefine: 'a7', gems: 'g0_9', specialSets: [], specialSetGems: {}, tract: 't4_5', genie: 'g60', shg: false, shgRefine: null, voznes: false, voznesRefine: null, ring1: null, ring1Refine: null, ring2: null, ring2Refine: null } },
];
