// =========================================================
// Адмінка: попап «Правила…» редактора турніру — рядки довідника для формату
// турніру (галочки / селекти / числа), «Додатково» по рядку на пункт і живе
// прев'ю тексту, який піде в rules_md. Результат — знімок TournamentRuleFlags
// (ключ, стан, ТЕКСТ на момент збереження): пізніша правка довідника цей
// турнір не змінює. Повторне відкриття показує знімок; якщо в довіднику текст
// рядка інший — підказка «оновити цей рядок», без автозаміни.
//
// «⚙ впливає на жеребку» — лише при балансному фул-рандомі (party_buffs, kx,
// reserve читає жеребка); після формування команд ці рядки заблоковано
// (drawLocked), при підтверджених заявках зміна тексту вимагає confirm.
// «Зберегти» заблоковано, поки довідник не довантажився — інакше у знімок
// пішов би вбудований текст замість довідника.
// =========================================================

import { useEffect, useMemo, useState } from 'react';
import type { TeamMode } from '../../data/types';
import type { TournamentRuleFlagItem, TournamentRuleFlags } from '../../data/ruleFlags';
import {
  RULE_AFFECTS_HINTS, catalogTextFor, defaultFlagItem, defaultFlagsFor, drawEffectHint, formatOf, itemsForFormat, renderRulesMd, stripBullet, textOfItem,
  type RuleItem,
} from '../../data/ruleCatalog';
import { useRuleCatalog } from '../../data/catalogStore';

interface Props {
  teamSize: number | null;
  teamMode: TeamMode;
  /** знімок турніру; null — новий турнір або перехід з textarea (дефолти формату) */
  initial: TournamentRuleFlags | null;
  /** команди вже сформовані — рядки, що впливають на жеребку, не змінити */
  drawLocked: boolean;
  /** підтверджених заявок — при зміні тексту питаємо підтвердження */
  confirmedCount: number;
  onClose: () => void;
  onSave: (flags: TournamentRuleFlags) => void;
}

/** Рядок попапу: рядок довідника (item) і/або його стан у знімку (fi). item = null —
 * ключ зі знімка, якого серед рядків для ЦЬОГО формату немає: рядок або є в
 * довіднику для іншого формату (other — після зміни 3×3 → 1х1 у знімку лишились
 * reserve/reg_block), або його вже немає зовсім. */
interface Row { key: string; item: RuleItem | null; fi: TournamentRuleFlagItem | null; other: RuleItem | null }

export default function RulesPopup({ teamSize, teamMode, initial, drawLocked, confirmedCount, onClose, onSave }: Props) {
  const { loaded, items } = useRuleCatalog();
  const format = formatOf(teamSize, teamMode);
  const balanced = teamMode === 'balanced_random' && format === 'balanced';
  const catalogRows = useMemo(() => itemsForFormat(items, format), [items, format]);

  // Робочий знімок: з initial одразу; без нього — дефолти, коли довідник довантажився.
  const [flagItems, setFlagItems] = useState<TournamentRuleFlagItem[] | null>(initial ? initial.items : loaded ? defaultFlagsFor(items, teamSize, teamMode).items : null);
  const [extraText, setExtraText] = useState((initial?.extra ?? []).join('\n'));
  useEffect(() => {
    if (flagItems === null && loaded) setFlagItems(defaultFlagsFor(items, teamSize, teamMode).items);
  }, [flagItems, loaded, items, teamSize, teamMode]);

  const fiByKey = useMemo(() => new Map((flagItems ?? []).map((fi) => [fi.key, fi])), [flagItems]);
  const itemByKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items]);
  const rows: Row[] = useMemo(() => {
    const list: Row[] = catalogRows.map((item) => ({ key: item.key, item, fi: fiByKey.get(item.key) ?? null, other: null }));
    for (const fi of flagItems ?? []) if (!catalogRows.some((i) => i.key === fi.key)) list.push({ key: fi.key, item: null, fi, other: itemByKey.get(fi.key) ?? null });
    return list;
  }, [catalogRows, fiByKey, flagItems, itemByKey]);

  // Стан рядка для показу: знімок, а рядка з довідника, якого в знімку нема, — дефолт.
  const stateOf = (row: Row): TournamentRuleFlagItem => row.fi ?? (row.item ? defaultFlagItem(row.item) : { key: row.key, on: false, text: '' });
  const isDrawRow = (row: Row) => balanced && !!row.item?.affects;
  const lockedRow = (row: Row) => drawLocked && isDrawRow(row);

  const setState = (row: Row, next: TournamentRuleFlagItem) => {
    setFlagItems((prev) => {
      const cur = prev ?? [];
      return cur.some((fi) => fi.key === row.key) ? cur.map((fi) => (fi.key === row.key ? next : fi)) : [...cur, next];
    });
  };
  const toggle = (row: Row, on: boolean) => {
    const st = stateOf(row);
    // Текст — з довідника на момент зміни (для рядків без довідника лишаємо знімок).
    const text = row.item ? catalogTextFor(row.item, st) : st.text;
    setState(row, { ...st, on, text });
  };
  const setValue = (row: Row, value: string | number) => {
    const st = stateOf(row);
    setState(row, { ...st, value, text: row.item ? textOfItem(row.item, value) : st.text });
  };
  const refreshText = (row: Row) => {
    const st = stateOf(row);
    if (row.item) setState(row, { ...st, text: catalogTextFor(row.item, st) });
  };

  /** Знімок, який піде в турнір: рядки в порядку показу, «Додатково» без маркерів. */
  const buildSnapshot = (): TournamentRuleFlags => ({
    v: 1,
    items: rows.map(stateOf),
    extra: extraText.split(/\r?\n/).map(stripBullet).filter(Boolean),
  });
  const preview = flagItems ? renderRulesMd(buildSnapshot(), teamSize, teamMode) : '';

  const resetToDefaults = () => {
    const defaults = defaultFlagsFor(items, teamSize, teamMode).items;
    // Після формування команд ⚙-рядки лишаються як у знімку — жеребка вже їх прочитала.
    if (drawLocked && initial) {
      for (const fi of initial.items) {
        const it = itemByKey.get(fi.key);
        if (balanced && it?.affects) {
          const idx = defaults.findIndex((d) => d.key === fi.key);
          if (idx >= 0) defaults[idx] = fi; else defaults.push(fi);
        }
      }
    }
    setFlagItems(defaults);
  };

  const save = () => {
    if (!flagItems) return;
    const next = buildSnapshot();
    if (confirmedCount > 0 && initial && renderRulesMd(next, teamSize, teamMode) !== renderRulesMd(initial, teamSize, teamMode)) {
      if (!confirm(`${confirmedCount} гравців уже підтвердили заявку за іншим текстом правил. Змінити правила?`)) return;
    }
    onSave(next);
  };

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" style={{ width: 'min(920px, 100%)' }}>
        <div className="modal-head">
          <h3>Правила турніру</h3>
          <button type="button" className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="hint" style={{ margin: 0 }}>Постав галочки й параметри — текст у блоці «Так побачать гравці» збирається сам.</span>
              <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} disabled={!loaded} onClick={resetToDefaults}>Стандартні для формату</button>
            </div>
            {!loaded && <p className="hint" style={{ margin: 0 }}>довантажую довідник…</p>}
            {drawLocked && balanced && (
              <p className="hint" style={{ margin: 0 }}>Команди вже сформовані — рядки «⚙ впливає на жеребку» не змінюються (спершу розформуй команди).</p>
            )}
            {flagItems && rows.map((row) => {
              const st = stateOf(row);
              const item = row.item;
              const locked = lockedRow(row);
              const stale = !!item && !!row.fi && row.fi.text !== catalogTextFor(item, row.fi);
              // Що саме зробить жеребка з цим рядком у його поточному стані — простими
              // словами під рядком: ГМ вкладку «Правила» з підказками довідника не бачить.
              const effect = isDrawRow(row) ? drawEffectHint(st) : null;
              const chips = (
                <>
                  {isDrawRow(row) && <span className="badge warn" title={item?.affects ? RULE_AFFECTS_HINTS[item.affects] : 'Цей рядок читає жеребка'}>⚙ впливає на жеребку</span>}
                  {item && !row.fi && <span className="badge mute" title="Рядок додано в довідник після створення турніру">новий у довіднику</span>}
                  {!item && (row.other
                    ? <span className="badge mute" title="Рядок є в довіднику, але не для формату цього турніру (формат змінили після збереження правил): зніми галочку або лиши свідомо">не для цього формату</span>
                    : <span className="badge mute">рядка вже нема в довіднику</span>)}
                </>
              );
              const lockStyle = locked ? { opacity: 0.55, cursor: 'not-allowed' as const } : undefined;
              return (
                <div key={row.key} style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 8, borderBottom: '1px solid var(--line)' }}>
                  {item?.kind === 'choice' ? (
                    <label className="field" style={lockStyle}>
                      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>{item.labelAdmin} {chips}</span>
                      <select value={String(st.value ?? '')} disabled={locked} onChange={(e) => setValue(row, e.target.value)}>
                        {(item.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </label>
                  ) : item?.kind === 'number' ? (
                    <div className="checkbox-row" style={{ ...lockStyle, flexWrap: 'wrap', alignItems: 'center' }}>
                      <input type="checkbox" checked={st.on !== false} disabled={locked} onChange={(e) => toggle(row, e.target.checked)} />
                      <span>{item.labelAdmin}</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={typeof st.value === 'number' ? st.value : ''}
                        disabled={locked || st.on === false}
                        style={{ width: 80, padding: '6px 8px', fontSize: 14 }}
                        onChange={(e) => setValue(row, e.target.value === '' ? 0 : Number(e.target.value))}
                      />
                      {chips}
                    </div>
                  ) : item?.kind === 'text' ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', color: 'var(--text-dim)', fontSize: 14 }}>
                      <span title="Лише текст — входить у правила завжди">{item.labelAdmin}</span>
                      {chips}
                    </div>
                  ) : (
                    <label className="checkbox-row" style={{ ...lockStyle, flexWrap: 'wrap' }}>
                      <input type="checkbox" checked={st.on !== false} disabled={locked} onChange={(e) => toggle(row, e.target.checked)} />
                      <span>{item ? item.labelAdmin : row.other ? row.other.labelAdmin : row.key}</span>
                      {chips}
                    </label>
                  )}
                  <span className="hint" style={{ margin: 0, whiteSpace: 'pre-wrap', paddingLeft: item?.kind === 'choice' ? 0 : 26 }}>
                    {st.text.trim() ? st.text : item?.kind === 'choice' ? '(не згадується)' : ''}
                  </span>
                  {effect && (
                    <span className="hint" style={{ margin: 0, paddingLeft: item?.kind === 'choice' ? 0 : 26, color: 'var(--text-dim)' }}>⚙ {effect}</span>
                  )}
                  {stale && (
                    <span className="hint" style={{ margin: 0, paddingLeft: item?.kind === 'choice' ? 0 : 26, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      у довіднику текст змінився
                      <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '3px 8px', fontSize: 12 }} disabled={locked} onClick={() => refreshText(row)}>оновити цей рядок</button>
                    </span>
                  )}
                </div>
              );
            })}
            <label className="field">
              <span>Додатково (по рядку на пункт)</span>
              <textarea rows={3} value={extraText} placeholder={'БД вино дозволено.\nБез 2-ї вспишки.'} onChange={(e) => setExtraText(e.target.value)} />
            </label>
          </div>
          <div style={{ minWidth: 0 }}>
            <span style={{ fontSize: 13, color: 'var(--text-dim)', fontWeight: 500 }}>Так побачать гравці</span>
            <pre style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', fontSize: 13.5, lineHeight: 1.5, padding: 12, border: '1px solid var(--line)', borderRadius: 12, maxHeight: '60vh', overflowY: 'auto' }}>
              {preview || 'довантажую довідник…'}
            </pre>
          </div>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Скасувати</button>
          {!loaded && <span className="hint" style={{ margin: 0 }}>довантажую довідник…</span>}
          <button type="button" className="btn btn-primary" disabled={!loaded || !flagItems} onClick={save}>Зберегти</button>
        </div>
      </div>
    </div>
  );
}
