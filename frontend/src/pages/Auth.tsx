import React, { useState } from 'react';
import { Droplets, KeyRound, Lock, Mail, MessageSquareWarning } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { Button, ErrorBox, Field } from '../components/ui';

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex min-h-full items-center justify-center bg-cc-bg p-4">
    <div className="w-full max-w-sm">
      <div className="mb-6 flex items-center justify-center gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cc-accent-strong/20 text-cc-accent"><Droplets className="h-5 w-5" /></span>
        <div><p className="text-lg font-semibold leading-tight">JalSetu</p><p className="text-2xs uppercase tracking-[0.14em] text-cc-muted">Water operations</p></div>
      </div>
      <div className="panel p-6">{children}</div>
    </div>
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
    try { await login(email.trim(), password); } catch (x) { setErr(x instanceof Error ? x.message : 'Sign-in failed'); }
    setBusy(false);
  };
  return (
    <Shell>
      <h1 className="mb-1 text-base font-semibold">Sign in</h1>
      <p className="mb-5 text-sm text-cc-muted">Control room staff and drivers use the same sign-in.</p>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email"><div className="relative"><Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cc-faint" />
          <input className="input pl-9" type="email" autoComplete="username" required autoFocus value={email} onChange={e => setEmail(e.target.value)} /></div></Field>
        <Field label="Password"><div className="relative"><Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cc-faint" />
          <input className="input pl-9" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></div></Field>
        {err && <ErrorBox message={err} />}
        <Button type="submit" variant="primary" className="w-full" size="lg" loading={busy}>Sign in</Button>
      </form>
      <a href="/report" className="mt-5 flex items-center justify-center gap-1.5 text-sm text-cc-accent hover:underline"><MessageSquareWarning className="h-4 w-4" /> Citizen? Report a water problem</a>
      <p className="mt-3 text-center text-2xs text-cc-faint">Accounts are issued by your administrator. Sessions are protected with short-lived tokens.</p>
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
      <h1 className="mb-1 flex items-center gap-2 text-base font-semibold"><KeyRound className="h-4 w-4 text-cc-accent" /> Set a new password</h1>
      <p className="mb-5 text-sm text-cc-muted">This account uses an initial password. Choose your own before continuing (≥ 10 characters with letters and digits).</p>
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
