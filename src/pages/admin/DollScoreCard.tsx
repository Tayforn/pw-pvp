// =========================================================
// «Шкала балів» → картка «Скор з ляльки». Режим (вимкнено / тіньовий /
// увімкнено), бали за подвоєння сили, частка атаки за збіркою, типовий
// суперник і еталони класів. Еталон береться зі збереженого персонажа
// (потрібен вхід через Discord на цьому сайті): лялька рахує його атаку й
// живучість, а бали спорядження — за таблицею, якщо анкета персонажа повна.
// Модуль ляльки вантажиться лише по кнопці.
// =========================================================

import { useState } from 'react';
import { BUILD_LABELS, CLASS_LABELS, CLASS_ORDER, type DollRef, type DollScoreMode, type GearRules } from '../../data/gearRules';
import type { Build, CharClass } from '../../data/types';
import { useMe } from '../../app/useMe';
import type { CharacterSummary } from '../../doll/registration';

const MODE_LABELS: Record<DollScoreMode, string> = {
  off: 'Вимкнено',
  shadow: 'Тіньовий — показувати адміну поруч з анкетою, жеребка за анкетою',
  on: 'Увімкнено — заявки персонажем рахуються з ляльки',
};

const num = (v: string, min = 0) => Math.max(min, Number(v) || 0);

export default function DollScoreCard({ draft, patch }: { draft: GearRules; patch: (p: Partial<GearRules>) => void }) {
  const ds = draft.dollScore;
  const set = (p: Partial<GearRules['dollScore']>) => patch({ dollScore: { ...ds, ...p } });
  const setRef = (cls: CharClass, ref: DollRef | null) => {
    const refs = { ...ds.refs };
    if (ref) refs[cls] = ref;
    else delete refs[cls];
    set({ refs });
  };
  const { me, login } = useMe();
  const [chars, setChars] = useState<CharacterSummary[] | null>(null);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [sameBase, setSameBase] = useState('');

  const loadChars = () => {
    setMsg(null);
    import('../../doll/registration')
      .then((m) => m.myCharacters())
      .then(setChars)
      .catch((e) => setMsg('Не вдалося завантажити персонажів: ' + (e instanceof Error ? e.message : String(e))));
  };
  const takeRef = () => {
    if (!pick) return;
    setBusy(true);
    setMsg(null);
    import('../../doll/registration')
      .then((m) => m.referenceFromCharacter(pick, draft))
      .then(({ cls, ref, note }) => {
        setRef(cls, ref);
        setMsg(`Еталон класу «${CLASS_LABELS[cls]}» — «${ref.label}»: атака ${ref.off}, живучість ${ref.def}, бали спорядження ${ref.base}.${note ? ' ' + note : ''}`);
      })
      .catch((e) => setMsg('Не вдалося взяти еталон: ' + (e instanceof Error ? e.message : String(e))))
      .finally(() => setBusy(false));
  };

  // Усі персонажі «Еталон…» разом: кожен стає еталоном свого класу. Два на один
  // клас — береться перший за списком (найсвіжіший), решта названа в повідомленні.
  const takeAll = () => {
    setBusy(true);
    setMsg(null);
    import('../../doll/registration')
      .then(async (m) => {
        const list = (await m.myCharacters()).filter((c) => c.name.toLowerCase().startsWith('еталон'));
        if (!list.length) throw new Error('немає персонажів з іменем, що починається на «Еталон».');
        const refs: Partial<Record<CharClass, DollRef>> = {};
        const dup: string[] = [];
        const failed: string[] = [];
        for (const c of list) {
          try {
            const r = await m.referenceFromCharacter(c.id, draft);
            if (refs[r.cls]) dup.push(c.name);
            else refs[r.cls] = r.ref;
          } catch (e) {
            failed.push(`${c.name} (${e instanceof Error ? e.message : String(e)})`);
          }
        }
        return { refs, dup, failed };
      })
      .then(({ refs, dup, failed }) => {
        set({ refs: { ...ds.refs, ...refs } });
        const got = CLASS_ORDER.filter((c) => refs[c]);
        const miss = CLASS_ORDER.filter((c) => !refs[c] && !ds.refs[c]);
        setMsg(
          `Взято еталонів: ${got.length} (${got.map((c) => CLASS_LABELS[c]).join(', ') || '—'}).` +
            (miss.length ? ` Без еталона: ${miss.map((c) => CLASS_LABELS[c]).join(', ')}.` : '') +
            (dup.length ? ` Пропущено як другий на клас: ${dup.join(', ')}.` : '') +
            (failed.length ? ` Не вдалося: ${failed.join('; ')}.` : '') +
            ' Не забудь зберегти версію шкали.',
        );
      })
      .catch((e) => setMsg('Не вдалося взяти еталони: ' + (e instanceof Error ? e.message : String(e))))
      .finally(() => setBusy(false));
  };
  const applySameBase = () => {
    const v = Number(sameBase);
    if (!Number.isFinite(v) || sameBase.trim() === '') return;
    const refs = { ...ds.refs };
    for (const c of Object.keys(refs) as CharClass[]) refs[c] = { ...refs[c]!, base: Math.round(v) };
    set({ refs });
    setMsg(`Бали еталона ${Math.round(v)} — для всіх ${Object.keys(refs).length} класів з еталоном.`);
  };

  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <b>Скор з ляльки</b>
        <span className="badge mute">заявки персонажем</span>
      </div>
      <p className="hint" style={{ margin: '0 0 8px' }}>
        Замість грейдів (зброя, броня, точка, камені, кільця, трактат, рівень) скор спорядження рахується з характеристик ляльки: <b>атака</b> (середня атака × крит × швидкість
        × ПА проти ПЗ типового суперника) і <b>живучість</b> (HP із фіз./маг. захистом × ПЗ проти ПА суперника). Кожен клас порівнюється зі своїм еталоном: персонаж,
        удвічі сильніший за еталон, отримує на «бали за подвоєння» більше, удвічі слабший — менше. Бали класу, джин, ШГ/Вознєс і запасне рахуються як завжди.
      </p>

      <label className="field" style={{ maxWidth: 560, marginBottom: 10 }}>
        <span>Режим</span>
        <select value={ds.mode} onChange={(e) => set({ mode: e.target.value as DollScoreMode })}>
          {(Object.keys(MODE_LABELS) as DollScoreMode[]).map((m) => (
            <option key={m} value={m}>
              {MODE_LABELS[m]}
            </option>
          ))}
        </select>
      </label>

      <div className="field-row" style={{ gap: 10 }}>
        <label className="field">
          <span>Бали за подвоєння сили</span>
          <input type="number" min={0} value={ds.perDouble} onChange={(e) => set({ perDouble: num(e.target.value) })} />
        </label>
        <label className="field">
          <span>Суперник: ПА</span>
          <input type="number" min={0} value={ds.oppPa} onChange={(e) => set({ oppPa: num(e.target.value) })} />
        </label>
        <label className="field">
          <span>Суперник: ПЗ</span>
          <input type="number" min={0} value={ds.oppPz} onChange={(e) => set({ oppPz: num(e.target.value) })} />
        </label>
      </div>
      <div className="field-row" style={{ gap: 10, marginTop: 6 }}>
        {(['dd', 'hybrid', 'con'] as Build[]).map((b) => (
          <label key={b} className="field">
            <span>Атака у скорі, % — {BUILD_LABELS[b]}</span>
            <input
              type="number"
              min={0}
              max={100}
              value={Math.round(ds.alphaByBuild[b] * 100)}
              onChange={(e) => set({ alphaByBuild: { ...ds.alphaByBuild, [b]: Math.min(1, num(e.target.value) / 100) } })}
            />
          </label>
        ))}
      </div>
      <p className="hint" style={{ margin: '6px 0 12px' }}>
        Приклад: ДД з атакою на 40 % більшою за еталон і такою ж живучістю отримує +{Math.round(ds.perDouble * ds.alphaByBuild.dd * Math.log2(1.4))} до балів еталона;
        кон (частка атаки {Math.round(ds.alphaByBuild.con * 100)} %) за те саме — +{Math.round(ds.perDouble * ds.alphaByBuild.con * Math.log2(1.4))}. Збірку визначає лялька.
      </p>

      <b style={{ fontSize: 14 }}>Еталони класів</b>
      <div style={{ overflowX: 'auto', marginTop: 6 }}>
        <table className="buff-table" style={{ minWidth: 560 }}>
          <thead>
            <tr>
              <th>Клас</th>
              <th>Персонаж</th>
              <th>Атака</th>
              <th>Живучість</th>
              <th title="Скільки балів спорядження має еталон (без класу, джина, ШГ/Вознєса й запасного)">Бали еталона</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {CLASS_ORDER.map((cls) => {
              const ref = ds.refs[cls];
              return (
                <tr key={cls}>
                  <td>{CLASS_LABELS[cls]}</td>
                  <td>{ref ? ref.label || '—' : <span className="hint">не задано</span>}</td>
                  <td>{ref?.off ?? '—'}</td>
                  <td>{ref?.def ?? '—'}</td>
                  <td>
                    {ref ? (
                      <input type="number" style={{ width: 80 }} value={ref.base} onChange={(e) => setRef(cls, { ...ref, base: Number(e.target.value) || 0 })} />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {ref && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRef(cls, null)}>
                        Прибрати
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end', marginTop: 10 }}>
        {me && (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={takeAll}>
            {busy ? 'Рахую…' : 'Взяти еталони з усіх моїх «Еталон…»'}
          </button>
        )}
        <label className="field" style={{ width: 150 }}>
          <span>Бали еталона всім</span>
          <input type="number" value={sameBase} placeholder="напр. 92" onChange={(e) => setSameBase(e.target.value)} />
        </label>
        <button type="button" className="btn btn-ghost btn-sm" disabled={sameBase.trim() === '' || !Object.keys(ds.refs).length} onClick={applySameBase}>
          Застосувати до всіх
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end', marginTop: 10 }}>
        {!me ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={login}>
            Увійти через Discord, щоб узяти еталон із персонажа
          </button>
        ) : chars === null ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={loadChars}>
            Взяти еталон з одного персонажа…
          </button>
        ) : (
          <>
            <label className="field" style={{ minWidth: 240 }}>
              <span>Мій персонаж</span>
              <select value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">— обери —</option>
                {chars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.level}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn btn-primary btn-sm" disabled={!pick || busy} onClick={takeRef}>
              {busy ? 'Рахую…' : 'Зробити еталоном свого класу'}
            </button>
          </>
        )}
      </div>
      {msg && <p className="hint" style={{ margin: '8px 0 0' }}>{msg}</p>}
      <p className="hint" style={{ margin: '8px 0 0' }}>
        Еталони й числа зберігаються у версії шкали (кнопка внизу). Змінили «суперника» — перевізьміть еталони, бо атака й живучість залежать від нього.
      </p>
    </div>
  );
}
