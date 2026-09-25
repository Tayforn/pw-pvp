// =========================================================
// ЛЯЛЬКА — інвентар активної вкладки: усі речі персонажа, НЕ надіті в цій
// конфігурації (один пул — Головний і сети лише посилаються на речі). На
// вкладці сету тут лежать і речі Головного з позначкою «Г» — їх надівають
// кліком. Сироти (не надіті ніде) просто лежать: у бали вони не входять.
// Перетягування речі зі слота сюди — «зняти в інвентар».
// =========================================================

import { useMemo, useState } from 'react';
import { computeStats, meetsReq } from '../core/stats';
import { CFG_MAIN, inventoryOf, whereWorn, type HydratedInst } from '../model/hydrate';
import { COARSE_PTR } from './CellMenu';
import Counters from './Counters';
import { useEditor } from './EditorContext';
import { INV_DROP_KEY, type DnD } from './hooks/useDnD';
import InventoryCell, { type SetMark } from './InventoryCell';

type Filter = 'all' | 'main' | 'free';

interface Row {
  h: HydratedInst;
  worn: Array<{ cfgId: string; slot: string }>;
}

export default function Inventory({ dnd }: { dnd: DnD }) {
  const api = useEditor();
  const { doc, model, activeCfg: cfgId, readOnly } = api;
  const isMain = cfgId === CFG_MAIN;
  const [filter, setFilter] = useState<Filter>('all');
  // На Головному «з головного» в інвентарі не буває — фільтр ховаємо, а вибраний скидаємо.
  const eff: Filter = isMain && filter === 'main' ? 'all' : filter;

  const build = api.buildOf(cfgId);
  const gearAttr = useMemo(() => computeStats(build).gearAttr, [build]);
  // Позначка сету — його номер у смузі вкладок (назви «ПЗ», «ПА», «ПЗ 2» мають ту саму першу літеру).
  const sets = useMemo(() => new Map<string, SetMark>(doc.sets.map((s, i) => [s.id, { n: i + 1, name: s.name, kind: s.kind }])), [doc.sets]);

  const rows = useMemo<Row[]>(
    () =>
      inventoryOf(model, cfgId)
        .map((iid) => model.items.get(iid))
        .filter((h): h is HydratedInst => !!h)
        .map((h) => ({ h, worn: whereWorn(model, h.inst.i) })),
    [model, cfgId],
  );
  const fromMain = rows.filter((r) => r.worn.some((w) => w.cfgId === CFG_MAIN)).length;
  const free = rows.filter((r) => r.worn.length === 0).length;
  const shown = rows.filter((r) => (eff === 'main' ? r.worn.some((w) => w.cfgId === CFG_MAIN) : eff === 'free' ? r.worn.length === 0 : true));

  const filters: Array<{ k: Filter; label: string; n: number }> = [
    { k: 'all', label: 'Усі', n: rows.length },
    ...(isMain ? [] : [{ k: 'main' as const, label: 'З головного', n: fromMain }]),
    { k: 'free', label: 'Не надіті', n: free },
  ];

  const hint = readOnly
    ? 'Речі, не надіті в цьому комплекті.'
    : COARSE_PTR
      ? 'Тап по речі — опис і дії: надіти, редагувати, копія, видалити.' + (isMain ? '' : ' «Г» — надіта в Головному, цифра — у сеті з таким номером.')
      : isMain
        ? 'Клік — надіти, ✎ — редагувати, ПКМ — меню. Сюди потрапляє все, що ти знімаєш.'
        : 'Клік — надіти в цей сет, ✎ — редагувати, ПКМ — меню. «Г» — надіта в Головному, цифра — у сеті з таким номером.';

  const empty =
    rows.length === 0
      ? isMain
        ? 'Інвентар порожній. Речі зʼявляться тут, коли ти знімеш їх із фігури.'
        : 'Інвентар порожній: усі речі персонажа вже в цьому сеті.'
      : 'За цим фільтром речей немає.';

  const dropProps = readOnly ? {} : dnd.invDrop(cfgId);

  return (
    <section className="card doll-inv" aria-label="Інвентар">
      <div className="doll-inv-head">
        <h3>Інвентар</h3>
        <div className="doll-seg doll-seg-sm" role="radiogroup" aria-label="Які речі показати">
          {filters.map((f) => (
            <button key={f.k} type="button" role="radio" aria-checked={eff === f.k} className={eff === f.k ? 'is-on' : ''} onClick={() => setFilter(f.k)}>
              {f.label} <span className="doll-seg-n">{f.n}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="doll-inv-hint">{hint}</p>
      <div className={'doll-inv-grid' + (dnd.overKey === INV_DROP_KEY ? ' drop-ok' : '')} {...dropProps}>
        {shown.map(({ h, worn }) => (
          <InventoryCell
            key={h.inst.i}
            h={h}
            worn={worn}
            sets={sets}
            bad={!h.item || !meetsReq(build, h.item, gearAttr).ok}
            dnd={dnd}
            build={build}
          />
        ))}
        {shown.length === 0 && <p className="doll-inv-empty">{empty}</p>}
      </div>
      <Counters />
    </section>
  );
}
