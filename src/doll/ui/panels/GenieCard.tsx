// =========================================================
// ЛЯЛЬКА — картка «Джин» у правій колонці (розкладка B3, між «Пасивками
// класу» і плашкою стану). Шапка: пігулка «+N у скор» (бали шкали за удачею,
// genieBucket(genieScoreLuck)) і тиха кнопка «вміння ›» → вікно джина. Рядок:
// кнопка виду (річ у слоті pk Головного), поля «Рів.» і «Удача», пігулка
// діапазону шкали («удача 91–99»). Нижче — 8 слотів вмінь (клік відкриває
// вміння у вікні; порожні 5–8 підписані удачею, без якої їх не відкрити) і
// три підсумки, червоні при порушенні: мін. рівень джина, треба удачі,
// спорідненість («Спорідн.» — щоб підпис не обрізався в колонці 328 px).
// Попередження словами (genieWarnings) — у плашці стану.
//
// Іконка виду НЕ має класу doll-icon: димовий тест рахує такі іконки як
// надіті речі. Правила і числа — src/data/genie.ts; у документ ідуть лише
// коректні числа (GenieNum: локальний текст у фокусі). Тексти вмінь (JSON)
// картка не тягне — лише таблицю.
// =========================================================

import { useState, type CSSProperties } from 'react';
import { GENIE_LABELS, rulesFor } from '../../../data/gearRules';
import {
  GENIE_MAX_LEVEL, GENIE_MAX_LUCK, GENIE_MAX_SKILLS, affPointsAtLevel, affRequirements, genieBucket, genieScoreLuck, genieSkill, minGenieLevel, neededLucky,
  type GenieCfg,
} from '../../../data/genie';
import { genieIconStyle } from '../../../data/genieIcon';
import { useRules } from '../../../data/rulesStore';
import { iconStyle } from '../../data/assets';
import { setGenieLevel, setGenieLuck } from '../../model/ops';
import { itemDisplayName } from '../../model/tipModel';
import { DollCard } from '../DollCard';
import { useEditor } from '../EditorContext';
import '../doll-panels.css';

/** Удача, без якої не відкрити слот вміння з цим номером (5–8). */
export const SLOT_LUCK: Record<number, number> = { 5: 51, 6: 71, 7: 81, 8: 91 };

/** Число з локальним текстом: поки поле у фокусі, показується те, що набрали,
 * а в документ іде лише коректне число (операція сама обрізає до меж).
 * value null — поле порожнє (джина ще не заповнено). */
export function GenieNum({
  id, value, min, max, disabled, onCommit, label, className, placeholder,
}: {
  id?: string;
  value: number | null;
  min: number;
  max: number;
  disabled?: boolean;
  onCommit(n: number): void;
  label: string;
  className?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = value == null ? '' : String(value);
  return (
    <input
      id={id}
      type="number"
      inputMode="numeric"
      className={className}
      aria-label={label}
      disabled={disabled}
      min={min}
      max={max}
      step={1}
      placeholder={placeholder}
      value={text ?? shown}
      onFocus={() => setText(shown)}
      onBlur={() => setText(null)}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const n = Number(t);
        if (t.trim() !== '' && Number.isFinite(n)) onCommit(n);
      }}
    />
  );
}

export interface GenieSums {
  /** Мінімальний рівень джина для набору; bad — рівень джина нижчий. */
  minLevel: number;
  /** Потрібна удача для стількох вмінь на цьому рівні; bad — удачі бракує. */
  luck: number;
  /** Сума очок спорідненості набору і скільки їх дає рівень. */
  aff: number;
  affHave: number;
}

/** Три підсумки картки з конфігурації джина (чисті числа без NaN). */
export function genieSums(g: GenieCfg): GenieSums {
  return {
    minLevel: minGenieLevel(g.skills),
    luck: neededLucky(g.level, Math.min(g.skills.length, GENIE_MAX_SKILLS)),
    aff: affRequirements(g.skills).reduce((a, b) => a + b, 0),
    affHave: affPointsAtLevel(g.level),
  };
}

export interface GenieCardViewProps {
  /** doc.genie; undefined — джина ще не заповнено. */
  genie: GenieCfg | undefined;
  /** Річ у слоті pk Головного (вид джина); null — слот порожній. */
  kind: { name: string; icon: CSSProperties } | null;
  /** Бали шкали за цього джина (0, коли не заповнено). */
  points: number;
  /** Діапазон зі старої анкети (doc.sheet.genie), поки блок джина не заповнено; бали тоді йдуть за ним. */
  legacy?: string | null;
  /** Підпис діапазону шкали («удача 91–99»); для незаповненого — пігулка «не заповнено». */
  rangeLabel: string;
  readOnly: boolean;
  onOpen(ref?: number): void;
  onLevel(n: number): void;
  onLuck(n: number): void;
}

/** Чиста частина картки — без контексту редактора (для тестів). */
export function GenieCardView({ genie, kind, points, rangeLabel, legacy, readOnly, onOpen, onLevel, onLuck }: GenieCardViewProps) {
  const sums = genie ? genieSums(genie) : null;
  const n = genie ? genie.skills.length : 0;
  const slots = Array.from({ length: GENIE_MAX_SKILLS }, (_, i) => genie?.skills[i]);
  // Підпис підсумку в картці 328 px — коротко й повністю (без трикрапки): «Спорідн.» з повною назвою в підказці.
  const sum = (key: string, value: string, sub: string, bad: boolean, short?: string) => (
    <div className={'doll-genie-sum' + (bad ? ' bad' : '')} key={key} title={short ? key : undefined}>
      <div className="doll-genie-sum-k">{short ?? key}</div>
      <div className="doll-genie-sum-v">
        {value}
        {sub && <span> {sub}</span>}
      </div>
    </div>
  );
  return (
    <DollCard
      title="Джин"
      className="doll-genie"
      extra={
        <>
          {genie ? (
            <span className="doll-card-pill good" title={'Бали шкали за джина: ' + rangeLabel}>
              +{points} у скор
            </span>
          ) : legacy ? (
            <span className="doll-card-pill warn" title="Бали поки зі старої анкети — заповни блок джина, і вони підуть за ним">
              зі старої анкети: {legacy} · +{points}
            </span>
          ) : (
            <span className="doll-card-pill warn" title="Заповни рівень, удачу й вміння — за джина поки 0 балів">
              не заповнено
            </span>
          )}
          <button type="button" className="doll-card-act" onClick={() => onOpen()}>
            вміння ›
          </button>
        </>
      }
    >
      <div className="doll-genie-row">
        <button
          type="button"
          className={'doll-genie-kind' + (kind ? '' : ' is-empty')}
          aria-label={'Вид джина: ' + (kind ? kind.name : 'не обрано')}
          title={kind ? kind.name : 'Вид джина не обрано — обери у вікні'}
          onClick={() => onOpen()}
        >
          {kind ? <span className="doll-genie-kind-img" style={kind.icon} /> : 'вид'}
        </button>
        <label className="doll-genie-f">
          Рів.
          <GenieNum
            className="doll-genie-in"
            label="Рівень джина"
            value={genie ? genie.level : null}
            min={1}
            max={GENIE_MAX_LEVEL}
            disabled={readOnly}
            placeholder="—"
            onCommit={onLevel}
          />
        </label>
        <label className="doll-genie-f">
          Удача
          <GenieNum
            className="doll-genie-in luck"
            label="Удача джина"
            value={genie ? genie.luck : null}
            min={0}
            max={GENIE_MAX_LUCK}
            disabled={readOnly}
            placeholder="—"
            onCommit={onLuck}
          />
        </label>
        {genie && (
          <span className="doll-genie-range" title={'Рядок шкали «Джин» за удачею ' + genieScoreLuck(genie)}>
            {rangeLabel}
          </span>
        )}
      </div>

      <div className="doll-genie-slots" role="group" aria-label={'Вміння джина: ' + n + ' з ' + GENIE_MAX_SKILLS}>
        {slots.map((ref, i) => {
          const s = ref != null ? genieSkill(ref) : undefined;
          if (ref != null) {
            return (
              <button
                key={i}
                type="button"
                className="doll-genie-slot"
                aria-label={'Вміння ' + (i + 1) + ': ' + (s ? s.name : 'невідоме #' + ref)}
                title={s ? s.name : 'невідоме вміння #' + ref}
                onClick={() => onOpen(ref)}
              >
                {s ? <span className="doll-genie-slot-img" style={genieIconStyle(ref)} /> : '?'}
              </button>
            );
          }
          const need = SLOT_LUCK[i + 1];
          const short = !!need && (!genie || genie.luck < need);
          return (
            <button
              key={i}
              type="button"
              className={'doll-genie-slot is-empty' + (short ? ' is-short' : '')}
              aria-label={'Слот ' + (i + 1) + ': порожній' + (need ? ', потрібна удача від ' + need : '')}
              title={need ? 'Слот ' + (i + 1) + ' відкривається з удачі ' + need : 'Порожній слот — обери вміння у вікні'}
              onClick={() => onOpen()}
            >
              {need ? String(need) : ''}
            </button>
          );
        })}
      </div>

      <div className="doll-genie-sums">
        {sums && genie
          ? [
              sum('Мін. рівень', String(sums.minLevel), 'є ' + genie.level, sums.minLevel > genie.level),
              sum('Треба удачі', String(sums.luck), 'є ' + genie.luck, sums.luck > genie.luck),
              sum('Спорідненість', String(sums.aff), 'з ' + sums.affHave, sums.aff > sums.affHave, 'Спорідн.'),
            ]
          : [sum('Мін. рівень', '—', '', false), sum('Треба удачі', '—', '', false), sum('Спорідненість', '—', '', false, 'Спорідн.')]}
      </div>
    </DollCard>
  );
}

export function GenieCard() {
  useRules(); // бали за джина — з поточної шкали; перемалюватись, коли вона довантажиться
  const api = useEditor();
  const { doc, model, readOnly } = api;
  const genie = doc.genie;
  const rules = rulesFor(null);
  const bucket = genie ? genieBucket(genieScoreLuck(genie)) : 'g60';
  // Старий персонаж без блоку джина: бали йдуть зі старої анкети (genieOf) — так і показуємо.
  const legacyBucket = !genie ? doc.sheet?.genie ?? null : null;
  const pkIid = doc.main.pk;
  const h = pkIid ? model.items.get(pkIid) : undefined;
  const kind = h?.item ? { name: itemDisplayName(h.item, 'pk'), icon: iconStyle(h.item, 'pk', doc.gender) } : null;
  return (
    <GenieCardView
      genie={genie}
      kind={kind}
      points={genie ? rules.genie[bucket] : legacyBucket ? rules.genie[legacyBucket] : 0}
      rangeLabel={GENIE_LABELS[bucket]}
      legacy={legacyBucket ? GENIE_LABELS[legacyBucket] : null}
      readOnly={readOnly}
      onOpen={(ref) => api.openGenie(ref)}
      onLevel={(n) => api.apply((d) => setGenieLevel(d, n))}
      onLuck={(n) => api.apply((d) => setGenieLuck(d, n))}
    />
  );
}

export default GenieCard;
