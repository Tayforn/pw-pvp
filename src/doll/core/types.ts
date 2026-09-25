// =========================================================
// ЛЯЛЬКА — типи стану й довідників ядра.
// Порт із pw-calc src/lib/doll/types.ts + інтерфейси даних із
// src/modules/doll/data.ts (Item, SlotDef, SetDef, BuffDef, SkillDef).
// Без SavedBuild/EditorTarget — вони належали інтерфейсу Хелпера.
// =========================================================

/** Річ каталогу mypers. Поля стат лишаються «як є» — їх читає stats.ts. */
export interface Item {
  id: number;
  an: number; // індекс іконки у спрайті категорії
  mi: number | string;
  name: string;
  hf?: number | string; // рівень предмета
  ir?: string; // обмеження (клас/тип зброї/тип броні)
  type?: string;
  pg?: string;
  [k: string]: unknown;
}

export interface SlotDef {
  slot: string; // унікальний ключ слота
  cat: string; // категорія даних (для кілець cr/cd → oq)
  label: string; // UA-підпис
}

export interface SetDef {
  name: string;
  zn: Record<string, { type: string; val: number }>; // поріг (к-сть деталей) → бонус
  pieces: number;
  xh?: Array<{ qo: string; id: number; name: string }>; // деталі сета (категорія + id + імʼя)
}

export interface BuffDef {
  id: number;
  an: number;
  name: string;
  nameRs?: string; // назва світлої сторони (мудрець)
  nameJe?: string; // назва темної сторони (демон)
  types: string[]; // коди ефектів (gs_oi_av, tb, fw, …)
  lm: Record<string, number>; // базові значення + параметри (oj_for_fu, ve, mp, channel, vy, vw)
  qc: Record<string, unknown>; // масштабування за рівнем (0..11, rs=світл/je=темн)
  do_by?: number; // клас-кастер (sm); відсутній = глобальний (усім)
  ex?: number[]; // id стейтів для взаємовиключності (варіанти: Вспышка ци/…)
}

export interface SkillDef {
  id: number;
  an: number;
  name: string;
  pm: number; // множник фіз. атаки (thw/jee + половинні + %)
  mm: number; // множник маг. атаки (dll/jka/vxq/zdb/jgr/uux + %)
  flat: number; // плоский урон скіла (cpg/nmp + стихійні флети)
  mag: number; // 1 = редукція за маг./стихійним захистом цілі
}

/** Річ, відкладена в рюкзак Хелпера. Лишено для сумісності імпорту (backpack у DollState). */
export interface BackpackEntry {
  item: Item;
  slot: string; // оригінальний слот
  cat: string; // категорія (для іконки)
  gems: Array<Item | null>;
  refine: number;
  addons: Array<{ type: string; val: number }>;
  engrave?: Array<{ type: string; val: number }>; // гравіювання (ручні стати, mypers item_engrave)
  wdf?: Item | null; // руна шліфовки (зброя)
  crystal?: Item | null; // кристал (зброя)
}

/** Повний білд ляльки — вхід ядра. У pvp його збирає model/hydrate.ts із документа персонажа. */
export interface DollState {
  cls: string;
  gender: 'm' | 'f';
  level: number;
  str: number;
  dex: number;
  vit: number;
  mag: number;
  server: string;
  equipped: Record<string, Item>;
  gems: Record<string, Array<Item | null>>; // slot → камені в гніздах
  refine: Record<string, number>; // slot → рівень заточки (0..12)
  addons: Record<string, Array<{ type: string; val: number }>>; // slot → стати речі (непорожній список ЗАМІНЮЄ базу)
  engrave: Record<string, Array<{ type: string; val: number }>>; // slot → гравіювання
  wdf: Record<string, Item | null>; // slot → руна шліфовки (зброя)
  crystal: Record<string, Item | null>; // slot → кристал (зброя)
  buffCfg: Record<string, { on: boolean; lvl: number; side: string }>; // id бафа → налаштування
  extraBuffs: number[]; // додані вручну (через пошук) бафи інших класів
  backpack: Array<BackpackEntry | null>; // інвентар Хелпера (не враховується; у pvp завжди [])
  titles: Record<string, number>; // «Титули» — сумарні доповнення (mypers ik), кап 3000 на поле
}

/** Дефолтний (порожній) білд. */
export function defaultState(): DollState {
  return {
    cls: 'by',
    gender: 'm',
    level: 105,
    str: 5,
    dex: 5,
    vit: 5,
    mag: 5,
    server: 'noServer',
    equipped: {},
    gems: {},
    refine: {},
    addons: {},
    engrave: {},
    wdf: {},
    crystal: {},
    buffCfg: {},
    extraBuffs: [],
    backpack: [],
    titles: {},
  };
}

/** Результат перевірки вимог речі. */
export interface ReqCheck {
  ok: boolean;
  lvl: boolean;
  str: boolean;
  dex: boolean;
  mag: boolean;
  cls: boolean;
}

/** Модель моба-мішені (як `yos` у mypers) — поля з екрана «налаштувати суперника». */
export interface OppMob {
  name: string;
  hp: number;
  level: number;
  physAtkMin: number;
  physAtkMax: number;
  magAtkMin: number;
  magAtkMax: number;
  acc: number; // міткість
  eva: number; // ухилення
  physDef: number; // фіз. захист (сире значення)
  lw: number; // метал
  mo: number; // дерево
  dn: number; // вода
  vt: number; // вогонь
  sp: number; // земля
}

export interface SkillDmg {
  min: number;
  max: number;
  critMin: number;
  critMax: number;
}

/** Запис логу «перевірки урону»: замість HTML-рядка Хелпера — дані для рендера. */
export interface DmgLogEntry {
  id: number; // порядковий номер запису
  mob: string; // імʼя мішені
  skill: string; // назва вміння
  an: number; // індекс іконки вміння у спрайті yo.png
  d: SkillDmg;
}

/** Контекст надітої речі для тултіпа: камені, заточка, гравіювання, шліфовка. */
export interface TipCtx {
  gems?: Array<Item | null>;
  refine?: number;
  isBook?: boolean;
  isWeapon?: boolean;
  engrave?: Array<{ type: string; val: number }>;
  addons?: Array<{ type: string; val: number }>; // відредаговані «Характеристики» (додані понад базу — показуються)
  wdf?: Item | null;
  crystal?: Item | null;
}
