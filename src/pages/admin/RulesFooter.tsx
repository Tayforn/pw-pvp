// =========================================================
// Адмінка (суперадмін): sticky-футер версії шкали — спільний для вкладок
// «Шкала балів» і «Бафи й склад», бо чернетка в них одна (rulesDraftStore).
// Показує, яка версія зараз поточна, з якої зроблено чернетку, чи є
// незбережені зміни, дає завантажити стару версію в чернетку і зберегти
// чернетку як НОВУ версію з нотаткою.
// =========================================================

import { useMemo } from 'react';
import {
  draftNextVersion, draftTiersValid, loadDraftVersion, resetDraft, saveDraft, setDraftNote, useRulesDraft,
} from '../../data/rulesDraftStore';
import { useRules } from '../../data/rulesStore';

export default function RulesFooter() {
  const { base, draft, dirty, note, busy, err, savedAs, loaded, current } = useRulesDraft();
  const { versions } = useRules();
  const tiersValid = draftTiersValid(draft);
  const next = useMemo(() => draftNextVersion(), [versions.length]);

  const pick = (v: string) => {
    if (dirty && !confirm('Чернетку буде замінено обраною версією. Продовжити?')) return;
    loadDraftVersion(v);
  };
  const save = () => {
    if (!tiersValid) return;
    if (!confirm(`Зберегти як нову версію ${next}? Нові турніри рахуватимуться нею, уже сформовані — лишаться на своїх.`)) return;
    void saveDraft();
  };

  return (
    <div className="card rules-footer">
      <div style={{ display: 'flex', gap: '4px 12px', alignItems: 'center', flexWrap: 'wrap', fontSize: 13.5 }}>
        <span>Поточна версія для нових турнірів: <b>{current}</b></span>
        {!loaded && <span className="hint" style={{ margin: 0 }}>завантажую версії…</span>}
        <span className="hint" style={{ margin: 0 }}>
          Чернетка на основі: <b>{base}</b>
          {dirty ? <span className="badge warn" style={{ marginLeft: 8 }}>є незбережені зміни</span> : ''}
        </span>
        {savedAs && <span className="badge good">Збережено як {savedAs} — тепер це поточна версія</span>}
        {!tiersValid && <span className="badge bad">пороги tier мають спадати</span>}
      </div>
      <div style={{ display: 'flex', gap: '8px 12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label className="field" style={{ flex: '1 1 200px', maxWidth: 320 }}>
          <span>Версії</span>
          <select value={base} style={{ padding: '8px 30px 8px 10px', fontSize: 13 }} onChange={(e) => pick(e.target.value)}>
            {versions.map((v) => (
              <option key={v.version} value={v.version}>
                {v.version}{v.version === current ? ' (поточна)' : ''}{v.createdAt ? ` · ${v.createdAt.slice(0, 10)}` : ''}{v.note ? ` · ${v.note}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ flex: '2 1 240px' }}>
          <span>Що змінилось (нотатка до версії)</span>
          <input type="text" value={note} maxLength={200} placeholder="напр. увімкнули бафи, Друїд 20 %" style={{ padding: '8px 10px', fontSize: 13 }} onChange={(e) => setDraftNote(e.target.value)} />
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || !dirty || !tiersValid} onClick={save}>
            {busy ? 'Зберігаю…' : `Зберегти як ${next}`}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy || !dirty} onClick={() => { if (confirm('Скинути всі незбережені зміни чернетки?')) resetDraft(); }}>
            Скасувати зміни
          </button>
        </div>
      </div>
      {err && <p className="form-err">{err}</p>}
    </div>
  );
}
