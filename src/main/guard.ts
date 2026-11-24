import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

import type { Os } from '../shared/platform';
import type { LockHit, Settings, SplitApp } from '../shared/types';
import type { LogFn } from './log';
import { run } from './system/run';

// Apps and sites the user locked must not be used while the VPN is off. Sites: their names point at
// this computer (the hosts file), and an attempt to open one is seen on the local web ports here and
// offered a connect. Apps: a locked app found running is closed, and the same offer comes up; after
// connecting (or a skip) the app is opened again. The VPN up, or a skip, lifts the lock.

export interface GuardHost {
  os: Os;
  log: LogFn;
  // Writes (or with an empty list removes) the locked sites' lines in the hosts file.
  applySites(sites: string[], address: string): Promise<boolean>;
  onHit(hit: LockHit): void;
}

interface Proc {
  pid: number;
  path: string;
}

// The address locked names point at: one the app listens on where it can (Windows, macOS), and on Linux,
// where only root may open those ports, one nothing answers on.
export function lockAddress(os: Os): string {
  if (os === 'windows') return '127.77.7.7';
  if (os === 'macos') return '127.0.0.1';
  return '0.0.0.0';
}

// The server name a TLS ClientHello asks for, or null.
export function sniOf(hello: Buffer): string | null {
  try {
    if (hello[0] !== 0x16 || hello.length < 43) return null;
    let at = 5 + 4 + 2 + 32; // record header, handshake header, version, random
    at += 1 + hello[at]; // session id
    at += 2 + hello.readUInt16BE(at); // cipher suites
    at += 1 + hello[at]; // compression
    const extEnd = at + 2 + hello.readUInt16BE(at);
    at += 2;
    while (at + 4 <= extEnd && at + 4 <= hello.length) {
      const type = hello.readUInt16BE(at);
      const len = hello.readUInt16BE(at + 2);
      if (type === 0 && at + 9 <= hello.length) {
        const nameLen = hello.readUInt16BE(at + 7);
        return hello.subarray(at + 9, at + 9 + nameLen).toString('latin1').toLowerCase();
      }
      at += 4 + len;
    }
  } catch {
    // Not a ClientHello.
  }
  return null;
}

async function processes(os: Os): Promise<Proc[]> {
  if (os === 'windows') {
    const res = await run('tasklist.exe', ['/FO', 'CSV', '/NH'], 10_000);
    return res.stdout
      .split(/\r?\n/)
      .map((l) => /^"([^"]+)","(\d+)"/.exec(l))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ pid: Number(m[2]), path: m[1] }));
  }
  const res = await run('ps', ['-axo', 'pid=,comm='], 10_000);
  return res.stdout
    .split('\n')
    .map((l) => /^\s*(\d+)\s+(.+)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ pid: Number(m[1]), path: m[2].trim() }));
}

// Windows matches by the program's file name; macOS by the .app bundle the process runs from; Linux by
// the executable's name.
export function matchesApp(os: Os, app: SplitApp, proc: Proc): boolean {
  if (os === 'windows') return proc.path.toLowerCase() === app.name.toLowerCase();
  if (os === 'macos') return proc.path.startsWith(`${app.path.replace(/\/$/, '')}/`);
  return path.basename(proc.path) === app.name || proc.path === app.path;
}

export class Guard {
  private settings: Settings | null = null;
  private vpnUp = false;
  private downSince = 0;
  private skipUntil = 0;
  private timer: NodeJS.Timeout | null = null;
  private sitesOn = '';
  private servers: net.Server[] = [];
  private lastHit = new Map<string, number>();
  // Apps closed by the lock, opened again once the VPN connects (or the user skips).
  private closed = new Map<string, { app: SplitApp; at: number }>();
  private watching = false;
  private skipTimer: NodeJS.Timeout | null = null;

  constructor(private readonly host: GuardHost) {}

  // A connection being made: apps are given its time before the lock closes them.
  connecting(): void {
    this.downSince = Date.now();
  }

  update(settings: Settings): void {
    this.settings = settings;
    void this.apply();
  }

  // Connected, or the kill switch holding traffic: nothing leaves from the real address.
  vpn(up: boolean): void {
    if (up === this.vpnUp) return;
    this.vpnUp = up;
    if (!up) this.downSince = Date.now();
    if (up) this.reopenClosed();
    void this.apply();
  }

  skip(minutes: number): void {
    this.skipUntil = Date.now() + Math.max(1, Math.min(24 * 60, minutes)) * 60_000;
    this.reopenClosed();
    void this.apply();
  }

  private active(): boolean {
    const s = this.settings;
    if (!s?.lockEnabled || this.vpnUp || Date.now() < this.skipUntil) return false;
    return s.lockApps.length > 0 || s.lockSites.length > 0;
  }

  private async apply(): Promise<void> {
    const active = this.active();
    const sites = active ? (this.settings?.lockSites ?? []) : [];
    const key = sites.join(',');
    if (key !== this.sitesOn) {
      const ok = await this.host.applySites(sites, lockAddress(this.host.os));
      if (ok) this.sitesOn = key;
      this.host.log('lock', sites.length > 0 ? `${sites.length} site(s) locked while the VPN is off${ok ? '' : ' (the hosts file could not be written)'}` : 'sites unlocked');
    }
    if (active && sites.length > 0) this.listen();
    else this.unlisten();
    if (active && (this.settings?.lockApps.length ?? 0) > 0) this.startWatch();
    else this.stopWatch();
    if (this.skipTimer) clearTimeout(this.skipTimer);
    this.skipTimer = this.skipUntil > Date.now() ? setTimeout(() => void this.apply(), this.skipUntil - Date.now() + 500) : null;
  }

  private hit(hit: LockHit): void {
    const key = `${hit.kind}:${hit.name}`;
    const now = Date.now();
    if (now - (this.lastHit.get(key) ?? 0) < 10_000) return;
    this.lastHit.set(key, now);
    this.host.log('lock', `${hit.kind === 'app' ? 'closed' : 'blocked'} ${hit.name} while the VPN is off`);
    this.host.onHit(hit);
  }

  private listen(): void {
    if (this.servers.length > 0 || this.host.os === 'linux') return;
    const address = lockAddress(this.host.os);
    const sites = () => this.settings?.lockSites ?? [];
    const locked = (name: string) => sites().find((s) => name === s || name.endsWith(`.${s}`));
    for (const port of [443, 80]) {
      const server = net.createServer((socket) => {
        socket.setTimeout(4000, () => socket.destroy());
        socket.once('data', (d: Buffer) => {
          const name = port === 443 ? sniOf(d) : (/\r\nhost:\s*([^\r\n:]+)/i.exec(d.toString('latin1'))?.[1] ?? '').toLowerCase();
          const site = name ? locked(name) : undefined;
          if (site) this.hit({ kind: 'site', name: site });
          if (port === 80) {
            const body = '<!doctype html><meta charset="utf-8"><title>DT Connect</title><body style="font-family:sans-serif;text-align:center;padding:60px">VPN is off. Connect with DT Connect to open this site.<br><br>وی‌پی‌ان خاموش است. برای باز کردن این سایت با DT Connect وصل شوید.</body>';
            socket.end(`HTTP/1.1 403 Forbidden\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
          } else socket.destroy();
        });
        socket.on('error', () => undefined);
      });
      server.on('error', (err) => this.host.log('lock', `the local port ${port} for locked sites is taken (${err.message}); sites are still blocked`));
      server.listen(port, address);
      this.servers.push(server);
    }
  }

  private unlisten(): void {
    for (const s of this.servers) s.close();
    this.servers = [];
  }

  private startWatch(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.scan(), 2500);
    void this.scan();
  }

  private stopWatch(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async scan(): Promise<void> {
    // A drop is given a few seconds to reconnect by itself before apps are closed.
    if (this.watching || !this.active() || Date.now() - this.downSince < 8000) return;
    this.watching = true;
    try {
      const apps = this.settings?.lockApps ?? [];
      const list = await processes(this.host.os);
      if (!this.active()) return;
      for (const app of apps) {
        const running = list.filter((p) => matchesApp(this.host.os, app, p));
        if (running.length === 0) continue;
        for (const p of running) await this.kill(p.pid);
        this.closed.set(app.name, { app, at: Date.now() });
        this.hit({ kind: 'app', name: displayName(app) });
      }
    } finally {
      this.watching = false;
    }
  }

  private async kill(pid: number): Promise<void> {
    if (this.host.os === 'windows') await run('taskkill.exe', ['/PID', String(pid), '/T', '/F'], 10_000);
    else {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // Gone already, or not the user's.
      }
    }
  }

  private reopenClosed(): void {
    const now = Date.now();
    for (const [name, { app, at }] of this.closed) {
      this.closed.delete(name);
      if (now - at > 5 * 60_000) continue;
      this.host.log('lock', `opening ${displayName(app)} again`);
      try {
        const child =
          this.host.os === 'macos' ? spawn('/usr/bin/open', ['-a', app.path], { detached: true, stdio: 'ignore' }) : spawn(app.path, [], { detached: true, stdio: 'ignore', cwd: path.dirname(app.path) });
        child.on('error', () => undefined);
        child.unref();
      } catch {
        // It can be opened by hand.
      }
    }
  }

  // Back to normal when the app quits: the hosts file without the lock.
  async close(): Promise<void> {
    this.stopWatch();
    this.unlisten();
    if (this.sitesOn !== '') await this.host.applySites([], lockAddress(this.host.os));
    this.sitesOn = '';
  }
}

export function displayName(app: SplitApp): string {
  const base = path.basename(app.path || app.name);
  return base.replace(/\.(exe|app)$/i, '') || app.name;
}
