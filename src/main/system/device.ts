import { createHash, randomBytes } from 'node:crypto';
import os from 'node:os';

import { regQuery } from './run';

// MachineGuid survives reinstalling the app, so the device keeps its slot of the device limit.
export async function deviceId(stored: string | undefined): Promise<string> {
  const guid = await regQuery('HKLM\\SOFTWARE\\Microsoft\\Cryptography', 'MachineGuid');
  if (guid) return createHash('sha256').update(`dt-client:${guid.toLowerCase()}`).digest('hex').slice(0, 32);
  return stored || randomBytes(16).toString('hex');
}

export function deviceName(): string {
  return os.hostname();
}
