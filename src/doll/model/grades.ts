// =========================================================
// ЛЯЛЬКА — грейди шкали з надітих речей: зброя, сет броні, кільця, трактат.
// Грейд визначається ЛИШЕ за річчю каталогу (її id → запис бази: репутація
// reputa_uo, ранг hf, зірки tv, комплект ps, pw_id, рівень oj, базові стати
// nw.wu). Правки гравця на екземплярі (заточка, камені, «свої роли»,
// гравіювання) на грейд не впливають — рішення власника 30.09.2026: «у речі
// має бути id відповідно бази, характеристики можуть бути злегка змінені».
// Нерозпізнане не блокує: зараховується нижчий грейд, а «підозріла» річ
// (правило дало найнижчий грейд, хоча річ схожа на топову) — привід
// попередити гравця (sheet.ts, gradeNotes). Правила, родини, які не
// розпізнаються, і як оновлювати — docs/doll.md, «Грейди з надітих речей».
// =========================================================

import type { ArmorSet, RingGrade, Tract, WeaponGrade } from '../../data/types';
import type { Item } from '../core/types';

// ── Правила (лише числа каталогу; назви речей не потрібні) ──────────

/** Репутація (reputa_uo): R9 — 300 000, R8 і R8R — 200 000. */
const REP_R9 = 300000;
const REP_R8 = 200000;
/** Зірки (tv): дві, три; 21 — Нірвана третього касту. */
const TV_TWO = 42;
const TV_THREE = 43;
const TV_N3 = 21;

/** Зброя R9 (300 000, ранг 16): дві зірки → R9; три у комплекті з бронею (ps) → R9R1, без комплекту → R9R2. */
const WEAPON_R9_HF = 16;
/** Зброя R8R: 200 000, ранг 15. */
const WEAPON_R8R_HF = 15;
/** ЦГД / РЦГД: зброя 80 рівня, ранг 16, фіксований ПА (сума nw.wu 'ad') ≥ 50.
 * РЦГД — три зірки або ПА ≥ 65 (у каталозі новіша версія гри: ЦГД 50, РЦГД 65;
 * на сервері 30 і 50 — власник 30.09.2026). */
const CGD = { oj: 80, hf: 16, minPa: 50, rcgdPa: 65 } as const;
/** Нірвана — рівень 100 без репутації. Перший каст — ранг 13 і pw_id із
 * діапазону чи списку; другий — ранг 15 з двома зірками; третій — ранг 16, tv 21. */
const NIRVANA_OJ = 100;
const NIRVANA_1_HF = 13;
const NIRVANA_1_PW = { from: 25947, to: 25984 } as const;
const NIRVANA_1_PW_EXTRA: ReadonlySet<number> = new Set([26596, 26598, 26599, 26601, 44933]);
const NIRVANA_2 = { hf: 15, tv: TV_TWO } as const;
const NIRVANA_3 = { hf: 16, tv: TV_N3 } as const;

/** Броня R9: 300 000, або четвертий каст — 200 000, ранг 16, три зірки, рівень 101. */
const ARMOR_R9_ALT = { rep: REP_R8, hf: 16, tv: TV_THREE, oj: 101 } as const;
/** Броня R8R: 200 000, ранг 15, рівень 100. */
const ARMOR_R8R = { hf: 15, oj: 100 } as const;
/** Сет броні — за 4 речами: нагрудник, поножі, взуття, наручі (порожній слот — «інше»). */
const ARMOR_SET_MAJORITY = 3;

/** Кільця поза репутацією — за id каталогу. */
const RING_SILVER: ReadonlySet<number> = new Set([180, 181]);
const RING_PKS: ReadonlySet<number> = new Set([174, 177]);

/** Трактат: найменший ранг (hf) → рядок шкали; нижче 4 і без рангу — t1_3. */
const TRACT_BY_HF: ReadonlyArray<readonly [number, Tract]> = [[9, 'emperor'], [8, 't8'], [7, 't7'], [6, 't6'], [4, 't4_5']];

/** «Підозріла» зброя чи броня — правило дало «інше», але є репутація, або
 * фіксований ПА ≥ 10, або рівень ≥ 100 і ранг ≥ 15. Кільце «Луна» — ПА+ПЗ ≥ 2. */
const SUSPECT_PA = 10;
const SUSPECT_OJ = 100;
const SUSPECT_HF = 15;
const SUSPECT_RING_PA_PZ = 2;

// ── Поля речі ─────────────────────────────────────────────────────

const num = (v: unknown) => Number(v) || 0;
const rep = (it: Item) => num(it.reputa_uo);
const hf = (it: Item) => num(it.hf);
const tv = (it: Item) => num(it.tv);
const oj = (it: Item) => num(it.oj);
/** Сума базових стат каталогу одного коду (nw.wu), напр. 'ad' — фіксований ПА. */
function baseStat(it: Item, type: string): number {
  const nw = it.nw as { wu?: Array<{ type?: string; val?: unknown }> } | undefined;
  let sum = 0;
  if (nw && Array.isArray(nw.wu)) for (const w of nw.wu) if (w && w.type === type) sum += num(w.val);
  return sum;
}

/** Грейд речі й чи варто попередити, що лялька могла її не розпізнати. */
export interface Graded<G> {
  grade: G;
  suspicious: boolean;
}

/** Грейд окремої речі броні (сет рахує armorSetOf). */
export type ArmorPiece = 'r9' | 'r8r' | 'nirvana' | 'other';

const suspectGear = (it: Item) => rep(it) > 0 || baseStat(it, 'ad') >= SUSPECT_PA || (oj(it) >= SUSPECT_OJ && hf(it) >= SUSPECT_HF);

/** Грейд зброї (перша умова, що спрацювала). */
export function weaponGradeOf(it: Item): Graded<WeaponGrade> {
  const grade = weaponRule(it);
  return { grade, suspicious: grade === 'other' && suspectGear(it) };
}

function weaponRule(it: Item): WeaponGrade {
  const pa = baseStat(it, 'ad');
  if (rep(it) === REP_R9 && hf(it) === WEAPON_R9_HF) {
    if (tv(it) === TV_TWO) return 'r9';
    if (tv(it) === TV_THREE) return it.ps != null ? 'r9r1' : 'r9r2';
  }
  if (rep(it) === REP_R8 && hf(it) === WEAPON_R8R_HF) return 'r8r';
  if (oj(it) === CGD.oj && hf(it) === CGD.hf && pa >= CGD.minPa) return tv(it) === TV_THREE || pa >= CGD.rcgdPa ? 'rcgd' : 'cgd';
  if (oj(it) === NIRVANA_OJ && !rep(it)) {
    const pw = num(it.pw_id);
    const first = hf(it) === NIRVANA_1_HF && ((pw >= NIRVANA_1_PW.from && pw <= NIRVANA_1_PW.to) || NIRVANA_1_PW_EXTRA.has(pw));
    const second = hf(it) === NIRVANA_2.hf && tv(it) === NIRVANA_2.tv;
    const third = hf(it) === NIRVANA_3.hf && tv(it) === NIRVANA_3.tv;
    if (first || second || third) return 'nirvana';
  }
  return 'other';
}

/** Грейд однієї речі броні (слоти rv, tg, rx, mj). */
export function armorPieceOf(it: Item): Graded<ArmorPiece> {
  const grade = armorRule(it);
  return { grade, suspicious: grade === 'other' && suspectGear(it) };
}

function armorRule(it: Item): ArmorPiece {
  const alt = rep(it) === ARMOR_R9_ALT.rep && hf(it) === ARMOR_R9_ALT.hf && tv(it) === ARMOR_R9_ALT.tv && oj(it) === ARMOR_R9_ALT.oj;
  // Лише ранг 16: з тією ж репутацією в каталозі є броня «томления» 80 рівня рангу 10.
  if ((rep(it) === REP_R9 && hf(it) === WEAPON_R9_HF) || alt) return 'r9';
  if (rep(it) === REP_R8 && hf(it) === ARMOR_R8R.hf && oj(it) === ARMOR_R8R.oj) return 'r8r';
  if (oj(it) === NIRVANA_OJ && !rep(it)) {
    if ((hf(it) === NIRVANA_2.hf && tv(it) === NIRVANA_2.tv) || (hf(it) === NIRVANA_3.hf && tv(it) === NIRVANA_3.tv)) return 'nirvana';
  }
  return 'other';
}

/** Сет броні з 4 речей Головного (нагрудник, поножі, взуття, наручі; null —
 * порожній слот). suspicious — речі, які лялька могла не розпізнати. */
export function armorSetOf(pieces: ReadonlyArray<Item | null>): { grade: ArmorSet; suspicious: Item[] } {
  let n9 = 0; // R9
  let n8 = 0; // R8R або R9
  let nN = 0; // Нірвана
  const suspicious: Item[] = [];
  for (const it of pieces) {
    if (!it) continue;
    const p = armorPieceOf(it);
    if (p.grade === 'r9') n9++;
    if (p.grade === 'r9' || p.grade === 'r8r') n8++;
    if (p.grade === 'nirvana') nN++;
    if (p.suspicious) suspicious.push(it);
  }
  let grade: ArmorSet = 'other';
  if (n9 >= ARMOR_SET_MAJORITY) grade = 'r9';
  else if (n8 >= ARMOR_SET_MAJORITY) grade = 'r8r';
  else if (n8 === 2 || (n8 === 1 && nN >= 2)) grade = 'nirvana_r8_mix';
  else if (n8 + nN >= ARMOR_SET_MAJORITY) grade = 'nirvana';
  return { grade, suspicious };
}

/** Грейд кільця (слоти cr, cd); порожній слот — «Луна і нижче». */
export function ringGradeOf(it: Item | null): Graded<RingGrade> {
  if (!it) return { grade: 'moon', suspicious: false };
  let grade: RingGrade = 'moon';
  if (rep(it) === REP_R9) grade = tv(it) === TV_THREE ? 'r9r1' : 'r9';
  else if (RING_SILVER.has(num(it.id))) grade = 'silver';
  else if (RING_PKS.has(num(it.id))) grade = 'pks';
  return { grade, suspicious: grade === 'moon' && baseStat(it, 'ad') + baseStat(it, 'sx') >= SUSPECT_RING_PA_PZ };
}

/** Грейд трактату (слот qn) — за рангом, тож розпізнається завжди; порожній слот — t1_3. */
export function tractOf(it: Item | null): Graded<Tract> {
  const h = it ? hf(it) : 0;
  const row = TRACT_BY_HF.find(([min]) => h >= min);
  return { grade: row ? row[1] : 't1_3', suspicious: false };
}
