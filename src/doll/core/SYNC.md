# Ядро ляльки — синхронізація з pw-calc

Портовано з pw-calc («PW Хелпер»), коміт `e0a79ed` (`CALC_SYNC_COMMIT` у `version.ts`).
Відтоді джерело істини для формул — цей каталог; калькулятор далі не правиться.
Доказ «формули ті самі» — `__tests__/golden.test.ts`: 57 ручних + 100 випадкових
білдів, еталони яких згенеровано з незміненого calc (`scripts/doll-golden.ts`).

## Звідки що

| pvp | calc | що змінено |
| --- | --- | --- |
| `types.ts` | `src/lib/doll/types.ts` + інтерфейси з `src/modules/doll/data.ts` | без `SavedBuild`/`EditorTarget` (інтерфейс Хелпера); додано `DmgLogEntry` |
| `constants.ts` | `src/modules/doll/data.ts` | без fetch-завантажувачів, `ASSET_BASE`, `iconStyle`/`buffIconStyle` (→ `data/assets.ts`), мертвих `STAT_GROUPS`/`BUFFS`; `buffDesc`/`lbl` читають довідники через `refdata.ts`; додано `ADDON_CODES` (генерує `scripts/doll-addon-codes.ts`) |
| `refdata.ts` | нове | `setRefData` + геттери з іменами calc замість fetch-сінглтонів `data.ts` |
| `stats.ts` | `src/lib/doll/stats.ts` | лише імпорти |
| `engine.ts` | `src/modules/doll/engine.ts` | лише імпорт |
| `buffs.ts` | `src/lib/doll/buffs.ts` | імпорти; прибрано `buffTipHtml` |
| `summary.ts` | `src/lib/doll/summary.ts` | лише імпорт |
| `damage.ts` | `src/lib/doll/damage.ts` | імпорти; прибрано `dmgLogLine`; реекспорт типу `DmgLogEntry` |
| `derived.ts` | нове | вибірка похідних чисел (ПА/ПЗ/спів/aps/HP/захисти/атаки) з `t` і рушія |

## Свідомі відмінності від calc

- Ядро нічого не вантажить: довідники (сети, стани, вміння, fustate, labels) дає
  `setRefData`; без них `getSets()` тощо повертають `null` — так само, як у calc
  до завантаження.
- Жодних HTML-рядків, DOM, `fetch`, `import.meta`, іконок — тултіпи й лог урону
  збираються поза ядром (`model/tipModel.ts`, панелі).
- `Item`, `SetDef`, `BuffDef`, `SkillDef`, `SlotDef` живуть у `types.ts`, а не в
  модулі даних.
- `derivedNumbers` приймає необовʼязковий третій аргумент `t` (готові тотали), щоб
  не рахувати `computeStats` двічі.
- `DollState.backpack` лишено (у pvp завжди `[]`), щоб `toDollState` та імпорт з
  Хелпера не потребували окремого типу.

## Знак станів співу

`summary.ts` і `derived.ts` рахують «Час співу» як `ci − re + xj` — так само, як calc.
Це правильно (підтвердив власник 25.09.2026): показник означає, наскільки
скорочується час касту, тож стани, що пришвидшують підготовку, дають відʼємний внесок.
Не «виправляти».

## Як оновлювати

- Змінили формулу чи константу → підняти `DOLL_ENGINE_VER` у `version.ts`,
  дописати запис у `DOLL_ENGINE_HASHES` (старі записи не чіпати), оновити блок
  хешів нижче (`guard.test.ts` друкує і блок, і готовий запис історії) і, якщо
  зміна навмисно розходиться з calc, перегенерувати еталони.
- Калькулятор змінив формули, і pvp має їх підхопити → перенести правку сюди,
  оновити `CALC_SYNC_COMMIT`, запустити `npx vite-node scripts/doll-golden.ts`
  (він відмовиться працювати, якщо `../pw-calc` не на тому коміті або має
  локальні зміни), підняти `DOLL_ENGINE_VER`, оновити хеші.
- Змінилися каталоги (`src/doll/data/json`) → `npx vite-node scripts/doll-addon-codes.ts`
  (білий список кодів ролів) і, якщо стати речей із фікстур змінилися,
  перегенерувати еталони.

## Хеші файлів ядра

sha256 вмісту після нормалізації `\r\n → \n`; `version.ts` у список не входить.
Звіряє `__tests__/guard.test.ts`; sha256 самого блоку (рядки нижче через `\n`)
записано в `DOLL_ENGINE_HASHES[DOLL_ENGINE_VER]`.

DOLL_ENGINE_VER: 1

- buffs.ts: 9b55c1bf1feb4003acb0bb385d503ea54c40f910e310949cd62ccf93ef8bfcc2
- constants.ts: af1687a9961e37cd6c377312408c0289d7772f25a703e6ff233a98db59699a2e
- damage.ts: ebdc45032b564d0f1745d2801331ff51d0fc4e27b790c4502316422a06442c80
- derived.ts: 75e218fe9c812befc3979bce7bba1825c176bc393bd724f614476fbd2ed9ce59
- engine.ts: 91e33ecc12f4fb54a199f3297801d98512a21d1d2bfeed17a5268d9666fdb4fc
- refdata.ts: 30213e41e22755fd580f1b087cfe4149af2d7f70cd329afce79f999553eee251
- stats.ts: 4d2e72540e7aae7dfbfe00819a86129989c5979516805286985f60eb54558790
- summary.ts: 4482bbe41cfaf8df798a9c06574456eaf362ed44b869ddb3fdc6be7cb97f9c97
- types.ts: da453b4f70ea82008679358368055b9be501a371e8dc9701f8cbaa5e8ed8371c
