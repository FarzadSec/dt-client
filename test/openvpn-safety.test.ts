import { describe, expect, it } from 'vitest';

import { openvpnArgs, unsafeOpenvpnDirective } from '../src/main/configs/openvpn';

// The shape Manifold's renderer writes, client directives and inline credentials included.
const panelProfile = `# de-1
client
dev tun
proto udp
remote de.example.com 1194
resolv-retry infinite
nobind
persist-key
persist-tun
remote-cert-tls server
verify-x509-name manifold-openvpn-server name
data-ciphers AES-256-GCM:CHACHA20-POLY1305
ignore-unknown-option block-outside-dns
setenv opt block-outside-dns
setenv CLIENT_CERT 0
verb 3
<auth-user-pass>
dana
pass
</auth-user-pass>
<ca>
-----BEGIN CERTIFICATE-----
up /tmp/not-a-directive-inside-a-block.sh
-----END CERTIFICATE-----
</ca>
<tls-crypt>
-----BEGIN OpenVPN Static key V1-----
00
-----END OpenVPN Static key V1-----
</tls-crypt>
`;

describe('unsafeOpenvpnDirective', () => {
  it("accepts the panel's profiles", () => {
    expect(unsafeOpenvpnDirective(panelProfile)).toBeNull();
  });

  // The helper runs OpenVPN as root; a profile is input from whoever talks to it.
  it.each([
    ['up /tmp/x.sh', 'up'],
    ['  --route-up "/bin/sh -c id"', 'route-up'],
    ['script-security 2', 'script-security'],
    ['plugin /lib/evil.so', 'plugin'],
    ['auth-user-pass /etc/shadow', 'auth-user-pass'],
    ['ca /etc/ssl/private/server.key', 'ca'],
    ['management 0.0.0.0 7505', 'management'],
    ['management-client-user root', 'management-client-user'],
    ['log-append /etc/cron.d/x', 'log-append'],
    ['config /root/other.ovpn', 'config'],
    ['replay-persist /etc/passwd', 'replay-persist'],
  ])('refuses %s', (line, directive) => {
    expect(unsafeOpenvpnDirective(`client\nremote h 1194\n${line}\n`)).toBe(directive);
  });

  it('refuses an inline block that never closes, which would hide what follows', () => {
    expect(unsafeOpenvpnDirective('client\n<ca>\nup /tmp/x\n')).toBe('<ca>');
  });
});

describe('openvpnArgs', () => {
  it('lets OpenVPN run only its own system tools, whatever the profile says', () => {
    const args = openvpnArgs('/run/p.ovpn', 7505, 'linux');
    expect(args.slice(0, 2)).toEqual(['--config', '/run/p.ovpn']);
    expect(args).toContain('--script-security');
    expect(args[args.indexOf('--script-security') + 1]).toBe('1');
    expect(args).not.toContain('--windows-driver');
  });
});
