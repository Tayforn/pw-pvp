// =========================================================
// ЛЯЛЬКА — картка «Готовність до турніру» (права колонка B3): попередній скор
// v2 «від речей» (кільце), тир, «Клас · рівень · збірка», чипи складових
// (клас, рівень, речі, джин), дрібний рядок «Лялька бачить» — що вона
// визначила сама з надітих речей (грейди зброї й броні, камені, трактат,
// джин, ШГ/Вознєс, кільця — з DollFacts) — і згорнутий «Розклад по речах»
// (спільний ScoreBreakdown з назвами речей зі scoreItems). Рахує завжди
// Головний і сети документа за поточною версією шкали, незалежно від вкладки й
// режиму «У бою»; бали класу — для команди 3×3 (сторінка персонажа турніру не
// знає). Без еталонів, множників і режимів шкали. Скору не показуємо лише
// коли немає зброї чи броні (заявку не подати) або роздано більше очок, ніж
// дає рівень — тоді «—» і пояснення, жодного NaN.
//
// useReadiness — спільний розрахунок для цієї картки й плашки стану
// (StatusPlate): факти ляльки, попередній скор і перелік «бракує / зверни
// увагу». Один розрахунок на модель + версію шкали (кеш за посиланнями);
// документ відкладено (useDeferredValue) — поле імені не чекає на перерахунок.
// =========================================================

import { useDeferredValue, useMemo } from 'react';
import ScoreBreakdown, { fmtPoints } from '../../../components/ScoreBreakdown';
import { BUILD_LABELS, CLASS_LABELS, currentRulesVersion, gearParts, gemMixLabel, ringsLabel, rulesFor, type GearRules } from '../../../data/gearRules';
import { useRules } from '../../../data/rulesStore';
import type { PlayerGear } from '../../../data/types';
import { hasRefData } from '../../core/refdata';
import type { Item } from '../../core/types';
import { getItem } from '../../data/catalog';
import { attrPointsLeft, type CharacterDoc } from '../../model/doc';
import type { CharacterModel, ItemLookup } from '../../model/hydrate';
import { PREVIEW_TEAM_SIZE, dollScorePreview, itemNamesOf, readinessIssues, type ReadinessIssues, type ScorePreview } from '../../model/readiness';
import { CLS_CHAR, dollFacts, dollMissing, gearOfFacts, hasAnyWeapon, type DollFacts } from '../../model/sheet';
import { DollCard } from '../DollCard';
import { useEditor } from '../EditorContext';
import '../doll-panels.css';

export interface Readiness {
  /** null — не вдалося розібрати ляльку (довідники ще не готові). */
  facts: DollFacts | null;
  preview: ScorePreview | null;
  /** Legacy-анкета з ляльки — для рядка «Лялька бачить» (gearParts); null — як facts. */
  gear: PlayerGear | null;
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
    const preview = dollScorePreview(doc, rules, currentRulesVersion(), PREVIEW_TEAM_SIZE, lookup);
    return {
      facts,
      preview,
      gear: gearOfFacts(doc, facts, rules.setsFromDoll),
      issues: readinessIssues(doc, model, facts, preview.items),
    };
  } catch {
    return { facts: null, preview: null, gear: null, issues: { blockers: [], notes: [] } };
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

/** Чому в кільці «—» — пояснення під кільцем; null — число показано. */
function scoreWhy(p: ScorePreview | null, overspent: boolean, gearless: boolean): string | null {
  if (!p) return 'Скор не вдалося порахувати — перевір речі на ляльці.';
  if (overspent) return 'Скору немає: роздано більше очок, ніж дає рівень — зменш атрибути.';
  if (gearless) return 'Надінь зброю й броню в Головному — без них скору немає і заявку не подати.';
  return null;
}

/** Слоти броні, за якими лялька судить про сет (ті самі, що в sheet.ts і в блокерах readiness). */
const ARMOR_SLOTS = ['rv', 'tg', 'rx', 'mj'] as const;

/** Рядок «Лялька бачить» — ті самі підписи й значення, що в заявці (gearParts), у вигляді
 * «Зброя: R9R2 +12 · Броня: R9 +10 · …»; чого на ляльці немає — так і пишемо («Зброї немає»,
 * «Трактат: немає»), а не грейд порожнього слота. ШГ/Вознєс — без повтору назви. */
function gearLine(r: Readiness, rules: GearRules, doc: CharacterDoc, model: CharacterModel): string {
  const { facts, gear: g, preview } = r;
  if (!facts || !g) return '';
  const main = doc.main;
  const armorWorn = ARMOR_SLOTS.some((s) => !!main[s]);
  const tractWorn = !!main.qn || doc.sets.some((s) => !!s.slots.qn); // трактат — найкращий з Головного й сетів
  const hasGenie = !!preview?.genieFilled;
  return gearParts(g, gemMixLabel(facts.gemCounts, rules) || undefined)
    .map((p) => {
      switch (p.key) {
        case 'weapon':
          // Зброя лише в сеті: скор v2 рахує її, legacy-грейд тут не про неї.
          return facts.weaponRefine ? 'Зброя: ' + p.value : hasAnyWeapon(doc, model) ? 'Зброя: лише в сеті' : 'Зброї немає';
        case 'armor':
          return armorWorn ? 'Броня: ' + p.value : 'Броні немає';
        case 'tract':
          return tractWorn ? 'Трактат: ' + p.value : 'Трактат: немає';
        case 'genie':
          return hasGenie ? 'Джин: ' + p.value : 'Джин: не заповнено';
        case 'shg':
          return p.value === 'немає' ? 'ШГ / Вознєс: немає' : p.value;
        case 'rings':
          // Порожній слот кільця — «немає», а не «Луна і нижче» порожнього слота.
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
  const model = api.model;
  const ready = !!facts && issues.blockers.length === 0;
  // Роздано більше очок, ніж дає рівень, — такої ляльки в грі не буває, скор не показуємо.
  const overspent = attrPointsLeft(doc.level, doc.attrs) < 0;
  // Без зброї чи броні заявку не подати — число голої ляльки лише збивало б з пантелику.
  const gearless = !!facts && dollMissing(doc, model).length > 0;
  const shown = !!preview && !overspent && !gearless;
  const score = shown ? preview.score : null;
  const tier = shown ? preview.tier : null;
  const why = scoreWhy(preview, overspent, gearless);
  const gear = gearLine(r, rules, doc, model);
  const setNames = useMemo(() => doc.sets.map((s) => s.name), [doc.sets]);
  const resolver = useMemo(() => (preview ? itemNamesOf(preview.items) : undefined), [preview]);
  // Примітки (нерозпізнані речі, зброя в сеті, дублі) плашка стану показує повністю —
  // у розкладі їх обрізані до 80 символів копії (формат заявки) лише дублювали б.
  const breakdown = useMemo(() => (preview ? { ...preview.breakdown, warn: [] } : null), [preview]);

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
          {shown && (
            <ul className="doll-ready-parts" aria-label="Складові скору">
              <li className="doll-ready-part">
                клас <b>{fmtPoints(preview.parts.cls)}</b>
              </li>
              <li className="doll-ready-part">
                рівень <b>{fmtPoints(preview.parts.lvl)}</b>
              </li>
              <li className="doll-ready-part">
                речі <b>{fmtPoints(preview.parts.items)}</b>
              </li>
              <li className={'doll-ready-part' + (preview.genieFilled ? '' : ' warn')} title={preview.genieFilled ? undefined : 'джина не заповнено — за нього 0 балів'}>
                джин <b>{fmtPoints(preview.parts.genie)}</b>
              </li>
            </ul>
          )}
        </div>
      </div>
      {why && <p className="doll-ready-why">{why}</p>}
      {gear && (
        <p className="doll-ready-gear">
          <span>Лялька бачить:</span> {gear}
        </p>
      )}
      {shown && (
        <div className="doll-ready-bd">
          <ScoreBreakdown breakdown={breakdown} resolver={resolver} setNames={setNames} />
        </div>
      )}
      <p className="doll-pn-note doll-ready-note">Попередній скор для 3×3; на турнірі бали класу — за розміром команди, у жеребці ще корекції адміна.</p>
    </DollCard>
  );
}

export default ReadinessCard;
