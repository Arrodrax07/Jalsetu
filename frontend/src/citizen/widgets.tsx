/** Citizen-facing widgets: language switch, voice button, offline status, outbox, install prompt. */
import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, CheckCircle2, CloudOff, Download, Loader2, Mic, MicOff, RefreshCw, Square, Trash2, Volume2 } from '../components/icons';
import { cx, EASE, SPRING } from '../components/ui';
import { LANGS, speechLocale, useLang } from '../i18n';
import { speak, ttsSupported, useDictation, type SpeechState } from '../i18n/speech';
import { flush, remove, type OutboxItem } from './outbox';

export const LangSwitch: React.FC<{ className?: string; tone?: 'light' | 'dark' }> = ({ className, tone = 'light' }) => {
  const { lang, setLang, t } = useLang();
  return (
    <div role="radiogroup" aria-label={t('lang.label')} className={cx('inline-flex rounded-full p-0.5', tone === 'dark' ? 'bg-white/10' : 'bg-cc-hover', className)}>
      {LANGS.map(l => (
        <button key={l.id} type="button" role="radio" aria-checked={lang === l.id} lang={l.id} onClick={() => setLang(l.id)}
          className={cx('relative min-h-[36px] rounded-full px-3 text-[13px] font-medium transition-colors',
            lang === l.id ? (tone === 'dark' ? 'text-cc-text' : 'text-cc-text') : (tone === 'dark' ? 'text-white/70 hover:text-white' : 'text-cc-muted hover:text-cc-text'))}>
          {lang === l.id && <motion.span layoutId="lang-thumb" className="absolute inset-0 rounded-full bg-cc-surface shadow-[0_1px_3px_rgb(19_31_42/0.18)]" transition={SPRING} />}
          <span className="relative">{l.label}</span>
        </button>
      ))}
    </div>
  );
};

const VOICE_MSG: Partial<Record<SpeechState, string>> = {
  listening: 'voice.listening', processing: 'voice.processing', done: 'voice.done', no_speech: 'voice.noSpeech',
  denied: 'voice.denied', unsupported: 'voice.unsupported', offline: 'voice.offline', error: 'voice.error',
};

/** Microphone that dictates into a field in the chosen language. States are announced for screen readers. */
export const VoiceButton: React.FC<{ onText: (t: string) => void; compact?: boolean; label?: string }> = ({ onText, compact, label }) => {
  const { lang, t } = useLang();
  const d = useDictation(speechLocale(lang), onText);
  const msg = VOICE_MSG[d.state];
  const bad = ['denied', 'unsupported', 'offline', 'error', 'no_speech'].includes(d.state);
  return (
    <div className={cx('flex items-center gap-2', compact ? '' : 'min-h-[44px]')}>
      <motion.button type="button" onClick={d.listening ? d.stop : d.start} disabled={d.state === 'unsupported'}
        aria-label={d.listening ? t('voice.stop') : (label || t('voice.speak'))} aria-pressed={d.listening}
        whileTap={{ scale: 0.92 }} transition={SPRING}
        className={cx('relative flex flex-shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40',
          compact ? 'h-9 w-9' : 'h-11 w-11',
          d.listening ? 'bg-cc-danger text-white' : 'bg-cc-ink text-cc-on-ink hover:bg-cc-ink/90')}>
        {d.listening && (
          <motion.span aria-hidden className="absolute inset-0 rounded-full bg-cc-danger"
            animate={{ scale: [1, 1.35 + d.level * 0.3], opacity: [0.45, 0] }} transition={{ duration: 1.1, repeat: Infinity, ease: 'easeOut' }} />
        )}
        <span className="relative">
          {d.state === 'processing' ? <Loader2 className="h-4 w-4 animate-spin" /> : d.listening ? <Square className="h-3.5 w-3.5 fill-current" />
            : d.state === 'denied' || d.state === 'unsupported' ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </span>
      </motion.button>
      {!compact && (
        <div className="min-w-0 flex-1" aria-live="polite">
          <AnimatePresence mode="wait">
            {msg ? (
              <motion.p key={d.state} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
                className={cx('text-[13px] leading-snug', bad ? 'text-amber-800' : d.state === 'done' ? 'text-green-800' : 'text-cc-text')}>
                {t(msg)}{d.interim && <span className="block truncate italic text-cc-muted">“{d.interim}”</span>}
              </motion.p>
            ) : (
              <motion.p key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[13px] text-cc-muted">
                {label || t('voice.speak')} · {LANGS.find(l => l.id === lang)?.label}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};

export const ReadAloud: React.FC<{ text: string }> = ({ text }) => {
  const { lang, t } = useLang();
  if (!ttsSupported) return null;
  return (
    <button type="button" onClick={() => speak(text, speechLocale(lang))} className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3 text-xs font-medium text-cc-accent-strong ring-1 ring-cc-accent/25 hover:bg-cc-accent/[0.06]">
      <Volume2 className="h-3.5 w-3.5" aria-hidden />{t('voice.readAloud')}
    </button>
  );
};

export const OfflineBanner: React.FC<{ online: boolean }> = ({ online }) => {
  const { t } = useLang();
  return (
    <AnimatePresence initial={false}>
      {!online && (
        <motion.div role="status" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }}
          className="overflow-hidden">
          <div className="flex items-start gap-3 rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-amber-900">
            <CloudOff className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden />
            <div><p className="text-sm font-semibold">{t('net.offline')}</p><p className="text-[13px] leading-snug">{t('net.offlineBody')}</p></div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const ago = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  return s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} d`;
};

export const OutboxPanel: React.FC<{ items: OutboxItem[]; online: boolean }> = ({ items, online }) => {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  if (!items.length) return null;
  return (
    <motion.section layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="panel overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b border-cc-border px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-semibold"><CloudOff className="h-4 w-4 text-cc-muted" aria-hidden />{t('outbox.title')}
          <span className="num rounded-full bg-cc-ink px-2 text-[11px] text-cc-on-ink">{items.length}</span></p>
        <button type="button" disabled={!online || busy} onClick={async () => { setBusy(true); await flush(true); setBusy(false); }}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3 text-xs font-medium text-cc-accent-strong ring-1 ring-cc-accent/25 disabled:opacity-40">
          <RefreshCw className={cx('h-3.5 w-3.5', busy && 'animate-spin')} aria-hidden />{t('outbox.retry')}
        </button>
      </header>
      <ul className="divide-y divide-cc-border">
        <AnimatePresence initial={false}>
          {items.map(it => (
            <motion.li key={it.clientRef} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, x: 40, transition: { duration: 0.25 } }} className="flex items-start gap-3 px-4 py-3">
              <span className={cx('mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full',
                it.status === 'sending' ? 'bg-cc-accent/10 text-cc-accent' : it.status === 'failed' ? 'bg-amber-100 text-amber-800' : 'bg-cc-hover text-cc-muted')}>
                {it.status === 'sending' ? <Loader2 className="h-4 w-4 animate-spin" /> : it.status === 'failed' ? <AlertCircle className="h-4 w-4" /> : <CloudOff className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{it.placeName}</p>
                <p className="line-clamp-2 text-[13px] text-cc-muted">{it.payload.description}</p>
                <p className="mt-0.5 text-[11.5px] text-cc-faint">
                  {t('outbox.savedAt')} {ago(it.queuedAt)} · {it.status === 'sending' ? t('outbox.sending') : it.status === 'failed'
                    ? `${t('outbox.failed')}${it.permanent ? `: ${it.lastError}` : ` · ${t('outbox.autoRetry')}`}` : t('outbox.autoRetry')}
                </p>
              </div>
              {it.status !== 'sending' && (
                <button type="button" onClick={() => remove(it.clientRef)} aria-label={t('outbox.remove')}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-cc-faint hover:bg-cc-hover hover:text-cc-text"><Trash2 className="h-4 w-4" /></button>
              )}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </motion.section>
  );
};

export const SentToast: React.FC<{ count: number }> = ({ count }) => {
  const { t } = useLang();
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div role="status" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
          className="fixed inset-x-4 bottom-5 z-50 mx-auto flex max-w-sm items-center gap-3 rounded-2xl bg-cc-ink px-4 py-3 text-sm text-cc-on-ink shadow-pop">
          <CheckCircle2 className="h-5 w-5 text-emerald-300" aria-hidden />{t('outbox.allSent')}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/* eslint-disable @typescript-eslint/no-explicit-any */
let deferred: any = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: Event) => { e.preventDefault(); deferred = e; window.dispatchEvent(new Event('jalsetu-installable')); });
}
export const InstallButton: React.FC = () => {
  const { t } = useLang();
  const [can, setCan] = useState(!!deferred);
  useEffect(() => {
    const h = () => setCan(true);
    const done = () => setCan(false);
    window.addEventListener('jalsetu-installable', h);
    window.addEventListener('appinstalled', done);
    return () => { window.removeEventListener('jalsetu-installable', h); window.removeEventListener('appinstalled', done); };
  }, []);
  if (!can) return null;
  return (
    <button type="button" onClick={async () => { deferred?.prompt(); await deferred?.userChoice; deferred = null; setCan(false); }}
      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full bg-cc-accent px-3 text-xs font-medium text-white" title={t('install.hint')}>
      <Download className="h-3.5 w-3.5" aria-hidden />{t('install.cta')}
    </button>
  );
};
