// The panel's app API (Manifold, <subscription link>/app/v1).
export interface AppLocation {
  nodeId: number;
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

export interface Settings {
  language: Language;
  protocol: ProtocolChoice;
  killSwitch: boolean;
  webrtcProtection: boolean;
  timezoneSpoof: boolean;
  iranDirect: boolean;
  connectOnStart: boolean;
  startWithWindows: boolean;
  locationId: number | null;
}

export const defaultSettings: Settings = {
  language: 'fa',
  protocol: 'auto',
  killSwitch: true,
  webrtcProtection: true,
  timezoneSpoof: false,
  iranDirect: true,
  connectOnStart: false,
  startWithWindows: false,
  locationId: null,
};

export type ConnState = 'disconnected' | 'connecting' | 'connected' | 'disconnecting';

export interface Status {
  state: ConnState;
  locationId?: number | null;
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
  openExternal(url: string): Promise<void>;
  onStatus(listener: (status: Status) => void): () => void;
}
