// «Шкала балів» після скору v2: картки «Абілки зброї» і «Стелі свап-спорядження»,
// «Перевірка чернетки» з архетипами v2 (без NaN) і табличними старих заявок;
// карток скору з ляльки (еталони), прапорця ПЗ-зброї, кошиків каменів і порогів
// сетів немає. Стор чернетки — справжній (rulesDraftStore), версії з БД — заглушка.
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_RULES_VERSION, maxGearScoreOf, normalizeRules, rulesFor } from '../../../data/gearRules';
import { _resetRulesDraftForTests, patchDraft } from '../../../data/rulesDraftStore';
import { V2_ARCHETYPES, TABLE_ARCHETYPES, v2ArchetypeScore } from '../scaleArchetypes';

vi.mock('../../../app/supabaseClient', () => ({ supabase: {} }));
vi.mock('../../../data/rulesStore', () => ({
  useRules: () => ({ loaded: true, current: BUILTIN_RULES_VERSION }),
  saveRulesVersion: async () => BUILTIN_RULES_VERSION,
}));

const { default: ScaleTab } = await import('../ScaleTab');
const visible = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const count = (html: string, re: RegExp): number => (html.match(re) || []).length;

afterEach(() => _resetRulesDraftForTests());

describe('архетипи за скором v2', () => {
  it('топ (сін) зі стелею свап-сетів 25 — 403: клас 10 + зброя 104 + броня 74 + ШГ 27 + Вознєс 22 + бонус 5 + 12 каменів 24 + кільця 48 + трактат 20 + сети 25 + свап-зброя 24 + рівень 10 + джин 10', () => {
    const r = normalizeRules({ swapTotalCap: 25 });
    expect(v2ArchetypeScore(V2_ARCHETYPES[0], r, 3)).toBe(403);
    // без стелі ПЗ-сет Нірвана +8 з Лагерями вартий 4 × (5/4 + 17/6 + 8) = 48.33
    expect(v2ArchetypeScore(V2_ARCHETYPES[0], rulesFor(), 3)).toBe(Math.round(403 - 25 + 4 * (5 / 4 + 17 / 6 + 8)));
  });

  it('усі архетипи — скінченні цілі, за спаданням від топа до слабкого, і не вище максимуму зі стелею сетів', () => {
    const r = normalizeRules({ swapTotalCap: 25 });
    const scores = V2_ARCHETYPES.map((a) => v2ArchetypeScore(a, r, 3));
    for (const s of scores) expect(Number.isInteger(s)).toBe(true);
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThan(scores[i - 1]);
    expect(scores[0]).toBeLessThanOrEqual(maxGearScoreOf(r));
    // без стелі (вбудована версія) — теж без NaN
    for (const a of V2_ARCHETYPES) expect(Number.isFinite(v2ArchetypeScore(a, rulesFor(), 6))).toBe(true);
    // слабкий (танк) без каменів, кілець і сетів: клас 6 + Нірвана 5 + w8_9 8 + броня 5 + 6 × 11/6 + трактат 2 = 37
    expect(scores[4]).toBe(37);
  });

  it('абілка головної зброї — абсолютні бали з abilityPoints; відʼємна не віднімається', () => {
    const top = V2_ARCHETYPES[0];
    const base = v2ArchetypeScore(top, normalizeRules({ swapTotalCap: 25, abilityPoints: {} }), 3);
    expect(v2ArchetypeScore(top, normalizeRules({ swapTotalCap: 25, abilityPoints: { ka: 20 } }), 3)).toBe(base + 20);
    expect(v2ArchetypeScore(top, normalizeRules({ swapTotalCap: 25, abilityPoints: { ka: -5 } }), 3)).toBe(base);
  });

  it('табличні архетипи лишились для старих заявок', () => {
    expect(TABLE_ARCHETYPES).toHaveLength(5);
  });
});

describe('вкладка «Шкала балів»', () => {
  it('картки v2 є, карток скору з ляльки й порогів сетів немає, бейдж «максимум» — за v2', () => {
    const html = renderToStaticMarkup(<ScaleTab />);
    const t = visible(html);
    expect(t).toContain('Перевірка чернетки');
    expect(t).toContain(`максимум ${maxGearScoreOf(rulesFor())}`);
    expect(t).toContain('Орієнтовні архетипи за v2');
    expect(t).toContain('Табличний скор (старі заявки');
    expect(t).toContain('Абілки зброї');
    expect(t).toContain('Уничтоженный пруд духов');
    expect(t).toContain('Стелі свап-спорядження');
    expect(t).toContain('Стеля ПЗ свап-зброї');
    expect(t).toContain('Сет броні (за річ — чверть)');
    expect(t).toContain('Точка броні (за річ — шоста)');
    expect(t).toContain('Джин (за удачею)');
    expect(t).toContain('поріг «топового ДД»');
    for (const gone of ['Скор з ляльки', 'Еталони класів', 'Є ПЗ-зброя', 'Камні (основний сет)', 'Камні у свап-сетах', 'Спеціальні сети', 'Приховати в анкеті', 'Рахувати по', 'Рахувати свап-сети з ляльки']) {
      expect(t).not.toContain(gone);
    }
    for (const bad of ['NaN', 'undefined', 'Infinity', '[object']) expect(t).not.toContain(bad);
    // усі архетипи — рядком із числом і тиром (S/A — warn, решта — mute)
    for (const a of V2_ARCHETYPES) expect(t).toContain(a.name);
    expect(html).toMatch(/class="badge warn"[^>]*>S</);
    expect(html).toMatch(/class="badge mute"[^>]*>D</);
  });

  it('поля — сіткою AdmFields: однакові клітинки, підпис повністю (без трикрапки), жодного field-row', () => {
    const html = renderToStaticMarkup(<ScaleTab />);
    // старий ряд із підписами в один рядок (обрізання трикрапкою, поля на різній висоті) зник
    expect(html).not.toContain('field-row');
    expect(html).not.toMatch(/text-overflow:\s*ellipsis/);
    // «Лялька: камені й збірка» — широка сітка: 8 каменів + гібрид/кон, кожне поле — клітинка adm-f з повним підписом
    const doll = html.slice(html.indexOf('Лялька: камені й збірка'), html.indexOf('Стелі свап-спорядження'));
    expect(count(doll, /class="adm-fields wide"/g)).toBe(2);
    expect(count(doll, /<label class="field adm-f"><span>/g)).toBe(10);
    expect(doll).toContain('<span>Камені 12 рівня (Сюаньки, Нюйви, Пань Гу…)</span>');
    expect(doll).toContain('<span>Гібрид — від, % очок у Тілобудові</span>');
    // у кожній сітці — лише клітинки полів (і клітинка кнопки), без власних ширин і flex-основ
    for (const grid of html.split('class="adm-fields').slice(1)) {
      const kids = grid.match(/^[^>]*>(<label class="field adm-f">|<div class="adm-f-act">)/);
      expect(kids, grid.slice(0, 120)).not.toBeNull();
    }
    expect(html).not.toMatch(/class="field adm-f" style=/);
    // «Стелі свап-спорядження»: поле, кнопка «Рекомендована» в клітинці сітки, поле ПЗ свап-зброї
    expect(html).toMatch(/<span>Стеля свап-сетів<\/span>(?:(?!adm-fields).)*class="adm-f-act"><button[^>]*>Рекомендована: (?:(?!adm-fields).)*<span>Стеля ПЗ свап-зброї<\/span>/);
  });

  it('абілки й стелі — з чернетки: правка стору видно в полях', () => {
    patchDraft({ abilityPoints: { ka: 33, zl: 8, kl: 8 }, weaponPzCap: 42, swapTotalCap: 25 });
    const html = renderToStaticMarkup(<ScaleTab />);
    expect(html).toContain('id="abil-ka"');
    expect(html).toMatch(/id="abil-ka"[^>]*value="33"/);
    expect(html).toMatch(/value="42"/);
    expect(visible(html)).toContain('max 67'); // стелі: 25 + 42
  });
});
