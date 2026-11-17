import { useMemo, useState } from 'react';

import type { AppProfile, Language, PingResult, Status } from '../../shared/types';
import { Flag } from '../components/Flag';
import { ChevronIcon } from '../components/Icons';
import type { Translate } from '../i18n';
import { groupLocations, locationLabel, type LocationItem, type ProtocolFilter } from '../locations';

interface Props {
  t: Translate;
  lang: Language;
  profile: AppProfile;
  pings: PingResult[];
  status: Status;
  selected: number | null;
  query: string;
  onConnect: (locationId: number | null) => void;
  onDisconnect: () => void;
}

const filters: [ProtocolFilter, string][] = [
  ['all', ''],
  ['xray', 'Xray'],
  ['wireguard', 'WireGuard'],
  ['openvpn', 'OpenVPN'],
  ['l2tp', 'L2TP'],
];

const protocolNames: Record<string, string> = { xray: 'Xray', wireguard: 'WireGuard', openvpn: 'OpenVPN', l2tp: 'L2TP' };

function Ping({ ms }: { ms: number | null }) {
  return <span className={ms === null ? 'ping off' : ms < 150 ? 'ping good' : 'ping'}>{ms === null ? '—' : `${ms} ms`}</span>;
}

export function Locations({ t, lang, profile, pings, status, selected, query, onConnect, onDisconnect }: Props) {
  const [filter, setFilter] = useState<ProtocolFilter>('all');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const groups = useMemo(() => groupLocations(profile, pings, filter, query, lang), [profile, pings, filter, query, lang]);
  const activeId = status.state === 'disconnected' ? null : (status.serverId ?? null);

  const serverRow = (item: LocationItem, nested: boolean) => {
    const id = item.location.nodeId;
    const active = activeId === id;
    const label = locationLabel(item.location, lang);
    return (
      <div key={id} className={`loc-row${nested ? ' nested' : ''}${active ? ' active' : ''}${selected === id ? ' selected' : ''}`}>
        {!nested && <Flag code={item.location.countryCode} />}
        <button type="button" className="loc-main" onClick={() => onConnect(id)}>
          <strong>{label}</strong>
          <small dir="ltr">{[item.location.city !== label ? item.location.city : '', ...item.protocols.map((p) => protocolNames[p])].filter(Boolean).join(' · ')}</small>
        </button>
        <Ping ms={item.ping} />
        {active ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onDisconnect}>
            {t('disconnect')}
          </button>
        ) : (
          <button type="button" className="btn btn-primary btn-sm ghost-until-hover" onClick={() => onConnect(id)}>
            {t('connectTo')}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="locations">
      <div className="chips">
        {filters.map(([key, label]) => (
          <button key={key} type="button" className={filter === key ? 'chip active' : 'chip'} onClick={() => setFilter(key)}>
            {key === 'all' ? t('all') : label}
          </button>
        ))}
      </div>
      <div className="muted list-title">{t('selectLocation')}</div>

      <div className="card loc-list">
        {!query && (
          <div className={`loc-row${selected === null ? ' selected' : ''}`}>
            <Flag code={null} />
            <button type="button" className="loc-main" onClick={() => onConnect(null)}>
              <strong>{t('fastest')}</strong>
              <small>{t('fastestShort')}</small>
            </button>
            <button type="button" className="btn btn-primary btn-sm ghost-until-hover" onClick={() => onConnect(null)}>
              {t('connectTo')}
            </button>
          </div>
        )}
        {groups.length === 0 && <div className="empty">{query ? t('noMatch') : t('noLocations')}</div>}
        {groups.map((group) => {
          if (group.items.length === 1) return serverRow(group.items[0], false);
          const expanded = open.has(group.code) || query.trim() !== '';
          const best = group.items[0].ping;
          return (
            <div key={group.code || 'other'} className="loc-group">
              <button
                type="button"
                className="loc-row country"
                onClick={() =>
                  setOpen((prev) => {
                    const next = new Set(prev);
                    if (next.has(group.code)) next.delete(group.code);
                    else next.add(group.code);
                    return next;
                  })
                }
              >
                <Flag code={group.code} />
                <span className="loc-main">
                  <strong>{group.name || '—'}</strong>
                  <small>{t('servers', { n: group.items.length })}</small>
                </span>
                <Ping ms={best} />
                <ChevronIcon open={expanded} />
              </button>
              {expanded && group.items.map((item) => serverRow(item, true))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
