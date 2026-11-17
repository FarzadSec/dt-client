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

export interface AppProfile {
  account: AppAccount;
  title?: string;
  supportUrl?: string;
  announce?: string;
  locations: AppLocation[];
  configs: AppConfig[];
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
  locationId: number | null;
  dismissedAnnounce: string;
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
  locationId: null,
  dismissedAnnounce: '',
};

export type ConnState = 'disconnected' | 'connecting' | 'connected' | 'disconnecting';

export interface Status {
  state: ConnState;
  locationId?: number | null;
  // The location actually in use, also when the user asked for the fastest one.
  serverId?: number | null;
  configName?: string;
  protocol?: string;
  since?: number;
  error?: string;
  notice?: string;
  // The connection dropped and the kill switch is holding traffic back until disconnect.
  blocking?: boolean;
}

export interface Session {
  subLink: string;
  username: string;
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

// What the window can ask the main process for; preload exposes it as window.dt.
export interface DtApi {
  session(): Promise<Session | null>;
  login(subLink: string, username: string): Promise<AppProfile>;
  logout(): Promise<void>;
  profile(refresh: boolean): Promise<AppProfile | null>;
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
}
