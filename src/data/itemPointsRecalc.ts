// =========================================================
// pw-pvp: перерахунок скору v2 заявки зі знімка ляльки в адмінці — спільна
// операція панелей «Заявки» (кнопка «Перерахувати зі знімка», автоматично при
// підтвердженні) і «Команди» («Перерахувати всі зі знімків» перед жеребкою).
// Довіра (спека B3, п. 12): item_points пише клієнт гравця, тож адмінка
// перераховує його зі збереженого character_snapshot за версією шкали турніру
// й пише назад із checked: true. Модуль ляльки (каталоги, формули) вантажиться
// динамічно — лише тут, у головний бандл не йде.
// =========================================================

import { registrationScore, rulesFor } from './gearRules';
import { rulesVersionFor } from './teams';
import { updateRegistrationItemPoints } from './tournaments';
import type { Registration, Tournament } from './types';

const loadDoll = () => import('../doll/recompute');

export interface RecalcOutcome {
  /** Бали за речі до (null — заявка була табличною) й після. */
  prev: number | null;
  next: number;
  /** Скор заявки (клас + речі + рівень + джин) до й після; null — без анкети. */
  prevScore: number | null;
  nextScore: number | null;
  /** Версію турніру не знайдено — рахували поточною. */
  versionNote: string | null;
}

/** Перерахувати можна лише заявку зі знімком ляльки; без нього — старий турнір. */
export function canRecalc(r: Pick<Registration, 'characterSnapshot'>): boolean {
  return r.characterSnapshot != null;
}
export const NO_SNAPSHOT_HINT = 'перерахувати неможливо (старий турнір): у заявці немає знімка ляльки';

/** Перерахувати зі знімка й зберегти (updateRegistrationItemPoints). Помилки —
 * нагору з поясненням: немає/пошкоджено знімок, немає колонок 0032 («спершу
 * виконайте міграцію 0032»), RLS. */
export async function recalcRegistration(r: Registration, t: Pick<Tournament, 'balanceRulesVersion' | 'teamSize'>): Promise<RecalcOutcome> {
  const m = await loadDoll();
  const res = await m.recomputeFromSnapshot(r, { rulesVersion: rulesVersionFor(t), teamSize: t.teamSize });
  await updateRegistrationItemPoints(r.id, res.itemPoints, res.itemBreakdown);
  const rules = rulesFor(res.rulesVersion);
  return {
    prev: r.itemPoints,
    next: res.itemPoints,
    prevScore: registrationScore(r, rules, t.teamSize),
    nextScore: registrationScore({ gear: r.gear, itemPoints: res.itemPoints }, rules, t.teamSize),
    versionNote: res.versionNote,
  };
}

const fmt = (n: number): string => String(Math.round(n * 100) / 100);

/** «Перераховано: бали за речі 268.68 → 270.1 (скор 294 → 296)» /
 * «Перераховано: збігається — 268.68 б. (скор 294)» /
 * «Перераховано: було за таблицею (скор 262) → бали за речі 268.68 (скор 294)». */
export function recalcSummary(o: RecalcOutcome): string {
  const score = (s: number | null) => (s == null ? '—' : String(s));
  let text: string;
  if (o.prev == null) text = `Перераховано: було за таблицею (скор ${score(o.prevScore)}) → бали за речі ${fmt(o.next)} (скор ${score(o.nextScore)})`;
  else if (Math.abs(o.prev - o.next) < 0.005) text = `Перераховано: збігається — ${fmt(o.next)} б. (скор ${score(o.nextScore)})`;
  else text = `Перераховано: бали за речі ${fmt(o.prev)} → ${fmt(o.next)} (скор ${score(o.prevScore)} → ${score(o.nextScore)})`;
  return o.versionNote ? `${text}; ${o.versionNote}` : text;
}
