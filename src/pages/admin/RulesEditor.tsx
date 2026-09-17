// =========================================================
// Адмінка (суперадмін): «Шкала балів» балансного фул-рандому — усі таблиці
// балів, пороги tier і кілька параметрів алгоритму, редаговані руками.
//
// Зберігання — лише як НОВА версія (balance-v1.1, v1.2, …): турніри, чиї
// команди вже сформовано, назавжди рахуються своєю версією, а нові турніри
// беруть найновішу. Тому тут немає «Зберегти зміни», є «Зберегти як нову
// версію» з нотаткою, і журнал версій з можливістю завантажити будь-яку
// стару в чернетку.
// =========================================================

import { Fragment, useEffect, useMemo, useState } from 'react';
import { errorMessage } from '../../app/errorMessage';
import type { ArmorSet, CharClass, PlayerGear, Tier, WeaponGrade } from '../../data/types';
import {
  ARMOR_REFINE_LABELS, ARMOR_REFINE_ORDER, ARMOR_SET_LABELS, ARMOR_SET_ORDER, BUILD_LABELS, BUILD_ORDER, CHAR_LEVEL_LABELS, CHAR_LEVEL_ORDER, CLASS_LABELS, CLASS_ORDER, GEMS_LABELS, GEMS_ORDER,
  GENIE_LABELS, GENIE_ORDER, SPECIAL_SET_LABELS, SPECIAL_SET_ORDER, TRACT_LABELS, TRACT_ORDER, WEAPON_GRADE_LABELS, WEAPON_GRADE_ORDER,
  RECOMMENDED_CLASS_POINTS_BY_SIZE, RECOMMENDED_COMPOSITION_WEIGHTS, SIZE_BUCKETS, SIZE_BUCKET_LABELS,
  WEAPON_REFINE_LABELS, WEAPON_REFINE_ORDER, cloneRules, computeGearScoreWith, maxGearScoreOf, nextRulesVersion, rulesFor, sameForAllSizes, tierForWith,
  type SizeBucket,
  type GearRules,
} from '../../data/gearRules';
import { saveRulesVersion, useRules } from '../../data/rulesStore';

/** Контрольні архетипи — щоб одразу бачити, куди зсунуться tier після правки. */
const ARCHETYPES: { name: string; gear: PlayerGear }[] = [
  { name: 'Топ (сін): R9R2 +12, R8R +12, Лагеря, всі сети з Лагерями, Імператор, джин 100/100', gear: { charClass: 'assassin', charLevel: 'l90_100', build: 'dd', weaponGrade: 'r9r2', weaponRefine: 'w12', weaponPz: false, armorSet: 'r8r', armorRefine: 'a12', gems: 'camp', specialSets: ['pz', 'pa', 'aspd'], specialSetGems: { pz: 'camp', pa: 'camp', aspd: 'camp' }, tract: 'emperor', genie: 'g100', shg: false, shgRefine: null, voznes: false, voznesRefine: null } },
  { name: 'Сильний (лук): R9R1 +11, R8R +10, ПА-камні, ПЗ+ПА з ПА-камінням, Гегемонія, джин 100/100', gear: { charClass: 'archer', charLevel: 'l90_100', build: 'dd', weaponGrade: 'r9r1', weaponRefine: 'w11', weaponPz: false, armorSet: 'r8r', armorRefine: 'a10', gems: 'pa', specialSets: ['pz', 'pa'], specialSetGems: { pz: 'pa', pa: 'pa' }, tract: 't8', genie: 'g100', shg: false, shgRefine: null, voznes: false, voznesRefine: null } },
  { name: 'Типовий (маг): ЦГД +10, R8R +10, Сюаньки, ПА-сет із Сюаньками, трактат 7', gear: { charClass: 'wizard', charLevel: 'l90_100', build: 'dd', weaponGrade: 'cgd', weaponRefine: 'w10', weaponPz: false, armorSet: 'r8r', armorRefine: 'a10', gems: 'xuan', specialSets: ['pa'], specialSetGems: { pa: 'xuan' }, tract: 't7', genie: 'g60', shg: false, shgRefine: null, voznes: false, voznesRefine: null } },
  { name: 'Середній (прист): R8R +10 з ПЗ-зброєю, Нірвана/R8R (мікс) +8, камні 10, Спів, трактат 6', gear: { charClass: 'cleric', charLevel: 'l90_100', build: 'dd', weaponGrade: 'r8r', weaponRefine: 'w10', weaponPz: true, armorSet: 'nirvana_r8_mix', armorRefine: 'a8', gems: 'g10', specialSets: ['aspd'], specialSetGems: { aspd: 'g10' }, tract: 't6', genie: 'g60', shg: false, shgRefine: null, voznes: false, voznesRefine: null } },
  { name: 'Слабкий (танк): Нірвана +8 з ПЗ-зброєю, Нірвана +7, трактат 4–5', gear: { charClass: 'barbarian', charLevel: 'l90_100', build: 'dd', weaponGrade: 'nirvana', weaponRefine: 'w8_9', weaponPz: true, armorSet: 'nirvana', armorRefine: 'a7', gems: 'g0_9', specialSets: [], specialSetGems: {}, tract: 't4_5', genie: 'g60', shg: false, shgRefine: null, voznes: false, voznesRefine: null } },
];

/** Грейди, для яких є сенс у перевизначенні за класом (R9-лінійка й ЦГД/РЦГД). */
const OVERRIDE_GRADES: WeaponGrade[] = ['cgd', 'r9', 'r9r1', 'rcgd', 'r9r2'];

const tierClass = (t: Tier) => (t === 'S' || t === 'A' ? 'warn' : 'mute');

function NumInput({ label, value, onChange, width = 92 }: { label: string; value: number; onChange: (v: number) => void; width?: number }) {
  return (
    <label className="field" style={{ flex: `0 1 ${width}px` }}>
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={label}>{label}</span>
      <input
        type="number"
        min={0}
        step={1}
        value={Number.isFinite(value) ? value : ''}
        style={{ padding: '8px 10px', fontSize: 14 }}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Math.max(0, Math.round(Number(e.target.value))))}
      />
    </label>
  );
}

/** Таблиця «ключ → бали» у вигляді ряду маленьких полів у заданому порядку. */
function NumTable<K extends string>({ title, hint, order, labels, values, onChange }: {
  title: string; hint?: string; order: readonly K[]; labels: Record<K, string>; values: Record<K, number>; onChange: (next: Record<K, number>) => void;
}) {
  const max = Math.max(...order.map((k) => values[k]));
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <b>{title}</b>
        <span className="badge mute">max {max}</span>
      </div>
      {hint && <p className="hint" style={{ margin: '0 0 8px' }}>{hint}</p>}
      <div className="field-row" style={{ gap: 10 }}>
        {order.map((k) => (
          <NumInput key={k} label={labels[k]} value={values[k]} onChange={(v) => onChange({ ...values, [k]: v })} />
        ))}
      </div>
    </div>
  );
}

export default function RulesEditor() {
  const { loaded, current, versions } = useRules();
  const [base, setBase] = useState<string>(current);
  const [draft, setDraft] = useState<GearRules>(() => cloneRules(rulesFor(current)));
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedAs, setSavedAs] = useState<string | null>(null);

  // Коли версії з БД довантажились і чернетка ще не чіпалась — переходимо на поточну.
  useEffect(() => {
    if (!dirty && base !== current) {
      setBase(current);
      setDraft(cloneRules(rulesFor(current)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, loaded]);

  const patch = (p: Partial<GearRules>) => { setDraft({ ...draft, ...p }); setDirty(true); setSavedAs(null); };
  const loadVersion = (v: string) => {
    if (dirty && !confirm('Чернетку буде замінено обраною версією. Продовжити?')) return;
    setBase(v);
    setDraft(cloneRules(rulesFor(v)));
    setDirty(false);
    setErr(null);
  };

  const tiersValid = draft.tiers.every((t, i) => i === 0 || i === draft.tiers.length - 1 || t.min < draft.tiers[i - 1].min);
  const maxScore = maxGearScoreOf(draft);
  const realisticMax = maxScore - Math.max(0, draft.armorSet.r9 - draft.armorSet.r8r);
  const next = useMemo(() => nextRulesVersion(), [versions.length]);

  const save = async () => {
    if (!tiersValid) { setErr('Пороги tier мають спадати: S > A > B > C.'); return; }
    if (!confirm(`Зберегти як нову версію ${next}? Нові турніри рахуватимуться нею, уже сформовані — лишаться на своїх.`)) return;
    setBusy(true);
    setErr(null);
    try {
      const v = await saveRulesVersion(draft, note);
      setSavedAs(v);
      setBase(v);
      setDirty(false);
      setNote('');
    } catch (e) {
      setErr(errorMessage(e, 'Не вдалося зберегти версію. Міграція 0019 застосована?'));
    } finally {
      setBusy(false);
    }
  };

  const setTier = (i: number, min: number) => patch({ tiers: draft.tiers.map((t, idx) => (idx === i ? { ...t, min } : t)) });
  const comp = draft.balance.composition;
  const patchComp = (c: Partial<typeof comp>) => patch({ balance: { ...draft.balance, composition: { ...comp, ...c } } });
  /** Штраф за одну таку пачку без урахування неминучого — для підказки в картці. */
  const ex = (...classes: CharClass[]) => {
    const maxKill = Math.max(...classes.map((c) => comp.profiles[c].kill));
    const pen = (comp.weights.killer || RECOMMENDED_COMPOSITION_WEIGHTS.killer) * Math.max(0, 1 - maxKill);
    return pen > 0 ? `${Math.round(pen)}` : '0 (ок)';
  };
  // Матриця «клас × розмір паті»
  const classMax = Math.max(...SIZE_BUCKETS.flatMap((s) => CLASS_ORDER.map((c) => draft.classPointsBySize[s][c])));
  const setClassPoints = (s: SizeBucket, c: CharClass, v: number) =>
    patch({ classPointsBySize: { ...draft.classPointsBySize, [s]: { ...draft.classPointsBySize[s], [c]: v } } });
  const applyRecommended = () => {
    if (!confirm('Замінити всю матрицю «клас × розмір паті» рекомендованими значеннями?')) return;
    patch({ classPointsBySize: JSON.parse(JSON.stringify(RECOMMENDED_CLASS_POINTS_BY_SIZE)) });
  };
  const flattenSizes = () => {
    if (!confirm('Скопіювати колонку «2» в усі розміри (бали за клас перестануть залежати від розміру)?')) return;
    patch({ classPointsBySize: sameForAllSizes(draft.classPointsBySize['2']) });
  };
  // Для якого розміру паті рахувати контрольні архетипи (бали за клас залежать від нього).
  const [checkSize, setCheckSize] = useState(3);
  const setOverride = (c: CharClass, g: WeaponGrade, v: number | undefined) => {
    const cur = { ...(draft.weaponGradeByClass[c] ?? {}) };
    if (v === undefined) delete cur[g]; else cur[g] = v;
    patch({ weaponGradeByClass: { ...draft.weaponGradeByClass, [c]: cur } });
  };
  const toggleHidden = (s: ArmorSet, hidden: boolean) =>
    patch({ hiddenArmorSets: hidden ? Array.from(new Set([...draft.hiddenArmorSets, s])) : draft.hiddenArmorSets.filter((x) => x !== s) });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>Поточна версія для нових турнірів: <b>{current}</b></span>
          {!loaded && <span className="hint" style={{ margin: 0 }}>завантажую версії…</span>}
          <span className="hint" style={{ margin: 0 }}>Чернетка на основі: <b>{base}</b>{dirty ? ' · є незбережені зміни' : ''}</span>
        </div>
        <p className="hint" style={{ margin: 0 }}>
          Правки зберігаються як нова версія — турніри, де команди вже сформовано, назавжди рахуються своєю версією (це видно в блоці «Команди»);
          нові турніри й відкриті реєстрації беруть найновішу. Бали: сума всіх полів анкети = гір-скор гравця.
        </p>
        <div className="field-row" style={{ alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: '0 1 320px' }}>
            <span>Версії</span>
            <select value={base} onChange={(e) => loadVersion(e.target.value)}>
              {versions.map((v) => (
                <option key={v.version} value={v.version}>
                  {v.version}{v.version === current ? ' (поточна)' : ''}{v.createdAt ? ` · ${v.createdAt.slice(0, 10)}` : ''}{v.note ? ` · ${v.note}` : ''}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!dirty} onClick={() => loadVersion(base)}>Скинути чернетку</button>
        </div>
      </div>

      {/* ── Перевірка чернетки ── */}
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          <b>Перевірка чернетки</b>
          <label className="field" style={{ flex: '0 0 auto' }} title="Розмір паті, для якого рахуються архетипи (бали за клас залежать від нього)">
            <select value={checkSize} style={{ padding: '4px 30px 4px 8px', fontSize: 13, backgroundPosition: 'right 10px center' }} onChange={(e) => setCheckSize(Number(e.target.value))}>
              {SIZE_BUCKETS.map((s) => <option key={s} value={Number(s)}>паті {SIZE_BUCKET_LABELS[s]}</option>)}
            </select>
          </label>
          <span className="badge mute">максимум {maxScore}</span>
          <span className="badge mute">без R9-броні {realisticMax}</span>
          {!tiersValid && <span className="badge bad">пороги tier мають спадати</span>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {ARCHETYPES.map((a) => {
            const s = computeGearScoreWith(a.gear, draft, checkSize);
            const t = tierForWith(s, draft);
            return (
              <div key={a.name} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="hint" style={{ margin: 0, flex: 1, minWidth: 0 }}>{a.name}</span>
                <b style={{ width: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{s}</b>
                <span className={'badge ' + tierClass(t)} style={{ width: 28, boxSizing: 'border-box', justifyContent: 'center', padding: '3px 0' }}>{t}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          <b>Клас × розмір паті</b>
          <span className="badge mute">max {classMax}</span>
        </div>
        <p className="hint" style={{ margin: '0 0 8px' }}>
          Сила самого класу в ПвП залежить від формату: сін тягне 2×2 / 3×3, у 6×6 важливіші прист, маг, танк. Колонка — розмір команди турніру
          («6+» — 6 і більше); бали додаються до скору гравця, тож команди балансуються і за класами. Усі нулі = вимкнути.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: `110px repeat(${SIZE_BUCKETS.length}, minmax(64px, 1fr))`, gap: 6, alignItems: 'center', minWidth: 460 }}>
            <span />
            {SIZE_BUCKETS.map((s) => (
              <span key={s} className="hint" style={{ margin: 0, textAlign: 'center' }}>паті {SIZE_BUCKET_LABELS[s]}</span>
            ))}
            {CLASS_ORDER.map((c) => (
              <Fragment key={c}>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{CLASS_LABELS[c]}</span>
                {SIZE_BUCKETS.map((s) => (
                  <span key={s} className="field">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={draft.classPointsBySize[s][c]}
                      style={{ padding: '6px 8px', fontSize: 13, textAlign: 'center' }}
                      onChange={(e) => setClassPoints(s, c, e.target.value === '' ? 0 : Math.max(0, Math.round(Number(e.target.value))))}
                    />
                  </span>
                ))}
              </Fragment>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={applyRecommended} title="Сін/шаман/друїд сильніші в малих форматах, прист/маг/танк/воїн/містик — у масових">Рекомендовані за розміром</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={flattenSizes}>Однаково для всіх розмірів (як «паті 2»)</button>
        </div>
      </div>
      <NumTable title="Зброя (за замовчуванням)" hint="ПА лінійки ЦГД / R9 уже вшитий у бали грейду. Для класів, де це не так, — таблиця нижче." order={WEAPON_GRADE_ORDER} labels={WEAPON_GRADE_LABELS} values={draft.weaponGrade} onChange={(v) => patch({ weaponGrade: v })} />

      <div className="card" style={{ padding: 14 }}>
        <b>Зброя за класами</b>
        <p className="hint" style={{ margin: '0 0 8px' }}>
          Порожня клітинка = значення з таблиці «Зброя» вище. R9-лінійка нерівна за класами: у фізиків (лук, танк, сін…) R9 / R9R1 з абілкою
          вигідніші за +ПА РЦГД, у інтовиків стати R9R1 слабкі й РЦГД вигідніша — тому дефолти для R9 / R9R1 тут різні.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: `110px repeat(${OVERRIDE_GRADES.length}, minmax(76px, 1fr))`, gap: 6, alignItems: 'center', minWidth: 520 }}>
            <span />
            {OVERRIDE_GRADES.map((g) => (
              <span key={g} className="hint" style={{ margin: 0, textAlign: 'center' }}>{WEAPON_GRADE_LABELS[g]} <span style={{ opacity: 0.7 }}>({draft.weaponGrade[g]})</span></span>
            ))}
            {CLASS_ORDER.map((c) => (
              <Fragment key={c}>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{CLASS_LABELS[c]}</span>
                {OVERRIDE_GRADES.map((g) => {
                  const v = draft.weaponGradeByClass[c]?.[g];
                  return (
                    <span key={g} className="field">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={v ?? ''}
                        placeholder={String(draft.weaponGrade[g])}
                        title={v === undefined ? 'як у таблиці «Зброя»' : 'перевизначено для цього класу'}
                        style={{ padding: '6px 8px', fontSize: 13, textAlign: 'center', ...(v === undefined ? { opacity: 0.55 } : { borderColor: 'var(--accent)' }) }}
                        onChange={(e) => setOverride(c, g, e.target.value === '' ? undefined : Math.max(0, Math.round(Number(e.target.value))))}
                      />
                    </span>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      </div>

      <NumTable title="Заточка зброї" order={WEAPON_REFINE_ORDER} labels={WEAPON_REFINE_LABELS} values={draft.weaponRefine} onChange={(v) => patch({ weaponRefine: v })} />

      <div className="card" style={{ padding: 14 }}>
        <b>ПЗ-зброя</b>
        <p className="hint" style={{ margin: '0 0 8px' }}>Запасна зброя з показником захисту для свапу — чекбокс в анкеті.</p>
        <div className="field-row"><NumInput label="Є ПЗ-зброя" value={draft.weaponPz} onChange={(v) => patch({ weaponPz: v })} /></div>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          <b>ШГ і Вознєс</b>
          <span className="badge mute">max {draft.shg + draft.voznes + draft.shgVoznesBonus + 12 * (draft.shgRefinePerLevel + draft.voznesRefinePerLevel)}</span>
        </div>
        <p className="hint" style={{ margin: '0 0 8px' }}>
          Бали за наявність кожної шмотки, бонус, якщо є обидві, і бали за кожен рівень точки (0–12) кожної.
          Зараз: ШГ +12 — {draft.shg + 12 * draft.shgRefinePerLevel}, Вознєс +12 — {draft.voznes + 12 * draft.voznesRefinePerLevel}, обидві +12 — {draft.shg + draft.voznes + draft.shgVoznesBonus + 12 * (draft.shgRefinePerLevel + draft.voznesRefinePerLevel)}.
        </p>
        <div className="field-row" style={{ gap: 10 }}>
          <NumInput label="Є ШГ" value={draft.shg} onChange={(v) => patch({ shg: v })} />
          <NumInput label="Є Вознєс" value={draft.voznes} onChange={(v) => patch({ voznes: v })} />
          <NumInput label="Обидві разом" value={draft.shgVoznesBonus} onChange={(v) => patch({ shgVoznesBonus: v })} width={120} />
          <NumInput label="Рівень точки ШГ" value={draft.shgRefinePerLevel} onChange={(v) => patch({ shgRefinePerLevel: v })} width={140} />
          <NumInput label="Рівень точки Вознєса" value={draft.voznesRefinePerLevel} onChange={(v) => patch({ voznesRefinePerLevel: v })} width={160} />
        </div>
      </div>

      <NumTable title="Сет броні" order={ARMOR_SET_ORDER} labels={ARMOR_SET_LABELS} values={draft.armorSet} onChange={(v) => patch({ armorSet: v })} />
      <div className="card" style={{ padding: 14, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="hint" style={{ margin: 0 }}>Приховати в анкеті (поки ні в кого немає):</span>
        {ARMOR_SET_ORDER.map((s) => (
          <label key={s} className="checkbox-row">
            <input type="checkbox" checked={draft.hiddenArmorSets.includes(s)} onChange={(e) => toggleHidden(s, e.target.checked)} />
            {ARMOR_SET_LABELS[s]}
          </label>
        ))}
      </div>
      <NumTable title="Круг точки (броня, біжа, кільця)" order={ARMOR_REFINE_ORDER} labels={ARMOR_REFINE_LABELS} values={draft.armorRefine} onChange={(v) => patch({ armorRefine: v })} />
      <NumTable title="Камні (основний сет)" hint="За вартістю по зростанню; до 24 каменів, Лагеря — по 2 ПЗ (до 48 ПЗ). Та сама таблиця рахує камені у свап-сетах — з коефіцієнтом і стелею нижче." order={GEMS_ORDER} labels={GEMS_LABELS} values={draft.gems} onChange={(v) => patch({ gems: v })} />
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          <b>Камні у свап-сетах</b>
          <span className="badge mute">max {draft.specialSetGemsCap}</span>
        </div>
        <p className="hint" style={{ margin: '0 0 8px' }}>
          За кожен відмічений сет: {Math.round(draft.specialSetGemsFactor * 100)} % від таблиці каменів за його камені; сума по всіх сетах — не більше стелі.
          Так «сет, затиканий бурштинками» і «сет із фул ПЗ-камінням» дають різні бали.
        </p>
        <div className="field-row" style={{ gap: 10 }}>
          <NumInput label="Частка від таблиці, %" value={Math.round(draft.specialSetGemsFactor * 100)} onChange={(v) => patch({ specialSetGemsFactor: Math.min(100, v) / 100 })} width={160} />
          <NumInput label="Стеля" value={draft.specialSetGemsCap} onChange={(v) => patch({ specialSetGemsCap: v })} />
        </div>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          <b>Спеціальні сети</b>
          <span className="badge mute">max {draft.specialSetsCap}</span>
        </div>
        <p className="hint" style={{ margin: '0 0 8px' }}>
          Кілька сетів = найбільший + «бонус за додатковий» за кожен наступний, але не більше «стелі». Зараз: ПА+Спів {Math.min(draft.specialSetsCap, Math.max(draft.specialSets.pa, draft.specialSets.aspd) + draft.specialSetsExtra)},
          ПЗ+ПА {Math.min(draft.specialSetsCap, Math.max(draft.specialSets.pz, draft.specialSets.pa) + draft.specialSetsExtra)},
          усі три {Math.min(draft.specialSetsCap, Math.max(draft.specialSets.pz, draft.specialSets.pa, draft.specialSets.aspd) + 2 * draft.specialSetsExtra)}.
        </p>
        <div className="field-row" style={{ gap: 10 }}>
          {SPECIAL_SET_ORDER.map((k) => (
            <NumInput key={k} label={SPECIAL_SET_LABELS[k]} value={draft.specialSets[k]} onChange={(v) => patch({ specialSets: { ...draft.specialSets, [k]: v } })} />
          ))}
          <NumInput label="Бонус за додатковий" value={draft.specialSetsExtra} onChange={(v) => patch({ specialSetsExtra: v })} width={150} />
          <NumInput label="Стеля" value={draft.specialSetsCap} onChange={(v) => patch({ specialSetsCap: v })} />
        </div>
      </div>

      <NumTable title="Рівень персонажа" order={CHAR_LEVEL_ORDER} labels={CHAR_LEVEL_LABELS} values={draft.level} onChange={(v) => patch({ level: v })} />
      <NumTable title="Трактат" order={TRACT_ORDER} labels={TRACT_LABELS} values={draft.tract} onChange={(v) => patch({ tract: v })} />
      <NumTable title="Джин (за рівнем)" order={GENIE_ORDER} labels={GENIE_LABELS} values={draft.genie} onChange={(v) => patch({ genie: v })} />

      <div className="card" style={{ padding: 14 }}>
        <b>Пороги tier</b>
        <p className="hint" style={{ margin: '0 0 8px' }}>Лише бейдж в адмінці, на баланс команд не впливає. D — усе нижче C.</p>
        <div className="field-row" style={{ gap: 10 }}>
          {draft.tiers.slice(0, -1).map((t, i) => (
            <NumInput key={t.tier} label={`${t.tier} від`} value={t.min} onChange={(v) => setTier(i, v)} />
          ))}
        </div>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          <b>Рейтинг гравців</b>
          <span className="badge mute">± {draft.ratingCap}</span>
        </div>
        <p className="hint" style={{ margin: '0 0 8px' }}>
          Ело-рейтинг з результатів матчів (вкладка «Звіт балансу»): + вага × (рейтинг − 1000)/100, не більше ± стелі. 0 = вимкнути.
          Додається поверх гір-скору, у «максимум» вище не входить.
        </p>
        <div className="field-row" style={{ gap: 10 }}>
          <NumInput label="Балів за 100 Ело" value={draft.ratingWeight} onChange={(v) => patch({ ratingWeight: v })} width={140} />
          <NumInput label="Стеля ±" value={draft.ratingCap} onChange={(v) => patch({ ratingCap: v })} />
        </div>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <b>Склад команди (ролі)</b>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => patchComp({ weights: { ...RECOMMENDED_COMPOSITION_WEIGHTS } })}>Рекомендовані ваги</button>
        </div>
        <p className="hint" style={{ margin: '0 0 8px' }}>
          Гір показує, наскільки сильний кожен гравець окремо. Цей блок дивиться на команду в цілому: хто в ній убиває, а хто допомагає.
          Команда з сапорта і Стража програє навіть із високим гіром, бо їй нікому вбивати, — алгоритм намагається таких команд не збирати.
        </p>
        <p className="hint" style={{ margin: '0 0 8px' }}>
          <b>Вбиває сам</b>: 100 — повноцінний ДД (Лук, Сін, Шаман, Маг); 50 — б'є, але сам ціль не винесе (Танк з Армагеддоном, Вар); 20–30 — сам не вбиває.
          <b> Допомагає вбивати</b>: наскільки клас підсилює урон союзників — 100 у Дру (Пурга, Amp), 50 — бафи Приста і Танка, 0 — ніяк.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, auto) repeat(2, 130px)', gap: '6px 10px', alignItems: 'center', width: 'fit-content' }}>
          <span />
          <span className="hint" style={{ margin: 0, textAlign: 'center' }}>Вбиває сам, %</span>
          <span className="hint" style={{ margin: 0, textAlign: 'center' }}>Допомагає вбивати, %</span>
          {CLASS_ORDER.map((c) => (
            <Fragment key={c}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{CLASS_LABELS[c]}</span>
              {(['kill', 'amp'] as const).map((ax) => (
                <span key={ax} className="field">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round(comp.profiles[c][ax] * 100)}
                    style={{ padding: '6px 8px', fontSize: 13, textAlign: 'center' }}
                    onChange={(e) => patchComp({ profiles: { ...comp.profiles, [c]: { ...comp.profiles[c], [ax]: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) / 100 } } })}
                  />
                </span>
              ))}
            </Fragment>
          ))}
        </div>
        <div style={{ marginTop: 14 }}>
          <b style={{ fontSize: 13 }}>Збірка з анкети</b>
          <p className="hint" style={{ margin: '2px 0 6px' }}>
            Скільки відсотків свого урону лишає гравець за збіркою: кон-Сін навіть у топ-шмоті вбиває на 40 % від звичайного, тому йому в команду треба другий ДД.
            «Небезпечний від» — гравець, у якого після цього множника лишається не менше стількох відсотків урону, рахується небезпечним для суперника (при 50 — усі ДД і Танк). Потрібно для правила «команда з одним ДД» нижче.
          </p>
          <div className="field-row" style={{ gap: 10 }}>
            {BUILD_ORDER.map((b) => (
              <NumInput key={b} label={BUILD_LABELS[b]} value={Math.round(comp.buildKill[b] * 100)} onChange={(v) => patchComp({ buildKill: { ...comp.buildKill, [b]: Math.min(100, v) / 100 } })} width={120} />
            ))}
            <NumInput label="Небезпечний від, %" value={Math.round(comp.threatMinKill * 100)} onChange={(v) => patchComp({ threatMinKill: Math.min(100, v) / 100 })} width={160} />
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <b style={{ fontSize: 13 }}>Три правила — і скільки балів гіру алгоритм готовий «віддати», щоб їх виконати</b>
          <p className="hint" style={{ margin: '2px 0 6px' }}>
            0 — правило вимкнене. Що більше число, то важливіше правило порівняно з рівним гіром: при 30 алгоритм погодиться на гірший баланс гіру приблизно до 15–20 балів, аби дати команді ДД.
            Якщо ДД на всі команди не вистачає, одна команда без ДД неминуча — за неї штрафу немає.
          </p>
          <ul className="hint" style={{ margin: '0 0 8px', paddingLeft: 18 }}>
            <li><b>Команда без ДД</b> — нікому вбивати (сапорт + Страж; Дру + Танк у парі).</li>
            <li><b>Команда з одним ДД</b> (лише при 3+ у команді) — сфокусували єдиного ДД, і решта безсила. Хочемо хоча б двох «небезпечних».</li>
            <li><b>Різниця сили складу</b> — сила складу = найкращий ДД × ті, хто йому допомагає. Не дає скласти топового Сіна з Танком і Пристом: він отримує нейтральних тімейтів, а Дру/Прист/Танк ідуть до слабших ДД.</li>
          </ul>
          <div className="field-row" style={{ gap: 10 }}>
            <NumInput label="Команда без ДД" value={comp.weights.killer} onChange={(v) => patchComp({ weights: { ...comp.weights, killer: v } })} width={150} />
            <NumInput label="Команда з одним ДД" value={comp.weights.twoThreats} onChange={(v) => patchComp({ weights: { ...comp.weights, twoThreats: v } })} width={170} />
            <NumInput label="Різниця сили складу" value={comp.weights.kpRange} onChange={(v) => patchComp({ weights: { ...comp.weights, kpRange: v } })} width={170} />
          </div>
        </div>
        <p className="hint" style={{ margin: '10px 0 0' }}>
          Скільки балів штрафу отримає команда за правилом «без ДД»{comp.weights.killer > 0 ? '' : ` (зараз вага 0 — показано за рекомендованою ${RECOMMENDED_COMPOSITION_WEIGHTS.killer})`}:
          Шаман+Танк+Дру — {ex('psychic', 'barbarian', 'venomancer')} · Дру+Танк+Страж — {ex('venomancer', 'barbarian', 'seeker')} · Танк+Страж — {ex('barbarian', 'seeker')} · Прист+Страж — {ex('cleric', 'seeker')} · Дру+Танк — {ex('venomancer', 'barbarian')}.
        </p>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <b>Алгоритм (обережно)</b>
        <p className="hint" style={{ margin: '0 0 8px' }}>
          ε-коридор — на скільки балів штрафу гірший розклад ще вважається «таким самим» і може бути обраний випадково (більше = більше рандому, менше = точніший баланс);
          вага ролей — штраф за нерівномірний розподіл ролі між командами.
        </p>
        <div className="field-row" style={{ gap: 10 }}>
          <NumInput label="ε-коридор" value={draft.balance.epsilon} onChange={(v) => patch({ balance: { ...draft.balance, epsilon: v } })} />
          <NumInput label="Кандидатів (top-N)" value={draft.balance.topN} onChange={(v) => patch({ balance: { ...draft.balance, topN: Math.max(1, v) } })} width={140} />
          <NumInput label="Вага ролей" value={draft.balance.weights.role} onChange={(v) => patch({ balance: { ...draft.balance, weights: { ...draft.balance.weights, role: v } } })} />
        </div>
      </div>

      <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label className="field">
          <span>Що змінилось (нотатка до версії)</span>
          <input type="text" value={note} maxLength={200} placeholder="напр. підняли ЦГД до 28, камні Лагеря до 45" onChange={(e) => setNote(e.target.value)} />
        </label>
        {err && <p className="form-err">{err}</p>}
        {savedAs && <p className="badge good" style={{ alignSelf: 'flex-start' }}>Збережено як {savedAs} — тепер це поточна версія</p>}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" disabled={busy || !dirty || !tiersValid} onClick={save}>
            {busy ? 'Зберігаю…' : `Зберегти як ${next}`}
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy || !dirty} onClick={() => loadVersion(base)}>Скасувати зміни</button>
        </div>
      </div>
    </div>
  );
}
