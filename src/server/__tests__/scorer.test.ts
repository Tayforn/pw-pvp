// =========================================================
// СЕРВЕР — scoreRegistration (src/server/scorer.ts): бекенд рахує заявку тією
// самою логікою, що браузер гравця (characterForRegistration) і адмінка
// (scoreItems зі знімка). Фікстура — справжній знімок ляльки з заявки
// (regs_snap, 25.09.2026) і справжня версія шкали balance-v1.22 з бази.
// Клієнтський шлях — як у registration.test: бекенд персонажів і Supabase —
// заглушки, каталоги й довідники — з диска через fetch.
// =========================================================

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// rulesStore (версії шкали) і tournaments.ts (insert заявки) тягнуть клієнт Supabase.
const db = vi.hoisted(() => ({ inserts: [] as Array<Record<string, unknown>> }));
vi.mock('../../app/supabaseClient', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        order: async () => ({ data: [], error: null }),
        eq: () => ({
          maybeSingle: async () => ({
            data:
              table === 'tournaments'
                ? {
                    id: 't1', series_id: null, name: 'Турнір', event_date: '2999-12-31', status: 'registration_open', rules_md: null, prizes_md: null,
                    bracket_type: 'single_elim', bracket_size: null, team_size: 3, created_by: null, visibility: 'public', third_place_match: false,
                    bracket_new_look: true, team_mode: 'balanced_random',
                  }
                : null,
            error: null,
          }),
        }),
      }),
      insert: async (row: Record<string, unknown>) => {
        db.inserts.push(row);
        return { error: null };
      },
    }),
  },
}));
const api = vi.hoisted(() => ({ rec: null as unknown }));
vi.mock('../../doll/api/characters', () => ({
  getCharacter: async (id: string) => {
    if (!api.rec) throw new Error('немає персонажа ' + id);
    return api.rec;
  },
  listCharacters: async () => ({ characters: [], max: 16 }),
}));

import { BUILTIN_RULES_VERSION, normalizeRules, registerRules, registrationScore, rulesFor } from '../../data/gearRules';
import { submitRegistration } from '../../data/tournaments';
import { readJson } from '../../doll/core/__tests__/testData';
import { validateDoc, type CharacterDoc } from '../../doll/model/doc';
import { ITEM_BREAKDOWN_MAX_BYTES, breakdownBytes, scoreItems } from '../../doll/model/itemScore';
import { docFrom, loadRef, lookup } from '../../doll/model/__tests__/testDoc';
import { characterForRegistration, submitBlockReason as clientBlockReason } from '../../doll/registration';
import { gearColumns, scoreRegistration, submitBlockReason } from '../scorer';
import snapshotJson from './fixtures/regSnapshot.json';
import rulesJson from './fixtures/rulesV122.json';

const V122 = rulesJson.version;
const RULES_RAW: unknown = rulesJson.rules;

/** Знімок із заявки — так само, як його відкриває клієнт (validateDoc). */
function snapshotDoc(): CharacterDoc {
  const v = validateDoc(snapshotJson);
  const doc = v.ok ? v.doc : v.recoverable;
  if (!doc) throw new Error('фікстура знімка пошкоджена');
  return doc;
}
function useDoc(doc: unknown): void {
  api.rec = { id: 'c1', name: 'Tayforn', cls: 'js', level: 105, revision: 7, updatedAt: '2026-10-01T00:00:00Z', doc };
}

beforeAll(() => {
  loadRef();
  vi.stubGlobal('fetch', async (url: string) => {
    const name = String(url).split('/').pop()!.replace(/[?#].*$/, '').replace(/\.json$/, '');
    return { ok: true, status: 200, json: async () => readJson(name) };
  });
  registerRules({ version: V122, note: 'з бази', createdAt: '2026-10-01T14:55:21Z', builtin: false }, normalizeRules(RULES_RAW), false);
});
afterAll(() => {
  vi.unstubAllGlobals();
});

describe('scoreRegistration: той самий скор, що в браузері гравця', () => {
  it('знімок заявки, шкала balance-v1.22, 3×3: itemPoints = scoreItems = characterForRegistration', async () => {
    const doc = snapshotDoc();
    const rules = normalizeRules(RULES_RAW);
    useDoc(snapshotJson);
    const client = await characterForRegistration('c1', { rulesVersion: V122, teamSize: 3 });
    const server = scoreRegistration({ doc: snapshotJson, rulesRaw: RULES_RAW, rulesVersion: V122, teamSize: 3, scorer: 'pw-pvp@test' });
    if (!server.ok) throw new Error(server.blockReason);

    const expected = scoreItems(doc, rules, lookup).itemPoints;
    expect(server.itemPoints).toBe(expected);
    expect(server.itemPoints).toBe(client.itemPoints);
    // Значення на 01.10.2026 (знімок 25.09 × balance-v1.22) — якір від тихих змін моделі.
    expect(server.itemPoints).toBe(293.68);
    expect(server.rulesVersion).toBe(V122);

    // Розклад: ті самі рядки й складові, плюс прапорці сервера.
    const { checked, server: byServer, scorer, ...rest } = server.itemBreakdown;
    expect({ checked, byServer, scorer }).toEqual({ checked: true, byServer: true, scorer: 'pw-pvp@test' });
    expect(rest).toEqual(client.itemBreakdown);
    expect(breakdownBytes(server.itemBreakdown)).toBeLessThanOrEqual(ITEM_BREAKDOWN_MAX_BYTES);

    // Legacy-анкета, сила й склад каменів — як у клієнта.
    expect(server.gear).toEqual(client.result.gear);
    expect(server.dollPower).toEqual(client.power);
    expect(server.attackLevel).toBe(client.result.attackLevel);
    expect(server.defenseLevel).toBe(client.result.defenseLevel);
    expect(server.doc).toEqual(client.doc);

    // Скор — так само, як порахує жеребка з колонок.
    expect(server.score).toBe(registrationScore({ gear: client.result.gear, itemPoints: client.itemPoints }, rules, 3));
    expect(server.columns).toMatchObject({
      ...gearColumns(server.gear),
      attack_level: server.attackLevel,
      defense_level: server.defenseLevel,
      doll_power: server.dollPower,
      item_points: server.itemPoints,
      item_breakdown: server.itemBreakdown,
    });
    expect(JSON.stringify(server.columns)).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('без версії з бази (rulesRaw = null) — вбудована шкала, як клієнт із невідомою версією', async () => {
    useDoc(snapshotJson);
    const client = await characterForRegistration('c1', { rulesVersion: BUILTIN_RULES_VERSION, teamSize: 6 });
    const server = scoreRegistration({ doc: snapshotJson, rulesRaw: null, rulesVersion: 'balance-v0.0', teamSize: 6 });
    if (!server.ok) throw new Error(server.blockReason);
    expect(server.rulesVersion).toBe(BUILTIN_RULES_VERSION);
    expect(server.itemPoints).toBe(client.itemPoints);
    expect(server.itemPoints).toBe(scoreItems(snapshotDoc(), rulesFor(BUILTIN_RULES_VERSION), lookup).itemPoints);
    expect(server.itemBreakdown.sum).toEqual(client.itemBreakdown.sum);
    expect(server.itemBreakdown).not.toHaveProperty('scorer');
  });

  it('розмір команди — з турніру, якщо окремо не передано; без нього — 3×3', () => {
    const rules = normalizeRules(RULES_RAW);
    const six = scoreRegistration({ doc: snapshotJson, rulesRaw: RULES_RAW, rulesVersion: V122, tournament: { teamMode: 'balanced_random', teamSize: 6 } });
    const three = scoreRegistration({ doc: snapshotJson, rulesRaw: RULES_RAW, rulesVersion: V122 });
    if (!six.ok || !three.ok) throw new Error('заявку заблоковано');
    expect(six.itemBreakdown.sum.cls).toBe(rules.classPointsBySize['6'].archer);
    expect(three.itemBreakdown.sum.cls).toBe(rules.classPointsBySize['3'].archer);
    expect(six.itemPoints).toBe(three.itemPoints);
  });

  it('типовий лучник із фікстур ядра — теж збігається з клієнтом (вбудована шкала)', async () => {
    const doc = docFrom('typical-js');
    useDoc(doc);
    const client = await characterForRegistration('c1', { rulesVersion: BUILTIN_RULES_VERSION, teamSize: 3 });
    const server = scoreRegistration({ doc, rulesRaw: null, rulesVersion: null, teamSize: 3 });
    if (!server.ok) throw new Error(server.blockReason);
    expect(server.itemPoints).toBe(client.itemPoints);
    expect(server.itemPoints).toBe(189.01);
    expect(server.gear).toEqual(client.result.gear);
  });
});

describe('scoreRegistration: коли заявку не подати', () => {
  it('немає зброї / порожній слот броні — той самий текст, що в браузері', async () => {
    const base = snapshotDoc();
    const main = { ...base.main };
    delete main.ta;
    const sets = base.sets.map((s) => {
      const slots = { ...s.slots };
      delete slots.ta;
      return { ...s, slots };
    });
    const noWeapon = { ...base, main, sets };
    useDoc(noWeapon);
    const client = await characterForRegistration('c1');
    const server = scoreRegistration({ doc: noWeapon, rulesRaw: null, rulesVersion: null });
    expect(server).toEqual({ ok: false, blockReason: client.blockReason });
    expect(client.blockReason).toMatch(/немає зброї/);

    const noArmor = { ...base.main };
    delete noArmor.rv;
    const res = scoreRegistration({ doc: { ...base, main: noArmor }, rulesRaw: null, rulesVersion: null });
    expect(res).toEqual({ ok: false, blockReason: 'Заявку не подати: у Головному порожній слот броні: нагрудник.' });
  });

  it('пошкоджений документ і не фул-рандом — відмова з поясненням', () => {
    const broken = scoreRegistration({ doc: { v: 99 }, rulesRaw: null, rulesVersion: null });
    expect(broken.ok).toBe(false);
    expect(!broken.ok && broken.blockReason).toMatch(/пошкоджено/);
    const fixed = scoreRegistration({ doc: snapshotJson, rulesRaw: null, rulesVersion: null, tournament: { teamMode: 'fixed', teamSize: 3 } });
    expect(!fixed.ok && fixed.blockReason).toMatch(/фул-рандом/);
    // фул-рандом без розміру команди — теж не фул-рандом (isBalancedRandom)
    const noSize = scoreRegistration({ doc: snapshotJson, rulesRaw: null, rulesVersion: null, tournament: { teamMode: 'balanced_random', teamSize: null } });
    expect(noSize.ok).toBe(false);
  });
});

describe('копії з браузерних модулів не розходяться з оригіналами', () => {
  it('submitBlockReason = registration.ts', () => {
    for (const missing of [[], ['зброя'], ['порожній слот броні: нагрудник'], ['зброя', 'порожні слоти броні: нагрудник, поножі']]) {
      expect(submitBlockReason(missing)).toBe(clientBlockReason(missing));
    }
  });

  it('gearColumns = колонки анкети, які пише submitRegistration (tournaments.ts gearToRow)', async () => {
    const server = scoreRegistration({ doc: snapshotJson, rulesRaw: RULES_RAW, rulesVersion: V122, teamSize: 3 });
    if (!server.ok) throw new Error(server.blockReason);
    // кілька варіантів анкети: з ШГ/Вознєсом і кільцями R9R1, і без них
    const variants = [
      server.gear,
      { ...server.gear, shg: false, shgRefine: null, voznes: false, voznesRefine: null, ring1: 'r9r1' as const, ring1Refine: 7, ring2: null, ring2Refine: null },
    ];
    for (const gear of variants) {
      db.inserts.length = 0;
      await submitRegistration({ tournamentId: 't1', nickname: 'Tayforn', rulesAck: true, gear, attackLevel: 1, defenseLevel: 2 });
      const row = db.inserts[0];
      const cols = gearColumns(gear);
      const fromClient = Object.fromEntries(Object.keys(row).filter((k) => !['tournament_id', 'nickname', 'rules_ack', 'member_nicknames', 'attack_level', 'defense_level'].includes(k)).map((k) => [k, row[k]]));
      expect(cols).toEqual(fromClient);
    }
  });
});

describe('розклад сервера вміщається в CHECK бази', () => {
  beforeEach(() => {
    useDoc(snapshotJson);
  });

  it('довгий підпис scorer обрізається до 40 символів, розмір ≤ ITEM_BREAKDOWN_MAX_BYTES', () => {
    const res = scoreRegistration({ doc: snapshotJson, rulesRaw: RULES_RAW, rulesVersion: V122, scorer: 'x'.repeat(200) });
    if (!res.ok) throw new Error(res.blockReason);
    expect(res.itemBreakdown.scorer).toBe('x'.repeat(40));
    expect(breakdownBytes(res.itemBreakdown)).toBeLessThanOrEqual(ITEM_BREAKDOWN_MAX_BYTES);
  });

  it('мітки бекенда (nonce, sig) — у розкладі, обрізані до 64 символів, у межах розміру; без міток — полів немає', () => {
    const tags = { nonce: 'n'.repeat(80), sig: 'S'.repeat(32) };
    const res = scoreRegistration({ doc: snapshotJson, rulesRaw: RULES_RAW, rulesVersion: V122, scorer: 'pw-pvp@abc', tags });
    if (!res.ok) throw new Error(res.blockReason);
    expect(res.itemBreakdown).toMatchObject({ nonce: 'n'.repeat(64), sig: 'S'.repeat(32), server: true, checked: true });
    expect('pid' in res.itemBreakdown).toBe(false);
    expect(breakdownBytes(res.itemBreakdown)).toBeLessThanOrEqual(ITEM_BREAKDOWN_MAX_BYTES);
    const bare = scoreRegistration({ doc: snapshotJson, rulesRaw: RULES_RAW, rulesVersion: V122 });
    if (!bare.ok) throw new Error(bare.blockReason);
    expect(Object.keys(bare.itemBreakdown)).not.toEqual(expect.arrayContaining(['nonce']));
    expect('sig' in bare.itemBreakdown).toBe(false);
  });
});
