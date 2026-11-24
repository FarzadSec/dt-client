import { useMemo } from 'react';

import type { LiveSample } from '../../shared/types';
import type { Translate } from '../i18n';
import { ArrowDownIcon, ArrowUpIcon } from './Icons';

// Bytes per second as a short rate: "1.4 MB/s".
export function rate(n: number): string {
  if (n < 1024) return `${Math.round(n)} B/s`;
  const units = ['KB/s', 'MB/s', 'GB/s'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

// The last minute of the connection: download and upload as areas, the ping as a line with its dots
// (a red mark where the test page timed out), and the latest values above it.
export function LiveChart({ t, samples }: { t: Translate; samples: LiveSample[] }) {
  const w = 300;
  const h = 86;
  const shown = samples.slice(-60);
  const last = shown[shown.length - 1];
  const lastPing = [...shown].reverse().find((s) => s.ms !== undefined);
  const timedOut = lastPing?.ms === null;
  const { down, up, pingPath, misses } = useMemo(() => {
    const n = 60;
    const x = (i: number) => (i + (n - shown.length)) * (w / (n - 1));
    const peak = Math.max(64 * 1024, ...shown.map((s) => Math.max(s.rx, s.tx)));
    const y = (v: number) => h - 4 - (v / peak) * (h - 14);
    const area = (key: 'rx' | 'tx') => {
      if (shown.length < 2) return '';
      const pts = shown.map((s, i) => `${x(i).toFixed(1)},${y(s[key]).toFixed(1)}`);
      return `M${x(0).toFixed(1)},${h} L${pts.join(' L')} L${x(shown.length - 1).toFixed(1)},${h} Z`;
    };
    const pings = shown.map((s, i) => ({ i, ms: s.ms })).filter((p) => p.ms !== undefined);
    const maxMs = Math.max(300, ...pings.map((p) => p.ms ?? 0));
    const py = (ms: number) => 6 + (1 - Math.min(1, ms / maxMs)) * (h - 22);
    const ok = pings.filter((p): p is { i: number; ms: number } => typeof p.ms === 'number');
    return {
      down: area('rx'),
      up: area('tx'),
      pingPath: ok.length > 1 ? `M${ok.map((p) => `${x(p.i).toFixed(1)},${py(p.ms).toFixed(1)}`).join(' L')}` : '',
      misses: pings.filter((p) => p.ms === null).map((p) => x(p.i)),
    };
  }, [shown]);

  return (
    <div className="live" dir="ltr">
      <div className="live-head">
        <span className="live-stat down" title={t('downloaded')}>
          <ArrowDownIcon /> {rate(last?.rx ?? 0)}
        </span>
        <span className="live-stat up" title={t('uploaded')}>
          <ArrowUpIcon /> {rate(last?.tx ?? 0)}
        </span>
        <span className={timedOut ? 'live-ping bad' : 'live-ping'} title={t('livePing')}>
          {timedOut ? t('timeout') : lastPing?.ms !== undefined && lastPing.ms !== null ? `${lastPing.ms} ms` : '… ms'}
        </span>
      </div>
      <svg className="live-chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
        <path className="live-down" d={down} />
        <path className="live-up" d={up} />
        {misses.map((mx, i) => (
          <line key={`m${i}`} className="live-miss" x1={mx} x2={mx} y1={4} y2={h} />
        ))}
        {pingPath && <path className="live-ping-line" d={pingPath} />}
      </svg>
    </div>
  );
}
