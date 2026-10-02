import React, { useEffect, useState } from 'react';
import { CheckCircle2, Droplets, Send } from 'lucide-react';
import { api } from '../services/api';
import { Button, ErrorBox, Field } from '../components/ui';

export const CitizenPortal: React.FC = () => {
  const [communities, setCommunities] = useState<{ id: string; name: string; ward: string }[]>([]);
  const [cid, setCid] = useState('');
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ticket, setTicket] = useState<{ id: string; category: string; severity: string; message: string } | null>(null);
  useEffect(() => { api.publicCommunities().then(c => { setCommunities(c); setCid(c[0]?.id || ''); }).catch(e => setErr(e.message)); }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { setTicket(await api.publicComplaint({ communityId: cid, description: text, reporterName: name, reporterPhone: phone })); }
    catch (x) { setErr(x instanceof Error ? x.message : String(x)); }
    setBusy(false);
  };
  return (
    <div className="min-h-full bg-cc-bg">
      <header className="border-b border-cc-border bg-cc-surface px-4 py-4">
        <div className="mx-auto flex max-w-lg items-center gap-2"><Droplets className="h-6 w-6 text-cc-accent" aria-hidden />
          <div><p className="font-semibold">JalSetu · जलसेतु</p><p className="text-xs text-cc-muted">Report a water supply problem · पानी की शिकायत · पाण्याची तक्रार</p></div></div>
      </header>
      <main className="mx-auto max-w-lg p-4">
        {ticket ? (
          <div className="panel space-y-2 p-6 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-green-400" aria-hidden />
            <p className="text-lg font-semibold">Ticket {ticket.id}</p>
            <p className="text-sm text-cc-muted">{ticket.message}</p>
            <button className="text-sm text-cc-accent hover:underline" onClick={() => { setTicket(null); setText(''); }}>Report another problem</button>
          </div>
        ) : (
          <form onSubmit={submit} className="panel space-y-4 p-5">
            <Field label="Your area"><select className="input" required value={cid} onChange={e => setCid(e.target.value)}>{communities.map(c => <option key={c.id} value={c.id}>{c.name} ({c.ward})</option>)}</select></Field>
            <Field label="What is the problem? (any language)"><textarea className="input" rows={5} required minLength={5} maxLength={3000} value={text} onChange={e => setText(e.target.value)} placeholder="e.g. No water for 3 days in lane 4 / 3 दिन से पानी नहीं आया / टँकर आला नाही" /></Field>
            <div className="grid grid-cols-2 gap-3"><input className="input" placeholder="Name (optional)" value={name} onChange={e => setName(e.target.value)} maxLength={120} /><input className="input" type="tel" placeholder="Phone (optional)" value={phone} onChange={e => setPhone(e.target.value)} maxLength={32} /></div>
            {err && <ErrorBox message={err} />}
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!cid} icon={<Send className="h-4 w-4" />}>Submit complaint</Button>
            <p className="text-center text-2xs text-cc-faint">Sent directly to the ward water office. Your phone number is used only to contact you about this complaint.</p>
          </form>
        )}
      </main>
    </div>
  );
};
