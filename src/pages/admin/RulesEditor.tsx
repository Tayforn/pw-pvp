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

import { useEffect, useMemo, useState } from 'react';
import { errorMessage } from '../../app/errorMessage';
import type { ArmorSet, PlayerGear, Tier } from '../../data/types';
import {
  ARMOR_REFINE_LABELS, ARMOR_REFINE_ORDER, ARMOR_SET_LABELS, ARMOR_SET_ORDER, GEMS_LABELS, GEMS_ORDER, GENIE_LABELS, GENIE_ORDER,
  SPECIAL_SET_LABELS, SPECIAL_SET_ORDER, TRACT_LABELS, TRACT_ORDER, WEAPON_GRADE_LABELS, WEAPON_GRADE_ORDER, WEAPON_REFINE_LABELS,
  WEAPON_REFINE_ORDER, cloneRules, computeGearScoreWith, maxGearScoreOf, nextRulesVersion, rulesFor, tierForWith, type GearRules,
} from '../../data/gearRules';
import { saveRulesVersion, useRules } from '../../data/rulesStore';

/** Контрольні архетипи — щоб одразу бачити, куди зсунуться tier після правки. */
const ARCHETYPES: { name: string; gear: PlayerGear }[] = [
  { name: 'Топ: R9R2 +12, R8R +12, Лагеря, всі сети, Імператор, джин', gear: { charClass: 'assassin', weaponGrade: 'r9r2', weaponRefine: 'w12', weaponPz: false, armorSet: 'r8r', armorRefine: 'a12', gems: 'camp', specialSets: ['pz', 'pa', 'aspd'], tract: 'emperor', genie: 'top' } },
  { name: 'Сильний: R9R1 +11, R8R +10, ПА-камні, ПЗ+ПА, Гегемонія, джин', gear: { charClass: 'archer', weaponGrade: 'r9r1', weaponRefine: 'w11', weaponPz: false, armorSet: 'r8r', armorRefine: 'a10', gems: 'pa', specialSets: ['pz', 'pa'], tract: 't8', genie: 'top' } },
  { name: 'Типовий: ЦГД +10, R8R +10, Сюаньки, ПА-сет, трактат 7', gear: { charClass: 'wizard', weaponGrade: 'cgd', weaponRefine: 'w10', weaponPz: false, armorSet: 'r8r', armorRefine: 'a10', gems: 'xuan', specialSets: ['pa'], tract: 't7', genie: 'lower' } },
  { name: 'Середній: R8R +10 з ПЗ-зброєю, R8 +8, камні 10, Спів, трактат 6', gear: { charClass: 'cleric', weaponGrade: 'r8r', weaponRefine: 'w10', weaponPz: true, armorSet: 'r8', armorRefine: 'a8', gems: 'g10', specialSets: ['aspd'], tract: 't6', genie: 'lower' } },
  { name: 'Слабкий: Нірвана +8 з ПЗ-зброєю, Нірвана +7, трактат 4–5', gear: { charClass: 'barbarian', weaponGrade: 'nirvana', weaponRefine: 'w8_9', weaponPz: true, armorSet: 'nirvana', armorRefine: 'a7', gems: 'g0_9', specialSets: [], tract: 't4_5', genie: 'lower' } },
];

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
          <span className="badge mute">максимум {maxScore}</span>
          <span className="badge mute">без R9-броні {realisticMax}</span>
          {!tiersValid && <span className="badge bad">пороги tier мають спадати</span>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {ARCHETYPES.map((a) => {
            const s = computeGearScoreWith(a.gear, draft);
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

      <NumTable title="Зброя" hint="ПА лінійки ЦГД / R9 уже вшитий у бали грейду." order={WEAPON_GRADE_ORDER} labels={WEAPON_GRADE_LABELS} values={draft.weaponGrade} onChange={(v) => patch({ weaponGrade: v })} />
      <NumTable title="Заточка зброї" order={WEAPON_REFINE_ORDER} labels={WEAPON_REFINE_LABELS} values={draft.weaponRefine} onChange={(v) => patch({ weaponRefine: v })} />

      <div className="card" style={{ padding: 14 }}>
        <b>ПЗ-зброя</b>
        <p className="hint" style={{ margin: '0 0 8px' }}>Запасна зброя з показником захисту для свапу — чекбокс в анкеті.</p>
        <div className="field-row"><NumInput label="Є ПЗ-зброя" value={draft.weaponPz} onChange={(v) => patch({ weaponPz: v })} /></div>
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
      <NumTable title="Камні" hint="За вартістю по зростанню; до 24 каменів, Лагеря — по 2 ПЗ (до 48 ПЗ)." order={GEMS_ORDER} labels={GEMS_LABELS} values={draft.gems} onChange={(v) => patch({ gems: v })} />

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

      <NumTable title="Трактат" order={TRACT_ORDER} labels={TRACT_LABELS} values={draft.tract} onChange={(v) => patch({ tract: v })} />
      <NumTable title="Джин" order={GENIE_ORDER} labels={GENIE_LABELS} values={draft.genie} onChange={(v) => patch({ genie: v })} />

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
