import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';

import type { AccountSummary, AppProfile, ProtocolChoice, Settings, SplitApp } from '../../shared/types';
import { siteName } from '../../shared/sites';
import { Row, Select, Switch } from '../components/Controls';
import { EyeOffIcon, InfoIcon, LifebuoyIcon, LockIcon, PlusIcon, SlidersIcon, SplitIcon, TrashIcon, UserIcon, WifiIcon } from '../components/Icons';
import { bytes, daysLeft } from '../format';
import { errorText, type Translate } from '../i18n';
import logo from '../logo.svg';
import { SignInForm } from './Welcome';

export type Section = 'general' | 'account' | 'connection' | 'killswitch' | 'split' | 'privacy' | 'lock' | 'support' | 'about';

interface Props {
  t: Translate;
  settings: Settings;
  profile: AppProfile;
  section: Section;
  onSection: (s: Section) => void;
  onChange: (patch: Partial<Settings>) => void;
  onRefresh: () => void;
  onLogout: () => void;
  // Another account added, switched to or removed: its profile, or null when none is left.
  onAccountChanged: (profile: AppProfile | null) => void;
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
    ['lock', () => <LockIcon />, t('lock')],
    ['support', LifebuoyIcon, t('supportSection')],
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
        {section === 'lock' && <Lock {...props} />}
        {section === 'support' && <Support {...props} />}
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

function Account(props: Props) {
  const { t, profile, onRefresh, onLogout } = props;
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
      <Accounts {...props} />
    </>
  );
}

// Every subscription signed in on this device: switch between them, add one with its link, remove one.
function Accounts({ t, profile, onAccountChanged }: Props) {
  const [list, setList] = useState<AccountSummary[]>([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const load = () => void window.dt.accounts().then(setList);
  useEffect(load, [profile]);

  const act = async (id: string, job: () => Promise<AppProfile | null>) => {
    setBusy(id);
    setError('');
    try {
      onAccountChanged(await job());
    } catch (err) {
      setError(errorText(t, (err as Error).message));
    } finally {
      setBusy('');
      load();
    }
  };
  const switchTo = (acc: AccountSummary) => {
    if (!window.confirm(t('switchConfirm'))) return;
    void act(acc.id, () => window.dt.switchAccount(acc.id));
  };
  const remove = (acc: AccountSummary) => {
    if (!window.confirm(t('removeAccountConfirm', { user: acc.username }))) return;
    void act(acc.id, () => window.dt.removeAccount(acc.id));
  };

  return (
    <>
      <div className="section-head">
        <h3 className="group-title">{t('accounts')}</h3>
        {!adding && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}>
            <PlusIcon /> {t('addAccount')}
          </button>
        )}
      </div>
      <Group>
        {list.map((acc) => (
          <Row
            key={acc.id}
            title={
              <span className="app-row">
                <span className="account-dot" data-on={acc.active} />
                <span dir="ltr">{acc.username}</span>
              </span>
            }
            hint={<span dir="ltr">{[acc.title, acc.host].filter(Boolean).join(' · ')}</span>}
          >
            {acc.active ? (
              <span className="pill ok">{t('inUse')}</span>
            ) : (
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== ''} onClick={() => switchTo(acc)}>
                {busy === acc.id ? '…' : acc.signedIn ? t('switchTo') : t('signInAgain')}
              </button>
            )}
            {!acc.active && (
              <button type="button" className="icon-btn" aria-label={t('remove')} disabled={busy !== ''} onClick={() => remove(acc)}>
                <TrashIcon />
              </button>
            )}
          </Row>
        ))}
        {adding && (
          <div className="add-account">
            <p className="muted">{t('addAccountHint')}</p>
            <SignInForm
              t={t}
              onSignedIn={(p) => {
                setAdding(false);
                onAccountChanged(p);
                load();
              }}
              onCancel={() => setAdding(false)}
              cancelLabel={t('cancel')}
            />
          </div>
        )}
        {error && <div className="banner error">{error}</div>}
      </Group>
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
      <Row title={t('leakProtection')} hint={t('leakProtectionHint')}>
        <Switch label={t('leakProtection')} checked={settings.leakProtection} onChange={(leakProtection) => onChange({ leakProtection })} />
      </Row>
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

// Apps and sites that must not be used without the VPN.
function Lock({ t, settings, onChange }: Props) {
  const [site, setSite] = useState('');
  const [bad, setBad] = useState(false);
  const addApp = async () => {
    const app = await window.dt.pickLockApp();
    if (app && !settings.lockApps.some((a) => a.name === app.name)) onChange({ lockApps: [...settings.lockApps, app], lockEnabled: true });
  };
  const addSite = () => {
    const name = siteName(site);
    if (!name) {
      setBad(true);
      return;
    }
    setBad(false);
    setSite('');
    if (!settings.lockSites.includes(name)) onChange({ lockSites: [...settings.lockSites, name], lockEnabled: true });
  };
  return (
    <>
      <Group>
        <Row title={t('lockEnabled')} hint={t('lockEnabledHint')}>
          <Switch label={t('lockEnabled')} checked={settings.lockEnabled} onChange={(lockEnabled) => onChange({ lockEnabled })} />
        </Row>
      </Group>
      <div className="section-head">
        <h3 className="group-title">{t('lockApps')}</h3>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void addApp()}>
          <PlusIcon /> {t('addApp')}
        </button>
      </div>
      <Group>
        {settings.lockApps.length === 0 && <div className="empty small">{t('noApps')}</div>}
        {settings.lockApps.map((app) => (
          <Row key={app.name} title={<span className="app-row"><AppIcon path={app.path} /><span dir="ltr">{app.name}</span></span>} hint={<span dir="ltr">{app.path}</span>}>
            <button type="button" className="icon-btn" aria-label={t('remove')} onClick={() => onChange({ lockApps: settings.lockApps.filter((a) => a.name !== app.name) })}>
              <TrashIcon />
            </button>
          </Row>
        ))}
      </Group>
      <h3 className="group-title">{t('lockSites')}</h3>
      <Group>
        <form
          className="input-row site-add"
          onSubmit={(e) => {
            e.preventDefault();
            addSite();
          }}
        >
          <input className="text-input" dir="ltr" value={site} placeholder={t('sitePlaceholder')} onChange={(e) => setSite(e.target.value)} />
          <button type="submit" className="btn btn-secondary">
            <PlusIcon /> {t('addSite')}
          </button>
        </form>
        {bad && <div className="banner error">{t('badSite')}</div>}
        {settings.lockSites.length === 0 && <div className="empty small">{t('noSites')}</div>}
        {settings.lockSites.map((name) => (
          <Row key={name} title={<span dir="ltr">{name}</span>}>
            <button type="button" className="icon-btn" aria-label={t('remove')} onClick={() => onChange({ lockSites: settings.lockSites.filter((s) => s !== name) })}>
              <TrashIcon />
            </button>
          </Row>
        ))}
      </Group>
      {window.dt.os === 'linux' && <p className="muted paragraph">{t('lockLinuxNote')}</p>}
    </>
  );
}

type Sending = { state: 'idle' } | { state: 'sending' } | { state: 'sent'; id: string | null } | { state: 'failed'; code: string };

// A report sends the log since the app started to the panel, which files it under this account.
function Support({ t, profile }: Props) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState<Sending>({ state: 'idle' });
  const [log, setLog] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const view = useRef<HTMLPreElement | null>(null);

  const loadLog = async () => setLog(await window.dt.logText());
  useEffect(() => {
    if (view.current) view.current.scrollTop = view.current.scrollHeight;
  }, [log]);

  const send = async () => {
    setSending({ state: 'sending' });
    try {
      setSending({ state: 'sent', ...(await window.dt.sendReport(message.trim())) });
      setMessage('');
    } catch (err) {
      setSending({ state: 'failed', code: err instanceof Error ? err.message : 'unexpected' });
    }
  };
  const copy = async () => {
    await navigator.clipboard.writeText(await window.dt.logText());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <h3 className="group-title">{t('reportProblem')}</h3>
      <Group>
        <p className="muted report-hint">{t('reportHint')}</p>
        <textarea className="text-input report-text" rows={4} maxLength={4000} value={message} placeholder={t('reportPlaceholder')} onChange={(e) => setMessage(e.target.value)} />
        <div className="button-row">
          <button type="button" className="btn btn-primary" disabled={sending.state === 'sending'} onClick={() => void send()}>
            {sending.state === 'sending' ? t('reportSending') : t('reportSend')}
          </button>
        </div>
        {sending.state === 'sent' && <div className="banner info report-result ok">{sending.id ? t('reportSentId', { id: sending.id }) : t('reportSent')}</div>}
        {sending.state === 'failed' && (
          <div className="banner error report-result">{sending.code === 'report_unsupported' ? t('reportUnsupported') : errorText(t, sending.code)}</div>
        )}
      </Group>
      <h3 className="group-title">{t('appLog')}</h3>
      <Group>
        <p className="muted report-hint">{t('appLogHint')}</p>
        <div className="button-row">
          <button type="button" className="btn btn-secondary" onClick={() => void loadLog()}>
            {log === null ? t('showLog') : t('refreshLog')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void copy()}>
            {copied ? t('copied') : t('copyLog')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void window.dt.saveLog()}>
            {t('saveLog')}
          </button>
          {profile.supportUrl && (
            <button type="button" className="btn btn-secondary" onClick={() => void window.dt.openExternal(profile.supportUrl ?? '')}>
              {t('support')}
            </button>
          )}
        </div>
        {log !== null && (
          <pre ref={view} className="log-view" dir="ltr">
            {log}
          </pre>
        )}
      </Group>
    </>
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
