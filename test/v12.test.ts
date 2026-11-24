import { describe, expect, it } from 'vitest';

import { subscriptionAccounts } from '../src/main/api';
import { matchesApp, sniOf } from '../src/main/guard';
import { ikeProbePacket, l2tpProbePacket, openvpnProbeTarget, staticKey, tlsCryptWrap } from '../src/main/handshake';
import { LiveMonitor } from '../src/main/live';
import { pppCounters } from '../src/main/os/linux';
import { wireguardLocations } from '../src/main/pinger';
import { lockLines, withLock, withoutLock } from '../src/main/system/hosts';
import { ipv6Mode } from '../src/main/system/ipv6';
import { siteName } from '../src/shared/sites';
import type { AppProfile } from '../src/shared/types';
import { planWarnings, trafficWarnBytes, warningKey } from '../src/shared/warnings';

const key = `-----BEGIN OpenVPN Static key V1-----\n${Array.from({ length: 16 }, (_, i) => i.toString(16).padStart(2, '0').repeat(16)).join('\n')}\n-----END OpenVPN Static key V1-----`;

describe('sign-in with the link alone', () => {
  it("reads the subscription's accounts from its information page", async () => {
    let asked = '';
    const fetchImpl = (async (url: string) => {
      asked = url;
      return new Response(JSON.stringify({ emails: ['dana', 'dana', ''], traffic: 1 }), { status: 200 });
    }) as typeof fetch;
    expect(await subscriptionAccounts('https://s.example.com/sub/abc?x=1#me', 'ua', fetchImpl)).toEqual(['dana']);
    expect(asked).toBe('https://s.example.com/sub/abc?x=1&format=info');
  });

  it('says when the link has no account, or is not a subscription', async () => {
    const none = (async () => new Response(JSON.stringify({ emails: [] }), { status: 200 })) as typeof fetch;
    await expect(subscriptionAccounts('https://s/sub/a', 'ua', none)).rejects.toMatchObject({ code: 'no_account' });
    const missing = (async () => new Response('nope', { status: 404 })) as typeof fetch;
    await expect(subscriptionAccounts('https://s/sub/a', 'ua', missing)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('plan warnings', () => {
  const account = { username: 'u', enabled: true, expiryTime: 0, upload: 0, download: 0, total: 0, deviceLimit: 0, devices: 0 };
  const now = Date.UTC(2026, 10, 25);
  it('warns two days before the end and at 3 GB left', () => {
    expect(planWarnings({ ...account, expiryTime: now + 3 * 86_400_000 }, now)).toEqual([]);
    expect(planWarnings({ ...account, expiryTime: now + 47 * 3_600_000 }, now)).toEqual([{ kind: 'expiry', ended: false, left: 47 * 3_600_000 }]);
    expect(planWarnings({ ...account, expiryTime: now - 1 }, now)[0]).toMatchObject({ kind: 'expiry', ended: true });
    const total = 50 * 1024 ** 3;
    expect(planWarnings({ ...account, total, download: total - trafficWarnBytes - 1 }, now)).toEqual([]);
    expect(planWarnings({ ...account, total, download: total - trafficWarnBytes }, now)[0]).toMatchObject({ kind: 'traffic', ended: false });
    expect(planWarnings({ ...account, total, upload: total }, now)[0]).toMatchObject({ kind: 'traffic', ended: true, left: 0 });
  });
  it('leaves plans without an end or a cap alone', () => {
    expect(planWarnings({ ...account, expiryTime: -86_400_000 }, now)).toEqual([]);
    expect(warningKey([])).toBe('');
  });
});

describe('handshake probes', () => {
  it('reads the static key', () => {
    expect(staticKey(key)?.length).toBe(256);
    expect(staticKey('nothing')).toBeNull();
  });

  it('wraps the first OpenVPN message as tls-crypt does', () => {
    const sid = Buffer.alloc(8, 7);
    const packet = tlsCryptWrap(staticKey(key)!, 7, sid, 1_700_000_000_000);
    // opcode+sid (9), packet id and time (8), tag (32), encrypted ack array and message id (5)
    expect(packet.length).toBe(54);
    expect(packet[0]).toBe(7 << 3);
    expect(packet.subarray(1, 9)).toEqual(sid);
    expect(packet.readUInt32BE(9)).toBe(1);
  });

  it('builds the probe from the profile', () => {
    const udp = openvpnProbeTarget(`client\nremote vpn.example.com 1194\n<tls-crypt>\n${key}\n</tls-crypt>\n`)!;
    expect(udp).toMatchObject({ host: 'vpn.example.com', port: 1194, udp: true });
    expect(udp.packet.length).toBe(54);
    const tcp = openvpnProbeTarget(`client\nproto tcp-client\nremote 1.2.3.4 443\nauth SHA256\nkey-direction 1\n<tls-auth>\n${key}\n</tls-auth>\n`)!;
    expect(tcp).toMatchObject({ host: '1.2.3.4', port: 443, udp: false });
    // opcode+sid (9), HMAC-SHA256 (32), packet id and time (8), ack array and message id (5)
    expect(tcp.packet.length).toBe(54);
    const plain = openvpnProbeTarget('client\nremote 1.2.3.4 1194 tcp\n')!;
    expect(plain.packet.length).toBe(14);
    expect(openvpnProbeTarget('client\n')).toBeNull();
  });

  it('offers IKEv1 main mode to an IPsec server', () => {
    const p = ikeProbePacket(Buffer.alloc(8, 1));
    expect(p.readUInt32BE(24)).toBe(p.length);
    expect([p[16], p[17], p[18]]).toEqual([1, 0x10, 2]);
    expect(p.subarray(8, 16)).toEqual(Buffer.alloc(8));
  });

  it('asks an L2TP server to start a control connection', () => {
    const p = l2tpProbePacket(4242);
    expect(p.readUInt16BE(0)).toBe(0xc802);
    expect(p.readUInt16BE(2)).toBe(p.length);
    // Message type AVP first: SCCRQ (1)
    expect(p.readUInt16BE(12 + 6)).toBe(1);
  });

  it('frees the WireGuard seats the test touched', () => {
    const profile = { configs: [
      { protocol: 'wireguard', name: 'a', link: 'wg-a', locationId: 1 },
      { protocol: 'wireguard', name: 'b', link: 'wg-b', locationId: 2 },
      { protocol: 'vless', name: 'c', link: 'v', locationId: 3 },
    ] } as AppProfile;
    expect(wireguardLocations(profile, [{ link: 'wg-a', ms: 10 }, { link: 'v', ms: 5 }])).toEqual([1]);
  });
});

describe('the live monitor', () => {
  it('reports rates and says when traffic stops, then when it passes again', async () => {
    let rx = 0;
    const answers = [true, false, false, false, true];
    const events: string[] = [];
    const samples: { rx: number; ms?: number | null }[] = [];
    const monitor = new LiveMonitor({
      counters: async () => ({ rx: (rx += 1000), tx: 0 }),
      onSample: (s) => samples.push(s),
      onStall: () => events.push('stall'),
      onRecover: () => events.push('recover'),
      probe: { measure: async () => ((answers.shift() ?? true) ? { ok: true, ms: 40 } : { ok: false, ms: null }), close: () => undefined },
      tickMs: 5,
      probeEvery: 1,
    });
    monitor.start();
    await new Promise((r) => setTimeout(r, 120));
    monitor.stop();
    expect(events).toEqual(['stall', 'recover']);
    expect(samples.some((s) => s.ms === 40)).toBe(true);
    expect(samples.some((s) => s.ms === null)).toBe(true);
    expect(samples.slice(2).every((s) => s.rx > 0)).toBe(true);
  });

  it('does not call it a stall while downloads keep coming in', async () => {
    let rx = 0;
    const events: string[] = [];
    const monitor = new LiveMonitor({
      counters: async () => ({ rx: (rx += 100_000), tx: 0 }),
      onSample: () => undefined,
      onStall: () => events.push('stall'),
      onRecover: () => events.push('recover'),
      probe: { measure: async () => ({ ok: false, ms: null }), close: () => undefined },
      tickMs: 5,
      probeEvery: 1,
    });
    monitor.start();
    await new Promise((r) => setTimeout(r, 80));
    monitor.stop();
    expect(events).toEqual([]);
  });
});

describe('the lock', () => {
  it('reads site names the way users type them', () => {
    expect(siteName(' https://www.Binance.com/en/login ')).toBe('binance.com');
    expect(siteName('*.chatgpt.com')).toBe('chatgpt.com');
    expect(siteName('localhost')).toBeNull();
    expect(siteName('1.2.3.4')).toBeNull();
    expect(siteName('bad_name.com')).toBeNull();
  });

  it('adds and removes only its own block in the hosts file', () => {
    const original = '127.0.0.1 localhost\n::1 localhost\n';
    const locked = withLock(original, ['binance.com'], '127.77.7.7');
    expect(locked).toContain('127.77.7.7 www.binance.com');
    expect(locked).toContain('::1 binance.com');
    expect(locked.startsWith(original)).toBe(true);
    expect(withoutLock(locked)).toBe(original.trimEnd());
    expect(withLock(locked, [], '127.77.7.7')).toBe(original);
    expect(lockLines(['not a site'], '0.0.0.0')).toEqual([]);
  });

  it('reads the server name of a TLS hello', () => {
    // A minimal ClientHello for example.com.
    const name = Buffer.from('example.com');
    const sniExt = Buffer.concat([Buffer.from([0, 0]), u16(name.length + 5), u16(name.length + 3), Buffer.from([0]), u16(name.length), name]);
    const body = Buffer.concat([Buffer.from([3, 3]), Buffer.alloc(32), Buffer.from([0]), u16(2), Buffer.from([0x13, 0x01]), Buffer.from([1, 0]), u16(sniExt.length), sniExt]);
    const hs = Buffer.concat([Buffer.from([1, 0, body.length >> 8, body.length & 255]), body]);
    const record = Buffer.concat([Buffer.from([0x16, 3, 1]), u16(hs.length), hs]);
    expect(sniOf(record)).toBe('example.com');
    expect(sniOf(Buffer.from('GET / HTTP/1.1\r\n'))).toBeNull();
  });

  it('finds a locked app among the running processes', () => {
    expect(matchesApp('windows', { name: 'telegram.exe', path: 'C:\\T\\Telegram.exe' }, { pid: 1, path: 'Telegram.exe' })).toBe(true);
    expect(matchesApp('macos', { name: 'Telegram', path: '/Applications/Telegram.app' }, { pid: 1, path: '/Applications/Telegram.app/Contents/MacOS/Telegram' })).toBe(true);
    expect(matchesApp('macos', { name: 'Telegram', path: '/Applications/Telegram.app' }, { pid: 1, path: '/Applications/Telegram Lite.app/Contents/MacOS/x' })).toBe(false);
    expect(matchesApp('linux', { name: 'telegram-desktop', path: '/usr/bin/telegram-desktop' }, { pid: 1, path: 'telegram-desktop' })).toBe(true);
  });
});

describe('system readings', () => {
  it("sums the PPP links' bytes", () => {
    const dev = 'Inter-|   Receive  |  Transmit\n face |bytes packets errs drop fifo frame compressed multicast|bytes\n  ppp0:  1000 10 0 0 0 0 0 0  500 5 0 0 0 0 0 0\n  eth0: 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9\n';
    expect(pppCounters(dev)).toEqual({ rx: 1000, tx: 500 });
    expect(pppCounters('')).toBeNull();
  });

  it("reads a macOS service's IPv6 setting", () => {
    expect(ipv6Mode('IP address: 1.2.3.4\nIPv6: Automatic\n')).toBe('automatic');
    expect(ipv6Mode('IPv6: Off\n')).toBe('off');
    expect(ipv6Mode('IPv6 IP address: none\n')).toBeNull();
  });
});

function u16(n: number): Buffer {
  return Buffer.from([n >> 8, n & 255]);
}
