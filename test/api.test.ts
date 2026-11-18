import { describe, expect, it } from 'vitest';

import { ApiError, AppApi } from '../src/main/api';
import { appApiBase, LinkError } from '../src/main/link';

const device = { deviceId: 'device-0123456789', deviceName: 'pc', os: 'windows', osVersion: '10.0', appVersion: '0.1.0' };

function fakeFetch(status: number, body: unknown, seen: { url?: string; init?: RequestInit } = {}): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    seen.url = url;
    seen.init = init;
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

describe('appApiBase', () => {
  it('builds the API under the link the customer pasted', () => {
    expect(appApiBase(' https://sub.example.com:2096/sub/abc123?name=x#me ')).toBe('https://sub.example.com:2096/sub/abc123/app/v1');
    expect(appApiBase('https://cdn.example.com/json/abc123/')).toBe('https://cdn.example.com/json/abc123/app/v1');
  });

  it('refuses what is not a subscription link', () => {
    for (const link of ['vless://abc@host:443', 'https://sub.example.com/', 'not a link']) {
      expect(() => appApiBase(link)).toThrow(LinkError);
    }
  });
});

describe('AppApi', () => {
  it('sends the username and device and returns the token', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const api = new AppApi('https://s/sub/x/app/v1', 'DTConnect/0.1.0', fakeFetch(200, { token: 'tok' }, seen));
    expect(await api.login('dana', device)).toBe('tok');
    expect(seen.url).toBe('https://s/sub/x/app/v1/login');
    expect(JSON.parse(String(seen.init?.body))).toEqual({ username: 'dana', ...device });
  });

  it('turns the panel error code into an ApiError', async () => {
    const api = new AppApi('https://s/sub/x/app/v1', 'ua', fakeFetch(403, { error: 'device_limit' }));
    await expect(api.login('dana', device)).rejects.toEqual(new ApiError('device_limit', 403));
  });

  it('reads a panel without the app API as not_found', async () => {
    const api = new AppApi('https://s/sub/x/app/v1', 'ua', fakeFetch(404, null));
    await expect(api.login('dana', device)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('asks for the profile with the token and the device id', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const profile = { account: { username: 'dana' }, locations: [], configs: [] };
    const api = new AppApi('https://s/sub/x/app/v1', 'ua', fakeFetch(200, profile, seen));
    expect(await api.profile('tok', 'device-0123456789')).toEqual(profile);
    const headers = seen.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
    expect(headers['X-HWID']).toBe('device-0123456789');
  });

  it('refuses a profile without its account', async () => {
    const api = new AppApi('https://s/sub/x/app/v1', 'ua', fakeFetch(200, { configs: [] }));
    await expect(api.profile('tok', 'd')).rejects.toMatchObject({ code: 'bad_response' });
  });
});
