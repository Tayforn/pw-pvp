# Лялька персонажа (`src/doll`)

Редактор спорядження, перенесений з PW Хелпера (pw-calc, сторінка `/doll`,
коміт `e0a79ed`). Формули ті самі, і це доводять golden-тести проти
незміненого calc. Відмінності від Хелпера: один пул речей на персонажа,
Головний комплект і до 5 сетів (ПЗ / ПА / Спів-Аспд), які посилаються на речі
з цього пулу; рендер лише React-вузлами; кольори pvp.

Сторінка — `/characters` і `/characters/:id` (`src/pages/CharacterPage.tsx`),
відкрита всім, зокрема гостю. Поки працює лише локальна чернетка
(`/characters/new`, ключ `pvpCharDraft:anon:new` у localStorage). Збереження
в профіль і бали за сети будуть наступним етапом.

## Структура

```
src/doll/
  core/      чисте ядро: формули з calc (0 DOM, 0 fetch, 0 import.meta)
    stats, engine, buffs, summary, damage  — порт calc (змінено лише імпорти)
    constants, types, refdata, derived      — таблиці, типи, довідники, похідні числа
    version.ts  DOLL_ENGINE_VER, CALC_SYNC_COMMIT
    SYNC.md     звідки портовано, свідомі відмінності, sha256 файлів ядра
  data/      дані й активи через Vite
    json/*.json   26 файлів із calc public/assets/data/mypers (1:1)
    sprites/**    fe/<cat>/[m|f/]<cat>-hii.png, yo.png, item-cells.png (1:1 з calc items/)
    catalog.ts    ensureCats / getItem / useCatalog — категорії вантажаться на вимогу
    refLoader.ts  ensureRefData / useRefData — сети, бафи, дебафи, вміння, fustate, labels
    assets.ts     spriteUrl, iconStyle (CSSProperties), buffIconStyle, FIGURE
    version.ts    DOLL_DATA_VER
  model/     документ персонажа (CharacterDoc v2) і чисті операції над ним
    doc.ts        типи, DOC_LIMITS, emptyDoc, validateDoc, docSizeBytes
    hydrate.ts    doc → модель з речами каталогу; effectiveSlots, toDollState, inventoryOf
    ops.ts        doc → новий doc (надіти, зняти, сети, копія при правці зі сету, бафи)
    tipModel.ts   текст тултіпа (порт itemTipHtml без HTML)
    importCalc.ts білд Хелпера (pwDollBuild) → CharacterDoc
    derivedDelta, gemOk, pickerFilter
  ui/        React: DollEditor (каркас), EditorContext, фігура, інвентар,
             tip/ (тултіп-портал), modals/ (пікер, редактор речі, бафи, суперник),
             panels/ (стати, дельти сету, бафи, перевірка урону), три CSS-файли
  api/draft.ts  локальна чернетка (debounce 500 мс, validateDoc при читанні)
```

Шлях даних такий. `CharacterPage` бере документ із чернетки і передає його в
`DollEditor`. Той вантажить довідники й потрібні категорії каталогу, гідрує
документ і роздає `EditorApi` через контекст. Будь-яка зміна проходить через
`api.apply(fn)`, де `fn` — чиста функція з `model/ops.ts`; новий документ
повертається нагору через `onChange`.

## Правила, які стережуть тести

- У `src/doll/**` немає `innerHTML`, `dangerouslySetInnerHTML` і HTML у
  рядках (`__tests__/noInnerHtml.test.ts`). Іконки задаються лише обʼєктами
  стилю, категорія береться лише з білого списку `CATS`.
- Ядро без DOM, fetch і `import.meta` (`core/__tests__/guard.test.ts`).
- Формули збігаються з calc: `core/__tests__/golden.test.ts` (57 ручних і
  100 випадкових білдів), `tip.golden.test.ts` (текст тултіпів). Модель
  проганяє ті самі білди туди й назад через документ
  (`model/__tests__/hydrate.test.ts`).
- Уся сторінка рендериться без винятків: `__tests__/characterPage.smoke.test.tsx`
  (порожня чернетка, типові білди всіх 10 класів, вкладка сету, зламана
  чернетка).
- Маршрути, доступ гостя і пункт «Персонаж» у сайдбарі перевіряє
  `__tests__/routes.test.tsx`.

## Версії

- **`DOLL_ENGINE_VER`** (`core/version.ts`) піднімається при **будь-якій** зміні
  файлів `core/*.ts`: формул, констант, `ADDON_CODES`. Сторож рахує sha256
  кожного файлу (з `\r\n` → `\n`) і звіряє зі списком у `core/SYNC.md`, а
  версію — з рядком `DOLL_ENGINE_VER: N` там само. Крім того, sha256 усього
  блоку має дорівнювати запису `DOLL_ENGINE_HASHES[DOLL_ENGINE_VER]` в
  історії (`core/version.ts`, записи 1..N без пропусків і повторів). Тож
  змінене ядро без нової версії не пройде, навіть якщо вставити новий блок
  у `SYNC.md`. Тест друкує і блок, і готовий запис історії. Історію лише
  дописують.
- **`DOLL_DATA_VER`** (`data/version.ts`) — перші 16 hex sha256 від
  конкатенації `json/*.json` у порядку імен. `data/__tests__/dataVer.test.ts`
  падає, якщо JSON змінили, а версію ні.
- Обидві версії знадобляться для збереження в базу: документ знатиме, проти
  якого ядра й каталогу його рахували.

## Як оновити каталог і спрайти

1. Скопіюй нові файли з pw-calc у ті самі місця:
   `public/assets/data/mypers/*.json` → `src/doll/data/json/`,
   `public/assets/items/fe/**`, `yo.png`, `item-cells.png` → `src/doll/data/sprites/`.
   `fu-states.png` і `figure.svg` не потрібні. Нова категорія — це вже зміна коду
   (`CATS` у `catalog.ts`, `SLOTS` у ядрі), а не лише даних.
2. `npx vite-node scripts/doll-data-ver.ts` оновить `DOLL_DATA_VER`
   (`--check` лише перевіряє).
3. `npx vite-node scripts/doll-addon-codes.ts` оновить білий список кодів ролів
   `ADDON_CODES` у `core/constants.ts`. Якщо список змінився, змінився й хеш
   ядра: онови блок у `SYNC.md`, підніми `DOLL_ENGINE_VER` і допиши запис у
   `DOLL_ENGINE_HASHES`.
4. `npm test`. Якщо впав `golden.test.ts`, змінилися стати речей із фікстур.
   Тоді перегенеруй еталони (нижче) з calc, де лежать ті самі дані.
5. Спрайтам версія не потрібна: Vite дає файлам хеш в імені.

## Як перегенерувати golden-еталони

```
cd D:\pw-pvp
npx vite-node scripts/doll-golden.ts          # PW_CALC_DIR=../pw-calc за замовчуванням
```

Генератор бандлить **незмінений** calc через esbuild, читає JSON із
`../pw-calc/public/assets/data/mypers` і пише в `src/doll/core/__tests__/`:
`fixtures/{manual,random}.json`, `golden/{manual,random,tips}.json`. Він
зупиниться, якщо calc не на коміті `CALC_SYNC_COMMIT` або має локальні зміни
(`--force` це обходить, але так робити не треба). Перезапускай лише свідомо:
коли calc змінив формули і pvp їх підхоплює. Тоді перенеси правку в
`core/`, онови `CALC_SYNC_COMMIT`, підніми `DOLL_ENGINE_VER`, допиши запис у
`DOLL_ENGINE_HASHES` і хеші в `SYNC.md`.

## Збірка й деплой

- Сторінка персонажа — ледачий чанк (`React.lazy` у `Layout.tsx`):
  `assets/index-CharacterPage-<hash>.js` (~136 kB) і `.css` (~47 kB). Головний
  бандл від ляльки виріс лише на ~3 kB: маршрут, пункт меню, обробник помилки
  чанка.
- `vite.config.ts`: `assetsInlineLimit: 0`, головний бандл
  `assets/index-<hash>.js`, чанки й активи — `assets/index-<name>-<hash>.*`.
  Усе потрапляє під immutable-матчер Caddy `/assets/index-*`. JSON і PNG
  ляльки (~9,8 МБ) лежать окремими файлами і вантажаться лише на сторінці
  персонажа. Довідники й `ob/wdf/crystal` вантажаться одразу, решта категорій —
  коли в документі зʼявляється річ цієї категорії.
- `.github/workflows/deploy.yml` перед білдом запускає `npm run typecheck` і
  `npm test`: golden-тести, сторож версії ядра й заборона innerHTML блокують
  деплой. Smoke-тест після викладки бере перший `/assets/index-*.js` з
  `index.html` (`| head -1`).
- Якщо вкладку відкрили до деплою, старих хешованих JSON на сервері вже немає
  (404). Редактор і пікер показують «Сайт оновився — Перезавантажити» замість
  марного «Повторити» (`STALE_DATA_ERROR` у `data/catalog.ts`).
- Якщо вкладку відкрили до деплою, старого чанка на сервері вже немає.
  `LazyPageBoundary` покаже «Сайт оновився — Перезавантажити». Інша помилка
  сторінки дає окреме повідомлення.
- `.gitattributes`: `src/doll/**/*.{ts,tsx,json,css,md}` — `text eol=lf` (без
  цього хеші на Windows і в CI різнилися б); картинки й шрифти — `binary`.
  Правило саме на текстові розширення: `src/doll/**` цілком зіпсувало б
  новий бінарний файл (webp, шрифт).

## Чернетка й ліміти

- `validateDoc` ділить порушення на жорсткі (зламана форма, посилання в нікуди)
  і мʼякі (ліміти 100 речей / 400 рядків ролів / 5 сетів / 32 КБ, бюджет
  атрибутів рівня, атрибут нижче 5, величина чисел, символи в назвах). З мʼякими
  документ повертається як `recoverable`: чернетка відкривається з
  попередженням, а збереження в профіль (наступний етап) його не прийме.
- Операції (`model/ops.ts`) самі не виводять документ за ліміти: копія, авто-копія
  при правці спільної речі з сету, «Замінити базу» повертають `blocked`
  ('items' | 'rolls'), а UI показує `LIMIT_TEXT`.
- Зламана чернетка відкладається в `pvpCharDraft:anon:new:broken` (плюс `:2`,
  `:3` — три останні копії). Друга вкладка, що записала ту саму чернетку,
  зупиняє запис тут до вибору «Відкрити новішу / Лишити цю».

## Команди

```
npm run typecheck
npm test                 # vitest run; лялька — src/doll/**/__tests__
npm run build
```
