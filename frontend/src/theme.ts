/** Light / dark / follow-the-OS. The pre-paint script in index.html applies the saved choice before React loads. */
import { useEffect, useSyncExternalStore } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'auto';
const KEY = 'jalsetu_theme';
const listeners = new Set<() => void>();

function read(): ThemeChoice {
  try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'auto'; } catch { return 'auto'; }
}
const media = () => window.matchMedia('(prefers-color-scheme: dark)');
export function resolved(choice = read()): 'light' | 'dark' {
  return choice === 'auto' ? (media().matches ? 'dark' : 'light') : choice;
}
function apply() {
  document.documentElement.setAttribute('data-theme', resolved());
  listeners.forEach(l => l());
}
export function setTheme(t: ThemeChoice) {
  try { if (t === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch { /* storage unavailable */ }
  apply();
}

export function useTheme(): { choice: ThemeChoice; mode: 'light' | 'dark'; setTheme: (t: ThemeChoice) => void } {
  useEffect(() => {
    const m = media();
    const h = () => { if (read() === 'auto') apply(); };
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, []);
  const snap = useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => `${read()}|${resolved()}`);
  const [choice, mode] = snap.split('|') as [ThemeChoice, 'light' | 'dark'];
  return { choice, mode, setTheme };
}
