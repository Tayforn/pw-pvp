// =========================================================
// ЛЯЛЬКА — заявка на турнір персонажем. Форма заявки (RegisterPage) у
// головному бандлі, а ляльці потрібні каталоги й формули — тож цей модуль
// вантажиться динамічно (import()), лише коли гравець обрав персонажа.
// =========================================================

import { currentRulesVersion, rulesFor } from '../data/gearRules';
import { getCharacter, listCharacters, type CharacterRecord, type CharacterSummary } from './api/characters';
import { ensureCats } from './data/catalog';
import { ensureRefData } from './data/refLoader';
import { validateDoc, type CharacterDoc } from './model/doc';
import { docCats } from './model/hydrate';
import { dollFacts, gearFromCharacter, type CharacterGear } from './model/sheet';

export type { CharacterSummary };

export interface CharacterForRegistration {
  rec: CharacterRecord;
  doc: CharacterDoc;
  result: CharacterGear;
  /** Чи йдуть свап-сети в бали (перемикач поточної версії шкали). */
  setsFromDoll: boolean;
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
  const result = gearFromCharacter(doc, dollFacts(doc, rules), { setsFromDoll });
  return { rec, doc, result, setsFromDoll };
}
