// =========================================================
// Адмінка (суперадмін): вкладка «Правила» — довідник рядків правил турніру
// (таблиця rule_items, 0027). Три картки-групи (Бій / Реєстрація й анкета /
// Склади й резерв); у рядка — підпис адміну, під ним сірим текст гравцю з
// підставленим дефолтом, чіпи (тип, формати, «⚙ впливає на жеребку»,
// «системний») і кнопки «Редагувати / Архівувати / ▲ ▼» (для доданих — ще
// «Видалити»). Редактор рядка розгортається під рядком, не модалкою — на
// телефоні модалка поверх модалки незручна; порядок — лише стрілками
// (HTML5 drag на тачі не працює).
//
// Правки діють лише на нові турніри: турнір зберігає знімок тексту на момент
// збереження (tournaments.rule_flags), тому старі тексти тут не змінюються.
// =========================================================

import { useState } from 'react';
import { errorMessage } from '../../app/errorMessage';
import {
  RULE_AFFECTS_HINTS, RULE_FORMATS, RULE_FORMAT_LABELS, RULE_GROUPS, RULE_GROUP_LABELS, RULE_KINDS, RULE_KIND_LABELS,
  sortItems, textOfItem, type RuleFormat, type RuleGroup, type RuleItem, type RuleKind, type RuleOption,
} from '../../data/ruleCatalog';
import { archiveItem, createItem, deleteItem, reorderItems, saveItem, useRuleCatalog } from '../../data/catalogStore';

/** Текст гравцю з підставленим дефолтом — як його побачить наступний турнір. */
function previewOf(item: RuleItem): string {
  const text = item.kind === 'choice' || item.kind === 'number' ? textOfItem(item, item.defaultValue) : item.textPlayer;
  if (item.kind === 'choice' && !text) return '(за замовчуванням — не згадується)';
  if ((item.kind === 'flag') && item.defaultValue === false) return `(знято за замовчуванням) ${text}`;
  return text || '(без тексту)';
}

function kindChip(item: RuleItem): string {
  switch (item.kind) {
    case 'choice': return `вибір: ${(item.options ?? []).map((o) => o.label).join(' · ') || '—'}`;
    case 'number': return `число: ${String(item.defaultValue ?? '')}`;
    default: return RULE_KIND_LABELS[item.kind];
  }
}

/** Редактор одного рядка (правка або новий). Валідація — тут, збереження — один upsert. */
function RowEditor({ item, isNew, busy, onSave, onCancel }: { item: RuleItem; isNew: boolean; busy: boolean; onSave: (next: RuleItem) => void; onCancel: () => void }) {
  const [d, setD] = useState<RuleItem>(() => ({ ...item, options: item.options ? item.options.map((o) => ({ ...o })) : null, visibleFor: [...item.visibleFor] }));
  const patch = (p: Partial<RuleItem>) => setD((prev) => ({ ...prev, ...p }));
  // Для kx/reserve значення варіантів читає жеребка — додавати/видаляти не можна, лише підписи й тексти.
  const optionsFixed = !!d.affects && d.kind === 'choice';

  const setKind = (kind: RuleKind) => {
    if (kind === d.kind) return;
    const options = kind === 'choice' ? (d.options && d.options.length ? d.options : [{ value: 'yes', label: 'так', text: d.textPlayer }, { value: 'no', label: 'ні', text: '' }]) : null;
    const defaultValue = kind === 'choice' ? options![0].value : kind === 'number' ? (typeof d.defaultValue === 'number' ? d.defaultValue : 15) : d.defaultValue !== false;
    patch({ kind, options, defaultValue });
  };
  const setOption = (i: number, p: Partial<RuleOption>) => patch({ options: (d.options ?? []).map((o, idx) => (idx === i ? { ...o, ...p } : o)) });
  const addOption = () => {
    const opts = d.options ?? [];
    let n = opts.length + 1;
    while (opts.some((o) => o.value === `v${n}`)) n++;
    patch({ options: [...opts, { value: `v${n}`, label: '', text: '' }] });
  };
  const removeOption = (i: number) => {
    const opts = (d.options ?? []).filter((_, idx) => idx !== i);
    patch({ options: opts, defaultValue: opts.some((o) => o.value === d.defaultValue) ? d.defaultValue : opts[0]?.value ?? null });
  };
  const toggleFormat = (f: RuleFormat, on: boolean) =>
    patch({ visibleFor: on ? RULE_FORMATS.filter((x) => x === f || d.visibleFor.includes(x)) : d.visibleFor.filter((x) => x !== f) });

  const problems: string[] = [];
  if (!d.labelAdmin.trim()) problems.push('Потрібен підпис для адміна.');
  if (d.visibleFor.length === 0) problems.push('Обери хоча б один формат, інакше рядок ніде не показуватиметься.');
  if (d.kind === 'choice') {
    const opts = d.options ?? [];
    if (opts.length === 0) problems.push('Для вибору потрібен хоча б один варіант.');
    if (opts.some((o) => !o.value.trim() || !o.label.trim())) problems.push('У кожного варіанта мають бути значення й підпис.');
    if (new Set(opts.map((o) => o.value.trim())).size !== opts.length) problems.push('Значення варіантів мають бути різними.');
  } else if (d.kind === 'number') {
    if (typeof d.defaultValue !== 'number' || !Number.isFinite(d.defaultValue)) problems.push('Для числа потрібне значення за замовчуванням.');
    if (!d.textPlayer.includes('{value}')) problems.push('У тексті гравцю має бути {value} — сюди підставиться число.');
  } else if (!d.textPlayer.trim()) {
    problems.push('Потрібен текст для гравця.');
  }

  return (
    <div style={{ marginTop: 10, padding: 12, border: '1px solid var(--line-2)', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="field-row">
        <label className="field" style={{ flex: '2 1 260px' }}>
          <span>Підпис для адміна</span>
          <input type="text" value={d.labelAdmin} maxLength={160} placeholder="напр. Без 2-ї вспишки" onChange={(e) => patch({ labelAdmin: e.target.value })} />
        </label>
        <label className="field" style={{ flex: '1 1 160px', opacity: d.isSystem ? 0.6 : 1 }} title={d.isSystem ? 'Тип задано в коді' : undefined}>
          <span>Тип{d.isSystem ? ' (задано в коді)' : ''}</span>
          <select value={d.kind} disabled={d.isSystem} onChange={(e) => setKind(e.target.value as RuleKind)}>
            {RULE_KINDS.map((k) => <option key={k} value={k}>{RULE_KIND_LABELS[k]}</option>)}
          </select>
        </label>
      </div>
      {d.kind !== 'choice' && (
        <label className="field">
          <span>Текст для гравця</span>
          <textarea rows={d.key === 'reg_block' ? 6 : 2} value={d.textPlayer} onChange={(e) => patch({ textPlayer: e.target.value })} />
          <small className="hint">
            {d.kind === 'number'
              ? '{value} — сюди підставиться число. Приклад: «Дозволено до {value} секунд кайта / інвіза.»'
              : 'Кожен рядок тексту стає окремим пунктом правил. Пиши простими словами, як гравцю.'}
          </small>
        </label>
      )}
      {d.kind === 'choice' && (
        <div className="field">
          <span>Варіанти{optionsFixed ? ' (значення використовує жеребка — можна змінити лише підписи й тексти)' : ''}</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(d.options ?? []).map((o, i) => (
              <div key={i} className="field-row" style={{ gap: 8, alignItems: 'flex-end' }}>
                <label className="field" style={{ flex: '0 1 110px' }}>
                  <span>значення</span>
                  <input type="text" value={o.value} disabled={optionsFixed} maxLength={40} style={{ padding: '8px 10px', fontSize: 13 }} onChange={(e) => setOption(i, { value: e.target.value })} />
                </label>
                <label className="field" style={{ flex: '1 1 140px' }}>
                  <span>підпис у попапі</span>
                  <input type="text" value={o.label} maxLength={60} style={{ padding: '8px 10px', fontSize: 13 }} onChange={(e) => setOption(i, { label: e.target.value })} />
                </label>
                <label className="field" style={{ flex: '3 1 240px' }}>
                  <span>текст гравцю (порожній = не згадувати)</span>
                  <input type="text" value={o.text} style={{ padding: '8px 10px', fontSize: 13 }} onChange={(e) => setOption(i, { text: e.target.value })} />
                </label>
                {!optionsFixed && (
                  <button type="button" className="btn btn-ghost btn-sm" title="Прибрати варіант" onClick={() => removeOption(i)}>✕</button>
                )}
              </div>
            ))}
            {!optionsFixed && <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={addOption}>+ Варіант</button>}
          </div>
        </div>
      )}
      <div className="field-row" style={{ alignItems: 'flex-start' }}>
        <div className="field" style={{ flex: '0 1 220px' }}>
          <span>За замовчуванням</span>
          {d.kind === 'choice' ? (
            <select value={String(d.defaultValue ?? '')} onChange={(e) => patch({ defaultValue: e.target.value })}>
              {(d.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label || o.value}</option>)}
            </select>
          ) : d.kind === 'number' ? (
            <input type="number" inputMode="numeric" value={typeof d.defaultValue === 'number' ? d.defaultValue : ''} onChange={(e) => patch({ defaultValue: e.target.value === '' ? null : Number(e.target.value) })} />
          ) : d.kind === 'text' ? (
            <span className="hint" style={{ margin: 0 }}>лише текст — входить у правила завжди для обраних форматів</span>
          ) : (
            <label className="checkbox-row" style={{ fontSize: 14 }}>
              <input type="checkbox" checked={d.defaultValue !== false} onChange={(e) => patch({ defaultValue: e.target.checked })} />
              галочка стоїть у новому турнірі
            </label>
          )}
        </div>
        <div className="field" style={{ flex: '1 1 260px' }}>
          <span>Показувати для форматів</span>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {RULE_FORMATS.map((f) => (
              <label key={f} className="checkbox-row" style={{ fontSize: 14 }}>
                <input type="checkbox" checked={d.visibleFor.includes(f)} onChange={(e) => toggleFormat(f, e.target.checked)} />
                {RULE_FORMAT_LABELS[f]}
              </label>
            ))}
          </div>
        </div>
      </div>
      {d.affects && (
        <p className="hint" style={{ margin: 0 }}>⚙ Впливає на жеребку (лише читання): {RULE_AFFECTS_HINTS[d.affects]}.</p>
      )}
      {problems.length > 0 && <p className="form-err">{problems.join(' ')}</p>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Скасувати</button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || problems.length > 0}
          onClick={() => onSave({ ...d, labelAdmin: d.labelAdmin.trim(), options: d.options ? d.options.map((o) => ({ value: o.value.trim(), label: o.label.trim(), text: o.text })) : null })}
        >
          {isNew ? 'Додати рядок' : 'Зберегти рядок'}
        </button>
      </div>
    </div>
  );
}

export function RuleCatalogTab() {
  const { loaded, items } = useRuleCatalog();
  const [showArchived, setShowArchived] = useState(false);
  // Редагований рядок: ключ існуючого або чернетка нового (ще не в довіднику).
  const [editing, setEditing] = useState<{ item: RuleItem; isNew: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(errorMessage(e, 'Не вдалося зберегти довідник.'));
    } finally {
      setBusy(false);
    }
  };

  const move = (rows: RuleItem[], i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = rows.slice();
    [next[i], next[j]] = [next[j], next[i]];
    // Перенумеровуємо всю групу через 10 — так пари з однаковим sort теж
    // розводяться; у БД їдуть лише рядки, у яких sort змінився (зазвичай два).
    const renumbered = next.map((r, idx) => ({ ...r, sort: (idx + 1) * 10 }));
    void run(() => reorderItems(renumbered.filter((r, idx) => r.sort !== next[idx].sort)));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <b>Правила турнірів — довідник рядків</b>
          {!loaded && <span className="hint" style={{ margin: 0 }}>довантажую довідник…</span>}
          <label className="checkbox-row" style={{ marginLeft: 'auto', fontSize: 14 }}>
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Показати архівовані
          </label>
        </div>
        <p className="hint" style={{ margin: 0 }}>
          З цих рядків збирається текст правил кожного турніру (кнопка «Правила…» у редакторі турніру) і публічна сторінка «Правила».
          Зміни діють лише на нові турніри — у турнірі зберігається знімок тексту на момент збереження. Приклад: змінив «кайт 15 с» на
          «20 с» — сторінка старого турніру далі каже 15, наступний турнір отримає 20.
        </p>
        {err && <p className="form-err">{err}</p>}
      </div>

      {RULE_GROUPS.map((grp) => {
        const rows = sortItems(items.filter((i) => i.grp === grp && (showArchived || !i.archived)));
        return (
          <div key={grp} className="card" style={{ padding: 16 }}>
            <b style={{ fontSize: 15 }}>{RULE_GROUP_LABELS[grp]}</b>
            {rows.length === 0 && <p className="hint">Рядків немає.</p>}
            {rows.map((item, i) => (
              <div key={item.key} style={{ padding: '10px 0', borderTop: '1px solid var(--line)', marginTop: i === 0 ? 8 : 0 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 260px', minWidth: 0, opacity: item.archived ? 0.55 : 1 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <b>{item.labelAdmin || '(без підпису)'}</b>
                      {item.archived && <span className="badge mute">архів</span>}
                    </div>
                    <span className="hint" style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{previewOf(item)}</span>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      <span className="badge mute">{kindChip(item)}</span>
                      <span className="badge mute">{item.visibleFor.map((f) => RULE_FORMAT_LABELS[f]).join(' · ') || 'ніде'}</span>
                      {item.affects && <span className="badge warn" title={RULE_AFFECTS_HINTS[item.affects]}>⚙ впливає на жеребку</span>}
                      {item.isSystem && <span className="badge mute" title="Не видаляється — лише архівується; тип задано в коді">системний</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy || i === 0} title="Вище" onClick={() => move(rows, i, -1)}>▲</button>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy || i === rows.length - 1} title="Нижче" onClick={() => move(rows, i, 1)}>▼</button>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setEditing({ item, isNew: false })}>Редагувати</button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      title={item.archived ? 'Повернути в довідник' : 'Рядок зникне з попапу й публічної сторінки; у створених турнірах текст лишиться'}
                      onClick={() => run(() => archiveItem(item.key, !item.archived))}
                    >
                      {item.archived ? 'Повернути' : 'Архівувати'}
                    </button>
                    {!item.isSystem && (
                      <button
                        type="button"
                        className="btn btn-bad btn-sm"
                        disabled={busy}
                        onClick={() => confirm(`Видалити рядок «${item.labelAdmin}»? Рядок зникне з довідника. У вже створених турнірах текст лишиться.`) && run(() => deleteItem(item.key))}
                      >
                        Видалити
                      </button>
                    )}
                  </div>
                </div>
                {editing && !editing.isNew && editing.item.key === item.key && (
                  <RowEditor
                    key={item.key}
                    item={item}
                    isNew={false}
                    busy={busy}
                    onCancel={() => setEditing(null)}
                    onSave={(next) => run(async () => { await saveItem(next); setEditing(null); })}
                  />
                )}
              </div>
            ))}
            {editing && editing.isNew && editing.item.grp === grp ? (
              <RowEditor
                key={editing.item.key}
                item={editing.item}
                isNew
                busy={busy}
                onCancel={() => setEditing(null)}
                onSave={(next) => run(async () => { await saveItem(next); setEditing(null); })}
              />
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 10 }}
                disabled={busy || !loaded}
                title={loaded ? undefined : 'Зачекай, довідник довантажується'}
                onClick={() => setEditing({ item: createItem(grp), isNew: true })}
              >
                + Додати рядок
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
