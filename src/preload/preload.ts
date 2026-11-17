import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import type { DtApi, Status } from '../shared/types';

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as { ok: true; value: T } | { ok: false; code: string };
  if (!result.ok) throw new Error(result.code);
  return result.value;
}

const api: DtApi = {
  session: () => invoke('session'),
  login: (subLink, username) => invoke('login', subLink, username),
  logout: () => invoke('logout'),
  profile: (refresh) => invoke('profile', refresh),
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
};

contextBridge.exposeInMainWorld('dt', api);
