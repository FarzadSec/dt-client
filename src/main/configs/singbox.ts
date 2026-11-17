export interface TunOptions {
  socksPort: number;
  strictRoute: boolean;
}

export const tunInterfaceName = 'DT Client';

// The engines' own sockets leave directly, or the tunnel would carry itself.
const directProcesses = ['xray.exe', 'sing-box.exe'];

export function singboxTunConfig(opts: TunOptions): Record<string, unknown> {
  return {
    log: { level: 'warn', timestamp: true },
    dns: {
      servers: [
        { type: 'tcp', tag: 'remote', server: '1.1.1.1', detour: 'proxy' },
        { type: 'local', tag: 'local' },
      ],
      final: 'remote',
      strategy: 'ipv4_only',
    },
    inbounds: [
      {
        type: 'tun',
        tag: 'tun-in',
        interface_name: tunInterfaceName,
        address: ['172.19.0.1/30', 'fdfe:dcba:9876::1/126'],
        mtu: 9000,
        auto_route: true,
        strict_route: opts.strictRoute,
        stack: 'mixed',
      },
    ],
    outbounds: [
      { type: 'socks', tag: 'proxy', server: '127.0.0.1', server_port: opts.socksPort, version: '5' },
      { type: 'direct', tag: 'direct' },
    ],
    route: {
      rules: [
        { action: 'sniff' },
        { protocol: 'dns', action: 'hijack-dns' },
        { process_name: directProcesses, outbound: 'direct' },
        { ip_is_private: true, outbound: 'direct' },
      ],
      final: 'proxy',
      auto_detect_interface: true,
      default_domain_resolver: 'local',
    },
  };
}
