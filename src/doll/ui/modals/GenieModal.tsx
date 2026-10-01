// =========================================================
// ЛЯЛЬКА — вікно джина (варіант Д1): збирання вмінь. Оболонка xl із двома
// панелями (ModalShell + doll-modal-split). Смуга керування — два рядки:
// 1) «Вид» і пігулки виду (5 речей каталогу pk → слот pk Головного, «без
// джина» — зняти); 2) рівень і удача з кроками −/+, «макс. N», праворуч
// пігулка діапазону шкали й балів. Ліворуч: «Збірка n/8» (клік по слоту —
// прибрати), 4 підсумки й 5 стихій, пошук, «Наземні / Усі 91» (типово
// «Наземні» ховає 10 вмінь, що працюють лише у воді чи в повітрі), «лише доступні»,
// сітка плиток 32 px зі спрайта (src/data/genieIcon.ts). Праворуч — картка
// вміння: назва, рівні 1–10 лише для чисел тексту, факти з таблиці правил
// (рівень джина від, спорідненість, клас, місцевість), опис із сегментів
// (useGenieText — JSON тягнеться лише тут), «Якщо додати / прибрати», унизу
// кнопка «Додати в джина» / «Прибрати з джина» або вимкнена з причиною.
// Тіло картки й низ із кнопкою — прямі діти тіла вікна (сітка на десктопі,
// колонка на вузькому екрані): так на телефоні низ прилипає до краю вікна,
// а не до картки, що лежить під сіткою.
//
// Зміни пишуться одразу (api.apply, операції model/ops.ts); «Готово» і
// хрестик лише закривають. Клік по плитці відкриває вміння в картці, додає
// кнопка, Enter/пробіл або подвійний клік. Клавіатура в сітці: одна плитка
// з tabIndex 0 (поточна), стрілки ±1 / ±колонки (колонки рахуються з
// розмітки — на вузькому екрані їх не 13), Home/End; Esc закриває оболонка.
// Недоступна плитка (opacity, aria-disabled) фокусується й відкривається в
// картці — там причина. readOnly — лише перегляд: без кнопок змін.
// =========================================================

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CLASS_LABELS, GENIE_LABELS, rulesFor } from '../../../data/gearRules';
import {
  GENIE_ELEMENTS, GENIE_MAX_LEVEL, GENIE_MAX_LUCK, GENIE_MAX_SKILLS, GENIE_SKILLS, INITIAL_REFS, TERRAIN_AIR, TERRAIN_LAND, TERRAIN_WATER,
  affPointsAtLevel, affRequirements, clsBit, genieBucket, genieScoreLuck, genieSkill, maxLuckAtLevel, minGenieLevel, neededLucky, whyBlocked,
  type GenieBlock, type GenieCfg, type GenieSkill,
} from '../../../data/genie';
import { genieIconStyle } from '../../../data/genieIcon';
import { useRules } from '../../../data/rulesStore';
import type { Item } from '../../core/types';
import { catItems, isStaleDataError, useCatalog } from '../../data/catalog';
import { genieSkillText, useGenieText } from '../../data/genieText';
import { CLS_KEYS } from '../../model/doc';
import { CFG_MAIN } from '../../model/hydrate';
import { LIMIT_TEXT, clearGenieSkills, pickFromCatalog, setGenieLevel, setGenieLuck, toggleGenieSkill, unequip, type LimitReason } from '../../model/ops';
import { CLS_CHAR } from '../../model/sheet';
import { itemDisplayName } from '../../model/tipModel';
import { useEditor } from '../EditorContext';
import { GenieText } from '../genie/GenieText';
import { GenieNum, SLOT_LUCK, genieSums } from '../panels/GenieCard';
import { isCoarsePointer } from '../tip/useTip';
import { ModalShell } from './ModalShell';
import '../doll-panels.css';

export type GenieTerrain = 'land' | 'all';

/** Джин, якого ще не заповнювали: так його бачать і операції (ops.genieOr). */
const EMPTY_GENIE: GenieCfg = { level: 1, luck: 0, skills: [] };

/** Наземне вміння: без обмеження місцевості або з сушею в масці;
 * перемикач «Наземні» ховає лише ті, що тільки для води чи повітря. */
export function onLand(s: GenieSkill): boolean {
  return !((s.ter & (TERRAIN_WATER | TERRAIN_AIR)) !== 0 && (s.ter & TERRAIN_LAND) === 0);
}

/** Плитки сітки за фільтрами: місцевість, пошук за назвою, «лише доступні» (у збірці — лишаються). */
export function genieGridRows(opts: { terrain: GenieTerrain; q: string; onlyAvail: boolean; cfg: GenieCfg; bit: number }): GenieSkill[] {
  const q = opts.q.trim().toLowerCase();
  return GENIE_SKILLS.filter((s) => {
    if (opts.terrain === 'land' && !onLand(s)) return false;
    if (q && !s.name.toLowerCase().includes(q)) return false;
    if (opts.onlyAvail && !opts.cfg.skills.includes(s.ref) && whyBlocked(s.ref, opts.cfg, opts.bit)) return false;
    return true;
  });
}

/** Причина, чому вміння не додати, — словами для картки й aria-label плитки. */
export function genieBlockText(b: GenieBlock): string {
  switch (b.code) {
    case 'unknown':
      return 'цього вміння вже немає в таблиці';
    case 'full':
      return 'у джина лише ' + GENIE_MAX_SKILLS + ' вмінь — спершу прибери якесь';
    case 'initial':
      return 'початкове вміння в джина лише одне';
    case 'class':
      return 'не для цього класу';
    case 'level':
      return 'треба рівень джина ' + b.need + ', є ' + b.have;
    case 'luck':
      return 'треба удачу ' + b.need + ', є ' + b.have;
  }
}

/** Класи з маски вміння — назвами сайту; '' — для всіх. */
export function classText(mask: number): string {
  if (!mask) return '';
  return CLS_KEYS.filter((k) => (clsBit(k) & mask) !== 0)
    .map((k) => CLASS_LABELS[CLS_CHAR[k]])
    .join(', ');
}

/** Обмеження місцевості словами («лише на суші та в повітрі»); '' — всюди. */
export function terrainText(ter: number): string {
  if (!ter) return '';
  const parts: string[] = [];
  if (ter & TERRAIN_LAND) parts.push('на суші');
  if (ter & TERRAIN_WATER) parts.push('у воді');
  if (ter & TERRAIN_AIR) parts.push('в повітрі');
  return 'лише ' + parts.join(' та ');
}

/** Коротка назва виду для пігулки: «Душа Тай Чин» → «Тай Чин», «Прическа 'Тао Лі'» → «Тао Лі». */
export function kindShort(name: string): string {
  return name.replace(/^(Душа|Прическа)\s+/u, '').replace(/['"«»]/g, '').trim() || name;
}

/** Скільки плиток у рядку сітки — з розмітки (перший ряд за offsetTop), а не з константи. */
function colsOf(grid: HTMLElement | null): number {
  if (!grid) return 1;
  const kids = Array.from(grid.children) as HTMLElement[];
  if (!kids.length) return 1;
  const top = kids[0].offsetTop;
  let n = 0;
  for (const k of kids) {
    if (k.offsetTop !== top) break;
    n++;
  }
  return Math.max(1, n);
}

const LEVELS = Array.from({ length: 10 }, (_, i) => i + 1);
const sumOf = (a: readonly number[]): number => a.reduce((x, y) => x + y, 0);

function SumTile({ k, v, sub, bad }: { k: string; v: string; sub?: string; bad?: boolean }) {
  return (
    <div className={'doll-genie-sum' + (bad ? ' bad' : '')}>
      <div className="doll-genie-sum-k">{k}</div>
      <div className="doll-genie-sum-v">
        {v}
        {sub && <span> {sub}</span>}
      </div>
    </div>
  );
}

export function GenieModal({ initialRef }: { initialRef?: number }) {
  useRules(); // бали за джина — з поточної шкали
  const api = useEditor();
  const { doc, model, readOnly } = api;
  const g: GenieCfg = doc.genie ?? EMPTY_GENIE;
  const filled = !!doc.genie;
  const bit = clsBit(doc.cls);
  const rules = rulesFor(null);
  const coarse = isCoarsePointer();
  const lvlId = useId();
  const luckId = useId();

  // Вид джина — 5 речей каталогу pk; надіта — у слоті pk Головного.
  const pk = useCatalog(['pk']);
  const kinds: Item[] | null = pk.ready ? catItems('pk') : null;
  const curKind = doc.main.pk ? model.items.get(doc.main.pk) : undefined;
  const curKindId = curKind?.inst.id;

  // «Наземні» типово; якщо відкрито на вмінні лише для води/повітря — одразу «Усі», щоб його було видно.
  const [terrain, setTerrain] = useState<GenieTerrain>(() => {
    const s = initialRef != null ? genieSkill(initialRef) : undefined;
    return s && !onLand(s) ? 'all' : 'land';
  });
  const [q, setQ] = useState('');
  const [onlyAvail, setOnlyAvail] = useState(false);
  const [lvl, setLvl] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  // Вміння в картці: з пропа (слот у картці «Джин»), інакше перше з набору.
  const [cur, setCur] = useState<number | null>(initialRef ?? g.skills[0] ?? null);
  useEffect(() => {
    if (initialRef != null) setCur(initialRef);
  }, [initialRef]);

  const txt = useGenieText();

  const rows = useMemo(() => genieGridRows({ terrain, q, onlyAvail, cfg: g, bit }), [terrain, q, onlyAvail, g, bit]);
  const landN = useMemo(() => GENIE_SKILLS.filter(onLand).length, []);
  const landHint = 'Наземні: ховає ' + (GENIE_SKILLS.length - landN) + ' вмінь, що працюють лише у воді чи в повітрі';
  const availN = useMemo(
    () => GENIE_SKILLS.filter((s) => (terrain === 'all' || onLand(s)) && !g.skills.includes(s.ref) && !whyBlocked(s.ref, g, bit)).length,
    [terrain, g, bit],
  );

  const skill = cur != null ? genieSkill(cur) : undefined;
  const curRef = skill?.ref ?? null;
  // Одна плитка з tabIndex 0: поточна, якщо вона в сітці, інакше перша.
  const tabRef = rows.some((s) => s.ref === curRef) ? curRef : (rows[0]?.ref ?? null);

  const tiles = useRef(new Map<number, HTMLButtonElement>());
  const gridRef = useRef<HTMLDivElement>(null);

  const sums = genieSums(g);
  const req = affRequirements(g.skills);
  const n = g.skills.length;
  const bucket = genieBucket(genieScoreLuck(g));
  // Поки блок джина не заповнено, бали йдуть зі старої анкети (genieOf) — показуємо чесно.
  const legacyBucket = !filled ? doc.sheet?.genie ?? null : null;
  const pts = filled ? rules.genie[bucket] : legacyBucket ? rules.genie[legacyBucket] : 0;

  const close = () => api.closeModal();
  const toggle = (ref: number) => {
    if (readOnly) return;
    if (!g.skills.includes(ref) && whyBlocked(ref, g, bit)) return;
    api.apply((d) => toggleGenieSkill(d, ref));
  };
  const resetSkills = () => {
    if (readOnly || !n) return;
    if (window.confirm('Прибрати всі ' + n + ' вмінь із джина? Рівень і удача лишаться.')) api.apply(clearGenieSkills);
  };
  const pickKind = (it: Item) => {
    if (readOnly) return;
    const id = Number(it.id);
    if (id === curKindId) return;
    const p = Number((it as Record<string, unknown>).pw_id) || undefined;
    const out: { blocked?: LimitReason; kept: string | null } = { kept: null };
    api.apply((d) => {
      const r = pickFromCatalog(d, CFG_MAIN, 'pk', 'pk', id, { p });
      out.blocked = r.blocked;
      out.kept = r.kept;
      return r.doc;
    });
    if (out.blocked) setNotice(LIMIT_TEXT[out.blocked]);
    else if (out.kept) api.notify('Попередній джин лежить в інвентарі: у ньому були правки.');
  };
  const noKind = () => {
    if (readOnly) return;
    api.apply((d) => unequip(d, CFG_MAIN, 'pk'));
  };

  const focusTile = (ref: number | null) => {
    if (ref == null) return;
    setCur(ref);
    tiles.current.get(ref)?.focus();
  };
  const onGridKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!rows.length) return;
    const i = Math.max(0, rows.findIndex((s) => s.ref === curRef));
    let j: number;
    switch (e.key) {
      case 'ArrowRight':
        j = Math.min(rows.length - 1, i + 1);
        break;
      case 'ArrowLeft':
        j = Math.max(0, i - 1);
        break;
      case 'ArrowDown':
        j = Math.min(rows.length - 1, i + colsOf(gridRef.current));
        break;
      case 'ArrowUp':
        j = Math.max(0, i - colsOf(gridRef.current));
        break;
      case 'Home':
        j = 0;
        break;
      case 'End':
        j = rows.length - 1;
        break;
      case 'Enter':
      case ' ': {
        // Перемикаємо плитку, що у фокусі (не ту, що в картці).
        e.preventDefault();
        let ref: number | null = null;
        for (const [r, el] of tiles.current) if (el === document.activeElement) ref = r;
        if (ref != null) {
          setCur(ref);
          toggle(ref);
        } else if (curRef != null) toggle(curRef);
        return;
      }
      default:
        return;
    }
    e.preventDefault();
    focusTile(rows[j].ref);
  };

  // Картка вміння: стан у збірці, причина блокування, числа «якщо додати / прибрати».
  const picked = !!skill && g.skills.includes(skill.ref);
  const block = skill && !picked ? whyBlocked(skill.ref, g, bit) : null;
  const trial = skill ? (picked ? g.skills.filter((r) => r !== skill.ref) : [...g.skills, skill.ref]) : g.skills;
  const after = {
    n: trial.length,
    minLevel: minGenieLevel(trial),
    luck: neededLucky(g.level, Math.min(trial.length, GENIE_MAX_SKILLS)),
    aff: sumOf(affRequirements(trial)),
  };
  const text = skill ? genieSkillText(skill.ref) : undefined;
  const levels = skill?.levels ?? 1;
  const shownLvl = Math.min(lvl, levels);
  const classBad = !!skill && !!bit && !!skill.cls && (skill.cls & bit) === 0;

  const headExtra = (
    <>
      {!readOnly && (
        <button type="button" className="btn btn-ghost btn-sm" disabled={!n} onClick={resetSkills}>
          Скинути вміння
        </button>
      )}
      <button type="button" className="btn btn-primary btn-sm" onClick={close}>
        {readOnly ? 'Закрити' : 'Готово'}
      </button>
    </>
  );

  return (
    <ModalShell title="Джин" onClose={close} size="xl" className="doll-modal-split doll-modal-genie" headExtra={headExtra}>
      <div className="doll-gw-bar">
        <div className="doll-gw-kinds" role="group" aria-label="Вид джина">
          <span className="doll-gw-l">Вид</span>
          {kinds == null ? (
            <span className="doll-mute">
              {pk.error ? (isStaleDataError(pk.error) ? 'сайт оновився — перезавантаж сторінку' : 'каталог недоступний') : 'завантажую…'}
              {pk.error && !isStaleDataError(pk.error) && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={pk.retry}>
                  Повторити
                </button>
              )}
            </span>
          ) : (
            kinds.map((it) => {
              const name = itemDisplayName(it, 'pk');
              const on = Number(it.id) === curKindId;
              return (
                <button key={String(it.id)} type="button" className={'doll-gw-kind' + (on ? ' is-on' : '')} aria-pressed={on} title={name} disabled={readOnly} onClick={() => pickKind(it)}>
                  {kindShort(name)}
                </button>
              );
            })
          )}
          <button type="button" className={'doll-gw-kind' + (curKindId == null ? ' is-on' : '')} aria-pressed={curKindId == null} disabled={readOnly} onClick={noKind}>
            без джина
          </button>
        </div>
        <div className="doll-gw-nums">
          <div className="doll-gw-num">
            <label htmlFor={lvlId}>Рівень</label>
            <div className="doll-gw-step">
              <button type="button" aria-label="Нижчий рівень джина" disabled={readOnly || g.level <= 1} onClick={() => api.apply((d) => setGenieLevel(d, (d.genie?.level ?? 1) - 1))}>
                −
              </button>
              <GenieNum id={lvlId} value={filled ? g.level : null} min={1} max={GENIE_MAX_LEVEL} disabled={readOnly} label="Рівень джина" placeholder="—" onCommit={(v) => api.apply((d) => setGenieLevel(d, v))} />
              <button type="button" aria-label="Вищий рівень джина" disabled={readOnly || g.level >= GENIE_MAX_LEVEL} onClick={() => api.apply((d) => setGenieLevel(d, d.genie ? d.genie.level + 1 : 1))}>
                +
              </button>
            </div>
          </div>
          <div className="doll-gw-num" title={'На ' + g.level + ' рівні удача буває до ' + maxLuckAtLevel(g.level)}>
            <label htmlFor={luckId}>Удача</label>
            <div className="doll-gw-step">
              <button type="button" aria-label="Менша удача" disabled={readOnly || g.luck <= 0} onClick={() => api.apply((d) => setGenieLuck(d, (d.genie?.luck ?? 0) - 1))}>
                −
              </button>
              <GenieNum id={luckId} className="luck" value={filled ? g.luck : null} min={0} max={GENIE_MAX_LUCK} disabled={readOnly} label="Удача джина" placeholder="—" onCommit={(v) => api.apply((d) => setGenieLuck(d, v))} />
              <button type="button" aria-label="Більша удача" disabled={readOnly || g.luck >= GENIE_MAX_LUCK} onClick={() => api.apply((d) => setGenieLuck(d, (d.genie?.luck ?? 0) + 1))}>
                +
              </button>
            </div>
            {filled && <span className="doll-gw-max">макс. {maxLuckAtLevel(g.level)}</span>}
          </div>
          <span className={'doll-card-pill doll-gw-pts ' + (filled ? 'good' : 'warn')} title="Бали шкали за джина — за удачею">
            {filled ? GENIE_LABELS[bucket] + ' · +' + pts + ' у скор' : legacyBucket ? 'зі старої анкети: ' + GENIE_LABELS[legacyBucket] + ' · +' + pts + ' у скор' : 'не заповнено · 0 у скор'}
          </span>
        </div>
      </div>
      {notice && (
        <div className="doll-m-notice doll-gw-notice" role="status">
          {notice}
        </div>
      )}

      <div className="doll-gw-body">
        <div className="doll-gw-left">
          <div className="doll-gw-sec">
            <span>
              Збірка · {n} / {GENIE_MAX_SKILLS}
            </span>
            <i>{readOnly ? 'лише перегляд' : 'клік по слоту — прибрати'}</i>
          </div>
          <div className="doll-gw-build" role="group" aria-label="Збірка джина">
            {Array.from({ length: GENIE_MAX_SKILLS }, (_, i) => {
              const ref = g.skills[i];
              if (ref != null) {
                const s = genieSkill(ref);
                const name = s ? s.name : 'невідоме вміння #' + ref;
                return (
                  <button
                    key={i}
                    type="button"
                    className="doll-gw-bslot"
                    aria-label={(readOnly ? 'Відкрити: ' : 'Прибрати з джина: ') + name}
                    title={name}
                    onClick={() => (readOnly ? setCur(ref) : toggle(ref))}
                  >
                    <span className="doll-m-cell">{s ? <span className="doll-gw-img" style={genieIconStyle(ref)} /> : '?'}</span>
                    <span className="doll-gw-bslot-n">{name}</span>
                  </button>
                );
              }
              const need = SLOT_LUCK[i + 1];
              return (
                <span key={i} className={'doll-gw-bslot is-empty' + (need && g.luck < need ? ' is-short' : '')} title={need ? 'Слот відкривається з удачі ' + need : 'Вільний слот'}>
                  <span className="doll-m-cell" />
                  <span className="doll-gw-bslot-n">{need ? 'удача ' + need : 'вільний'}</span>
                </span>
              );
            })}
          </div>
          <div className="doll-gw-sums">
            <SumTile k="Умінь" v={n + ' / ' + GENIE_MAX_SKILLS} bad={n > GENIE_MAX_SKILLS} />
            <SumTile k="Мін. рівень" v={String(sums.minLevel)} sub={'є ' + g.level} bad={sums.minLevel > g.level} />
            <SumTile k="Треба удачі" v={String(sums.luck)} sub={'є ' + g.luck} bad={sums.luck > g.luck} />
            <SumTile k="Спорідненість" v={sums.aff + ' з ' + sums.affHave} sub={'вільно ' + Math.max(0, sums.affHave - sums.aff)} bad={sums.aff > sums.affHave} />
          </div>
          <div className="doll-gw-els" role="group" aria-label="Спорідненість стихій">
            {GENIE_ELEMENTS.map((name, i) => (
              <span key={name} className={'doll-gw-el el-' + i}>
                <span>{name}</span>
                <b>{req[i]}</b>
              </span>
            ))}
          </div>

          <div className="doll-gw-sec">
            <span>Усі вміння · {terrain === 'land' ? landN + ' наземних' : GENIE_SKILLS.length}</span>
            <i>можна додати: {availN}</i>
          </div>
          <div className="doll-gw-filter">
            <input
              type="search"
              className="doll-gw-search"
              placeholder="назва вміння"
              autoComplete="off"
              aria-label="Пошук вміння"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowDown') return;
                e.preventDefault();
                focusTile(tabRef);
              }}
            />
            <div className="doll-seg doll-seg-xs" role="radiogroup" aria-label="Які вміння показати" title={landHint}>
              <button type="button" role="radio" aria-checked={terrain === 'land'} className={terrain === 'land' ? 'is-on' : ''} title={landHint} onClick={() => setTerrain('land')}>
                Наземні
              </button>
              <button type="button" role="radio" aria-checked={terrain === 'all'} className={terrain === 'all' ? 'is-on' : ''} title="Усі вміння, і ті, що працюють лише у воді чи в повітрі" onClick={() => setTerrain('all')}>
                Усі {GENIE_SKILLS.length}
              </button>
            </div>
            <label className="doll-gw-avail">
              <input type="checkbox" checked={onlyAvail} onChange={(e) => setOnlyAvail(e.target.checked)} /> лише доступні
            </label>
          </div>
          <div className="doll-gw-grid" ref={gridRef} role="group" aria-label="Вміння джина" onKeyDown={onGridKey}>
            {rows.map((s) => {
              const on = g.skills.includes(s.ref);
              const blocked = on ? null : whyBlocked(s.ref, g, bit);
              const isCur = s.ref === curRef;
              return (
                <button
                  key={s.ref}
                  type="button"
                  ref={(el) => {
                    if (el) tiles.current.set(s.ref, el);
                    else tiles.current.delete(s.ref);
                  }}
                  className={'doll-gw-tile' + (on ? ' is-picked' : '') + (isCur ? ' is-cur' : '') + (blocked ? ' is-blocked' : '')}
                  style={genieIconStyle(s.ref)}
                  tabIndex={s.ref === tabRef ? 0 : -1}
                  data-autofocus={s.ref === tabRef && !coarse ? '' : undefined}
                  aria-label={s.name + (on ? ' — у збірці' : blocked ? ' — не додати: ' + genieBlockText(blocked) : '')}
                  aria-pressed={on}
                  aria-current={isCur ? 'true' : undefined}
                  aria-disabled={blocked ? true : undefined}
                  title={s.name}
                  onClick={() => setCur(s.ref)}
                  onDoubleClick={() => toggle(s.ref)}
                >
                  {on && (
                    <span className="doll-gw-mark" aria-hidden="true">
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
            {rows.length === 0 && <div className="doll-mute doll-gw-none">Нічого не знайдено.</div>}
          </div>
          <div className="doll-gw-legend" aria-hidden="true">
            <span>
              <i className="is-picked" />у збірці
            </span>
            <span>
              <i className="is-cur" />відкрите в картці
            </span>
            <span>
              <i className="is-blocked" />не додати: причина — в картці вміння
            </span>
          </div>
        </div>

        <div className="doll-gw-card-body">
          {!skill ? (
            <p className="doll-mute doll-gw-none">Обери вміння в сітці — тут буде його опис.</p>
          ) : (
            <>
              <div className="doll-gw-head">
                <span className="doll-m-cell doll-gw-hcell">
                  <span className="doll-gw-img" style={genieIconStyle(skill.ref)} />
                </span>
                <div className="doll-gw-head-t">
                  <div className="doll-gw-name">{skill.name}</div>
                  <div className="doll-gw-sub">{INITIAL_REFS.has(skill.ref) ? 'Початкове вміння · 1 рівень' : 'Вміння джина · ' + skill.levels + ' рівнів'}</div>
                </div>
              </div>
              {levels > 1 && (
                <div className="doll-gw-lvls">
                  <div className="doll-gw-hint">Рівень вміння — лише щоб подивитися числа</div>
                  <div className="doll-gw-lvlrow" role="group" aria-label="Рівень вміння">
                    {LEVELS.slice(0, levels).map((k) => (
                      <button key={k} type="button" className={k === shownLvl ? 'is-on' : ''} aria-pressed={k === shownLvl} onClick={() => setLvl(k)}>
                        {k}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <dl className="doll-gw-facts">
                <div>
                  <dt>Рівень джина від</dt>
                  <dd className={skill.level > g.level ? 'bad' : 'good'}>{skill.level}</dd>
                </div>
                <div>
                  <dt>Спорідненість</dt>
                  <dd>
                    {skill.aff.some((v) => v > 0)
                      ? GENIE_ELEMENTS.map((name, i) =>
                          skill.aff[i] > 0 ? (
                            <span key={name} className={'doll-gw-el el-' + i}>
                              <span>{name}</span>
                              <b>{skill.aff[i]}</b>
                            </span>
                          ) : null,
                        )
                      : '—'}
                  </dd>
                </div>
                {skill.cls !== 0 && (
                  <div>
                    <dt>Клас</dt>
                    <dd className={classBad ? 'bad' : ''}>{classText(skill.cls)}</dd>
                  </div>
                )}
                {skill.ter !== 0 && (
                  <div>
                    <dt>Місцевість</dt>
                    <dd>{terrainText(skill.ter)}</dd>
                  </div>
                )}
              </dl>
              {text ? (
                <GenieText text={text} level={shownLvl} />
              ) : txt.error ? (
                <div className="doll-gtext">
                  <div className="doll-m-bad">{isStaleDataError(txt.error) ? 'Сайт оновився — перезавантаж сторінку, щоб побачити опис.' : 'Не вдалося завантажити опис: ' + txt.error}</div>
                  {!isStaleDataError(txt.error) && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={txt.retry}>
                      Повторити
                    </button>
                  )}
                </div>
              ) : (
                <div className="doll-gtext doll-mute">Завантажую опис…</div>
              )}
              <div className="doll-gw-after">
                <div className="doll-gw-after-h">{picked ? 'Якщо прибрати' : 'Якщо додати'}</div>
                <div className="doll-gw-after-row">
                  <span>Умінь</span>
                  <b className={after.n > GENIE_MAX_SKILLS ? 'bad' : 'good'}>
                    {after.n} / {GENIE_MAX_SKILLS}
                  </b>
                </div>
                <div className="doll-gw-after-row">
                  <span>Мін. рівень джина</span>
                  <b className={after.minLevel > g.level ? 'bad' : 'good'}>
                    {after.minLevel} — є {g.level}
                  </b>
                </div>
                <div className="doll-gw-after-row">
                  <span>Треба удачі</span>
                  <b className={after.luck > g.luck ? 'bad' : 'good'}>
                    {after.luck} — є {g.luck}
                  </b>
                </div>
                <div className="doll-gw-after-row">
                  <span>Очки спорідненості</span>
                  <b className={after.aff > sums.affHave ? 'bad' : ''}>
                    {after.aff} з {sums.affHave}
                    {after.aff === sums.aff ? ', без змін' : after.aff > sums.aff ? ' (+' + (after.aff - sums.aff) + ')' : ' (−' + (sums.aff - after.aff) + ')'}
                  </b>
                </div>
              </div>
            </>
          )}
        </div>
        {(readOnly || skill) && (
          <div className="doll-gw-foot">
            {readOnly ? (
              <button type="button" className="btn btn-primary btn-sm doll-gw-act" onClick={close}>
                Закрити
              </button>
            ) : !skill ? null : picked ? (
              <>
                <button type="button" className="btn btn-ghost btn-sm doll-gw-act" onClick={() => toggle(skill.ref)}>
                  Прибрати з джина
                </button>
                <span className="doll-gw-keys">Enter — прибрати, стрілки — далі</span>
              </>
            ) : block ? (
              <>
                <button type="button" className="btn btn-primary btn-sm doll-gw-act" disabled>
                  Додати в джина
                </button>
                <span className="doll-gw-why">не додати: {genieBlockText(block)}</span>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-primary btn-sm doll-gw-act" onClick={() => toggle(skill.ref)}>
                  Додати в джина
                </button>
                <span className="doll-gw-keys">Enter — додати, стрілки — далі</span>
              </>
            )}
          </div>
        )}
      </div>
    </ModalShell>
  );
}

export default GenieModal;
