import { createRoot } from 'react-dom/client';
import Layout from './components/Layout';
import { loadRulesFromDb } from './data/rulesStore';
import { restoreLoginReturn } from './app/useMe';
import { loadCatalogFromDb } from './data/catalogStore';

// Версії шкали балів фул-рандому — стартуємо завантаження одразу, щоб на
// сторінках зі скорами не було миті з вбудованою версією замість поточної.
void loadRulesFromDb();
// Довідник рядків правил (0027) — так само одразу: попап «Правила…» і сторінка
// «Правила» мають показувати довідник, а не вбудований фолбек.
void loadCatalogFromDb();

// Після входу через Discord бекенд веде на головну — повертаємо на сторінку,
// з якої входили (до першого рендеру, щоб роутер одразу прочитав її).
restoreLoginReturn();

createRoot(document.getElementById('root')!).render(<Layout />);
