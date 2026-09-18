// =========================================================
// Анкета спорядження для балансного фул-рандому — контрольований
// компонент, спільний для форми заявки гравця (RegisterPage) і модалки
// «✎» адміна (RegistrationsPanel). Компактний, на один екран десктопа:
// 8 select-ів + чекбокс ПЗ-зброї + 3 чекбокси спецсетів + згорнутий блок
// із двома числовими полями (ПА/ПЗ з вікна персонажа — калібрування,
// у v1.0 на бали не впливають). Балів не зберігає — лише показує
// орієнтовний гір-скор за таблицями gearRules.
//
// Верстка: у кожному .field-row підписи полів — в один рядок (див.
// .gear-fields у styles.css), а підказки стоять ПІД рядком, а не всередині
// колонки — інакше колонки різної висоти і селекти «скачуть».
//
// Кожне емітоване значення нормалізоване: weaponPz завжди boolean,
// specialSets завжди масив — так вимагає constraint registrations_gear_all_or_none;
// shg / voznes завжди boolean, а їхня точка — null, коли шмотки немає (0023).
// =========================================================

import type { Gems, PlayerGear, SpecialSet } from '../data/types';
import {
  ARMOR_REFINE_LABELS, ARMOR_REFINE_ORDER, ARMOR_SET_LABELS, ARMOR_SET_ORDER, CLASS_LABELS, CLASS_ORDER,
  BUILD_LABELS, BUILD_ORDER, CHAR_LEVEL_LABELS, CHAR_LEVEL_ORDER, GEMS_LABELS, GEMS_ORDER, GENIE_LABELS, GENIE_ORDER, SPECIAL_SET_HINTS, SPECIAL_SET_LABELS, SPECIAL_SET_ORDER,
  TRACT_LABELS, TRACT_ORDER, WEAPON_GRADE_LABELS, WEAPON_GRADE_ORDER, WEAPON_REFINE_LABELS, WEAPON_REFINE_ORDER,
  ITEM_REFINE_MAX, RING_LABELS, RING_ORDER, computeGearScore, rulesFor,
} from '../data/gearRules';
import { useRules } from '../data/rulesStore';

interface Props {
  value: Partial<PlayerGear>;
  onChange: (next: Partial<PlayerGear>) => void;
  attackLevel: number | null;
  defenseLevel: number | null;
  onExtraChange: (attackLevel: number | null, defenseLevel: number | null) => void;
  /** Версія таблиць балів для живого скору й видимості ПЗ-чекбокса; за замовчуванням — поточна. */
  rulesVersion?: string | null;
  /** Показувати бейдж «Орієнтовний гір-скор», коли анкета заповнена. */
  showScore?: boolean;
  /** Розмір команди турніру — від нього залежать бали за клас у скорі. */
  teamSize?: number | null;
  /** Сховати свап-сети (ПЗ / ПА / спів) і камені в них — у публічній анкеті
   * тимчасово вимкнено; анкета тоді завжди віддає specialSets=[] і без каменів.
   * Адмінка показує їх і далі (можна прибрати в старих заявках). */
  hideSpecialSets?: boolean;
}

/** Анкета заповнена — усі 10 полів на місці. Чекбокси ніколи не null:
 * компонент емітить weaponPz=false / specialSets=[] уже з першої зміни,
 * тож до моменту, коли всі 8 select-ів обрано, вони гарантовано є. */
export function isGearComplete(v: Partial<PlayerGear>): v is PlayerGear {
  return !!(
    v.charClass && v.charLevel && v.build && v.weaponGrade && v.weaponRefine && typeof v.weaponPz === 'boolean' &&
    v.armorSet && v.armorRefine && v.gems && Array.isArray(v.specialSets) &&
    v.specialSetGems && v.specialSets.every((s) => !!v.specialSetGems![s]) && // для кожного відміченого сету обрано камені
    v.tract && v.genie &&
    typeof v.shg === 'boolean' && typeof v.voznes === 'boolean' &&
    (!v.shg || v.shgRefine != null) && (!v.voznes || v.voznesRefine != null) && // відмічена шмотка — обрано точку
    v.ring1 && v.ring2 && (v.ring1 !== 'r9r1' || v.ring1Refine != null) && (v.ring2 !== 'r9r1' || v.ring2Refine != null) // обидва кільця; R9R1 — з точкою
  );
}

/** Показники з вікна персонажа: порожньо = null, інакше ціле 0–300. */
function parseLevel(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return null;
  return Math.max(0, Math.min(300, n));
}

/** Один select анкети: порожня опція «— обери —» + варіанти в заданому порядку. */
function OptionSelect<T extends string>({ label, value, options, labels, onChange }: {
  label: string;
  value: T | undefined;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (v: T | undefined) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value ?? ''} onChange={(e) => onChange((e.target.value || undefined) as T | undefined)}>
        <option value="">— обери —</option>
        {options.map((o) => <option key={o} value={o}>{labels[o]}</option>)}
      </select>
    </label>
  );
}

const REFINE_LEVELS = Array.from({ length: ITEM_REFINE_MAX + 1 }, (_, i) => String(i));
const REFINE_LEVEL_LABELS = Object.fromEntries(REFINE_LEVELS.map((l) => [l, `+${l}`])) as Record<string, string>;

/** Точка окремої шмотки (ШГ / Вознєс): +0…+12. */
function RefineSelect({ label, value, onChange }: { label: string; value: number | null; onChange: (n: number | null) => void }) {
  return (
    <OptionSelect
      label={label}
      value={value == null ? undefined : String(value)}
      options={REFINE_LEVELS}
      labels={REFINE_LEVEL_LABELS}
      onChange={(v) => onChange(v === undefined ? null : Number(v))}
    />
  );
}

export default function GearFields({ value, onChange, attackLevel, defenseLevel, onExtraChange, rulesVersion, showScore, teamSize, hideSpecialSets }: Props) {
  // Підписка на реєстр версій: коли шкала з БД довантажиться (або адмін
  // збереже нову), живий гір-скор і список сетів перемалюються.
  useRules();
  const rules = rulesFor(rulesVersion);
  const sets = value.specialSets ?? [];

  // Єдина точка виходу: зливає патч і нормалізує чекбокси (ніколи не null).
  const patch = (p: Partial<PlayerGear>) => {
    const next: Partial<PlayerGear> = { ...value, ...p };
    next.weaponPz = next.weaponPz ?? false;
    next.specialSets = hideSpecialSets ? [] : next.specialSets ?? [];
    next.specialSetGems = hideSpecialSets ? {} : next.specialSetGems ?? {};
    next.shg = next.shg ?? false;
    next.shgRefine = next.shg ? next.shgRefine ?? null : null;
    next.voznes = next.voznes ?? false;
    next.voznesRefine = next.voznes ? next.voznesRefine ?? null : null;
    next.ring1 = next.ring1 ?? null;
    next.ring1Refine = next.ring1 === 'r9r1' ? next.ring1Refine ?? null : null;
    next.ring2 = next.ring2 ?? null;
    next.ring2Refine = next.ring2 === 'r9r1' ? next.ring2Refine ?? null : null;
    onChange(next);
  };

  // Порядок у масиві — як у SPECIAL_SET_ORDER, щоб однакові відповіді давали
  // однаковий рядок; знятий сет забирає з собою і свої камені.
  const toggleSet = (s: SpecialSet, on: boolean) => {
    const nextGems = { ...(value.specialSetGems ?? {}) };
    if (!on) delete nextGems[s];
    patch({ specialSets: SPECIAL_SET_ORDER.filter((x) => (x === s ? on : sets.includes(x))), specialSetGems: nextGems });
  };
  const setSetGems = (s: SpecialSet, gems: Gems | undefined) => {
    const nextGems = { ...(value.specialSetGems ?? {}) };
    if (gems) nextGems[s] = gems; else delete nextGems[s];
    patch({ specialSetGems: nextGems });
  };

  // Приховані сети (feature flag у правилах — поки ні в кого немає) показуємо
  // лише якщо вже обрані, напр. адмін редагує анкету зі старим значенням.
  const armorSets = ARMOR_SET_ORDER.filter((s) => !rules.hiddenArmorSets.includes(s) || value.armorSet === s);

  return (
    <div className="gear-fields" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="field-row">
        <OptionSelect label="Клас" value={value.charClass} options={CLASS_ORDER} labels={CLASS_LABELS} onChange={(v) => patch({ charClass: v })} />
        <OptionSelect label="Рівень" value={value.charLevel ?? undefined} options={CHAR_LEVEL_ORDER} labels={CHAR_LEVEL_LABELS} onChange={(v) => patch({ charLevel: v ?? null })} />
        <OptionSelect label="Збірка" value={value.build ?? undefined} options={BUILD_ORDER} labels={BUILD_LABELS} onChange={(v) => patch({ build: v ?? null })} />
      </div>
      <small className="hint" style={{ marginTop: -6 }}>Збірка — куди вкладені стати: ДД (урон), гібрид, кон (HP/захист замість урону). На бали за шмот не впливає, впливає на добір складу команд.</small>

      <div className="field-row">
        <OptionSelect label="Зброя" value={value.weaponGrade} options={WEAPON_GRADE_ORDER} labels={WEAPON_GRADE_LABELS} onChange={(v) => patch({ weaponGrade: v })} />
        <OptionSelect label="Заточка зброї" value={value.weaponRefine} options={WEAPON_REFINE_ORDER} labels={WEAPON_REFINE_LABELS} onChange={(v) => patch({ weaponRefine: v })} />
      </div>
      {/* Запасна зброя з показником захисту, на яку свапаються під уроном —
          є в будь-якого грейду основної зброї, тому чекбокс показуємо завжди. */}
      <label className="checkbox-row" title="запасна зброя з показником захисту, на яку свапаєшся, щоб отримувати менше шкоди">
        <input type="checkbox" checked={!!value.weaponPz} onChange={(e) => patch({ weaponPz: e.target.checked })} />
        Є ПЗ-зброя (запасна, з показником захисту для свапу)
      </label>

      <div className="field-row">
        <OptionSelect label="Сет броні" value={value.armorSet} options={armorSets} labels={ARMOR_SET_LABELS} onChange={(v) => patch({ armorSet: v })} />
        <OptionSelect label="Круг точки" value={value.armorRefine} options={ARMOR_REFINE_ORDER} labels={ARMOR_REFINE_LABELS} onChange={(v) => patch({ armorRefine: v })} />
      </div>
      <small className="hint" style={{ marginTop: -6 }}>Круг точки — заточка броні, біжі й кілець разом; якщо нерівномірно — рівень більшості частин.</small>

      {/* Камені — за вартістю по зростанню (до 24 каменів у 6 шмотках); «мішанина» = приблизно навпіл. */}
      <div className="field-row">
        <OptionSelect label="Камні" value={value.gems} options={GEMS_ORDER} labels={GEMS_LABELS} onChange={(v) => patch({ gems: v })} />
        <OptionSelect label="Трактат" value={value.tract} options={TRACT_ORDER} labels={TRACT_LABELS} onChange={(v) => patch({ tract: v })} />
      </div>

      {!hideSpecialSets && <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px' }}>
        {SPECIAL_SET_ORDER.map((s) => (
          <label key={s} className="checkbox-row" title={SPECIAL_SET_HINTS[s]}>
            <input type="checkbox" checked={sets.includes(s)} onChange={(e) => toggleSet(s, e.target.checked)} />
            {SPECIAL_SET_LABELS[s]}
          </label>
        ))}
      </div>}
      {/* Камені в кожному відміченому свап-сеті: «сет затиканий 7 бурштинками» і
          «сет із фул ПЗ-камінням» — різні речі (відгук гільдії). */}
      {!hideSpecialSets && sets.length > 0 && (
        <div className="field-row">
          {SPECIAL_SET_ORDER.filter((s) => sets.includes(s)).map((s) => (
            <OptionSelect
              key={s}
              label={`${SPECIAL_SET_LABELS[s]}: камні`}
              value={value.specialSetGems?.[s]}
              options={GEMS_ORDER}
              labels={GEMS_LABELS}
              onChange={(v) => setSetGems(s, v)}
            />
          ))}
        </div>
      )}

      <OptionSelect label="Джин" value={value.genie} options={GENIE_ORDER} labels={GENIE_LABELS} onChange={(v) => patch({ genie: v })} />

      {/* ШГ і Вознєс — окремі шмотки: спершу чекбокси в один рядок, під ними
          точка кожної відміченої (як свап-сети з каменями — колонки не скачуть). */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px' }}>
        <label className="checkbox-row">
          <input type="checkbox" checked={!!value.shg} onChange={(e) => patch({ shg: e.target.checked })} />
          Є ШГ
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={!!value.voznes} onChange={(e) => patch({ voznes: e.target.checked })} />
          Є Вознєс
        </label>
      </div>
      {(value.shg || value.voznes) && (
        <div className="field-row">
          {value.shg && <RefineSelect label="Точка ШГ" value={value.shgRefine ?? null} onChange={(n) => patch({ shgRefine: n })} />}
          {value.voznes && <RefineSelect label="Точка Вознєса" value={value.voznesRefine ?? null} onChange={(n) => patch({ voznesRefine: n })} />}
        </div>
      )}

      {/* Два кільця — кожне своїм грейдом; для R9R1 під ним точка (як у ШГ/Вознєса). */}
      <div className="field-row">
        <OptionSelect label="Кільце 1" value={value.ring1 ?? undefined} options={RING_ORDER} labels={RING_LABELS} onChange={(v) => patch({ ring1: v ?? null })} />
        <OptionSelect label="Кільце 2" value={value.ring2 ?? undefined} options={RING_ORDER} labels={RING_LABELS} onChange={(v) => patch({ ring2: v ?? null })} />
      </div>
      {(value.ring1 === 'r9r1' || value.ring2 === 'r9r1') && (
        <div className="field-row">
          {value.ring1 === 'r9r1' ? <RefineSelect label="Точка кільця 1 (R9R1)" value={value.ring1Refine ?? null} onChange={(n) => patch({ ring1Refine: n })} /> : <span className="field" />}
          {value.ring2 === 'r9r1' ? <RefineSelect label="Точка кільця 2 (R9R1)" value={value.ring2Refine ?? null} onChange={(n) => patch({ ring2Refine: n })} /> : <span className="field" />}
        </div>
      )}

      <details className="gear-extra">
        <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text-dim)', fontWeight: 500 }}>
          Показники з вікна персонажа (необов'язково)
        </summary>
        <div className="field-row" style={{ marginTop: 10 }}>
          <label className="field">
            <span>Показник атаки</span>
            <input type="number" min={0} max={300} value={attackLevel ?? ''} onChange={(e) => onExtraChange(parseLevel(e.target.value), defenseLevel)} />
          </label>
          <label className="field">
            <span>Показник захисту</span>
            <input type="number" min={0} max={300} value={defenseLevel ?? ''} onChange={(e) => onExtraChange(attackLevel, parseLevel(e.target.value))} />
          </label>
        </div>
        <small className="hint">без бафів; зараз не впливає на бали</small>
      </details>

      {showScore && isGearComplete(value) && (
        <div>
          <span className="badge mute">Орієнтовний гір-скор: {computeGearScore(value, rulesVersion, teamSize)}</span>
        </div>
      )}
    </div>
  );
}
