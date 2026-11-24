import type { ReactNode } from 'react';

import type { LockHit } from '../../shared/types';
import type { PlanWarning } from '../../shared/warnings';
import { bytes } from '../format';
import type { Translate } from '../i18n';
import { AlertIcon, LockIcon } from './Icons';

export function Dialog({ icon, tone, title, children, actions, onClose }: { icon: ReactNode; tone: 'warn' | 'bad'; title: string; children: ReactNode; actions: ReactNode; onClose: () => void }) {
  return (
    <div className="dialog-veil" role="presentation" onClick={onClose}>
      <div className={`dialog ${tone}`} role="alertdialog" aria-modal aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="dialog-icon">{icon}</div>
        <h2>{title}</h2>
        <div className="dialog-body">{children}</div>
        <div className="dialog-actions">{actions}</div>
      </div>
    </div>
  );
}

// Time left as days, or hours under a day.
function timeLeft(t: Translate, ms: number): string {
  const hours = Math.max(1, Math.round(ms / 3_600_000));
  return hours >= 24 ? t('nDays', { n: Math.ceil(ms / 86_400_000) }) : t('nHours', { n: hours });
}

// Shown each time the app is opened while the plan is ending or has ended.
export function PlanWarningDialog({ t, warnings, supportUrl, onClose }: { t: Translate; warnings: PlanWarning[]; supportUrl?: string; onClose: () => void }) {
  const ended = warnings.some((w) => w.ended);
  return (
    <Dialog
      icon={<AlertIcon />}
      tone={ended ? 'bad' : 'warn'}
      title={ended ? t('warnEndedTitle') : t('warnTitle')}
      onClose={onClose}
      actions={
        <>
          {supportUrl && (
            <button type="button" className="btn btn-primary" onClick={() => void window.dt.openExternal(supportUrl)}>
              {t('renew')}
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('gotIt')}
          </button>
        </>
      }
    >
      {warnings.map((w) => (
        <p key={w.kind}>
          {w.kind === 'expiry'
            ? w.ended
              ? t('warnExpiryEnded')
              : t('warnExpiry', { n: '⁨' + timeLeft(t, w.left) + '⁩' })
            : w.ended
              ? t('warnTrafficEnded')
              : t('warnTraffic', { n: '⁨' + bytes(w.left) + '⁩' })}
        </p>
      ))}
      <p className="muted">{t('warnHint')}</p>
    </Dialog>
  );
}

// A locked app or site opened while the VPN is off.
export function LockDialog({ t, hit, busy, onConnect, onSkip, onClose }: { t: Translate; hit: LockHit; busy: boolean; onConnect: () => void; onSkip: () => void; onClose: () => void }) {
  return (
    <Dialog
      icon={<LockIcon />}
      tone="bad"
      title={t('lockHitTitle')}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onConnect}>
            {busy ? t('connecting') : t('connectNow')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onSkip}>
            {t('skip15')}
          </button>
        </>
      }
    >
      <p>{t(hit.kind === 'app' ? 'lockHitApp' : 'lockHitSite', { name: '⁨' + hit.name + '⁩' })}</p>
      <p className="muted">{t('lockHitHint')}</p>
    </Dialog>
  );
}
