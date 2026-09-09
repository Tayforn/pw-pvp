import { createRoot } from 'react-dom/client';
import Layout from './components/Layout';
import { loadRulesFromDb } from './data/rulesStore';

// Версії шкали балів фул-рандому — стартуємо завантаження одразу, щоб на
// сторінках зі скорами не було миті з вбудованою версією замість поточної.
void loadRulesFromDb();

createRoot(document.getElementById('root')!).render(<Layout />);
