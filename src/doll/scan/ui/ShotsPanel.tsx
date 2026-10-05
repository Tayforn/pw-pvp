// =========================================================
// ЛЯЛЬКА ЗІ СКРІНШОТІВ — панель у редакторі нового персонажа. Гравець кидає
// скріншоти вікна спорядження і вікна «Персонаж» (Ctrl+V, перетягування або
// файл, у будь-якому порядку); панель показує, що розпізнано і чим буде
// заповнено ляльку, і на «Заповнити» віддає готовий документ сторінці.
// Розпізнавання йде в браузері, скріншоти нікуди не надсилаються.
//
// Окремий ледачий чанк: сканер і шаблони цифр потрібні лише тим, хто відкрив панель.
// =========================================================

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { SLOTS } from '../../core/constants';
import { catItems } from '../../data/catalog';
import { ensureRefData } from '../../data/refLoader';
import { SLOT_CAT, type CharacterDoc } from '../../model/doc';
import { itemDisplayName } from '../../model/tipModel';
import { clsLabel } from '../../ui/CharBar';
import { blobToRaster, loadScanSource } from '../browser';
import type { EquipScan } from '../equip';
import { fillFromShots, type FillResult } from '../fill';
import type { Raster } from '../raster';
import { readShots } from '../session';
import type { StatsScan } from '../stats';
import './shots.css';

const SLOT_LABEL: Record<string, string> = Object.fromEntries(SLOTS.map((s) => [s.slot, s.label]));
const GEM_STAT: Record<string, string> = { lf: 'Тілобудови', sx: 'показника захисту', ad: 'показника атаки' };
/** Скільки чисел читає сканер у вікні «Персонаж». */
const STAT_FIELDS = 27;

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
/** Дати браузеру перемалювати сторінку перед довгим синхронним шматком роботи.
 * Таймер, а не requestAnimationFrame: у фоновій вкладці кадри не малюються, і розпізнавання зависло б. */
const paint = (): Promise<void> => new Promise((done) => setTimeout(done, 30));

interface Shot<T> {
  scan: T;
  /** Адреса знімка для попереднього перегляду (object URL). */
  url: string;
}

export interface ShotsPanelProps {
  /** Поточна лялька: імʼя лишається, а клас і рівень беруться звідси, якщо їх не вдалося визначити. */
  base: CharacterDoc;
  /** У ляльці вже щось є — перед заповненням перепитати. */
  hasWork: boolean;
  /** Гравець натиснув «Заповнити»: нова лялька і (якщо є) числа з гри для підказки. */
  onFill(result: FillResult, stats: StatsScan | null): void;
  /** Вікно «Персонаж» прочитано — підказку з числами можна показати вже зараз. */
  onStats(stats: StatsScan): void;
  onClose(): void;
}

export default function ShotsPanel({ base, hasWork, onFill, onStats, onClose }: ShotsPanelProps) {
  const [equip, setEquip] = useState<Shot<EquipScan> | null>(null);
  const [stats, setStats] = useState<Shot<StatsScan> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);
  // Обробник вставки живе довше за один рендер — читає найсвіжіший стан через ref.
  const live = useRef({ stats, busy, onStats });
  live.current = { stats, busy, onStats };

  useEffect(() => {
    const made = urls.current;
    return () => made.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const addShots = useCallback(async (blobs: Blob[]) => {
    const cur = live.current;
    if (!blobs.length || cur.busy) return;
    const fails: string[] = [];
    try {
      setBusy('Відкриваю скріншот…');
      await paint();
      const shots: Array<{ raster: Raster; url: string }> = [];
      for (const blob of blobs) {
        try {
          const raster = await blobToRaster(blob);
          const url = URL.createObjectURL(blob);
          urls.current.push(url);
          shots.push({ raster, url });
        } catch (e) {
          fails.push(errText(e));
        }
      }
      if (shots.length) {
        setBusy('Завантажую іконки речей…');
        const [src] = await Promise.all([loadScanSource(), ensureRefData()]);
        setBusy('Розпізнаю…');
        await paint();
        // Клас і стать тут не підказуємо: їх визначає саме заповнення — за всіма речами з такою іконкою.
        const reads = readShots(
          shots.map((s) => s.raster),
          src,
          { scale: cur.stats?.scan.scale },
        );
        reads.forEach((read, i) => {
          if (read.stats) {
            setStats({ scan: read.stats, url: shots[i].url });
            cur.onStats(read.stats);
          }
          if (read.equip) setEquip({ scan: read.equip, url: shots[i].url });
          if (!read.stats && !read.equip) fails.push('На знімку не знайшов ні вікна спорядження, ні вікна «Персонаж». ' + read.reasons.join(' '));
        });
      }
    } catch (e) {
      fails.push('Не вдалося розпізнати: ' + errText(e));
    } finally {
      setProblems(fails);
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      void addShots(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addShots]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void addShots(Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/')));
  };

  // Чим буде заповнено ляльку — рахуємо одразу, щоб гравець бачив це до натискання.
  const plan = useMemo(
    () => (equip ? fillFromShots({ equip: equip.scan, stats: stats?.scan ?? null, base, items: catItems }) : null),
    [equip, stats, base],
  );
  const name = (cat: string, id: number): string => {
    const it = (catItems(cat) ?? []).find((x) => Number(x.id) === id);
    return it ? itemDisplayName(it, cat) : '#' + id;
  };

  const fill = () => {
    if (!plan) return;
    if (hasWork && !window.confirm('Замінити поточну чернетку лялькою зі скріншотів? Поточні речі й сети буде втрачено.')) return;
    onFill(plan, stats?.scan ?? null);
  };

  return (
    <section className="card shot" aria-label="Заповнити зі скріншотів">
      <div className="shot-head">
        <h3>Заповнити зі скріншотів</h3>
        <span className="hint">Розпізнаються в браузері й нікуди не надсилаються.</span>
        <button type="button" className="shot-x" aria-label="Закрити" onClick={onClose}>
          ✕
        </button>
      </div>
      <div
        className={'shot-drop' + (over ? ' is-over' : '')}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        {busy ? (
          <span className="shot-busy" role="status">
            {busy}
          </span>
        ) : (
          <>
            <span>
              Встав скріншоти вікна спорядження і вікна «Персонаж» — <kbd>Ctrl</kbd> + <kbd>V</kbd>, перетягни сюди або вибери файли. Можна обидва
              одразу, у будь-якому порядку.
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
              Вибрати файли
            </button>
          </>
        )}
        <input
          ref={fileRef}
          className="shot-file"
          type="file"
          accept="image/*"
          multiple
          tabIndex={-1}
          aria-label="Файли скріншотів"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            void addShots(files);
          }}
        />
      </div>
      {problems.map((p, i) => (
        <p key={i} className="form-err" role="alert">
          {p}
        </p>
      ))}
      <div className="shot-tiles">
        <div className={'shot-tile' + (equip ? '' : ' is-empty')}>
          <b>Вікно спорядження</b>
          {equip ? (
            <>
              <span>
                впізнано речей: {Object.values(equip.scan.slots).filter((s) => s.state === 'item').length} · масштаб інтерфейсу{' '}
                {equip.scan.scale.toFixed(2)}
              </span>
              <img src={equip.url} alt="Скріншот спорядження" />
            </>
          ) : (
            <span>ще немає — з нього беруться речі, клас і стать</span>
          )}
        </div>
        <div className={'shot-tile' + (stats ? '' : ' is-empty')}>
          <b>Вікно «Персонаж»</b>
          {stats ? (
            <>
              <span>
                прочитано чисел: {Object.keys(stats.scan.values).length} з {STAT_FIELDS}
              </span>
              <img src={stats.url} alt="Скріншот вікна «Персонаж»" />
            </>
          ) : (
            <span>ще немає — з нього беруться рівень, атрибути й числа для каменів і підказки</span>
          )}
        </div>
      </div>

      {plan ? (
        <dl className="shot-plan">
          <div>
            <dt>Персонаж</dt>
            <dd>
              {clsLabel(plan.doc.cls)}
              {plan.clsSure ? '' : ' (клас за речами визначити не вдалося — лишився поточний)'} · {plan.doc.gender === 'f' ? 'жіноча стать' : 'чоловіча стать'}{' '}
              · рівень {plan.doc.level}
              {plan.levelRead ? '' : ' (не прочитано — лишився поточний)'}
            </dd>
          </div>
          <div>
            <dt>Речі — {plan.picks.length}</dt>
            <dd>
              <ul className="shot-items">
                {plan.picks.map((p) => (
                  <li key={p.slot}>
                    <i>{SLOT_LABEL[p.slot] ?? p.slot}:</i> {name(SLOT_CAT[p.slot], p.id)}
                    {p.others.length > 0 && <i> — одна з {p.others.length + 1} з такою іконкою</i>}
                  </li>
                ))}
              </ul>
              {plan.unknown.length > 0 && (
                <span className="is-guess">Не впізнано: {plan.unknown.map((s) => SLOT_LABEL[s] ?? s).join(', ')} — додай у редакторі.</span>
              )}
            </dd>
          </div>
          {plan.attrs ? (
            <>
              <div>
                <dt>Камені — припущення</dt>
                <dd className="is-guess">
                  {plan.gems.length
                    ? plan.gems.map((g) => `${g.count} × ${name('ob', g.id)} (+${g.total} ${GEM_STAT[g.stat]})`).join(', ') + '. '
                    : 'Не ставлю: числа з гри їх не потребують. '}
                  Каменів на скріншоті не видно — їх підібрано під числа вікна «Персонаж».
                </dd>
              </div>
              <div>
                <dt>Базові атрибути — оцінка</dt>
                <dd className="is-guess">
                  Сила {plan.doc.attrs.str} · Спритність {plan.doc.attrs.dex} · Тілобудова {plan.doc.attrs.vit} · Інтелект {plan.doc.attrs.mag}. У грі видно
                  лише суми з бонусами речей
                  {plan.attrs.cut > 0 ? `; понад рівень виходило очок: ${plan.attrs.cut} — їх дають роли й гравіювання, яких не видно, тож їх зрізано` : ''}.
                </dd>
              </div>
            </>
          ) : (
            <div>
              <dt>Рівень, атрибути й камені</dt>
              <dd className="is-guess">Додай скріншот вікна «Персонаж» — без нього заповню лише речі, клас і стать.</dd>
            </div>
          )}
          <div>
            <dt>Не заповнюється</dt>
            <dd className="is-guess">Заточки, роли, гравіювання й титули — на цих скріншотах їх не видно. Після заповнення їх підкаже таблиця «Числа з гри».</dd>
          </div>
        </dl>
      ) : (
        stats && <p className="hint">Вікно «Персонаж» прочитано — підказка з числами вже над лялькою. Щоб заповнити ляльку, додай скріншот вікна спорядження.</p>
      )}

      <div className="shot-acts">
        <button type="button" className="btn btn-primary btn-sm" disabled={!plan || !!busy} onClick={fill}>
          Заповнити ляльку
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Закрити
        </button>
      </div>
      <ul className="shot-tips">
        <li>Знімай без бафів і їжі: лялька рахує чисті характеристики.</li>
        <li>Вікна мають бути видні цілком, не перекриті іншими. Найкраще — вирізати саме вікно (Win + Shift + S).</li>
        <li>Скріншот не стискай і не збільшуй: цифри читаються лише в рідному розмірі.</li>
      </ul>
    </section>
  );
}
