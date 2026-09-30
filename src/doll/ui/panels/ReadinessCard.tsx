// =========================================================
// ЛЯЛЬКА — картка «Готовність до турніру» (права колонка B3): попередній скор
// з ляльки (кільце), тир, «Клас · рівень · збірка», атака й живучість
// Головного (×N відносно еталона класу, коли еталон є) і дрібний рядок «Лялька
// бачить» — що вона визначила сама з надітих речей (грейди зброї й броні,
// камені, трактат, джин, ШГ/Вознєс, кільця — з DollFacts). Рахує завжди
// Головний без бафів, незалежно від вкладки й режиму «У бою»; бали класу — для
// команди 3×3, як в еталонах шкали (сторінка персонажа турніру не знає).
// Чого не можна порахувати (вбудована шкала без еталонів, режим «вимкнено»,
// немає зброї, роздано більше очок, ніж дає рівень) — «—» і пояснення, жодного NaN.
//
// useReadiness — спільний розрахунок для цієї картки й плашки стану
// (StatusPlate): факти ляльки, попередній скор і перелік «бракує / зверни
// увагу». Один розрахунок на модель + версію шкали (кеш за посиланнями);
// документ відкладено (useDeferredValue) — поле імені не чекає на перерахунок.
// =========================================================

import { useDeferredValue, useMemo } from 'react';
import { hasRefData } from '../../core/refdata';
import type { Item } from '../../core/types';
import { getItem } from '../../data/catalog';
import { BUILD_LABELS, CLASS_LABELS, gearParts, gemMixLabel, ringsLabel, rulesFor, type GearRules } from '../../../data/gearRules';
import { useRules } from '../../../data/rulesStore';
import { attrPointsLeft, type CharacterDoc } from '../../model/doc';
import type { CharacterModel, ItemLookup } from '../../model/hydrate';
import { PREVIEW_TEAM_SIZE, dollScorePreview, readinessIssues, type ReadinessIssues, type ScorePreview } from '../../model/readiness';
import { CLS_CHAR, dollFacts, genieOf, type DollFacts } from '../../model/sheet';
import { DollCard } from '../DollCard';
import { useEditor } from '../EditorContext';
import '../doll-panels.css';

export interface Readiness {
  /** null — не вдалося розібрати ляльку (довідники ще не готові). */
  facts: DollFacts | null;
  preview: ScorePreview | null;
  issues: ReadinessIssues;
}

/** Речі каталогу — ті самі, що вже в моделі редактора (у тестах модель гідрована
 * з диска, у застосунку — з каталогу); чого в моделі немає — з каталогу. */
function modelLookup(model: CharacterModel): ItemLookup {
  const byKey = new Map<string, Item>();
  for (const h of model.items.values()) {
    const { inst } = h;
    if (h.item) byKey.set(inst.cat + ':' + inst.id, h.item);
    (inst.g || []).forEach((gid, i) => {
      const gem = h.gems[i];
      if (gid && gem) byKey.set('ob:' + gid, gem);
    });
    if (inst.w && h.wdf) byKey.set('wdf:' + inst.w, h.wdf);
    if (inst.c && h.crystal) byKey.set('crystal:' + inst.c, h.crystal);
  }
  return (cat, id) => byKey.get(cat + ':' + id) ?? getItem(cat, id);
}

function computeReadiness(model: CharacterModel, rules: GearRules): Readiness {
  const doc = model.doc;
  const lookup = modelLookup(model);
  try {
    const facts = dollFacts(doc, rules, lookup);
    return {
      facts,
      preview: dollScorePreview(doc, facts, rules, PREVIEW_TEAM_SIZE, lookup),
      issues: readinessIssues(doc, model, facts, rules),
    };
  } catch {
    return { facts: null, preview: null, issues: { blockers: [], notes: [] } };
  }
}

const cache = new WeakMap<CharacterModel, WeakMap<GearRules, Readiness>>();

/** Розрахунок готовності — один на модель і версію шкали. Без довідників не кешуємо:
 * такий результат не має перекрити справжній після їх завантаження. */
export function readinessFor(model: CharacterModel, rules: GearRules): Readiness {
  if (!hasRefData()) return computeReadiness(model, rules);
  let byRules = cache.get(model);
  if (!byRules) {
    byRules = new WeakMap();
    cache.set(model, byRules);
  }
  let hit = byRules.get(rules);
  if (!hit) {
    hit = computeReadiness(model, rules);
    byRules.set(rules, hit);
  }
  return hit;
}

/** Готовність персонажа в редакторі. Перемальовується, коли довантажилась шкала з бази. */
export function useReadiness(): Readiness {
  useRules();
  const api = useEditor();
  const model = useDeferredValue(api.model);
  const rules = rulesFor(null);
  return useMemo(() => readinessFor(model, rules), [model, rules]);
}

const fmt = (n: number): string => Math.round(n).toLocaleString('uk');
/** Множник відносно еталона: «×2,0». */
const mult = (x: number): string => '×' + x.toLocaleString('uk', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Чому в кільці «—» або що означає число — пояснення під кільцем. */
function scoreWhy(p: ScorePreview | null, overspent: boolean, gearless: boolean): string | null {
  if (!p || !p.power) return 'Силу персонажа не вдалося порахувати — перевір речі на ляльці.';
  if (overspent) return 'Скору немає: роздано більше очок, ніж дає рівень — зменш атрибути.';
  if (gearless) return 'Надінь зброю й броню в Головному — без них скору немає і заявку не подати.';
  if (p.mode === 'off') return 'Скор з ляльки в шкалі ще не ввімкнено — у жеребці рахується таблиця.';
  if (!p.ref) return 'Для класу ще немає еталона — скор зʼявиться, коли адмін його додасть.';
  if (p.score == null) return 'Скор не вдалося порахувати — перевір зброю й броню.';
  if (p.mode === 'shadow') return 'Попередній: у жеребці поки рахується таблиця.';
  return null;
}

/** Слоти броні, за якими лялька судить про сет (ті самі, що в sheet.ts і в блокерах readiness). */
const ARMOR_SLOTS = ['rv', 'tg', 'rx', 'mj'] as const;

/** Рядок «Лялька бачить» — ті самі підписи й значення, що в заявці (gearParts), у вигляді
 * «Зброя: R9R2 +12 · Броня: R9 +10 · …»; чого на ляльці немає — так і пишемо («Зброї немає»,
 * «Трактат: немає»), а не грейд порожнього слота. ШГ/Вознєс — без повтору назви. */
function gearLine(r: Readiness, rules: GearRules, doc: CharacterDoc): string {
  const { facts, preview } = r;
  if (!facts || !preview?.gear) return '';
  const g = preview.gear;
  const main = doc.main;
  const armorWorn = ARMOR_SLOTS.some((s) => !!main[s]);
  const tractWorn = !!main.qn || doc.sets.some((s) => !!s.slots.qn); // трактат — найкращий з Головного й сетів
  const hasGenie = genieOf(doc) != null;
  return gearParts(g, gemMixLabel(facts.gemCounts, rules) || undefined)
    .map((p) => {
      switch (p.key) {
        case 'weapon':
          return facts.weaponRefine ? 'Зброя: ' + p.value : 'Зброї немає';
        case 'armor':
          return armorWorn ? 'Броня: ' + p.value : 'Броні немає';
        case 'tract':
          return tractWorn ? 'Трактат: ' + p.value : 'Трактат: немає';
        case 'genie':
          return hasGenie ? 'Джин: ' + p.value : 'Джин: не заповнено';
        case 'shg':
          return p.value === 'немає' ? 'ШГ / Вознєс: немає' : p.value;
        case 'rings':
          // Порожній слот кільця — «немає», а не «Луна і нижче» з анкети.
          return 'Кільця: ' + (ringsLabel({ ...g, ring1: main.cr ? g.ring1 : null, ring2: main.cd ? g.ring2 : null }) || 'немає');
        default:
          return p.label + ': ' + p.value;
      }
    })
    .join(' · ');
}

export function ReadinessCard() {
  const api = useEditor();
  const r = useReadiness();
  const rules = rulesFor(null);
  const { facts, preview, issues } = r;
  const doc = api.doc;
  const ready = !!facts && issues.blockers.length === 0;
  // Роздано більше очок, ніж дає рівень, — такої ляльки в грі не буває, скор і множники не показуємо.
  const overspent = attrPointsLeft(doc.level, doc.attrs) < 0;
  // Без зброї чи броні заявку не подати — число й множники голої ляльки лише збивали б з пантелику.
  const gearless = !!facts && (!facts.weaponRefine || !facts.armorRefine);
  const noScore = overspent || gearless;
  const score = preview && preview.mode !== 'off' && !noScore ? preview.score : null;
  const tier = score != null ? preview?.tier ?? null : null;
  const why = scoreWhy(preview, overspent, gearless);
  const power = preview?.power ?? null;
  const offMult = noScore ? null : preview?.offMult ?? null;
  const defMult = noScore ? null : preview?.defMult ?? null;
  const gear = gearLine(r, rules, doc);

  return (
    <DollCard
      title="Готовність до турніру"
      className="doll-ready"
      extra={facts ? <span className={'doll-card-pill ' + (ready ? 'good' : 'warn')}>{ready ? 'готовий' : 'не готовий'}</span> : undefined}
    >
      <div className="doll-ready-main">
        <div className={'doll-ready-ring' + (score != null && ready ? ' good' : '')} role="img" aria-label={score != null ? 'Скор ' + score : 'Скору ще немає'}>
          <b>{score != null ? fmt(score) : '—'}</b>
          <span>скор</span>
        </div>
        <div className="doll-ready-info">
          <div className="doll-ready-id">
            {tier && <span className={'badge tier tier-' + tier}>{tier}</span>}
            <span>
              {CLASS_LABELS[CLS_CHAR[doc.cls]]} · {doc.level}
              {facts ? ' · ' + BUILD_LABELS[facts.build] : ''}
            </span>
          </div>
          <div className="doll-ready-tiles">
            <div className="doll-ready-tile">
              <span>Атака{offMult != null ? ' ' + mult(offMult) : ''}</span>
              <b>{power ? fmt(power.off) : '—'}</b>
            </div>
            <div className="doll-ready-tile">
              <span>Живучість{defMult != null ? ' ' + mult(defMult) : ''}</span>
              <b>{power ? fmt(power.def) : '—'}</b>
            </div>
          </div>
        </div>
      </div>
      {why && <p className="doll-ready-why">{why}</p>}
      {gear && (
        <p className="doll-ready-gear">
          <span>Лялька бачить:</span> {gear}
        </p>
      )}
      <p className="doll-pn-note doll-ready-note">
        Попередній скор: Головний без бафів, бали класу — для команди 3×3; у жеребці ще корекції адміна.
      </p>
    </DollCard>
  );
}

export default ReadinessCard;
