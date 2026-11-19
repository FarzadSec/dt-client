import { gzipSync } from 'node:zlib';

import type { AppProfile } from '../shared/types';

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  os: string;
  osVersion: string;
  appVersion: string;
}

// code is the panel's error code (bad_login, device_limit, ...) or network / bad_response.
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

type Fetch = typeof fetch;

const timeoutMs = 15_000;

// What a support report carries besides the session: the user's words and the app's log.
export interface ReportBody {
  message: string;
  log: string;
  deviceId: string;
  deviceName: string;
  os: string;
  osVersion: string;
  appVersion: string;
}

async function call(fetchImpl: Fetch, url: string, init: RequestInit, timeout = timeoutMs): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeout) });
  } catch {
    throw new ApiError('network', 0);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const code = (body as { error?: unknown } | null)?.error;
    throw new ApiError(typeof code === 'string' ? code : res.status === 404 ? 'not_found' : 'bad_response', res.status);
  }
  return body;
}

export class AppApi {
  constructor(
    private readonly base: string,
    private readonly userAgent: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async login(username: string, device: DeviceInfo): Promise<string> {
    const body = await call(this.fetchImpl, `${this.base}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': this.userAgent },
      body: JSON.stringify({ username, ...device }),
    });
    const token = (body as { token?: unknown } | null)?.token;
    if (typeof token !== 'string' || token === '') throw new ApiError('bad_response', 200);
    return token;
  }

  async profile(token: string, deviceId: string): Promise<AppProfile> {
    const body = await call(this.fetchImpl, `${this.base}/profile`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, 'X-HWID': deviceId, 'User-Agent': this.userAgent },
    });
    if (!isProfile(body)) throw new ApiError('bad_response', 200);
    return body;
  }

  // POST /report (Manifold 0.20+): the panel files it under the session's account and answers its number.
  // The JSON is sent gzipped, since a log is large and compresses well.
  async report(token: string, body: ReportBody): Promise<string | null> {
    let answer: unknown;
    try {
      answer = await call(
        this.fetchImpl,
        `${this.base}/report`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'X-HWID': body.deviceId, 'User-Agent': this.userAgent, 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
          body: new Uint8Array(gzipSync(Buffer.from(JSON.stringify(body)))),
        },
        90_000,
      );
    } catch (err) {
      // A panel without the endpoint answers 404 or 405.
      if (err instanceof ApiError && (err.status === 404 || err.status === 405 || err.status === 501)) throw new ApiError('report_unsupported', err.status);
      throw err;
    }
    const id = (answer as { id?: unknown } | null)?.id;
    if (typeof answer !== 'object' || answer === null || !('id' in answer || 'ok' in answer)) throw new ApiError('report_unsupported', 200);
    return typeof id === 'number' || typeof id === 'string' ? String(id) : null;
  }

  async logout(token: string, deviceId: string): Promise<void> {
    await call(this.fetchImpl, `${this.base}/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'X-HWID': deviceId, 'User-Agent': this.userAgent },
    });
  }
}

function isProfile(v: unknown): v is AppProfile {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Partial<AppProfile>;
  return typeof p.account === 'object' && p.account !== null && Array.isArray(p.locations) && Array.isArray(p.configs);
}
