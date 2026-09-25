// =========================================================
// ЛЯЛЬКА — перетягування інвентар ↔ слот (HTML5 DnD). Порт DollPage.tsx
// Хелпера (655-684, 860-883, 898-917), але джерело — не «рюкзак/слот зі
// станом», а посилання {iid} або {cfgId, slot}: перетягування лише міняє,
// куди вказує конфігурація, дані речі не рухаються.
//
// Підсвітка цілі — станом overKey, а не classList: ставиться лише коли ціль
// змінилась, тож dragover (десятки подій на секунду) не перемальовує дерево.
// На тачі HTML5 DnD ненадійний (а Chrome на Android ще й починає «перетягування»
// з довгого натискання, яке в нас відкриває тултіп) — там draggable вимкнено,
// працюють меню клітинки й пікер.
// =========================================================

import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { SLOT_CAT, isSetSlotKey, type Cat, type SlotKey } from '../../model/doc';
import { CFG_MAIN } from '../../model/hydrate';
import { equip, unequip } from '../../model/ops';
import { COARSE_PTR } from '../CellMenu';
import type { EditorApi } from '../EditorContext';

export type DragSrc =
  | { from: 'inv'; iid: string; cat: Cat }
  | { from: 'slot'; cfgId: string; slot: SlotKey; iid: string; cat: Cat };

type DragHandlers = { draggable: boolean; onDragStart: (e: DragEvent) => void };
type DropHandlers = {
  onDragOver: (e: DragEvent) => void;
  onDragLeave: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
};

export interface DnD {
  /** Зараз щось тягнуть (щоб не показувати тултіп під курсором). */
  isDragging(): boolean;
  /** Ключ цілі під курсором: 'slot:<slot>' або 'inv'; null — нічого. */
  overKey: string | null;
  dragProps(src: DragSrc): DragHandlers;
  slotDrop(cfgId: string, slot: SlotKey): DropHandlers;
  invDrop(cfgId: string): DropHandlers;
}

export const slotDropKey = (slot: SlotKey): string => 'slot:' + slot;
export const INV_DROP_KEY = 'inv';

/** Чи можна кинути джерело в цей слот: та сама категорія, у сеті — не джинн/політ,
 * не той самий слот. Кільце на іншу руку — можна (equip переносить). */
function canDropOnSlot(src: DragSrc, cfgId: string, slot: SlotKey): boolean {
  if (SLOT_CAT[slot] !== src.cat) return false;
  if (cfgId !== CFG_MAIN && !isSetSlotKey(slot)) return false;
  if (src.from === 'slot' && src.cfgId === cfgId && src.slot === slot) return false;
  return true;
}

export function useDnD(api: EditorApi, opts: { onDragStart?: () => void } = {}): DnD {
  const srcRef = useRef<DragSrc | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const onStartRef = useRef(opts.onDragStart);
  onStartRef.current = opts.onDragStart;
  const { apply, readOnly } = api;

  const reset = useCallback(() => {
    srcRef.current = null;
    setOverKey(null);
  }, []);

  // dragend приходить джерелу, але коли перетягування скасовано поза вікном —
  // документний слухач єдиний, хто про це дізнається.
  useEffect(() => {
    document.addEventListener('dragend', reset);
    return () => document.removeEventListener('dragend', reset);
  }, [reset]);

  const dragProps = useCallback(
    (src: DragSrc): DragHandlers => ({
      draggable: !readOnly && !COARSE_PTR,
      onDragStart: (e) => {
        if (readOnly) {
          e.preventDefault();
          return;
        }
        srcRef.current = src;
        onStartRef.current?.();
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', 'x'); // без даних Firefox не починає перетягування
        }
      },
    }),
    [readOnly],
  );

  const leave = useCallback((e: DragEvent, key: string) => {
    // dragleave стріляє й при переході на дочірній елемент — це ще не вихід із цілі.
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    setOverKey((k) => (k === key ? null : k));
  }, []);

  const slotDrop = useCallback(
    (cfgId: string, slot: SlotKey): DropHandlers => {
      const key = slotDropKey(slot);
      return {
        onDragOver: (e) => {
          const src = srcRef.current;
          if (!src) return;
          const ok = canDropOnSlot(src, cfgId, slot);
          setOverKey((k) => (ok ? (k === key ? k : key) : k === key ? null : k));
          if (ok) {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
          }
        },
        onDragLeave: (e) => leave(e, key),
        onDrop: (e) => {
          const src = srcRef.current;
          if (src && canDropOnSlot(src, cfgId, slot)) {
            e.preventDefault();
            apply((doc) => equip(doc, cfgId, slot, src.iid));
          }
          reset();
        },
      };
    },
    [apply, leave, reset],
  );

  const invDrop = useCallback(
    (cfgId: string): DropHandlers => ({
      onDragOver: (e) => {
        const src = srcRef.current;
        if (!src || src.from !== 'slot' || src.cfgId !== cfgId) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        setOverKey((k) => (k === INV_DROP_KEY ? k : INV_DROP_KEY));
      },
      onDragLeave: (e) => leave(e, INV_DROP_KEY),
      onDrop: (e) => {
        const src = srcRef.current;
        if (src && src.from === 'slot' && src.cfgId === cfgId) {
          e.preventDefault();
          apply((doc) => unequip(doc, src.cfgId, src.slot));
        }
        reset();
      },
    }),
    [apply, leave, reset],
  );

  return {
    isDragging: () => srcRef.current !== null,
    overKey,
    dragProps,
    slotDrop,
    invDrop,
  };
}
