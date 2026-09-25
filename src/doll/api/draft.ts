// =========================================================
// ЛЯЛЬКА — локальна чернетка персонажа (до появи збереження в профіль).
// Ключ pvpCharDraft:<власник>:<id> — поки лише anon:new. Запис із затримкою
// 500 мс: редактор міняє документ на кожне натискання клавіші, а писати
// десятки кілобайт у сховище так часто — марно. При закритті сторінки
// відкладений запис виконується одразу, щоб останній ввід не загубився.
//
// Читання — через validateDoc (ті самі правила, що в сервера). Чернетка, що
// лише перевищує ліміти чи порушує правила (роли понад 400, атрибути понад
// бюджет рівня), відкривається з попередженням — її можна виправити, а губити
// роботу через ліміт не можна. Зламана чи чужа (не та форма) у редактор не
// потрапляє: її сирий текст відкладається під «…:broken» (три останні копії),
// щоб наступний запис не стер роботу гравця безслідно.
//
// Дві вкладки з тією самою чернеткою: подія storage каже, що інша вкладка
// записала своє. Тоді запис тут зупиняється, доки гравець не вирішить —
// відкрити новішу чи лишити цю (інакше вкладка зі старим станом мовчки
// перезаписала б роботу в іншій).
//
// Сховище може бути недоступне (приватний режим, заборона сайтових даних) —
// кожен доступ у try/catch, редактор тоді просто працює без чернетки.
// =========================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultState, type DollState } from '../core/types';
import { emptyDoc, validateDoc, type CharacterDoc } from '../model/doc';
import { fromCalcDollState } from '../model/importCalc';

export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const DRAFT_PREFIX = 'pvpCharDraft:';
export const DRAFT_DELAY_MS = 500;

export function draftKey(owner = 'anon', id = 'new'): string {
  return DRAFT_PREFIX + owner + ':' + id;
}
export const brokenKey = (key: string): string => key + ':broken';
/** Скільки зламаних копій тримати: :broken (найновіша), :broken:2, :broken:3. */
export const BROKEN_KEEP = 3;
const brokenSlot = (key: string, n: number): string => (n <= 1 ? brokenKey(key) : brokenKey(key) + ':' + n);

/** Відкласти сирий текст зламаної чернетки, зсунувши старші копії; той самий
 * текст удруге (перезавантажили сторінку, нічого не змінивши) не дублюється. */
function stashBroken(key: string, raw: string, storage: DraftStorage): void {
  try {
    if (storage.getItem(brokenSlot(key, 1)) === raw) return;
    for (let n = BROKEN_KEEP; n > 1; n--) {
      const prev = storage.getItem(brokenSlot(key, n - 1));
      if (prev != null) storage.setItem(brokenSlot(key, n), prev);
    }
    storage.setItem(brokenSlot(key, 1), raw);
  } catch {
    /* не вдалося відкласти — повідомлення все одно покажемо */
  }
}

/** localStorage або null, якщо його нема чи сам доступ кидає (заборона сайтових даних). */
export function browserStorage(): DraftStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export interface DraftLoad {
  doc: CharacterDoc | null;
  /** Чому чернетку не взято (зламана форма, чужий JSON); null — усе гаразд або чернетки нема. */
  error: string | null;
  /** Чернетку відкрито, але вона порушує ліміти чи правила — зберегти в профіль не вийде, доки не виправиш. */
  warning?: string | null;
}

/** Прочитати чернетку. Немає — {doc: null}; порушено лише ліміти/правила — doc + warning;
 * зламана — {doc: null, error} і сирий текст відкладено в «…:broken». */
export function loadDraft(key: string, storage: DraftStorage | null = browserStorage()): DraftLoad {
  if (!storage) return { doc: null, error: null };
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { doc: null, error: null };
  }
  if (raw == null || raw === '') return { doc: null, error: null };
  const v = validateDoc(raw);
  if (v.ok) return { doc: v.doc, error: null };
  if (v.recoverable) return { doc: v.recoverable, error: null, warning: v.errors.slice(0, 3).join('; ') };
  stashBroken(key, raw, storage);
  return { doc: null, error: v.errors.slice(0, 3).join('; ') };
}

/** Записати чернетку; false — сховище недоступне або переповнене. */
export function saveDraft(key: string, doc: CharacterDoc, storage: DraftStorage | null = browserStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(doc));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(key: string, storage: DraftStorage | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    /* нема чого чистити */
  }
}

/**
 * idle — чернетки ще не записано (порожній персонаж); off — сховища нема, чернетка
 * не збережеться; held — запис зупинено, бо іншу вкладку змінила ту саму чернетку.
 */
export type SaveState = 'idle' | 'saved' | 'pending' | 'failed' | 'held' | 'off';

/**
 * Відкладений запис: schedule(doc) переносить таймер, flush() пише негайно
 * (закриття сторінки, зміна ключа). pause() зупиняє запис (остання версія
 * чекає), resume() відновлює й пише її. onState — для індикатора «збережено».
 */
export function createDraftSaver(
  key: string,
  opts: { storage?: DraftStorage | null; delay?: number; onState?: (s: SaveState) => void } = {},
) {
  const storage = opts.storage === undefined ? browserStorage() : opts.storage;
  const delay = opts.delay ?? DRAFT_DELAY_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: CharacterDoc | null = null;
  let paused = false;

  const write = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!pending || paused) return;
    const doc = pending;
    pending = null;
    // Запис — окремим кроком: у `onState?.(save())` без колбека save не виконався б зовсім.
    const ok = saveDraft(key, doc, storage);
    opts.onState?.(ok ? 'saved' : 'failed');
  };

  return {
    schedule(doc: CharacterDoc): void {
      pending = doc;
      if (timer) clearTimeout(timer);
      timer = null;
      if (paused) {
        opts.onState?.('held');
        return;
      }
      timer = setTimeout(write, delay);
      opts.onState?.('pending');
    },
    flush: write,
    /** Зупинити запис (інша вкладка змінила чернетку): відкладене не пишеться, доки не resume. */
    pause(): void {
      paused = true;
      if (timer) clearTimeout(timer);
      timer = null;
      opts.onState?.('held');
    },
    /** Відновити запис; якщо щось чекало — записати одразу. */
    resume(): void {
      paused = false;
      if (pending) write();
    },
    isPaused: (): boolean => paused,
    /** Скасувати відкладений запис (скидання чернетки — писати старе вже не треба). */
    cancel(): void {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
    isPending: (): boolean => pending !== null,
  };
}

/** Стан індикатора до першого запису: сховища нема — off; чернетку прочитано — saved; ще нічого не писали — idle. */
export function initialSaveState(storage: DraftStorage | null, loaded: boolean): SaveState {
  if (!storage) return 'off';
  return loaded ? 'saved' : 'idle';
}

/**
 * Чернетка як стан React: початкове значення — зі сховища (або порожній
 * персонаж), кожна зміна пишеться із затримкою. loadError — чому стару
 * чернетку не взято, loadWarning — що в ній виправити перед збереженням
 * (показати гравцеві один раз). conflict — іншу вкладку записала ту саму
 * чернетку: запис зупинено до takeTheirs() / keepMine().
 */
export function useDraft(key: string) {
  const [initial] = useState(() => loadDraft(key));
  const [doc, setDocState] = useState<CharacterDoc>(() => initial.doc ?? emptyDoc());
  const [saveState, setSaveState] = useState<SaveState>(() => initialSaveState(browserStorage(), !!initial.doc));
  const [conflict, setConflict] = useState(false);
  const docRef = useRef(doc);
  docRef.current = doc;
  const saverRef = useRef<ReturnType<typeof createDraftSaver> | null>(null);
  if (!saverRef.current) saverRef.current = createDraftSaver(key, { onState: setSaveState });

  useEffect(() => {
    const saver = saverRef.current;
    const flush = () => saver?.flush();
    // Подія storage приходить лише в ІНШІ вкладки — тобто це завжди чужий запис.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key || e.newValue == null) return;
      if (e.newValue === JSON.stringify(docRef.current)) return; // те саме, що в нас, — не конфлікт
      saver?.pause();
      setConflict(true);
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('storage', onStorage);
      flush();
    };
  }, [key]);

  const setDoc = useCallback((next: CharacterDoc) => {
    setDocState(next);
    saverRef.current?.schedule(next);
  }, []);

  /** Скинути (чи імпортувати): новий документ, запис одразу (без затримки). Явна дія
   * гравця — тож і конфлікт вкладок вирішено на її користь. */
  const reset = useCallback((next: CharacterDoc) => {
    const saver = saverRef.current;
    saver?.cancel();
    saver?.resume();
    setConflict(false);
    setDocState(next);
    setSaveState(saveDraft(key, next) ? 'saved' : 'failed');
  }, [key]);

  /** Відкрити чернетку, яку записала інша вкладка (свої незбережені зміни — відкинути). */
  const takeTheirs = useCallback((): DraftLoad => {
    const saver = saverRef.current;
    const got = loadDraft(key);
    saver?.cancel();
    saver?.resume();
    setConflict(false);
    if (got.doc) {
      setDocState(got.doc);
      setSaveState('saved');
    }
    return got;
  }, [key]);

  /** Лишити цю версію: записати її поверх тієї, що з іншої вкладки. */
  const keepMine = useCallback(() => {
    const saver = saverRef.current;
    saver?.cancel();
    saver?.resume();
    setConflict(false);
    setSaveState(saveDraft(key, docRef.current) ? 'saved' : 'failed');
  }, [key]);

  return { doc, setDoc, reset, saveState, loadError: initial.error, loadWarning: initial.warning ?? null, conflict, takeTheirs, keepMine };
}

/**
 * Імпорт із PW Хелпера: гравець вставляє вміст ключа pwDollBuild (поточний
 * білд ляльки) або один запис зі «Збережених білдів» ({name, ts, state}).
 * Кидає Error з поясненням простими словами.
 */
export function parseHelperBuild(text: string): CharacterDoc {
  const src = text.trim();
  if (!src) throw new Error('Встав текст білда з Хелпера.');
  let raw: unknown;
  try {
    raw = JSON.parse(src);
  } catch {
    throw new Error('Це не схоже на білд Хелпера: текст має бути JSON, скопійований повністю.');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Це не схоже на білд Хелпера.');
  const obj = raw as Record<string, unknown>;
  const inner = obj.state && typeof obj.state === 'object' && !Array.isArray(obj.state) ? (obj.state as Record<string, unknown>) : obj;
  if (typeof inner.cls !== 'string' || !inner.equipped || typeof inner.equipped !== 'object') {
    throw new Error('Це не схоже на білд Хелпера: немає класу або спорядження.');
  }
  // Як loadState Хелпера: поверх стартового стану, щоб відсутні поля мали звичні значення.
  const state = { ...defaultState(), ...inner } as DollState;
  try {
    return fromCalcDollState(state);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error('Не вдалося перенести білд: ' + msg + '.');
  }
}
