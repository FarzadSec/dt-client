import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { systemResolvers } from '../src/main/configs/xray';
import type { SystemKit } from '../src/main/os/kit';
import { Vpn, type Connection } from '../src/main/vpn';
import { defaultSettings, type AppProfile, type Status } from '../src/shared/types';

// networksetup, dscacheutil and killall, faked: the commands are recorded, the DNS kept per service.
const state = vi.hoisted(() => ({ calls: [] as string[][], dns: {} as Record<string, string[]>, services: '' }));
vi.mock('../src/main/system/run', () => ({
  run: async (command: string, args: string[]) => {
    state.calls.push([command, ...args]);
    if (args[0] === '-listallnetworkservices') return { code: 0, stdout: state.services, stderr: '' };
    if (args[0] === '-getdnsservers') {
      const list = state.dns[args[1]] ?? [];
      return { code: 0, stdout: list.length > 0 ? `${list.join('\n')}\n` : `There aren't any DNS Servers set on ${args[1]}.\n`, stderr: '' };
    }
    if (args[0] === '-setdnsservers') {
      state.dns[args[1]] = args[2] === 'Empty' ? [] : args.slice(2);
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  },
}));

const { applyDns, dnsOf, enabledServices, restoreDns } = await import('../src/main/system/macDns');

const listing = 'An asterisk (*) denotes that a network service is disabled.\nWi-Fi\nThunderbolt Bridge\n*iPhone USB\n';

function tmpFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dt-dns-')), 'dns-backup.json');
}

beforeEach(() => {
  state.calls = [];
  state.services = listing;
  state.dns = { 'Wi-Fi': [], 'Thunderbolt Bridge': ['192.168.1.1'], 'iPhone USB': [] };
});

describe("macOS's network services", () => {
  it('lists the enabled ones', () => {
    expect(enabledServices(listing)).toEqual(['Wi-Fi', 'Thunderbolt Bridge']);
  });

  it("reads a service's resolvers, and none from the sentence for none", () => {
    expect(dnsOf('192.168.1.1\nfe80::1\n')).toEqual(['192.168.1.1', 'fe80::1']);
    expect(dnsOf("There aren't any DNS Servers set on Wi-Fi.\n")).toEqual([]);
  });
});

describe('the system resolvers while connected', () => {
  it("are the setting's public IPv4 addresses, or the default", () => {
    expect(systemResolvers('')).toEqual(['1.1.1.1', '8.8.8.8']);
    expect(systemResolvers('9.9.9.9, 192.168.1.1, 2606:4700:4700::1111')).toEqual(['9.9.9.9']);
    expect(systemResolvers('192.168.1.1 10.0.0.1')).toEqual(['1.1.1.1', '8.8.8.8']);
  });
});

describe('pointing the system DNS at the tunnel', () => {
  it('sets every enabled service and puts each one back as it was', async () => {
    const file = tmpFile();
    expect(await applyDns(['1.1.1.1', '8.8.8.8'], file)).toEqual(['Wi-Fi', 'Thunderbolt Bridge']);
    expect(state.dns).toEqual({ 'Wi-Fi': ['1.1.1.1', '8.8.8.8'], 'Thunderbolt Bridge': ['1.1.1.1', '8.8.8.8'], 'iPhone USB': [] });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ 'Wi-Fi': [], 'Thunderbolt Bridge': ['192.168.1.1'] });
    expect(state.calls).toContainEqual(['/usr/bin/killall', '-HUP', 'mDNSResponder']);

    expect(await restoreDns(file)).toBe(true);
    expect(state.dns).toEqual({ 'Wi-Fi': [], 'Thunderbolt Bridge': ['192.168.1.1'], 'iPhone USB': [] });
    expect(state.calls).toContainEqual(['/usr/sbin/networksetup', '-setdnsservers', 'Wi-Fi', 'Empty']);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('keeps the original when applied again before a restore', async () => {
    const file = tmpFile();
    await applyDns(['1.1.1.1'], file);
    await applyDns(['9.9.9.9'], file);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ 'Wi-Fi': [], 'Thunderbolt Bridge': ['192.168.1.1'] });
    await restoreDns(file);
    expect(state.dns['Thunderbolt Bridge']).toEqual(['192.168.1.1']);
  });

  it('does nothing to restore without a backup', async () => {
    expect(await restoreDns(tmpFile())).toBe(false);
    expect(state.calls).toEqual([]);
  });
});

describe('the connection and the system DNS', () => {
  const profile: AppProfile = {
    account: { username: 'u', enabled: true, expiryTime: 0, upload: 0, download: 0, total: 0 } as AppProfile['account'],
    locations: [],
    configs: [{ protocol: 'l2tp', name: 'l2tp', link: 'l2tp://u:p@vpn.example.com?ipsec=1&psk=k', locationId: 2 }],
  };
  const settings = { ...defaultSettings, protocol: 'l2tp' as const, dns: '9.9.9.9' };

  function setup(engine: Connection['engine']) {
    const events: string[] = [];
    let lost: ((blocking: boolean) => void) | null = null;
    const connection: Connection = {
      engine,
      start: async () => true,
      stop: async () => void events.push('stop'),
      onLost: (cb) => (lost = cb),
    };
    const kit = {
      os: 'macos',
      exe: (n: string) => n,
      openvpnBinary: () => null,
      l2tp: { connect: async () => ({ ok: true }), isUp: async () => true, disconnect: async () => undefined },
      protectWebrtc: async () => ({}),
      restoreWebrtc: async () => undefined,
      applyZone: async () => null,
      restoreZone: async () => undefined,
      applyDns: async (servers: string[]) => {
        events.push(`apply ${servers.join(' ')}`);
        return ['Wi-Fi'];
      },
      restoreDns: async () => {
        events.push('restore');
        return false;
      },
    } as unknown as SystemKit;
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-vpn-'));
    const vpn = new Vpn({ bin: path.join(work, 'bin'), work }, kit, undefined, { checkTraffic: async () => true, live: false });
    (vpn as unknown as { connectionFor: () => Connection }).connectionFor = () => connection;
    const statuses: Status[] = [];
    vpn.on('status', (s: Status) => {
      statuses.push(s);
      events.push(`status ${s.state}`);
    });
    return { vpn, events, drop: (blocking: boolean) => lost?.(blocking) };
  }
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it('points it at the tunnel before saying connected, and back after a disconnect', async () => {
    const { vpn, events } = setup('xray');
    await vpn.connect(profile, settings, 2);
    await vpn.disconnect();
    // The first restore is the start's, for a run that ended connected; it comes before the change.
    expect(events.filter((e) => !e.startsWith('status connecting'))).toEqual(['restore', 'apply 9.9.9.9', 'status connected', 'status disconnecting', 'stop', 'restore', 'status disconnected']);
  });

  it('does the same for OpenVPN, and leaves L2TP alone', async () => {
    const openvpn = setup('openvpn');
    await openvpn.vpn.connect(profile, settings, 2);
    expect(openvpn.events).toContain('apply 9.9.9.9');
    const l2tp = setup('l2tp');
    await l2tp.vpn.connect(profile, settings, 2);
    expect(l2tp.events.some((e) => e.startsWith('apply'))).toBe(false);
  });

  it('keeps it while the kill switch holds traffic back, and restores it after a plain drop', async () => {
    const held = setup('xray');
    await held.vpn.connect(profile, settings, 2);
    held.drop(true);
    await settle();
    expect(held.events.filter((e) => e === 'restore')).toHaveLength(1);

    const plain = setup('xray');
    await plain.vpn.connect(profile, settings, 2);
    plain.drop(false);
    await settle();
    expect(plain.events.filter((e) => e === 'restore')).toHaveLength(2);
  });
});
