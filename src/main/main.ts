import os from 'node:os';
import path from 'node:path';

import { app, BrowserWindow, ipcMain, Menu, nativeImage, safeStorage, shell, Tray } from 'electron';

import type { AppProfile, PingResult, Settings, Status } from '../shared/types';
import { ApiError, AppApi } from './api';
import { engineOf } from '../shared/engines';
import { serverAddress } from './candidates';
import { tcpPing } from './health';
import { appApiBase, LinkError } from './link';
import { Store } from './store';
import { setAutostart } from './system/autostart';
import { deviceId, deviceName } from './system/device';
import { Vpn } from './vpn';

const startHidden = process.argv.includes('--hidden');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const userAgent = `DTClient/${app.getVersion()} (windows)`;
const binDir = app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(app.getAppPath(), 'resources', 'bin');
const iconPath = app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(app.getAppPath(), 'build', 'icon.png');

let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let store: Store;
let vpn: Vpn;
let ready = false;
let profileCache: AppProfile | null = null;

// IPC carries only a message string, so failures cross as a code the window translates.
type Result<T> = { ok: true; value: T } | { ok: false, code: string };

function codeOf(err: unknown): string {
  if (err instanceof ApiError) return err.code;
  if (err instanceof LinkError) return 'bad_link';
  return 'unexpected';
}

function handle<A extends unknown[], T>(channel: string, fn: (...args: A) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<Result<T>> => {
    try {
      return { ok: true, value: await fn(...(args as A)) };
    } catch (err) {
      return { ok: false, code: codeOf(err) };
    }
  });
}

async function device() {
  const id = await deviceId(store.deviceIdFallback());
  if (!store.deviceIdFallback()) store.saveDeviceIdFallback(id);
  return { deviceId: id, deviceName: deviceName(), os: 'windows', osVersion: os.release(), appVersion: app.getVersion() };
}

async function login(subLink: string, username: string): Promise<AppProfile> {
  const api = new AppApi(appApiBase(subLink), userAgent);
  const info = await device();
  const token = await api.login(username.trim(), info);
  const profile = await api.profile(token, info.deviceId);
  store.saveSession(subLink.trim(), username.trim(), token);
  store.saveProfile(profile);
  profileCache = profile;
  return profile;
}

async function refreshProfile(force: boolean): Promise<AppProfile | null> {
  const session = store.session();
  if (!session) return null;
  if (!force && profileCache) return profileCache;
  const info = await device();
  try {
    profileCache = await new AppApi(appApiBase(session.subLink), userAgent).profile(session.token, info.deviceId);
    store.saveProfile(profileCache);
  } catch (err) {
    if (err instanceof ApiError && ['bad_session', 'app_disabled', 'not_found'].includes(err.code)) {
      store.clearSession();
      profileCache = null;
      throw err;
    }
    profileCache = profileCache ?? store.profile();
    if (!profileCache) throw err;
  }
  return profileCache;
}

async function logout(): Promise<void> {
  await vpn.disconnect();
  const session = store.session();
  if (session) {
    const info = await device();
    await new AppApi(appApiBase(session.subLink), userAgent).logout(session.token, info.deviceId).catch(() => undefined);
  }
  store.clearSession();
  profileCache = null;
}

async function ping(): Promise<PingResult[]> {
  const profile = profileCache ?? store.profile();
  if (!profile) return [];
  const usable = profile.configs.filter((c) => engineOf(c));
  return Promise.all(
    usable.map(async (config) => {
      const target = serverAddress(config);
      const ms = target ? await tcpPing(target.host, target.port) : null;
      return { link: config.link, ms };
    }),
  );
}

async function connect(locationId: number | null): Promise<Status> {
  const profile = await refreshProfile(true).catch(() => profileCache ?? store.profile());
  if (!profile) return vpn.status();
  store.saveSettings({ locationId });
  const latency = locationId === null ? new Map((await ping()).map((p) => [p.link, p.ms])) : undefined;
  return vpn.connect(profile, store.settings(), locationId, latency);
}

async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  if (patch.startWithWindows !== undefined && app.isPackaged) await setAutostart(patch.startWithWindows, process.execPath);
  return store.saveSettings(patch);
}

function showWindow(): void {
  if (!window) createWindow();
  window?.show();
  window?.focus();
}

function updateTray(status: Status): void {
  if (!tray) return;
  const connected = status.state === 'connected';
  tray.setToolTip(connected ? `DT Client — ${status.configName ?? ''}` : 'DT Client');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open DT Client', click: showWindow },
      connected || status.blocking
        ? { label: 'Disconnect', click: () => void vpn.disconnect() }
        : { label: 'Connect', click: () => void connect(store.settings().locationId) },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 420,
    height: 740,
    resizable: false,
    maximizable: false,
    show: !startHidden,
    title: 'DT Client',
    icon: iconPath,
    backgroundColor: '#0b1220',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.removeMenu();
  void window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    window?.hide();
  });
}

app.on('second-instance', showWindow);

app.whenReady().then(async () => {
  store = new Store(path.join(app.getPath('userData'), 'state.json'), {
    encrypt: (text) => safeStorage.encryptString(text).toString('base64'),
    decrypt: (sealed) => safeStorage.decryptString(Buffer.from(sealed, 'base64')),
  });
  vpn = new Vpn({ bin: binDir, work: path.join(app.getPath('userData'), 'run') });
  profileCache = store.profile();
  ready = true;

  handle('session', () => {
    const s = store.session();
    return s ? { subLink: s.subLink, username: s.username } : null;
  });
  handle('login', login);
  handle('logout', logout);
  handle('profile', (force: boolean) => refreshProfile(force));
  handle('settings', () => store.settings());
  handle('saveSettings', saveSettings);
  handle('connect', connect);
  handle('disconnect', () => vpn.disconnect());
  handle('status', () => vpn.status());
  handle('ping', ping);
  handle('openExternal', async (url: string) => {
    if (/^https?:\/\//.test(url) || url.startsWith('tg://')) await shell.openExternal(url);
  });

  vpn.on('status', (status: Status) => {
    window?.webContents.send('status', status);
    updateTray(status);
  });

  tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }));
  tray.on('click', showWindow);
  updateTray(vpn.status());
  createWindow();

  if (store.session() && store.settings().connectOnStart) void connect(store.settings().locationId);
});

// The tunnel, the timezone and the browser policy are put back before the app goes.
app.on('before-quit', (event) => {
  if (quitting || !ready) return;
  event.preventDefault();
  quitting = true;
  void vpn.disconnect().finally(() => app.exit(0));
});

app.on('window-all-closed', () => {
  // Stays in the tray.
});
