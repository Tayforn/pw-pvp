// =========================================================
// pw-pvp: правила турніру як рядки-чекбокси (tournaments.rule_flags).
// Чистий модуль — без Supabase і React.
//
// Турнір зберігає ЗНІМОК обраних рядків довідника: ключ, стан (галочка або
// значення) і текст гравцю на момент збереження — тому пізніша правка
// довідника старих турнірів не чіпає. Лише три системні ключі впливають на
// жеребку (party_buffs, kx, reserve) — за ними стоїть код у цьому модулі;
// решта системних ключів — тільки текст для гравців.
// =========================================================

import type { BalanceRules, KxMode } from './gearRules';
import type { BalanceSnapshot } from './types';

export interface TournamentRuleFlagItem {
  key: string;
  /** галочка (рядок-чекбокс) */
  on?: boolean;
  /** параметр із вибором / число (рядок-параметр) */
  value?: string | number | null;
  /** текст гравцю на момент збереження — знімок довідника */
  text: string;
}

export interface TournamentRuleFlags {
  v: 1;
  items: TournamentRuleFlagItem[];
  /** «Додатково» — рядки, дописані адміном поза довідником */
  extra: string[];
}

/** Системні ключі, за якими стоїть код (жеребка читає їх через функції нижче). */
export const RULE_KEYS_AFFECTING_DRAW = ['party_buffs', 'kx', 'reserve'] as const;
/** Системні ключі лише з текстом для гравців — на жеребку не впливають. */
export const RULE_KEYS_TEXT_ONLY = ['no_spark3', 'self_only', 'potions', 'kite', 'bd_wine', 'reg_block', 'squads_fixed'] as const;
export const SYSTEM_RULE_KEYS: readonly string[] = [...RULE_KEYS_AFFECTING_DRAW, ...RULE_KEYS_TEXT_ONLY];

/** Що передати алгоритму: чи рахувати бафи (лише «від своєї пачки»; правило
 * «бафи не дозволені» їх вимикає) і яку колонку таблиці брати (без КХ / під КХ). */
export interface BuffOptions {
  source: 'party' | 'none';
  kx: KxMode;
}

function itemOf(flags: TournamentRuleFlags | null | undefined, key: string): TournamentRuleFlagItem | undefined {
  return flags?.items.find((i) => i.key === key);
}

/** Рядок «kx» зі значенням 'kx' | 'noKx' задає колонку, інакше — КХ за
 * замовчуванням із шкали; рядок «party_buffs» знятий (on === false) означає,
 * що бафи не обмежені своєю пачкою (від будь-кого — команди вони не
 * розрізняють) → у силі їх не рахуємо. Без правил — бафи від пачки. */
export function resolveBuffOptions(rules: BalanceRules, flags: TournamentRuleFlags | null | undefined): BuffOptions {
  const kxItem = itemOf(flags, 'kx');
  const kx: KxMode = kxItem?.value === 'kx' || kxItem?.value === 'noKx' ? kxItem.value : rules.buffs.defaultKx;
  const party = itemOf(flags, 'party_buffs');
  return { source: party?.on === false ? 'none' : 'party', kx };
}

/** Політика резерву з рядка «reserve»; null — рядка нема (UI бере свій дефолт). */
export function reservePolicyFromFlags(flags: TournamentRuleFlags | null | undefined): 'latest' | 'random' | null {
  const v = itemOf(flags, 'reserve')?.value;
  return v === 'latest' || v === 'random' ? v : null;
}

/** JSON з колонки rule_flags → знімок або null (старий турнір без правил-рядків,
 * або зламаний запис — тоді UI показує textarea, як раніше). */
export function normalizeRuleFlags(raw: unknown): TournamentRuleFlags | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || !Array.isArray(r.items)) return null;
  const items: TournamentRuleFlagItem[] = [];
  for (const it of r.items as unknown[]) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    if (typeof o.key !== 'string' || !o.key) continue;
    const item: TournamentRuleFlagItem = { key: o.key, text: typeof o.text === 'string' ? o.text : '' };
    if (typeof o.on === 'boolean') item.on = o.on;
    if (typeof o.value === 'string' || o.value === null || (typeof o.value === 'number' && Number.isFinite(o.value))) item.value = o.value;
    items.push(item);
  }
  const extra = Array.isArray(r.extra) ? r.extra.filter((x): x is string => typeof x === 'string') : [];
  return { v: 1, items, extra };
}

/** Рядок довіри для сторінки турніру й модалки — одними словами скрізь:
 * «бафи: без КХ, своя пачка» · «бафи: не рахувались (правила турніру не
 * обмежують бафи своєю пачкою)» · «бафи: вимкнено у шкалі balance-v1.13» ·
 * «бафи: не рахувались (стара жеребка)». Для source 'none' формулювання
 * узгоджене з правилами: там немає речення «бафи заборонені» — просто знято
 * рядок «лише від своєї пачки», тож бафи від будь-кого команд не розрізняють. */
export function describeSnapshotBuffs(buffs: BalanceSnapshot['buffs'] | undefined, rulesVersion: string): string {
  if (!buffs) return 'бафи: не рахувались (стара жеребка)';
  if (buffs.source === 'none') return 'бафи: не рахувались (правила турніру не обмежують бафи своєю пачкою)';
  if (!buffs.enabled) return `бафи: вимкнено у шкалі ${rulesVersion}`;
  return `бафи: ${buffs.kx === 'kx' ? 'під КХ' : 'без КХ'}, своя пачка`;
}
