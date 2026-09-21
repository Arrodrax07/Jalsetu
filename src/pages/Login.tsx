import React, { useState } from 'react';
import { Droplets, Shield, UserCheck, Sparkles, ArrowRight, Lock, Mail } from 'lucide-react';
import { useWaterData } from '../context/WaterDataContext';

export const Login: React.FC = () => {
  const { login } = useWaterData();
  const [email, setEmail] = useState('commissioner@jalsetu.gov.in');
  const [password, setPassword] = useState('••••••••••••');

  const handleCustomLogin = (e: React.FormEvent) => {
    e.preventDefault();
    login('admin');
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 bg-gradient-to-br from-slate-900 via-sky-950 to-slate-900 relative overflow-hidden">
      {/* Background ambient lighting effects */}
      <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-sky-500/20 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-teal-500/15 blur-3xl pointer-events-none" />

      <div className="max-w-md w-full bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 p-8 z-10">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-sky-500 to-sky-700 text-white shadow-card mb-3">
            <Droplets className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">
            JalSetu <span className="text-sky-600">AI</span>
          </h1>
          <p className="text-xs font-bold uppercase tracking-wider text-sky-700 mt-1">
            Fair Water. Stronger Communities.
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Intelligent Water Allocation & Community Support Platform
          </p>
        </div>

        {/* Traditional Simulated Form */}
        <form onSubmit={handleCustomLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Official Municipal Email</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 font-medium"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Security Credential</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 font-medium"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-card transition-all"
          >
            <span>Enter Demo Dashboard</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        {/* Hackathon Quick Access Divider */}
        <div className="relative my-6 text-center">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-200" />
          </div>
          <span className="relative bg-white px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            One-Click Demo Roles
          </span>
        </div>

        {/* Quick-Access Buttons */}
        <div className="space-y-2">
          <button
            onClick={() => login('admin')}
            className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl border border-sky-100 bg-sky-50/70 hover:bg-sky-100 text-sky-900 text-xs font-semibold transition-all group"
          >
            <div className="flex items-center gap-2.5">
              <Shield className="w-4 h-4 text-sky-600" />
              <div className="text-left">
                <p className="font-bold text-slate-900 leading-tight">Continue as Administrator</p>
                <p className="text-[10px] text-slate-500">Municipal Commissioner (Full Command Access)</p>
              </div>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-sky-600 group-hover:translate-x-0.5 transition-transform" />
          </button>

          <button
            onClick={() => login('officer')}
            className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl border border-emerald-100 bg-emerald-50/70 hover:bg-emerald-100 text-emerald-900 text-xs font-semibold transition-all group"
          >
            <div className="flex items-center gap-2.5">
              <UserCheck className="w-4 h-4 text-emerald-600" />
              <div className="text-left">
                <p className="font-bold text-slate-900 leading-tight">Continue as Field Officer</p>
                <p className="text-[10px] text-slate-500">Ward M/East Supervisor (Requests & POD Verification)</p>
              </div>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-emerald-600 group-hover:translate-x-0.5 transition-transform" />
          </button>

          <button
            onClick={() => login('demo')}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-all shadow-md"
          >
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>Launch Hackathon Pitch Evaluator</span>
          </button>
        </div>

        <p className="text-center text-[10px] text-slate-400 mt-6">
          Zero external paid APIs required • Self-contained local prototype
        </p>
      </div>
    </div>
  );
};
