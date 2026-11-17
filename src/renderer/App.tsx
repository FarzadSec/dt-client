import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';

import type { Activity, AppProfile, PingResult, Settings, Status } from '../shared/types';
import { BellIcon, GearIcon, GlobeIcon, HelpIcon, PinIcon, SearchIcon, UserIcon } from './components/Icons';
import { translator } from './i18n';
import logo from './logo.svg';
import { Home } from './pages/Home';
import { Locations } from './pages/Locations';
import { SettingsPage, type Section } from './pages/Settings';
import { Welcome } from './pages/Welcome';

type Page = 'home' | 'locations' | 'settings';

function useSystemDark(): boolean {
  const query = useMemo(() => window.matchMedia('(prefers-color-scheme: dark)'), []);
  const [dark, setDark] = useState(query.matches);
  useEffect(() => {
    const onChange = () => setDark(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [query]);
  return dark;
}

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [profile, setProfile] = useState<AppProfile | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [status, setStatus] = useState<Status>({ state: 'disconnected' });
  const [pings, setPings] = useState<PingResult[]>([]);
  const [activity, setActivity] = useState<Activity>({ days: {}, recents: [] });
  const [page, setPage] = useState<Page>('home');
  const [section, setSection] = useState<Section>('general');
  const [query, setQuery] = useState('');
  const [signOutReason, setSignOutReason] = useState('');
  const [showAnnounce, setShowAnnounce] = useState(false);
  const systemDark = useSystemDark();

  const lang = settings?.language ?? 'fa';
  const t = useMemo(() => translator(lang), [lang]);
  const dark = settings?.theme === 'system' ? systemDark : settings?.theme !== 'light';

  useEffect(() => {
    document.documentElement.dir = lang === 'en' ? 'ltr' : 'rtl';
    document.documentElement.lang = lang;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [lang, dark]);

  const refreshPings = useCallback(() => {
    void window.dt.ping().then(setPings).catch(() => undefined);
  }, []);

  const loadProfile = useCallback(async (force: boolean) => {
    try {
      const p = await window.dt.profile(force);
      setProfile(p);
      setSignedIn(p !== null);
    } catch (err) {
      setProfile(null);
      setSignedIn(false);
      setSignOutReason((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void window.dt.settings().then(setSettings);
    void window.dt.status().then(setStatus);
    void window.dt.activity().then(setActivity);
    void window.dt.session().then((s) => {
      if (!s) {
        setSignedIn(false);
        return;
      }
      void loadProfile(false).then(() => loadProfile(true));
    });
    return window.dt.onStatus((s) => {
      setStatus(s);
      void window.dt.activity().then(setActivity);
    });
  }, [loadProfile]);

  useEffect(() => {
    if (!signedIn) return;
    refreshPings();
    const timer = setInterval(refreshPings, 60_000);
    return () => clearInterval(timer);
  }, [signedIn, profile, refreshPings]);

  const saveSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    setSettings(await window.dt.saveSettings(patch));
  }, []);

  if (!settings || signedIn === null) return <div className="splash" />;

  if (!signedIn || !profile) {
    return (
      <Welcome
        t={t}
        settings={settings}
        reason={signOutReason}
        onLanguage={(language) => void saveSettings({ language })}
        onSignedIn={(p) => {
          setProfile(p);
          setSignedIn(true);
          setSignOutReason('');
          setPage('home');
        }}
      />
    );
  }

  const connectTo = async (locationId: number | null) => {
    setSettings({ ...settings, locationId });
    setPage('home');
    setStatus(await window.dt.connect(locationId));
  };
  const disconnect = () => void window.dt.disconnect().then(setStatus);
  const openSettings = (s: Section) => {
    setSection(s);
    setPage('settings');
  };
  const announce = profile.announce && profile.announce !== settings.dismissedAnnounce ? profile.announce : '';

  const nav: [Page, () => ReactElement, string][] = [
    ['home', GlobeIcon, t('home')],
    ['locations', PinIcon, t('locations')],
    ['settings', GearIcon, t('settings')],
  ];

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <img src={logo} alt="" />
          <span>{t('appName')}</span>
        </div>
        <label className="search">
          <SearchIcon />
          <input
            value={query}
            placeholder={t('searchLocations')}
            onFocus={() => setPage('locations')}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage('locations');
            }}
          />
        </label>
        <div className="top-actions">
          {profile.announce && (
            <button type="button" className={announce ? 'round-btn dot' : 'round-btn'} aria-label="announce" onClick={() => setShowAnnounce((v) => !v)}>
              <BellIcon />
            </button>
          )}
          <button type="button" className="round-btn" aria-label={t('account')} onClick={() => openSettings('account')}>
            <UserIcon />
          </button>
        </div>
        {showAnnounce && profile.announce && (
          <div className="popover" dir="auto" onClick={() => setShowAnnounce(false)}>
            {profile.announce}
          </div>
        )}
      </header>

      <nav className="rail">
        {nav.map(([key, Icon, label]) => (
          <button key={key} type="button" className={page === key ? 'rail-btn active' : 'rail-btn'} title={label} aria-label={label} onClick={() => setPage(key)}>
            <Icon />
          </button>
        ))}
        <div className="rail-spacer" />
        {profile.supportUrl && (
          <button type="button" className="rail-btn" title={t('help')} aria-label={t('help')} onClick={() => void window.dt.openExternal(profile.supportUrl ?? '')}>
            <HelpIcon />
          </button>
        )}
      </nav>

      <main className="content">
        {page === 'home' && (
          <Home
            t={t}
            lang={lang}
            profile={profile}
            status={status}
            settings={settings}
            pings={pings}
            activity={activity}
            announce={announce}
            onConnect={(id) => void connectTo(id)}
            onDisconnect={disconnect}
            onDismissAnnounce={() => void saveSettings({ dismissedAnnounce: profile.announce ?? '' })}
            onAllLocations={() => setPage('locations')}
            onOpenSettings={openSettings}
          />
        )}
        {page === 'locations' && (
          <Locations
            t={t}
            lang={lang}
            profile={profile}
            pings={pings}
            status={status}
            selected={settings.locationId}
            query={query}
            onConnect={(id) => void connectTo(id)}
            onDisconnect={disconnect}
          />
        )}
        {page === 'settings' && (
          <SettingsPage
            t={t}
            settings={settings}
            profile={profile}
            section={section}
            onSection={setSection}
            onChange={(patch) => void saveSettings(patch)}
            onRefresh={() => void loadProfile(true)}
            onLogout={() =>
              void window.dt.logout().then(() => {
                setProfile(null);
                setSignedIn(false);
              })
            }
          />
        )}
      </main>
    </div>
  );
}
