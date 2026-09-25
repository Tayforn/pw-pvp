// =========================================================
// ЛЯЛЬКА — збережені персонажі: клієнт /api/pvp/characters (бекенд ладдера,
// server/src/pvp.ts у pw-ladder). Сесія Discord спільна для піддоменів
// (cookie на .thunderpw.fun), тож запити йдуть із credentials: 'include'.
// Змінювальні запити сервер приймає лише зі свого origin — браузер сам
// ставить заголовок Origin на same-origin POST/PUT/DELETE.
// =========================================================

import type { CharacterDoc } from '../model/doc';

export interface CharacterSummary {
  id: string;
  name: string;
  cls: string;
  level: number;
  revision: number;
  updatedAt: string;
  items: number;
  sets: number;
}

export interface CharacterRecord {
  id: string;
  name: string;
  cls: string;
  level: number;
  revision: number;
  updatedAt: string;
  doc: unknown;
}

/** Помилка API з кодом бекенда (unauthorized, not_found, conflict, rate_limited…). */
export class CharacterApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new CharacterApiError('network', 0, 'Немає звʼязку з сервером — перевір інтернет і спробуй ще раз.');
  }
  if (res.ok) return (await res.json()) as T;
  let code = 'internal';
  let message = 'Сервер не зміг виконати запит. Спробуй пізніше.';
  try {
    const j = (await res.json()) as { error?: string; message?: string };
    if (j.error) code = j.error;
    if (j.message) message = j.message;
  } catch {
    /* не JSON — лишаємо загальний текст */
  }
  if (res.status === 404 && code === 'internal') code = 'not_found';
  throw new CharacterApiError(code, res.status, message);
}

const BASE = '/api/pvp/characters';

export function listCharacters(): Promise<{ characters: CharacterSummary[]; max: number }> {
  return request('GET', BASE);
}

export function getCharacter(id: string): Promise<CharacterRecord> {
  return request('GET', `${BASE}/${encodeURIComponent(id)}`);
}

export function createCharacter(doc: CharacterDoc): Promise<CharacterRecord> {
  return request('POST', BASE, { doc });
}

export function updateCharacter(id: string, doc: CharacterDoc, baseRevision: number): Promise<CharacterRecord> {
  return request('PUT', `${BASE}/${encodeURIComponent(id)}`, { doc, baseRevision });
}

export function archiveCharacter(id: string): Promise<{ ok: true }> {
  return request('DELETE', `${BASE}/${encodeURIComponent(id)}`);
}
