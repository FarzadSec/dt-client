import { useCallback, useEffect, useMemo, useState } from 'react';

import type { AppProfile, PingResult, Settings, Status } from '../shared/types';
import { translator } from './i18n';
import { GearIcon, GlobeIcon, HomeIcon, UserIcon } from './components/Icons';
import { AccountPage } from './pages/AccountPage';
import { HomePage } from './pages/HomePage';
import { LocationsPage } from './pages/LocationsPage';
import { LoginPage } from './pages/LoginPage';
import { SettingsPage } from './pages/SettingsPage';

type Tab = 'home' | 'locations' | 'account' | 'settings';

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [profile, setProfile] = useState<AppProfile | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [status, setStatus] = useState<Status>({ state: 'disconnected' });
  const [pings, setPings] = useState<PingResult[]>([]);
  const [tab, setTab] = useState<Tab>('home');
  const [signOutReason, setSignOutReason] = useState('');

  const t = useMemo(() => translator(settings?.language ?? 'fa'), [settings?.language]);

  useEffect(() => {
    document.documentElement.dir = settings?.language === 'en' ? 'ltr' : 'rtl';
    document.documentElement.lang = settings?.language ?? 'fa';
  }, [settings?.language]);

  const refreshPings = useCallback(() => {
    void window.dt.ping().then(setPings).catch(() => undefined);
  }, []);

  const loadProfile = useCallback(
    async (force: boolean) => {
      try {
        const p = await window.dt.profile(force);
        setProfile(p);
        setSignedIn(p !== null);
      } catch (err) {
        setProfile(null);
        setSignedIn(false);
        setSignOutReason((err as Error).message);
      }
    },
    [],
  );

  useEffect(() => {
    void window.dt.settings().then(setSettings);
    void window.dt.status().then(setStatus);
    void window.dt.session().then((s) => {
      if (!s) {
        setSignedIn(false);
        return;
      }
      void loadProfile(false).then(() => loadProfile(true));
    });
    return window.dt.onStatus(setStatus);
  }, [loadProfile]);

  useEffect(() => {
    if (signedIn) refreshPings();
  }, [signedIn, profile, refreshPings]);

  const saveSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings(await window.dt.saveSettings(patch));
  }, []);

  if (!settings || signedIn === null) return <div className="splash" />;

  if (!signedIn || !profile) {
    return (
      <LoginPage
        t={t}
        settings={settings}
        reason={signOutReason}
        onLanguage={(language) => void saveSettings({ language })}
        onSignedIn={(p) => {
          setProfile(p);
          setSignedIn(true);
          setSignOutReason('');
          setTab('home');
        }}
      />
    );
  }

  const connectTo = async (locationId: number | null) => {
    setSettings({ ...settings, locationId });
    setTab('home');
    setStatus(await window.dt.connect(locationId));
  };

  return (
    <div className="shell">
      <main className="page">
        {tab === 'home' && (
          <HomePage
            t={t}
            profile={profile}
            status={status}
            settings={settings}
            pings={pings}
            onConnect={() => void connectTo(settings.locationId)}
            onDisconnect={() => void window.dt.disconnect().then(setStatus)}
            onPickLocation={() => setTab('locations')}
          />
        )}
        {tab === 'locations' && (
          <LocationsPage t={t} profile={profile} pings={pings} selected={settings.locationId} onPick={(id) => void connectTo(id)} onRefresh={refreshPings} />
        )}
        {tab === 'account' && (
          <AccountPage
            t={t}
            profile={profile}
            onRefresh={() => void loadProfile(true)}
            onLogout={() =>
              void window.dt.logout().then(() => {
                setProfile(null);
                setSignedIn(false);
              })
            }
          />
        )}
        {tab === 'settings' && <SettingsPage t={t} settings={settings} onChange={(patch) => void saveSettings(patch)} />}
      </main>
      <nav className="tabs">
        {(
          [
            ['home', HomeIcon, t('home')],
            ['locations', GlobeIcon, t('locations')],
            ['account', UserIcon, t('account')],
            ['settings', GearIcon, t('settings')],
          ] as const
        ).map(([key, Icon, label]) => (
          <button key={key} type="button" className={tab === key ? 'tab active' : 'tab'} onClick={() => setTab(key)}>
            <Icon />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
