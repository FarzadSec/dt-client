import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { defaultSettings, type AccountSummary, type Activity, type AppProfile, type Settings } from '../shared/types';

export interface Sealer {
  encrypt(text: string): string;
  decrypt(sealed: string): string;
}

// One subscription the app has signed in with. The token and the profile carry credentials, so they
// are stored sealed (DPAPI on Windows, the keychain on macOS, the secret service on Linux).
interface StoredAccount {
  id: string;
  subLink: string;
  username: string;
  token?: string;
  profile?: string;
}

interface StateFile {
  accounts?: StoredAccount[];
  activeId?: string;
  // One account, as versions up to 1.1 kept it; moved into accounts when read.
  subLink?: string;
  username?: string;
  token?: string;
  profile?: string;
  deviceIdFallback?: string;
  settings?: Partial<Settings>;
  activity?: Activity;
}

export interface StoredSession {
  id: string;
  subLink: string;
  username: string;
  token: string;
}

// The same subscription and username is the same account, whatever order it was added in.
export function accountId(subLink: string, username: string): string {
  return createHash('sha256').update(`${subLink.trim()}\n${username.trim().toLowerCase()}`).digest('hex').slice(0, 16);
}

export class Store {
  private state: StateFile;

  constructor(
    private readonly file: string,
    private readonly sealer: Sealer,
  ) {
    try {
      this.state = JSON.parse(fs.readFileSync(file, 'utf8')) as StateFile;
    } catch {
      this.state = {};
    }
    this.migrate();
  }

  private migrate(): void {
    const { subLink, username, token, profile } = this.state;
    if (!subLink || !username) return;
    const id = accountId(subLink, username);
    const accounts = this.state.accounts ?? [];
    if (!accounts.some((a) => a.id === id)) accounts.unshift({ id, subLink, username, token, profile });
    this.state.accounts = accounts;
    if (token && !this.state.activeId) this.state.activeId = id;
    delete this.state.subLink;
    delete this.state.username;
    delete this.state.token;
    delete this.state.profile;
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2), { mode: 0o600 });
  }

  private list(): StoredAccount[] {
    return (this.state.accounts ??= []);
  }

  private active(): StoredAccount | undefined {
    return this.list().find((a) => a.id === this.state.activeId);
  }

  private open(sealed: string | undefined): string | null {
    if (!sealed) return null;
    try {
      return this.sealer.decrypt(sealed);
    } catch {
      return null;
    }
  }

  settings(): Settings {
    return { ...defaultSettings, ...this.state.settings };
  }

  saveSettings(patch: Partial<Settings>): Settings {
    this.state.settings = { ...this.settings(), ...patch };
    this.save();
    return this.settings();
  }

  // The account in use, when it is signed in.
  session(): StoredSession | null {
    const a = this.active();
    const token = this.open(a?.token);
    return a && token ? { id: a.id, subLink: a.subLink, username: a.username, token } : null;
  }

  // Adds the account, or signs it in again, and makes it the one in use.
  saveSession(subLink: string, username: string, token: string): string {
    const id = accountId(subLink, username);
    const sealed = this.sealer.encrypt(token);
    const found = this.list().find((a) => a.id === id);
    if (found) Object.assign(found, { subLink: subLink.trim(), username: username.trim(), token: sealed });
    else this.list().push({ id, subLink: subLink.trim(), username: username.trim(), token: sealed });
    this.state.activeId = id;
    this.save();
    return id;
  }

  // The session of the account in use ended (signed out on the panel): it stays listed, to sign in again.
  clearSession(): void {
    const a = this.active();
    if (a) {
      delete a.token;
      delete a.profile;
    }
    delete this.state.activeId;
    this.save();
  }

  // Signed-in accounts can be switched to; the others need their link signed in again.
  accounts(): AccountSummary[] {
    return this.list().map((a) => {
      let title = '';
      let expiryTime = 0;
      const profile = this.open(a.profile);
      if (profile) {
        try {
          const p = JSON.parse(profile) as AppProfile;
          title = p.title ?? '';
          expiryTime = p.account?.expiryTime ?? 0;
        } catch {
          // Shown without them.
        }
      }
      let host = '';
      try {
        host = new URL(a.subLink).host;
      } catch {
        // Shown without it.
      }
      return { id: a.id, username: a.username, host, title, expiryTime, signedIn: Boolean(a.token), active: a.id === this.state.activeId };
    });
  }

  account(id: string): { subLink: string; username: string; token: string | null } | null {
    const a = this.list().find((x) => x.id === id);
    return a ? { subLink: a.subLink, username: a.username, token: this.open(a.token) } : null;
  }

  setActive(id: string): boolean {
    const a = this.list().find((x) => x.id === id);
    if (!a?.token) return false;
    this.state.activeId = id;
    this.save();
    return true;
  }

  removeAccount(id: string): void {
    this.state.accounts = this.list().filter((a) => a.id !== id);
    if (this.state.activeId === id) delete this.state.activeId;
    this.save();
  }

  profile(): AppProfile | null {
    const text = this.open(this.active()?.profile);
    if (!text) return null;
    try {
      return JSON.parse(text) as AppProfile;
    } catch {
      return null;
    }
  }

  saveProfile(profile: AppProfile): void {
    const a = this.active();
    if (!a) return;
    a.profile = this.sealer.encrypt(JSON.stringify(profile));
    this.save();
  }

  activity(): Activity {
    return { days: {}, recents: [], ...this.state.activity };
  }

  saveActivity(activity: Activity): void {
    this.state.activity = activity;
    this.save();
  }

  deviceIdFallback(): string | undefined {
    return this.state.deviceIdFallback;
  }

  saveDeviceIdFallback(id: string): void {
    this.state.deviceIdFallback = id;
    this.save();
  }
}
