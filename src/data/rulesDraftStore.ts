// =========================================================
// pw-pvp: ОДНА чернетка версії шкали на дві вкладки адмінки («Шкала балів»
// і «Бафи й склад»). Раніше стан base/draft/dirty жив у useState редактора
// і губився при перемиканні вкладки; тепер це модульний стор (за зразком
// rulesStore.ts, useSyncExternalStore), який обидві вкладки читають і
// патчать, а спільний футер зберігає як нову версію.
//
// Стор не питає confirm і не знає React-компонентів — лише стан і дії, тож
// його можна ганяти в тестах (golden: чернетка з версії серіалізується
// біт-у-біт як сама версія).
// =========================================================

import { useEffect, useSyncExternalStore } from 'react';
import { errorMessage } from '../app/errorMessage';
import {
  cloneRules, currentRulesVersion, nextRulesVersion, rulesFor,
  type BalanceRules, type BuffRules, type CompositionRules, type GearRules,
} from './gearRules';
import { saveRulesVersion, useRules } from './rulesStore';

export interface RulesDraftState {
  /** версія, з якої зроблено чернетку */
  base: string;
  draft: GearRules;
  /** є незбережені зміни */
  dirty: boolean;
  /** нотатка до майбутньої версії */
  note: string;
  busy: boolean;
  err: string | null;
  /** щойно збережена версія — для бейджа «Збережено як …» */
  savedAs: string | null;
}

let state: RulesDraftState | null = null;
const listeners = new Set<() => void>();

/** Стан створюється ліниво (на першому читанні), а не при імпорті модуля —
 * щоб порядок імпортів і тести не залежали від того, чи вже зареєстровано
 * версії з БД. */
function ensure(): RulesDraftState {
  if (!state) {
    const base = currentRulesVersion();
    state = { base, draft: cloneRules(rulesFor(base)), dirty: false, note: '', busy: false, err: null, savedAs: null };
  }
  return state;
}

function set(p: Partial<RulesDraftState>): void {
  state = { ...ensure(), ...p };
  listeners.forEach((l) => l());
}

export function getRulesDraft(): RulesDraftState {
  return ensure();
}

/** Правка верхнього рівня (таблиці балів, пороги …): вкладені об'єкти каллер
 * збирає сам — так само, як робив старий редактор; глибокого злиття навмисно
 * нема, бо в таблицях-словниках (напр. weaponGradeByClass) ключ треба вміти
 * і прибрати, а злиття його б лишало. */
export function patchDraft(p: Partial<GearRules>): void {
  const s = ensure();
  set({ draft: { ...s.draft, ...p }, dirty: true, savedAs: null, err: null });
}

export function patchBalance(p: Partial<BalanceRules>): void {
  patchDraft({ balance: { ...ensure().draft.balance, ...p } });
}

export function patchComposition(p: Partial<CompositionRules>): void {
  patchBalance({ composition: { ...ensure().draft.balance.composition, ...p } });
}

export function patchBuffs(p: Partial<BuffRules>): void {
  patchBalance({ buffs: { ...ensure().draft.balance.buffs, ...p } });
}

export function setDraftNote(note: string): void {
  set({ note });
}

/** Замінити чернетку копією версії (підтвердження «чернетку буде замінено» — справа UI). */
export function loadDraftVersion(version: string): void {
  set({ base: version, draft: cloneRules(rulesFor(version)), dirty: false, err: null, savedAs: null });
}

/** Скинути правки — знову копія базової версії. */
export function resetDraft(): void {
  loadDraftVersion(ensure().base);
}

/** Пороги tier мають спадати (S > A > B > C) — інакше tierFor дає нісенітницю. */
export function draftTiersValid(draft: GearRules = ensure().draft): boolean {
  return draft.tiers.every((t, i) => i === 0 || i === draft.tiers.length - 1 || t.min < draft.tiers[i - 1].min);
}

/** Назва, під якою збережеться чернетка. */
export function draftNextVersion(): string {
  return nextRulesVersion();
}

/** Зберегти чернетку як нову НЕЗМІННУ версію (rulesStore.saveRulesVersion) і
 * зробити її базою чернетки. saver підміняється лише в тестах. Повертає
 * назву версії або null, якщо не збережено (помилка — у state.err). */
export async function saveDraft(saver: (rules: GearRules, note: string) => Promise<string> = saveRulesVersion): Promise<string | null> {
  const s = ensure();
  if (!draftTiersValid(s.draft)) { set({ err: 'Пороги tier мають спадати: S > A > B > C.' }); return null; }
  if (s.busy) return null;
  set({ busy: true, err: null });
  try {
    const v = await saver(s.draft, s.note);
    set({ savedAs: v, base: v, dirty: false, note: '', busy: false });
    return v;
  } catch (e) {
    set({ busy: false, err: errorMessage(e, 'Не вдалося зберегти версію. Міграція 0019 застосована?') });
    return null;
  }
}

/** Коли версії з БД довантажились (або інший адмін зберіг нову), а чернетку
 * ще не чіпали — переходимо на поточну, щоб не редагувати вбудовану v1.0. */
export function followCurrentVersion(current: string): void {
  const s = ensure();
  if (!s.dirty && s.base !== current) loadDraftVersion(current);
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getSnapshot = () => ensure();

/** Хук для вкладок і футера: стан чернетки + поточна версія з rulesStore.
 * Кілька компонентів можуть викликати його одночасно — followCurrentVersion
 * ідемпотентна. */
export function useRulesDraft(): RulesDraftState & { loaded: boolean; current: string } {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const { loaded, current } = useRules();
  useEffect(() => { followCurrentVersion(current); }, [current, loaded]);
  return { ...s, loaded, current };
}

/** Лише для тестів: забути чернетку, щоб наступний тест почав з чистого стану. */
export function _resetRulesDraftForTests(): void {
  state = null;
}
