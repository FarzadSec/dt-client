import { useEffect, useState } from 'react';

import { bestPing } from '../../shared/engines';
import type { AppProfile, PingResult, Settings, Status } from '../../shared/types';
import { Flag } from '../components/Flag';
import { BoltIcon, PowerIcon } from '../components/Icons';
import { duration } from '../format';
import { errorText, type Translate } from '../i18n';

interface Props {
  t: Translate;
  profile: AppProfile;
  status: Status;
  settings: Settings;
  pings: PingResult[];
  onConnect: () => void;
  onDisconnect: () => void;
  onPickLocation: () => void;
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

export function HomePage({ t, profile, status, settings, pings, onConnect, onDisconnect, onPickLocation }: Props) {
  const connected = status.state === 'connected';
  const busy = status.state === 'connecting' || status.state === 'disconnecting';
  const now = useNow(connected);
  const location = profile.locations.find((l) => l.nodeId === settings.locationId);
  const ping = bestPing(profile, pings, settings.locationId);

  const label = connected ? t('connected') : status.state === 'connecting' ? t('connecting') : status.state === 'disconnecting' ? t('disconnecting') : t('notConnected');

  return (
    <div className="home">
      <header className="home-head">
        <div>
          <div className="muted small">{profile.title || t('brand')}</div>
          <h2>{t('appName')}</h2>
        </div>
      </header>

      {profile.announce && <div className="alert info">{profile.announce}</div>}

      <div className={`ring ${status.state}${status.blocking ? ' blocking' : ''}`}>
        <button
          type="button"
          className="power"
          aria-label={connected || status.blocking ? t('disconnect') : t('connect')}
          disabled={busy}
          onClick={connected || status.blocking ? onDisconnect : onConnect}
        >
          <PowerIcon />
        </button>
      </div>
      <div className="state-label">{label}</div>
      {connected && status.since && <div className="timer">{duration(now - status.since)}</div>}
      {(connected || status.state === 'connecting') && status.configName && (
        <div className="muted small center">
          {t('via')} <span dir="ltr">{status.protocol?.toUpperCase()}</span> · <span dir="ltr">{status.configName}</span>
        </div>
      )}

      {status.blocking && <div className="alert warn">{t('blocking')}</div>}
      {!status.blocking && status.error && <div className="alert error">{errorText(t, status.error)}</div>}
      {status.notice && <div className="alert warn">{t(`notice.${status.notice}`)}</div>}

      <button type="button" className="location-card" onClick={onPickLocation}>
        {location ? <Flag code={location.countryCode} /> : <span className="flag bolt"><BoltIcon /></span>}
        <span className="location-text">
          <strong>{location ? location.name || `#${location.nodeId}` : t('fastest')}</strong>
          <small className="muted">{location ? location.city : t('fastestHint')}</small>
        </span>
        {ping !== null && <span className="ping">{ping} ms</span>}
      </button>
    </div>
  );
}
