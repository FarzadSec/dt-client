import fs from 'node:fs';
import path from 'node:path';

import { l2tpConnectionName, type L2tpAccount } from '../configs/l2tp';
import { blockIpv6Linux, restoreIpv6Linux } from '../system/ipv6';
import { run } from '../system/run';
import type { LogFn } from '../log';
import type { SystemKit } from './kit';

export const linuxTun = 'dtconnect0';
export const linuxOpenvpnTun = 'dtvpn0';

// nmcli splits vpn.data and vpn.secrets on commas, so a value may hold neither one nor a line break.
const plain = /^[^,\r\n]+$/;

export function nmcliAddArgs(account: L2tpAccount): string[] | null {
  if (![account.host, account.username, account.password, account.psk].every((v) => plain.test(v))) return null;
  const data = [
    `gateway=${account.host}`,
    `user=${account.username}`,
    'password-flags=0',
    'ipsec-enabled=yes',
    'ipsec-psk-flags=0',
    'refuse-eap=yes',
    'refuse-pap=yes',
    'refuse-chap=yes',
    'refuse-mschap=yes',
  ];
  return [
    'connection', 'add', 'type', 'vpn', 'con-name', l2tpConnectionName, 'ifname', '--', 'vpn-type', 'l2tp',
    'connection.autoconnect', 'no',
    'vpn.data', data.join(', '),
    'vpn.secrets', `password=${account.password}, ipsec-psk=${account.psk}`,
  ];
}

// NetworkManager with its l2tp plugin (network-manager-l2tp / NetworkManager-l2tp) does the connecting.
const l2tp = {
  async connect(account: L2tpAccount, log?: LogFn) {
    const args = nmcliAddArgs(account);
    if (!args) {
      log?.('l2tp', 'the account has a comma or a line break, which NetworkManager cannot take');
      return { ok: false };
    }
    await run('nmcli', ['connection', 'delete', 'id', l2tpConnectionName]);
    const added = await run('nmcli', args);
    if (added.code !== 0) {
      log?.('l2tp', `nmcli add exit ${added.code}: ${added.stderr.trim().slice(0, 600)}`);
      return { ok: false, notice: /l2tp|plugin|vpn-type/i.test(added.stderr) ? 'l2tp_plugin_missing' : undefined };
    }
    const up = await run('nmcli', ['connection', 'up', 'id', l2tpConnectionName], 90_000);
    log?.('l2tp', `nmcli up exit ${up.code}: ${(up.stdout + up.stderr).replace(/\s+/g, ' ').trim().slice(0, 600)}`);
    return { ok: up.code === 0 };
  },
  async isUp() {
    return (await run('nmcli', ['-t', '-f', 'NAME', 'connection', 'show', '--active'])).stdout.split('\n').includes(l2tpConnectionName);
  },
  async disconnect() {
    await run('nmcli', ['connection', 'down', 'id', l2tpConnectionName]);
  },
  // The PPP link L2TP runs over, from the kernel's counters.
  async counters() {
    return pppCounters(await fs.promises.readFile('/proc/net/dev', 'utf8').catch(() => ''));
  },
};

// /proc/net/dev: "ppp0: rx_bytes rx_packets … tx_bytes …" (the 9th number is tx_bytes).
export function pppCounters(text: string): { rx: number; tx: number } | null {
  let rx = 0;
  let tx = 0;
  let any = false;
  for (const line of text.split('\n')) {
    const m = /^\s*(ppp\d+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const f = m[2].trim().split(/\s+/).map(Number);
    if (f.length < 9 || !f.every(Number.isFinite)) continue;
    rx += f[0];
    tx += f[8];
    any = true;
  }
  return any ? { rx, tx } : null;
}

// Chromium browsers read managed policies from these folders on Linux.
const policyDirs = ['/etc/opt/chrome/policies/managed', '/etc/chromium/policies/managed', '/etc/opt/edge/policies/managed', '/etc/brave/policies/managed'];
const policyFile = 'dt-connect-webrtc.json';

export const linuxKit: SystemKit = {
  os: 'linux',
  exe: (name) => name,
  openvpnBinary() {
    return ['/usr/sbin/openvpn', '/usr/bin/openvpn', '/sbin/openvpn'].find((p) => fs.existsSync(p)) ?? null;
  },
  async openvpnUp(dns) {
    // systemd-resolved, when present, sends every name to the tunnel's resolvers.
    if ((await run('resolvectl', ['dns', linuxOpenvpnTun, ...dns])).code === 0) await run('resolvectl', ['domain', linuxOpenvpnTun, '~.']);
  },
  l2tp,
  blockIpv6: () => blockIpv6Linux(),
  restoreIpv6: () => restoreIpv6Linux(),
  async applyZone(iana) {
    const current = (await run('timedatectl', ['show', '-p', 'Timezone', '--value'])).stdout.trim();
    if (!current || current === iana) return null;
    return (await run('timedatectl', ['set-timezone', iana])).code === 0 ? current : null;
  },
  async restoreZone(previous) {
    if (previous) await run('timedatectl', ['set-timezone', previous]);
  },
  async protectWebrtc() {
    const backup: Record<string, string | null> = {};
    for (const dir of policyDirs) {
      const file = path.join(dir, policyFile);
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ WebRtcIPHandling: 'disable_non_proxied_udp' }), { mode: 0o644 });
        backup[file] = null;
      } catch {
        // A browser folder that cannot be written is left alone.
      }
    }
    return backup;
  },
  async restoreWebrtc(backup) {
    for (const file of Object.keys(backup)) fs.rmSync(file, { force: true });
  },
  tunName: linuxTun,
};
