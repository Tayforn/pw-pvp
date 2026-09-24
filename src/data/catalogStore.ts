// =========================================================
// pw-pvp: завантаження довідника рядків правил (таблиця rule_items, 0027) +
// правки з адмінки + маленький стор для React (useRuleCatalog) — за зразком
// rulesStore.ts.
//
// До завантаження (або без таблиці — міграція ще не застосована) працює
// вбудований довідник BUILTIN_RULE_ITEMS. Поки loaded = false, попап правил
// турніру не дає зберегти — інакше у знімок пішов би вбудований текст замість
// довідника.
// =========================================================

import { useSyncExternalStore } from 'react';
import { supabase } from '../app/supabaseClient';
import { BUILTIN_RULE_ITEMS, blankRuleItem, mergeCatalog, normalizeRuleItem, type RuleGroup, type RuleItem } from './ruleCatalog';

interface RuleItemRow {
  key: string; grp: string; kind: string; label_admin: string; text_player: string;
  options: unknown; default_value: unknown; visible_for: string[]; affects: string | null;
  is_system: boolean; sort: number; archived: boolean;
}

let current: RuleItem[] = BUILTIN_RULE_ITEMS;
let loaded = false;
let loadPromise: Promise<void> | null = null;
let revision = 0;
const listeners = new Set<() => void>();
const notify = () => { revision++; listeners.forEach((l) => l()); };

/** Одноразове завантаження (ідемпотентне). Помилка (таблиці ще немає, мережа)
 * або порожня таблиця — лишаємось на вбудованому довіднику. */
export function loadCatalogFromDb(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const { data, error } = await supabase.from('rule_items').select('*').order('sort', { ascending: true });
        if (error) throw error;
        const rows = ((data ?? []) as unknown[]).map(normalizeRuleItem).filter((i): i is RuleItem => !!i);
        current = rows.length ? mergeCatalog(rows) : BUILTIN_RULE_ITEMS;
      } catch {
        current = BUILTIN_RULE_ITEMS;
      } finally {
        loaded = true;
        notify();
      }
    })();
  }
  return loadPromise;
}

/** Перечитати з нуля (після правки в адмінці). */
export async function reloadCatalog(): Promise<void> {
  loadPromise = null;
  await loadCatalogFromDb();
}

/** Поточний довідник (вбудований до завантаження). */
export function items(): RuleItem[] {
  return current;
}

const rowFromItem = (it: RuleItem): RuleItemRow => ({
  key: it.key, grp: it.grp, kind: it.kind, label_admin: it.labelAdmin, text_player: it.textPlayer,
  options: it.kind === 'choice' ? it.options ?? [] : null, default_value: it.defaultValue, visible_for: it.visibleFor,
  affects: it.affects, is_system: it.isSystem, sort: it.sort, archived: it.archived,
});

/** Зберегти рядок (новий або правку) — один upsert. */
export async function saveItem(item: RuleItem): Promise<void> {
  const { error } = await supabase.from('rule_items').upsert(rowFromItem(item), { onConflict: 'key' });
  if (error) throw error;
  await reloadCatalog();
}

/** Архівувати / повернути: рядок зникає з попапу й публічної сторінки, у
 * вже створених турнірах текст лишається (знімок). */
export async function archiveItem(key: string, archived: boolean): Promise<void> {
  const { error } = await supabase.from('rule_items').update({ archived }).eq('key', key);
  if (error) throw error;
  await reloadCatalog();
}

/** Видалити доданий рядок (системні RLS не пропустить — лише архів). */
export async function deleteItem(key: string): Promise<void> {
  const { error } = await supabase.from('rule_items').delete().eq('key', key);
  if (error) throw error;
  await reloadCatalog();
}

/** Порядок: upsert рядків із новим sort одним запитом (зазвичай два —
 * сусіди, що помінялись місцями; PostgREST робить це одним INSERT … ON
 * CONFLICT, тобто атомарно). Повні рядки, а не лише sort: у INSERT-частині
 * upsert NOT NULL-колонки без дефолту обовʼязкові. */
export async function reorderItems(changed: RuleItem[]): Promise<void> {
  if (changed.length === 0) return;
  const { error } = await supabase.from('rule_items').upsert(changed.map(rowFromItem), { onConflict: 'key' });
  if (error) throw error;
  await reloadCatalog();
}

/** Новий доданий рядок групи (ще не збережений): ключ 'c_' + 8 hex. */
export function createItem(grp: RuleGroup): RuleItem {
  return blankRuleItem(grp, current);
}

const getSnapshot = () => revision;
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** Хук: запускає завантаження й перемальовує компонент, коли довідник змінився. */
export function useRuleCatalog(): { loaded: boolean; items: RuleItem[] } {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!loadPromise) void loadCatalogFromDb();
  return { loaded, items: current };
}
