// =========================================================
// ЛЯЛЬКА — редактор персонажа цілком. Отримує документ ззовні (value/onChange):
// де він живе — локальна чернетка, профіль у базі чи знімок заявки (readOnly)
// — вирішує сторінка, а не редактор. Тут: довантаження каталогу й довідників,
// гідрація, контекст і розкладка.
//
// Розкладка: шапка персонажа; нижче два стовпці на широкому екрані (ліворуч
// комплекти + фігура + інвентар, праворуч характеристики, дельти сету, бафи
// й перевірка урону), на телефоні — один стовпець.
//
// Екран «завантажую каталог» — лише перший раз. Коли пізніше довантажується
// нова категорія (імпорт, нова річ), редактор не зникає: невідомі поки речі
// на мить показуються «?», а модалки й фокус лишаються на місці.
// =========================================================

import { useEffect, useMemo, useState } from 'react';
import { isStaleDataError, useCatalog } from '../data/catalog';
import { useRefData } from '../data/refLoader';
import type { CharacterDoc } from '../model/doc';
import { CFG_MAIN, docCats, findSet, hydrate } from '../model/hydrate';
import AddSetDialog from './AddSetDialog';
import ConfigTabs from './ConfigTabs';
import DollHeader from './DollHeader';
import { EditorProvider, useEditor, type EditorModal } from './EditorContext';
import { useDnD } from './hooks/useDnD';
import Inventory from './Inventory';
import { BuffCfgModal } from './modals/BuffCfgModal';
import { BuffPickModal } from './modals/BuffPickModal';
import { EditorModal as ItemEditorModal } from './modals/EditorModal';
import { OpponentModal } from './modals/OpponentModal';
import { PickerModal } from './modals/PickerModal';
import { DamageCheck } from './panels/DamageCheck';
import { ModsCard } from './panels/ModsCard';
import { SetDeltaPanel } from './panels/SetDeltaPanel';
import { StatsPanel } from './panels/StatsPanel';
import Paperdoll from './Paperdoll';
import { TipHost } from './tip/TipHost';
import './doll.css';

export interface DollEditorProps {
  value: CharacterDoc;
  onChange(doc: CharacterDoc): void;
  readOnly?: boolean;
  /** 'main' або id сету. Невідомий id (сет видалили) — редактор показує Головний і повідомляє про це. */
  activeCfg: string;
  onActiveCfg(id: string): void;
}

/** Модалка посилається на річ/сет, яких уже немає (видалили з меню, скинули чернетку) — її треба закрити. */
function isStale(m: EditorModal, doc: CharacterDoc, has: (iid: string) => boolean): boolean {
  if (!m) return false;
  const cfgGone = (cfgId: string) => cfgId !== CFG_MAIN && !findSet(doc, cfgId);
  if (m.kind === 'item') return cfgGone(m.cfgId) || !has(m.iid);
  if (m.kind === 'picker') return cfgGone(m.target.cfgId) || ('kind' in m.target && !has(m.target.iid));
  return false;
}

function ModalHost() {
  const api = useEditor();
  const m = api.modal;
  if (!m) return null;
  switch (m.kind) {
    case 'picker':
      return <PickerModal key={'picker:' + JSON.stringify(m.target)} target={m.target} />;
    case 'item':
      return <ItemEditorModal key={'item:' + m.cfgId + ':' + m.iid} cfgId={m.cfgId} iid={m.iid} />;
    case 'buffCfg':
      return <BuffCfgModal key={'buff:' + m.id} id={m.id} />;
    case 'buffPick':
      return <BuffPickModal />;
    case 'opponent':
      return <OpponentModal />;
    case 'addSet':
      return <AddSetDialog />;
  }
}

/** Помилка даних: «сайт оновився» лікується лише перезавантаженням, решта — повтором. */
function DataError({ error, retry, prefix }: { error: string; retry(): void; prefix: string }) {
  if (isStaleDataError(error)) {
    return (
      <>
        <span>Сайт оновився — дані ляльки треба завантажити заново. Чернетка збережена в цьому браузері.</span>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => location.reload()}>
          Перезавантажити
        </button>
      </>
    );
  }
  return (
    <>
      <span>
        {prefix}: {error}
      </span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={retry}>
        Повторити
      </button>
    </>
  );
}

function Toast() {
  const { notice, notify } = useEditor();
  if (!notice) return null;
  return (
    <div className="doll-toast" role="status">
      <span>{notice}</span>
      <button type="button" className="doll-toast-x" aria-label="Закрити повідомлення" onClick={() => notify(null)}>
        ✕
      </button>
    </div>
  );
}

function EditorBody({ loading, error, retry }: { loading: boolean; error: string | null; retry(): void }) {
  const api = useEditor();
  const dnd = useDnD(api);
  const { activeCfg, modal, model, closeModal } = api;
  const isMain = activeCfg === CFG_MAIN;

  useEffect(() => {
    if (isStale(modal, model.doc, (iid) => model.items.has(iid))) closeModal();
  }, [modal, model, closeModal]);

  return (
    <div className={'doll' + (api.readOnly ? ' is-readonly' : '')}>
      {error && (
        <div className="doll-alert" role="alert">
          <DataError error={error} retry={retry} prefix="Частину даних ляльки не вдалося завантажити" />
        </div>
      )}
      {loading && !error && (
        <p className="doll-status" role="status">
          Довантажую каталог речей…
        </p>
      )}

      <DollHeader />

      <div className="doll-layout">
        <div className="doll-col doll-col-eq">
          <section className="card doll-eq" aria-label="Спорядження">
            <ConfigTabs />
            <Paperdoll dnd={dnd} />
          </section>
          <Inventory dnd={dnd} />
        </div>
        <div className="doll-col doll-col-stats">
          <StatsPanel cfgId={activeCfg} />
          {!isMain && <SetDeltaPanel setId={activeCfg} />}
          <ModsCard />
          <DamageCheck />
        </div>
      </div>

      <TipHost />
      <ModalHost />
      <Toast />
    </div>
  );
}

export default function DollEditor({ value, onChange, readOnly = false, activeCfg, onActiveCfg }: DollEditorProps) {
  const refData = useRefData();
  const cats = useMemo(() => docCats(value), [value]);
  const catalog = useCatalog(cats);
  const ready = refData.ready && catalog.ready;
  const error = refData.error || catalog.error;
  const [everReady, setEverReady] = useState(false);
  useEffect(() => {
    if (ready) setEverReady(true);
  }, [ready]);

  // Гідрація синхронна через getItem каталогу: коли категорія довантажилась
  // (ready перемкнувся), ті самі посилання дають уже справжні речі — тому ready в залежностях.
  const model = useMemo(() => hydrate(value), [value, ready]);

  const cfg = activeCfg === CFG_MAIN || findSet(value, activeCfg) ? activeCfg : CFG_MAIN;
  useEffect(() => {
    if (cfg !== activeCfg) onActiveCfg(cfg);
  }, [cfg, activeCfg, onActiveCfg]);

  const retry = () => {
    refData.retry();
    catalog.retry();
  };

  if (!ready && !everReady) {
    return (
      <div className="doll">
        <div className="card doll-loading" role={error ? 'alert' : 'status'}>
          {error ? (
            <p className="doll-loading-err">
              <DataError error={error} retry={retry} prefix="Не вдалося завантажити каталог речей" />
            </p>
          ) : (
            <p>Завантажую каталог речей…</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <EditorProvider doc={value} model={model} onChange={onChange} readOnly={readOnly} activeCfg={cfg} onActiveCfg={onActiveCfg}>
      <EditorBody loading={!ready} error={error} retry={retry} />
    </EditorProvider>
  );
}
