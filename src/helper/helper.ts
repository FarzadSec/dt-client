import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import { useOs } from '../shared/engines';
import { helperProtocolVersion, helperSocket, lineSplitter, type HelperMessage, type HelperRequest } from '../shared/helperProtocol';
import { osOf } from '../shared/platform';
import { SessionLog } from '../main/log';
import { linuxKit } from '../main/os/linux';
import { macosKit } from '../main/os/macos';
import { applyHostsLock } from '../main/system/hosts';
import { run } from '../main/system/run';
import { Vpn } from '../main/vpn';
import { sanitizeConnect, sanitizeLock } from './sanitize';

// Runs as root (systemd on Linux, launchd on macOS): the engines need it for the tunnel,
// routes, DNS and timezone. The app itself runs as the user and asks over the socket.
const os = osOf(process.platform);
if (os === 'windows') throw new Error('the helper is for Linux and macOS');
useOs(os);

const socketPath = helperSocket[os];
const work = os === 'macos' ? '/Library/Application Support/DT Connect/run' : '/var/lib/dt-connect/run';
fs.mkdirSync(work, { recursive: true, mode: 0o700 });
// What the engines said, for the app's support report (the 'logs' request); redacted as it is written.
const log = new SessionLog(800_000);
log.write('helper', `DT Connect helper on ${os} ${process.platform} ${process.arch}, Node ${process.version}`);
// Cached answers would keep a locked (or unlocked) site's old address.
async function flushNames(): Promise<void> {
  if (os === 'macos') {
    await run('/usr/bin/dscacheutil', ['-flushcache']);
    await run('/usr/bin/killall', ['-HUP', 'mDNSResponder']);
  } else await run('resolvectl', ['flush-caches']);
}

// A lock left by an app that did not get to lift it (a crash, a power cut); the app sets it again.
applyHostsLock([], '0.0.0.0');

const vpn = new Vpn({ bin: path.join(__dirname, '..', 'bin'), work }, os === 'macos' ? macosKit : linuxKit, log.write);
const clients = new Set<net.Socket>();

function send(socket: net.Socket, message: HelperMessage): void {
  if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
}

vpn.on('status', (value) => {
  for (const socket of clients) send(socket, { event: 'status', value });
});
vpn.on('live', (value) => {
  for (const socket of clients) send(socket, { event: 'live', value });
});

async function answer(req: HelperRequest): Promise<unknown> {
  switch (req.method) {
    case 'hello':
      return { version: helperProtocolVersion, os };
    case 'status':
      return vpn.status();
    case 'connect': {
      const { profile, settings, locationId, latency } = sanitizeConnect(req.params);
      return vpn.connect(profile, settings, locationId, latency);
    }
    case 'disconnect':
      return vpn.disconnect();
    case 'logs':
      return log.text();
    case 'lockSites': {
      const { sites, address } = sanitizeLock(req.params);
      const ok = applyHostsLock(sites, address);
      await flushNames();
      return ok;
    }
    default:
      throw new Error('bad_request');
  }
}

const server = net.createServer((socket) => {
  clients.add(socket);
  socket.on(
    'data',
    lineSplitter(
      (line) => {
        let req: HelperRequest;
        try {
          req = JSON.parse(line) as HelperRequest;
        } catch {
          socket.destroy();
          return;
        }
        if (!Number.isSafeInteger(req.id)) return;
        answer(req).then(
          (value) => send(socket, { id: req.id, ok: true, value }),
          (err: unknown) => {
            log.write('helper', `${req.method} failed: ${err instanceof Error ? err.message : String(err)}`);
            send(socket, { id: req.id, ok: false, code: err instanceof Error && err.message === 'bad_request' ? 'bad_request' : 'helper_error' });
          },
        );
      },
      () => socket.destroy(),
    ),
  );
  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
});

fs.mkdirSync(path.dirname(socketPath), { recursive: true });
fs.rmSync(socketPath, { force: true });
server.listen(socketPath, () => {
  // The app runs as whichever user is signed in; what it may ask for is checked above.
  fs.chmodSync(socketPath, 0o666);
  console.log(`DT Connect helper listening on ${socketPath}`);
});

async function shutdown(): Promise<void> {
  server.close();
  await vpn.disconnect().catch(() => undefined);
  fs.rmSync(socketPath, { force: true });
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
