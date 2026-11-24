import fs from 'node:fs';

import { enabledServices } from './macDns';
import { run } from './run';

// OpenVPN and L2TP tunnels from the panel carry IPv4 only. A computer with IPv6 of its own would send
// everything IPv6 (Google, YouTube, Cloudflare sites…) around the tunnel, from its real address. While
// such a tunnel is up, the app keeps global IPv6 from leaving, so programs fall back to IPv4, which the
// tunnel carries; local IPv6 (the computer itself, the LAN) is left alone. Each change is undone on
// disconnect, and at the next start after a crash.

// Windows: an outbound firewall rule for global unicast IPv6 (2000::/3).
export const windowsRule = 'DT Connect - no IPv6 outside the tunnel';

export async function blockIpv6Windows(): Promise<boolean> {
  await run('netsh.exe', ['advfirewall', 'firewall', 'delete', 'rule', `name=${windowsRule}`]);
  const res = await run('netsh.exe', ['advfirewall', 'firewall', 'add', 'rule', `name=${windowsRule}`, 'dir=out', 'action=block', 'remoteip=2000::/3', 'profile=any', 'enable=yes']);
  return res.code === 0;
}

export async function restoreIpv6Windows(): Promise<boolean> {
  const res = await run('netsh.exe', ['advfirewall', 'firewall', 'delete', 'rule', `name=${windowsRule}`]);
  return res.code === 0;
}

// Linux: an unreachable route for 2000::/3, more specific than any default route, so connections to
// global IPv6 fail at once instead of leaving. Marked with its own protocol number to find it again.
const linuxProto = '77';

export async function blockIpv6Linux(): Promise<boolean> {
  await run('ip', ['-6', 'route', 'del', 'unreachable', '2000::/3', 'proto', linuxProto]);
  const res = await run('ip', ['-6', 'route', 'add', 'unreachable', '2000::/3', 'metric', '1', 'proto', linuxProto]);
  return res.code === 0;
}

export async function restoreIpv6Linux(): Promise<boolean> {
  const res = await run('ip', ['-6', 'route', 'del', 'unreachable', '2000::/3', 'proto', linuxProto]);
  return res.code === 0;
}

// macOS: IPv6 off on every enabled network service, as Tunnelblick's "Disable IPv6" does; each one's
// setting (Automatic or link-local) is kept in backupFile and put back. Manually set ones are left alone.
const networksetup = '/usr/sbin/networksetup';

export function ipv6Mode(info: string): 'automatic' | 'linklocal' | 'off' | 'manual' | null {
  const m = /^IPv6:\s*(.+)$/im.exec(info)?.[1].trim().toLowerCase();
  if (!m) return null;
  if (m.startsWith('automatic')) return 'automatic';
  if (m.startsWith('link')) return 'linklocal';
  if (m.startsWith('off')) return 'off';
  return 'manual';
}

export async function blockIpv6Mac(backupFile: string): Promise<boolean> {
  const services = enabledServices((await run(networksetup, ['-listallnetworkservices'])).stdout);
  let backup: Record<string, string> = {};
  try {
    backup = JSON.parse(fs.readFileSync(backupFile, 'utf8')) as Record<string, string>;
  } catch {
    backup = {};
  }
  const toTurnOff: string[] = [];
  for (const service of services) {
    const mode = ipv6Mode((await run(networksetup, ['-getinfo', service])).stdout);
    if (mode === 'automatic' || mode === 'linklocal') {
      if (!(service in backup)) backup[service] = mode;
      toTurnOff.push(service);
    }
  }
  fs.writeFileSync(backupFile, JSON.stringify(backup), { mode: 0o600 });
  let ok = true;
  for (const service of toTurnOff) ok = (await run(networksetup, ['-setv6off', service])).code === 0 && ok;
  return ok;
}

export async function restoreIpv6Mac(backupFile: string): Promise<boolean> {
  let backup: Record<string, string>;
  try {
    backup = JSON.parse(fs.readFileSync(backupFile, 'utf8')) as Record<string, string>;
  } catch {
    return false;
  }
  for (const [service, mode] of Object.entries(backup)) {
    await run(networksetup, [mode === 'linklocal' ? '-setv6LinkLocal' : '-setv6automatic', service]);
  }
  fs.rmSync(backupFile, { force: true });
  return true;
}
