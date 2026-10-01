// =========================================================
// DEV-сторінка /dev/bracket (лише в dev-збірці, у прод не потрапляє):
// сітка з фейковими командами, щоб дивитись і правити верстку BracketView
// без бази й логіну в адмінку. Генерація повторює структуру
// src/data/bracket.ts (single/double elim без байів); результати
// зберігаються лише в стані сторінки з тією ж пропагацією переможця/
// програвшого, що й setMatchWinner. Склади з класами й рангами — фейковий
// знімок жеребки (balanceTeams), як у фул-рандомі: видно в підказці й панелі
// матчу. Генератори сітки експортовано — ними ж користуються тести сітки.
// =========================================================

import { useMemo, useState } from 'react';
import type { BalanceStats, BracketMatch, Registration, Tier } from '../data/types';
import { CLASS_ORDER } from '../data/gearRules';
import BracketView from '../components/BracketView';
import { requiredWins } from '../components/bracket/model';

const NAMES = ['ПотужнічТанк', 'нубо вар', 'мегаМаг', 'Дудлс', 'нубоДру', 'топСік', 'Тайфорн', 'Ксенус', 'слабМіст', 'Стефанія', 'Потужніч сін', 'слабкий маг', 'потужнічВар', 'пупупу', 'Меркурі', 'NeO[N]', 'DudeIsFine', 'Люкс', 'Фінрод', 'Аркан'];

export function fakeTeams(n: number, size: number, tournamentId: string): Registration[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `team-${i + 1}`, tournamentId, nickname: `Команда ${i + 1}`, rulesAck: true, status: 'confirmed', createdAt: '2026-09-20T00:00:00Z',
    memberNicknames: size > 1 ? Array.from({ length: size }, (_, j) => NAMES[(i * size + j) % NAMES.length]) : null,
    kind: size > 1 ? 'team' : 'player', teamRegistrationId: null, gear: null, attackLevel: null, defenseLevel: null, scoreAdjust: 0, scoreAdjustNote: null,
    characterId: null, characterRev: null, characterSnapshot: null, dollConfirmedAt: null, dollPower: null, itemPoints: null, itemBreakdown: null, rejectReason: null,
  }));
}

const TIERS: Tier[] = ['S', 'A', 'B', 'C', 'D'];

/** Фейковий знімок жеребки: клас і ранг кожного з команди (як balanceStats.teams). */
function fakeBalanceTeams(teams: Registration[]): BalanceStats['teams'] {
  return teams.map((t, i) => ({
    name: t.nickname,
    total: 0,
    members: (t.memberNicknames ?? []).map((nickname, j) => ({
      registrationId: `${t.id}-p${j}`, nickname, charClass: CLASS_ORDER[(i * 3 + j) % CLASS_ORDER.length], score: 0, tier: TIERS[(i + j) % TIERS.length],
    })),
  }));
}

/** Випадковий результат серії: переможець набирає потрібні перемоги, програвший — менше. */
function randomScore(format: string, firstWins: boolean): string {
  const need = requiredWins(format);
  const other = Math.floor(Math.random() * need);
  return firstWins ? `${need}-${other}` : `${other}-${need}`;
}

const blank = (over: Partial<BracketMatch> & Pick<BracketMatch, 'id' | 'bracketSide' | 'round' | 'slot'>): BracketMatch => ({
  tournamentId: 'dev', format: 'bo1', participant1Id: null, participant2Id: null, winnerId: null, score: null,
  nextMatchId: null, nextMatchSlot: null, loserNextMatchId: null, loserNextMatchSlot: null, ...over,
});

export function singleElim(ids: string[], thirdPlace: boolean): BracketMatch[] {
  const n = ids.length, k = Math.log2(n);
  const idsByRound = Array.from({ length: k }, (_, r) => Array.from({ length: n / 2 ** (r + 1) }, (_, s) => `w${r + 1}-${s}`));
  const thirdId = thirdPlace && k >= 2 ? 'third' : null;
  const out: BracketMatch[] = [];
  for (let r = 1; r <= k; r++) {
    for (let s = 0; s < idsByRound[r - 1].length; s++) {
      const semi = thirdId !== null && r === k - 1;
      out.push(blank({
        id: idsByRound[r - 1][s], bracketSide: 'winners', round: r, slot: s,
        participant1Id: r === 1 ? ids[2 * s] : null, participant2Id: r === 1 ? ids[2 * s + 1] : null,
        nextMatchId: r < k ? idsByRound[r][Math.floor(s / 2)] : null, nextMatchSlot: r < k ? (((s % 2) + 1) as 1 | 2) : null,
        loserNextMatchId: semi ? thirdId : null, loserNextMatchSlot: semi ? (((s % 2) + 1) as 1 | 2) : null,
      }));
    }
  }
  if (thirdId) out.push(blank({ id: thirdId, bracketSide: 'third_place', round: k, slot: 0 }));
  return out;
}

export function doubleElim(ids: string[]): BracketMatch[] {
  const n = ids.length, k = Math.log2(n);
  const wb = Array.from({ length: k }, (_, r) => Array.from({ length: n / 2 ** (r + 1) }, (_, s) => `w${r + 1}-${s}`));
  const lbRounds = 2 * k - 2;
  const lb = Array.from({ length: lbRounds }, (_, j) => Array.from({ length: n / 2 ** (Math.ceil((j + 1) / 2) + 1) }, (_, s) => `l${j + 1}-${s}`));
  const finalId = 'gf';
  const out: BracketMatch[] = [];
  for (let r = 1; r <= k; r++) {
    for (let s = 0; s < wb[r - 1].length; s++) {
      let loserNextId: string, loserNextSlot: 1 | 2;
      if (r === 1) { loserNextId = lb[0][Math.floor(s / 2)]; loserNextSlot = ((s % 2) + 1) as 1 | 2; }
      else if (r < k) { loserNextId = lb[2 * (r - 1) - 1][s]; loserNextSlot = 2; }
      else { loserNextId = lb[lbRounds - 1][0]; loserNextSlot = 2; }
      out.push(blank({
        id: wb[r - 1][s], bracketSide: 'winners', round: r, slot: s,
        participant1Id: r === 1 ? ids[2 * s] : null, participant2Id: r === 1 ? ids[2 * s + 1] : null,
        nextMatchId: r < k ? wb[r][Math.floor(s / 2)] : finalId, nextMatchSlot: r < k ? (((s % 2) + 1) as 1 | 2) : 1,
        loserNextMatchId: loserNextId, loserNextMatchSlot: loserNextSlot,
      }));
    }
  }
  for (let j = 1; j <= lbRounds; j++) {
    const odd = j % 2 === 1;
    for (let s = 0; s < lb[j - 1].length; s++) {
      let nextId: string, nextSlot: 1 | 2;
      if (odd) { nextId = lb[j][s]; nextSlot = 1; }
      else if (j === lbRounds) { nextId = finalId; nextSlot = 2; }
      else { nextId = lb[j][Math.floor(s / 2)]; nextSlot = ((s % 2) + 1) as 1 | 2; }
      out.push(blank({ id: lb[j - 1][s], bracketSide: 'losers', round: j, slot: s, nextMatchId: nextId, nextMatchSlot: nextSlot }));
    }
  }
  out.push(blank({ id: finalId, bracketSide: 'final', round: 1, slot: 0, format: 'bo3' }));
  return out;
}

/** Та сама пропагація, що й у setMatchWinner (без автозавершення турніру). */
export function applyWinner(matches: BracketMatch[], matchId: string, winnerId: string | null, score: string | null): BracketMatch[] {
  const m = matches.find((x) => x.id === matchId)!;
  let next = matches.map((x) => (x.id === matchId ? { ...x, winnerId, score } : x));
  const put = (list: BracketMatch[], id: string | null, slot: 1 | 2 | null, pid: string | null) =>
    id && slot ? list.map((x) => (x.id === id ? { ...x, [slot === 1 ? 'participant1Id' : 'participant2Id']: pid } : x)) : list;
  // скидання/зміна переможця — прибрати старих з наступних матчів (як setMatchWinner)
  if (m.winnerId && m.winnerId !== winnerId) {
    next = put(next, m.nextMatchId, m.nextMatchSlot, null);
    next = put(next, m.loserNextMatchId, m.loserNextMatchSlot, null);
  }
  if (!winnerId) return next;
  let res = put(next, m.nextMatchId, m.nextMatchSlot, winnerId);
  if (m.participant1Id && m.participant2Id) {
    const loser = m.participant1Id === winnerId ? m.participant2Id : m.participant1Id;
    res = put(res, m.loserNextMatchId, m.loserNextMatchSlot, loser);
  }
  return res;
}

export default function DevBracketPage() {
  const [kind, setKind] = useState<'single' | 'double'>('double');
  const [n, setN] = useState(8);
  const [size, setSize] = useState(3);
  const [editable, setEditable] = useState(true);
  const [newLook, setNewLook] = useState(true);
  const [thirdPlace, setThirdPlace] = useState(true);
  const [format, setFormat] = useState('bo3');
  const [version, setVersion] = useState(0);

  const registrations = useMemo(() => fakeTeams(n, size, 'dev'), [n, size]);
  const balanceTeams = useMemo(() => (size > 1 ? fakeBalanceTeams(registrations) : null), [registrations, size]);
  const initial = useMemo(() => {
    const ids = registrations.map((r) => r.id);
    const list = kind === 'double' ? doubleElim(ids) : singleElim(ids, thirdPlace);
    // вирішальний матч — на одну гру довший (як зазвичай роблять адміни)
    return list.map((m) => ({ ...m, format: m.bracketSide === 'final' && format === 'bo3' ? 'bo5' : format }));
  }, [kind, registrations, thirdPlace, format, version]);
  const [matches, setMatches] = useState(initial);
  const [key, setKey] = useState(initial);
  if (key !== initial) { setKey(initial); setMatches(initial); }

  // зіграти всі live-матчі випадково — щоб швидко побачити стани
  const playRound = (list: BracketMatch[]): BracketMatch[] => {
    let cur = list;
    for (const m of list) {
      if (m.participant1Id && m.participant2Id && !m.winnerId) {
        const w = Math.random() < 0.5 ? m.participant1Id : m.participant2Id;
        cur = applyWinner(cur, m.id, w, randomScore(m.format, w === m.participant1Id));
      }
    }
    return cur;
  };
  const playRandomRound = () => setMatches((cur) => playRound(cur));
  const playAll = () => setMatches((cur) => {
    let next = cur;
    for (let i = 0; i < 64; i++) {
      const after = playRound(next);
      if (after === next) break;
      next = after;
    }
    return next;
  });

  return (
    <div>
      <h2>DEV · сітка</h2>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <label className="field" style={{ flex: '0 0 140px' }}><span>Тип</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as 'single' | 'double')}><option value="single">single_elim</option><option value="double">double_elim</option></select>
        </label>
        <label className="field" style={{ flex: '0 0 100px' }}><span>Команд</span>
          <select value={n} onChange={(e) => setN(Number(e.target.value))}>{[4, 8, 16, 32].map((x) => <option key={x} value={x}>{x}</option>)}</select>
        </label>
        <label className="field" style={{ flex: '0 0 110px' }}><span>Людей у паті</span>
          <select value={size} onChange={(e) => setSize(Number(e.target.value))}>{[1, 2, 3, 5].map((x) => <option key={x} value={x}>{x}</option>)}</select>
        </label>
        <label className="field" style={{ flex: '0 0 100px' }}><span>Формат</span>
          <select value={format} onChange={(e) => setFormat(e.target.value)}>{['bo1', 'bo3', 'bo5'].map((x) => <option key={x} value={x}>{x.toUpperCase()}</option>)}</select>
        </label>
        <label className="checkbox-row"><input type="checkbox" checked={editable} onChange={(e) => setEditable(e.target.checked)} /> редактор</label>
        <label className="checkbox-row"><input type="checkbox" checked={newLook} onChange={(e) => setNewLook(e.target.checked)} /> дзеркальна (single)</label>
        <label className="checkbox-row"><input type="checkbox" checked={thirdPlace} onChange={(e) => setThirdPlace(e.target.checked)} /> матч за 3-тє (single)</label>
        <button type="button" className="btn btn-ghost btn-sm" onClick={playRandomRound}>Зіграти live-матчі випадково</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={playAll}>Зіграти все</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVersion((v) => v + 1)}>Скинути</button>
      </div>
      <BracketView
        matches={matches}
        registrations={registrations}
        bracketNewLook={newLook}
        balanceTeams={balanceTeams}
        title="DEV · Тестовий турнір"
        editable={editable ? {
          // імітація мережі — щоб бачити стан «у дорозі»
          onSetWinner: (id, w, score) => new Promise<void>((r) => setTimeout(() => { setMatches((cur) => applyWinner(cur, id, w, score ?? null)); r(); }, 250)),
          onSetFormat: (id, format) => { setMatches((cur) => cur.map((x) => (x.id === id ? { ...x, format } : x))); },
        } : undefined}
      />
    </div>
  );
}
