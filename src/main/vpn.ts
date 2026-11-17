import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import type { AppProfile, Engine, Settings, Status } from '../shared/types';
import { candidates, type Candidate } from './candidates';
import { addConnectionScript, l2tpAccount, l2tpConnectionName } from './configs/l2tp';
import { openvpnArgs, openvpnProfile } from './configs/openvpn';
import { singboxTunConfig } from './configs/singbox';
import { xrayConfig } from './configs/xray';
import { EngineProcess, waitForLine } from './engines/process';
import { freePort, probeThroughProxy, waitForPort } from './health';
import { allowL2tpBehindNat } from './system/l2tpNat';
import { powershell, run } from './system/run';
import { applyZone, restoreZone } from './system/timezone';
import { protectWebrtc, restoreWebrtc, type WebrtcBackup } from './system/webrtc';

export interface VpnPaths {
  bin: string;
  work: string;
}

interface Connection {
  readonly engine: Engine;
  start(): Promise<boolean>;
  stop(): Promise<void>;
  // Called once if the connection drops by itself; blocking means traffic stays held back.
  onLost(cb: (blocking: boolean) => void): void;
}

function writePrivate(file: string, content: string): void {
  fs.writeFileSync(file, content, { mode: 0o600 });
}

class XrayConnection implements Connection {
  readonly engine = 'xray' as const;
  private xray: EngineProcess | null = null;
  private tun: EngineProcess | null = null;
  private lost: ((blocking: boolean) => void) | null = null;

  constructor(
    private readonly candidate: Candidate,
    private readonly settings: Settings,
    private readonly paths: VpnPaths,
  ) {}

  onLost(cb: (blocking: boolean) => void): void {
    this.lost = cb;
  }

  async start(): Promise<boolean> {
    const socksPort = await freePort();
    const httpPort = await freePort();
    const xrayFile = path.join(this.paths.work, 'xray.json');
    const outbound = this.candidate.config.outbound ?? {};
    writePrivate(xrayFile, JSON.stringify(xrayConfig(outbound, { socksPort, httpPort, iranDirect: this.settings.iranDirect }), null, 2));
    const xray = new EngineProcess('xray', path.join(this.paths.bin, 'xray.exe'), ['run', '-c', xrayFile], path.join(this.paths.work, 'xray.log'), this.paths.bin);
    this.xray = xray;
    xray.start();
    if (!(await waitForPort(socksPort, 8000, () => xray.alive)) || !(await probeThroughProxy(httpPort))) {
      await this.stop();
      return false;
    }

    const tunFile = path.join(this.paths.work, 'tun.json');
    writePrivate(tunFile, JSON.stringify(singboxTunConfig({ socksPort, strictRoute: this.settings.killSwitch }), null, 2));
    const tun = new EngineProcess(
      'sing-box',
      path.join(this.paths.bin, 'sing-box.exe'),
      ['run', '-c', tunFile, '-D', this.paths.work],
      path.join(this.paths.work, 'sing-box.log'),
      this.paths.bin,
    );
    this.tun = tun;
    tun.start();
    await new Promise((r) => setTimeout(r, 2500));
    if (!tun.alive) {
      await this.stop();
      return false;
    }
    xray.on('exit', ({ expected }: { expected: boolean }) => {
      if (expected) return;
      // With the kill switch the tunnel stays up with nothing behind it, so nothing leaks.
      const blocking = this.settings.killSwitch && tun.alive;
      if (!blocking) void tun.stop();
      this.lost?.(blocking);
    });
    tun.on('exit', ({ expected }: { expected: boolean }) => {
      if (expected) return;
      void xray.stop();
      this.lost?.(false);
    });
    return true;
  }

  async stop(): Promise<void> {
    await this.tun?.stop();
    await this.xray?.stop();
  }
}

class OpenvpnConnection implements Connection {
  readonly engine = 'openvpn' as const;
  private proc: EngineProcess | null = null;
  private managementPort = 0;
  private lost: ((blocking: boolean) => void) | null = null;

  constructor(
    private readonly candidate: Candidate,
    private readonly paths: VpnPaths,
  ) {}

  onLost(cb: (blocking: boolean) => void): void {
    this.lost = cb;
  }

  async start(): Promise<boolean> {
    const profileFile = path.join(this.paths.work, 'profile.ovpn');
    writePrivate(profileFile, openvpnProfile(this.candidate.config.link));
    this.managementPort = await freePort();
    const dir = path.join(this.paths.bin, 'openvpn');
    const proc = new EngineProcess('openvpn', path.join(dir, 'openvpn.exe'), openvpnArgs(profileFile, this.managementPort), path.join(this.paths.work, 'openvpn.log'), dir);
    this.proc = proc;
    proc.start();
    const up = await waitForLine(proc, /Initialization Sequence Completed/, /AUTH_FAILED|Exiting due to fatal error|All TAP-Windows adapters/, 45_000);
    if (!up) {
      await this.stop();
      return false;
    }
    proc.on('exit', ({ expected }: { expected: boolean }) => {
      if (!expected) this.lost?.(false);
    });
    return true;
  }

  async stop(): Promise<void> {
    const proc = this.proc;
    if (!proc?.alive) return;
    // SIGTERM through the management port lets OpenVPN take its routes down itself.
    await new Promise<void>((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port: this.managementPort }, () => socket.end('signal SIGTERM\r\n'));
      socket.on('error', () => resolve());
      socket.on('close', () => resolve());
      setTimeout(resolve, 2000);
    });
    await proc.stop(8000);
  }
}

class L2tpConnection implements Connection {
  readonly engine = 'l2tp' as const;
  private watch: NodeJS.Timeout | null = null;
  private lost: ((blocking: boolean) => void) | null = null;
  rebootNeeded = false;

  constructor(private readonly candidate: Candidate) {}

  onLost(cb: (blocking: boolean) => void): void {
    this.lost = cb;
  }

  async start(): Promise<boolean> {
    const account = l2tpAccount(this.candidate.config.link);
    this.rebootNeeded = await allowL2tpBehindNat();
    const added = await powershell(addConnectionScript(account));
    if (added.code !== 0) return false;
    const dial = await run('rasdial.exe', [l2tpConnectionName, account.username, account.password], 90_000);
    if (dial.code !== 0) return false;
    this.watch = setInterval(async () => {
      const list = await run('rasdial.exe', []);
      if (!list.stdout.includes(l2tpConnectionName)) {
        this.clearWatch();
        this.lost?.(false);
      }
    }, 10_000);
    return true;
  }

  private clearWatch(): void {
    if (this.watch) clearInterval(this.watch);
    this.watch = null;
  }

  async stop(): Promise<void> {
    this.clearWatch();
    await run('rasdial.exe', [l2tpConnectionName, '/disconnect']);
  }
}

export class Vpn extends EventEmitter {
  private current: Status = { state: 'disconnected' };
  private connection: Connection | null = null;
  private zoneBackup: string | null = null;
  private webrtcBackup: WebrtcBackup = {};

  constructor(private readonly paths: VpnPaths) {
    super();
    fs.mkdirSync(paths.work, { recursive: true });
  }

  status(): Status {
    return this.current;
  }

  private set(status: Status): Status {
    this.current = status;
    this.emit('status', status);
    return status;
  }

  async connect(profile: AppProfile, settings: Settings, locationId: number | null): Promise<Status> {
    if (this.current.state !== 'disconnected' || this.current.blocking) await this.disconnect();
    const list = candidates(profile, locationId, settings.protocol);
    if (list.length === 0) return this.set({ state: 'disconnected', error: 'no_config' });
    this.set({ state: 'connecting', locationId });

    let notice: string | undefined;
    for (const candidate of list) {
      if (this.current.state !== 'connecting') return this.current;
      this.set({ state: 'connecting', locationId, configName: candidate.config.name, protocol: candidate.config.protocol });
      const connection = this.connectionFor(candidate, settings);
      let ok = false;
      try {
        ok = await connection.start();
      } catch (err) {
        if (String(err).includes('engine_missing')) notice = 'engine_missing';
      }
      if (connection instanceof L2tpConnection && connection.rebootNeeded) notice = 'reboot_for_l2tp';
      if (!ok) continue;
      if (this.current.state !== 'connecting') {
        await connection.stop();
        return this.current;
      }
      this.connection = connection;
      connection.onLost((blocking) => void this.dropped(blocking));
      await this.applyPrivacy(profile, settings, candidate.config.locationId ?? null);
      return this.set({
        state: 'connected',
        locationId,
        configName: candidate.config.name,
        protocol: candidate.config.protocol,
        since: Date.now(),
        notice,
      });
    }
    return this.set({ state: 'disconnected', error: 'all_failed', notice });
  }

  private connectionFor(candidate: Candidate, settings: Settings): Connection {
    switch (candidate.engine) {
      case 'xray':
        return new XrayConnection(candidate, settings, this.paths);
      case 'openvpn':
        return new OpenvpnConnection(candidate, this.paths);
      default:
        return new L2tpConnection(candidate);
    }
  }

  private async applyPrivacy(profile: AppProfile, settings: Settings, locationId: number | null): Promise<void> {
    if (settings.webrtcProtection) this.webrtcBackup = await protectWebrtc();
    const timezone = profile.locations.find((l) => l.nodeId === locationId)?.timezone;
    if (settings.timezoneSpoof && timezone) this.zoneBackup = await applyZone(timezone);
  }

  private async restorePrivacy(): Promise<void> {
    await restoreWebrtc(this.webrtcBackup);
    this.webrtcBackup = {};
    await restoreZone(this.zoneBackup);
    this.zoneBackup = null;
  }

  private async dropped(blocking: boolean): Promise<void> {
    const previous = this.current;
    if (!blocking) {
      this.connection = null;
      await this.restorePrivacy();
    }
    this.set({ state: 'disconnected', locationId: previous.locationId, error: 'connection_lost', blocking });
  }

  async disconnect(): Promise<Status> {
    const locationId = this.current.locationId;
    this.set({ state: 'disconnecting', locationId });
    const connection = this.connection;
    this.connection = null;
    await connection?.stop();
    await this.restorePrivacy();
    return this.set({ state: 'disconnected', locationId });
  }
}
