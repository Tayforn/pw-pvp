// =========================================================
// Адмінка (суперадмін): вкладка «Шкала балів» — скільки коштує гравець
// САМ ПО СОБІ: клас × розмір паті, зброя, броня, камені, сети, трактат,
// джин, рівень, ШГ/Вознєс, кільця, рейтинг, пороги tier. Усе, що про
// збирання команд із гравців (бафи тімейтів, правило 4, склад, алгоритм), —
// на сусідній вкладці «Бафи й склад» (TeamTab.tsx); чернетка в них одна
// (data/rulesDraftStore), футер зі збереженням — спільний (RulesFooter.tsx).
// =========================================================

import { Fragment, useState } from 'react';
import type { ArmorSet, CharClass, PlayerGear, Tier, WeaponGrade } from '../../data/types';
import {
  ARMOR_REFINE_LABELS, ARMOR_REFINE_ORDER, ARMOR_SET_LABELS, ARMOR_SET_ORDER, CHAR_LEVEL_LABELS, CHAR_LEVEL_ORDER, CLASS_LABELS, CLASS_ORDER, GEMS_LABELS, GEMS_ORDER,
  GENIE_LABELS, GENIE_ORDER, SPECIAL_SET_LABELS, SPECIAL_SET_ORDER, TRACT_LABELS, TRACT_ORDER, WEAPON_GRADE_LABELS, WEAPON_GRADE_ORDER,
  RING_LABELS, RING_ORDER, RECOMMENDED_CLASS_POINTS_BY_SIZE, SIZE_BUCKETS, SIZE_BUCKET_LABELS,
  WEAPON_REFINE_LABELS, WEAPON_REFINE_ORDER, computeGearScoreWith, maxGearScoreOf, sameForAllSizes, tierForWith,
  RECOMMENDED_SWAP_TOTAL_CAP, GEM_CLASS_LABELS, GEM_CLASS_ORDER, type SizeBucket,
} from '../../data/gearRules';
import { draftTiersValid, patchDraft, useRulesDraft } from '../../data/rulesDraftStore';
import { NumInput, NumTable } from './RulesEditor';
import DollScoreCard from './DollScoreCard';

/** Контрольні архетипи — щоб одразу бачити, куди зсунуться tier після правки. */
const ARCHETYPES: { name: string; gear: PlayerGear }[] = [
  { name: 'Топ (сін): R9R2 +12, R8R +12, Лагеря, всі сети з Лагерями, Імператор, джин 100/100', gear: { charClass: 'assassin', charLevel: 'l90_100', build: 'dd', weaponGrade: 'r9r2', weaponRefine: 'w12', weaponPz: false, armorSet: 'r8r', armorRefine: 'a12', gems: 'camp', specialSets: ['pz', 'pa', 'aspd'], specialSetGems: { pz: 'camp', pa: 'camp', aspd: 'camp' }, tract: 'emperor', genie: 'g100', shg: false, shgRefine: null, voznes: false, voznesRefine: null, ring1: null, ring1Refine: null, ring2: null, ring2Refine: null } },
  { name: 'Сильний (лук): R9R1 +11, R8R +10, ПА-камні, ПЗ+ПА з ПА-камінням, Гегемонія, джин 100/100', gear: { charClass: 'archer', charLevel: 'l90_100', build: 'dd', weaponGrade: 'r9r1', weaponRefine: 'w11', weaponPz: false, armorSet: 'r8r', armorRefine: 'a10', gems: 'pa', specialSets: ['pz', 'pa'], specialSetGems: { pz: 'pa', pa: 'pa' }, tract: 't8', genie: 'g100', shg: false, shgRefine: null, voznes: false, voznesRefine: null, ring1: null, ring1Refine: null, ring2: null, ring2Refine: null } },
  { name: 'Типовий (маг): ЦГД +10, R8R +10, Сюаньки, ПА-сет із Сюаньками, трактат 7', gear: { charClass: 'wizard', charLevel: 'l90_100', build: 'dd', weaponGrade: 'cgd', weaponRefine: 'w10', weaponPz: false, armorSet: 'r8r', armorRefine: 'a10', gems: 'xuan', specialSets: ['pa'], specialSetGems: { pa: 'xuan' }, tract: 't7', genie: 'g60', shg: false, shgRefine: null, voznes: false, voznesRefine: null, ring1: null, ring1Refine: null, ring2: null, ring2Refine: null } },
  { name: 'Середній (прист): R8R +10 з ПЗ-зброєю, Нірвана/R8R (мікс) +8, камні 10, Спів, трактат 6', gear: { charClass: 'cleric', charLevel: 'l90_100', build: 'dd', weaponGrade: 'r8r', weaponRefine: 'w10', weaponPz: true, armorSet: 'nirvana_r8_mix', armorRefine: 'a8', gems: 'g10', specialSets: ['aspd'], specialSetGems: { aspd: 'g10' }, tract: 't6', genie: 'g60', shg: false, shgRefine: null, voznes: false, voznesRefine: null, ring1: null, ring1Refine: null, ring2: null, ring2Refine: null } },
  { name: 'Слабкий (танк): Нірвана +8 з ПЗ-зброєю, Нірвана +7, трактат 4–5', gear: { charClass: 'barbarian', charLevel: 'l90_100', build: 'dd', weaponGrade: 'nirvana', weaponRefine: 'w8_9', weaponPz: true, armorSet: 'nirvana', armorRefine: 'a7', gems: 'g0_9', specialSets: [], specialSetGems: {}, tract: 't4_5', genie: 'g60', shg: false, shgRefine: null, voznes: false, voznesRefine: null, ring1: null, ring1Refine: null, ring2: null, ring2Refine: null } },
];

/** Грейди, для яких є сенс у перевизначенні за класом (R9-лінійка й ЦГД/РЦГД). */
const OVERRIDE_GRADES: WeaponGrade[] = ['cgd', 'r9', 'r9r1', 'rcgd', 'r9r2'];

const tierClass = (t: Tier) => (t === 'S' || t === 'A' ? 'warn' : 'mute');

export default function ScaleTab() {
  const { draft } = useRulesDraft();
  const patch = patchDraft;

  const tiersValid = draftTiersValid(draft);
  const maxScore = maxGearScoreOf(draft);
  const realisticMax = maxScore - Math.max(0, draft.armorSet.r9 - draft.armorSet.r8r);
  const buffsOn = draft.balance.buffs.enabled;

  const setTier = (i: number, min: number) => patch({ tiers: draft.tiers.map((t, idx) => (idx === i ? { ...t, min } : t)) });
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
      <p className="hint" style={{ margin: 0 }}>
        Тут — скільки коштує гравець сам по собі: сума всіх полів анкети = гір-скор гравця. Як із гравців збираються команди
        (бафи тімейтів, правило 4, склад) — на вкладці «Бафи й склад»; чернетка спільна, зберігається внизу як нова версія.
      </p>

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
        {buffsOn && (
          <p className="hint" style={{ margin: '0 0 8px', color: 'var(--warn)' }}>
            Бафи тімейтів увімкнено (вкладка «Бафи й склад»): не піднімай тут бали Танка й Приста «за пачку» — те, що вони бафають команду,
            уже рахує таблиця бафів, інакше це порахується двічі. Пресет «Рекомендовані за розміром» саме так їх і піднімає в масових форматах.
          </p>
        )}
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
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={applyRecommended}
            title={'Сін/шаман/друїд сильніші в малих форматах, прист/маг/танк/воїн/містик — у масових' + (buffsOn ? '. Увага: при увімкнених бафах Танк/Прист «за пачку» рахуються двічі' : '')}
          >
            Рекомендовані за розміром
          </button>
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

      <NumTable
        title="Кільця (за кожне з двох)"
        hint={`Бали за грейд кожного кільця. Для R9R1 ще + бали за кожен рівень точки (0–12). Зараз максимум за обидва: ${2 * (Math.max(...RING_ORDER.map((k) => draft.rings[k])) + 12 * draft.ringRefinePerLevel)}.`}
        order={RING_ORDER}
        labels={RING_LABELS}
        values={draft.rings}
        onChange={(v) => patch({ rings: v })}
      />
      <div className="card" style={{ padding: 14 }}>
        <div className="field-row"><NumInput label="Рівень точки R9R1 (за кільце)" value={draft.ringRefinePerLevel} onChange={(v) => patch({ ringRefinePerLevel: v })} width={220} /></div>
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
          <b>Лялька: точка, камені, збірка</b>
          <span className="badge mute">заявки персонажем</span>
        </div>
        <p className="hint" style={{ margin: '0 0 8px' }}>
          У заявці персонажем точку, камені й збірку лялька рахує сама. Точка броні — середня по броні, біжі й кільцях, округлена вгору; точка зброї — з самої зброї.
          Камені — кожен камінь у кожній речі броні (6 речей × 4 гнізда) за таблицею нижче; сума стає рядком таблиці «Камні».
        </p>
        <label className="field" style={{ maxWidth: 360, marginBottom: 10 }}>
          <span>Рахувати по</span>
          <select value={draft.doll.scope} onChange={(e) => patch({ doll: { ...draft.doll, scope: e.target.value === 'all' ? 'all' : 'main' } })}>
            <option value="main">Головному комплекту</option>
            <option value="all">Усіх комплектах (Головний + сети, середнє)</option>
          </select>
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
          {GEM_CLASS_ORDER.map((k) => (
            <label key={k} className="field">
              <span>{GEM_CLASS_LABELS[k]}</span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={Math.round(draft.doll.gemPoints[k] * 100) / 100}
                onChange={(e) => patch({ doll: { ...draft.doll, gemPoints: { ...draft.doll.gemPoints, [k]: Math.max(0, Number(e.target.value) || 0) } } })}
              />
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => patch({ doll: { ...draft.doll, gemPoints: { ...draft.doll.gemPoints, campPz: 2 * draft.doll.gemPoints.g12 } } })}
          >
            Лагеря = 2 × камінь 12 рів.
          </button>
          <span className="hint" style={{ margin: 0 }}>
            Лагеря дає +2 ПЗ, «Каменная броня» — +1 ПЗ, «Алмазная броня» — +1 ПА: 1 ПЗ = 1 ПА. Від бала Лагеря ÷ 2 рахуються й ПА/ПЗ на зброї.
          </span>
        </div>
        <p className="hint" style={{ margin: '6px 0 12px' }}>
          Бали за ОДИН камінь. Повна броня (24 камені): ПЗ-камені 13+ — {Math.round(24 * draft.doll.gemPoints.campPz)}, ПА — {Math.round(24 * draft.doll.gemPoints.topPa)},
          12 рівень — {Math.round(24 * draft.doll.gemPoints.g12)}. Клас каменя лялька бере з каталогу: рівень каменя і що він дає в броні.
        </p>
        <div className="field-row" style={{ gap: 10 }}>
          <label className="field">
            <span>Гібрид — від, % очок у Тілобудові</span>
            <input
              type="number" min={0} max={100}
              value={Math.round(draft.doll.buildVit.hybrid * 100)}
              onChange={(e) => patch({ doll: { ...draft.doll, buildVit: { ...draft.doll.buildVit, hybrid: Math.min(1, Math.max(0, (Number(e.target.value) || 0) / 100)) } } })}
            />
          </label>
          <label className="field">
            <span>Кон — від, % очок у Тілобудові</span>
            <input
              type="number" min={0} max={100}
              value={Math.round(draft.doll.buildVit.con * 100)}
              onChange={(e) => patch({ doll: { ...draft.doll, buildVit: { ...draft.doll.buildVit, con: Math.min(1, Math.max(0, (Number(e.target.value) || 0) / 100)) } } })}
            />
          </label>
        </div>
        <p className="hint" style={{ margin: '6px 0 0' }}>
          Збірка — за тим, яку частку вільних очок атрибутів гравець вклав у Тілобудову: менше {Math.round(draft.doll.buildVit.hybrid * 100)} % — ДД,
          від {Math.round(draft.doll.buildVit.hybrid * 100)} % — гібрид, від {Math.round(draft.doll.buildVit.con * 100)} % — кон.
        </p>
      </div>

      <DollScoreCard draft={draft} patch={patch} />

      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          <b>Спеціальні сети</b>
          <span className="badge mute">max {draft.specialSetsCap}</span>
        </div>
        <div className="field-row" style={{ gap: 10, alignItems: 'end', marginBottom: 8 }}>
          <label className="field">
            <span>Спільна стеля запасного</span>
            <input
              type="number"
              min={0}
              placeholder="без стелі"
              value={draft.swapTotalCap ?? ''}
              onChange={(e) => patch({ swapTotalCap: e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value) || 0)) })}
            />
          </label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => patch({ swapTotalCap: RECOMMENDED_SWAP_TOTAL_CAP })}>
            Рекомендована: {RECOMMENDED_SWAP_TOTAL_CAP}
          </button>
        </div>
        <p className="hint" style={{ margin: '0 0 8px' }}>
          ПЗ-зброя + свап-сети + камені в них разом — не більше цього числа, щоб запасне спорядження не важило більше за основний круг (сет R8R — {draft.armorSet.r8r}).
          Зараз повний набір свапів дає {Math.min(draft.swapTotalCap ?? Infinity, draft.weaponPz + draft.specialSetsCap + draft.specialSetGemsCap)}
          {draft.swapTotalCap == null ? ' (без стелі)' : ''}. Порожнє поле — без спільної стелі.
        </p>
        <label className="checkbox-row" style={{ marginBottom: 8 }}>
          <input type="checkbox" checked={draft.setsFromDoll} onChange={(e) => patch({ setsFromDoll: e.target.checked })} />
          Рахувати свап-сети з ляльки в заявках персонажем
        </label>
        <p className="hint" style={{ margin: '0 0 8px' }}>
          Лялька сама бачить, які сети має гравець: сет рахується, якщо в ньому показник захисту чи атаки ≥ 30 (спів — −30 % часу співу) і вищий, ніж у Головному. Вимкнено — у заявку сети не йдуть, як і в звичайній анкеті.
        </p>
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
        <p className="hint" style={{ margin: '0 0 8px' }}>
          Лише бейдж в адмінці, на баланс команд не впливає. D — усе нижче C. Поріг «топового ДД» для правила 4 — окреме поле на вкладці «Бафи й склад»
          (зараз {draft.balance.composition.topDdMinScore}).
        </p>
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
          Ело-рейтинг з результатів матчів (вкладка «Звіт»): + вага × (рейтинг − 1000)/100, не більше ± стелі. 0 = вимкнути.
          Додається поверх гір-скору, у «максимум» вище не входить.
        </p>
        <div className="field-row" style={{ gap: 10 }}>
          <NumInput label="Балів за 100 Ело" value={draft.ratingWeight} onChange={(v) => patch({ ratingWeight: v })} width={140} />
          <NumInput label="Стеля ±" value={draft.ratingCap} onChange={(v) => patch({ ratingCap: v })} />
        </div>
      </div>
    </div>
  );
}
