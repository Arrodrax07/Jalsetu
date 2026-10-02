import React, { useEffect, useState } from 'react';
import { Droplets, Send, CheckCircle2, Loader2 } from 'lucide-react';
import { api } from '../services/api';

export const CitizenPortal: React.FC = () => {
  const [communities, setCommunities] = useState<{ id: string; name: string; ward: string }[]>([]);
  const [communityId, setCommunityId] = useState('');
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<{ id: string; category: string; severity: string; message: string } | null>(null);

  useEffect(() => {
    api.publicCommunities().then(c => { setCommunities(c); setCommunityId(c[0]?.id || ''); }).catch(e => setError(e.message));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try { setTicket(await api.publicComplaint({ communityId, description: text, reporterName: name, reporterPhone: phone })); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    setBusy(false);
  };

  const input = 'w-full px-3 py-3 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500/30';

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 to-white">
      <header className="bg-sky-700 text-white px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-2"><Droplets className="w-6 h-6" /><div><p className="font-black">JalSetu · जलसेतु</p><p className="text-xs text-sky-100">Report a water supply problem / पानी की शिकायत दर्ज करें / पाण्याची तक्रार नोंदवा</p></div></div>
      </header>
      <main className="max-w-lg mx-auto p-4">
        {ticket ? (
          <div className="p-6 rounded-2xl bg-white border border-emerald-200 shadow-subtle text-center space-y-3">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
            <p className="text-lg font-black text-slate-900">Ticket {ticket.id}</p>
            <p className="text-sm text-slate-600">{ticket.message}</p>
            <p className="text-xs text-slate-500">Classified as <strong>{ticket.category}</strong> · priority <strong>{ticket.severity}</strong></p>
            <button onClick={() => { setTicket(null); setText(''); }} className="text-sm font-semibold text-sky-700">Report another problem</button>
          </div>
        ) : (
          <form onSubmit={submit} className="p-5 rounded-2xl bg-white border border-slate-200 shadow-subtle space-y-4">
            <label className="block text-sm font-semibold text-slate-800">Your area
              <select value={communityId} onChange={e => setCommunityId(e.target.value)} required className={`${input} mt-1`}>
                {communities.map(c => <option key={c.id} value={c.id}>{c.name} ({c.ward})</option>)}
              </select>
            </label>
            <label className="block text-sm font-semibold text-slate-800">What is the problem? (any language)
              <textarea rows={5} value={text} onChange={e => setText(e.target.value)} required minLength={5} maxLength={3000} className={`${input} mt-1`}
                placeholder="e.g. No water for 3 days in lane 4 / 3 दिन से पानी नहीं आया / टँकर आला नाही" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Name (optional)" className={input} maxLength={120} />
              <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone (optional)" className={input} maxLength={32} />
            </div>
            {error && <p role="alert" className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">{error}</p>}
            <button type="submit" disabled={busy || !communityId} className="w-full py-3.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-bold flex items-center justify-center gap-2">
              {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />} Submit complaint
            </button>
            <p className="text-[11px] text-slate-500 text-center">Your complaint goes directly to the ward water office. Phone number is used only to contact you about this complaint.</p>
          </form>
        )}
      </main>
    </div>
  );
};
