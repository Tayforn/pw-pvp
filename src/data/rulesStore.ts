// =========================================================
// pw-pvp: завантаження версій шкали балів з таблиці balance_rules (0019)
// у реєстр gearRules + збереження нових версій з адмінки + маленький
// стор для React (useRules), щоб компоненти, які показують скор,
// перемалювались, коли версії з БД довантажились.
//
// До завантаження (або без таблиці — міграція ще не застосована) працює
// вбудована 'balance-v1.0' — публічні сторінки від цього не падають.
// =========================================================

import { useSyncExternalStore } from 'react';
import { supabase } from '../app/supabaseClient';
import {
  BUILTIN_RULES_VERSION, currentRulesVersion, listRulesVersions, nextRulesVersion, normalizeRules, registerRules,
  serializeRules, type GearRules, type RulesVersionInfo,
} from './gearRules';

interface RulesRow { version: string; rules: unknown; note: string | null; created_at: string; created_by: string | null }

let loadPromise: Promise<void> | null = null;
let loaded = false;
let revision = 0;
const listeners = new Set<() => void>();
const notify = () => { revision++; listeners.forEach((l) => l()); };

/** Одноразове завантаження всіх версій (ідемпотентне). Помилка (напр. таблиці
 * ще немає) — просто лишаємось на вбудованій версії. */
export function loadRulesFromDb(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const { data, error } = await supabase.from('balance_rules').select('*').order('created_at', { ascending: true });
        if (error) throw error;
        const rows = (data ?? []) as RulesRow[];
        rows.forEach((row, i) => {
          registerRules(
            { version: row.version, note: row.note, createdAt: row.created_at, builtin: false },
            normalizeRules(row.rules),
            i === rows.length - 1, // найновіша — поточна
          );
        });
      } catch {
        // таблиці ще немає (міграція 0019 не застосована) або мережа — лишаємось на вбудованій
      } finally {
        loaded = true;
        notify();
      }
    })();
  }
  return loadPromise;
}

/** Перечитати з нуля (після збереження іншим адміном / realtime). */
export async function reloadRules(): Promise<void> {
  loadPromise = null;
  await loadRulesFromDb();
}

/** Зберігає нову НЕЗМІННУ версію і робить її поточною для нових турнірів. */
export async function saveRulesVersion(rules: GearRules, note: string): Promise<string> {
  const version = nextRulesVersion();
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('balance_rules')
    .insert({ version, rules: serializeRules(rules), note: note.trim() || null, created_by: auth.user?.id ?? null })
    .select('*')
    .single();
  if (error) throw error;
  const row = data as RulesRow;
  registerRules({ version: row.version, note: row.note, createdAt: row.created_at, builtin: false }, normalizeRules(row.rules), true);
  notify();
  return version;
}

const getSnapshot = () => revision;
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** Хук: запускає завантаження й перемальовує компонент, коли реєстр змінився.
 * Повертає поточну версію (для нових турнірів) і список версій. */
export function useRules(): { loaded: boolean; current: string; versions: RulesVersionInfo[]; builtin: string } {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!loadPromise) void loadRulesFromDb();
  return { loaded, current: currentRulesVersion(), versions: listRulesVersions(), builtin: BUILTIN_RULES_VERSION };
}
