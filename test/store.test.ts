import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { Store, type Sealer } from '../src/main/store';

const sealer: Sealer = {
  encrypt: (t) => Buffer.from(t).toString('base64'),
  decrypt: (s) => Buffer.from(s, 'base64').toString(),
};

describe('Store', () => {
  it('keeps the token and profile sealed on disk and reads them back', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dt-')), 'state.json');
    const store = new Store(file, sealer);
    store.saveSession('https://s/sub/x', 'dana', 'secret-token');
    store.saveProfile({ account: { username: 'dana' } as never, locations: [], configs: [{ protocol: 'l2tp', name: 'l', link: 'l2tp://dana:pw@h' }] });
    const raw = fs.readFileSync(file, 'utf8');
    expect(raw).not.toContain('secret-token');
    expect(raw).not.toContain('dana:pw');

    const reopened = new Store(file, sealer);
    expect(reopened.session()).toMatchObject({ subLink: 'https://s/sub/x', username: 'dana', token: 'secret-token' });
    expect(reopened.profile()?.configs[0].link).toBe('l2tp://dana:pw@h');
    reopened.clearSession();
    expect(new Store(file, sealer).session()).toBeNull();
  });

  it('moves the one account of 1.1 into the accounts list', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dt-')), 'state.json');
    fs.writeFileSync(file, JSON.stringify({ subLink: 'https://s/sub/x', username: 'dana', token: sealer.encrypt('tok'), settings: { language: 'en' } }));
    const store = new Store(file, sealer);
    expect(store.session()).toMatchObject({ subLink: 'https://s/sub/x', username: 'dana', token: 'tok' });
    expect(store.accounts()).toMatchObject([{ username: 'dana', host: 's', signedIn: true, active: true }]);
    expect(store.settings().language).toBe('en');
  });

  it('keeps several accounts, switches between them and signs one out', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dt-')), 'state.json');
    const store = new Store(file, sealer);
    const a = store.saveSession('https://a/sub/1', 'ann', 'ta');
    store.saveProfile({ account: { username: 'ann', expiryTime: 5 } as never, title: 'Gold', locations: [], configs: [] });
    const b = store.saveSession('https://b/sub/2', 'bob', 'tb');
    expect(store.session()?.username).toBe('bob');
    expect(store.profile()).toBeNull();
    expect(store.setActive(a)).toBe(true);
    expect(store.profile()?.title).toBe('Gold');
    expect(store.accounts().map((x) => [x.username, x.active, x.title])).toEqual([
      ['ann', true, 'Gold'],
      ['bob', false, ''],
    ]);
    store.clearSession();
    expect(store.session()).toBeNull();
    expect(store.accounts().find((x) => x.id === a)?.signedIn).toBe(false);
    expect(store.setActive(a)).toBe(false);
    expect(store.setActive(b)).toBe(true);
    store.removeAccount(a);
    expect(new Store(file, sealer).accounts().map((x) => x.username)).toEqual(['bob']);
  });

  it('fills settings it never saved from the defaults', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dt-')), 'state.json');
    const store = new Store(file, sealer);
    expect(store.saveSettings({ protocol: 'openvpn' })).toMatchObject({ protocol: 'openvpn', killSwitch: true, language: 'fa' });
  });
});
