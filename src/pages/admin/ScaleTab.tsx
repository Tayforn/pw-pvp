// =========================================================
// Адмінка (суперадмін): вкладка «Шкала балів» — скільки коштує гравець
// САМ ПО СОБІ за скором v2 «від речей» (src/doll/model/itemScore.ts): клас ×
// розмір паті, грейд, точка й абілки зброї, сет і точка броні (за річ — чверть
// і шоста), камені (за камінь), стелі свап-сетів і свап-зброї, трактат, джин
// (за удачею), рівень, ШГ/Вознєс, кільця, рейтинг, пороги tier. Legacy-таблиці
// старих заявок (кошики каменів, прапорець ПЗ-зброї, пороги сетів, приховані
// сети) у версії лишаються, тут не редагуються. Усе, що про збирання команд
// із гравців (бафи тімейтів, правило 4, склад, алгоритм), — на сусідній
// вкладці «Бафи й склад» (TeamTab.tsx); чернетка в них одна
// (data/rulesDraftStore), футер зі збереженням — спільний (RulesFooter.tsx).
// =========================================================

import { Fragment, useState } from 'react';
import type { CharClass, Tier, WeaponGrade } from '../../data/types';
import {
  ARMOR_REFINE_LABELS, ARMOR_REFINE_ORDER, ARMOR_SET_LABELS, ARMOR_SET_ORDER, CHAR_LEVEL_LABELS, CHAR_LEVEL_ORDER, CLASS_LABELS, CLASS_ORDER,
  GEM_CLASS_LABELS, GEM_CLASS_ORDER, GENIE_LABELS, GENIE_ORDER, RECOMMENDED_ABILITY_POINTS, RECOMMENDED_CLASS_POINTS_BY_SIZE, RECOMMENDED_SWAP_TOTAL_CAP,
  RING_LABELS, RING_ORDER, SIZE_BUCKETS, SIZE_BUCKET_LABELS, TRACT_LABELS, TRACT_ORDER, WEAPON_GRADE_LABELS, WEAPON_GRADE_ORDER, WEAPON_REFINE_LABELS, WEAPON_REFINE_ORDER,
  computeGearScoreWith, maxGearScoreOf, sameForAllSizes, tierForWith, unitGemPoints, type SizeBucket,
} from '../../data/gearRules';
import { WEAPON_ABILITIES, WEAPON_ABILITY_BY_CODE, type WeaponAbility } from '../../data/weaponAbilities';
import { draftTiersValid, patchDraft, useRulesDraft } from '../../data/rulesDraftStore';
import { AdmFields, NumInput, NumTable } from './RulesEditor';
import { TABLE_ARCHETYPES, V2_ARCHETYPES, v2ArchetypeScore } from './scaleArchetypes';

/** Грейди, для яких є сенс у перевизначенні за класом (R9-лінійка й ЦГД/РЦГД). */
const OVERRIDE_GRADES: WeaponGrade[] = ['cgd', 'r9', 'r9r1', 'rcgd', 'r9r2'];

const tierClass = (t: Tier) => (t === 'S' || t === 'A' ? 'warn' : 'mute');

/** Абілки топової зброї (300к репутації) — завжди на виду; решта — під спойлером. */
const TOP_ABILITIES = new Set(Object.keys(RECOMMENDED_ABILITY_POINTS));

function AbilityRow({ a, value, onChange }: { a: WeaponAbility; value: number; onChange: (v: number) => void }) {
  const id = 'abil-' + a.code;
  return (
    <div className={'abil-row' + (value ? ' on' : '')}>
      <div className="abil-text">
        <label htmlFor={id} className="abil-name">{a.name}</label>
        <span className="abil-where">{a.where}</span>
        <span className="abil-desc">{a.desc}</span>
      </div>
      <label className="field abil-pts">
        <span>Бали</span>
        <input id={id} type="number" min={-100} max={100} value={value} onChange={(e) => onChange(Math.max(-100, Math.min(100, Math.round(Number(e.target.value) || 0))))} />
      </label>
    </div>
  );
}

/** Рядок перевірки чернетки: назва архетипу, скор, tier. */
function ScoreRow({ name, score, tier }: { name: string; score: number; tier: Tier }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <span className="hint" style={{ margin: 0, flex: 1, minWidth: 0 }}>{name}</span>
      <b style={{ width: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{score}</b>
      <span className={'badge ' + tierClass(tier)} style={{ width: 28, boxSizing: 'border-box', justifyContent: 'center', padding: '3px 0' }}>{tier}</span>
    </div>
  );
}

export default function ScaleTab() {
  const { draft } = useRulesDraft();
  const patch = patchDraft;

  const tiersValid = draftTiersValid(draft);
  const maxScore = maxGearScoreOf(draft);
  const realisticMax = maxScore - Math.max(0, draft.armorSet.r9 - draft.armorSet.r8r);
  const buffsOn = draft.balance.buffs.enabled;
  /** Курс «1 ПЗ = 1 ПА = u бала» — бал за камінь на +1 ПЗ. */
  const unit = draft.doll.gemPoints.pz1;
  const fmt = (n: number) => String(Math.round(n * 100) / 100);

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
  // Абілки зброї — поле верхнього рівня шкали, його бере скор v2 (головна зброя).
  const setAbility = (code: string, v: number) => patch({ abilityPoints: { ...draft.abilityPoints, [code]: v } });
  const applyRecommendedAbilities = () => {
    const list = Object.entries(RECOMMENDED_ABILITY_POINTS).map(([code, v]) => `${WEAPON_ABILITY_BY_CODE[code]?.name ?? code} ${v}`).join(', ');
    if (!confirm(`Замінити всі бали за абілки рекомендованими (${list}; решта — 0)?`)) return;
    patch({ abilityPoints: { ...RECOMMENDED_ABILITY_POINTS } });
  };
  const abilityTable = (list: WeaponAbility[]) => (
    <div className="abil-list">
      {list.map((a) => (
        <AbilityRow key={a.code} a={a} value={draft.abilityPoints[a.code] ?? 0} onChange={(v) => setAbility(a.code, v)} />
      ))}
    </div>
  );
  const topAbilities = WEAPON_ABILITIES.filter((a) => TOP_ABILITIES.has(a.code));
  const restAbilities = WEAPON_ABILITIES.filter((a) => !TOP_ABILITIES.has(a.code));
  const restAbilitiesSet = restAbilities.filter((a) => (draft.abilityPoints[a.code] ?? 0) !== 0).length;
  const maxAbility = Math.max(0, ...Object.values(draft.abilityPoints));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p className="hint" style={{ margin: 0 }}>
        Тут — скільки коштує гравець сам по собі: клас + бали за надіті речі ляльки (скор v2 «від речей») + рівень + джин = гір-скор заявки;
        старі заявки без балів за речі рахуються таблицею з анкети. Як із гравців збираються команди (бафи тімейтів, правило 4, склад) —
        на вкладці «Бафи й склад»; чернетка спільна, зберігається внизу як нова версія.
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
          <span className="badge mute">максимум {maxScore}{draft.swapTotalCap == null ? ' (без свап-сетів — стелі немає)' : ''}</span>
          <span className="badge mute">без R9-броні {realisticMax}</span>
          {!tiersValid && <span className="badge bad">пороги tier мають спадати</span>}
        </div>
        <p className="hint" style={{ margin: '0 0 8px' }}>
          Скор v2: кожна надіта річ дає бали один раз (грейд, точка, камені, абілка), тож числа вищі за табличні — максимум {maxScore}
          {draft.swapTotalCap == null ? ' (свап-сети без стелі в максимум не входять)' : ''}. Перед збереженням версії перегляньте пороги tier
          унизу й поріг «топового ДД» для правила 4 на вкладці «Бафи й склад» (зараз {draft.balance.composition.topDdMinScore}).
        </p>
        <p className="hint" style={{ margin: '0 0 6px' }}>
          <b>Орієнтовні архетипи за v2</b> — та сама арифметика, що в ляльці, але без каталогу: камені одним класом у всіх 30 гніздах.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {V2_ARCHETYPES.map((a) => {
            const s = v2ArchetypeScore(a, draft, checkSize);
            return <ScoreRow key={a.name} name={a.name} score={s} tier={tierForWith(s, draft)} />;
          })}
        </div>
        <details style={{ marginTop: 10 }}>
          <summary className="hint" style={{ margin: 0, cursor: 'pointer' }}>
            Табличний скор (старі заявки без балів за речі); заявки персонажем рахуються з речей
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
            {TABLE_ARCHETYPES.map((a) => {
              const s = computeGearScoreWith(a.gear, draft, checkSize);
              return <ScoreRow key={a.name} name={a.name} score={s} tier={tierForWith(s, draft)} />;
            })}
          </div>
        </details>
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
      <NumTable
        title="Зброя (за замовчуванням)"
        hint="Грейд головної зброї — найдорожчої за v2 серед усіх надітих, де б вона не лежала (Головний чи сет). ПА лінійки ЦГД / R9 уже вшитий у бали грейду. Для класів, де це не так, — таблиця нижче."
        order={WEAPON_GRADE_ORDER}
        labels={WEAPON_GRADE_LABELS}
        values={draft.weaponGrade}
        onChange={(v) => patch({ weaponGrade: v })}
      />

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

      <NumTable title="Заточка зброї" hint="Точка головної зброї; свап-зброя точку не рахує." order={WEAPON_REFINE_ORDER} labels={WEAPON_REFINE_LABELS} values={draft.weaponRefine} onChange={(v) => patch({ weaponRefine: v })} />

      {/* ── Абілки зброї ── */}
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          <b>Абілки зброї</b>
          <span className="badge mute">max {maxAbility}</span>
        </div>
        <p className="hint" style={{ margin: '0 0 8px' }}>
          Лялька рахує лише стати, а властивості зброї (зняття бафів, подвійний урон, очищення…) — ні. Бали за абілку головної зброї додаються до
          її грейду й точки; абілку лялька бере сама з каталогу речі. Свап-зброя абілку не рахує. Нема в списку чи 0 — без балів.
        </p>
        {abilityTable(topAbilities)}
        <details className="abil-more">
          <summary>Інші абілки ({restAbilities.length}{restAbilitiesSet ? `, з балами ${restAbilitiesSet}` : ''}) — ЦГД/РЦГД 80 рів., старіша зброя</summary>
          <div style={{ marginTop: 8 }}>{abilityTable(restAbilities)}</div>
        </details>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={applyRecommendedAbilities}>
            Рекомендовані: {Object.entries(RECOMMENDED_ABILITY_POINTS).map(([code, v]) => `${WEAPON_ABILITY_BY_CODE[code]?.name ?? code} ${v}`).join(', ')}
          </button>
          <span className="hint" style={{ margin: 0 }}>Абілки топової зброї 300к репутації; решта — 0.</span>
        </div>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          <b>ШГ і Вознєс</b>
          <span className="badge mute">max {draft.shg + draft.voznes + draft.shgVoznesBonus + 12 * (draft.shgRefinePerLevel + draft.voznesRefinePerLevel)}</span>
        </div>
        <p className="hint" style={{ margin: '0 0 8px' }}>
          Бали за наявність кожної шмотки, бонус, якщо є обидві, і бали за кожен рівень точки (0–12) кожної.
          Зараз: ШГ +12 — {draft.shg + 12 * draft.shgRefinePerLevel}, Вознєс +12 — {draft.voznes + 12 * draft.voznesRefinePerLevel}, обидві +12 — {draft.shg + draft.voznes + draft.shgVoznesBonus + 12 * (draft.shgRefinePerLevel + draft.voznesRefinePerLevel)}.
          Наявність і точку лялька бачить сама («Шолом героя», «Плащ вознесіння»): кожна рахується один раз (екземпляр із найбільшою точкою, хоч у
          Головному, хоч у сеті) замість шостої точки броні за шолом чи накидку; камені в них — як у броні. Бонус — якщо надіті обидві хоч десь.
        </p>
        <AdmFields>
          <NumInput label="Є ШГ" value={draft.shg} onChange={(v) => patch({ shg: v })} />
          <NumInput label="Є Вознєс" value={draft.voznes} onChange={(v) => patch({ voznes: v })} />
          <NumInput label="Обидві разом" value={draft.shgVoznesBonus} onChange={(v) => patch({ shgVoznesBonus: v })} />
          <NumInput label="Рівень точки ШГ" value={draft.shgRefinePerLevel} onChange={(v) => patch({ shgRefinePerLevel: v })} />
          <NumInput label="Рівень точки Вознєса" value={draft.voznesRefinePerLevel} onChange={(v) => patch({ voznesRefinePerLevel: v })} />
        </AdmFields>
      </div>

      <NumTable
        title="Кільця (за кожне з двох)"
        hint={`Бали за грейд кільця; рахуються два найкращі за балами з усіх надітих (Головний і сети), решта — 0. Для R9R1 ще + бали за кожен рівень точки (0–12). Зараз максимум за обидва: ${2 * (Math.max(...RING_ORDER.map((k) => draft.rings[k])) + 12 * draft.ringRefinePerLevel)}.`}
        order={RING_ORDER}
        labels={RING_LABELS}
        values={draft.rings}
        onChange={(v) => patch({ rings: v })}
      />
      <div className="card" style={{ padding: 14 }}>
        <AdmFields>
          <NumInput label="Рівень точки R9R1 (за кільце)" value={draft.ringRefinePerLevel} onChange={(v) => patch({ ringRefinePerLevel: v })} />
        </AdmFields>
      </div>

      <NumTable
        title="Сет броні (за річ — чверть)"
        hint="Кожна з 4 речей броні (наручі, нагрудник, поножі, взуття) дає чверть балів свого грейду, тож мікс R8R і Нірвани виходить сумою частин; шолом і накидка грейду не мають. Речі в сетах — під стелю свап-сетів. Старі заявки — сет цілком, як в анкеті."
        order={ARMOR_SET_ORDER}
        labels={ARMOR_SET_LABELS}
        values={draft.armorSet}
        onChange={(v) => patch({ armorSet: v })}
      />
      <NumTable
        title="Точка броні (за річ — шоста)"
        hint="Кожна річ броні, шолом і накидка (крім ШГ/Вознєса — у них своя таблиця) дає шосту балів кошика своєї точки. Кільця точку рахують лише R9R1 (картка «Кільця»). Старі заявки — середня точка цілком."
        order={ARMOR_REFINE_ORDER}
        labels={ARMOR_REFINE_LABELS}
        values={draft.armorRefine}
        onChange={(v) => patch({ armorRefine: v })}
      />

      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          <b>Лялька: камені й збірка</b>
          <span className="badge mute">заявки персонажем</span>
        </div>
        <p className="hint" style={{ margin: '0 0 8px' }}>
          Камені — кожен камінь у кожній надітій речі: зброя (2 гнізда), шолом, нагрудник, поножі, взуття, накидка, браслети і збірник (по 4). ПЗ- і
          ПА-камені лялька рахує за курсом рядка «ПЗ+1» × одиниці каменя (Лагеря +2 ПЗ = {fmt(2 * unit)}, Цзин Юэ / Ракшаса +3 = {fmt(3 * unit)}; у зброї
          — за тим, що камінь дає у зброї), тож рядки «ПЗ+2» і «ПА» тут — лише для складу каменів старих заявок; решту каменів — за рівнем.
        </p>
        <AdmFields wide>
          {GEM_CLASS_ORDER.map((k) => (
            <label key={k} className="field adm-f">
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
        </AdmFields>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => patch({ doll: { ...draft.doll, gemPoints: { ...draft.doll.gemPoints, ...unitGemPoints(1) } } })}
          >
            1 ПА = 1 ПЗ = 1 бал
          </button>
          <span className="hint" style={{ margin: 0 }}>
            Лагеря (+2 ПЗ) — 2 бали, «Каменная броня» (+1 ПЗ) і «Алмазная броня» (+1 ПА) — по 1. За цим курсом рахується й ПЗ свап-зброї.
          </span>
        </div>
        <p className="hint" style={{ margin: '6px 0 12px' }}>
          Бали за ОДИН камінь. Повна броня (24 гнізда): Лагеря — {Math.round(48 * unit)}, «Каменная броня» — {Math.round(24 * unit)},
          «Алмазная броня» — {Math.round(24 * unit)}, камені 12 рів. (Сюань Юань, Пань Гу, Нюйва) — {Math.round(24 * draft.doll.gemPoints.g12)}.
        </p>
        <AdmFields wide>
          <label className="field adm-f">
            <span>Гібрид — від, % очок у Тілобудові</span>
            <input
              type="number" min={0} max={100}
              value={Math.round(draft.doll.buildVit.hybrid * 100)}
              onChange={(e) => patch({ doll: { ...draft.doll, buildVit: { ...draft.doll.buildVit, hybrid: Math.min(1, Math.max(0, (Number(e.target.value) || 0) / 100)) } } })}
            />
          </label>
          <label className="field adm-f">
            <span>Кон — від, % очок у Тілобудові</span>
            <input
              type="number" min={0} max={100}
              value={Math.round(draft.doll.buildVit.con * 100)}
              onChange={(e) => patch({ doll: { ...draft.doll, buildVit: { ...draft.doll.buildVit, con: Math.min(1, Math.max(0, (Number(e.target.value) || 0) / 100)) } } })}
            />
          </label>
        </AdmFields>
        <p className="hint" style={{ margin: '6px 0 0' }}>
          Збірка — за тим, яку частку вільних очок атрибутів гравець вклав у Тілобудову: менше {Math.round(draft.doll.buildVit.hybrid * 100)} % — ДД,
          від {Math.round(draft.doll.buildVit.hybrid * 100)} % — гібрид, від {Math.round(draft.doll.buildVit.con * 100)} % — кон.
        </p>
      </div>

      {/* ── Стелі свап-спорядження ── */}
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          <b>Стелі свап-спорядження</b>
          <span className="badge mute">max {(draft.swapTotalCap ?? 0) + draft.weaponPzCap}{draft.swapTotalCap == null ? ' + сети без стелі' : ''}</span>
        </div>
        <p className="hint" style={{ margin: '0 0 8px' }}>
          Свап-сети: кожна річ сету, якої немає в Головному, дає свої бали (чверть сету броні + шоста точки + камені; трактат сету — свій), а
          сума всіх сетів разом — не більше спільної стелі, щоб запасне не важило більше за основний круг (сет R8R — {draft.armorSet.r8r}).
          Зброя, ШГ/Вознєс і кільця із сетів рахуються разом із головними речами й під цю стелю не потрапляють. Порожнє поле — без стелі.
        </p>
        <div className="adm-fields" style={{ marginBottom: 8 }}>
          <label className="field adm-f">
            <span>Стеля свап-сетів</span>
            <input
              type="number"
              min={0}
              placeholder="без стелі"
              value={draft.swapTotalCap ?? ''}
              onChange={(e) => patch({ swapTotalCap: e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value) || 0)) })}
            />
          </label>
          {/* Кнопка — у своїй клітинці сітки, притиснута донизу: на одній лінії з полями. */}
          <div className="adm-f-act">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => patch({ swapTotalCap: RECOMMENDED_SWAP_TOTAL_CAP })}>
              Рекомендована: {RECOMMENDED_SWAP_TOTAL_CAP}
            </button>
          </div>
          <NumInput label="Стеля ПЗ свап-зброї" value={draft.weaponPzCap} onChange={(v) => patch({ weaponPzCap: Math.min(100, v) })} />
        </div>
        <p className="hint" style={{ margin: 0 }}>
          Свап-зброя — усі зброї, крім найдорожчої (та йде головною, де б не лежала): лише ПЗ, який дає річ (каталог + камені), за курсом
          1 ПЗ = {fmt(unit)} бала (рядок «ПЗ+1» картки «Лялька»), усі разом не більше стелі; грейд, точка й абілка свап-зброї не рахуються.
        </p>
      </div>

      <NumTable title="Рівень персонажа" order={CHAR_LEVEL_ORDER} labels={CHAR_LEVEL_LABELS} values={draft.level} onChange={(v) => patch({ level: v })} />
      <NumTable title="Трактат" hint="Трактат рахується в кожному сеті, де надітий свій екземпляр: Головного — з головними речами, сету — під стелю свап-сетів." order={TRACT_ORDER} labels={TRACT_LABELS} values={draft.tract} onChange={(v) => patch({ tract: v })} />
      <NumTable title="Джин (за удачею)" order={GENIE_ORDER} labels={GENIE_LABELS} values={draft.genie} onChange={(v) => patch({ genie: v })} />

      <div className="card" style={{ padding: 14 }}>
        <b>Пороги tier</b>
        <p className="hint" style={{ margin: '0 0 8px' }}>
          Лише бейдж в адмінці, на баланс команд не впливає. D — усе нижче C. Скор v2 вищий за табличний (максимум {maxScore}) — звір пороги з
          архетипами в «Перевірці чернетки». Поріг «топового ДД» для правила 4 — окреме поле на вкладці «Бафи й склад»
          (зараз {draft.balance.composition.topDdMinScore}).
        </p>
        <AdmFields>
          {draft.tiers.slice(0, -1).map((t, i) => (
            <NumInput key={t.tier} label={`${t.tier} від`} value={t.min} onChange={(v) => setTier(i, v)} />
          ))}
        </AdmFields>
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
        <AdmFields>
          <NumInput label="Балів за 100 Ело" value={draft.ratingWeight} onChange={(v) => patch({ ratingWeight: v })} />
          <NumInput label="Стеля ±" value={draft.ratingCap} onChange={(v) => patch({ ratingCap: v })} />
        </AdmFields>
      </div>
    </div>
  );
}
