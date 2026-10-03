import React, { useState } from 'react';
import { ArrowRight, KeyRound, Lock, Mail, MessageSquareWarning, Newspaper, Satellite, Scale } from 'lucide-react';
import { motion } from 'motion/react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { Button, EASE, ErrorBox, Field, Item, Stagger } from '../components/ui';
import { Mark } from '../components/shell/Shell';
import { MaharashtraArt } from '../components/Intro';

const FACTS = [
  { icon: Satellite, title: 'Live GPS, not estimates', body: 'Every tanker reports from the driver’s phone; arrival is detected by geofence.' },
  { icon: Newspaper, title: 'Crisis signals', body: 'Monsoon deficit and Marathi + English news, matched to towns and villages.' },
  { icon: Scale, title: 'Fair by design', body: 'A survival floor for everyone, then water in proportion to verified need.' },
];

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="grid min-h-full lg:grid-cols-[1.15fr_1fr]">
    <aside className="contours relative hidden overflow-hidden border-r border-cc-border bg-cc-raised lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }} className="flex items-center gap-2.5">
        <Mark className="h-9 w-9 text-cc-accent" />
        <span className="leading-none"><span className="display block text-[28px]">JalSetu</span>
          <span className="mt-1 block text-[10px] font-medium uppercase tracking-[0.2em] text-cc-faint">Water operations · Maharashtra</span></span>
      </motion.div>
      <div className="relative">
        <motion.h1 initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.8, ease: EASE }}
          className="display max-w-xl text-[64px] leading-[0.98] text-cc-text xl:text-[76px]">
          Every litre,<br /><em className="text-cc-accent">accounted for.</em>
        </motion.h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45, duration: 0.6 }} className="mt-5 max-w-md text-[15px] leading-relaxed text-cc-muted">
          The control room for tanker water supply across 1,263 towns and villages: who needs water, which truck goes, and proof that it arrived.
        </motion.p>
        <div className="pointer-events-none absolute -right-10 top-1/2 w-[52%] -translate-y-1/2 opacity-90 xl:-right-4">
          <MaharashtraArt delay={0.3} labels={false} />
        </div>
      </div>
      <Stagger className="grid max-w-2xl grid-cols-3 gap-6" delay={0.6} step={0.08}>
        {FACTS.map(f => (
          <Item key={f.title}>
            <f.icon className="mb-2 h-5 w-5 text-cc-accent" />
            <p className="text-sm font-medium">{f.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-cc-muted">{f.body}</p>
          </Item>
        ))}
      </Stagger>
    </aside>
    <main className="flex items-center justify-center p-6 sm:p-10">
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.6, ease: EASE }} className="w-full max-w-[380px]">
        <div className="mb-8 flex items-center gap-2 lg:hidden"><Mark className="h-8 w-8 text-cc-accent" /><span className="display text-3xl">JalSetu</span></div>
        {children}
      </motion.div>
    </main>
  </div>
);

export const Login: React.FC = () => {
  const { login } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await login(email.trim(), password);
      if (window.location.pathname.startsWith('/login')) window.history.replaceState(null, '', '/#overview');
    } catch (x) { setErr(x instanceof Error ? x.message : 'Sign-in failed'); }
    setBusy(false);
  };
  return (
    <Shell>
      <p className="eyebrow mb-2">Control room &amp; drivers</p>
      <h2 className="display text-[44px] leading-none">Sign in</h2>
      <p className="mb-8 mt-3 text-sm text-cc-muted">Use the account issued by your administrator. Drivers land straight in their trip view.</p>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email"><div className="relative"><Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cc-faint" />
          <input className="input pl-9" type="email" autoComplete="username" required autoFocus value={email} onChange={e => setEmail(e.target.value)} /></div></Field>
        <Field label="Password"><div className="relative"><Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cc-faint" />
          <input className="input pl-9" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></div></Field>
        {err && <ErrorBox message={err} />}
        <Button type="submit" variant="primary" className="group w-full" size="lg" loading={busy}>
          Sign in {!busy && <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />}
        </Button>
      </form>
      <div className="my-7 flex items-center gap-3 text-[11px] uppercase tracking-[0.14em] text-cc-faint"><span className="h-px flex-1 bg-cc-border" />or<span className="h-px flex-1 bg-cc-border" /></div>
      <a href="/report" className="group flex items-center gap-3 rounded-2xl border border-cc-border bg-cc-surface p-4 transition hover:border-cc-strong hover:shadow-lift">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cc-accent/10 text-cc-accent"><MessageSquareWarning className="h-4 w-4" /></span>
        <span className="flex-1"><span className="block text-sm font-medium">Report a water problem</span><span className="block text-xs text-cc-muted">For residents. No account needed.</span></span>
        <ArrowRight className="h-4 w-4 text-cc-faint transition-transform group-hover:translate-x-0.5" />
      </a>
      <p className="mt-6 text-[11px] leading-relaxed text-cc-faint">Sessions use short-lived tokens and are audit-logged. Shared devices: sign out when done.</p>
    </Shell>
  );
};

export const ChangePassword: React.FC = () => {
  const { setUser, logout } = useApp();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== again) { setErr('New passwords do not match'); return; }
    setBusy(true); setErr(null);
    try { const s = await api.changePassword(cur, next); setUser(s.user); } catch (x) { setErr(x instanceof Error ? x.message : 'Could not change password'); }
    setBusy(false);
  };
  return (
    <Shell>
      <p className="eyebrow mb-2 flex items-center gap-1.5"><KeyRound className="h-3.5 w-3.5" /> First sign-in</p>
      <h2 className="display text-[40px] leading-none">Choose your password</h2>
      <p className="mb-7 mt-3 text-sm text-cc-muted">This account uses an initial password. Choose your own before continuing (≥ 10 characters with letters and digits).</p>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Current password"><input className="input" type="password" autoComplete="current-password" required value={cur} onChange={e => setCur(e.target.value)} /></Field>
        <Field label="New password"><input className="input" type="password" autoComplete="new-password" required minLength={10} value={next} onChange={e => setNext(e.target.value)} /></Field>
        <Field label="Repeat new password"><input className="input" type="password" autoComplete="new-password" required minLength={10} value={again} onChange={e => setAgain(e.target.value)} /></Field>
        {err && <ErrorBox message={err} />}
        <Button type="submit" variant="primary" className="w-full" loading={busy}>Save and continue</Button>
        <Button type="button" variant="ghost" className="w-full" onClick={logout}>Sign out</Button>
      </form>
    </Shell>
  );
};
