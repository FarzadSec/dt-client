import { useEffect, useState, type FormEvent } from 'react';

import { parseSignIn, type SignInCode } from '../../shared/signin';
import type { AppProfile, Language, Settings } from '../../shared/types';
import { errorText, type Translate } from '../i18n';
import logo from '../logo.svg';

interface Props {
  t: Translate;
  settings: Settings;
  reason: string;
  // From a dtconnect:// link: with the username it signs in at once.
  code: SignInCode | null;
  onLanguage: (language: Language) => void;
  onSignedIn: (profile: AppProfile) => void;
}

export function Welcome({ t, settings, reason, code, onLanguage, onSignedIn }: Props) {
  const [form, setForm] = useState(reason !== '');
  const [subLink, setSubLink] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(reason ? errorText(t, reason) : '');

  async function signIn(link: string, name: string) {
    setBusy(true);
    setError('');
    try {
      onSignedIn(await window.dt.login(link, name));
    } catch (err) {
      setError(errorText(t, (err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void signIn(subLink, username);
  }

  // A pasted sign-in link fills both fields.
  function changeLink(value: string) {
    const parsed = value.trim().toLowerCase().startsWith('dtconnect:') ? parseSignIn(value) : null;
    setSubLink(parsed ? parsed.subLink : value);
    if (parsed?.username) setUsername(parsed.username);
  }

  useEffect(() => {
    if (!code) return;
    setForm(true);
    setSubLink(code.subLink);
    setUsername(code.username);
    if (code.username) void signIn(code.subLink, code.username);
    // signIn reads only its arguments and stable setters.
  }, [code]);

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
              <input className="text-input" dir="ltr" value={subLink} onChange={(e) => changeLink(e.target.value)} placeholder="https://…/sub/…" required autoFocus />
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
