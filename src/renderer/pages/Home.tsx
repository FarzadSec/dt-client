import { useEffect, useMemo, useState } from 'react';

import { lastDays } from '../../shared/activity';
import { engineOf, usableLocationIds } from '../../shared/engines';
import type { Activity, AppAccount, AppLocation, AppProfile, Language, LiveSample, PingResult, ProtocolChoice, Settings, Status } from '../../shared/types';
import { usageOf } from '../../shared/usage';
import { Flag } from '../components/Flag';
import { ArrowDownIcon, ArrowUpIcon, ChevronIcon, NextIcon, ShieldIcon } from '../components/Icons';
import { LiveChart } from '../components/LiveChart';
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
  live: LiveSample[];
  fetchedAt: number;
  onConnect: (locationId: number | null) => void;
  onDisconnect: () => void;
  onProtocol: (protocol: ProtocolChoice) => void;
  onAllLocations: () => void;
  onOpenSettings: (section: Section) => void;
}

const protocolNames: Record<string, string> = { xray: 'V2Ray', wireguard: 'WireGuard', openvpn: 'OpenVPN', l2tp: 'L2TP' };

// The protocols this account has that run on this system, in the order Auto tries them.
export function protocolChoices(profile: AppProfile): ProtocolChoice[] {
  const have = new Set<ProtocolChoice>();
  for (const c of profile.configs) {
    const engine = engineOf(c);
    if (!engine) continue;
    if (c.protocol === 'wireguard') have.add('wireguard');
    else if (engine === 'xray') have.add('xray');
    else have.add(engine);
  }
  return (['xray', 'wireguard', 'openvpn', 'l2tp'] as ProtocolChoice[]).filter((p) => have.has(p));
}

export function protocolName(protocol: string | undefined): string {
  if (!protocol) return '';
  return protocolNames[protocol] ?? protocol.toUpperCase();
}

function ProtocolSwitch({ t, profile, value, onChange }: { t: Translate; profile: AppProfile; value: ProtocolChoice; onChange: (p: ProtocolChoice) => void }) {
  const choices = protocolChoices(profile);
  if (choices.length === 0) return null;
  const all: ProtocolChoice[] = ['auto', ...choices];
  return (
    <div className="proto-switch" role="radiogroup" aria-label={t('protocol')}>
      {all.map((p) => (
        <button key={p} type="button" role="radio" aria-checked={value === p} className={value === p ? 'on' : ''} onClick={() => onChange(p)}>
          {p === 'auto' ? t('autoShort') : protocolNames[p]}
        </button>
      ))}
    </div>
  );
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
  const byId = useMemo(() => new Map(profile.locations.map((l) => [l.id, l])), [profile]);
  const shownId = status.state === 'disconnected' && !status.blocking ? settings.locationId : (status.serverId ?? status.locationId ?? null);
  const shown: AppLocation | undefined = shownId === null ? undefined : byId.get(shownId);

  const markers = useMemo(() => {
    const out: MapMarker[] = [];
    for (const l of profile.locations) {
      if (!usable.has(l.id)) continue;
      const p = countryPoint(l.countryCode);
      if (!p) continue;
      const kind = connected && l.id === shownId ? 'connected' : l.id === shownId ? 'selected' : 'server';
      out.push({ key: String(l.id), x: p.x, y: p.y, kind });
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

  const target: AppLocation | undefined = settings.locationId === null ? undefined : byId.get(settings.locationId);
  const usedProtocol = protocolName(status.protocol);

  return (
    <div className="home">
      <section className={connected ? 'hero live-on' : 'hero'}>
        <WorldMap markers={markers} focus={focus} rtl={lang === 'fa'} />
        {connected && (
          <div className="hero-live">
            <LiveChart t={t} samples={props.live} />
          </div>
        )}
        <div className="hero-status">
          <div className="status-head">
            <span className={`status-badge ${connected ? 'ok' : busy ? 'busy' : 'bad'}`}>
              <ShieldIcon off={!connected} />
            </span>
            <div>
              <h1>{title}</h1>
              <div className={`status-text ${connected ? 'ok' : busy ? 'busy' : 'bad'}`}>
                {stateText}
                {connected && status.since ? (
                  <>
                    {' · '}
                    <span dir="ltr">{clock(now - status.since)}</span>
                  </>
                ) : null}
              </div>
              {(connected || status.state === 'connecting') && status.protocol && (
                <div className="status-sub" dir="ltr">
                  {usedProtocol} · {status.configName}
                </div>
              )}
            </div>
          </div>
          <div className="hero-pickers">
            <button type="button" className="location-pick" onClick={props.onAllLocations} title={t('changeLocation')}>
              <Flag code={target ? target.countryCode : null} size={26} />
              <span>{target ? locationLabel(target, lang) : t('fastest')}</span>
              <ChevronIcon />
            </button>
            <ProtocolSwitch t={t} profile={profile} value={settings.protocol} onChange={props.onProtocol} />
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
      {!status.blocking && status.error && (
        <div className="banner error">
          <span>{errorText(t, status.error)}</span>
          {status.error === 'protocol_failed' && settings.protocol !== 'auto' && (
            <button type="button" className="link-btn" onClick={() => props.onProtocol('auto')}>
              {t('autoShort')}
            </button>
          )}
          {(status.error === 'all_failed' || status.error === 'connection_lost' || status.error === 'protocol_failed') && (
            <button type="button" className="link-btn" onClick={() => props.onOpenSettings('support')}>
              {t('reportShort')}
            </button>
          )}
        </div>
      )}
      {status.notice === 'stalled' && (
        <div className="banner error">
          <span>{t('notice.stalled', { protocol: usedProtocol })}</span>
          {settings.protocol !== 'auto' && (
            <button type="button" className="link-btn" onClick={() => props.onProtocol('auto')}>
              {t('autoShort')}
            </button>
          )}
        </div>
      )}
      {status.notice === 'switched' && <div className="banner info">{t('notice.switched', { protocol: usedProtocol })}</div>}
      {status.notice && status.notice !== 'stalled' && status.notice !== 'switched' && <div className="banner warn">{t(`notice.${status.notice}`)}</div>}

      <Recents {...props} byId={byId} usable={usable} />

      <div className="home-grid">
        <Statistics t={t} lang={lang} activity={activity} account={profile.account} />
        <div className="stack">
          <AccountCard t={t} profile={profile} fetchedAt={props.fetchedAt} onOpen={() => props.onOpenSettings('account')} />
          <Protection t={t} settings={settings} onOpen={props.onOpenSettings} />
        </div>
      </div>
    </div>
  );
}

function Recents({ t, lang, profile, pings, activity, onConnect, onAllLocations, byId, usable }: Props & { byId: Map<number, AppLocation>; usable: Set<number> }) {
  const recent = activity.recents.filter((id): id is number => id !== null && usable.has(id) && byId.has(id));
  const suggested = groupLocations(profile, pings, 'all', '', lang).flatMap((g) => g.items.map((i) => i.location.id));
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

function Statistics({ t, lang, activity, account }: { t: Translate; lang: Language; activity: Activity; account: AppAccount }) {
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
      <UsageBar t={t} account={account} />
    </section>
  );
}

// The plan's traffic as one bar: green, amber from 80% and red from 95%.
function UsageBar({ t, account }: { t: Translate; account: AppAccount }) {
  const u = usageOf(account);
  const ltr = (text: string) => <span dir="ltr">{text}</span>;
  return (
    <div className={`usage ${u.level}`}>
      <div className="usage-head">
        <span className="usage-title">{t('traffic')}</span>
        {u.percent !== null ? <span className="usage-percent" dir="ltr">{u.percent}%</span> : <span className="muted">{t('unlimitedTraffic')}</span>}
      </div>
      <div className={u.percent === null ? 'usage-track unlimited' : 'usage-track'} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={u.percent ?? undefined}>
        <div className="usage-fill" style={{ width: `${u.percent ?? 100}%` }} />
      </div>
      <div className="usage-foot">
        <span>{u.total > 0 ? t('usedOf', { used: '\u2068' + bytes(u.used) + '\u2069', total: '\u2068' + bytes(u.total) + '\u2069' }) : ltr(bytes(u.used))}</span>
        {u.left !== null && <span className="muted">{t('trafficLeft', { n: '\u2068' + bytes(u.left) + '\u2069' })}</span>}
      </div>
      <div className="usage-split muted">
        <span>
          <ArrowUpIcon /> {t('uploaded')} {ltr(bytes(account.upload))}
        </span>
        <span>
          <ArrowDownIcon /> {t('downloaded')} {ltr(bytes(account.download))}
        </span>
      </div>
    </div>
  );
}

// "just now", "5 min ago": when the subscription was last fetched.
export function ago(t: Translate, at: number, now = Date.now()): string {
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return t('justNow');
  if (min < 60) return t('minutesAgo', { n: min });
  return t('hoursAgo', { n: Math.floor(min / 60) });
}

function AccountCard({ t, profile, fetchedAt, onOpen }: { t: Translate; profile: AppProfile; fetchedAt: number; onOpen: () => void }) {
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
      {fetchedAt > 0 && <small className="muted updated">{t('updatedAgo', { when: ago(t, fetchedAt) })}</small>}
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
