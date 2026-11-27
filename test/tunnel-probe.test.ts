import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { freePort } from '../src/main/health';
import { HttpProbe } from '../src/main/httpProbe';

// OpenVPN's test page went out by the system's routes, which on Windows settle after the tunnel is up,
// and failed connections that worked. Linux only: any 127.x address is this machine's there.
const run = process.platform === 'linux' ? describe : describe.skip;

run('a probe pinned to a tunnel', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-route-'));
  const seen: string[] = [];
  let page: https.Server | null = null;
  let port = 0;

  beforeAll(async () => {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
    page = https.createServer({ key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) }, (req, res) => {
      seen.push(req.socket.remoteAddress ?? '');
      res.writeHead(204);
      res.end();
    });
    port = await freePort();
    await new Promise<void>((r) => page!.listen(port, '127.0.0.1', () => r()));
  });

  afterAll(() => {
    page?.close();
  });

  it('connects from the tunnel address it was given', async () => {
    const probe = new HttpProbe({ host: '127.0.0.1', port, path: '/generate_204' }, null, true, { localAddress: '127.0.0.3', resolvers: ['1.1.1.1'] });
    try {
      const result = await probe.measure(4000);
      expect(result.ok).toBe(true);
    } finally {
      probe.close();
    }
    expect([...new Set(seen)]).toEqual(['127.0.0.3']);
  });
});
