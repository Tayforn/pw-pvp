// =========================================================
// ЛЯЛЬКА — контекст редактора: документ, гідрована модель, активна
// конфігурація, одна точка змін (apply), стан модалок і режим характеристик
// «Чисті / У бою» (уподобання браузера, як і суперник). Усі частини
// редактора (фігура, інвентар, панелі, модалки) беруть його через useEditor,
// тож між компонентами не ходять десятки пропсів, а модалка знає, звідки її
// відкрили, з обʼєкта `modal`, а не з окремих useState.
//
// Модалка одна: open* ЗАМІНЮЄ відкриту. Пікер каменя, відкритий з редактора
// речі, сам повертає редактор (openItemEditor — можливо, з новим iid, якщо
// правка з вкладки сету зробила копію), тож стек не потрібен і не плутає,
// яка з двох версій речі «під» пікером. Esc, фокус і блокування скролу —
// справа оболонки вікна (modals/ModalShell), а не контексту.
// =========================================================

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_OPP } from '../core/damage';
import type { DmgLogEntry, DollState, OppMob } from '../core/types';
import type { CharacterDoc, SlotKey } from '../model/doc';
import { toDollState, type CharacterModel } from '../model/hydrate';

export type PickerTarget =
  | { cfgId: string; slot: SlotKey }
  | { kind: 'gem'; cfgId: string; iid: string; socket: number }
  | { kind: 'wdf' | 'crystal'; cfgId: string; iid: string };

/** Вкладка вікна пошуку станів. Окреме імʼя, бо `kind` у EditorModal — дискримінатор виду вікна. */
export type BuffPickTab = 'buff' | 'debuff';
/** Вкладка редактора речі (камені, характеристики-роли, гравіювання). */
export type ItemTab = 'gems' | 'addons' | 'engrave';

export type EditorModal =
  | null
  | { kind: 'picker'; target: PickerTarget }
  /** tab — з якої вкладки відкрити (пікер: «змінити роли» одразу після «Надіти»). */
  | { kind: 'item'; cfgId: string; iid: string; tab?: ItemTab }
  | { kind: 'buffCfg'; id: number }
  /** tab — з якої вкладки почати; без нього вікно відкриває ту, що була востаннє. */
  | { kind: 'buffPick'; tab?: BuffPickTab }
  | { kind: 'opponent' }
  | { kind: 'addSet' }
  | { kind: 'deleteSet'; setId: string }
  /** Вікно джина; ref — вміння, яке одразу відкрити в картці (слот у картці «Джин»). */
  | { kind: 'genie'; ref?: number };

/** Як рахувати характеристики на панелі: «Чисті» — як скор (лише пасивки класу,
 * без бафів), «У бою» — з бафами й дебафами документа. Стан перегляду, не документа. */
export type StatsMode = 'clean' | 'battle';

export interface EditorApi {
  doc: CharacterDoc;
  model: CharacterModel;
  readOnly: boolean;
  activeCfg: string;
  setActiveCfg(id: string): void;
  /** Єдина точка змін документа: чиста функція doc → doc (model/ops.ts). У readOnly — нічого не робить. */
  apply(fn: (doc: CharacterDoc) => CharacterDoc): void;
  openPicker(target: PickerTarget): void;
  openItemEditor(cfgId: string, iid: string, tab?: ItemTab): void;
  openBuffCfg(id: number): void;
  openBuffPick(tab?: BuffPickTab): void;
  openOpponent(): void;
  openAddSet(): void;
  /** Питання «Видалити сет?» (з вибором прибрати й речі, що ніде більше не надіті). */
  openDeleteSet(setId: string): void;
  /** Вікно джина (рівень, удача, вид і збірка вмінь); ref — яке вміння показати в картці. */
  openGenie(ref?: number): void;
  closeModal(): void;
  modal: EditorModal;
  /** «Чисті / У бою» — памʼятається в браузері (localStorage), типово «Чисті». Працює й у readOnly. */
  statsMode: StatsMode;
  setStatsMode(mode: StatsMode): void;
  opponent: OppMob;
  setOpponent(m: OppMob): void;
  dmgLog: DmgLogEntry[];
  pushDmg(e: DmgLogEntry): void;
  clearDmg(): void;
  /** DollState конфігурації (кеш на модель): для тултіпів, вимог і зведення.
   * withBuffs — з бафами документа (лише для перегляду статів; у скор не входять). */
  buildOf(cfgId: string, withBuffs?: boolean): DollState;
  /** Коротке повідомлення внизу екрана (ліміт, «попередня річ в інвентарі»): видно
   * й тоді, коли вікно, з якого прийшла дія, уже закрилось; зникає само. null — сховати. */
  notice: string | null;
  notify(text: string | null): void;
}

const NOTICE_MS = 6000;

const Ctx = createContext<EditorApi | null>(null);

const OPP_KEY = 'pvpDollOpp';
const STATS_MODE_KEY = 'pvpDollStatsMode';
const DMG_LOG_MAX = 200;

/** Режим характеристик — уподобання браузера; немає або зламане — «Чисті». */
function loadStatsMode(): StatsMode {
  try {
    return localStorage.getItem(STATS_MODE_KEY) === 'battle' ? 'battle' : 'clean';
  } catch {
    return 'clean';
  }
}

/** Суперник для перевірки урону — уподобання браузера, не частина документа. */
function loadOpp(): OppMob {
  try {
    const raw = localStorage.getItem(OPP_KEY);
    if (raw) return { ...DEFAULT_OPP, ...(JSON.parse(raw) as Partial<OppMob>) };
  } catch {
    /* сховище недоступне або зламане — беремо дефолт */
  }
  return { ...DEFAULT_OPP };
}

interface ProviderProps {
  doc: CharacterDoc;
  model: CharacterModel;
  onChange(doc: CharacterDoc): void;
  readOnly: boolean;
  activeCfg: string;
  onActiveCfg(id: string): void;
  children: ReactNode;
}

/** Єдина точка змін документа: чиста функція doc → doc. Кілька apply в одному
 * обробнику бачать результат попереднього, а не документ з останнього рендеру;
 * у readOnly — нічого не робить. Той самий apply — і для смужки персонажа поза
 * провайдером (DollEditor: смужка живе й поки вантажиться каталог). */
export function useApply(doc: CharacterDoc, onChange: (doc: CharacterDoc) => void, readOnly: boolean): EditorApi['apply'] {
  const docRef = useRef(doc);
  docRef.current = doc;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  return useCallback(
    (fn: (d: CharacterDoc) => CharacterDoc) => {
      if (readOnly) return;
      const next = fn(docRef.current);
      if (next === docRef.current) return;
      docRef.current = next;
      onChangeRef.current(next);
    },
    [readOnly],
  );
}

export function EditorProvider({ doc, model, onChange, readOnly, activeCfg, onActiveCfg, children }: ProviderProps) {
  const apply = useApply(doc, onChange, readOnly);

  const [modal, setModal] = useState<EditorModal>(null);
  const open = useCallback((m: Exclude<EditorModal, null>) => setModal(m), []);
  const closeModal = useCallback(() => setModal(null), []);

  const [opponent, setOpponentState] = useState<OppMob>(loadOpp);
  const setOpponent = useCallback((m: OppMob) => {
    setOpponentState(m);
    try {
      localStorage.setItem(OPP_KEY, JSON.stringify(m));
    } catch {
      /* без сховища суперник живе до перезавантаження */
    }
  }, []);

  const [statsMode, setStatsModeState] = useState<StatsMode>(loadStatsMode);
  const setStatsMode = useCallback((m: StatsMode) => {
    setStatsModeState(m);
    try {
      localStorage.setItem(STATS_MODE_KEY, m);
    } catch {
      /* без сховища режим живе до перезавантаження */
    }
  }, []);

  const [notice, setNotice] = useState<string | null>(null);
  const notify = useCallback((text: string | null) => setNotice(text), []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  const [dmgLog, setDmgLog] = useState<DmgLogEntry[]>([]);
  const pushDmg = useCallback((e: DmgLogEntry) => setDmgLog((l) => [e, ...l].slice(0, DMG_LOG_MAX)), []);
  const clearDmg = useCallback(() => setDmgLog([]), []);

  // DollState на конфігурацію — кеш живе стільки, скільки модель.
  const cache = useMemo(() => new Map<string, DollState>(), [model]);
  const buildOf = useCallback(
    (cfgId: string, withBuffs = false) => {
      const key = cfgId + (withBuffs ? '|b' : '');
      let b = cache.get(key);
      if (!b) {
        b = toDollState(model, cfgId, { buffs: withBuffs });
        cache.set(key, b);
      }
      return b;
    },
    [model, cache],
  );

  const api = useMemo<EditorApi>(
    () => ({
      doc,
      model,
      readOnly,
      activeCfg,
      setActiveCfg: onActiveCfg,
      apply,
      openPicker: (target) => open({ kind: 'picker', target }),
      openItemEditor: (cfgId, iid, tab) => open(tab ? { kind: 'item', cfgId, iid, tab } : { kind: 'item', cfgId, iid }),
      openBuffCfg: (id) => open({ kind: 'buffCfg', id }),
      openBuffPick: (tab) => open(tab ? { kind: 'buffPick', tab } : { kind: 'buffPick' }),
      openOpponent: () => open({ kind: 'opponent' }),
      openAddSet: () => open({ kind: 'addSet' }),
      openDeleteSet: (setId) => open({ kind: 'deleteSet', setId }),
      openGenie: (ref) => open(ref != null ? { kind: 'genie', ref } : { kind: 'genie' }),
      closeModal,
      modal,
      statsMode,
      setStatsMode,
      opponent,
      setOpponent,
      dmgLog,
      pushDmg,
      clearDmg,
      buildOf,
      notice,
      notify,
    }),
    [doc, model, readOnly, activeCfg, onActiveCfg, apply, open, closeModal, modal, statsMode, setStatsMode, opponent, setOpponent, dmgLog, pushDmg, clearDmg, buildOf, notice, notify],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useEditor(): EditorApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('useEditor поза EditorProvider');
  return api;
}
