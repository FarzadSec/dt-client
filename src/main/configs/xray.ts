export interface XrayOptions {
  socksPort: number;
  httpPort: number;
  iranDirect: boolean;
  adBlock?: boolean;
  dns?: string[];
}

// Resolver Xray uses for server names; its own UDP leaves the tunnel by process rule.
export const defaultDns = ['1.1.1.1', '8.8.8.8'];

// The user's DNS setting: addresses separated by commas or spaces, the default when empty.
export function dnsServers(setting: string): string[] {
  const list = setting.split(/[\s,]+/).filter((s) => /^[0-9a-fA-F.:]+$/.test(s));
  return list.length > 0 ? list : defaultDns;
}

export function xrayConfig(outbound: Record<string, unknown>, opts: XrayOptions): Record<string, unknown> {
  const proxy = structuredClone(outbound);
  proxy.tag = 'proxy';
  const stream = (proxy.streamSettings ?? {}) as Record<string, unknown>;
  const sockopt = (stream.sockopt ?? {}) as Record<string, unknown>;
  // Without it Xray asks Windows for the server name, and Windows asks through the tunnel.
  sockopt.domainStrategy = 'UseIPv4';
  stream.sockopt = sockopt;
  proxy.streamSettings = stream;

  const rules: Record<string, unknown>[] = [];
  if (opts.adBlock) rules.push({ type: 'field', domain: ['geosite:category-ads-all'], outboundTag: 'block' });
  rules.push({ type: 'field', ip: ['geoip:private'], outboundTag: 'direct' });
  if (opts.iranDirect) {
    rules.push(
      { type: 'field', domain: ['geosite:category-ir', 'regexp:\\.ir$'], outboundTag: 'direct' },
      { type: 'field', ip: ['geoip:ir'], outboundTag: 'direct' },
    );
  }
  return {
    log: { loglevel: 'warning' },
    dns: { servers: opts.dns ?? defaultDns, queryStrategy: 'UseIPv4' },
    inbounds: [
      {
        tag: 'socks',
        listen: '127.0.0.1',
        port: opts.socksPort,
        protocol: 'socks',
        settings: { auth: 'noauth', udp: true },
        sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'], routeOnly: true },
      },
      { tag: 'http', listen: '127.0.0.1', port: opts.httpPort, protocol: 'http', settings: {} },
    ],
    outbounds: [proxy, { tag: 'direct', protocol: 'freedom' }, { tag: 'block', protocol: 'blackhole' }],
    routing: { domainStrategy: 'IPIfNonMatch', rules },
  };
}
