// =========================================================
// ЛЯЛЬКА — знімок із заявки в адмінці (/admin/doll/:id, pages/AdminDollPage):
// документ зі знімка (snapshotDoc — немає / пошкоджено / відкрито, з мʼякими
// зауваженнями validateDoc теж відкрито) і перший рендер сторінки до відповіді
// сервера (ефекти в renderToStaticMarkup не виконуються, мережі немає).
// =========================================================

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Сторінка тягне шар даних (Supabase) і редактор зі шкалою балів — у тестах без мережі.
vi.mock('../../app/supabaseClient', () => ({ supabase: { from: () => ({ select: () => ({ order: async () => ({ data: [], error: null }) }) }) } }));
import AdminDollPage, { snapshotDoc } from '../../pages/AdminDollPage';
import { emptyDoc } from '../model/doc';

const DOC = { ...emptyDoc('ga'), name: 'Тайфорн' };

describe('snapshotDoc — документ зі знімка заявки', () => {
  it('знімка немає — none (звичайна анкета, подана не персонажем)', () => {
    expect(snapshotDoc(null)).toEqual({ kind: 'none' });
    expect(snapshotDoc(undefined)).toEqual({ kind: 'none' });
  });

  it('цілий документ відкривається без зауважень', () => {
    expect(snapshotDoc(DOC)).toEqual({ kind: 'ok', doc: DOC, warning: null });
  });

  it('мʼякі порушення (зайве поле з новішої версії сайту) — відкрито із зауваженням', () => {
    const got = snapshotDoc({ ...DOC, extra: 1 });
    expect(got.kind).toBe('ok');
    if (got.kind !== 'ok') return;
    expect(got.warning).toContain('зайве поле «extra»');
    expect(got.doc.name).toBe('Тайфорн');
  });

  it('зламаний знімок — broken із причиною, редактор не відкривається', () => {
    expect(snapshotDoc('{"v":2,"cls":"zz"')).toEqual({ kind: 'broken', reason: 'зламаний JSON' });
    const got = snapshotDoc({ ...DOC, cls: 'zz', level: 'x' });
    expect(got.kind).toBe('broken');
    if (got.kind !== 'broken') return;
    expect(got.reason).toContain('невідомий клас «zz»');
    // не більше двох причин у поясненні
    expect(got.reason.split('; ')).toHaveLength(2);
  });
});

describe('AdminDollPage — перший рендер', () => {
  it('до відповіді сервера лише «завантажую», без редактора й без NaN/undefined', () => {
    const html = renderToStaticMarkup(<AdminDollPage id="0b1c-reg" onNavigate={() => {}} />);
    expect(html).toContain('class="doll-page"');
    expect(html).toContain('Завантажую заявку');
    expect(html).not.toContain('doll-fig-svg');
    expect(html).not.toMatch(/NaN|undefined|\[object/);
  });
});
