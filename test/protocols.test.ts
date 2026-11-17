import { describe, expect, it } from 'vitest';

import { candidates, serverAddress } from '../src/main/candidates';
import { bestPing, usableLocationIds } from '../src/shared/engines';
import { addConnectionScript, encodedCommand, l2tpAccount } from '../src/main/configs/l2tp';
import { openvpnArgs, openvpnProfile } from '../src/main/configs/openvpn';
import { windowsZone } from '../src/main/system/zones';
import type { AppProfile } from '../src/shared/types';

const ovpnText = '# ovpn\nclient\ndev tun\nproto udp\nremote vpn.example.com 21300\n<auth-user-pass>\ndana\npass\n</auth-user-pass>\n';
const ovpnLink = 'openvpn://' + Buffer.from(ovpnText).toString('base64url');
const l2tpLink = "l2tp://dana%40example.com:pa'ss@vpn.example.com?ipsec=1&psk=shared-key-123#l2tp-dana";

const profile: AppProfile = {
  account: { username: 'dana', enabled: true, expiryTime: 0, upload: 0, download: 0, total: 0, deviceLimit: 2, devices: 1 },
  locations: [],
  configs: [
    { protocol: 'l2tp', name: 'l2tp', link: l2tpLink, locationId: 0 },
    { protocol: 'openvpn', name: 'ovpn', link: ovpnLink, locationId: 0 },
    { protocol: 'wireguard', name: 'wg', link: 'wireguard://k@wg.example.com:51820', locationId: 0, outbound: { protocol: 'wireguard' } },
    { protocol: 'vless', name: 'vless', link: 'vless://u@de.example.com:8443', locationId: 3, outbound: { protocol: 'vless' } },
    { protocol: 'tuic', name: 'tuic', link: 'tuic://u:p@x.example.com:443', locationId: 4 },
    { protocol: 'vless', name: 'ext', link: 'vless://u@ext.example.com:443', outbound: { protocol: 'vless' } },
  ],
};

describe('candidates', () => {
  it('tries Xray first, then WireGuard, OpenVPN and L2TP on auto', () => {
    expect(candidates(profile, 0, 'auto').map((c) => c.config.name)).toEqual(['wg', 'ovpn', 'l2tp']);
    expect(candidates(profile, null, 'auto').map((c) => c.config.name)).toEqual(['vless', 'ext', 'wg', 'ovpn', 'l2tp']);
  });

  it('keeps to the chosen protocol', () => {
    expect(candidates(profile, null, 'xray').map((c) => c.config.name)).toEqual(['vless', 'ext']);
    expect(candidates(profile, null, 'wireguard').map((c) => c.config.name)).toEqual(['wg']);
    expect(candidates(profile, 0, 'l2tp').map((c) => c.engine)).toEqual(['l2tp']);
  });

  it('lists only locations with something the app runs', () => {
    expect(usableLocationIds(profile).sort()).toEqual([0, 3]);
  });

  it('shows a location by the fastest config the app can run there', () => {
    const pings = [
      { link: ovpnLink, ms: 80 },
      { link: l2tpLink, ms: 40 },
      { link: 'tuic://u:p@x.example.com:443', ms: 5 },
      { link: 'vless://u@de.example.com:8443', ms: null },
    ];
    expect(bestPing(profile, pings, 0)).toBe(40);
    expect(bestPing(profile, pings, 3)).toBeNull();
    expect(bestPing(profile, pings, 4)).toBeNull();
  });

  it('finds the server of each kind of link for the ping', () => {
    expect(serverAddress(profile.configs[0])).toEqual({ host: 'vpn.example.com', port: 1701 });
    expect(serverAddress(profile.configs[1])).toEqual({ host: 'vpn.example.com', port: 21300 });
    expect(serverAddress(profile.configs[3])).toEqual({ host: 'de.example.com', port: 8443 });
    const vmess = 'vmess://' + Buffer.from(JSON.stringify({ add: 'vm.example.com', port: '2083' })).toString('base64');
    expect(serverAddress({ protocol: 'vmess', name: 'vm', link: vmess })).toEqual({ host: 'vm.example.com', port: 2083 });
  });
});

describe('OpenVPN', () => {
  it('decodes the profile and runs it on wintun with a management port', () => {
    expect(openvpnProfile(ovpnLink)).toBe(ovpnText);
    expect(openvpnArgs('C:\\p.ovpn', 7505)).toEqual(['--config', 'C:\\p.ovpn', '--windows-driver', 'wintun', '--management', '127.0.0.1', '7505']);
    expect(() => openvpnProfile('openvpn://' + Buffer.from('hello').toString('base64url'))).toThrow();
  });
});

describe('L2TP', () => {
  it('reads the account and quotes it for PowerShell', () => {
    const account = l2tpAccount(l2tpLink);
    expect(account).toEqual({ host: 'vpn.example.com', username: 'dana@example.com', password: "pa'ss", psk: 'shared-key-123' });
    const script = addConnectionScript({ ...account, psk: "k'ey" });
    expect(script).toContain("-L2tpPsk 'k''ey'");
    expect(script).toContain("-ServerAddress 'vpn.example.com' -TunnelType L2tp");
    expect(Buffer.from(encodedCommand(script), 'base64').toString('utf16le')).toBe(script);
  });
});

describe('windowsZone', () => {
  it('maps the panel timezone to the name tzutil takes', () => {
    expect(windowsZone('Europe/Berlin')).toBe('W. Europe Standard Time');
    expect(windowsZone('Asia/Tehran')).toBe('Iran Standard Time');
    expect(windowsZone('Mars/Olympus')).toBeNull();
    expect(windowsZone('')).toBeNull();
  });
});
