import { spawn, type ChildProcess } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { xrayDelays } from '../src/main/delay';
import { freePort, waitForPort } from '../src/main/health';
import { HttpProbe } from '../src/main/httpProbe';

// Runs only where a real xray is given (XRAY_BIN): a VLESS server on this machine, a local page answering
// 204, and the app's delay test through them; a config to a closed port must come back as null.
const xray = process.env.XRAY_BIN ?? '';
const run = xray && fs.existsSync(xray) ? describe : describe.skip;

run('real delay through Xray', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-delay-'));
  let server: ChildProcess | null = null;
  let page: https.Server | null = null;
  let pagePort = 0;
  let vlessPort = 0;
  const id = '11111111-2222-4333-8444-555555555555';

  beforeAll(async () => {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
    page = https.createServer({ key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) }, (_req, res) => {
      res.writeHead(204);
      res.end();
    });
    pagePort = await freePort();
    await new Promise<void>((r) => page!.listen(pagePort, '127.0.0.1', () => r()));
    vlessPort = await freePort();
    const conf = {
      log: { loglevel: 'warning' },
      inbounds: [{ listen: '127.0.0.1', port: vlessPort, protocol: 'vless', settings: { clients: [{ id }], decryption: 'none' }, streamSettings: { network: 'tcp' } }],
      // Xray refuses private targets on a server's freedom unless allowed.
      outbounds: [{ protocol: 'freedom', settings: { finalRules: [{ action: 'allow', ip: ['127.0.0.0/8'] }] } }],
    };
    fs.writeFileSync(path.join(dir, 'server.json'), JSON.stringify(conf));
    server = spawn(xray, ['run', '-c', path.join(dir, 'server.json')], { stdio: 'ignore' });
    await waitForPort(vlessPort, 8000, () => true);
  });

  afterAll(() => {
    server?.kill();
    page?.close();
  });

  it('measures the config that works and leaves the dead one null', async () => {
    const outbound = (port: number) => ({ protocol: 'vless', settings: { address: '127.0.0.1', port, id, encryption: 'none', flow: '' }, streamSettings: { network: 'tcp', security: 'none' } });
    const closed = await freePort();
    const configs = [
      { protocol: 'vless', name: 'ok', link: 'vless://ok', outbound: outbound(vlessPort) },
      { protocol: 'vless', name: 'dead', link: 'vless://dead', outbound: outbound(closed) },
    ];
    const lines: string[] = [];
    const result = await xrayDelays(configs, { xray, work: dir }, (_s, l) => lines.push(l), { target: { host: 'localhost', port: pagePort, path: '/generate_204' }, insecure: true });
    expect(lines).toEqual([]);
    expect(typeof result.get('vless://ok')).toBe('number');
    expect(result.get('vless://dead')).toBeNull();
  }, 30_000);

  it('keeps one connection for the live ping', async () => {
    const probe = new HttpProbe({ host: 'localhost', port: pagePort, path: '/generate_204' }, null, true);
    const first = await probe.measure(3000);
    const second = await probe.measure(3000);
    probe.close();
    expect(first.ok && first.cold !== null).toBe(true);
    expect(second.ok && second.cold === null && typeof second.ms === 'number').toBe(true);
  });
});
