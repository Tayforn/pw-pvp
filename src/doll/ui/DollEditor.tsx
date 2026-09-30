// =========================================================
// ЛЯЛЬКА — редактор персонажа цілком. Отримує документ ззовні (value/onChange):
// де він живе — локальна чернетка, профіль у базі чи знімок заявки (readOnly)
// — вирішує сторінка, а не редактор. Тут: довантаження каталогу й довідників,
// гідрація, контекст і розкладка.
//
// Розкладка B3: смужка персонажа (CharBar: імʼя … шлях + кнопки сторінки
// слотами barStart / barEnd), під нею три колонки — ліворуч «Спорядження» й
// «Інвентар», посередині «Характеристики» зі смужкою станів (на вкладці сету
// — ще «Проти Головного») і «Перевірка урону», праворуч «Готовність», «Атрибути»,
// «Пасивки класу», «Джин» і плашка стану. Колонки сходинками за шириною
// САМОГО редактора (@container, doll.css): три → дві → одна.
//
// Екран «завантажую каталог» — лише перший раз. Коли пізніше довантажується
// нова категорія (імпорт, нова річ), редактор не зникає: невідомі поки речі
// на мить показуються «?», а модалки й фокус лишаються на місці. Смужка й верх
// сторінки (PageTop) стоять в одному місці дерева і поки вантажиться каталог,
// і після — тому панель імпорту зі вставленим текстом не розмонтовується,
// коли каталог довантажився.
// =========================================================

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { isStaleDataError, useCatalog } from '../data/catalog';
import { useRefData } from '../data/refLoader';
import type { CharacterDoc } from '../model/doc';
import { CFG_MAIN, docCats, findSet, hydrate } from '../model/hydrate';
import AddSetDialog from './AddSetDialog';
import CharBar from './CharBar';
import ConfigTabs from './ConfigTabs';
import { DollCard } from './DollCard';
import { EditorProvider, useApply, useEditor, type EditorModal } from './EditorContext';
import { useDnD } from './hooks/useDnD';
import Inventory from './Inventory';
import { BuffCfgModal } from './modals/BuffCfgModal';
import { BuffPickModal } from './modals/BuffPickModal';
import { DeleteSetModal } from './modals/DeleteSetModal';
import { EditorModal as ItemEditorModal } from './modals/EditorModal';
import { OpponentModal } from './modals/OpponentModal';
import { PickerModal } from './modals/PickerModal';
import { AttrsCard } from './panels/AttrsCard';
import { DamageCheck } from './panels/DamageCheck';
import { PassivesCard } from './panels/PassivesCard';
import { ReadinessCard } from './panels/ReadinessCard';
import { SetDeltaPanel } from './panels/SetDeltaPanel';
import { StatsPanel } from './panels/StatsPanel';
import { StatusPlate } from './panels/StatusPlate';
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
  /** Смужка персонажа ліворуч від полів — «← Мої персонажі». */
  barStart?: ReactNode;
  /** Смужка персонажа праворуч — стан збереження й кнопки сторінки (з переносом). */
  barEnd?: ReactNode;
  /** Дрібний рядок під смужкою: підказка сторінки, що заважає збереженню. */
  barNote?: ReactNode;
  /** Між смужкою і колонками: повідомлення сторінки, конфлікт вкладок, панель імпорту, анкета. */
  top?: ReactNode;
}

type BarProps = Pick<DollEditorProps, 'barStart' | 'barEnd' | 'barNote' | 'top'>;

/** Модалка посилається на річ/сет, яких уже немає (видалили з меню, скинули чернетку) — її треба закрити. */
function isStale(m: EditorModal, doc: CharacterDoc, has: (iid: string) => boolean): boolean {
  if (!m) return false;
  const cfgGone = (cfgId: string) => cfgId !== CFG_MAIN && !findSet(doc, cfgId);
  if (m.kind === 'item') return cfgGone(m.cfgId) || !has(m.iid);
  if (m.kind === 'picker') return cfgGone(m.target.cfgId) || ('kind' in m.target && !has(m.target.iid));
  if (m.kind === 'deleteSet') return cfgGone(m.setId);
  return false;
}

/** Усі вікна редактора — тут, поза колонками: колонки — контейнери (@container), і
 * position: fixed усередині них не має ризикувати затемненням розміром з колонку. */
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
      return <BuffPickModal key={'bpick:' + (m.tab ?? '')} initialTab={m.tab} />;
    case 'opponent':
      return <OpponentModal />;
    case 'addSet':
      return <AddSetDialog />;
    case 'deleteSet':
      return <DeleteSetModal key={'delset:' + m.setId} setId={m.setId} />;
  }
}

/** Смужка персонажа, підказка під нею і верх сторінки — одна й та сама позиція в дереві
 * і в редакторі, і поки вантажиться каталог (тоді без apply — поля вимкнені). */
function PageTop({ doc, readOnly, apply, barStart, barEnd, barNote, top }: BarProps & { doc: CharacterDoc; readOnly: boolean; apply?(fn: (d: CharacterDoc) => CharacterDoc): void }) {
  return (
    <>
      <CharBar doc={doc} readOnly={readOnly} apply={apply} start={barStart} end={barEnd} />
      {barNote && <div className="doll-bar-note">{barNote}</div>}
      {top}
    </>
  );
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

/** Колонки, вікна, тултіп і тост — усе, що потребує контексту редактора; смужка над ними — у DollEditor. */
function EditorBody({ loading, error, retry }: { loading: boolean; error: string | null; retry(): void }) {
  const api = useEditor();
  const dnd = useDnD(api);
  const { activeCfg, modal, model, closeModal } = api;
  const isMain = activeCfg === CFG_MAIN;

  useEffect(() => {
    if (isStale(modal, model.doc, (iid) => model.items.has(iid))) closeModal();
  }, [modal, model, closeModal]);

  return (
    <>
      {error && (
        <div className="doll-alert" role="alert">
          <DataError error={error} retry={retry} prefix="Частину даних ляльки не вдалося завантажити" />
        </div>
      )}
      {loading && !error && (
        <p className="doll-loadnote" role="status">
          Довантажую каталог речей…
        </p>
      )}

      {/* Контейнер для сходинок колонок: три → дві → одна за шириною редактора, а не вікна. */}
      <div className="doll-cq">
        <div className="doll-layout">
          <div className="doll-col doll-col-eq">
            <DollCard title="Спорядження" className="doll-eq">
              <ConfigTabs />
              <Paperdoll dnd={dnd} />
            </DollCard>
            <Inventory dnd={dnd} />
          </div>
          <div className="doll-col doll-col-stats">
            <StatsPanel cfgId={activeCfg} />
            {!isMain && <SetDeltaPanel setId={activeCfg} />}
            <DamageCheck />
          </div>
          <div className="doll-col doll-col-side">
            {/* Порядок B3: «Готовність до турніру» (.doll-ready), «Атрибути» (.doll-attrs-card),
                «Пасивки класу» (.doll-passives), «Джин» (.doll-genie), плашка стану (.doll-status).
                Місце на телефоні задає клас картки (order у doll.css). Картку «Джин» додає
                наступний крок — сюди, між пасивками й плашкою. */}
            <ReadinessCard />
            <AttrsCard />
            <PassivesCard />
            <StatusPlate />
          </div>
        </div>
      </div>

      <TipHost />
      <ModalHost />
      <Toast />
    </>
  );
}

export default function DollEditor({ value, onChange, readOnly = false, activeCfg, onActiveCfg, barStart, barEnd, barNote, top }: DollEditorProps) {
  const bar: BarProps = { barStart, barEnd, barNote, top };
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

  // Смужка живе поза провайдером (його ще немає, поки вантажиться каталог) — apply їй свій,
  // той самий хук, що й у провайдера.
  const apply = useApply(value, onChange, readOnly);
  const editing = ready || everReady;

  return (
    <div className={'doll' + (readOnly ? ' is-readonly' : '')}>
      {/* Смужка — і поки вантажиться каталог: поля вимкнені, а кнопки сторінки (збереження) на місці. */}
      <PageTop doc={value} readOnly={readOnly || !editing} apply={editing ? apply : undefined} {...bar} />
      {editing ? (
        <EditorProvider doc={value} model={model} onChange={onChange} readOnly={readOnly} activeCfg={cfg} onActiveCfg={onActiveCfg}>
          <EditorBody loading={!ready} error={error} retry={retry} />
        </EditorProvider>
      ) : (
        <div className="card doll-loading" role={error ? 'alert' : 'status'}>
          {error ? (
            <p className="doll-loading-err">
              <DataError error={error} retry={retry} prefix="Не вдалося завантажити каталог речей" />
            </p>
          ) : (
            <p>Завантажую каталог речей…</p>
          )}
        </div>
      )}
    </div>
  );
}
