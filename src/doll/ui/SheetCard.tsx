// =========================================================
// ЛЯЛЬКА — «Анкета для турнірів» на сторінці персонажа. Поля, яких лялька
// не знає (грейди зброї, броні, каменів, кілець, трактат, джин, збірка),
// гравець заповнює раз — вони їдуть у кожну заявку цим персонажем. Клас,
// рівень, ПЗ-зброя й свап-сети — з ляльки (model/sheet.ts), їх тут видно
// лише для довідки. Картка згорнута, коли анкету заповнено.
// =========================================================

import { useMemo } from 'react';
import GearFields from '../../components/GearFields';
import { gearSummary } from '../../data/gearRules';
import { rulesFor } from '../../data/gearRules';
import { useRules } from '../../data/rulesStore';
import { useCatalog } from '../data/catalog';
import { useRefData } from '../data/refLoader';
import type { CharacterDoc } from '../model/doc';
import { docCats } from '../model/hydrate';
import { dollFacts, gearFromCharacter, sheetAsGear, sheetFromGear } from '../model/sheet';

export default function SheetCard({ doc, onChange, readOnly }: { doc: CharacterDoc; onChange(doc: CharacterDoc): void; readOnly?: boolean }) {
  useRules();
  const cats = useMemo(() => docCats(doc), [doc]);
  const cat = useCatalog(cats);
  const ref = useRefData();
  const ready = cat.ready && ref.ready;
  const facts = useMemo(() => {
    if (!ready) return null;
    try {
      return dollFacts(doc);
    } catch {
      return null;
    }
  }, [doc, ready]);
  const setsFromDoll = rulesFor(null).setsFromDoll;
  const result = facts ? gearFromCharacter(doc, facts, { setsFromDoll: true }) : null;
  const complete = !!result?.gear;

  return (
    <details className="card doll-sheet" open={!complete}>
      <summary>
        <b>Анкета для турнірів</b>
        <span className={'badge ' + (complete ? 'good' : 'mute')}>{complete ? 'заповнено' : 'треба заповнити'}</span>
      </summary>
      <p className="hint">
        Грейди речей лялька поки не розпізнає — заповни їх тут один раз, і вони підставлятимуться в кожну заявку цим персонажем. Клас, рівень, ПЗ-зброю й свап-сети
        лялька визначає сама{setsFromDoll ? '' : ' (сети поки не рахуються в балах — це вмикає адмін)'}.
      </p>
      {!ready && <p className="hint">Завантажую дані ляльки…</p>}
      {ready && (
        <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0 }}>
          <GearFields
            value={sheetAsGear(doc, facts)}
            onChange={(g) => onChange({ ...doc, sheet: sheetFromGear(g) })}
            attackLevel={null}
            defenseLevel={null}
            onExtraChange={() => undefined}
            fromDoll
          />
        </fieldset>
      )}
      {result && !complete && result.missing.length > 0 && <p className="hint">Ще бракує: {result.missing.join(', ')}.</p>}
      {result?.gear && <p className="hint">У заявці буде: {gearSummary(result.gear)}.</p>}
    </details>
  );
}
