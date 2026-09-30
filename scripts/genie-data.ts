// =========================================================
// Генератор даних джина з PW Хелпера (pw-calc). Пише три файли:
//   src/data/genieSkills.ts               — таблиця правил, назви, позиції іконок
//   src/doll/data/genie/genie-text.json   — тексти вмінь сегментами (без HTML)
//   src/data/genie2.png                   — спрайт іконок (копія 1:1)
// У CI не запускається; результат лежить у репо. Перезапускати, коли в
// Хелпері змінилась таблиця калькулятора джина, тексти вмінь або спрайт.
//
// Запуск:  npx vite-node scripts/genie-data.ts [--force]
// PW_CALC_DIR — тека калькулятора (за замовчуванням ../pw-calc). Якщо три
// вихідні файли мають локальні зміни — стоп: позначка GENIE_SYNC_COMMIT
// брехала б (--force ігнорує).
//
// Тексти в Хелпері — HTML. Тут вони розбираються ЛИШЕ за відомими токенами;
// будь-що інше з «<», «>» чи «&» зупиняє скрипт: сирий HTML не має потрапити
// в дані ляльки (у src/doll рендер лише React-вузлами).
// =========================================================

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const CALC = path.resolve(process.env.PW_CALC_DIR || '../pw-calc');
const SRC_CALC = 'src/lib/genieCalc.ts';
const SRC_JSON = 'public/assets/data/skills/genie.json';
const SRC_PNG = 'public/assets/skills/genie2.png';
const OUT_TABLE = path.resolve('src/data/genieSkills.ts');
const OUT_TEXT = path.resolve('src/doll/data/genie/genie-text.json');
const OUT_PNG = path.resolve('src/data/genie2.png');
const FORCE = process.argv.includes('--force');

// ---------- вхід ----------

interface CalcSkill {
  ref: number;
  level: number;
  aff: number[];
  cls: number;
  ter: number;
}
interface CalcModule {
  CALC: Map<number, CalcSkill>;
  INITIAL_REFS: Set<number>;
}
interface SrcSkill {
  ref: number;
  page: number;
  posx: number;
  posy: number;
  name: string;
  tpl: string;
  levels: number;
  stats: Record<string, string[]>;
}

function syncCommit(): string {
  const git = (...args: string[]) => execFileSync('git', ['-C', CALC, ...args], { encoding: 'utf8' }).trim();
  const head = git('rev-parse', '--short', 'HEAD');
  const dirty = git('status', '--porcelain', '--', SRC_CALC, SRC_JSON, SRC_PNG);
  if (dirty) {
    const msg = 'у калькуляторі є локальні зміни даних джина:\n' + dirty;
    if (!FORCE) throw new Error(msg + '\n(запустити з --force, якщо це навмисно)');
    console.warn('УВАГА: ' + msg);
  }
  return head;
}

// ---------- тексти: HTML Хелпера → сегменти ----------

type Tone = 'label' | 'num' | 'genie' | 'dark' | 'warn';
type Seg = { t: string; c?: Tone } | { f: string; c?: Tone } | { br: 1 };

/** Клас span у Хелпері → тон. genie3 і червоний інлайновий колір — обмеження місцевості. */
const CLASS_TONE: Record<string, Tone> = { culti: 'label', bleuclair: 'num', genie: 'genie', genie2: 'genie', dark: 'dark', genie3: 'warn' };
const WARN_STYLE = 'color:#ff6b6b';

// Відомі токени розмітки; решта тексту не має містити «<», «>», «&».
const TOKEN = /<span class="([a-z0-9]+)">|<span class=([a-z0-9]+)>|<span style="([^"]*)">|<span>|<\/span>|<br \/>|\{\{(\d+)\}\}/g;

function parseTpl(ref: number, tpl: string): Seg[] {
  const out: Seg[] = [];
  // Стек тонів: вкладений span без класу успадковує тон зовнішнього (як колір у CSS).
  const stack: Array<Tone | undefined> = [];
  const tone = () => stack[stack.length - 1];
  const fail = (what: string): never => {
    throw new Error(`вміння ${ref}: ${what}`);
  };
  const text = (s: string) => {
    if (!s) return;
    if (/[<>&]/.test(s)) fail('невідома розмітка в тексті: ' + JSON.stringify(s.slice(0, 80)));
    const c = tone();
    const last = out[out.length - 1];
    if (last && 't' in last && last.c === c) last.t += s;
    else out.push(c ? { t: s, c } : { t: s });
  };
  let pos = 0;
  for (const m of tpl.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    text(tpl.slice(pos, at));
    pos = at + m[0].length;
    const cls = m[1] ?? m[2];
    if (cls !== undefined) {
      if (!CLASS_TONE[cls]) fail('невідомий клас span «' + cls + '»');
      stack.push(CLASS_TONE[cls]);
    } else if (m[3] !== undefined) {
      if (m[3] !== WARN_STYLE) fail('невідомий стиль span «' + m[3] + '»');
      stack.push('warn');
    } else if (m[0] === '<span>') stack.push(tone());
    else if (m[0] === '</span>') {
      if (!stack.length) fail('зайвий </span>');
      stack.pop();
    } else if (m[0] === '<br />') out.push({ br: 1 });
    else {
      const c = tone();
      out.push(c ? { f: m[4], c } : { f: m[4] });
    }
  }
  text(tpl.slice(pos));
  if (stack.length) fail('незакритий span');
  return out;
}

// ---------- збірка ----------

async function main(): Promise<void> {
  const commit = syncCommit();
  const calc = (await import(/* @vite-ignore */ pathToFileURL(path.join(CALC, SRC_CALC)).href)) as CalcModule;
  const src = (JSON.parse(fs.readFileSync(path.join(CALC, SRC_JSON), 'utf8')) as { skills: SrcSkill[] }).skills;

  // Таблиця калькулятора й картки вмінь мають описувати ті самі вміння.
  const byRef = new Map(src.map((s) => [s.ref, s]));
  if (byRef.size !== src.length) throw new Error('genie.json: ref повторюється');
  const missing = [...calc.CALC.keys()].filter((r) => !byRef.has(r));
  const extra = src.filter((s) => !calc.CALC.has(s.ref)).map((s) => s.ref);
  if (missing.length || extra.length) throw new Error(`набори ref різні: без картки ${missing.join(',') || '—'}; без правил ${extra.join(',') || '—'}`);

  // Початкові вміння — ті, що мають один рівень; список має збігатися з INITIAL_REFS калькулятора
  // (і з INITIAL_REFS у src/data/genie.ts — це стереже genieSkills.test.ts).
  const single = src.filter((s) => s.levels === 1).map((s) => s.ref).sort((a, b) => a - b);
  const initial = [...calc.INITIAL_REFS].sort((a, b) => a - b);
  if (single.join() !== initial.join()) throw new Error(`початкові вміння: у картках ${single.join(',')}, у калькуляторі ${initial.join(',')}`);

  // Виправлення даних Хелпера: «Жало» (10001) записане в клітинку «Помсти» (сторінка 2,
  // клітинка 2,0). За пікселями спрайта його іконка — сторінка 1, клітинка (2,0):
  // єдина зайнята клітинка верхнього ряду без запису.
  const fixed = src.map((s) => (s.ref === 10001 ? { ...s, page: 1, posx: 2, posy: 0 } : s));

  // Порядок дерева: сторінка → ряд → колонка.
  fixed.sort((a, b) => a.page - b.page || a.posy - b.posy || a.posx - b.posx);
  const cells = new Set<string>();
  for (const s of fixed) {
    const k = s.page + ':' + s.posx + ':' + s.posy;
    if (cells.has(k)) throw new Error(`вміння ${s.ref}: клітинка іконки ${k} уже зайнята`);
    cells.add(k);
    if (s.page !== 1 && s.page !== 2) throw new Error(`вміння ${s.ref}: невідома сторінка ${s.page}`);
    if (!s.name || /[<>&"\\]/.test(s.name) || s.name !== s.name.trim()) throw new Error(`вміння ${s.ref}: підозріла назва ${JSON.stringify(s.name)}`);
  }

  // --- таблиця ---
  const hex = (n: number) => '0x' + n.toString(16);
  const rows = fixed.map((s) => {
    const c = calc.CALC.get(s.ref)!;
    if (c.aff.length !== 5) throw new Error(`вміння ${s.ref}: стихій не 5`);
    return `  [${[s.ref, c.level, ...c.aff, hex(c.cls), hex(c.ter), s.page, s.posx, s.posy, JSON.stringify(s.name), s.levels].join(', ')}],`;
  });
  const table = [
    '// =========================================================',
    '// Вміння джина: правила калькулятора, назви й позиції іконок у спрайті.',
    '// ЗГЕНЕРОВАНО scripts/genie-data.ts із PW Хелпера (pw-calc: src/lib/genieCalc.ts',
    '// і public/assets/data/skills/genie.json) — не правити руками. Оновити:',
    '//   npx vite-node scripts/genie-data.ts',
    '// Модуль без імпортів і поза src/doll: його бере й головний бандл (попап гравця).',
    '// Читати через src/data/genie.ts — там ті самі рядки з іменованими полями.',
    '// =========================================================',
    '',
    '/** Коміт pw-calc, з якого взято дані джина. */',
    `export const GENIE_SYNC_COMMIT = '${commit}';`,
    '',
    '/** [ref, рівень джина, метал, дерево, земля, вода, вогонь, маска класів (0 = усі),',
    ' *  маска місцевості (0 = всюди), сторінка спрайта, колонка, ряд, назва, кількість рівнів]',
    ' *  — у порядку дерева вмінь: сторінка → ряд → колонка. */',
    'export type GenieSkillRow = [number, number, number, number, number, number, number, number, number, number, number, number, string, number];',
    '',
    'export const GENIE_SKILL_ROWS: GenieSkillRow[] = [',
    ...rows,
    '];',
    '',
  ].join('\n');

  // --- тексти ---
  const texts: Array<[string, unknown]> = [];
  let segs = 0;
  for (const s of fixed) {
    const d = parseTpl(s.ref, s.tpl);
    segs += d.length;
    // У st — ключі, які підставляються в текст, плюс '0' (потрібний рівень джина) і
    // '1' (дух для вивчення) по рівнях вміння — для перемикача рівнів у картці вміння.
    const st: Record<string, string[]> = {};
    for (const k of ['0', '1']) {
      const arr = s.stats[k];
      if (!Array.isArray(arr) || arr.length !== s.levels) throw new Error(`вміння ${s.ref}: stats['${k}'] не має ${s.levels} значень`);
      for (const v of arr) if (typeof v !== 'string' || /[<>&]/.test(v)) throw new Error(`вміння ${s.ref}: підозріле stats['${k}']: ${JSON.stringify(v)}`);
      st[k] = arr;
    }
    for (const seg of d) {
      if (!('f' in seg)) continue;
      const arr = s.stats[seg.f];
      if (!Array.isArray(arr) || arr.length !== s.levels) throw new Error(`вміння ${s.ref}: для {{${seg.f}}} немає ${s.levels} значень`);
      for (const v of arr) if (typeof v !== 'string' || /[<>&]/.test(v)) throw new Error(`вміння ${s.ref}: підозріле значення {{${seg.f}}}: ${JSON.stringify(v)}`);
      st[seg.f] = arr;
    }
    texts.push([String(s.ref), { lv: s.levels, d, st }]);
  }
  const text = '{\n' + texts.map(([k, v]) => JSON.stringify(k) + ': ' + JSON.stringify(v)).join(',\n') + '\n}\n';

  fs.mkdirSync(path.dirname(OUT_TEXT), { recursive: true });
  fs.writeFileSync(OUT_TABLE, table);
  fs.writeFileSync(OUT_TEXT, text);
  fs.copyFileSync(path.join(CALC, SRC_PNG), OUT_PNG);

  const kb = (f: string) => (fs.statSync(f).size / 1024).toFixed(0) + ' КБ';
  console.log(`джин: ${fixed.length} вмінь, ${segs} сегментів тексту, коміт pw-calc ${commit}`);
  console.log(`розміри: genieSkills.ts ${kb(OUT_TABLE)}, genie-text.json ${kb(OUT_TEXT)}, genie2.png ${kb(OUT_PNG)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
