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

async function call(fetchImpl: Fetch, url: string, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
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
