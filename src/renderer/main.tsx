import { createRoot } from 'react-dom/client';

import '@fontsource-variable/inter';
import '@fontsource-variable/vazirmatn';
import 'flag-icons/css/flag-icons.min.css';
import './styles/app.css';
import { useOs } from '../shared/engines';
import { App } from './App';

useOs(window.dt.os);
// The window's own errors go to the app's log, for a support report.
window.addEventListener('error', (e) => window.dt.log(`${e.message} at ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => window.dt.log(`unhandled: ${e.reason instanceof Error ? (e.reason.stack ?? e.reason.message) : String(e.reason)}`));
document.documentElement.dataset.os = window.dt.os;

createRoot(document.getElementById('root') as HTMLElement).render(<App />);
