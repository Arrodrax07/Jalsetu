/**
 * Browser speech: dictation (Web Speech API SpeechRecognition) and read-aloud (speechSynthesis).
 * Chrome/Edge/Samsung Internet run recognition on the vendor's servers, so it needs a connection; the hook
 * reports that instead of failing silently. Nothing is recorded or stored by JalSetu.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type SpeechState = 'idle' | 'listening' | 'processing' | 'done' | 'no_speech' | 'denied' | 'unsupported' | 'offline' | 'error';

/* eslint-disable @typescript-eslint/no-explicit-any */
const Recognition: any = typeof window !== 'undefined' ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null;
export const speechSupported = !!Recognition;

export function useDictation(locale: string, onFinal: (text: string) => void) {
  const [state, setState] = useState<SpeechState>(speechSupported ? 'idle' : 'unsupported');
  const [interim, setInterim] = useState('');
  const [level, setLevel] = useState(0); // 0..1 rough "speech heard" pulse for the UI
  const rec = useRef<any>(null);
  const gotFinal = useRef(false);
  const cb = useRef(onFinal);
  cb.current = onFinal;

  const stop = useCallback(() => { try { rec.current?.stop(); } catch { /* not running */ } }, []);

  const start = useCallback(() => {
    if (!Recognition) { setState('unsupported'); return; }
    if (!navigator.onLine) { setState('offline'); return; }
    try { rec.current?.abort(); } catch { /* ignore */ }
    const r = new Recognition();
    r.lang = locale;
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    gotFinal.current = false;
    r.onstart = () => { setState('listening'); setInterim(''); };
    r.onspeechstart = () => setLevel(1);
    r.onspeechend = () => { setLevel(0); setState(s => (s === 'listening' ? 'processing' : s)); };
    r.onresult = (e: any) => {
      let fin = '', mid = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const txt = e.results[i][0].transcript;
        if (e.results[i].isFinal) fin += txt; else mid += txt;
      }
      setInterim(mid);
      setLevel(l => (mid ? Math.min(1, 0.4 + Math.random() * 0.6) : l));
      if (fin.trim()) { gotFinal.current = true; cb.current(fin.trim()); }
    };
    r.onerror = (e: any) => {
      const code = e.error as string;
      setState(code === 'not-allowed' || code === 'service-not-allowed' ? 'denied' : code === 'no-speech' ? 'no_speech'
        : code === 'network' ? 'offline' : code === 'aborted' ? 'idle' : 'error');
    };
    r.onend = () => {
      setLevel(0);
      setInterim('');
      setState(s => (s === 'listening' || s === 'processing' ? (gotFinal.current ? 'done' : 'no_speech') : s));
    };
    rec.current = r;
    try { r.start(); } catch { setState('error'); }
  }, [locale]);

  useEffect(() => () => { try { rec.current?.abort(); } catch { /* ignore */ } }, []);
  // "done" and error hints fade back to idle after a moment.
  useEffect(() => {
    if (!['done', 'no_speech', 'error', 'offline'].includes(state)) return;
    const id = setTimeout(() => setState(speechSupported ? 'idle' : 'unsupported'), state === 'done' ? 2500 : 5000);
    return () => clearTimeout(id);
  }, [state]);

  return { state, interim, level, start, stop, listening: state === 'listening' || state === 'processing' };
}

export const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

/** Speaks text in the given locale if the device has a matching voice (falls back to the closest language). */
export function speak(text: string, locale: string): boolean {
  if (!ttsSupported || !text) return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = locale;
  const voices = synth.getVoices();
  const base = locale.split('-')[0];
  u.voice = voices.find(v => v.lang === locale) || voices.find(v => v.lang.startsWith(base)) || null;
  u.rate = 0.95;
  synth.speak(u);
  return true;
}

/** Driver voice commands in three languages -> action. */
const COMMANDS: { action: 'accept' | 'start' | 'confirm' | 'end'; words: string[] }[] = [
  { action: 'accept', words: ['accept', 'स्वीकार', 'स्वीकारा', 'स्वीकारें', 'मंजूर', 'ओके'] },
  { action: 'start', words: ['start', 'begin', 'सुरू', 'शुरू', 'चालू', 'स्टार्ट'] },
  { action: 'confirm', words: ['confirm', 'arrived', 'reached', 'पोहोचलो', 'पोहोचले', 'पहुँच', 'पहुंच', 'खात्री', 'पुष्टि'] },
  { action: 'end', words: ['end', 'finish', 'stop trip', 'संपवा', 'संपला', 'खत्म', 'समाप्त', 'बंद'] },
];
export function parseDriverCommand(text: string): 'accept' | 'start' | 'confirm' | 'end' | null {
  const t = text.toLowerCase();
  for (const c of COMMANDS) if (c.words.some(w => t.includes(w))) return c.action;
  return null;
}
