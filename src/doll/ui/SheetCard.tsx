// =========================================================
// ЛЯЛЬКА — «Анкета для турнірів» на сторінці персонажа. Поля, яких лялька
// не знає (грейди зброї, сету броні, кілець, трактат, джин, ШГ/Вознєс),
// гравець заповнює раз — вони їдуть у кожну заявку цим персонажем. Усе інше
// (збірка, точки, камені, ПЗ-зброя, свап-сети) рахує лялька (model/sheet.ts),
// тут це видно одним рядком. Картка згорнута, коли анкету заповнено.
// =========================================================

import { useMemo } from 'react';
import GearFields from '../../components/GearFields';
import { ARMOR_REFINE_LABELS, BUILD_LABELS, GEMS_LABELS, WEAPON_REFINE_LABELS, gearSummary, rulesFor } from '../../data/gearRules';
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
      return dollFacts(doc, rulesFor(null));
    } catch {
      return null;
    }
  }, [doc, ready]);
  const rules = rulesFor(null);
  const setsFromDoll = rules.setsFromDoll;
  const result = facts ? gearFromCharacter(doc, facts, { setsFromDoll: true }) : null;
  const complete = !!result?.gear;

  return (
    <details className="card doll-sheet" open={!complete}>
      <summary>
        <b>Анкета для турнірів</b>
        <span className={'badge ' + (complete ? 'good' : 'mute')}>{complete ? 'заповнено' : 'треба заповнити'}</span>
      </summary>
      <p className="hint">
        Грейди речей (зброя, сет броні, кільця, трактат) лялька поки не розпізнає — вибери їх тут один раз, і вони підставлятимуться в кожну заявку цим персонажем.
        Решту лялька визначає сама{setsFromDoll ? '' : ' (свап-сети поки не рахуються в балах — це вмикає адмін)'}.
      </p>
      {facts && (
        <p className="hint">
          З ляльки: збірка {BUILD_LABELS[facts.build]} · точка зброї {facts.weaponRefine ? WEAPON_REFINE_LABELS[facts.weaponRefine] : '— (немає зброї)'} · точка броні{' '}
          {facts.armorRefine ? `${ARMOR_REFINE_LABELS[facts.armorRefine]} (середня ${facts.armorRefineAvg?.toFixed(1)}${rules.doll.scope === 'all' ? ' по всіх сетах' : ' по Головному'})` : '— (немає броні)'} · камені{' '}
          {GEMS_LABELS[facts.gems]} ({Math.round(facts.gemPoints)} б.)
        </p>
      )}
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
