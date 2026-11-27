import dns from 'node:dns';
import net from 'node:net';
import tls from 'node:tls';

// Fetches the test page (https://www.google.com/generate_204) the way the panel's outbound test does:
// a first, cold request proves the way works; the delay is a second request on the same kept-alive
// connection, the real round trip through the tunnel without the handshakes of setting it up.
// Any HTTP answer counts; only a connection that fails or stays silent does not.

export interface ProbeTarget {
  host: string;
  port: number;
  path: string;
}

export const googleTest: ProbeTarget = { host: 'www.google.com', port: 443, path: '/generate_204' };

// Reads one HTTP response off a stream: the head, then its body by Content-Length or chunks.
class ResponseReader {
  private buf = Buffer.alloc(0);
  private waiting: ((ok: boolean) => void) | null = null;

  push(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk]);
    this.check();
  }

  fail(): void {
    const w = this.waiting;
    this.waiting = null;
    w?.(false);
  }

  next(): Promise<boolean> {
    return new Promise((resolve) => {
      this.waiting = resolve;
      this.check();
    });
  }

  private check(): void {
    if (!this.waiting) return;
    const end = this.buf.indexOf('\r\n\r\n');
    if (end < 0) return;
    const head = this.buf.subarray(0, end).toString('latin1');
    if (!/^HTTP\/1\.[01] \d{3}/.test(head)) return this.finish(false, 0);
    const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(head)?.[1]);
    const length = /\r\ncontent-length:\s*(\d+)/i.exec(head);
    const chunked = /\r\ntransfer-encoding:\s*chunked/i.test(head);
    const bodyStart = end + 4;
    if (status === 204 || status === 304 || (length && Number(length[1]) === 0)) return this.finish(true, bodyStart);
    if (length) {
      const total = bodyStart + Number(length[1]);
      if (this.buf.length >= total) this.finish(true, total);
      return;
    }
    if (chunked) {
      const last = this.buf.indexOf('\r\n0\r\n\r\n', bodyStart - 2);
      if (last >= 0) this.finish(true, last + 7);
      return;
    }
    // No length: the answer is there, the connection will not be reused.
    this.finish(true, this.buf.length);
  }

  private finish(ok: boolean, consumed: number): void {
    this.buf = this.buf.subarray(consumed);
    const w = this.waiting;
    this.waiting = null;
    w?.(ok);
  }
}

// A SOCKS5 CONNECT to the target through a local SOCKS port (no authentication), with the name sent as is.
function socksConnect(port: number, target: ProbeTarget, timeoutMs: number): Promise<net.Socket | null> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let step = 0;
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => done(null), timeoutMs);
    const done = (result: net.Socket | null) => {
      clearTimeout(timer);
      socket.removeAllListeners('data');
      if (!result) socket.destroy();
      resolve(result);
    };
    socket.once('error', () => done(null));
    socket.once('connect', () => socket.write(Buffer.from([5, 1, 0])));
    socket.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (step === 0) {
        if (buf.length < 2) return;
        if (buf[0] !== 5 || buf[1] !== 0) return done(null);
        buf = buf.subarray(2);
        step = 1;
        const name = Buffer.from(target.host);
        socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, name.length]), name, Buffer.from([target.port >> 8, target.port & 0xff])]));
      }
      if (step === 1) {
        if (buf.length < 5) return;
        if (buf[0] !== 5 || buf[1] !== 0) return done(null);
        const addrLen = buf[3] === 1 ? 4 : buf[3] === 4 ? 16 : 1 + buf[4];
        if (buf.length < 4 + addrLen + 2) return;
        done(socket);
      }
    });
  });
}

// A probe pinned to a tunnel: its name looked up and its connection made from the tunnel's own address.
// The system's routes and resolvers settle a while after OpenVPN comes up (Windows above all), and a
// probe through them failed connections that carried traffic fine.
export interface TunnelRoute {
  localAddress: string;
  resolvers: string[];
}

export async function resolveThrough(route: TunnelRoute, name: string, timeoutMs: number): Promise<string | null> {
  if (net.isIP(name)) return name;
  const resolver = new dns.promises.Resolver({ timeout: Math.max(500, Math.min(3000, timeoutMs)), tries: 2 });
  try {
    resolver.setLocalAddress(route.localAddress);
    resolver.setServers(route.resolvers.filter((r) => net.isIPv4(r)));
    const answer = await Promise.race([resolver.resolve4(name), new Promise<string[]>((resolve) => setTimeout(() => resolve([]), timeoutMs))]);
    return answer[0] ?? null;
  } catch {
    return null;
  } finally {
    resolver.cancel();
  }
}

export interface ProbeResult {
  ok: boolean;
  // The warm request's time, or the cold one's when the warm one failed.
  ms: number | null;
  cold: number | null;
}

// A kept-alive TLS connection that can be asked again and again (the live ping of a connection).
export class HttpProbe {
  private secure: tls.TLSSocket | null = null;
  private reader: ResponseReader | null = null;
  private busy = false;

  constructor(
    private readonly target: ProbeTarget = googleTest,
    // The local SOCKS port to go through; null uses the system's routes (the tunnel, once it is up).
    private readonly socksPort: number | null = null,
    // Tests only: a local test server's certificate is its own.
    private readonly insecure = false,
    private readonly route: TunnelRoute | null = null,
  ) {}

  private async open(timeoutMs: number): Promise<boolean> {
    this.close();
    const started = Date.now();
    let raw: net.Socket | null;
    if (this.socksPort !== null) raw = await socksConnect(this.socksPort, this.target, timeoutMs);
    else raw = null;
    const address = this.route && !raw ? await resolveThrough(this.route, this.target.host, timeoutMs) : this.target.host;
    if (!address) return false;
    const left = Math.max(500, timeoutMs - (Date.now() - started));
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!ok) this.close();
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), left);
      const local = this.route && !raw ? { localAddress: this.route.localAddress } : {};
      const options: tls.ConnectionOptions = raw ? { socket: raw, servername: this.target.host } : { host: address, port: this.target.port, servername: this.target.host, ...local };
      if (this.socksPort !== null && !raw) return finish(false);
      const secure = tls.connect({ ...options, ALPNProtocols: ['http/1.1'], ...(this.insecure ? { rejectUnauthorized: false } : {}) });
      const reader = new ResponseReader();
      this.secure = secure;
      this.reader = reader;
      secure.on('data', (d: Buffer) => reader.push(d));
      secure.once('error', () => {
        reader.fail();
        finish(false);
        this.close();
      });
      secure.once('close', () => {
        reader.fail();
        if (this.secure === secure) {
          this.secure = null;
          this.reader = null;
        }
      });
      secure.once('secureConnect', () => finish(true));
    });
  }

  private async request(timeoutMs: number): Promise<number | null> {
    const secure = this.secure;
    const reader = this.reader;
    if (!secure || !reader || secure.destroyed) return null;
    const started = performance.now();
    secure.write(`GET ${this.target.path} HTTP/1.1\r\nHost: ${this.target.host}\r\nUser-Agent: Mozilla/5.0\r\nAccept: */*\r\nConnection: keep-alive\r\n\r\n`);
    let timer: NodeJS.Timeout | undefined;
    const ok = await Promise.race([reader.next(), new Promise<boolean>((r) => (timer = setTimeout(() => r(false), timeoutMs)))]);
    clearTimeout(timer);
    if (!ok) {
      this.close();
      return null;
    }
    return Math.max(1, Math.round(performance.now() - started));
  }

  // A cold request on a new connection, then a warm one on it; the connection stays for the next call.
  async measure(timeoutMs = 8000): Promise<ProbeResult> {
    if (this.busy) return { ok: false, ms: null, cold: null };
    this.busy = true;
    try {
      let cold: number | null = null;
      if (!this.secure || this.secure.destroyed) {
        const started = performance.now();
        if (!(await this.open(timeoutMs))) return { ok: false, ms: null, cold: null };
        const first = await this.request(Math.max(1000, timeoutMs - (performance.now() - started)));
        if (first === null) return { ok: false, ms: null, cold: null };
        cold = Math.round(performance.now() - started);
      }
      const warm = await this.request(Math.min(timeoutMs, 5000));
      if (warm !== null) return { ok: true, ms: warm, cold };
      return cold !== null ? { ok: true, ms: cold, cold } : { ok: false, ms: null, cold: null };
    } finally {
      this.busy = false;
    }
  }

  close(): void {
    const secure = this.secure;
    this.secure = null;
    this.reader = null;
    secure?.destroy();
  }
}

// One cold and one warm request through a SOCKS port, then the connection is closed.
export async function probeSocks(port: number, timeoutMs = 8000, target: ProbeTarget = googleTest, insecure = false): Promise<ProbeResult> {
  const probe = new HttpProbe(target, port, insecure);
  try {
    return await probe.measure(timeoutMs);
  } finally {
    probe.close();
  }
}
