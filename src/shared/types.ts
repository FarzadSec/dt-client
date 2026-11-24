import type { SignInCode } from './signin';

// The panel's app API (Manifold, <subscription link>/app/v1).
export interface AppLocation {
  id: number;
  name: string;
  countryCode: string;
  city: string;
  timezone: string;
}

export interface AppConfig {
  protocol: string;
  name: string;
  link: string;
  locationId?: number | null;
  outbound?: Record<string, unknown>;
}

export interface AppAccount {
  username: string;
  enabled: boolean;
  expiryTime: number;
  upload: number;
  download: number;
  total: number;
  deviceLimit: number;
  devices: number;
}

export type NoticeLevel = 'info' | 'warning' | 'critical';

// Published from the panel; the text is always Persian, so it is always shown right to left.
export interface AppNotice {
  id: number;
  body: string;
  level: NoticeLevel;
  createdAt: number;
}

export interface AppProfile {
  account: AppAccount;
  title?: string;
  supportUrl?: string;
  announce?: string;
  locations: AppLocation[];
  configs: AppConfig[];
  // Absent from panels older than Manifold 0.18.
  notices?: AppNotice[];
}

export type Engine = 'xray' | 'openvpn' | 'l2tp';

export type ProtocolChoice = 'auto' | 'xray' | 'wireguard' | 'openvpn' | 'l2tp';

export type Language = 'fa' | 'en';

export type Theme = 'system' | 'dark' | 'light';

// An app whose traffic leaves directly while connected; name is its .exe file name.
export interface SplitApp {
  name: string;
  path: string;
}

// A subscription the app has signed in with; signedIn is false once its session ended.
export interface AccountSummary {
  id: string;
  username: string;
  host: string;
  title: string;
  expiryTime: number;
  signedIn: boolean;
  active: boolean;
}

export interface Settings {
  language: Language;
  theme: Theme;
  protocol: ProtocolChoice;
  killSwitch: boolean;
  autoReconnect: boolean;
  webrtcProtection: boolean;
  timezoneSpoof: boolean;
  iranDirect: boolean;
  adBlock: boolean;
  dns: string;
  splitTunneling: boolean;
  splitApps: SplitApp[];
  connectOnStart: boolean;
  startWithWindows: boolean;
  launchMinimized: boolean;
  notifications: boolean;
  // DNS, IPv6 and other traffic kept from leaving around the tunnel (strict routes, IPv6 blocked).
  leakProtection: boolean;
  // Apps and sites that must not be used without the VPN: while it is off they are closed (apps) or
  // do not open (sites), and the app offers to connect.
  lockEnabled: boolean;
  lockApps: SplitApp[];
  lockSites: string[];
  locationId: number | null;
  dismissedAnnounce: string;
  // Banner keys the user closed, and what the bell had shown when last opened.
  dismissedNotices: string[];
  seenNoticeId: number;
  seenAnnounce: string;
}

export const defaultSettings: Settings = {
  language: 'fa',
  theme: 'dark',
  protocol: 'auto',
  killSwitch: true,
  autoReconnect: true,
  webrtcProtection: true,
  timezoneSpoof: false,
  iranDirect: true,
  adBlock: false,
  dns: '',
  splitTunneling: false,
  splitApps: [],
  connectOnStart: false,
  startWithWindows: false,
  launchMinimized: false,
  notifications: true,
  leakProtection: true,
  lockEnabled: false,
  lockApps: [],
  lockSites: [],
  locationId: null,
  dismissedAnnounce: '',
  dismissedNotices: [],
  seenNoticeId: 0,
  seenAnnounce: '',
};

export type ConnState = 'disconnected' | 'connecting' | 'connected' | 'disconnecting';

export interface Status {
  state: ConnState;
  locationId?: number | null;
  // The location actually in use, also when the user asked for the fastest one.
  serverId?: number | null;
  configName?: string;
  protocol?: string;
  // The tunnel address the server gave this device, where the engine reports one (OpenVPN).
  address?: string;
  since?: number;
  error?: string;
  notice?: string;
  // The connection dropped and the kill switch is holding traffic back until disconnect.
  blocking?: boolean;
}

export interface Session {
  id: string;
  subLink: string;
  username: string;
}

// The connection's last second: bytes per second each way and the round trip of the test page
// through the tunnel (null when it timed out; undefined when none was measured that second).
export interface LiveSample {
  at: number;
  rx: number;
  tx: number;
  ms?: number | null;
}

// A locked app or site opened while the VPN was off.
export interface LockHit {
  kind: 'app' | 'site';
  name: string;
}

// Time connected per local day (YYYY-MM-DD → seconds) and the locations connected to last.
export interface Activity {
  days: Record<string, number>;
  recents: (number | null)[];
}

export interface PingResult {
  link: string;
  ms: number | null;
}

// A profile fetch; error is set when the panel could not be reached and profile is the last one kept.
export interface ProfileUpdate {
  profile: AppProfile;
  fetchedAt: number;
  error?: string;
}

// What the window can ask the main process for; preload exposes it as window.dt.
export interface DtApi {
  os: 'windows' | 'linux' | 'macos';
  session(): Promise<Session | null>;
  // username is optional: without it the app reads the subscription's account itself.
  login(subLink: string, username?: string): Promise<AppProfile>;
  // Signs out of the account in use; the answer is the next signed-in account's profile, if there is one.
  logout(): Promise<AppProfile | null>;
  accounts(): Promise<AccountSummary[]>;
  switchAccount(id: string): Promise<AppProfile | null>;
  removeAccount(id: string): Promise<AppProfile | null>;
  profile(refresh: boolean): Promise<AppProfile | null>;
  refresh(): Promise<ProfileUpdate | null>;
  settings(): Promise<Settings>;
  saveSettings(patch: Partial<Settings>): Promise<Settings>;
  connect(locationId: number | null): Promise<Status>;
  disconnect(): Promise<Status>;
  status(): Promise<Status>;
  ping(): Promise<PingResult[]>;
  activity(): Promise<Activity>;
  pickApp(): Promise<SplitApp | null>;
  appIcon(path: string): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  onStatus(listener: (status: Status) => void): () => void;
  // While connected: a sample a second for the live chart.
  onLive(listener: (sample: LiveSample) => void): () => void;
  liveHistory(): Promise<LiveSample[]>;
  // The window was opened again from the tray (or the dock): the app fetches the profile and shows its warnings.
  onShown(listener: () => void): () => void;
  onLockHit(listener: (hit: LockHit) => void): () => void;
  // Lets locked apps and sites through for this many minutes while the VPN is off.
  lockSkip(minutes: number): Promise<void>;
  pickLockApp(): Promise<SplitApp | null>;
  // The profile the app refreshes by itself every 10 minutes; signedOut carries the panel's code.
  onProfile(listener: (update: ProfileUpdate) => void): () => void;
  onSignedOut(listener: (code: string) => void): () => void;
  // A dtconnect:// sign-in link the app was opened with, taken once.
  takeSignIn(): Promise<SignInCode | null>;
  onSignInLink(listener: () => void): () => void;
  // The app's log since it started (the engines' too), redacted, for the support page.
  logText(): Promise<string>;
  // Sends the log with the user's message to the panel; the answer is the report's number when it gives one.
  sendReport(message: string): Promise<{ id: string | null }>;
  saveLog(): Promise<boolean>;
  // A line from the window for the log (an error it caught).
  log(text: string): void;
}
