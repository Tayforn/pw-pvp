// Перерахувати DOLL_DATA_VER після зміни src/doll/data/json/*.json і записати
// у src/doll/data/version.ts. Запуск: npx vite-node scripts/doll-data-ver.ts
// (лише перевірити, без запису: --check). Формула: sha256 від конкатенації
// json у порядку імен (\r\n → \n), перші 16 hex — та сама, що в
// src/doll/data/__tests__/dataVer.test.ts.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JSON_DIR = join(ROOT, 'src', 'doll', 'data', 'json');
const VERSION_TS = join(ROOT, 'src', 'doll', 'data', 'version.ts');

function dataVer(): string {
  const names = readdirSync(JSON_DIR).filter((f) => f.endsWith('.json')).sort();
  const h = createHash('sha256');
  for (const n of names) h.update(readFileSync(join(JSON_DIR, n), 'utf8').replace(/\r\n/g, '\n'));
  return h.digest('hex').slice(0, 16);
}

const next = dataVer();
const src = readFileSync(VERSION_TS, 'utf8');
const m = /export const DOLL_DATA_VER = '([0-9a-f]{16})';/.exec(src);
if (!m) {
  console.error('version.ts: не знайшов рядок DOLL_DATA_VER');
  process.exit(2);
}
const cur = m[1];
if (cur === next) {
  console.log('DOLL_DATA_VER актуальна: ' + cur);
} else if (process.argv.includes('--check')) {
  console.error('DOLL_DATA_VER застаріла: у файлі ' + cur + ', за даними ' + next);
  process.exit(1);
} else {
  writeFileSync(VERSION_TS, src.replace(m[0], "export const DOLL_DATA_VER = '" + next + "';"));
  console.log('DOLL_DATA_VER: ' + cur + ' → ' + next);
}
