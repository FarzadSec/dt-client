import type { ProtocolChoice, Settings } from '../../shared/types';
import type { Translate } from '../i18n';

interface Props {
  t: Translate;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}

const protocols: ProtocolChoice[] = ['auto', 'xray', 'wireguard', 'openvpn', 'l2tp'];
const protocolNames: Record<ProtocolChoice, string> = { auto: '', xray: 'Xray', wireguard: 'WireGuard', openvpn: 'OpenVPN', l2tp: 'L2TP' };

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        {hint && <small className="muted">{hint}</small>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function SettingsPage({ t, settings, onChange }: Props) {
  return (
    <div className="list-page">
      <div className="page-title">
        <h2>{t('settings')}</h2>
      </div>
      <div className="card">
        <div className="field">
          <strong>{t('protocol')}</strong>
          <div className="segmented">
            {protocols.map((p) => (
              <button key={p} type="button" className={settings.protocol === p ? 'active' : ''} onClick={() => onChange({ protocol: p })}>
                {p === 'auto' ? t('auto') : protocolNames[p]}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="card">
        <Toggle label={t('killSwitch')} hint={t('killSwitchHint')} checked={settings.killSwitch} onChange={(killSwitch) => onChange({ killSwitch })} />
        <Toggle label={t('webrtc')} hint={t('webrtcHint')} checked={settings.webrtcProtection} onChange={(webrtcProtection) => onChange({ webrtcProtection })} />
        <Toggle label={t('timezone')} hint={t('timezoneHint')} checked={settings.timezoneSpoof} onChange={(timezoneSpoof) => onChange({ timezoneSpoof })} />
        <Toggle label={t('iranDirect')} hint={t('iranDirectHint')} checked={settings.iranDirect} onChange={(iranDirect) => onChange({ iranDirect })} />
      </div>
      <div className="card">
        <Toggle label={t('connectOnStart')} checked={settings.connectOnStart} onChange={(connectOnStart) => onChange({ connectOnStart })} />
        <Toggle label={t('startWithWindows')} checked={settings.startWithWindows} onChange={(startWithWindows) => onChange({ startWithWindows })} />
        <div className="field">
          <strong>{t('language')}</strong>
          <div className="segmented">
            <button type="button" className={settings.language === 'fa' ? 'active' : ''} onClick={() => onChange({ language: 'fa' })}>
              فارسی
            </button>
            <button type="button" className={settings.language === 'en' ? 'active' : ''} onClick={() => onChange({ language: 'en' })}>
              English
            </button>
          </div>
        </div>
      </div>
      <div className="muted small center">
        {t('appName')} · {t('version')} <span dir="ltr">{__APP_VERSION__}</span>
      </div>
    </div>
  );
}
