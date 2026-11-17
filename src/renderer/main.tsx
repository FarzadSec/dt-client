import { createRoot } from 'react-dom/client';

import 'flag-icons/css/flag-icons.min.css';
import './styles/app.css';
import { App } from './App';

createRoot(document.getElementById('root') as HTMLElement).render(<App />);
