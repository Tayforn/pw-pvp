// Останній нікнейм, з яким подавали заявку з цього браузера — гравець без
// акаунта, тож це єдиний спосіб не змушувати вводити нік щоразу (форма
// заявки) і одразу підсвітити «свою» команду в сітці турніру.
const LAST_NICK_KEY = 'pw-pvp:lastNickname';

export function readLastNickname(): string {
  try {
    return localStorage.getItem(LAST_NICK_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveLastNickname(nick: string): void {
  try {
    localStorage.setItem(LAST_NICK_KEY, nick);
  } catch {
    /* сховище недоступне (приватний режим тощо) — не критично */
  }
}
