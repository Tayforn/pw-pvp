import { createRoot } from 'react-dom/client';
import Layout from './components/Layout';
import { loadRulesFromDb } from './data/rulesStore';
import { restoreLoginReturn } from './app/useMe';

// Версії шкали балів фул-рандому — стартуємо завантаження одразу, щоб на
// сторінках зі скорами не було миті з вбудованою версією замість поточної.
void loadRulesFromDb();

// Після входу через Discord бекенд веде на головну — повертаємо на сторінку,
// з якої входили (до першого рендеру, щоб роутер одразу прочитав її).
restoreLoginReturn();

createRoot(document.getElementById('root')!).render(<Layout />);
