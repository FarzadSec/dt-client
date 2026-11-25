import type { LiveSample } from '../shared/types';
import { HttpProbe } from './httpProbe';

export interface Counters {
  rx: number;
  tx: number;
}

export interface LiveOptions {
  // Cumulative bytes through the tunnel, or null where the engine cannot tell.
  counters: () => Promise<Counters | null>;
  onSample: (sample: LiveSample) => void;
  // Traffic stopped passing: the test page has not answered for a while and nothing came in meanwhile.
  onStall: () => void;
  onRecover: () => void;
  probe?: { measure(timeoutMs: number): Promise<{ ok: boolean; ms: number | null }>; close(): void };
  tickMs?: number;
  probeEvery?: number;
  failuresForStall?: number;
}

// While connected: a sample a second of the traffic each way, and every few seconds the round trip of
// Google's empty page through the tunnel over one kept-alive connection (the live ping). Several test
// pages in a row without an answer, with nothing downloaded meanwhile, is a stall.
export class LiveMonitor {
  private timer: NodeJS.Timeout | null = null;
  private last: { at: number; c: Counters } | null = null;
  private ticks = 0;
  private probing = false;
  private pendingMs: number | null | undefined = undefined;
  private failures = 0;
  private rxAtFirstFailure = 0;
  private lastRx = 0;
  private stalled = false;
  private readonly probe: NonNullable<LiveOptions['probe']>;
  private readonly tickMs: number;
  private readonly probeEvery: number;
  private readonly failuresForStall: number;

  constructor(private readonly opts: LiveOptions) {
    this.probe = opts.probe ?? new HttpProbe();
    this.tickMs = opts.tickMs ?? 1000;
    this.probeEvery = opts.probeEvery ?? 3;
    this.failuresForStall = opts.failuresForStall ?? 3;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.probe.close();
  }

  private async tick(): Promise<void> {
    if (!this.timer) return;
    const n = this.ticks++;
    if (n % this.probeEvery === 0 && !this.probing) void this.runProbe();
    let rx = 0;
    let tx = 0;
    const c = await this.opts.counters().catch(() => null);
    const now = Date.now();
    if (c) {
      if (this.last && now > this.last.at) {
        const secs = (now - this.last.at) / 1000;
        rx = Math.max(0, Math.round((c.rx - this.last.c.rx) / secs));
        tx = Math.max(0, Math.round((c.tx - this.last.c.tx) / secs));
      }
      this.last = { at: now, c };
      this.lastRx = c.rx;
    }
    if (!this.timer) return;
    const sample: LiveSample = { at: now, rx, tx };
    if (this.pendingMs !== undefined) {
      sample.ms = this.pendingMs;
      this.pendingMs = undefined;
    }
    this.opts.onSample(sample);
  }

  private async runProbe(): Promise<void> {
    this.probing = true;
    try {
      const r = await this.probe.measure(5000);
      if (!this.timer) return;
      this.pendingMs = r.ok ? r.ms : null;
      if (r.ok) {
        this.failures = 0;
        if (this.stalled) {
          this.stalled = false;
          this.opts.onRecover();
        }
        return;
      }
      if (this.failures === 0) this.rxAtFirstFailure = this.lastRx;
      this.failures++;
      // Downloads still coming in mean the tunnel works and only the test page is slow.
      const cameIn = this.last ? this.lastRx - this.rxAtFirstFailure : 0;
      if (!this.stalled && this.failures >= this.failuresForStall && cameIn < 16 * 1024) {
        this.stalled = true;
        this.opts.onStall();
      }
    } finally {
      this.probing = false;
    }
  }
}
