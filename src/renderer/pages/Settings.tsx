import { useEffect, useState, type ReactElement, type ReactNode } from 'react';

import type { AppProfile, ProtocolChoice, Settings, SplitApp } from '../../shared/types';
import { Row, Select, Switch } from '../components/Controls';
import { EyeOffIcon, InfoIcon, LockIcon, PlusIcon, SlidersIcon, SplitIcon, TrashIcon, UserIcon, WifiIcon } from '../components/Icons';
import { bytes, daysLeft } from '../format';
import type { Translate } from '../i18n';
import logo from '../logo.svg';

export type Section = 'general' | 'account' | 'connection' | 'killswitch' | 'split' | 'privacy' | 'about';

interface Props {
  t: Translate;
  settings: Settings;
  profile: AppProfile;
  section: Section;
  onSection: (s: Section) => void;
  onChange: (patch: Partial<Settings>) => void;
  onRefresh: () => void;
  onLogout: () => void;
}

function Group({ children }: { children: ReactNode }) {
  return <div className="card group">{children}</div>;
}

export function SettingsPage(props: Props) {
  const { t, section, onSection } = props;
  const nav: [Section, () => ReactElement, string][] = [
    ['general', SlidersIcon, t('general')],
    ['account', () => <UserIcon />, t('account')],
    ['connection', WifiIcon, t('connection')],
    ['killswitch', LockIcon, t('killSwitch')],
    ['split', SplitIcon, t('splitTunneling')],
    ['privacy', EyeOffIcon, t('privacy')],
    ['about', InfoIcon, t('about')],
  ];
  const title = nav.find(([key]) => key === section)?.[2] ?? '';
  return (
    <div className="settings">
      <nav className="settings-nav">
        {nav.map(([key, Icon, label]) => (
          <button key={key} type="button" className={section === key ? 'nav-item active' : 'nav-item'} onClick={() => onSection(key)}>
            <Icon />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="settings-body">
        <h1>{title}</h1>
        {section === 'general' && <General {...props} />}
        {section === 'account' && <Account {...props} />}
        {section === 'connection' && <Connection {...props} />}
        {section === 'killswitch' && <KillSwitch {...props} />}
        {section === 'split' && <Split {...props} />}
        {section === 'privacy' && <Privacy {...props} />}
        {section === 'about' && <About {...props} />}
      </div>
    </div>
  );
}

function General({ t, settings, onChange }: Props) {
  return (
    <Group>
      <Row title={t('language')}>
        <Select
          label={t('language')}
          value={settings.language}
          onChange={(language) => onChange({ language })}
          options={[
            { value: 'fa', label: 'فارسی' },
            { value: 'en', label: 'English' },
          ]}
        />
      </Row>
      <Row title={t('appearance')}>
        <Select
          label={t('appearance')}
          value={settings.theme}
          onChange={(theme) => onChange({ theme })}
          options={[
            { value: 'system', label: t('themeSystem') },
            { value: 'dark', label: t('themeDark') },
            { value: 'light', label: t('themeLight') },
          ]}
        />
      </Row>
      <Row title={t('startWithWindows')} hint={t('startWithWindowsHint')}>
        <Switch label={t('startWithWindows')} checked={settings.startWithWindows} onChange={(startWithWindows) => onChange({ startWithWindows })} />
      </Row>
      <Row title={t('launchMinimized')} hint={t('launchMinimizedHint')}>
        <Switch label={t('launchMinimized')} checked={settings.launchMinimized} onChange={(launchMinimized) => onChange({ launchMinimized })} />
      </Row>
      <Row title={t('connectOnStart')} hint={t('connectOnStartHint')}>
        <Switch label={t('connectOnStart')} checked={settings.connectOnStart} onChange={(connectOnStart) => onChange({ connectOnStart })} />
      </Row>
      <Row title={t('notifications')} hint={t('notificationsHint')}>
        <Switch label={t('notifications')} checked={settings.notifications} onChange={(notifications) => onChange({ notifications })} />
      </Row>
    </Group>
  );
}

function Account({ t, profile, onRefresh, onLogout }: Props) {
  const a = profile.account;
  const used = a.upload + a.download;
  let expiry = t('never');
  if (a.expiryTime > 0) expiry = `${new Date(a.expiryTime).toLocaleDateString()} · ${t('daysLeft', { n: daysLeft(a.expiryTime) })}`;
  else if (a.expiryTime < 0) expiry = t('firstUse');
  return (
    <>
      <Group>
        <Row title={<span dir="ltr">{a.username}</span>} hint={profile.title}>
          <span className={a.enabled ? 'pill ok' : 'pill bad'}>{a.enabled ? t('active') : t('inactive')}</span>
        </Row>
        <Row title={t('usage')} hint={<span dir="ltr">{bytes(used)} / {a.total > 0 ? bytes(a.total) : t('unlimited')}</span>}>
          {a.total > 0 && (
            <div className="meter small">
              <div style={{ width: `${Math.min(100, (used / a.total) * 100)}%` }} />
            </div>
          )}
        </Row>
        <Row title={t('expires')} hint={expiry} />
        <Row title={t('devices')} hint={<span dir="ltr">{a.deviceLimit > 0 ? `${a.devices} / ${a.deviceLimit}` : t('unlimited')}</span>} />
      </Group>
      <div className="button-row">
        <button type="button" className="btn btn-secondary" onClick={onRefresh}>
          {t('refresh')}
        </button>
        {profile.supportUrl && (
          <button type="button" className="btn btn-secondary" onClick={() => void window.dt.openExternal(profile.supportUrl ?? '')}>
            {t('support')}
          </button>
        )}
        <button type="button" className="btn btn-danger" onClick={onLogout}>
          {t('logout')}
        </button>
      </div>
    </>
  );
}

const protocols: [ProtocolChoice, string, string][] = [
  ['auto', '', 'protocolHint'],
  ['xray', 'Xray', 'protoXray'],
  ['wireguard', 'WireGuard', 'protoWireguard'],
  ['openvpn', 'OpenVPN', 'protoOpenvpn'],
  ['l2tp', 'L2TP/IPsec', 'protoL2tp'],
];

function Connection({ t, settings, onChange }: Props) {
  const [dns, setDns] = useState(settings.dns);
  useEffect(() => setDns(settings.dns), [settings.dns]);
  return (
    <>
      <h3 className="group-title">{t('protocol')}</h3>
      <Group>
        {protocols.map(([key, name, hint]) => (
          <Row key={key} title={key === 'auto' ? t('auto') : name} hint={t(hint)} onClick={() => onChange({ protocol: key })}>
            <span className={settings.protocol === key ? 'radio on' : 'radio'} role="radio" aria-checked={settings.protocol === key} />
          </Row>
        ))}
      </Group>
      <Group>
        <Row title={t('autoReconnect')} hint={t('autoReconnectHint')}>
          <Switch label={t('autoReconnect')} checked={settings.autoReconnect} onChange={(autoReconnect) => onChange({ autoReconnect })} />
        </Row>
        <Row title={t('adBlock')} hint={t('adBlockHint')}>
          <Switch label={t('adBlock')} checked={settings.adBlock} onChange={(adBlock) => onChange({ adBlock })} />
        </Row>
        <Row title={t('customDns')} hint={t('customDnsHint')}>
          <input className="text-input" dir="ltr" value={dns} placeholder="1.1.1.1, 8.8.8.8" onChange={(e) => setDns(e.target.value)} onBlur={() => onChange({ dns: dns.trim() })} />
        </Row>
      </Group>
    </>
  );
}

function KillSwitch({ t, settings, onChange }: Props) {
  return (
    <>
      <Group>
        <Row title={t('killSwitch')} hint={t('killSwitchHint')}>
          <Switch label={t('killSwitch')} checked={settings.killSwitch} onChange={(killSwitch) => onChange({ killSwitch })} />
        </Row>
      </Group>
      <p className="muted paragraph">{t('killSwitchLong')}</p>
    </>
  );
}

function AppIcon({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    void window.dt.appIcon(path).then(setSrc).catch(() => setSrc(null));
  }, [path]);
  return src ? <img className="app-icon" src={src} alt="" /> : <span className="app-icon placeholder" />;
}

function Split({ t, settings, onChange }: Props) {
  const add = async () => {
    const app = await window.dt.pickApp();
    if (app && !settings.splitApps.some((a) => a.name === app.name)) onChange({ splitApps: [...settings.splitApps, app], splitTunneling: true });
  };
  const remove = (app: SplitApp) => onChange({ splitApps: settings.splitApps.filter((a) => a.name !== app.name) });
  return (
    <>
      <Group>
        <Row title={t('iranDirect')} hint={t('iranDirectHint')}>
          <Switch label={t('iranDirect')} checked={settings.iranDirect} onChange={(iranDirect) => onChange({ iranDirect })} />
        </Row>
        <Row title={t('splitTunneling')} hint={t('splitHint')}>
          <Switch label={t('splitTunneling')} checked={settings.splitTunneling} onChange={(splitTunneling) => onChange({ splitTunneling })} />
        </Row>
      </Group>
      <div className="section-head">
        <h3 className="group-title">{t('apps')}</h3>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void add()}>
          <PlusIcon /> {t('addApp')}
        </button>
      </div>
      <Group>
        {settings.splitApps.length === 0 && <div className="empty small">{t('noApps')}</div>}
        {settings.splitApps.map((app) => (
          <Row key={app.name} title={<span className="app-row"><AppIcon path={app.path} /><span dir="ltr">{app.name}</span></span>} hint={<span dir="ltr">{app.path}</span>}>
            <button type="button" className="icon-btn" aria-label={t('remove')} onClick={() => remove(app)}>
              <TrashIcon />
            </button>
          </Row>
        ))}
      </Group>
    </>
  );
}

function Privacy({ t, settings, onChange }: Props) {
  return (
    <Group>
{window.dt.os !== 'macos' && (
              <Row title={t('webrtc')} hint={t('webrtcHint')}>
          <Switch label={t('webrtc')} checked={settings.webrtcProtection} onChange={(webrtcProtection) => onChange({ webrtcProtection })} />
        </Row>
      )}
      <Row title={t('timezone')} hint={t('timezoneHint')}>
        <Switch label={t('timezone')} checked={settings.timezoneSpoof} onChange={(timezoneSpoof) => onChange({ timezoneSpoof })} />
      </Row>
    </Group>
  );
}

function About({ t, profile }: Props) {
  return (
    <div className="about">
      <img src={logo} alt="" />
      <h2>{t('appName')}</h2>
      <p className="muted">{t('aboutText')}</p>
      <p className="muted">
        {t('version')} <span dir="ltr">{__APP_VERSION__}</span>
      </p>
      {profile.supportUrl && (
        <button type="button" className="btn btn-secondary" onClick={() => void window.dt.openExternal(profile.supportUrl ?? '')}>
          {t('support')}
        </button>
      )}
    </div>
  );
}
