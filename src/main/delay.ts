import fs from 'node:fs';
import path from 'node:path';

import type { AppConfig } from '../shared/types';
import { proxyOutboundFor, serverNames, xrayDelayConfig } from './configs/xray';
import { EngineProcess } from './engines/process';
import { freePort, waitForPort } from './health';
import { googleTest, probeSocks, type ProbeTarget } from './httpProbe';
import type { LogFn } from './log';
import { resolveNames } from './resolve';

export interface DelayPaths {
  // Where the xray executable is, and a folder of the user's own for the test's config.
  xray: string;
  work: string;
}

// The real delay of each Xray config (V2Ray protocols and WireGuard): one Xray with a SOCKS port per
// config, and a request to Google's empty page through each, as the panel's outbound test does it.
// A config that answers gets the time of a request over its established connection; one that does not, null.
export interface DelayOptions {
  concurrency?: number;
  // Tests only: a local page instead of Google's.
  target?: ProbeTarget;
  insecure?: boolean;
}

export async function xrayDelays(configs: AppConfig[], paths: DelayPaths, log: LogFn, opts: DelayOptions = {}): Promise<Map<string, number | null>> {
  const concurrency = opts.concurrency ?? 12;
  const out = new Map<string, number | null>(configs.map((c) => [c.link, null]));
  const items: { config: AppConfig; outbound: Record<string, unknown>; port: number }[] = [];
  for (const config of configs) {
    const outbound = proxyOutboundFor(config);
    if (Object.keys(outbound).length > 0) items.push({ config, outbound, port: await freePort() });
  }
  if (items.length === 0) return out;
  const names = [...new Set(items.flatMap((i) => serverNames(i.outbound)))];
  const hosts = await resolveNames(names, 4000);
  fs.mkdirSync(paths.work, { recursive: true });
  const file = path.join(paths.work, 'delay-test.json');
  fs.writeFileSync(file, JSON.stringify(xrayDelayConfig(items, hosts)), { mode: 0o600 });
  const proc = new EngineProcess('xray-test', paths.xray, ['run', '-c', file], path.join(paths.work, 'delay-test.log'), path.dirname(paths.xray));
  const errors: string[] = [];
  proc.on('line', (line: string) => {
    if (errors.length < 5) errors.push(line);
  });
  proc.start();
  try {
    for (const item of items) {
      if (!(await waitForPort(item.port, 8000, () => proc.alive))) {
        log('ping', `the delay test's Xray did not start${errors.length > 0 ? `: ${errors.join(' | ')}` : ''}`);
        return out;
      }
    }
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const item = items[next++];
        const result = await probeSocks(item.port, 10_000, opts.target ?? googleTest, opts.insecure ?? false);
        out.set(item.config.link, result.ok ? result.ms : null);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  } finally {
    await proc.stop(3000);
    fs.rmSync(file, { force: true });
  }
  return out;
}
