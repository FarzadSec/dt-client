import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import type { AppProfile, Engine, LiveSample, Settings, Status } from '../shared/types';
import { candidates, type Candidate } from './candidates';
import { l2tpAccount } from './configs/l2tp';
import { openvpnArgs, openvpnProfile, openvpnPushedAddress, openvpnUdp, unsafeOpenvpnDirective } from './configs/openvpn';
import { singboxTunConfig } from './configs/singbox';
import { dnsServers, proxyOutboundFor, serverNames, systemResolvers, xrayConfig } from './configs/xray';
import { EngineProcess, waitForLine } from './engines/process';
import { freePort, probeThroughProxy, waitForPort } from './health';
import { HttpProbe, googleTest, type TunnelRoute } from './httpProbe';
import { LiveMonitor, type Counters } from './live';
import type { LogFn } from './log';
import type { L2tpDriver, SystemKit } from './os/kit';
import { resolveNames } from './resolve';
import { removeTunnel, WireguardWindowsConnection, wireguardTools } from './wireguardWindows';

export interface VpnPaths {
  bin: string;
  work: string;
}

export interface Connection {
  readonly engine: Engine;
  // The tunnel address the server gave this device, where the engine reports one (OpenVPN).
  readonly address?: string;
  // The connection fetched the test page through the system's routes itself while starting.
  readonly verified?: boolean;
  start(): Promise<boolean>;
  stop(): Promise<void>;
  // Called once if the connection drops by itself; blocking means traffic stays held back.
  onLost(cb: (blocking: boolean) => void): void;
  // Bytes through the tunnel so far, for the live chart; null where the engine cannot tell.
  counters?(): Promise<Counters | null>;
}

function writePrivate(file: string, content: string): void {
  fs.writeFileSync(file, content, { mode: 0o600 });
}

// An engine's output goes to the session log under its name, and its exit is noted there.
function logged(proc: EngineProcess, log: LogFn): EngineProcess {
  proc.on('line', (line: string) => log(proc.name, line));
  proc.on('exit', ({ code, expected }: { code: number | null; expected: boolean }) => log('vpn', `${proc.name} exited (code ${code ?? 'none'}${expected ? ', stopped by the app' : ''})`));
  return proc;
}

class XrayConnection implements Connection {
  readonly engine = 'xray' as const;
  private xray: EngineProcess | null = null;
  private tun: EngineProcess | null = null;
  private lost: ((blocking: boolean) => void) | null = null;
  private controller: { port: number; secret: string } | null = null;

  constructor(
    private readonly candidate: Candidate,
    private readonly settings: Settings,
    private readonly paths: VpnPaths,
    private readonly kit: SystemKit,
    private readonly log: LogFn,
  ) {}

  onLost(cb: (blocking: boolean) => void): void {
    this.lost = cb;
  }

  // sing-box's totals of everything the tunnel carried, from its local control port.
  async counters(): Promise<Counters | null> {
    const c = this.controller;
    if (!c || !this.tun?.alive) return null;
    try {
      const res = await fetch(`http://127.0.0.1:${c.port}/connections`, { headers: { Authorization: `Bearer ${c.secret}` }, signal: AbortSignal.timeout(1500) });
      if (!res.ok) return null;
      const body = (await res.json()) as { downloadTotal?: unknown; uploadTotal?: unknown };
      return typeof body.downloadTotal === 'number' && typeof body.uploadTotal === 'number' ? { rx: body.downloadTotal, tx: body.uploadTotal } : null;
    } catch {
      return null;
    }
  }

  async start(): Promise<boolean> {
    const socksPort = await freePort();
    const httpPort = await freePort();
    const xrayFile = path.join(this.paths.work, 'xray.json');
    const outbound = proxyOutboundFor(this.candidate.config);
    const dns = dnsServers(this.settings.dns);
    // Resolved now, while the system's resolver still answers outside any tunnel.
    const names = serverNames(outbound);
    const hosts = await resolveNames(names);
    for (const name of names) this.log('vpn', hosts[name] ? `${name} is ${hosts[name].join(', ')}` : `${name} did not resolve; Xray will try it itself`);
    const options = { socksPort, httpPort, iranDirect: this.settings.iranDirect, adBlock: this.settings.adBlock, dns, hosts };
    const xrayExe = path.join(this.paths.bin, this.kit.exe('xray'));
    const startXray = async (logLevel: 'info' | 'warning') => {
      writePrivate(xrayFile, JSON.stringify(xrayConfig(outbound, { ...options, logLevel }), null, 2));
      const proc = logged(new EngineProcess('xray', xrayExe, ['run', '-c', xrayFile], path.join(this.paths.work, 'xray.log'), this.paths.bin), this.log);
      this.xray = proc;
      proc.start();
      const ready = await waitForPort(socksPort, 8000, () => proc.alive);
      if (!ready) this.log('vpn', proc.alive ? 'Xray did not open its local port in 8 s' : 'Xray stopped before it was ready (its error is above)');
      return ready ? proc : null;
    };
    // Tested with Xray's detailed log, which then shows only the test page's connection.
    if (!(await startXray('info'))) {
      await this.stop();
      return false;
    }
    const started = Date.now();
    if (!(await probeThroughProxy(httpPort, 12_000))) {
      this.log('vpn', `no answer through this config (test page https://www.gstatic.com/generate_204, ${Date.now() - started} ms)`);
      await this.stop();
      return false;
    }
    this.log('vpn', `the test page answered through it in ${Date.now() - started} ms`);
    // Run again with the short log before the user's traffic goes through it.
    await this.xray?.stop();
    const xray = await startXray('warning');
    if (!xray) {
      await this.stop();
      return false;
    }

    const tunFile = path.join(this.paths.work, 'tun.json');
    const bypassApps = this.settings.splitTunneling ? this.settings.splitApps.map((a) => a.name) : [];
    this.controller = { port: await freePort(), secret: randomBytes(16).toString('hex') };
    // Strict routes keep DNS and anything else from leaving around the tunnel (and are the kill switch).
    const strictRoute = this.settings.killSwitch || this.settings.leakProtection !== false;
    const tunConfig = singboxTunConfig({ os: this.kit.os, interfaceName: this.kit.tunName, socksPort, strictRoute, dns: dns[0], bypassApps, controller: this.controller });
    writePrivate(tunFile, JSON.stringify(tunConfig, null, 2));
    const tun = logged(
      new EngineProcess('sing-box', path.join(this.paths.bin, this.kit.exe('sing-box')), ['run', '-c', tunFile, '-D', this.paths.work], path.join(this.paths.work, 'sing-box.log'), this.paths.bin),
      this.log,
    );
    this.tun = tun;
    tun.start();
    await new Promise((r) => setTimeout(r, 2500));
    if (!tun.alive) {
      this.log('vpn', 'the system tunnel (sing-box) stopped while starting (its error is above)');
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

// The exit notification takes about a second (openvpnExitNotify); more is a stuck OpenVPN.
const openvpnExitGraceMs = 5000;

// OpenVPN's management port takes one client at a time: once connected the app keeps it, reads the
// byte counts it reports each second, and sends the SIGTERM through it when disconnecting.
class ManagementLink {
  private socket: net.Socket | null = null;
  totals: Counters | null = null;

  open(port: number): void {
    const socket = net.connect({ host: '127.0.0.1', port });
    this.socket = socket;
    let buffered = '';
    socket.on('connect', () => socket.write('bytecount 1\r\n'));
    socket.on('data', (d: Buffer) => {
      buffered += d.toString('latin1');
      let at: number;
      while ((at = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, at).trim();
        buffered = buffered.slice(at + 1);
        const m = /^>BYTECOUNT:(\d+),(\d+)/.exec(line);
        if (m) this.totals = { rx: Number(m[1]), tx: Number(m[2]) };
      }
      if (buffered.length > 65536) buffered = '';
    });
    socket.on('error', () => undefined);
    socket.on('close', () => {
      if (this.socket === socket) this.socket = null;
    });
  }

  // True when the signal went through this link.
  signal(name: string): Promise<boolean> {
    const socket = this.socket;
    if (!socket || socket.destroyed || !socket.writable) return Promise.resolve(false);
    return new Promise((resolve) => socket.write(`signal ${name}\r\n`, (err) => resolve(!err)));
  }

  close(): void {
    this.socket?.destroy();
    this.socket = null;
  }
}

class OpenvpnConnection implements Connection {
  readonly engine = 'openvpn' as const;
  private proc: EngineProcess | null = null;
  private managementPort = 0;
  private management = new ManagementLink();
  private udp = true;
  address: string | undefined;
  private lost: ((blocking: boolean) => void) | null = null;

  constructor(
    private readonly candidate: Candidate,
    private readonly settings: Settings,
    private readonly paths: VpnPaths,
    private readonly kit: SystemKit,
    private readonly log: LogFn,
  ) {}

  onLost(cb: (blocking: boolean) => void): void {
    this.lost = cb;
  }

  async start(): Promise<boolean> {
    const exe = this.kit.openvpnBinary(this.paths.bin);
    if (!exe) throw new Error('engine_missing:openvpn');
    let profile: string;
    try {
      profile = openvpnProfile(this.candidate.config.link);
    } catch {
      this.log('vpn', 'this OpenVPN link carries no profile');
      return false;
    }
    const unsafe = unsafeOpenvpnDirective(profile);
    if (unsafe) {
      this.log('vpn', `the profile has '${unsafe}', which the app does not run`);
      return false;
    }
    this.udp = openvpnUdp(profile);
    const profileFile = path.join(this.paths.work, 'profile.ovpn');
    writePrivate(profileFile, profile);
    // Windows: OpenVPN only opens an adapter that already exists, so the app makes its own first.
    const dco = (await this.kit.openvpnPrepare?.(this.paths.bin, this.log)) ?? false;
    let up = await this.run(exe, profileFile, false);
    // Data Channel Offload refuses some servers' settings; TAP takes any.
    if (!up.ok && dco && up.dcoTrouble && !up.authFailed) {
      this.log('vpn', 'trying again without Data Channel Offload (TAP adapter)');
      up = await this.run(exe, profileFile, true);
    }
    if (!up.ok) return false;
    await this.kit.openvpnUp(dnsServers(this.settings.dns));
    this.proc?.on('exit', ({ expected }: { expected: boolean }) => {
      this.management.close();
      if (!expected) this.lost?.(false);
    });
    this.management.open(this.managementPort);
    return true;
  }

  async counters(): Promise<Counters | null> {
    return this.management.totals;
  }

  private async run(exe: string, profileFile: string, disableDco: boolean): Promise<{ ok: boolean; dcoTrouble: boolean; authFailed: boolean }> {
    this.managementPort = await freePort();
    const proc = logged(
      new EngineProcess('openvpn', exe, openvpnArgs(profileFile, this.managementPort, this.kit.os, { disableDco, udp: this.udp }), path.join(this.paths.work, 'openvpn.log'), path.dirname(exe)),
      this.log,
    );
    this.proc = proc;
    let dcoTrouble = false;
    let authFailed = false;
    let fatal = false;
    const watch = (line: string) => {
      if (/dco|data channel offload/i.test(line) && /error|fail|not supported|unable|cannot|disabl/i.test(line)) dcoTrouble = true;
      if (/AUTH_FAILED/.test(line)) authFailed = true;
      this.address = openvpnPushedAddress(line) ?? this.address;
      if (/Exiting due to fatal error|There are no TAP-Windows|currently in use or disabled/.test(line)) fatal = true;
    };
    proc.on('line', watch);
    proc.start();
    const ok = await waitForLine(proc, /Initialization Sequence Completed/, /AUTH_FAILED|Exiting due to fatal error|There are no TAP-Windows|adapters on this system are currently in use or disabled/, 45_000);
    proc.off('line', watch);
    if (!ok) {
      fatal = fatal || !proc.alive;
      this.log('vpn', authFailed ? 'the server refused the login (AUTH_FAILED)' : fatal ? 'OpenVPN stopped with an error (above)' : 'OpenVPN did not finish connecting in 45 s');
      await this.stop();
    }
    // A timeout is the network's doing; an error at start may be the adapter's.
    return { ok, dcoTrouble: dcoTrouble || fatal, authFailed };
  }

  async stop(): Promise<void> {
    const proc = this.proc;
    if (!proc?.alive) return;
    proc.expectExit();
    // SIGTERM through the management port lets OpenVPN tell the server it is leaving and take its
    // routes down itself. It has to be given the time: killing it at once (on Windows a kill ends the
    // process outright) left the server holding the session, and the account's seat, for two minutes.
    if (!(await this.management.signal('SIGTERM'))) await new Promise<void>((resolve) => {
      // Sent is enough; the process's exit, awaited below, is what says OpenVPN is done.
      const socket = net.connect({ host: '127.0.0.1', port: this.managementPort }, () => socket.end('signal SIGTERM\r\n', () => resolve()));
      socket.on('error', () => resolve());
      socket.on('close', () => resolve());
      setTimeout(resolve, 2000);
    });
    if (!(await proc.exited(openvpnExitGraceMs))) this.log('vpn', `OpenVPN had not exited ${openvpnExitGraceMs / 1000} s after SIGTERM; stopping it`);
    this.management.close();
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
    private readonly log: LogFn,
  ) {}

  onLost(cb: (blocking: boolean) => void): void {
    this.lost = cb;
  }

  async start(): Promise<boolean> {
    let account;
    try {
      account = l2tpAccount(this.candidate.config.link);
    } catch {
      this.log('vpn', 'this L2TP link carries no account');
      return false;
    }
    this.log('vpn', `L2TP to ${account.host} as ${account.username}`);
    const result = await this.driver.connect(account, this.log);
    this.notice = result.notice;
    if (!result.ok) {
      this.log('vpn', `L2TP did not connect${result.notice ? ` (${result.notice})` : ''}`);
      return false;
    }
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

  async counters(): Promise<Counters | null> {
    return (await this.driver.counters?.()) ?? null;
  }

  async stop(): Promise<void> {
    this.clearWatch();
    await this.driver.disconnect();
  }
}

export class Vpn extends EventEmitter {
  private current: Status = { state: 'disconnected' };
  private connection: Connection | null = null;
  // The connection being started, so a disconnect can stop it, and the attempt it belongs to:
  // a newer connect or a disconnect ends an attempt, which then leaves the status alone.
  private pending: Connection | null = null;
  private attempt = 0;
  private zoneBackup: string | null = null;
  private webrtcBackup: Record<string, string | null> = {};
  // System DNS changes (macOS), run one at a time in the order they were asked for.
  private dnsQueue: Promise<void> = Promise.resolve();
  private readonly dnsBackup: string;
  private monitor: LiveMonitor | null = null;
  private readonly ipv6Backup: string;
  private ipv6Blocked = false;
  // What the connection up now was asked with, for a switch when it stops passing traffic.
  private asked: { profile: AppProfile; settings: Settings; locationId: number | null } | null = null;

  constructor(
    private readonly paths: VpnPaths,
    private readonly kit: SystemKit,
    private readonly log: LogFn = () => undefined,
    // Tests: the traffic check and the live monitor without the network.
    private readonly options: { checkTraffic?: () => Promise<boolean>; live?: boolean } = {},
  ) {
    super();
    fs.mkdirSync(paths.work, { recursive: true });
    this.dnsBackup = path.join(paths.work, 'dns-backup.json');
    this.ipv6Backup = path.join(paths.work, 'ipv6-backup.json');
    // A WireGuard tunnel left by a run that ended without disconnecting (a crash, a power cut).
    const tools = kit.os === 'windows' ? wireguardTools(paths.bin) : null;
    if (tools) void removeTunnel(tools, log);
    // Likewise the system's resolvers, still pointed at the tunnel, and IPv6 still held back.
    void this.restoreSystemDns();
    void this.kit.restoreIpv6?.(this.ipv6Backup).catch(() => false);
  }

  private queueDns(task: () => Promise<void>): Promise<void> {
    this.dnsQueue = this.dnsQueue.then(task).catch((err: unknown) => this.log('vpn', `system DNS: ${err instanceof Error ? err.message : String(err)}`));
    return this.dnsQueue;
  }

  // Xray (V2Ray and WireGuard) and OpenVPN tunnels; L2TP sets its own.
  private pointSystemDns(connection: Connection, settings: Settings): Promise<void> {
    if (!this.kit.applyDns || (connection.engine !== 'xray' && connection.engine !== 'openvpn')) return Promise.resolve();
    const servers = systemResolvers(settings.dns);
    return this.queueDns(async () => {
      const services = (await this.kit.applyDns?.(servers, this.dnsBackup)) ?? [];
      this.log('vpn', `system DNS set to ${servers.join(', ')} while connected (${services.length > 0 ? services.join(', ') : 'no network service took it'})`);
    });
  }

  private restoreSystemDns(): Promise<void> {
    if (!this.kit.restoreDns) return Promise.resolve();
    return this.queueDns(async () => {
      if (await this.kit.restoreDns?.(this.dnsBackup)) this.log('vpn', 'system DNS restored');
    });
  }

  status(): Status {
    return this.current;
  }

  private set(status: Status): Status {
    this.current = status;
    this.emit('status', status);
    return status;
  }

  // avoid: a protocol that just stopped passing traffic, tried after the others (Auto's switch).
  async connect(profile: AppProfile, settings: Settings, locationId: number | null, latency?: Map<string, number | null>, avoid?: string): Promise<Status> {
    if (this.current.state !== 'disconnected' || this.current.blocking || this.pending) await this.disconnect();
    const attempt = ++this.attempt;
    const list = candidates(profile, locationId, settings.protocol, latency, avoid);
    this.log('vpn', `connect to ${locationId === null ? 'the fastest location' : `location ${locationId}`}, protocol ${settings.protocol}: ${list.length} config(s) to try`);
    if (list.length === 0) return this.set({ state: 'disconnected', error: 'no_config' });
    this.set({ state: 'connecting', locationId });

    let notice: string | undefined;
    let silent = 0;
    for (const [i, candidate] of list.entries()) {
      if (attempt !== this.attempt) return this.current;
      const serverId = candidate.config.locationId ?? null;
      this.set({ state: 'connecting', locationId, serverId, configName: candidate.config.name, protocol: candidate.config.protocol });
      this.log('vpn', `(${i + 1}/${list.length}) trying ${candidate.config.protocol} "${candidate.config.name}" of location ${serverId ?? '-'}`);
      const connection = this.connectionFor(candidate, settings);
      if (!connection) {
        this.log('vpn', 'this system cannot run it');
        continue;
      }
      let ok = false;
      const started = Date.now();
      this.pending = connection;
      try {
        ok = await connection.start();
        // Up is not enough: the test page has to come back through the tunnel, or nothing would.
        if (ok && !connection.verified && attempt === this.attempt) {
          ok = await (this.options.checkTraffic ?? (() => this.passesTraffic(this.tunnelRoute(connection, settings))))();
          if (!ok) {
            silent++;
            this.log('vpn', 'the tunnel is up but the test page did not come back through it; trying the next');
            await connection.stop();
          }
        }
      } catch (err) {
        this.log('vpn', `failed: ${err instanceof Error ? err.message : String(err)}`);
        if (String(err).includes('engine_missing:openvpn') && this.kit.os !== 'windows') notice = this.kit.os === 'macos' ? 'openvpn_missing_mac' : 'openvpn_missing';
        else if (String(err).includes('engine_missing')) notice = 'engine_missing';
      }
      if (this.pending === connection) this.pending = null;
      if (connection instanceof L2tpConnection && connection.notice) notice = connection.notice;
      this.log('vpn', ok ? `connected in ${Date.now() - started} ms` : `did not connect (${Date.now() - started} ms)`);
      if (!ok) {
        // A WireGuard try reaches the server even when it fails, and the panel counts the account's
        // seat until the peer has been quiet a while: it is told the device left at once.
        if (candidate.config.protocol === 'wireguard') this.emit('attemptFailed', { protocol: 'wireguard', locationId: serverId });
        continue;
      }
      if (attempt !== this.attempt) {
        await connection.stop();
        return this.current;
      }
      this.connection = connection;
      connection.onLost((blocking) => void this.dropped(blocking));
      // Queued before anything below can wait, so a disconnect's restore always comes after it.
      await this.pointSystemDns(connection, settings);
      await this.applyPrivacy(profile, settings, candidate.config.locationId ?? null, connection.engine);
      // A disconnect while those ran has already stopped the connection and set the status.
      if (attempt !== this.attempt) return this.current;
      this.asked = { profile, settings, locationId };
      const status = this.set({
        state: 'connected',
        locationId,
        serverId,
        configName: candidate.config.name,
        protocol: candidate.config.protocol,
        address: (connection as Connection).address,
        since: Date.now(),
        notice: notice ?? (avoid && candidate.config.protocol !== avoid ? 'switched' : undefined),
      });
      this.watch(connection, attempt);
      return status;
    }
    if (attempt !== this.attempt) return this.current;
    this.log('vpn', 'no config connected');
    // A chosen protocol that would not carry traffic now: the user is told to pick another.
    const error = settings.protocol !== 'auto' ? 'protocol_failed' : 'all_failed';
    return this.set({ state: 'disconnected', error, notice: notice ?? (silent > 0 ? 'no_traffic' : undefined) });
  }

  // Google's empty page through the system's routes, a few tries while routes and DNS settle.
  // OpenVPN's test page goes out from the address the server gave, through the tunnel's own lookups.
  private tunnelRoute(connection: Connection, settings: Settings): TunnelRoute | null {
    if (connection.engine !== 'openvpn' || !connection.address || !net.isIPv4(connection.address)) return null;
    return { localAddress: connection.address, resolvers: systemResolvers(settings.dns) };
  }

  private async passesTraffic(route: TunnelRoute | null): Promise<boolean> {
    const probe = new HttpProbe(googleTest, null, false, route);
    try {
      for (let i = 0; i < 3; i++) {
        const r = await probe.measure(6000);
        if (r.ok) {
          this.log('vpn', `the test page came back through the tunnel in ${r.ms} ms`);
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      return false;
    } finally {
      probe.close();
    }
  }

  // The live chart's samples while connected, and what happens when traffic stops passing: Auto moves
  // to another protocol; a chosen protocol stays, with a warning that it does not carry traffic now.
  private watch(connection: Connection, attempt: number): void {
    this.monitor?.stop();
    if (this.options.live === false) return;
    const route = this.asked ? this.tunnelRoute(connection, this.asked.settings) : null;
    const monitor = new LiveMonitor({
      probe: new HttpProbe(googleTest, null, false, route),
      counters: () => connection.counters?.() ?? Promise.resolve(null),
      onSample: (sample: LiveSample) => this.emit('live', sample),
      onStall: () => {
        if (attempt !== this.attempt || this.connection !== connection) return;
        const asked = this.asked;
        const protocol = this.current.protocol;
        if (asked && asked.settings.protocol === 'auto' && protocol) {
          this.log('vpn', `${protocol} stopped passing traffic; Auto tries another protocol`);
          void this.connect(asked.profile, asked.settings, asked.locationId, undefined, protocol);
          return;
        }
        this.log('vpn', `${protocol ?? 'the connection'} stopped passing traffic`);
        this.set({ ...this.current, notice: 'stalled' });
      },
      onRecover: () => {
        if (this.connection !== connection) return;
        this.log('vpn', 'traffic passes again');
        if (this.current.notice === 'stalled') this.set({ ...this.current, notice: undefined });
      },
    });
    this.monitor = monitor;
    monitor.start();
  }

  private stopWatch(): void {
    this.monitor?.stop();
    this.monitor = null;
  }

  private connectionFor(candidate: Candidate, settings: Settings): Connection | null {
    switch (candidate.engine) {
      case 'xray':
        // Windows runs WireGuard on the official engine; Xray's own WireGuard stays the fallback.
        if (candidate.config.protocol === 'wireguard' && this.kit.os === 'windows') {
          const tools = wireguardTools(this.paths.bin);
          if (tools) return new WireguardWindowsConnection(candidate, settings, tools, this.paths.bin, this.paths.work, this.log);
          this.log('vpn', 'the WireGuard engine is missing from the app; trying Xray\'s WireGuard');
        }
        return new XrayConnection(candidate, settings, this.paths, this.kit, this.log);
      case 'openvpn':
        return new OpenvpnConnection(candidate, settings, this.paths, this.kit, this.log);
      default:
        return this.kit.l2tp ? new L2tpConnection(candidate, this.kit.l2tp, this.log) : null;
    }
  }

  private async applyPrivacy(profile: AppProfile, settings: Settings, locationId: number | null, engine?: Engine): Promise<void> {
    // OpenVPN and L2TP carry IPv4 only: IPv6 would leave around them from the real address.
    if (settings.leakProtection !== false && (engine === 'openvpn' || engine === 'l2tp') && this.kit.blockIpv6) {
      this.ipv6Blocked = true;
      const ok = await this.kit.blockIpv6(this.ipv6Backup).catch(() => false);
      this.log('vpn', ok ? 'IPv6 outside the tunnel is blocked while connected' : 'blocking IPv6 outside the tunnel did not work');
    }
    if (settings.webrtcProtection) this.webrtcBackup = await this.kit.protectWebrtc();
    const timezone = profile.locations.find((l) => l.id === locationId)?.timezone;
    if (settings.timezoneSpoof && timezone) this.zoneBackup = await this.kit.applyZone(timezone);
  }

  private async restorePrivacy(): Promise<void> {
    await this.kit.restoreWebrtc(this.webrtcBackup);
    this.webrtcBackup = {};
    await this.kit.restoreZone(this.zoneBackup);
    this.zoneBackup = null;
    await this.restoreSystemDns();
    if (this.ipv6Blocked) {
      this.ipv6Blocked = false;
      await this.kit.restoreIpv6?.(this.ipv6Backup).catch(() => false);
      this.log('vpn', 'IPv6 restored');
    }
  }

  private async dropped(blocking: boolean): Promise<void> {
    this.stopWatch();
    const previous = this.current;
    this.log('vpn', blocking ? 'the connection dropped; the kill switch holds traffic back' : 'the connection dropped');
    if (!blocking) {
      this.connection = null;
      await this.restorePrivacy();
    }
    this.set({ state: 'disconnected', locationId: previous.locationId, error: 'connection_lost', blocking });
  }

  async disconnect(): Promise<Status> {
    const locationId = this.current.locationId;
    if (this.connection || this.pending || this.current.state !== 'disconnected') this.log('vpn', 'disconnecting');
    // Ends the attempt in progress too: its engine stops now instead of finishing its test.
    this.attempt++;
    this.stopWatch();
    this.asked = null;
    this.set({ state: 'disconnecting', locationId });
    const connection = this.connection;
    const pending = this.pending;
    this.connection = null;
    this.pending = null;
    await Promise.all([connection?.stop(), pending?.stop()]);
    await this.restorePrivacy();
    return this.set({ state: 'disconnected', locationId });
  }
}
