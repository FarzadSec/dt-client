import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import { osOf } from '../shared/platform';
import type { DtApi, LiveSample, LockHit, ProfileUpdate, Status } from '../shared/types';

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as { ok: true; value: T } | { ok: false; code: string };
  if (!result.ok) throw new Error(result.code);
  return result.value;
}

const api: DtApi = {
  os: osOf(process.platform),
  session: () => invoke('session'),
  login: (subLink, username) => invoke('login', subLink, username),
  logout: () => invoke('logout'),
  accounts: () => invoke('accounts'),
  switchAccount: (id) => invoke('switchAccount', id),
  removeAccount: (id) => invoke('removeAccount', id),
  profile: (refresh) => invoke('profile', refresh),
  refresh: () => invoke('refresh'),
  settings: () => invoke('settings'),
  saveSettings: (patch) => invoke('saveSettings', patch),
  connect: (locationId) => invoke('connect', locationId),
  disconnect: () => invoke('disconnect'),
  status: () => invoke('status'),
  ping: () => invoke('ping'),
  activity: () => invoke('activity'),
  pickApp: () => invoke('pickApp'),
  appIcon: (file) => invoke('appIcon', file),
  openExternal: (url) => invoke('openExternal', url),
  onStatus: (listener) => {
    const wrapped = (_event: IpcRendererEvent, status: Status) => listener(status);
    ipcRenderer.on('status', wrapped);
    return () => ipcRenderer.off('status', wrapped);
  },
  onLive: (listener) => {
    const wrapped = (_event: IpcRendererEvent, sample: LiveSample) => listener(sample);
    ipcRenderer.on('live', wrapped);
    return () => ipcRenderer.off('live', wrapped);
  },
  liveHistory: () => invoke('liveHistory'),
  onShown: (listener) => {
    const wrapped = () => listener();
    ipcRenderer.on('shown', wrapped);
    return () => ipcRenderer.off('shown', wrapped);
  },
  onLockHit: (listener) => {
    const wrapped = (_event: IpcRendererEvent, hit: LockHit) => listener(hit);
    ipcRenderer.on('lockHit', wrapped);
    return () => ipcRenderer.off('lockHit', wrapped);
  },
  lockSkip: (minutes) => invoke('lockSkip', minutes),
  pickLockApp: () => invoke('pickLockApp'),
  onProfile: (listener) => {
    const wrapped = (_event: IpcRendererEvent, update: ProfileUpdate) => listener(update);
    ipcRenderer.on('profile', wrapped);
    return () => ipcRenderer.off('profile', wrapped);
  },
  onSignedOut: (listener) => {
    const wrapped = (_event: IpcRendererEvent, code: string) => listener(code);
    ipcRenderer.on('signedOut', wrapped);
    return () => ipcRenderer.off('signedOut', wrapped);
  },
  takeSignIn: () => invoke('takeSignIn'),
  onSignInLink: (listener) => {
    const wrapped = () => listener();
    ipcRenderer.on('signInLink', wrapped);
    return () => ipcRenderer.off('signInLink', wrapped);
  },
  logText: () => invoke('logText'),
  sendReport: (message) => invoke('sendReport', message),
  saveLog: () => invoke('saveLog'),
  log: (text) => ipcRenderer.send('log', String(text).slice(0, 4000)),
};

contextBridge.exposeInMainWorld('dt', api);
