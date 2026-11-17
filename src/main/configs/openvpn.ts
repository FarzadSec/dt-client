const scheme = 'openvpn://';

// The panel carries the .ovpn profile as base64url after openvpn://.
export function openvpnProfile(link: string): string {
  if (!link.startsWith(scheme)) throw new Error('not an OpenVPN link');
  const text = Buffer.from(link.slice(scheme.length), 'base64url').toString('utf8');
  if (!/^\s*client\s*$/m.test(text) || !/^\s*remote\s+\S+/m.test(text)) throw new Error('not an OpenVPN profile');
  return text;
}

export function openvpnArgs(configPath: string, managementPort: number): string[] {
  return ['--config', configPath, '--windows-driver', 'wintun', '--management', '127.0.0.1', String(managementPort)];
}
