// =========================================================
// ЛЯЛЬКА — заявка на турнір персонажем. Форма заявки (RegisterPage) у
// головному бандлі, а ляльці потрібні каталоги й формули — тож цей модуль
// вантажиться динамічно (import()), лише коли гравець обрав персонажа.
// =========================================================

import { currentRulesVersion, rulesFor, tableGearPartWith, type DollRef, type GearRules } from '../data/gearRules';
import { getCharacter, listCharacters, type CharacterRecord, type CharacterSummary } from './api/characters';
import { ensureCats } from './data/catalog';
import { ensureRefData } from './data/refLoader';
import { validateDoc, type CharacterDoc } from './model/doc';
import { docCats } from './model/hydrate';
import { CLS_CHAR, dollFacts, gearFromCharacter, type CharacterGear } from './model/sheet';
import { powerOf } from './model/power';
import type { CharClass, DollPower } from '../data/types';

export type { CharacterSummary };

export interface CharacterForRegistration {
  rec: CharacterRecord;
  doc: CharacterDoc;
  result: CharacterGear;
  /** Чи йдуть свап-сети в бали (перемикач поточної версії шкали). */
  setsFromDoll: boolean;
  /** Атака й живучість — для скору з ляльки. */
  power: DollPower;
}

export function myCharacters(): Promise<CharacterSummary[]> {
  return listCharacters().then((r) => r.characters);
}

/** Завантажити персонажа й зібрати з нього анкету заявки. Кидає Error з поясненням. */
export async function characterForRegistration(id: string): Promise<CharacterForRegistration> {
  const rec = await getCharacter(id);
  const v = validateDoc(rec.doc);
  const doc = v.ok ? v.doc : v.recoverable;
  if (!doc) throw new Error('Документ персонажа пошкоджено — відкрий його на сторінці персонажа й збережи ще раз.');
  await Promise.all([ensureRefData(), ensureCats(docCats(doc))]);
  const rules = rulesFor(currentRulesVersion());
  const setsFromDoll = rules.setsFromDoll;
  const facts = dollFacts(doc, rules);
  const result = gearFromCharacter(doc, facts, { setsFromDoll });
  // Разом із силою в заявку йде склад каменів — адмін бачить його замість рядка таблиці.
  const power = { ...powerOf(doc, { pa: rules.dollScore.oppPa, pz: rules.dollScore.oppPz }), gems: facts.gemCounts };
  return { rec, doc, result, setsFromDoll, power };
}

/**
 * Еталон класу для «Шкали балів» зі збереженого персонажа: атака й живучість
 * (з типовим суперником чернетки шкали) і бали спорядження за таблицею, якщо
 * анкета персонажа повна (інакше base = 0 — адмін впише сам).
 */
export async function referenceFromCharacter(id: string, rules: GearRules): Promise<{ cls: CharClass; ref: DollRef; note: string | null }> {
  const rec = await getCharacter(id);
  const v = validateDoc(rec.doc);
  const doc = v.ok ? v.doc : v.recoverable;
  if (!doc) throw new Error('Документ персонажа пошкоджено.');
  await Promise.all([ensureRefData(), ensureCats(docCats(doc))]);
  const power = powerOf(doc, { pa: rules.dollScore.oppPa, pz: rules.dollScore.oppPz });
  const result = gearFromCharacter(doc, dollFacts(doc, rules), { setsFromDoll: false });
  const base = result.gear ? Math.round(tableGearPartWith(result.gear, rules, 3)) : 0;
  return {
    cls: CLS_CHAR[doc.cls],
    ref: { off: power.off, def: power.def, base, label: rec.name, ...(power.abil ? { abil: power.abil } : {}) },
    note: result.gear ? null : `Анкета персонажа неповна (${result.missing.join(', ')}) — бали еталона впиши вручну.`,
  };
}
