import { describe, expect, it } from 'vitest';

import { xrayConfig } from '../src/main/configs/xray';
import { runsOnXray } from '../src/shared/engines';
import { singboxTunConfig } from '../src/main/configs/singbox';

const vless = {
  protocol: 'vless',
  tag: 'vless-de',
  settings: { vnext: [{ address: 'de.example.com', port: 443, users: [{ id: 'u' }] }] },
  streamSettings: { network: 'tcp', security: 'tls', tlsSettings: { serverName: 'de.example.com' } },
};

describe('xrayConfig', () => {
  it('runs the panel outbound as proxy and resolves its server through Xray', () => {
    const cfg = xrayConfig(vless, { socksPort: 20808, httpPort: 20809, iranDirect: false }) as {
      outbounds: Record<string, unknown>[];
      inbounds: Record<string, unknown>[];
      routing: { rules: unknown[] };
    };
    const proxy = cfg.outbounds[0] as { tag: string; streamSettings: { sockopt: { domainStrategy: string }; tlsSettings: unknown } };
    expect(proxy.tag).toBe('proxy');
    expect(proxy.streamSettings.sockopt.domainStrategy).toBe('UseIPv4');
    expect(proxy.streamSettings.tlsSettings).toEqual({ serverName: 'de.example.com' });
    expect(cfg.inbounds.map((i) => [i.protocol, i.listen, i.port])).toEqual([
      ['socks', '127.0.0.1', 20808],
      ['http', '127.0.0.1', 20809],
    ]);
    expect(JSON.stringify(cfg.routing.rules)).not.toContain('geoip:ir');
    expect(vless.tag).toBe('vless-de');
  });

  it('sends Iranian sites around the proxy when asked', () => {
    const cfg = xrayConfig(vless, { socksPort: 1, httpPort: 2, iranDirect: true }) as { routing: { rules: { outboundTag: string }[] } };
    const direct = JSON.stringify(cfg.routing.rules.filter((r) => r.outboundTag === 'direct'));
    expect(direct).toContain('geoip:ir');
    expect(direct).toContain('geosite:category-ir');
  });

  it('knows which entries Xray runs', () => {
    expect(runsOnXray('vless', vless)).toBe(true);
    expect(runsOnXray('wireguard', { protocol: 'wireguard' })).toBe(true);
    expect(runsOnXray('openvpn', undefined)).toBe(false);
    expect(runsOnXray('tuic', undefined)).toBe(false);
  });
});

describe('singboxTunConfig', () => {
  it('sends everything to the local proxy except the engines themselves', () => {
    const cfg = singboxTunConfig({ socksPort: 20808, strictRoute: true }) as {
      inbounds: { strict_route: boolean }[];
      outbounds: { tag: string; server_port?: number }[];
      route: { final: string; rules: Record<string, unknown>[] };
    };
    expect(cfg.inbounds[0].strict_route).toBe(true);
    expect(cfg.outbounds.find((o) => o.tag === 'proxy')?.server_port).toBe(20808);
    expect(cfg.route.final).toBe('proxy');
    expect(cfg.route.rules).toContainEqual({ process_name: ['xray.exe', 'sing-box.exe'], outbound: 'direct' });
  });

  it('lets traffic out when the kill switch is off', () => {
    const cfg = singboxTunConfig({ socksPort: 1, strictRoute: false }) as { inbounds: { strict_route: boolean }[] };
    expect(cfg.inbounds[0].strict_route).toBe(false);
  });
});
