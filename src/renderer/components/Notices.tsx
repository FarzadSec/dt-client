import { useEffect, useRef } from 'react';

import type { NoticeEntry } from '../../shared/notices';
import type { Language } from '../../shared/types';
import type { Translate } from '../i18n';
import { AlertIcon, CloseIcon, InfoIcon } from './Icons';

// Notices are written in Persian, so they are laid out right to left in Vazirmatn in either language.
function NoticeText({ body }: { body: string }) {
  return (
    <p className="notice-text" dir="rtl" lang="fa">
      {body}
    </p>
  );
}

function noticeTime(createdAt: number | null, lang: Language): string {
  if (!createdAt) return '';
  return new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(createdAt));
}

export function NoticeBanners({ t, notices, onClose }: { t: Translate; notices: NoticeEntry[]; onClose: (key: string) => void }) {
  if (notices.length === 0) return null;
  return (
    <div className="notice-banners">
      {notices.map((n) => (
        <div key={n.key} className={`notice-banner ${n.level}`} dir="rtl" lang="fa" role="alert">
          <button type="button" className="notice-close" aria-label={t('closeNotice')} title={t('closeNotice')} onClick={() => onClose(n.key)}>
            <CloseIcon />
          </button>
          <span className="notice-icon">
            <AlertIcon />
          </span>
          <NoticeText body={n.body} />
        </div>
      ))}
    </div>
  );
}

export function NoticeCenter({ t, lang, notices, onClose }: { t: Translate; lang: Language; notices: NoticeEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('.bell-btn')) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  return (
    <div className="notice-center" ref={ref}>
      <div className="notice-center-head">
        <strong>{t('notices')}</strong>
        <span className="muted">{notices.length > 0 ? notices.length : ''}</span>
      </div>
      {notices.length === 0 ? (
        <div className="empty small">{t('noNotices')}</div>
      ) : (
        <ul className="notice-list">
          {notices.map((n) => (
            <li key={n.key} className={`notice-item ${n.level}`}>
              <div className="notice-meta">
                <span className={`notice-level ${n.level}`}>
                  {n.level === 'info' ? <InfoIcon /> : <AlertIcon />}
                  {n.key === 'announce' ? t('subscriptionNotice') : t(`level.${n.level}`)}
                </span>
                <span className="muted">{noticeTime(n.createdAt, lang)}</span>
              </div>
              <NoticeText body={n.body} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Toast({ text, kind }: { text: string; kind: 'ok' | 'bad' }) {
  return (
    <div className={`toast ${kind}`} role="status">
      {text}
    </div>
  );
}
