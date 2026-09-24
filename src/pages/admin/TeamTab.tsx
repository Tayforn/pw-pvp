// =========================================================
// Адмінка (суперадмін): вкладка «Бафи й склад» — як із гравців збирати
// команди: (1) бафи тімейтів → сила команди = гір + бафи; (2) склад команди
// (ролі, правило 4 для 3+ і окремий селект для пар); (3) параметри
// алгоритму. Усе це — частина версії шкали, як і бали за гір: турнір
// фіксує версію при формуванні команд, тому старі турніри не змінюються.
// Чернетка спільна зі «Шкалою балів» (data/rulesDraftStore), футер зі
// збереженням — RulesFooter.tsx.
// =========================================================

import { Fragment, useState } from 'react';
import type { CharClass } from '../../data/types';
import {
  BUILD_LABELS, BUILD_ORDER, BUILTIN_COMPOSITION, CLASS_LABELS, CLASS_ORDER, PAIRS_RULES, PAIRS_RULE_LABELS, PHYS_CLASSES,
  RECOMMENDED_BUFFS_PCT, RECOMMENDED_COMPOSITION_WEIGHTS, RECOMMENDED_PAIRS_RULE, RECOMMENDED_TOP_PROFILE_WEIGHT, isPhysClass,
  type BuffCell, type BuffSide, type KxMode, type PairsRule,
} from '../../data/gearRules';
import { DRUID_AMP, FULL_DD_KILL, buffPctTo, pairViolates } from '../../data/balance';
import { patchBalance, patchBuffs, patchComposition, useRulesDraft } from '../../data/rulesDraftStore';
import { CardHead, NumInput, PctInput, RuleRow } from './RulesEditor';

const KX_ORDER: KxMode[] = ['noKx', 'kx'];
const KX_LABELS: Record<KxMode, string> = { noKx: 'Без КХ', kx: 'Під КХ' };
const SIDE_ORDER: BuffSide[] = ['rs', 'je'];
const SIDE_LABELS: Record<BuffSide, string> = { rs: 'мудрець', je: 'демон' };
const CELL_FIELDS: (keyof BuffCell)[] = ['phys', 'mag'];
const CELL_LABELS: Record<keyof BuffCell, string> = { phys: 'фізикам', mag: 'магам' };
const SIZE_KEYS = ['2', '3', '4', '5'] as const;
const SIZE_LABELS: Record<(typeof SIZE_KEYS)[number], string> = { '2': '2', '3': '3', '4': '4', '5': '5+' };

const classList = (classes: CharClass[]) => classes.map((c) => CLASS_LABELS[c]).join(', ');
const deepCopy = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Маленьке поле таблиці бафів (0–100 %). */
function CellInput({ value, onChange, title }: { value: number; onChange: (v: number) => void; title: string }) {
  return (
    <span className="field">
      <input
        type="number"
        min={0}
        max={100}
        step={1}
        inputMode="numeric"
        value={value}
        title={title}
        style={{ width: 56, padding: '5px 6px', fontSize: 13, textAlign: 'center', ...(value === 0 ? { opacity: 0.55 } : {}) }}
        onChange={(e) => onChange(Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))))}
      />
    </span>
  );
}

// ── Картка «Бафи тімейтів» ──────────────────────────────────────

function BuffsCard() {
  const { draft } = useRulesDraft();
  const b = draft.balance.buffs;
  const comp = draft.balance.composition;

  /** Клітинка для показу: при вимкненій стороні — сильніша з двох (так само рахує жеребка). */
  const shown = (cls: CharClass, kx: KxMode, side: BuffSide | null, f: keyof BuffCell) => {
    const row = b.pct[cls][kx];
    return side ? row[side][f] : Math.max(row.rs[f], row.je[f]);
  };
  /** При вимкненій стороні число пишеться в обидві сторони — тоді max = це число. */
  const setCell = (cls: CharClass, kx: KxMode, side: BuffSide | null, f: keyof BuffCell, v: number) => {
    const row = b.pct[cls][kx];
    const next = { ...row };
    for (const s of side ? [side] : SIDE_ORDER) next[s] = { ...row[s], [f]: v };
    patchBuffs({ pct: { ...b.pct, [cls]: { ...b.pct[cls], [kx]: next } } });
  };
  const applyRecommended = () => {
    if (!confirm('Замінити числа таблиці бафів рекомендованими (шлях 11 рівня: Танк 22/16, Прист 15/19, Воїн 10/8, Страж 2/2, Друїд 20/20 — припущення, Маг 1/0, Лучник 1/1, решта 0; під КХ менше)? Галочка «Враховувати бафи», КХ, стеля і решта параметрів не зміняться.')) return;
    patchBuffs({ pct: deepCopy(RECOMMENDED_BUFFS_PCT) });
  };

  // ── «Перевірка»: живий приклад на штучних гравцях, тими самими формулами, що й жеребка ──
  const [recv, setRecv] = useState<CharClass>('archer');
  const [recvScore, setRecvScore] = useState(250);
  const [mates, setMates] = useState<CharClass[]>(['barbarian', 'cleric', 'blademaster', 'seeker']);
  const [checkS, setCheckS] = useState(3);
  const mateN = Math.min(mates.length, Math.max(1, checkS - 1));
  const teamMates = mates.slice(0, mateN);
  const team = [{ cls: recv, side: null }, ...teamMates.map((c) => ({ cls: c, side: null }))];
  const receiver = { cls: recv, kill: comp.profiles[recv].kill };
  const pctIn = (kx: KxMode, rules = draft.balance) => buffPctTo(receiver, team, rules, kx, checkS);
  const noCapRules = { ...draft.balance, buffs: { ...b, cap: Number.MAX_SAFE_INTEGER } };
  const pNo = pctIn('noKx'), pKx = pctIn('kx');
  const rawNo = pctIn('noKx', noCapRules), rawKx = pctIn('kx', noCapRules);
  const capHit = rawNo > pNo + 1e-9 || rawKx > pKx + 1e-9;
  const pts = (p: number) => Math.round((recvScore * p) / 100);
  const fmtPct = (p: number) => (Number.isInteger(p) ? String(p) : p.toFixed(1));
  // Приклад для підказки про стелю — з чернетки, а не зашитими числами (після
  // правки таблиці чи стелі зашиті «Танк 22 + Прист 15» брехали б): найщедріші
  // дарувальники фізикам без КХ, сильніша сторона — так само рахує buffPctTo.
  const donorPhys = CLASS_ORDER
    .map((c) => ({ c, v: Math.max(b.pct[c].noKx.rs.phys, b.pct[c].noKx.je.phys) }))
    .sort((x, y) => y.v - x.v || CLASS_ORDER.indexOf(x.c) - CLASS_ORDER.indexOf(y.c));
  const sumTop = (n: number) => donorPhys.slice(0, n).reduce((a, x) => a + x.v, 0);
  const whoTop = (n: number) => donorPhys.slice(0, n).map((x) => `${CLASS_LABELS[x.c]} ${x.v}`).join(' + ');
  const capEx = { pair: sumTop(2), pairWho: whoTop(2), trio: sumTop(3), trioWho: whoTop(3) };

  const mateProfiles = teamMates.map((c) => comp.profiles[c]);
  const isTop = receiver.kill >= FULL_DD_KILL && recvScore >= comp.topDdMinScore;
  let verdict: string;
  if (!isTop) {
    verdict = `не діє — ${CLASS_LABELS[recv]} ${recvScore} не топовий ДД (потрібен повний ДД зі скором від ${comp.topDdMinScore})`;
  } else if (checkS === 2 && comp.pairsRule !== 'legacy') {
    const st = { topDd: mateProfiles.filter((p) => p.kill >= FULL_DD_KILL).length, topMateAmpMax: Math.max(0, ...mateProfiles.map((p) => p.amp)) };
    if (comp.pairsRule === 'off') verdict = 'у парах вимкнено';
    else if (pairViolates(st, comp.pairsRule)) verdict = `заборонено (${st.topDd > 0 ? 'другий повний ДД' : 'Друїд'} у парі з топовим ДД; жорстко)`;
    else verdict = 'дозволено';
  } else {
    const secondDd = mateProfiles.filter((p) => p.kill >= FULL_DD_KILL).length;
    const support = mateProfiles.reduce((a, p) => a + p.amp, 0);
    const over = support - comp.topSupportAllow;
    const reasons: string[] = [];
    if (secondDd > 0) reasons.push(`другий повний ДД (штраф ${comp.weights.topSecondDd * secondDd})`);
    if (over > 1e-9) reasons.push(`підтримка ${Math.round(support * 100)} % > дозволених ${Math.round(comp.topSupportAllow * 100)} % (штраф ${(over * comp.weights.topSupport).toFixed(0)})`);
    verdict = reasons.length ? `заборонено: ${reasons.join(', ')}` : 'дозволено';
  }
  const teamWord = checkS === 2 ? 'пари' : checkS === 3 ? 'трійки' : 'команди';

  const cellStyle = { padding: '3px 4px', textAlign: 'center' as const };
  // не className="hint": .hint — display:block, а th у таблиці має лишатись клітинкою
  const subHead = { color: 'var(--text-mute)', fontWeight: 500 as const };
  const sides: (BuffSide | null)[] = b.bySide ? SIDE_ORDER : [null];

  return (
    <div className="card" style={{ padding: 14 }}>
      <CardHead
        title="Бафи тімейтів у силі команди"
        right={<span className={'badge ' + (b.enabled ? 'good' : 'mute')}>{b.enabled ? 'увімкнено' : 'вимкнено'}</span>}
      />
      <p className="hint" style={{ margin: '0 0 10px' }}>
        Танк, Прист, Воїн роблять тімейтів сильнішими, ніж каже їхній гір. Таблиця нижче каже, на скільки відсотків, а галочка — чи враховувати це
        в жеребці. <b>Сила команди = гір + бафи.</b> Приклад: команда А — гір 480 + бафи 90 = сила 570; команда Б — гір 530 + бафи 20 = сила 550.
        Різниця сили 20 — команди вважаються рівними, хоч гір різниться на 50. Ціна: сирий гір між командами розходиться сильніше
        (на живому пулі 3×3: розкид гіру 8 → 69–81), тому на сторінці турніру головна цифра — сила, гір довідково.
      </p>

      <label className="checkbox-row" style={{ marginBottom: 6 }}>
        <input type="checkbox" checked={b.enabled} onChange={(e) => patchBuffs({ enabled: e.target.checked })} />
        <b>Враховувати бафи в силі команди</b>
      </label>
      <p className="hint" style={{ margin: '0 0 12px' }}>
        Увімкнено: команди вирівнюються за силою (гір + бафи від тімейтів), бонус діє і в командах по 2. Вимкнено: як раніше — лише гір, таблиця нижче
        на жеребку не впливає. Якщо в правилах турніру знято рядок «Бафи лише від своєї пачки», бафи для того турніру не рахуються незалежно від галочки.
      </p>

      <div className="field-row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <label className="field" style={{ flex: '0 1 220px' }}>
          <span>КХ-бафи за замовчуванням</span>
          <select value={b.defaultKx} style={{ padding: '8px 30px 8px 10px', fontSize: 14 }} onChange={(e) => patchBuffs({ defaultKx: e.target.value === 'kx' ? 'kx' : 'noKx' })}>
            <option value="noKx">без КХ</option>
            <option value="kx">під КХ</option>
          </select>
        </label>
        <NumInput label="Стеля бафів одному гравцю, %" value={b.cap} onChange={(v) => patchBuffs({ cap: Math.min(100, v) })} width={200} />
      </div>
      <p className="hint" style={{ margin: '4px 0 12px' }}>
        <b>КХ</b> — яку колонку таблиці брати, коли в правилах турніру поле «КХ-бафи» не задано (у попапі правил можна перекрити для конкретного
        турніру). Під КХ бафи Танка і Приста слабші, бо частина їх із КХ не складається: для Лучника 250 з Танком і Пристом різниця ≈ 25 балів.
        <br />
        <b>Стеля</b> — більше цього один гравець від тімейтів не отримує.
        {capEx.trio > 0 ? (
          <>
            {' '}За цією таблицею (фізикам, без КХ) у трійці два найщедріші дарувальники дають {capEx.pairWho} = {fmtPct(capEx.pair)} % — стеля {b.cap} %
            {' '}{capEx.pair > b.cap + 1e-9 ? 'спрацьовує вже там' : 'у парах і трійках не спрацьовує'}; від 4 гравців {capEx.trioWho} = {fmtPct(capEx.trio)} %
            {' '}→ {fmtPct(Math.min(capEx.trio, b.cap))} %. Точні числа для будь-якого складу — у блоці «Перевірка» нижче.
          </>
        ) : (
          ' Таблиця зараз порожня (усі нулі), тож стеля ні на що не впливає — заповни таблицю або натисни «Рекомендовані (шлях 11 рівня)».'
        )}
      </p>

      <label className="checkbox-row" style={{ marginBottom: 4 }}>
        <input type="checkbox" checked={b.bySide} onChange={(e) => patchBuffs({ bySide: e.target.checked })} />
        Сторона дарувальника має значення (мудрець / демон)
      </label>
      <p className="hint" style={{ margin: '0 0 12px' }}>
        Вимкнено (за замовчуванням): одна колонка = сильніша сторона, бо шлях на 100+ є у всіх. Увімкнено: для кожного класу окремі числа за стороною;
        якщо сторона гравця невідома (анкета її поки не питає) — береться більше з двох.
      </p>

      <b style={{ fontSize: 13 }}>Частка бафів у силі за розміром команди, %</b>
      <p className="hint" style={{ margin: '2px 0 8px' }}>
        Запобіжник для масових форматів: при 5×5 рівна сила розводить гір між командами на 140–210 балів. 100 = бафи рахуються повністю,
        50 = наполовину, 0 = у цьому розмірі не рахуються (галочка лишається увімкненою для інших).
      </p>
      <div className="field-row" style={{ gap: 10 }}>
        {SIZE_KEYS.map((k) => (
          <NumInput key={k} label={`Команди по ${SIZE_LABELS[k]}`} value={b.sizeWeight[k]} onChange={(v) => patchBuffs({ sizeWeight: { ...b.sizeWeight, [k]: Math.min(100, v) } })} width={130} />
        ))}
      </div>

      <label className="checkbox-row" style={{ margin: '14px 0 4px' }}>
        <input type="checkbox" checked={b.killScaled} onChange={(e) => patchBuffs({ killScaled: e.target.checked })} />
        Множити бафи на урон отримувача
      </label>
      <p className="hint" style={{ margin: '0 0 14px' }}>
        Стражу, який майже не б'є (урон {Math.round(comp.profiles.seeker.kill * 100)} %), атакуючі бафи Танка дають менше, ніж Лучнику: увімкнено —
        бафи множаться на «Урон» класу отримувача з картки «Склад команди» (Страж отримує {Math.round(comp.profiles.seeker.kill * 100)} % від таблиці),
        тож бафи йдуть переважно ДД. Вимкнено — усі отримують повну цифру.
      </p>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <b style={{ fontSize: 13 }}>Таблиця: дарувальник → скільки % сили додає тімейту</b>
        <button type="button" className="btn btn-ghost btn-sm" onClick={applyRecommended} title="Заповнює лише числа таблиці; галочку «Враховувати бафи» та решту параметрів не чіпає">
          Рекомендовані (шлях 11 рівня)
        </button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="buff-table">
          <thead>
            <tr>
              <th rowSpan={b.bySide ? 3 : 2} style={{ textAlign: 'left' }}>Дарувальник</th>
              {KX_ORDER.map((kx) => <th key={kx} colSpan={2 * sides.length}>{KX_LABELS[kx]}</th>)}
            </tr>
            <tr>
              {KX_ORDER.map((kx) => CELL_FIELDS.map((f) => <th key={kx + f} colSpan={sides.length} style={subHead}>{CELL_LABELS[f]}</th>))}
            </tr>
            {b.bySide && (
              <tr>
                {KX_ORDER.map((kx) => CELL_FIELDS.map((f) => SIDE_ORDER.map((s) => (
                  <th key={kx + f + s} style={subHead}>{SIDE_LABELS[s]}</th>
                ))))}
              </tr>
            )}
          </thead>
          <tbody>
            {CLASS_ORDER.map((c) => (
              <tr key={c}>
                <td style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {CLASS_LABELS[c]} <span className="hint" style={{ display: 'inline', margin: 0 }}>{isPhysClass(c) ? 'фіз' : 'маг'}</span>
                </td>
                {KX_ORDER.map((kx) => CELL_FIELDS.map((f) => sides.map((s) => (
                  <td key={kx + f + (s ?? '')} style={cellStyle}>
                    <CellInput
                      value={shown(c, kx, s, f)}
                      title={`${CLASS_LABELS[c]} → ${CELL_LABELS[f]}, ${kx === 'kx' ? 'під КХ' : 'без КХ'}${s ? `, ${SIDE_LABELS[s]}` : ''}`}
                      onChange={(v) => setCell(c, kx, s, f, v)}
                    />
                  </td>
                ))))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ margin: '8px 0 0' }}>
        Фізики: {classList(PHYS_CLASSES)}. Маги: {classList(CLASS_ORDER.filter((c) => !isPhysClass(c)))}. Число — на скільки відсотків росте
        сила гравця-отримувача, коли в його команді є цей клас. Свій клас не рахується (власні бафи в скор не входять); два однакові класи в команді = один.
        <br />
        Танк і Прист є і тут, і в «Підтримці» картки «Склад команди», бо роблять дві різні речі: бафають стати (тут) і лікують / тримають ДД живим (там) —
        це не подвійний облік. Містик 0: його хіли — лише в «Підтримці». Друїд 20 % — <b>припущення</b> (Пурга / Amp / дебафи як підсилення урону союзника,
        КХ на них не впливає): без цього рядка жеребка у 2×2 садить найслабшого Друїда до найсильнішого ДД.
      </p>

      {/* ── Перевірка ── */}
      <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
        <b style={{ fontSize: 13 }}>Перевірка</b>
        <p className="hint" style={{ margin: '2px 0 8px' }}>
          Живий приклад тими самими формулами, що й жеребка (стеля, частка за розміром, множник на урон — усе враховано).
          {!b.enabled && ' Бафи зараз вимкнено — це лише перевірка таблиці, на жеребку вона не впливає.'}
        </p>
        <div className="field-row" style={{ gap: 10, alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: '0 1 150px' }}>
            <span>Отримувач</span>
            <select value={recv} style={{ padding: '6px 30px 6px 8px', fontSize: 13 }} onChange={(e) => setRecv(e.target.value as CharClass)}>
              {CLASS_ORDER.map((c) => <option key={c} value={c}>{CLASS_LABELS[c]}</option>)}
            </select>
          </label>
          <NumInput label="Його гір" value={recvScore} onChange={setRecvScore} />
          <label className="field" style={{ flex: '0 1 120px' }}>
            <span>Команди по</span>
            <select value={checkS} style={{ padding: '6px 30px 6px 8px', fontSize: 13 }} onChange={(e) => setCheckS(Number(e.target.value))}>
              {[2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}{n === 5 ? '+' : ''}</option>)}
            </select>
          </label>
          {teamMates.map((c, i) => (
            <label key={i} className="field" style={{ flex: '0 1 150px' }}>
              <span>Тімейт {i + 1}</span>
              <select value={c} style={{ padding: '6px 30px 6px 8px', fontSize: 13 }} onChange={(e) => setMates(mates.map((m, j) => (j === i ? (e.target.value as CharClass) : m)))}>
                {CLASS_ORDER.map((k) => <option key={k} value={k}>{CLASS_LABELS[k]}</option>)}
              </select>
            </label>
          ))}
        </div>
        <p style={{ margin: '10px 0 0', fontSize: 14 }}>
          <b>{CLASS_LABELS[recv]} {recvScore}</b> + {teamMates.map((c) => CLASS_LABELS[c]).join(' + ')}:
          без КХ <b>+{pts(pNo)}</b> балів ({fmtPct(pNo)} %), під КХ <b>+{pts(pKx)}</b> ({fmtPct(pKx)} %).
          {' '}Стеля {b.cap} % {capHit ? <>спрацювала (без стелі було б {fmtPct(rawNo)} % / {fmtPct(rawKx)} %)</> : 'не спрацювала'}.
          {' '}Правило 4 для цієї {teamWord}: <b>{verdict}</b>.
        </p>
      </div>
    </div>
  );
}

// ── Картка «Склад команди (ролі)» ─────────────────────────────

function CompositionCard() {
  const { draft } = useRulesDraft();
  const comp = draft.balance.composition;
  const buffsOn = draft.balance.buffs.enabled;
  const patchComp = patchComposition;

  /** Штраф за одну таку пачку без урахування неминучого — для підказки в картці. */
  const killerW = comp.weights.killer || RECOMMENDED_COMPOSITION_WEIGHTS.killer;
  const ex = (...classes: CharClass[]) => {
    const maxKill = Math.max(...classes.map((c) => comp.profiles[c].kill));
    const pen = killerW * Math.max(0, 1 - maxKill);
    return pen > 0 ? `${Math.round(pen)}` : '0 (ок)';
  };
  const killerExample = (c: CharClass) => Math.round(killerW * Math.max(0, 1 - comp.profiles[c].kill));
  const dangerExample = (c: CharClass, build: 'dd' | 'con' = 'dd') => {
    const kill = comp.profiles[c].kill * comp.buildKill[build];
    return `${build === 'con' ? 'кон-' : ''}${CLASS_LABELS[c]} ${Math.round(kill * 100)} % — ${kill >= comp.threatMinKill ? 'так' : 'ні'}`;
  };
  /** «Зв'язка» для прикладу: пари [клас, гір] — так само, як рахує алгоритм. */
  const strengthExample = (team: Array<[CharClass, number]>) => {
    const dmg = team.map(([c, score]) => score * comp.profiles[c].kill);
    const bestIdx = dmg.indexOf(Math.max(...dmg));
    const rest = dmg.reduce((a, d, i) => a + (i === bestIdx ? 0 : d), 0);
    const amp = team.reduce((a, [c], i) => a + (i === bestIdx ? 0 : comp.profiles[c].amp), 0);
    return (((dmg[bestIdx] + comp.secondDd * rest) / 100) * (1 + Math.min(1, amp))).toFixed(2);
  };
  /** Хто в парі «Друїд» для положення «…і не Друїда» — за профілями, а не за назвою класу. */
  const druids = CLASS_ORDER.filter((c) => comp.profiles[c].amp >= DRUID_AMP - 1e-9);
  const fullDds = CLASS_ORDER.filter((c) => comp.profiles[c].kill >= FULL_DD_KILL);

  const applyRecommended = () => {
    if (!confirm('Заповнити весь блок узгодженими значеннями: профілі класів, збірки, другий ДД, ваги правил, положення для пар і «профіль сили» 25 %? Таблиця бафів не зміниться.')) return;
    patchBalance({
      weights: { ...draft.balance.weights, top: RECOMMENDED_TOP_PROFILE_WEIGHT },
      composition: { ...deepCopy(BUILTIN_COMPOSITION), weights: { ...RECOMMENDED_COMPOSITION_WEIGHTS }, pairsRule: RECOMMENDED_PAIRS_RULE },
    });
  };

  return (
    <div className="card" style={{ padding: 14 }}>
      <CardHead
        title="Склад команди (ролі)"
        right={
          <button type="button" className="btn btn-ghost btn-sm" title="Профілі класів, збірки, другий ДД, ваги правил, положення для пар і «профіль сили» 25 %" onClick={applyRecommended}>
            Рекомендовані значення
          </button>
        }
      />
      <p className="hint" style={{ margin: '0 0 10px' }}>
        Гір каже, наскільки сильний кожен гравець сам по собі{buffsOn ? ', бафи (картка вище) — наскільки тімейти його підсилюють' : ''}. Цей блок — про те, чи команда взагалі зможе когось убити:
        двоє сапортів і Страж програють навіть з найбільшим гіром. Тут ти задаєш, хто вбиває, а хто допомагає, і наскільки це важливо для алгоритму.
      </p>

      <b style={{ fontSize: 13 }}>Що вміє клас</b>
      <p className="hint" style={{ margin: '2px 0 8px' }}>
        <b>Урон</b> — чи може вбити сам: 100 — так (Лук, Сін, Шаман, Маг); 50 — може добити, але сам не винесе (Танк, Вар); 20–30 — сам не вб'є.<br />
        <b>Підтримка</b> — наскільки клас тримає ДД живим і контролює ворога (хіл, дебафи, зняття захисту з цілі): 100 — Дру; 50 — Прист, Танк, Містик; 0 — чисті ДД.
        Класові бафи на стати (Рев Танка, бафи Приста) сюди не входять — вони рахуються окремо, у таблиці «Бафи тімейтів».
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, auto) repeat(2, 110px)', gap: '6px 10px', alignItems: 'center', width: 'fit-content' }}>
        <span />
        <span className="hint" style={{ margin: 0, textAlign: 'center' }}>Урон, %</span>
        <span className="hint" style={{ margin: 0, textAlign: 'center' }}>Підтримка, %</span>
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

      <div style={{ marginTop: 16 }}>
        <b style={{ fontSize: 13 }}>Збірка персонажа (з анкети)</b>
        <p className="hint" style={{ margin: '2px 0 8px' }}>
          Кон-збірка ріже урон: шмот той самий, а вбиває гірше. Число — скільки відсотків урону свого класу лишається гравцеві.
          Приклад: Сін у кон-збірці = 100 % × {Math.round(comp.buildKill.con * 100)} % = {Math.round(comp.profiles.assassin.kill * comp.buildKill.con * 100)} % урону.
        </p>
        <div className="field-row" style={{ gap: 10 }}>
          {BUILD_ORDER.map((bk) => (
            <PctInput key={bk} label={BUILD_LABELS[bk]} value={comp.buildKill[bk]} onChange={(v) => patchComp({ buildKill: { ...comp.buildKill, [bk]: v } })} />
          ))}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <b style={{ fontSize: 13 }}>Другий ДД у команді</b>
        <p className="hint" style={{ margin: '2px 0 8px' }}>
          Другий ДД теж завдає шкоди, але його урон не збирається з першим в один бурст. Число — з якою часткою він входить у «зв'язку» команди (третій і далі так само).
        </p>
        <div className="field-row" style={{ gap: 10 }}>
          <PctInput label="Другий ДД додає, %" value={comp.secondDd} onChange={(v) => patchComp({ secondDd: v })} />
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <b style={{ fontSize: 13 }}>Головний ДД команди</b>
        <p className="hint" style={{ margin: '2px 0 0' }}>
          Це гравець команди, у якого найбільший урон (колонка «Урон» × його збірка). <b>Не той, у кого найбільший гір.</b> Далі в правилах — «головний ДД».
        </p>
      </div>

      <div style={{ marginTop: 16 }}>
        <b style={{ fontSize: 13 }}>Кого суперник мусить фокусити</b>
        <p className="hint" style={{ margin: '2px 0 8px' }}>
          Гравець «небезпечний», якщо його урон не менший за це число. Потрібно лише для другого правила.
        </p>
        <div className="field-row" style={{ gap: 10, alignItems: 'flex-end' }}>
          <PctInput label="Небезпечний від, % урону" value={comp.threatMinKill} onChange={(v) => patchComp({ threatMinKill: v })} />
          <span className="hint" style={{ margin: '0 0 10px' }}>
            Зараз: {dangerExample('archer')} · {dangerExample('barbarian')} · {dangerExample('seeker')} · {dangerExample('assassin', 'con')}.
          </span>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <b style={{ fontSize: 13 }}>Правила</b>
        <p className="hint" style={{ margin: '2px 0 8px' }}>
          Алгоритм перебирає розклади й бере той, де найменше штрафу. Головний штраф — різниця сум {buffsOn ? 'сили (гір + бафи)' : 'гіру'} між командами (зазвичай 10–45 балів).
          Число біля правила — скільки балів додається за одне порушення, тобто наскільки гіршим гіром алгоритм готовий заплатити, щоб його уникнути:
          <b> 0</b> — правило вимкнене; <b>10</b> — виправить склад, тільки якщо це майже безкоштовно; <b>30</b> — піде на гірший гір до ~15–20 балів; <b>100</b> — виконає майже завжди.
          Те, чого уникнути неможливо (ДД менше, ніж команд), не штрафується.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: '12px 14px', alignItems: 'start', maxWidth: 780 }}>
          <RuleRow value={comp.weights.killer} onChange={(v) => patchComp({ weights: { ...comp.weights, killer: v } })} title="Команді нема ким убивати">
            Штраф тим більший, чим слабший головний ДД команди: число × (100 % − його урон).
            При {comp.weights.killer || RECOMMENDED_COMPOSITION_WEIGHTS.killer} це: Шаман — 0 · Танк — {killerExample('barbarian')} · Містик — {killerExample('mystic')} · Страж — {killerExample('seeker')} · Прист — {killerExample('cleric')}.
          </RuleRow>
          <RuleRow value={comp.weights.twoThreats} onChange={(v) => patchComp({ weights: { ...comp.weights, twoThreats: v } })} title="У команді лише один небезпечний">
            Кожна команда рахується окремо: якщо небезпечних у ній менше двох, саме ця команда отримує штраф = число. Суперник фокусить єдиного ДД — і решта нічого не зробить.
            Лук + Прист + Страж — небезпечний один, штраф {comp.weights.twoThreats || RECOMMENDED_COMPOSITION_WEIGHTS.twoThreats}; Лук + Танк + Прист — двоє, штрафу нема. Для команд по 2 правило вимкнене.
          </RuleRow>
          <RuleRow value={comp.weights.kpRange} onChange={(v) => patchComp({ weights: { ...comp.weights, kpRange: v } })} title="Сильному ДД — слабку підтримку">
            Прист і Танк тримають головного ДД живим, Дру знімає з цілі захист. Якщо дати це топовому ДД — його не вб'ють, а він уб'є всіх.
            Для кожної команди рахується <b>зв'язка</b> = (гір×урон головного ДД + {Math.round(comp.secondDd * 100)} % від решти ДД) ÷ 100 × (1 + підтримка решти).
            Приклад із гіром 200 + 150 + 100: Сін + Танк + Прист = {strengthExample([['assassin', 200], ['barbarian', 150], ['cleric', 100]])}, Сін + Страж + Містик = {strengthExample([['assassin', 200], ['seeker', 150], ['mystic', 100]])},
            а два ДД разом Сін + Маг + Страж = {strengthExample([['assassin', 200], ['wizard', 150], ['seeker', 100]])}.
            Штраф = число × різниця між найбільшою і найменшою зв'язкою в жеребці. Через це підтримка дістається слабшим ДД, а два сильних ДД не збираються в одній команді.
          </RuleRow>
          <RuleRow value={comp.weights.topSecondDd} onChange={(v) => patchComp({ weights: { ...comp.weights, topSecondDd: v } })} title="Топовому ДД — без другого ДД (команди 3+)">
            Топовий ДД — повний ДД зі скором від {comp.topDdMinScore} (див. поле нижче). Такий сам «ДД за трьох»: якщо поставити поруч ще одного повного ДД, команду не вбити.
            Штраф = число за кожного іншого повного ДД у його команді. XenuS + Маг + Шаман — {comp.weights.topSecondDd ? comp.weights.topSecondDd * 2 : RECOMMENDED_COMPOSITION_WEIGHTS.topSecondDd * 2}.
            У парах — окреме правило нижче.
          </RuleRow>
          <RuleRow value={comp.weights.topSupport} onChange={(v) => patchComp({ weights: { ...comp.weights, topSupport: v } })} title="Топовому ДД — не більше однієї підтримки (команди 3+)">
            Тімейтам топового ДД дозволено сумарну «Підтримку» до {Math.round(comp.topSupportAllow * 100)} %: Страж + один Прист, Танк або Містик — можна; Друїд чи два підсилювачі — уже ні.
            Штраф = число × перевищення: Страж + Друїд = {((comp.profiles.seeker.amp + comp.profiles.venomancer.amp - comp.topSupportAllow) * (comp.weights.topSupport || RECOMMENDED_COMPOSITION_WEIGHTS.topSupport)).toFixed(0)}, Танк + Прист = {((comp.profiles.barbarian.amp + comp.profiles.cleric.amp - comp.topSupportAllow) * (comp.weights.topSupport || RECOMMENDED_COMPOSITION_WEIGHTS.topSupport)).toFixed(0)}.
            Рекомендовано {RECOMMENDED_COMPOSITION_WEIGHTS.topSupport}: у 3×3 дає ті самі розклади, що 40, але не «продає» Друїда топу за кілька балів гіру. У парах — окреме правило нижче.
          </RuleRow>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <b style={{ fontSize: 13 }}>У командах по 2 (пари) — топовому ДД можна…</b>
        <div className="field-row" style={{ gap: 10, marginTop: 6 }}>
          <label className="field" style={{ flex: '1 1 320px', maxWidth: 520 }}>
            <select value={comp.pairsRule} style={{ padding: '8px 30px 8px 10px', fontSize: 14 }} onChange={(e) => patchComp({ pairsRule: e.target.value as PairsRule })}>
              {/* «Як для 3+» — лише коли чернетка (зі старої версії) уже в цьому положенні:
                  для пар це мертві ваги (40 чи 100 = вимкнене правило), обирати його нема чого */}
              {PAIRS_RULES.filter((r) => r !== 'legacy' || comp.pairsRule === 'legacy').map((r) => (
                <option key={r} value={r}>{PAIRS_RULE_LABELS[r]}{r === RECOMMENDED_PAIRS_RULE ? ' (рекомендовано)' : ''}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="hint" style={{ margin: '6px 0 0' }}>
          У парі тімейт один, тому ваги вище там не працюють: «дозвіл підтримки» означає лише «Друїда не можна», а вага 40 чи 100 дає той самий розклад,
          що й вимкнене правило. Тому для пар — окреме положення словами, і воно <b>жорстке</b>: пару з порушенням жеребка не допускає, якщо пул дозволяє
          (коли топових ДД більше, ніж дозволених партнерів, порушення понад неминуче не штрафуються, а ДД-партнери дістаються слабшим топам).
          Повний ДД — {classList(fullDds)}; «Друїд» — клас із підтримкою 100 % ({classList(druids) || 'нема'}).
          <br />
          Числа на живому пулі (24 гравці, 12 пар), Друїд у таблиці бафів 0 %: «крім другого ДД» → XenuS + Друїд, розкид сили 44;
          «також не Друїда» → XenuS + Містик, розкид 94–102; з рядком Друїда 20 % усі положення дають один розклад (XenuS + Містик, розкид 66).
          {comp.pairsRule === 'legacy' && (
            <>
              <br />
              <b>Зараз обрано «Як для 3+»</b> — так рахуються версії шкали до появи цього поля: у парах працюють лише ваги вище, а для пари це фактично
              вимкнене правило. Для нової версії обери одне з положень вище (після цього «Як для 3+» зі списку зникне; старі турніри й далі рахуються біт-у-біт).
            </>
          )}
        </p>
      </div>

      <div className="field-row" style={{ gap: 10, marginTop: 12 }}>
        <NumInput label="Топовий ДД — від скору" value={comp.topDdMinScore} onChange={(v) => patchComp({ topDdMinScore: v })} width={170} />
        <PctInput label="Дозволена підтримка топового ДД, % (команди 3+)" value={comp.topSupportAllow} onChange={(v) => patchComp({ topSupportAllow: v })} />
      </div>
      <p className="hint" style={{ margin: '6px 0 0' }}>
        Поріг — обрив: корекція скору навколо нього вмикає / вимикає правило 4 для гравця. Гравець зі скором {comp.topDdMinScore + 3} після корекції −4
        має {comp.topDdMinScore - 1} — і правило на нього вже не діє. Тому перевірка в грі й корекції біля порогу важливіші, ніж деінде.
      </p>
      <p className="hint" style={{ margin: '12px 0 0' }}>
        Приклади за першим правилом{comp.weights.killer > 0 ? '' : ` (воно зараз вимкнене — показано, як було б при ${RECOMMENDED_COMPOSITION_WEIGHTS.killer})`}:
        Шаман+Танк+Дру — {ex('psychic', 'barbarian', 'venomancer')} · Дру+Танк+Страж — {ex('venomancer', 'barbarian', 'seeker')} · Танк+Страж — {ex('barbarian', 'seeker')} · Прист+Страж — {ex('cleric', 'seeker')} · Дру+Танк — {ex('venomancer', 'barbarian')}.
      </p>
    </div>
  );
}

// ── Картка «Алгоритм» ─────────────────────────────────────────

function AlgorithmCard() {
  const { draft } = useRulesDraft();
  const bal = draft.balance;
  return (
    <div className="card" style={{ padding: 14 }}>
      <b>Алгоритм (обережно)</b>
      <p className="hint" style={{ margin: '0 0 8px' }}>
        ε-коридор — на скільки балів штрафу гірший розклад ще вважається «таким самим» і може бути обраний випадково (більше = більше рандому, менше = точніший баланс);
        вага ролей — штраф за нерівномірний розподіл ролі між командами;
        профіль сили — щоб найсильніший гравець і двоє найсильніших були схожі в усіх командах (проти «стеку топів»); рахується за сирим гіром навіть при
        увімкнених бафах. У командах по 3 він заважає правилу про топового ДД, тому рекомендовано {Math.round(RECOMMENDED_TOP_PROFILE_WEIGHT * 100)} %;
        у парах на розклад не впливає — лише на цифру штрафу.
      </p>
      <div className="field-row" style={{ gap: 10 }}>
        <NumInput label="ε-коридор" value={bal.epsilon} onChange={(v) => patchBalance({ epsilon: v })} />
        <NumInput label="Кандидатів (top-N)" value={bal.topN} onChange={(v) => patchBalance({ topN: Math.max(1, v) })} width={140} />
        <NumInput label="Вага ролей" value={bal.weights.role} onChange={(v) => patchBalance({ weights: { ...bal.weights, role: v } })} />
        <PctInput label="Профіль сили, %" value={bal.weights.top} onChange={(v) => patchBalance({ weights: { ...bal.weights, top: v } })} />
      </div>
    </div>
  );
}

export default function TeamTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p className="hint" style={{ margin: 0 }}>
        Тут — як із гравців збираються команди: бафи тімейтів (сила команди = гір + бафи), хто вбиває, а хто допомагає, правило 4 і параметри алгоритму.
        Скільки коштує гравець сам по собі — на вкладці «Шкала балів»; чернетка спільна, зберігається внизу як нова версія.
      </p>
      <BuffsCard />
      <CompositionCard />
      <AlgorithmCard />
    </div>
  );
}
