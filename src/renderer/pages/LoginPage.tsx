import { useState, type FormEvent } from 'react';

import type { AppProfile, Language, Settings } from '../../shared/types';
import { errorText, type Translate } from '../i18n';
import logo from '../logo.svg';

interface Props {
  t: Translate;
  settings: Settings;
  reason: string;
  onLanguage: (language: Language) => void;
  onSignedIn: (profile: AppProfile) => void;
}

export function LoginPage({ t, settings, reason, onLanguage, onSignedIn }: Props) {
  const [subLink, setSubLink] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(reason ? errorText(t, reason) : '');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      onSignedIn(await window.dt.login(subLink, username));
    } catch (err) {
      setError(errorText(t, (err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <button type="button" className="lang-switch" onClick={() => onLanguage(settings.language === 'fa' ? 'en' : 'fa')}>
        {settings.language === 'fa' ? 'English' : 'فارسی'}
      </button>
      <img className="login-logo" src={logo} alt="" />
      <h1>{t('appName')}</h1>
      <p className="muted">{t('brand')}</p>
      <form onSubmit={submit} className="login-form">
        <label>
          <span>{t('subLink')}</span>
          <input dir="ltr" value={subLink} onChange={(e) => setSubLink(e.target.value)} placeholder="https://…/sub/…" required autoFocus />
          <small className="muted">{t('subLinkHint')}</small>
        </label>
        <label>
          <span>{t('username')}</span>
          <input dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="username" />
          <small className="muted">{t('usernameHint')}</small>
        </label>
        {error && <div className="alert error">{error}</div>}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? t('signingIn') : t('signIn')}
        </button>
      </form>
    </div>
  );
}
