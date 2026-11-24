import fs from 'node:fs';

import { siteName } from '../../shared/sites';

// Locked sites while the VPN is off: names in the system's hosts file pointing at a local address, so
// browsers cannot open them from the real connection. The app's lines sit between its own markers and
// are all that it ever adds or removes.

const begin = '# DT Connect lock: begin (removed when the VPN connects)';
const end = '# DT Connect lock: end';

export const hostsFile = process.platform === 'win32' ? `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\drivers\\etc\\hosts` : '/etc/hosts';

// The common names under a site that its pages and apps use.
const prefixes = ['', 'www.', 'm.', 'mobile.', 'web.', 'app.', 'api.', 'accounts.', 'login.', 'auth.'];

export function lockLines(sites: string[], address: string): string[] {
  const names = new Set<string>();
  for (const raw of sites) {
    const site = siteName(raw);
    if (site) for (const p of prefixes) names.add(`${p}${site}`);
  }
  if (names.size === 0) return [];
  const lines = [begin];
  for (const name of names) lines.push(`${address} ${name}`, `::1 ${name}`);
  lines.push(end);
  return lines;
}

// The file without the app's block (a block cut short by a crash is removed to its end).
export function withoutLock(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (line.trim() === begin) {
      inside = true;
      continue;
    }
    if (inside) {
      if (line.trim() === end) inside = false;
      continue;
    }
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

export function withLock(text: string, sites: string[], address: string): string {
  const base = withoutLock(text);
  const block = lockLines(sites, address);
  return block.length === 0 ? `${base}\n` : `${base}\n\n${block.join('\n')}\n`;
}

// Writes the hosts file only when it changes; Windows keeps its CRLF line ends.
export function applyHostsLock(sites: string[], address: string, file = hostsFile): boolean {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  if (lockLines(sites, address).length === 0 && !text.includes(begin)) return true;
  const next = withLock(text, sites, address);
  const crlf = text.includes('\r\n');
  const out = crlf ? next.replace(/\r?\n/g, '\r\n') : next;
  if (out === text) return true;
  try {
    fs.writeFileSync(file, out);
    return true;
  } catch {
    return false;
  }
}
