import React, { useState } from 'react';
import { Droplets, ArrowRight, Lock, Mail, Loader2, MessageSquareWarning } from 'lucide-react';
import { useWaterData } from '../context/WaterDataContext';

export const Login: React.FC = () => {
  const { login } = useWaterData();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 bg-gradient-to-br from-slate-900 via-sky-950 to-slate-900 relative overflow-hidden">
      <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-sky-500/20 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-teal-500/15 blur-3xl pointer-events-none" />

      <div className="max-w-md w-full bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 p-8 z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-sky-500 to-sky-700 text-white shadow-card mb-3">
            <Droplets className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">
            JalSetu <span className="text-sky-600">AI</span>
          </h1>
          <p className="text-xs font-bold uppercase tracking-wider text-sky-700 mt-1">Fair Water. Stronger Communities.</p>
          <p className="text-xs text-slate-500 mt-1">Municipal water allocation & community support platform</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-xs font-semibold text-slate-700 mb-1">Official email</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
                required autoFocus />
            </div>
          </div>
          <div>
            <label htmlFor="password" className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
                required />
            </div>
          </div>

          {error && <p role="alert" className="text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}

          <button type="submit" disabled={busy}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-sm font-bold shadow-card transition-all">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            <span>{busy ? 'Signing in…' : 'Sign in'}</span>
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-slate-100 text-center">
          <a href="/report" className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-700 hover:text-sky-800">
            <MessageSquareWarning className="w-4 h-4" /> Citizen? Report a water problem without an account
          </a>
          <p className="text-[10px] text-slate-400 mt-3">Accounts are issued by your municipal administrator.</p>
        </div>
      </div>
    </div>
  );
};
