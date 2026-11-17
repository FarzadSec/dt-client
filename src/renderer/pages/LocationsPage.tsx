import { bestPing, usableLocationIds } from '../../shared/engines';
import type { AppProfile, PingResult } from '../../shared/types';
import { Flag } from '../components/Flag';
import { BoltIcon } from '../components/Icons';
import type { Translate } from '../i18n';

interface Props {
  t: Translate;
  profile: AppProfile;
  pings: PingResult[];
  selected: number | null;
  onPick: (locationId: number | null) => void;
  onRefresh: () => void;
}

export function LocationsPage({ t, profile, pings, selected, onPick, onRefresh }: Props) {
  const usable = new Set(usableLocationIds(profile));
  const locations = profile.locations.filter((l) => usable.has(l.nodeId));
  if (locations.length === 0) return <div className="empty">{t('noLocations')}</div>;

  return (
    <div className="list-page">
      <div className="page-title">
        <h2>{t('locations')}</h2>
        <button type="button" className="link" onClick={onRefresh}>
          {t('refresh')}
        </button>
      </div>
      <button type="button" className={selected === null ? 'row selected' : 'row'} onClick={() => onPick(null)}>
        <span className="flag bolt">
          <BoltIcon />
        </span>
        <span className="location-text">
          <strong>{t('fastest')}</strong>
          <small className="muted">{t('fastestHint')}</small>
        </span>
      </button>
      {locations.map((location) => {
        const ms = bestPing(profile, pings, location.nodeId);
        return (
          <button
            key={location.nodeId}
            type="button"
            className={selected === location.nodeId ? 'row selected' : 'row'}
            onClick={() => onPick(location.nodeId)}
          >
            <Flag code={location.countryCode} />
            <span className="location-text">
              <strong>{location.name || `#${location.nodeId}`}</strong>
              <small className="muted">{location.city}</small>
            </span>
            <span className={ms === null ? 'ping off' : ms < 150 ? 'ping good' : 'ping'}>{ms === null ? '—' : `${ms} ms`}</span>
          </button>
        );
      })}
    </div>
  );
}
