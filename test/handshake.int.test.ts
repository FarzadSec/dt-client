import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { freePort } from '../src/main/health';
import { openvpnHandshakeMs, openvpnProbeTarget } from '../src/main/handshake';

// Runs where a real OpenVPN is given (OPENVPN_BIN): a server per wrapping (tls-crypt over UDP and TCP,
// tls-auth with SHA256), each answering the app's first message; a wrong key gets no answer.
const openvpn = process.env.OPENVPN_BIN ?? '';
const run = openvpn && fs.existsSync(openvpn) ? describe : describe.skip;

run('OpenVPN handshake delay against a real server', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-ovpn-'));
  const servers: ChildProcess[] = [];
  const file = (name: string) => path.join(dir, name);

  beforeAll(() => {
    const ssl = (args: string[]) => execFileSync('openssl', args, { stdio: 'ignore', cwd: dir });
    ssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt', '-days', '1', '-subj', '/CN=ca']);
    ssl(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=server']);
    ssl(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.crt', '-days', '1']);
    execFileSync(openvpn, ['--genkey', 'tls-crypt', file('tc.key')]);
    execFileSync(openvpn, ['--genkey', 'tls-auth', file('ta.key')]);
  });

  afterAll(() => {
    for (const s of servers) s.kill();
  });

  // One peer per server: OpenVPN's point-to-point TLS server answers the first client that reaches it.
  async function server(proto: 'udp4' | 'tcp-server', wrap: string[]): Promise<number> {
    const port = await freePort();
    const args = ['--tls-server', '--dev', 'null', '--proto', proto, '--port', String(port), '--local', '127.0.0.1', '--ca', file('ca.crt'), '--cert', file('server.crt'), '--key', file('server.key'), '--dh', 'none', ...wrap, '--verb', '3'];
    const child = spawn(openvpn, args, { stdio: 'ignore' });
    servers.push(child);
    await new Promise((r) => setTimeout(r, 1200));
    return port;
  }

  const tc = () => fs.readFileSync(file('tc.key'), 'utf8');
  const ta = () => fs.readFileSync(file('ta.key'), 'utf8');

  it('tls-crypt over UDP', async () => {
    const port = await server('udp4', ['--tls-crypt', file('tc.key')]);
    const target = openvpnProbeTarget(`client\nremote 127.0.0.1 ${port} udp\n<tls-crypt>\n${tc()}</tls-crypt>\n`)!;
    expect(await openvpnHandshakeMs(target, 4000)).toBeTypeOf('number');
  });

  it('tls-crypt over TCP', async () => {
    const port = await server('tcp-server', ['--tls-crypt', file('tc.key')]);
    const target = openvpnProbeTarget(`client\nproto tcp-client\nremote 127.0.0.1 ${port}\n<tls-crypt>\n${tc()}</tls-crypt>\n`)!;
    expect(await openvpnHandshakeMs(target, 4000)).toBeTypeOf('number');
  });

  it('tls-auth with SHA256 and key direction 1', async () => {
    const port = await server('udp4', ['--tls-auth', file('ta.key'), '0', '--auth', 'SHA256']);
    const target = openvpnProbeTarget(`client\nremote 127.0.0.1 ${port}\nproto udp\nauth SHA256\nkey-direction 1\n<tls-auth>\n${ta()}</tls-auth>\n`)!;
    expect(await openvpnHandshakeMs(target, 4000)).toBeTypeOf('number');
  });

  it('gets no answer with the wrong key', async () => {
    const port = await server('udp4', ['--tls-crypt', file('tc.key')]);
    const wrong = tc().replace(/[0-9a-f]{32}\n/g, `${'ab'.repeat(16)}\n`);
    const target = openvpnProbeTarget(`client\nremote 127.0.0.1 ${port} udp\n<tls-crypt>\n${wrong}</tls-crypt>\n`)!;
    expect(await openvpnHandshakeMs(target, 2500)).toBeNull();
  });
}, 60_000);
