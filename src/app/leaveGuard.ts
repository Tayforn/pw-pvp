// =========================================================
// «Сторінка просить підтвердження перед відходом»: сторінка з незбереженими
// змінами (персонаж у профілі з правками, чернетка, яку не вдається записати
// в браузер) реєструє guard — функцію, що повертає текст питання, або null,
// коли йти можна. Роутер (useRoute) питає його перед кожним переходом
// усередині сайту — кліки по сайдбару, логотипу й кнопках сторінок,
// «Назад / Вперед» браузера — і показує window.confirm; «Скасувати» лишає
// людину на сторінці. Той самий стан іде в beforeunload (закриття чи
// оновлення вкладки, зовнішнє посилання) — там браузер показує своє вікно.
//
// Модуль, а не контекст: сторінка персонажа — ледачий чанк, роутер один на
// застосунок, і ділити їм нічого, крім «чи можна йти». Guard один: на сайті
// одна сторінка за раз, і при зміні маршруту стара знімає свій перед тим, як
// нова поставить свій.
// =========================================================

import { useCallback, useEffect, useRef } from 'react';

/** null — переходити можна; рядок — питання для window.confirm. */
export type LeaveGuard = () => string | null;

let guard: LeaveGuard | null = null;

export function setLeaveGuard(g: LeaveGuard | null): void {
  guard = g;
}

/** Зняти guard, якщо він ще той самий (інший уже поставила нова сторінка). */
function clearLeaveGuard(g: LeaveGuard): void {
  if (guard === g) guard = null;
}

/** true — переходити можна: guard мовчить або людина підтвердила. */
export function confirmLeave(): boolean {
  const msg = guard?.();
  return !msg || window.confirm(msg);
}

/**
 * Поки message не null, сторінка не відпускає без підтвердження — ні переходом
 * сайту, ні закриттям вкладки. Повертає release(): відпустити негайно — перед
 * переходом, який сторінка робить сама після видалення чи збереження (стан
 * «змінено» тоді ще не встиг оновитись, а питати вже нема про що).
 */
export function useLeaveGuard(message: string | null): () => void {
  const ref = useRef(message);
  ref.current = message;
  useEffect(() => {
    const g: LeaveGuard = () => ref.current;
    setLeaveGuard(g);
    const onBefore = (e: BeforeUnloadEvent) => {
      if (!ref.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBefore);
    return () => {
      clearLeaveGuard(g);
      window.removeEventListener('beforeunload', onBefore);
    };
  }, []);
  return useCallback(() => {
    ref.current = null;
  }, []);
}
