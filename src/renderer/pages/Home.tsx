import { useEffect, useMemo, useState } from 'react';

import { lastDays } from '../../shared/activity';
import { usableLocationIds } from '../../shared/engines';
import type { Activity, AppLocation, AppProfile, Language, PingResult, Settings, Status } from '../../shared/types';
import { Flag } from '../components/Flag';
import { CloseIcon, NextIcon, ShieldIcon } from '../components/Icons';
import { WorldMap, type MapMarker } from '../components/WorldMap';
import { bytes, clock, daysLeft, spent } from '../format';
import { countryPoint } from '../geo/geo';
import { errorText, type Translate } from '../i18n';
import { groupLocations, locationLabel } from '../locations';
import type { Section } from './Settings';

interface Props {
  t: Translate;
  lang: Language;
  profile: AppProfile;
  status: Status;
  settings: Settings;
  pings: PingResult[];
  activity: Activity;
  announce: string;
  onConnect: (locationId: number | null) => void;
  onDisconnect: () => void;
  onDismissAnnounce: () => void;
  onAllLocations: () => void;
  onOpenSettings: (section: Section) => void;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function Home(props: Props) {
  const { t, lang, profile, status, settings, activity } = props;
  const connected = status.state === 'connected';
  const busy = status.state === 'connecting' || status.state === 'disconnecting';
  const now = useNow(connected);

  const usable = useMemo(() => new Set(usableLocationIds(profile)), [profile]);
  const byId = useMemo(() => new Map(profile.locations.map((l) => [l.nodeId, l])), [profile]);
  const shownId = status.state === 'disconnected' && !status.blocking ? settings.locationId : (status.serverId ?? status.locationId ?? null);
  const shown: AppLocation | undefined = shownId === null ? undefined : byId.get(shownId);

  const markers = useMemo(() => {
    const out: MapMarker[] = [];
    for (const l of profile.locations) {
      if (!usable.has(l.nodeId)) continue;
      const p = countryPoint(l.countryCode);
      if (!p) continue;
      const kind = connected && l.nodeId === shownId ? 'connected' : l.nodeId === shownId ? 'selected' : 'server';
      out.push({ key: String(l.nodeId), x: p.x, y: p.y, kind });
    }
    return out;
  }, [profile, usable, connected, shownId]);

  const focus = useMemo(() => {
    const own = shown ? countryPoint(shown.countryCode) : null;
    if (own) return own;
    if (markers.length === 0) return { x: 0.55, y: 0.42 };
    return { x: markers.reduce((s, m) => s + m.x, 0) / markers.length, y: markers.reduce((s, m) => s + m.y, 0) / markers.length };
  }, [shown, markers]);

  let title = shown ? locationLabel(shown, lang) : t('fastest');
  if (shown?.city && shown.name && shown.city !== shown.name) title = `${title} · ${shown.city}`;
  const stateText = connected ? t('connected') : status.state === 'connecting' ? t('connecting') : status.state === 'disconnecting' ? t('disconnecting') : t('notConnected');

  return (
    <div className="home">
      <section className="hero">
        <WorldMap markers={markers} focus={focus} rtl={lang === 'fa'} />
        <div className="hero-status">
          <div className="status-head">
            <span className={`status-badge ${connected ? 'ok' : busy ? 'busy' : 'bad'}`}>
              <ShieldIcon off={!connected} />
            </span>
            <div>
              <h1>{title}</h1>
              <div className={`status-text ${connected ? 'ok' : busy ? 'busy' : 'bad'}`}>
                {stateText}
                {connected && status.since ? <span dir="ltr"> · {clock(now - status.since)}</span> : null}
              </div>
              {(connected || status.state === 'connecting') && status.protocol && (
                <div className="status-sub" dir="ltr">
                  {status.protocol.toUpperCase()} · {status.configName}
                </div>
              )}
            </div>
          </div>
          <div className="hero-actions">
            {connected || status.blocking ? (
              <button type="button" className="btn btn-secondary btn-lg" onClick={props.onDisconnect}>
                {t('disconnect')}
              </button>
            ) : status.state === 'connecting' ? (
              <button type="button" className="btn btn-secondary btn-lg" onClick={props.onDisconnect}>
                {t('cancel')}
              </button>
            ) : (
              <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={() => props.onConnect(settings.locationId)}>
                {t('quickConnect')}
              </button>
            )}
          </div>
        </div>
      </section>

      {status.blocking && <div className="banner warn">{t('blocking')}</div>}
      {!status.blocking && status.error && <div className="banner error">{errorText(t, status.error)}</div>}
      {status.notice && <div className="banner warn">{t(`notice.${status.notice}`)}</div>}
      {props.announce && (
        <div className="banner info">
          <span dir="auto">{props.announce}</span>
          <button type="button" className="icon-btn" aria-label="close" onClick={props.onDismissAnnounce}>
            <CloseIcon />
          </button>
        </div>
      )}

      <Recents {...props} byId={byId} usable={usable} />

      <div className="home-grid">
        <Statistics t={t} lang={lang} activity={activity} />
        <div className="stack">
          <AccountCard t={t} profile={profile} onOpen={() => props.onOpenSettings('account')} />
          <Protection t={t} settings={settings} onOpen={props.onOpenSettings} />
        </div>
      </div>
    </div>
  );
}

function Recents({ t, lang, profile, pings, activity, onConnect, onAllLocations, byId, usable }: Props & { byId: Map<number, AppLocation>; usable: Set<number> }) {
  const recent = activity.recents.filter((id): id is number => id !== null && usable.has(id) && byId.has(id));
  const suggested = groupLocations(profile, pings, 'all', '', lang).flatMap((g) => g.items.map((i) => i.location.nodeId));
  const ids = [...new Set([...recent, ...suggested])].slice(0, 6);
  if (ids.length === 0) return null;
  return (
    <section>
      <div className="section-head">
        <h3>{recent.length > 0 ? t('recents') : t('suggested')}</h3>
        <button type="button" className="link-btn" onClick={onAllLocations}>
          {t('allLocations')} <NextIcon />
        </button>
      </div>
      <div className="recents">
        <button type="button" className="recent-card" onClick={() => onConnect(null)}>
          <Flag code={null} size={34} />
          <strong>{t('fastestShort')}</strong>
          <small>{t('fastest')}</small>
        </button>
        {ids.map((id) => {
          const l = byId.get(id) as AppLocation;
          return (
            <button key={id} type="button" className="recent-card" onClick={() => onConnect(id)}>
              <Flag code={l.countryCode} size={34} />
              <strong>{locationLabel(l, lang)}</strong>
              <small>{l.city || ' '}</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Statistics({ t, lang, activity }: { t: Translate; lang: Language; activity: Activity }) {
  const days = lastDays(activity, 7);
  const max = Math.max(3600, ...days.map((d) => d.seconds));
  const total = days.reduce((s, d) => s + d.seconds, 0);
  const weekday = new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR' : 'en-US', { weekday: 'short' });
  return (
    <section className="card stats">
      <div className="card-head">
        <h3>{t('timeConnected')}</h3>
        <span className="muted">
          {t('thisWeek')}: <b>{spent(t, total)}</b>
        </span>
      </div>
      <div className="bars">
        {days.map((d, i) => (
          <div key={d.key} className={i === days.length - 1 ? 'bar today' : 'bar'} title={spent(t, d.seconds)}>
            <div className="bar-track">
              <div className="bar-fill" style={{ height: `${Math.max(2, (d.seconds / max) * 100)}%` }} />
            </div>
            <span>{weekday.format(new Date(`${d.key}T12:00:00`))}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function AccountCard({ t, profile, onOpen }: { t: Translate; profile: AppProfile; onOpen: () => void }) {
  const a = profile.account;
  const used = a.upload + a.download;
  const percent = a.total > 0 ? Math.min(100, (used / a.total) * 100) : 0;
  const expiry = a.expiryTime > 0 ? t('daysLeft', { n: daysLeft(a.expiryTime) }) : a.expiryTime < 0 ? t('firstUse') : t('never');
  return (
    <button type="button" className="card account-card" onClick={onOpen}>
      <div className="card-head">
        <h3>{t('yourAccount')}</h3>
        <span className={a.enabled ? 'pill ok' : 'pill bad'}>{a.enabled ? t('active') : t('inactive')}</span>
      </div>
      <div className="usage-line">
        <span dir="ltr">
          {bytes(used)} / {a.total > 0 ? bytes(a.total) : '∞'}
        </span>
        <span className="muted">{expiry}</span>
      </div>
      <div className="meter">
        <div style={{ width: `${a.total > 0 ? percent : 0}%` }} />
      </div>
    </button>
  );
}

function Protection({ t, settings, onOpen }: { t: Translate; settings: Settings; onOpen: (s: Section) => void }) {
  const items: [string, boolean, Section][] = [
    [t('killSwitch'), settings.killSwitch, 'killswitch'],
    [t('adBlock'), settings.adBlock, 'connection'],
    [t('webrtc'), settings.webrtcProtection, 'privacy'],
    [t('splitTunneling'), settings.splitTunneling || settings.iranDirect, 'split'],
  ];
  return (
    <div className="card list-card">
      {items.map(([label, on, section]) => (
        <button key={label} type="button" className="list-item" onClick={() => onOpen(section)}>
          <span>{label}</span>
          <span className={on ? 'pill ok' : 'pill bad'}>{on ? t('on') : t('off')}</span>
          <NextIcon />
        </button>
      ))}
    </div>
  );
}
