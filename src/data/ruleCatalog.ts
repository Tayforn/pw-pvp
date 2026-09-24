// =========================================================
// pw-pvp: довідник рядків правил турніру (таблиця rule_items, міграція 0027).
// Чистий модуль — без Supabase і React; завантаження з БД — catalogStore.ts.
//
// Рядок довідника — один пункт правил: підпис для адміна, текст гравцю, тип
// (галочка / вибір / число / лише текст), дефолт і формати, де він показується.
// З рядків збирається текст правил турніру (попап «Правила…» в редакторі) і
// публічна сторінка «Правила». Турнір зберігає ЗНІМОК обраних рядків із
// текстом (ruleFlags.ts), тому правки довідника діють лише на нові турніри.
//
// BUILTIN_RULE_ITEMS = seed міграції 0027 (єдине джерело; тест звіряє SQL з
// цим списком) — фолбек, поки таблиці немає або вона ще не довантажилась.
// Системні ключі (SYSTEM_RULE_KEYS) зашиті в код: affects/is_system/kind у них
// не перевизначаються з БД — за party_buffs/kx/reserve стоїть жеребка.
// =========================================================

import type { TeamMode } from './types';
import { RULE_KEYS_AFFECTING_DRAW, SYSTEM_RULE_KEYS, type TournamentRuleFlagItem, type TournamentRuleFlags } from './ruleFlags';

export type RuleGroup = 'battle' | 'registration' | 'squads';
export type RuleKind = 'flag' | 'choice' | 'number' | 'text';
export type RuleFormat = 'solo' | 'fixed' | 'balanced';
export type RuleAffects = (typeof RULE_KEYS_AFFECTING_DRAW)[number];

export const RULE_GROUPS: RuleGroup[] = ['battle', 'registration', 'squads'];
export const RULE_GROUP_LABELS: Record<RuleGroup, string> = { battle: 'Бій', registration: 'Реєстрація й анкета', squads: 'Склади й резерв' };
export const RULE_KINDS: RuleKind[] = ['flag', 'choice', 'number', 'text'];
export const RULE_KIND_LABELS: Record<RuleKind, string> = { flag: 'галочка', choice: 'вибір', number: 'число', text: 'лише текст' };
export const RULE_FORMATS: RuleFormat[] = ['solo', 'fixed', 'balanced'];
export const RULE_FORMAT_LABELS: Record<RuleFormat, string> = { solo: '1х1', fixed: 'готові команди', balanced: 'фул-рандом' };
/** Що саме читає жеребка з рядка — підказка в адмінці (лише системні ключі). */
export const RULE_AFFECTS_HINTS: Record<RuleAffects, string> = {
  party_buffs: 'поставлена → бафи лише від своєї пачки, і жеребка додає бафи тімейтів «клас → клас» у силу команди; знята → бафи можна брати від будь-кого, команди вони не розрізняють, тож жеребка їх у силу не додає',
  kx: 'яку колонку таблиці бафів брати (без КХ / під КХ); «не задано» → КХ за замовчуванням зі шкали балів',
  reserve: 'хто лишається в резерві при формуванні команд (останні за часом реєстрації / випадково) — дефолт селекту «Резерв» у модалці',
};

export interface RuleOption { value: string; label: string; text: string }
export type RuleDefault = boolean | string | number | null;

export interface RuleItem {
  /** системний ключ з коду або 'c_' + 8 hex для доданих адміном */
  key: string;
  grp: RuleGroup;
  kind: RuleKind;
  /** підпис в адмінці: «Кайт / інвіз не довше ніж [N] с» */
  labelAdmin: string;
  /** текст гравцю; для числа — шаблон із {value}; для вибору не використовується (текст у варіантах) */
  textPlayer: string;
  /** лише для kind = 'choice'; варіант із порожнім text — «не згадувати» */
  options: RuleOption[] | null;
  /** галочка/текст: true/false; вибір: value варіанта; число: число */
  defaultValue: RuleDefault;
  visibleFor: RuleFormat[];
  /** лише системні party_buffs / kx / reserve — за ними стоїть код (ruleFlags.ts) */
  affects: RuleAffects | null;
  /** не видаляється, лише архівується; тип і affects — з коду */
  isSystem: boolean;
  sort: number;
  archived: boolean;
}

const ALL_FORMATS: RuleFormat[] = ['solo', 'fixed', 'balanced'];

/** Стандартний блок про реєстрацію й анкету — п'ять рядків, дослівно зі старого
 * шаблону standardRules.ts (у тексті правил кожен рядок стає окремим пунктом). */
export const REG_BLOCK_LINES: string[] = [
  'Ти не обираєш собі команду — команди формує система випадково після закриття реєстрації, вирівнюючи спорядження і класи.',
  'Реєстрація індивідуальна: один персонаж — одна заявка. Заявки на кількох персонажів або від одного гравця під різними ніками відхиляються.',
  'Анкета спорядження заповнюється чесно — адмін перевіряє спорядження в грі. Неправдиві дані — дискваліфікація, місце займає гравець із резерву.',
  'ПЗ-сет / ПА-сет / Спів-Аспід рахуються від порогів: сумарний ПЗ ≥ 30, ПА ≥ 30, швидкість атаки ≥ 3.33 уд/с або −30 % часу активації — усе без бафів.',
  'Трактат: в анкеті вказується найкращий, який береш на турнір; свап униз дозволений, угору — ні.',
];

const sys = (
  key: string, grp: RuleGroup, kind: RuleKind, sort: number, labelAdmin: string, textPlayer: string,
  over: Partial<Pick<RuleItem, 'options' | 'defaultValue' | 'visibleFor' | 'affects'>> = {},
): RuleItem => ({
  key, grp, kind, labelAdmin, textPlayer, sort,
  options: over.options ?? null, defaultValue: over.defaultValue ?? true, visibleFor: over.visibleFor ?? [...ALL_FORMATS],
  affects: over.affects ?? null, isSystem: true, archived: false,
});

/** Стартові рядки — ті самі 10, що в seed міграції 0027. Тексти гравцю —
 * дослівно зі старого шаблону (standardRules.ts до 0027) і живих правил. */
export const BUILTIN_RULE_ITEMS: RuleItem[] = [
  sys('no_spark3', 'battle', 'flag', 10, 'Без 3 ци (третю вспишку не використовуємо)', 'Без 3 ци.'),
  sys('self_only', 'battle', 'flag', 20, 'Тільки селфи', 'Тільки селфи.'),
  sys('potions', 'battle', 'choice', 30, 'Аптека', '', {
    options: [
      { value: 'all', label: 'вся', text: 'Вся аптека — дозволена.' },
      { value: 'none', label: 'заборонена', text: 'Аптека заборонена.' },
    ],
    defaultValue: 'all',
  }),
  sys('kite', 'battle', 'number', 40, 'Кайт / інвіз не довше ніж [N] с', 'Дозволено до {value} секунд кайта / інвіза.', { defaultValue: 15 }),
  sys('party_buffs', 'battle', 'flag', 50, 'Бафи лише від своєї пачки (ПА/ПЗ бафи Стража в чужій пачці — не можна)',
    'Бафи — лише від своєї пачки; ПА/ПЗ бафи Стража в пачках, де його нема, — не дозволено.',
    { visibleFor: ['fixed', 'balanced'], affects: 'party_buffs' }),
  sys('bd_wine', 'battle', 'choice', 60, 'БД вино', '', {
    options: [
      { value: 'skip', label: 'не згадувати', text: '' },
      { value: 'allowed', label: 'дозволено', text: 'БД вино дозволено.' },
      { value: 'forbidden', label: 'заборонено', text: 'БД вино заборонено.' },
    ],
    defaultValue: 'skip',
  }),
  sys('kx', 'battle', 'choice', 70, 'КХ-бафи', '', {
    options: [
      { value: 'unset', label: 'не задано', text: '' },
      { value: 'kx', label: 'усі під КХ', text: 'Усі під КХ-бафами.' },
      { value: 'noKx', label: 'без КХ', text: 'Без КХ-бафів.' },
    ],
    defaultValue: 'unset', visibleFor: ['balanced'], affects: 'kx',
  }),
  sys('reg_block', 'registration', 'flag', 10, 'Стандартний блок про реєстрацію й анкету (5 рядків)', REG_BLOCK_LINES.join('\n'), { visibleFor: ['balanced'] }),
  sys('squads_fixed', 'squads', 'flag', 10, 'Склади публікуються і не міняються на прохання; заміни — лише адмін',
    'Склади команд публікуються на сторінці турніру і не змінюються на прохання гравців. Заміни робить лише адмін — у разі неявки або дискваліфікації.',
    { visibleFor: ['balanced'] }),
  sys('reserve', 'squads', 'choice', 20, 'Резерв', '', {
    options: [
      { value: 'latest', label: 'останні за часом реєстрації', text: "Гравці, які не потрапили в команди через кількість (останні за часом реєстрації), утворюють резерв і заміняють тих, хто не з'явився на старт." },
      { value: 'random', label: 'випадково', text: "Гравці, які не потрапили в команди через кількість (обрані випадково жеребкою), утворюють резерв і заміняють тих, хто не з'явився на старт." },
    ],
    defaultValue: 'latest', visibleFor: ['balanced'], affects: 'reserve',
  }),
];

const BUILTIN_BY_KEY = new Map(BUILTIN_RULE_ITEMS.map((i) => [i.key, i]));

export const isRuleGroup = (x: unknown): x is RuleGroup => typeof x === 'string' && (RULE_GROUPS as string[]).includes(x);
export const isRuleKind = (x: unknown): x is RuleKind => typeof x === 'string' && (RULE_KINDS as string[]).includes(x);
export const isRuleFormat = (x: unknown): x is RuleFormat => typeof x === 'string' && (RULE_FORMATS as string[]).includes(x);
export const isSystemRuleKey = (key: string): boolean => SYSTEM_RULE_KEYS.includes(key);

const cloneOptions = (o: RuleOption[] | null): RuleOption[] | null => (o ? o.map((x) => ({ ...x })) : null);

function normalizeOptions(raw: unknown): RuleOption[] | null {
  if (!Array.isArray(raw)) return null;
  const out: RuleOption[] = [];
  for (const o of raw as unknown[]) {
    if (!o || typeof o !== 'object') continue;
    const r = o as Record<string, unknown>;
    const value = typeof r.value === 'string' ? r.value : typeof r.value === 'number' ? String(r.value) : '';
    if (!value || out.some((x) => x.value === value)) continue;
    out.push({ value, label: typeof r.label === 'string' ? r.label : value, text: typeof r.text === 'string' ? r.text : '' });
  }
  return out;
}

/** Рядок БД (snake_case) або вже нормалізований обʼєкт (camelCase) → RuleItem;
 * null — без ключа (сміття). Системні ключі: kind/affects/isSystem — з коду,
 * значення варіантів kx/reserve — теж з коду (їх читає жеребка), з БД беруться
 * лише підписи й тексти. Доданий рядок ніколи не отримує affects. */
export function normalizeRuleItem(raw: unknown): RuleItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const pick = (a: string, b: string): unknown => (r[a] !== undefined ? r[a] : r[b]);
  const key = typeof r.key === 'string' ? r.key.trim() : '';
  if (!key) return null;
  const code = BUILTIN_BY_KEY.get(key) ?? null;
  const kind: RuleKind = code ? code.kind : isRuleKind(r.kind) ? r.kind : 'flag';
  const grp: RuleGroup = isRuleGroup(r.grp) ? r.grp : code?.grp ?? 'battle';
  const dbOptions = normalizeOptions(r.options);
  let options: RuleOption[] | null = null;
  if (kind === 'choice') {
    if (code?.affects && code.options) {
      options = code.options.map((o) => {
        const d = dbOptions?.find((x) => x.value === o.value);
        return d ? { value: o.value, label: d.label, text: d.text } : { ...o };
      });
    } else {
      options = dbOptions && dbOptions.length ? dbOptions : cloneOptions(code?.options ?? null) ?? [];
    }
  }
  const rawDefault = pick('default_value', 'defaultValue');
  let defaultValue: RuleDefault;
  if (kind === 'choice') {
    defaultValue = typeof rawDefault === 'string' && options!.some((o) => o.value === rawDefault) ? rawDefault : options![0]?.value ?? null;
  } else if (kind === 'number') {
    defaultValue = typeof rawDefault === 'number' && Number.isFinite(rawDefault) ? rawDefault : typeof code?.defaultValue === 'number' ? code.defaultValue : 0;
  } else {
    defaultValue = rawDefault !== false;
  }
  const rawFormats = pick('visible_for', 'visibleFor');
  const formats = Array.isArray(rawFormats) ? RULE_FORMATS.filter((f) => (rawFormats as unknown[]).includes(f)) : [];
  const labelRaw = pick('label_admin', 'labelAdmin');
  const textRaw = pick('text_player', 'textPlayer');
  const sortRaw = r.sort;
  return {
    key, grp, kind,
    labelAdmin: typeof labelRaw === 'string' && labelRaw.trim() ? labelRaw : code?.labelAdmin ?? key,
    textPlayer: typeof textRaw === 'string' ? textRaw : code?.textPlayer ?? '',
    options, defaultValue,
    visibleFor: formats.length ? formats : code ? [...code.visibleFor] : [...ALL_FORMATS],
    affects: code?.affects ?? null,
    isSystem: !!code,
    sort: typeof sortRaw === 'number' && Number.isFinite(sortRaw) ? sortRaw : code?.sort ?? 0,
    archived: r.archived === true,
  };
}

const GROUP_ORDER: Record<RuleGroup, number> = { battle: 0, registration: 1, squads: 2 };

/** Порядок показу: група → sort → ключ (стабільно при однакових sort). */
export function sortItems(items: RuleItem[]): RuleItem[] {
  return [...items].sort((a, b) => GROUP_ORDER[a.grp] - GROUP_ORDER[b.grp] || a.sort - b.sort || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Рядки з БД + системні рядки, яких у БД ще немає (новий ключ у коді після
 * міграції) — щоб party_buffs/kx/reserve завжди були в довіднику. */
export function mergeCatalog(dbItems: RuleItem[]): RuleItem[] {
  const keys = new Set(dbItems.map((i) => i.key));
  return sortItems([...dbItems, ...BUILTIN_RULE_ITEMS.filter((b) => !keys.has(b.key)).map((b) => ({ ...b, options: cloneOptions(b.options), visibleFor: [...b.visibleFor] }))]);
}

/** Ключ доданого адміном рядка: 'c_' + 8 hex. */
export function newCustomKey(rand: () => number = Math.random): string {
  let hex = '';
  while (hex.length < 8) hex += Math.floor(rand() * 16).toString(16);
  return 'c_' + hex.slice(0, 8);
}

/** Порожній доданий рядок групи: галочка, дефолт ✓, усі формати, у кінець групи. */
export function blankRuleItem(grp: RuleGroup, items: RuleItem[], key: string = newCustomKey()): RuleItem {
  const maxSort = Math.max(0, ...items.filter((i) => i.grp === grp).map((i) => i.sort));
  return { key, grp, kind: 'flag', labelAdmin: '', textPlayer: '', options: null, defaultValue: true, visibleFor: [...ALL_FORMATS], affects: null, isSystem: false, sort: maxSort + 10, archived: false };
}

// ── Формат турніру ─────────────────────────────────────────────

export function formatOf(teamSize: number | null | undefined, teamMode: TeamMode): RuleFormat {
  if (!teamSize || teamSize < 2) return 'solo';
  return teamMode === 'balanced_random' ? 'balanced' : 'fixed';
}

/** Перший рядок тексту правил: «1х1» / «3х3, готові команди» / «3х3, балансний фул-рандом». */
export function formatLabel(teamSize: number | null | undefined, teamMode: TeamMode): string {
  const f = formatOf(teamSize, teamMode);
  if (f === 'solo') return '1х1';
  return `${teamSize}х${teamSize}, ${f === 'balanced' ? 'балансний фул-рандом' : 'готові команди'}`;
}

/** Рядки довідника для формату — без архівованих, у порядку показу. */
export function itemsForFormat(items: RuleItem[], format: RuleFormat): RuleItem[] {
  return sortItems(items.filter((i) => !i.archived && i.visibleFor.includes(format)));
}

// ── Текст рядка і знімок ───────────────────────────────────────

/** Текст гравцю для стану рядка: вибір → текст варіанта (порожній = не
 * згадувати), число → підстановка {value}, галочка/текст → як є. */
export function textOfItem(item: Pick<RuleItem, 'kind' | 'textPlayer' | 'options'>, value: RuleDefault | undefined): string {
  if (item.kind === 'choice') return item.options?.find((o) => o.value === String(value))?.text ?? '';
  if (item.kind === 'number') return item.textPlayer.replace(/\{value\}/g, value == null ? '' : String(value));
  return item.textPlayer;
}

/** Стан рядка «за замовчуванням» — так він потрапляє в знімок нового турніру. */
export function defaultFlagItem(item: RuleItem): TournamentRuleFlagItem {
  switch (item.kind) {
    case 'choice': {
      const v = typeof item.defaultValue === 'string' ? item.defaultValue : item.options?.[0]?.value ?? '';
      return { key: item.key, value: v, text: textOfItem(item, v) };
    }
    case 'number': {
      const v = typeof item.defaultValue === 'number' ? item.defaultValue : 0;
      return { key: item.key, on: true, value: v, text: textOfItem(item, v) };
    }
    case 'text':
      return { key: item.key, on: true, text: item.textPlayer };
    default:
      return { key: item.key, on: item.defaultValue !== false, text: item.textPlayer };
  }
}

/** Який текст довідник дав би рядку знімка зараз — для підказки «у довіднику
 * текст змінився» в попапі (без автозаміни). */
export function catalogTextFor(item: RuleItem, fi: Pick<TournamentRuleFlagItem, 'value'>): string {
  if (item.kind === 'choice' || item.kind === 'number') return textOfItem(item, fi.value ?? (item.kind === 'number' ? item.defaultValue : undefined));
  return item.textPlayer;
}

/** Дефолти довідника для формату турніру (знімок нового турніру / публічна сторінка). */
export function defaultFlagsFor(items: RuleItem[], teamSize: number | null | undefined, teamMode: TeamMode): TournamentRuleFlags {
  return { v: 1, items: itemsForFormat(items, formatOf(teamSize, teamMode)).map(defaultFlagItem), extra: [] };
}

/** Чи входить рядок знімка в текст: знята галочка або порожній текст
 * (варіант «не згадувати») — ні. */
export function flagItemEnabled(fi: TournamentRuleFlagItem): boolean {
  return fi.on !== false && fi.text.trim() !== '';
}

/** Провідні «•», «-», «–», «—» і пробіли — щоб «Додатково» і старий текст не
 * давали «• • …». */
export function stripBullet(line: string): string {
  return line.replace(/^[\s•\-–—]+/, '').trim();
}

/** Пункти правил без маркерів: увімкнені рядки знімка (багаторядковий текст —
 * по пункту на рядок), потім «Додатково». */
export function renderRulesPoints(flags: TournamentRuleFlags): string[] {
  const points: string[] = [];
  for (const fi of flags.items) {
    if (!flagItemEnabled(fi)) continue;
    for (const line of fi.text.split(/\r?\n/)) {
      const p = stripBullet(line);
      if (p) points.push(p);
    }
  }
  for (const line of flags.extra) {
    const p = stripBullet(line);
    if (p) points.push(p);
  }
  return points;
}

/** Текст правил турніру (tournaments.rules_md): перший рядок — формат, далі
 * «• пункт». Рахується зі знімка, а не з довідника — старі турніри не змінюються. */
export function renderRulesMd(flags: TournamentRuleFlags, teamSize: number | null | undefined, teamMode: TeamMode): string {
  return [formatLabel(teamSize, teamMode), ...renderRulesPoints(flags).map((p) => `• ${p}`)].join('\n');
}

/** «Перейти на конструктор» для старого турніру: дефолти довідника + старий
 * текст по рядках у «Додатково» (дублі адмін прибирає сам). */
export function flagsFromLegacyText(text: string | null | undefined, items: RuleItem[], teamSize: number | null | undefined, teamMode: TeamMode): TournamentRuleFlags {
  const flags = defaultFlagsFor(items, teamSize, teamMode);
  const header = formatLabel(teamSize, teamMode);
  const lines = (text ?? '').split(/\r?\n/).map(stripBullet).filter(Boolean);
  flags.extra = lines[0] === header ? lines.slice(1) : lines;
  return flags;
}

/** Текст правил → заголовок (перший рядок без маркера, коли далі йдуть
 * пункти) і пункти — для списку на сторінці реєстрації. Старий вільний текст
 * теж читається: кожен непорожній рядок = пункт. */
export function parseRulesMd(md: string | null | undefined): { title: string | null; points: string[] } {
  const raw = (md ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (raw.length === 0) return { title: null, points: [] };
  const bulleted = (l: string) => /^[•\-–—]/.test(l);
  const title = !bulleted(raw[0]) && raw.length > 1 && bulleted(raw[1]) ? raw[0] : null;
  return { title, points: (title ? raw.slice(1) : raw).map(stripBullet).filter(Boolean) };
}

/** Короткі підписи станів ⚙-рядків — тими ж словами, що й рядок довіри
 * жеребки (ruleFlags.describeSnapshotBuffs): «пачка ✓» без слова «бафи» не читалось. */
const KX_SHORT: Record<string, string> = { unset: 'не задано (за шкалою)', kx: 'усі під КХ', noKx: 'без КХ' };
const RESERVE_SHORT: Record<string, string> = { latest: 'останні за часом', random: 'випадково' };

/** Чіпи для редактора турніру — що зі знімка піде в жеребку:
 * «бафи: від своєї пачки · КХ: не задано (за шкалою) · резерв: останні за
 * часом». Лише рядки, які є у знімку. */
export function drawSummary(flags: TournamentRuleFlags | null | undefined, items: RuleItem[]): string[] {
  if (!flags) return [];
  const chips: string[] = [];
  const optionLabel = (key: string, value: unknown, short: Record<string, string>): string => {
    const v = String(value);
    if (short[v]) return short[v];
    return items.find((i) => i.key === key)?.options?.find((o) => o.value === v)?.label ?? v;
  };
  for (const fi of flags.items) {
    if (fi.key === 'party_buffs') chips.push(`бафи: ${fi.on === false ? 'не рахуються' : 'від своєї пачки'}`);
    else if (fi.key === 'kx') chips.push(`КХ: ${optionLabel('kx', fi.value, KX_SHORT)}`);
    else if (fi.key === 'reserve') chips.push(`резерв: ${optionLabel('reserve', fi.value, RESERVE_SHORT)}`);
  }
  return chips;
}

/** Що саме зробить жеребка з ⚙-рядком у його поточному стані — простими
 * словами під рядком у попапі правил: ГМ вкладки «Правила» з підказками
 * довідника не бачить, а знята галочка «лише від своєї пачки» мовчки вимикає
 * бафи в жеребці (resolveBuffOptions → source 'none'). Рядки без впливу — null. */
export function drawEffectHint(fi: TournamentRuleFlagItem): string | null {
  switch (fi.key) {
    case 'party_buffs':
      return fi.on === false
        ? 'галочку знято — бафи можна брати від будь-кого, тож команди вони не розрізняють: жеребка НЕ рахуватиме бафи тімейтів у силі команди (сила = гір), а на сторінці турніру буде «бафи: не рахувались»'
        : 'жеребка рахує бафи тімейтів у силі команди (сила = гір + бафи), якщо у шкалі балів увімкнено «Враховувати бафи»';
    case 'kx':
      return fi.value === 'kx'
        ? 'жеребка бере колонку таблиці бафів «під КХ» (бафи Танка й Приста там менші)'
        : fi.value === 'noKx'
          ? 'жеребка бере колонку таблиці бафів «без КХ»'
          : 'колонку таблиці бафів (без КХ / під КХ) жеребка візьме за замовчуванням зі шкали балів';
    case 'reserve':
      return fi.value === 'random'
        ? 'у резерв підуть випадкові гравці — селект «Резерв» у модалці формування стане в це положення'
        : 'у резерв підуть останні за часом реєстрації — селект «Резерв» у модалці формування стане в це положення';
    default:
      return null;
  }
}
