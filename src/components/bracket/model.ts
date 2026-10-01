// =========================================================
// Чиста логіка турнірної сітки (без React і DOM) — адреси матчів, назви
// етапів, склади команд, шлях команди по сітці, пʼєдестал, скорочення складу
// в картці до «+N». Окремо від BracketView, щоб тестувати без рендеру.
// =========================================================

import type { BalanceStats, BracketMatch, Registration, Tier } from '../../data/types';
import { CLASS_LABELS } from '../../data/gearRules';
import { thirdFromLosersFinal } from '../../data/podium';

export const FORMAT_LABELS: Record<string, string> = { bo1: 'BO1', bo3: 'BO3', bo5: 'BO5' };

export function formatLabel(format: string): string {
  return FORMAT_LABELS[format] ?? format.toUpperCase();
}

/** Скільки перемог потрібно для серії даного формату (bo3 → 2, bo5 → 3,
 * bo7 → 4…). Формат без цифри (нетиповий кастом) — 1, щоб адмін завжди мав
 * змогу завершити матч кліком, а не залипав без варіанту зафіксувати результат. */
export function requiredWins(format: string): number {
  const digits = format.match(/\d+/);
  const n = digits ? parseInt(digits[0], 10) : 1;
  return Math.max(1, Math.floor(n / 2) + 1);
}

/** «2-1» → [2, 1]; інше — null. */
export function parseScore(score: string | null): [number, number] | null {
  const mm = /^(\d+)-(\d+)$/.exec(score ?? '');
  return mm ? [Number(mm[1]), Number(mm[2])] : null;
}

export const isBo1 = (m: BracketMatch): boolean => m.format.toLowerCase() === 'bo1';

/** Загальні відомості про сітку, потрібні майже всім підписам. */
export interface BracketInfo {
  doubleElim: boolean;
  /** останній раунд верхньої (або єдиної) сітки */
  wbMax: number;
  /** останній раунд нижньої сітки (0 — немає) */
  lbMax: number;
  /** матч, що визначає чемпіона: гранд-фінал або фінал одинарної */
  decisive: BracketMatch | null;
  byId: Map<string, BracketMatch>;
}

export function bracketInfo(matches: BracketMatch[]): BracketInfo {
  const winners = matches.filter((m) => m.bracketSide === 'winners');
  const losers = matches.filter((m) => m.bracketSide === 'losers');
  const final = matches.find((m) => m.bracketSide === 'final') ?? null;
  const wbMax = winners.length ? Math.max(...winners.map((m) => m.round)) : 0;
  const lbMax = losers.length ? Math.max(...losers.map((m) => m.round)) : 0;
  return {
    doubleElim: losers.length > 0 || !!final,
    wbMax,
    lbMax,
    decisive: final ?? winners.find((m) => m.round === wbMax) ?? null,
    byId: new Map(matches.map((m) => [m.id, m])),
  };
}

/** «В1.2» / «Н3.1» / «1.2» (одинарна) / «ГФ» / «3-тє» — коротка адреса матчу
 * для підказок у порожніх слотах, шапки картки й шляху команди. */
export function matchRef(f: BracketMatch, doubleElim: boolean): string {
  if (f.bracketSide === 'final') return 'ГФ';
  if (f.bracketSide === 'third_place') return '3-тє';
  const side = !doubleElim ? '' : f.bracketSide === 'losers' ? 'Н' : 'В';
  return `${side}${f.round}.${f.slot + 1}`;
}

/** Назва раунду одинарної сітки за відстанню до фіналу. */
export function roundLabel(depthFromFinal: number): string {
  if (depthFromFinal === 0) return 'Фінал';
  if (depthFromFinal === 1) return 'Півфінал';
  if (depthFromFinal === 2) return 'Чвертьфінал';
  return `1/${2 ** depthFromFinal} фіналу`;
}

/** Повна назва етапу матчу — у панелі матчу й підказках. */
export function stageName(m: BracketMatch, info: BracketInfo): string {
  if (m.bracketSide === 'final') return 'Гранд-фінал';
  if (m.bracketSide === 'third_place') return 'Матч за 3-тє місце';
  if (m.bracketSide === 'losers') return m.round === info.lbMax ? 'Фінал нижньої сітки' : `Нижня сітка · раунд ${m.round}`;
  if (info.doubleElim) return m.round === info.wbMax ? 'Фінал верхньої сітки' : `Верхня сітка · раунд ${m.round}`;
  return roundLabel(info.wbMax - m.round);
}

/** Звідки прийде (прийшов) учасник кожного слота: «переможець В1.2» / «програвший В2.1»;
 * undefined — перший раунд (посів). */
export function sourceLabels(m: BracketMatch, all: BracketMatch[], doubleElim: boolean): [string | undefined, string | undefined] {
  const out: [string | undefined, string | undefined] = [undefined, undefined];
  for (const f of all) {
    if (f.nextMatchId === m.id && f.nextMatchSlot) out[f.nextMatchSlot - 1] = `переможець ${matchRef(f, doubleElim)}`;
    if (f.loserNextMatchId === m.id && f.loserNextMatchSlot) out[f.loserNextMatchSlot - 1] = `програвший ${matchRef(f, doubleElim)}`;
  }
  return out;
}

export function nameFor(id: string | null, regs: Registration[]): string {
  if (!id) return '—';
  return regs.find((r) => r.id === id)?.nickname ?? '?';
}

// ── Склади ─────────────────────────────────────────────────────────────

export interface RosterMember {
  nickname: string;
  /** клас українською («Прист»), якщо відомий */
  cls?: string;
  /** ранг зі знімка жеребки — публічний, як бейдж у «Складах команд» */
  tier?: Tier;
}

/** Склад учасника сітки. Фул-рандом: знімок жеребки (порядок і ранги; нік —
 * з живого рядка гравця, бо знімок не знає про перейменування), без знімка —
 * рядки гравців за team_registration_id; готові команди — member_nicknames;
 * соло — порожньо. */
export function rosterFor(id: string | null, regs: Registration[], balanceTeams?: BalanceStats['teams'] | null): RosterMember[] {
  if (!id) return [];
  const reg = regs.find((r) => r.id === id);
  if (!reg) return [];
  const snap = reg.kind === 'team' ? balanceTeams?.find((t) => t.name === reg.nickname) : undefined;
  if (snap && snap.members.length > 0) {
    const byId = new Map(regs.map((r) => [r.id, r] as const));
    return snap.members.map((m) => {
      const p = byId.get(m.registrationId);
      const cls = p?.gear?.charClass ?? m.charClass;
      return { nickname: p?.nickname ?? m.nickname, cls: cls ? CLASS_LABELS[cls] : undefined, tier: m.tier };
    });
  }
  // Рядки гравців — у порядку member_nicknames (як у картках і на пʼєдесталі); member_nicknames —
  // лише кеш, що застаріває при перейменуванні, тож ніки беремо з рядків, а невідомих ставимо в кінець.
  const players = reg.kind === 'team' ? regs.filter((r) => r.kind === 'player' && r.teamRegistrationId === id) : [];
  if (players.length > 0) {
    const order = reg.memberNicknames ?? [];
    const pos = (n: string) => (order.includes(n) ? order.indexOf(n) : order.length);
    return [...players]
      .sort((a, b) => pos(a.nickname) - pos(b.nickname))
      .map((p) => ({ nickname: p.nickname, cls: p.gear ? CLASS_LABELS[p.gear.charClass] : undefined }));
  }
  return (reg.memberNicknames ?? []).map((n) => ({ nickname: n }));
}

/** Клас соло-учасника (сам гравець, а не команда) — для підказки й панелі. */
export function soloClass(id: string | null, regs: Registration[]): string | undefined {
  const reg = id ? regs.find((r) => r.id === id) : undefined;
  return reg && reg.kind === 'player' && reg.gear ? CLASS_LABELS[reg.gear.charClass] : undefined;
}

/** Склад у картці матчу — скільки ніків уміщається, решта — «+N». `fits`
 * перевіряє, чи рядок уміщається в ширину картки (вимір шрифтом). Перший нік
 * лишається завжди (довгий обріже трикрапкою CSS). */
export function shortRoster(names: string[], fits: (text: string) => boolean): { shown: string; more: number } {
  if (names.length === 0) return { shown: '', more: 0 };
  const full = names.join(', ');
  if (fits(full)) return { shown: full, more: 0 };
  for (let k = names.length - 1; k >= 1; k--) {
    const shown = names.slice(0, k).join(', ');
    if (fits(`${shown} +${names.length - k}`)) return { shown, more: names.length - k };
  }
  return { shown: names[0], more: names.length - 1 };
}

// ── Шлях команди ───────────────────────────────────────────────────────

export type StepOutcome = 'win' | 'loss' | 'live' | 'wait';

export interface PathStep {
  m: BracketMatch;
  outcome: StepOutcome;
  opponentId: string | null;
  /** рахунок з погляду команди [свої, суперника]; null — рахунку немає */
  score: [number, number] | null;
  /** як команда потрапила в цей матч: перший її матч, перемогою чи пониженням у нижню сітку */
  via: 'start' | 'win' | 'drop';
  /** матч, з якого прийшла (для via ≠ start) */
  fromId: string | null;
}

const SIDE_ORDER: Record<string, number> = { winners: 0, losers: 1, third_place: 2, final: 3 };

/** Порядок «як читають сітку»: верхня, нижня, матч за 3-тє, гранд-фінал; усередині — раунд, слот.
 * Ним же йде Tab по картках. */
export const byBracketOrder = (a: BracketMatch, b: BracketMatch): number =>
  (SIDE_ORDER[a.bracketSide] ?? 0) - (SIDE_ORDER[b.bracketSide] ?? 0) || a.round - b.round || a.slot - b.slot;

/** Усі матчі команди в порядку, в якому вона їх грала: від першого матчу
 * переможною стрілкою (виграла → nextMatchId) або програшною (програла →
 * loserNextMatchId), поки команда є в наступному матчі. Якщо дані неузгоджені
 * (адмін скинув результат посеред шляху), решта матчів додається за стороною
 * й раундом. */
export function teamPath(teamId: string, matches: BracketMatch[]): PathStep[] {
  const mine = matches.filter((m) => m.participant1Id === teamId || m.participant2Id === teamId);
  if (mine.length === 0) return [];
  const has = new Set(mine.map((m) => m.id));
  const nextOf = (m: BracketMatch): { id: string; via: 'win' | 'drop' } | null => {
    if (!m.winnerId) return null;
    if (m.winnerId === teamId) return m.nextMatchId && has.has(m.nextMatchId) ? { id: m.nextMatchId, via: 'win' } : null;
    return m.loserNextMatchId && has.has(m.loserNextMatchId) ? { id: m.loserNextMatchId, via: 'drop' } : null;
  };
  const incoming = new Map<string, { from: string; via: 'win' | 'drop' }>();
  for (const m of mine) {
    const n = nextOf(m);
    if (n && !incoming.has(n.id)) incoming.set(n.id, { from: m.id, via: n.via });
  }
  const byOrder = byBracketOrder;
  const ordered: BracketMatch[] = [];
  const seen = new Set<string>();
  for (const start of mine.filter((m) => !incoming.has(m.id)).sort(byOrder)) {
    let cur: BracketMatch | undefined = start;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      ordered.push(cur);
      const n = nextOf(cur);
      cur = n ? mine.find((x) => x.id === n.id) : undefined;
    }
  }
  for (const m of [...mine].sort(byOrder)) if (!seen.has(m.id)) ordered.push(m);

  return ordered.map((m) => {
    const mineFirst = m.participant1Id === teamId;
    const opponentId = mineFirst ? m.participant2Id : m.participant1Id;
    const raw = parseScore(m.score);
    const score: [number, number] | null = raw ? (mineFirst ? raw : [raw[1], raw[0]]) : null;
    const outcome: StepOutcome = m.winnerId ? (m.winnerId === teamId ? 'win' : 'loss') : opponentId ? 'live' : 'wait';
    const inc = incoming.get(m.id);
    return { m, outcome, opponentId, score, via: inc?.via ?? 'start', fromId: inc?.from ?? null };
  });
}

/** Рахунок кроку шляху «2:1» (BO1 — без рахунку: лише результат). */
export function stepScore(step: PathStep): string {
  if (!step.score || isBo1(step.m)) return '';
  return `${step.score[0]}:${step.score[1]}`;
}

// ── Пʼєдестал і підсумок команди ───────────────────────────────────────

export interface PodiumIds {
  first: string | null;
  second: string | null;
  third: string | null;
}

/** Топ-3 за сіткою (та сама логіка, що fetchPodium): 2-ге — програний
 * вирішального матчу, 3-тє — переможець матчу за 3-тє або програний фіналу нижньої. */
export function podiumIds(matches: BracketMatch[], info: BracketInfo = bracketInfo(matches)): PodiumIds {
  const d = info.decisive;
  if (!d?.winnerId) return { first: null, second: null, third: null };
  const second = d.participant1Id === d.winnerId ? d.participant2Id : d.participant1Id;
  const third = matches.find((m) => m.bracketSide === 'third_place')?.winnerId ?? thirdFromLosersFinal(matches);
  return { first: d.winnerId, second: second ?? null, third: third ?? null };
}

export interface Standing {
  place: 1 | 2 | 3 | null;
  /** «Чемпіон» / «2 місце» / «грає В2.1» / «вибув у Н3.1»… */
  label: string;
  tone: 'gold' | 'good' | 'bad' | 'live' | 'mute';
}

export function teamStanding(teamId: string, path: PathStep[], podium: PodiumIds, doubleElim: boolean): Standing {
  if (podium.first === teamId) return { place: 1, label: 'Чемпіон', tone: 'gold' };
  if (podium.second === teamId) return { place: 2, label: '2 місце', tone: 'good' };
  if (podium.third === teamId) return { place: 3, label: '3 місце', tone: 'good' };
  const last = path[path.length - 1];
  if (!last) return { place: null, label: '', tone: 'mute' };
  const ref = matchRef(last.m, doubleElim);
  if (last.outcome === 'live') return { place: null, label: `грає ${ref}`, tone: 'live' };
  if (last.outcome === 'wait') return { place: null, label: `чекає суперника · ${ref}`, tone: 'mute' };
  if (last.outcome === 'loss') return { place: null, label: `вибув у ${ref}`, tone: 'bad' };
  return { place: null, label: '', tone: 'mute' };
}

// ── Пошук ──────────────────────────────────────────────────────────────

export interface SearchHit {
  id: string;
  /** нік зі складу, що збігся (якщо збіглась не сама назва команди) */
  nick?: string;
}

/** Учасники сітки, у яких назва або нік у складі містить запит. */
export function searchParticipants(q: string, ids: string[], regs: Registration[], rosterOf: (id: string) => RosterMember[]): SearchHit[] {
  const low = q.trim().toLowerCase();
  if (!low) return [];
  const out: SearchHit[] = [];
  for (const id of ids) {
    const name = nameFor(id, regs);
    if (name.toLowerCase().includes(low)) {
      out.push({ id });
      continue;
    }
    const nick = rosterOf(id).find((m) => m.nickname.toLowerCase().includes(low))?.nickname;
    if (nick) out.push({ id, nick });
  }
  return out;
}

// ── Спільні дані для картки, підказки й панелі матчу ───────────────────

export interface BracketData {
  matches: BracketMatch[];
  registrations: Registration[];
  info: BracketInfo;
  podium: PodiumIds;
  rosterOf: (id: string | null) => RosterMember[];
  nameOf: (id: string | null) => string;
}
