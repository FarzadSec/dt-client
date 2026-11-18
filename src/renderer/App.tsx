import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import { bannerNotices, noticeLog, unreadNotices } from '../shared/notices';
import type { Activity, AppProfile, PingResult, ProfileUpdate, Settings, Status } from '../shared/types';
import { BellIcon, GearIcon, GlobeIcon, HelpIcon, PinIcon, RefreshIcon, SearchIcon, UserIcon } from './components/Icons';
import { NoticeBanners, NoticeCenter, Toast } from './components/Notices';
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
  const [showNotices, setShowNotices] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'bad' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const systemDark = useSystemDark();

  const lang = settings?.language ?? 'fa';
  const t = useMemo(() => translator(lang), [lang]);
  const dark = settings?.theme === 'system' ? systemDark : settings?.theme !== 'light';

  useEffect(() => {
    document.documentElement.dir = lang === 'en' ? 'ltr' : 'rtl';
    document.documentElement.lang = lang;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [lang, dark]);

  const refreshPings = useCallback(async () => {
    setPinging(true);
    try {
      setPings(await window.dt.ping());
    } catch {
      // The previous results stay.
    } finally {
      setPinging(false);
    }
  }, []);

  const showToast = useCallback((text: string, kind: 'ok' | 'bad') => {
    setToast({ text, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const signedOut = useCallback((code: string) => {
    setProfile(null);
    setSignedIn(false);
    setSignOutReason(code);
  }, []);

  const applyUpdate = useCallback((update: ProfileUpdate | null) => {
    if (!update) return;
    setProfile(update.profile);
    setSignedIn(true);
    setFetchedAt(update.fetchedAt);
  }, []);

  // A fetch from the panel now; the main process also does this every 10 minutes by itself.
  const refreshNow = useCallback(
    async (manual: boolean) => {
      setRefreshing(true);
      try {
        const update = await window.dt.refresh();
        applyUpdate(update);
        if (manual && update) showToast(update.error ? t('refreshFailed') : t('refreshed'), update.error ? 'bad' : 'ok');
      } catch (err) {
        signedOut((err as Error).message);
      } finally {
        setRefreshing(false);
      }
    },
    [applyUpdate, showToast, signedOut, t],
  );

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
      void loadProfile(false).then(() => refreshNow(false));
    });
    const offStatus = window.dt.onStatus((s) => {
      setStatus(s);
      void window.dt.activity().then(setActivity);
    });
    const offProfile = window.dt.onProfile(applyUpdate);
    const offSignedOut = window.dt.onSignedOut(signedOut);
    return () => {
      offStatus();
      offProfile();
      offSignedOut();
    };
  }, [loadProfile, applyUpdate, signedOut]);

  useEffect(() => {
    if (!signedIn) return;
    void refreshPings();
    const timer = setInterval(() => void refreshPings(), 60_000);
    return () => clearInterval(timer);
  }, [signedIn, profile, refreshPings]);

  const log = useMemo(() => (profile ? noticeLog(profile) : []), [profile]);

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
          setFetchedAt(Date.now());
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
  const banners = bannerNotices(log, settings.dismissedNotices);
  const unread = unreadNotices(log, { seenId: settings.seenNoticeId, seenAnnounce: settings.seenAnnounce });
  const toggleNotices = () => {
    setShowNotices((open) => !open);
    if (unread > 0) {
      const seenNoticeId = Math.max(settings.seenNoticeId, ...log.map((n) => n.id));
      void saveSettings({ seenNoticeId, seenAnnounce: profile.announce?.trim() ?? '' });
    }
  };
  const closeBanner = (key: string) => void saveSettings({ dismissedNotices: [...settings.dismissedNotices.filter((k) => log.some((n) => n.key === k)), key] });
  const timeFormat = new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  const refreshTitle = fetchedAt ? `${t('refreshSub')} · ${t('updatedAt', { time: timeFormat.format(new Date(fetchedAt)) })}` : t('refreshSub');

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
          <button
            type="button"
            className={refreshing ? 'round-btn spinning' : 'round-btn'}
            aria-label={t('refreshSub')}
            title={refreshTitle}
            disabled={refreshing}
            onClick={() => void refreshNow(true)}
          >
            <RefreshIcon />
          </button>
          <button type="button" className="round-btn bell-btn" aria-label={t('notices')} title={t('notices')} onClick={toggleNotices}>
            <BellIcon />
            {unread > 0 && <span className="badge">{unread > 9 ? '9+' : unread}</span>}
          </button>
          <button type="button" className="round-btn" aria-label={t('account')} onClick={() => openSettings('account')}>
            <UserIcon />
          </button>
        </div>
        {showNotices && <NoticeCenter t={t} lang={lang} notices={log} onClose={() => setShowNotices(false)} />}
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
        <NoticeBanners t={t} notices={banners} onClose={closeBanner} />
        {page === 'home' && (
          <Home
            t={t}
            lang={lang}
            profile={profile}
            status={status}
            settings={settings}
            pings={pings}
            activity={activity}
            onConnect={(id) => void connectTo(id)}
            onDisconnect={disconnect}
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
            pinging={pinging}
            onPing={() => void refreshPings()}
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
            onRefresh={() => void refreshNow(true)}
            onLogout={() =>
              void window.dt.logout().then(() => {
                setProfile(null);
                setSignedIn(false);
              })
            }
          />
        )}
      </main>
      {toast && <Toast text={toast.text} kind={toast.kind} />}
    </div>
  );
}
