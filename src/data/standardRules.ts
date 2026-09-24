// =========================================================
// Стандартні правила турнірів — тонка обгортка над довідником рядків
// (ruleCatalog.ts, 0027): секції публічної сторінки «Правила» і текст для
// вставки в textarea старого турніру будуються з дефолтів довідника за
// форматом, тим самим рендерером, що й попап «Правила…» — тому сторінка і
// попап ніколи не розходяться. Без довідника з БД працюють вбудовані рядки.
//
// Формат — той самий показник, що в tournaments.team_size (null/1 = 1х1,
// 2+ = командний) і team_mode (готові команди / балансний фул-рандом).
// Раніше для фул-рандому 3х3+ бойові пункти не вставлялись (дефект старого
// шаблону) — тепер рядки «Бій» є для всіх форматів.
// =========================================================

import type { TeamMode } from './types';
import { BUILTIN_RULE_ITEMS, defaultFlagsFor, renderRulesMd, renderRulesPoints, type RuleItem } from './ruleCatalog';

export interface RuleSection {
  title: string;
  points: string[];
}

/** Три секції публічної сторінки: 1х1 · готові команди (2х2 і більше) ·
 * балансний фул-рандом — з дефолтів довідника за трьома форматами. */
export function ruleSectionsFor(items: RuleItem[] = BUILTIN_RULE_ITEMS): RuleSection[] {
  return [
    { title: '1х1', points: renderRulesPoints(defaultFlagsFor(items, null, 'fixed')) },
    { title: 'Командні турніри — готові команди (2х2 і більше)', points: renderRulesPoints(defaultFlagsFor(items, 2, 'fixed')) },
    { title: 'Балансний фул-рандом (командний)', points: renderRulesPoints(defaultFlagsFor(items, 3, 'balanced_random')) },
  ];
}

/** Секції з вбудованого довідника — для сумісності; сторінка «Правила» бере
 * ruleSectionsFor(items) із завантаженим довідником. */
export const RULE_SECTIONS: RuleSection[] = ruleSectionsFor();

/** Текст правил для формату турніру (перший рядок — формат, далі «• пункт») —
 * для вставки у вільне поле «Правила» старого турніру. */
export function standardRulesFor(teamSize: number | null, teamMode: TeamMode = 'fixed', items: RuleItem[] = BUILTIN_RULE_ITEMS): string {
  return renderRulesMd(defaultFlagsFor(items, teamSize, teamMode), teamSize, teamMode);
}

export function standardRulesLabel(teamSize: number | null, teamMode: TeamMode = 'fixed'): string {
  const n = !teamSize || teamSize === 1 ? 1 : teamSize;
  const sizeLabel = `${n}х${n}`;
  return teamMode === 'balanced_random' ? `фул-рандом ${sizeLabel}` : sizeLabel;
}
