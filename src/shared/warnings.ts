import type { AppAccount } from './types';

// The plan's end is near: two days or less left, or 3 GB or less of its traffic.
export const expiryWarnMs = 2 * 86_400_000;
export const trafficWarnBytes = 3 * 1024 ** 3;

export interface PlanWarning {
  kind: 'expiry' | 'traffic';
  // The plan has already ended (time up, or traffic used up).
  ended: boolean;
  // What is left: milliseconds for expiry, bytes for traffic.
  left: number;
}

export function planWarnings(account: AppAccount, now = Date.now()): PlanWarning[] {
  const out: PlanWarning[] = [];
  // expiryTime < 0 is a plan that starts on its first connection; 0 never ends.
  if (account.expiryTime > 0) {
    const left = account.expiryTime - now;
    if (left <= expiryWarnMs) out.push({ kind: 'expiry', ended: left <= 0, left: Math.max(0, left) });
  }
  if (account.total > 0) {
    const left = account.total - account.upload - account.download;
    if (left <= trafficWarnBytes) out.push({ kind: 'traffic', ended: left <= 0, left: Math.max(0, left) });
  }
  return out;
}

// A key that changes when a warning starts or the plan ends, so a notification goes out once for each.
export function warningKey(warnings: PlanWarning[]): string {
  return warnings.map((w) => `${w.kind}:${w.ended ? 'ended' : 'near'}`).join(',');
}
