import { run } from './run';

const taskName = 'DT Client';

// The app runs as administrator, which a Run key cannot start without a UAC prompt; a task can.
export async function setAutostart(enabled: boolean, exePath: string): Promise<void> {
  if (enabled) {
    await run('schtasks.exe', ['/Create', '/F', '/TN', taskName, '/SC', 'ONLOGON', '/RL', 'HIGHEST', '/TR', `"${exePath}" --hidden`]);
  } else {
    await run('schtasks.exe', ['/Delete', '/F', '/TN', taskName]);
  }
}
