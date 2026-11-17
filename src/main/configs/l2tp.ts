export interface L2tpAccount {
  host: string;
  username: string;
  password: string;
  psk: string;
}

export const l2tpConnectionName = 'DT Client L2TP';

// l2tp://user:password@host?ipsec=1&psk=key#remark, as the panel writes it.
export function l2tpAccount(link: string): L2tpAccount {
  const url = new URL(link);
  if (url.protocol !== 'l2tp:') throw new Error('not an L2TP link');
  const account = {
    host: url.hostname.replace(/^\[|\]$/g, ''),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    psk: url.searchParams.get('psk') ?? '',
  };
  if (!account.host || !account.username) throw new Error('not an L2TP account');
  return account;
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// Windows' own L2TP/IPsec client does the connecting; rasdial dials what this adds.
export function addConnectionScript(account: L2tpAccount, name = l2tpConnectionName): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    `Remove-VpnConnection -Name ${psQuote(name)} -Force -ErrorAction SilentlyContinue`,
    `Add-VpnConnection -Name ${psQuote(name)} -ServerAddress ${psQuote(account.host)} -TunnelType L2tp ` +
      `-L2tpPsk ${psQuote(account.psk)} -AuthenticationMethod MSChapv2 -EncryptionLevel Optional -Force`,
  ].join('\n');
}

export function encodedCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}
