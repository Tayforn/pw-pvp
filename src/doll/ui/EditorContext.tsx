// =========================================================
// ЛЯЛЬКА — контекст редактора: документ, гідрована модель, активна
// конфігурація, одна точка змін (apply) і стан модалок. Усі частини
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

export type EditorModal =
  | null
  | { kind: 'picker'; target: PickerTarget }
  | { kind: 'item'; cfgId: string; iid: string }
  | { kind: 'buffCfg'; id: number }
  | { kind: 'buffPick' }
  | { kind: 'opponent' }
  | { kind: 'addSet' };

export interface EditorApi {
  doc: CharacterDoc;
  model: CharacterModel;
  readOnly: boolean;
  activeCfg: string;
  setActiveCfg(id: string): void;
  /** Єдина точка змін документа: чиста функція doc → doc (model/ops.ts). У readOnly — нічого не робить. */
  apply(fn: (doc: CharacterDoc) => CharacterDoc): void;
  openPicker(target: PickerTarget): void;
  openItemEditor(cfgId: string, iid: string): void;
  openBuffCfg(id: number): void;
  openBuffPick(): void;
  openOpponent(): void;
  openAddSet(): void;
  closeModal(): void;
  modal: EditorModal;
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
const DMG_LOG_MAX = 200;

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

export function EditorProvider({ doc, model, onChange, readOnly, activeCfg, onActiveCfg, children }: ProviderProps) {
  // Кілька apply в одному обробнику мають бачити результат попереднього,
  // а не документ з останнього рендеру.
  const docRef = useRef(doc);
  docRef.current = doc;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const apply = useCallback(
    (fn: (d: CharacterDoc) => CharacterDoc) => {
      if (readOnly) return;
      const next = fn(docRef.current);
      if (next === docRef.current) return;
      docRef.current = next;
      onChangeRef.current(next);
    },
    [readOnly],
  );

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
      openItemEditor: (cfgId, iid) => open({ kind: 'item', cfgId, iid }),
      openBuffCfg: (id) => open({ kind: 'buffCfg', id }),
      openBuffPick: () => open({ kind: 'buffPick' }),
      openOpponent: () => open({ kind: 'opponent' }),
      openAddSet: () => open({ kind: 'addSet' }),
      closeModal,
      modal,
      opponent,
      setOpponent,
      dmgLog,
      pushDmg,
      clearDmg,
      buildOf,
      notice,
      notify,
    }),
    [doc, model, readOnly, activeCfg, onActiveCfg, apply, open, closeModal, modal, opponent, setOpponent, dmgLog, pushDmg, clearDmg, buildOf, notice, notify],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useEditor(): EditorApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('useEditor поза EditorProvider');
  return api;
}
