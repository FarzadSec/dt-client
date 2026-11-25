import { useEffect, useState, type FormEvent } from 'react';

import { parseSignIn, type SignInCode } from '../../shared/signin';
import type { AppProfile, Language, Settings } from '../../shared/types';
import { errorText, type Translate } from '../i18n';
import logo from '../logo.svg';

interface Props {
  t: Translate;
  settings: Settings;
  reason: string;
  // From a dtconnect:// link: it signs in at once.
  code: SignInCode | null;
  onLanguage: (language: Language) => void;
  onSignedIn: (profile: AppProfile) => void;
}

// The subscription link is all it takes: the app reads the account from it.
export function SignInForm({ t, code, initialError, onSignedIn, onCancel, cancelLabel }: { t: Translate; code?: SignInCode | null; initialError?: string; onSignedIn: (p: AppProfile) => void; onCancel?: () => void; cancelLabel?: string }) {
  const [subLink, setSubLink] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError ?? '');

  async function signIn(link: string, name: string) {
    setBusy(true);
    setError('');
    try {
      onSignedIn(await window.dt.login(link, name || undefined));
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

  // A pasted dtconnect:// link carries the subscription link (and maybe the username).
  function changeLink(value: string) {
    const parsed = value.trim().toLowerCase().startsWith('dtconnect:') ? parseSignIn(value) : null;
    setSubLink(parsed ? parsed.subLink : value);
    setUsername(parsed?.username ?? '');
  }

  async function paste() {
    try {
      changeLink(await navigator.clipboard.readText());
    } catch {
      // The field still takes Ctrl+V.
    }
  }

  useEffect(() => {
    if (!code) return;
    setSubLink(code.subLink);
    setUsername(code.username);
    void signIn(code.subLink, code.username);
    // signIn reads only its arguments and stable setters.
  }, [code]);

  return (
    <form className="welcome-form" onSubmit={submit}>
      <label>
        <span>{t('subLink')}</span>
        <div className="input-row">
          <input className="text-input" dir="ltr" value={subLink} onChange={(e) => changeLink(e.target.value)} placeholder="https://…/sub/…" required autoFocus />
          <button type="button" className="btn btn-secondary" onClick={() => void paste()}>
            {t('paste')}
          </button>
        </div>
        <small className="muted">{t('subLinkHint')}</small>
      </label>
      {error && <div className="banner error">{error}</div>}
      <button className="btn btn-primary btn-xl" type="submit" disabled={busy}>
        {busy ? t('signingIn') : t('signIn')}
      </button>
      {onCancel && (
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          {cancelLabel ?? t('back')}
        </button>
      )}
    </form>
  );
}

export function Welcome({ t, settings, reason, code, onLanguage, onSignedIn }: Props) {
  const [form, setForm] = useState(reason !== '' || code !== null);
  useEffect(() => {
    if (code) setForm(true);
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
          <SignInForm t={t} code={code} initialError={reason ? errorText(t, reason) : ''} onSignedIn={onSignedIn} onCancel={() => setForm(false)} />
        )}
      </div>
    </div>
  );
}
