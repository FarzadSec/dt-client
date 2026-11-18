import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import type { AppProfile, Engine, Settings, Status } from '../shared/types';
import { candidates, type Candidate } from './candidates';
import { l2tpAccount } from './configs/l2tp';
import { openvpnArgs, openvpnProfile, unsafeOpenvpnDirective } from './configs/openvpn';
import { singboxTunConfig } from './configs/singbox';
import { dnsServers, xrayConfig } from './configs/xray';
import { EngineProcess, waitForLine } from './engines/process';
import { freePort, probeThroughProxy, waitForPort } from './health';
import type { L2tpDriver, SystemKit } from './os/kit';

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
    private readonly kit: SystemKit,
  ) {}

  onLost(cb: (blocking: boolean) => void): void {
    this.lost = cb;
  }

  async start(): Promise<boolean> {
    const socksPort = await freePort();
    const httpPort = await freePort();
    const xrayFile = path.join(this.paths.work, 'xray.json');
    const outbound = this.candidate.config.outbound ?? {};
    const dns = dnsServers(this.settings.dns);
    const cfg = xrayConfig(outbound, { socksPort, httpPort, iranDirect: this.settings.iranDirect, adBlock: this.settings.adBlock, dns });
    writePrivate(xrayFile, JSON.stringify(cfg, null, 2));
    const xray = new EngineProcess('xray', path.join(this.paths.bin, this.kit.exe('xray')), ['run', '-c', xrayFile], path.join(this.paths.work, 'xray.log'), this.paths.bin);
    this.xray = xray;
    xray.start();
    if (!(await waitForPort(socksPort, 8000, () => xray.alive)) || !(await probeThroughProxy(httpPort))) {
      await this.stop();
      return false;
    }

    const tunFile = path.join(this.paths.work, 'tun.json');
    const bypassApps = this.settings.splitTunneling ? this.settings.splitApps.map((a) => a.name) : [];
    const tunConfig = singboxTunConfig({ os: this.kit.os, interfaceName: this.kit.tunName, socksPort, strictRoute: this.settings.killSwitch, dns: dns[0], bypassApps });
    writePrivate(tunFile, JSON.stringify(tunConfig, null, 2));
    const tun = new EngineProcess(
      'sing-box',
      path.join(this.paths.bin, this.kit.exe('sing-box')),
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
    private readonly settings: Settings,
    private readonly paths: VpnPaths,
    private readonly kit: SystemKit,
  ) {}

  onLost(cb: (blocking: boolean) => void): void {
    this.lost = cb;
  }

  async start(): Promise<boolean> {
    const exe = this.kit.openvpnBinary(this.paths.bin);
    if (!exe) throw new Error('engine_missing:openvpn');
    const profile = openvpnProfile(this.candidate.config.link);
    if (unsafeOpenvpnDirective(profile)) return false;
    const profileFile = path.join(this.paths.work, 'profile.ovpn');
    writePrivate(profileFile, profile);
    this.managementPort = await freePort();
    const proc = new EngineProcess('openvpn', exe, openvpnArgs(profileFile, this.managementPort, this.kit.os), path.join(this.paths.work, 'openvpn.log'), path.dirname(exe));
    this.proc = proc;
    proc.start();
    const up = await waitForLine(proc, /Initialization Sequence Completed/, /AUTH_FAILED|Exiting due to fatal error|All TAP-Windows adapters/, 45_000);
    if (!up) {
      await this.stop();
      return false;
    }
    await this.kit.openvpnUp(dnsServers(this.settings.dns));
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
  notice: string | undefined;

  constructor(
    private readonly candidate: Candidate,
    private readonly driver: L2tpDriver,
  ) {}

  onLost(cb: (blocking: boolean) => void): void {
    this.lost = cb;
  }

  async start(): Promise<boolean> {
    const result = await this.driver.connect(l2tpAccount(this.candidate.config.link));
    this.notice = result.notice;
    if (!result.ok) return false;
    this.watch = setInterval(async () => {
      if (!(await this.driver.isUp())) {
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
    await this.driver.disconnect();
  }
}

export class Vpn extends EventEmitter {
  private current: Status = { state: 'disconnected' };
  private connection: Connection | null = null;
  private zoneBackup: string | null = null;
  private webrtcBackup: Record<string, string | null> = {};

  constructor(
    private readonly paths: VpnPaths,
    private readonly kit: SystemKit,
  ) {
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

  async connect(profile: AppProfile, settings: Settings, locationId: number | null, latency?: Map<string, number | null>): Promise<Status> {
    if (this.current.state !== 'disconnected' || this.current.blocking) await this.disconnect();
    const list = candidates(profile, locationId, settings.protocol, latency);
    if (list.length === 0) return this.set({ state: 'disconnected', error: 'no_config' });
    this.set({ state: 'connecting', locationId });

    let notice: string | undefined;
    for (const candidate of list) {
      if (this.current.state !== 'connecting') return this.current;
      const serverId = candidate.config.locationId ?? null;
      this.set({ state: 'connecting', locationId, serverId, configName: candidate.config.name, protocol: candidate.config.protocol });
      const connection = this.connectionFor(candidate, settings);
      if (!connection) continue;
      let ok = false;
      try {
        ok = await connection.start();
      } catch (err) {
        if (String(err).includes('engine_missing:openvpn') && this.kit.os !== 'windows') notice = this.kit.os === 'macos' ? 'openvpn_missing_mac' : 'openvpn_missing';
        else if (String(err).includes('engine_missing')) notice = 'engine_missing';
      }
      if (connection instanceof L2tpConnection && connection.notice) notice = connection.notice;
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
        serverId,
        configName: candidate.config.name,
        protocol: candidate.config.protocol,
        since: Date.now(),
        notice,
      });
    }
    return this.set({ state: 'disconnected', error: 'all_failed', notice });
  }

  private connectionFor(candidate: Candidate, settings: Settings): Connection | null {
    switch (candidate.engine) {
      case 'xray':
        return new XrayConnection(candidate, settings, this.paths, this.kit);
      case 'openvpn':
        return new OpenvpnConnection(candidate, settings, this.paths, this.kit);
      default:
        return this.kit.l2tp ? new L2tpConnection(candidate, this.kit.l2tp) : null;
    }
  }

  private async applyPrivacy(profile: AppProfile, settings: Settings, locationId: number | null): Promise<void> {
    if (settings.webrtcProtection) this.webrtcBackup = await this.kit.protectWebrtc();
    const timezone = profile.locations.find((l) => l.id === locationId)?.timezone;
    if (settings.timezoneSpoof && timezone) this.zoneBackup = await this.kit.applyZone(timezone);
  }

  private async restorePrivacy(): Promise<void> {
    await this.kit.restoreWebrtc(this.webrtcBackup);
    this.webrtcBackup = {};
    await this.kit.restoreZone(this.zoneBackup);
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
