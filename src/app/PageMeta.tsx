// =========================================================
// СЕО-мета поточної сторінки: title, description, og:*.
// На відміну від pw-events/pw-calc (статичний ROUTES-реєстр), тут сторінки
// контент-driven (назва турніру/серії відома лише після фетчу), тож кожна
// сторінка сама передає title/description, а не бере їх з реєстру.
// =========================================================

import { useEffect } from 'react';

function setMeta(selector: string, content: string): void {
  document.querySelector<HTMLMetaElement>(selector)?.setAttribute('content', content);
}

export default function PageMeta({ title, description }: { title: string; description?: string }) {
  useEffect(() => {
    document.title = title;
    if (description) {
      setMeta('meta[name="description"]', description);
      setMeta('meta[property="og:description"]', description);
      setMeta('meta[name="twitter:description"]', description);
    }
    setMeta('meta[property="og:title"]', title);
    setMeta('meta[name="twitter:title"]', title);
  }, [title, description]);
  return null;
}
