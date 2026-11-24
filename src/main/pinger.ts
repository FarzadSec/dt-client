import { engineOf } from '../shared/engines';
import type { AppConfig, AppProfile, PingResult } from '../shared/types';
import { l2tpAccount } from './configs/l2tp';
import { openvpnProfile } from './configs/openvpn';
import { xrayDelays, type DelayPaths } from './delay';
import { ikeHandshakeMs, l2tpHandshakeMs, openvpnHandshakeMs, openvpnProbeTarget } from './handshake';
import type { LogFn } from './log';

// The real delay of every config the app can run here: through Xray to Google's empty page for the
// V2Ray protocols and WireGuard (the panel's own test), the server's answer to the first message of
// its handshake for OpenVPN and L2TP/IPsec. Each server is asked once however many configs share it.
export async function realDelays(profile: AppProfile, paths: DelayPaths, log: LogFn): Promise<PingResult[]> {
  const usable = profile.configs.filter((c) => engineOf(c));
  const once = new Map<string, Promise<number | null>>();
  const ask = (key: string, probe: () => Promise<number | null>) => {
    let p = once.get(key);
    if (!p) once.set(key, (p = probe().catch(() => null)));
    return p;
  };
  const xrayOnes = usable.filter((c) => engineOf(c) === 'xray');
  const xray = xrayOnes.length > 0 ? xrayDelays(xrayOnes, paths, log).catch((err: unknown) => {
    log('ping', `the delay test failed: ${err instanceof Error ? err.message : String(err)}`);
    return new Map<string, number | null>();
  }) : Promise.resolve(new Map<string, number | null>());
  const others = usable.filter((c) => engineOf(c) !== 'xray').map(async (config): Promise<PingResult> => ({ link: config.link, ms: await handshake(config, ask) }));
  const [byLink, rest] = await Promise.all([xray, Promise.all(others)]);
  const out = [...xrayOnes.map((c) => ({ link: c.link, ms: byLink.get(c.link) ?? null })), ...rest];
  const answered = out.filter((p) => p.ms !== null).length;
  log('ping', `real delay: ${answered}/${out.length} config(s) answered`);
  return out;
}

function handshake(config: AppConfig, ask: (key: string, probe: () => Promise<number | null>) => Promise<number | null>): Promise<number | null> {
  try {
    if (config.protocol === 'openvpn') {
      const target = openvpnProbeTarget(openvpnProfile(config.link));
      if (!target) return Promise.resolve(null);
      return ask(`ovpn ${target.udp ? 'udp' : 'tcp'} ${target.host}:${target.port}`, () => openvpnHandshakeMs(target));
    }
    if (config.protocol === 'l2tp') {
      const account = l2tpAccount(config.link);
      return account.psk ? ask(`ike ${account.host}`, () => ikeHandshakeMs(account.host)) : ask(`l2tp ${account.host}`, () => l2tpHandshakeMs(account.host));
    }
  } catch {
    // A link the app cannot read has no delay.
  }
  return Promise.resolve(null);
}

// The WireGuard locations a test reached: the panel frees the account's seat on them at once.
export function wireguardLocations(profile: AppProfile, pings: PingResult[]): number[] {
  const tested = new Set(pings.map((p) => p.link));
  const ids = new Set<number>();
  for (const c of profile.configs) if (c.protocol === 'wireguard' && typeof c.locationId === 'number' && tested.has(c.link)) ids.add(c.locationId);
  return [...ids];
}
