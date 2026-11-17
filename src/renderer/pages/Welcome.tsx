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

export function Welcome({ t, settings, reason, onLanguage, onSignedIn }: Props) {
  const [form, setForm] = useState(reason !== '');
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
    <div className="welcome">
      <div className="welcome-drag" />
      <button type="button" className="lang-switch" onClick={() => onLanguage(settings.language === 'fa' ? 'en' : 'fa')}>
        {settings.language === 'fa' ? 'English' : 'فارسی'}
      </button>
      <div className="welcome-glow" aria-hidden />
      <div className="welcome-body">
        <img className="welcome-logo" src={logo} alt="" />
        <div className="welcome-brand">
          <strong>{t('appName')}</strong>
          <span>{t('brand')}</span>
        </div>
        {!form ? (
          <>
            <h1>{t('welcome')}</h1>
            <p className="muted">{t('welcomeHint')}</p>
            <button type="button" className="btn btn-primary btn-xl" onClick={() => setForm(true)}>
              {t('signIn')}
            </button>
          </>
        ) : (
          <form className="welcome-form" onSubmit={submit}>
            <label>
              <span>{t('subLink')}</span>
              <input className="text-input" dir="ltr" value={subLink} onChange={(e) => setSubLink(e.target.value)} placeholder="https://…/sub/…" required autoFocus />
              <small className="muted">{t('subLinkHint')}</small>
            </label>
            <label>
              <span>{t('username')}</span>
              <input className="text-input" dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="username" />
              <small className="muted">{t('usernameHint')}</small>
            </label>
            {error && <div className="banner error">{error}</div>}
            <button className="btn btn-primary btn-xl" type="submit" disabled={busy}>
              {busy ? t('signingIn') : t('signIn')}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setForm(false)}>
              {t('back')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
