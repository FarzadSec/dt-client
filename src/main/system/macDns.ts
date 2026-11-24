import fs from 'node:fs';
import net from 'node:net';

import { run } from './run';

// macOS asks the resolvers of the network it is on, usually the router. The router sits on the
// local network, which the tunnel's routes leave alone, so names were answered outside the tunnel:
// by the ISP, filtered ones with its filter's private addresses (10.10.34.x), which then also went
// direct. Telegram, which dials its servers by address, worked; browsers did not. While connected,
// every network service's resolvers are set to public ones, which the tunnel carries (sing-box
// answers them through the proxy; OpenVPN sends them to the server).

const networksetup = '/usr/sbin/networksetup';

// Service name → the resolvers set on it before the app changed them (none: those of the network).
export type DnsBackup = Record<string, string[]>;

// `networksetup -listallnetworkservices`: a note, then one service per line, "*" before a disabled one.
export function enabledServices(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('*') && !/^An asterisk/i.test(l));
}

// `networksetup -getdnsservers <service>`: one address per line, or a sentence when none are set.
export function dnsOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => net.isIP(l) !== 0);
}

export function readBackup(file: string): DnsBackup | null {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const backup: DnsBackup = {};
  for (const [service, list] of Object.entries(raw)) {
    if (Array.isArray(list)) backup[service] = list.filter((d): d is string => typeof d === 'string' && net.isIP(d) !== 0);
  }
  return backup;
}

// Cached answers, the ISP's included, go too.
async function flush(): Promise<void> {
  await run('/usr/bin/dscacheutil', ['-flushcache']);
  await run('/usr/bin/killall', ['-HUP', 'mDNSResponder']);
}

// Points every enabled service at the resolvers. What each had is kept in backupFile first, so a
// restore after a crash or a power cut still knows it; a backup already there is the original and stays.
export async function applyDns(servers: string[], backupFile: string): Promise<string[]> {
  const services = enabledServices((await run(networksetup, ['-listallnetworkservices'])).stdout);
  const backup = readBackup(backupFile) ?? {};
  for (const service of services) {
    if (!(service in backup)) backup[service] = dnsOf((await run(networksetup, ['-getdnsservers', service])).stdout);
  }
  fs.writeFileSync(backupFile, JSON.stringify(backup), { mode: 0o600 });
  const changed: string[] = [];
  for (const service of services) {
    if ((await run(networksetup, ['-setdnsservers', service, ...servers])).code === 0) changed.push(service);
  }
  await flush();
  return changed;
}

// Puts back what applyDns found; nothing when there is no backup.
export async function restoreDns(backupFile: string): Promise<boolean> {
  const backup = readBackup(backupFile);
  if (!backup) {
    fs.rmSync(backupFile, { force: true });
    return false;
  }
  for (const [service, list] of Object.entries(backup)) {
    await run(networksetup, ['-setdnsservers', service, ...(list.length > 0 ? list : ['Empty'])]);
  }
  fs.rmSync(backupFile, { force: true });
  await flush();
  return true;
}
