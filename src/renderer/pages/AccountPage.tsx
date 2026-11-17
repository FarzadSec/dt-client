import type { AppProfile } from '../../shared/types';
import { bytes, daysLeft } from '../format';
import type { Translate } from '../i18n';

interface Props {
  t: Translate;
  profile: AppProfile;
  onRefresh: () => void;
  onLogout: () => void;
}

export function AccountPage({ t, profile, onRefresh, onLogout }: Props) {
  const a = profile.account;
  const used = a.upload + a.download;
  const percent = a.total > 0 ? Math.min(100, (used / a.total) * 100) : 0;
  let expiry = t('never');
  if (a.expiryTime > 0) expiry = `${new Date(a.expiryTime).toLocaleDateString()} · ${t('daysLeft', { n: daysLeft(a.expiryTime) })}`;
  else if (a.expiryTime < 0) expiry = t('firstUse');

  return (
    <div className="list-page">
      <div className="page-title">
        <h2>{t('account')}</h2>
        <button type="button" className="link" onClick={onRefresh}>
          {t('refresh')}
        </button>
      </div>
      <div className="card">
        <div className="kv">
          <span className="muted">{t('username')}</span>
          <strong dir="ltr">{a.username}</strong>
        </div>
        <div className="kv">
          <span className="muted">{t('status')}</span>
          <span className={a.enabled ? 'badge ok' : 'badge bad'}>{a.enabled ? t('active') : t('inactive')}</span>
        </div>
        <div className="kv column">
          <span className="muted">{t('usage')}</span>
          <span dir="ltr">
            {bytes(used)} / {a.total > 0 ? bytes(a.total) : t('unlimited')}
          </span>
          {a.total > 0 && (
            <div className="bar">
              <div style={{ width: `${percent}%` }} />
            </div>
          )}
        </div>
        <div className="kv">
          <span className="muted">{t('expires')}</span>
          <span>{expiry}</span>
        </div>
        <div className="kv">
          <span className="muted">{t('devices')}</span>
          <span dir="ltr">{a.deviceLimit > 0 ? `${a.devices} / ${a.deviceLimit}` : t('unlimited')}</span>
        </div>
      </div>
      {profile.supportUrl && (
        <button type="button" className="secondary" onClick={() => void window.dt.openExternal(profile.supportUrl ?? '')}>
          {t('support')}
        </button>
      )}
      <button type="button" className="danger" onClick={onLogout}>
        {t('logout')}
      </button>
    </div>
  );
}
