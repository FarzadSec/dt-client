import { createRoot } from 'react-dom/client';

import '@fontsource-variable/inter';
import '@fontsource-variable/vazirmatn';
import 'flag-icons/css/flag-icons.min.css';
import './styles/app.css';
import { useOs } from '../shared/engines';
import { App } from './App';

useOs(window.dt.os);
document.documentElement.dataset.os = window.dt.os;

createRoot(document.getElementById('root') as HTMLElement).render(<App />);
