// =========================================================
// Стандартні правила турнірів за розміром команди (teamSize) — той самий
// показник, що вже є в tournaments.team_size (null/1 = 1х1, 2 = 2х2, тощо) —
// і за способом формування команд (teamMode): для балансного фул-рандому
// попереду йде окрема секція про реєстрацію, анкету, склади й резерв.
// Використовується і публічною сторінкою "Правила", і кнопкою швидкої
// вставки в редакторі турніру.
// =========================================================

import type { TeamMode } from './types';

export interface RuleSection {
  title: string;
  points: string[];
}

// Правила однакові для всіх форматів (1х1, 2х2, 3х3 і т.д.).
const COMMON_POINTS: string[] = [
  'Без 3 ци.',
  'Селфі — дозволені.',
  'Вся аптека — дозволена.',
  'Дозволено до 15 секунд кайта / імуна.',
];

const SOLO: RuleSection = {
  title: '1х1',
  points: COMMON_POINTS,
};

const TEAM_2: RuleSection = {
  title: '2х2',
  points: COMMON_POINTS,
};

const TEAM_BIG: RuleSection = {
  title: '3х3, 5х5, 6х6, 10х10',
  points: COMMON_POINTS,
};

/** Командний турнір з індивідуальною реєстрацією — команди формує система (docs/balanced-random-analysis.md §3.3). */
const BALANCED_RANDOM: RuleSection = {
  title: 'Балансний фул-рандом (командний)',
  points: [
    'Ти не обираєш собі команду — команди формує система випадково після закриття реєстрації, вирівнюючи спорядження і класи.',
    'Реєстрація індивідуальна: один персонаж — одна заявка. Заявки на кількох персонажів або від одного гравця під різними ніками відхиляються.',
    'Анкета спорядження заповнюється чесно — адмін перевіряє спорядження в грі. Неправдиві дані — дискваліфікація, місце займає гравець із резерву.',
    'ПЗ-сет / ПА-сет / Спів-Аспід рахуються від порогів: сумарний ПЗ ≥ 30, ПА ≥ 30, швидкість атаки ≥ 3.33 уд/с або −30 % часу активації — усе без бафів.',
    'Трактат: в анкеті вказується найкращий, який береш на турнір; свап униз дозволений, угору — ні.',
    'Склади команд публікуються на сторінці турніру і не змінюються на прохання гравців. Заміни робить лише адмін — у разі неявки або дискваліфікації.',
    "Гравці, які не потрапили в команди через кількість (останні за часом реєстрації), утворюють резерв і заміняють тих, хто не з'явився на старт.",
    'Бойові обмеження — як для формату відповідного розміру команди.',
  ],
};

export const RULE_SECTIONS: RuleSection[] = [SOLO, TEAM_2, TEAM_BIG, BALANCED_RANDOM];

/** Секція за розміром команди (null/1 = одноосібний 1х1); null — для розміру без стандартних правил. */
function sizeSectionFor(teamSize: number | null): RuleSection | null {
  if (!teamSize || teamSize === 1) return SOLO;
  if (teamSize === 2) return TEAM_2;
  return [3, 5, 6, 10].includes(teamSize) ? TEAM_BIG : null;
}

/** Правила для конкретного формату турніру — текст для вставки у вільне
 * поле "Правила". Для фул-рандому: спершу пункти про реєстрацію/анкету/резерв,
 * далі бойові обмеження формату відповідного розміру (якщо є). «Без правил.»
 * великих форматів не дописуємо — після пункту «бойові обмеження — як для
 * формату…» він лише плутає. */
export function standardRulesFor(teamSize: number | null, teamMode: TeamMode = 'fixed'): string | null {
  const size = sizeSectionFor(teamSize);
  let points: string[];
  if (teamMode === 'balanced_random') {
    points = [...BALANCED_RANDOM.points, ...(size && size !== TEAM_BIG ? size.points : [])];
  } else {
    if (!size) return null;
    points = size.points;
  }
  return points.map((p) => `• ${p}`).join('\n');
}

export function standardRulesLabel(teamSize: number | null, teamMode: TeamMode = 'fixed'): string {
  const n = !teamSize || teamSize === 1 ? 1 : teamSize;
  const sizeLabel = `${n}х${n}`;
  return teamMode === 'balanced_random' ? `фул-рандом ${sizeLabel}` : sizeLabel;
}
