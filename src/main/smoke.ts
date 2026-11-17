import fs from 'node:fs';
import path from 'node:path';

import { singboxTunConfig } from './configs/singbox';
import { xrayConfig } from './configs/xray';

// CI writes the configs the app would run and checks them with the bundled xray and sing-box.
const out = process.argv[2] ?? 'smoke';
fs.mkdirSync(out, { recursive: true });
const outbounds: Record<string, Record<string, unknown>> = {
  // The shape Manifold's link parser gives the app.
  vless: {
    protocol: 'vless',
    settings: { address: 'de.example.com', encryption: 'none', flow: '', id: '11111111-2222-4333-8444-555555555555', port: 443 },
    streamSettings: { network: 'tcp', security: 'tls', tlsSettings: { serverName: 'de.example.com' } },
  },
  wireguard: {
    protocol: 'wireguard',
    settings: {
      secretKey: 'cOFJbW0HSNNXo+dpvVBiNMGbWXfzKaw8tc+B+WWRjX0=',
      address: ['10.0.0.2/32'],
      peers: [{ publicKey: 'Sa1M9+7tF7y2jNcvHDb2EhHH9dsZdFWkU6P3RuPXamY=', endpoint: 'wg.example.com:51820', allowedIPs: ['0.0.0.0/0'] }],
    },
  },
};
for (const [name, outbound] of Object.entries(outbounds)) {
  fs.writeFileSync(path.join(out, `xray-${name}.json`), JSON.stringify(xrayConfig(outbound, { socksPort: 20808, httpPort: 20809, iranDirect: true }), null, 2));
}
fs.writeFileSync(path.join(out, 'tun.json'), JSON.stringify(singboxTunConfig({ socksPort: 20808, strictRoute: true }), null, 2));
console.log(`wrote configs to ${out}`);
