import React, { useCallback, useEffect, useState } from 'react';
import { Sliders, Save, RotateCcw, Users, Brain, Cog, Loader2, Plus, ScrollText } from 'lucide-react';
import { useWaterData } from '../context/WaterDataContext';
import { api } from '../services/api';
import { FACTOR_LABELS } from '../components/requests/CreateRequestModal';
import type { MlStatus, OperationsSettings, PriorityWeights, UserProfile, UserRole } from '../types';
import { dateTime } from '../utils/format';

const input = 'w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 disabled:opacity-60';
const DEFAULT_W: PriorityWeights = { demand: 0.35, vulnerability: 0.3, unmetNeed: 0.2, previousCoverage: 0.1, population: 0.05 };

const OPS_FIELDS: { k: keyof OperationsSettings; label: string; step?: string; help: string }[] = [
  { k: 'tripsPerDay', label: 'Trips per tanker per day', help: 'Sets default daily supply = capacity × trips' },
  { k: 'survivalLitresPerPerson', label: 'Survival floor (L/person/day)', step: '0.5', help: 'Guaranteed before anything else' },
  { k: 'minCoveragePct', label: 'Minimum coverage guarantee (%)', help: 'Applied when supply allows' },
  { k: 'protectVulnerabilityAbove', label: 'Protect vulnerability ≥', help: 'Held harmless during disruptions' },
  { k: 'geofenceRadiusM', label: 'POD geofence radius (m)', help: 'GPS must be within this of the community' },
  { k: 'varianceTolerancePct', label: 'Volume tolerance (±%)', step: '0.5', help: 'Larger variance flags the delivery' },
  { k: 'dieselPricePerLitre', label: 'Diesel price (₹/L)', step: '0.1', help: 'For route savings' },
  { k: 'tankerKmPerLitre', label: 'Tanker mileage (km/L)', step: '0.1', help: 'For route savings' },
  { k: 'duplicateSimilarity', label: 'Duplicate text similarity', step: '0.01', help: '0–1, character n-gram cosine' },
];

export const Settings: React.FC = () => {
  const { weights, operations, saveWeights, saveOperations, currentUser } = useWaterData();
  const isAdmin = currentUser?.role === 'admin';
  const [w, setW] = useState<PriorityWeights>(weights || DEFAULT_W);
  const [ops, setOps] = useState<Partial<OperationsSettings>>(operations || {});
  useEffect(() => { if (weights) setW(weights); }, [weights]);
  useEffect(() => { if (operations) setOps(operations); }, [operations]);
  const total = Object.values(w).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black tracking-tight text-slate-900">Settings</h2>
        <p className="text-xs text-slate-500 mt-1">{isAdmin ? 'Changes are audited and take effect immediately.' : 'Read-only: only administrators can change settings.'}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="p-5 bg-white rounded-2xl border border-slate-200/90 shadow-subtle space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 flex items-center gap-2"><Sliders className="w-4 h-4 text-sky-600" /> Priority weights</h3>
          {(Object.keys(w) as (keyof PriorityWeights)[]).map(k => (
            <div key={k}>
              <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1"><span>{FACTOR_LABELS[k]}</span><span>{total ? Math.round((100 * w[k]) / total) : 0}%</span></div>
              <input type="range" min={0} max={1} step={0.01} value={w[k]} disabled={!isAdmin} onChange={e => setW({ ...w, [k]: Number(e.target.value) })} className="w-full accent-sky-600" aria-label={FACTOR_LABELS[k]} />
            </div>
          ))}
          <p className="text-[11px] text-slate-500">Weights are normalised to sum to 100% on save.</p>
          {isAdmin && (
            <div className="flex gap-2">
              <button onClick={() => saveWeights(w)} disabled={total <= 0} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold disabled:opacity-50"><Save className="w-4 h-4" />Save weights</button>
              <button onClick={() => setW(DEFAULT_W)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold"><RotateCcw className="w-4 h-4" />Defaults</button>
            </div>
          )}
        </section>

        <section className="p-5 bg-white rounded-2xl border border-slate-200/90 shadow-subtle space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 flex items-center gap-2"><Cog className="w-4 h-4 text-sky-600" /> Operations & policy</h3>
          <div className="grid grid-cols-2 gap-3">
            {OPS_FIELDS.map(f => (
              <div key={f.k}>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1" title={f.help}>{f.label}</label>
                <input type="number" step={f.step || '1'} value={(ops[f.k] as number) ?? ''} disabled={!isAdmin} onChange={e => setOps({ ...ops, [f.k]: Number(e.target.value) })} className={input} />
                <p className="text-[10px] text-slate-400 mt-0.5">{f.help}</p>
              </div>
            ))}
          </div>
          {isAdmin && <button onClick={() => saveOperations(ops)} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold"><Save className="w-4 h-4" />Save operations</button>}
        </section>
      </div>

      <MlPanel isAdmin={isAdmin} />
      {isAdmin && <UsersPanel />}
      {isAdmin && <AuditPanel />}
    </div>
  );
};

const MlPanel: React.FC<{ isAdmin: boolean }> = ({ isAdmin }) => {
  const { handleError, addToast } = useWaterData();
  const [s, setS] = useState<MlStatus | null>(null);
  const [job, setJob] = useState<{ running: boolean; log: string; returncode: number | null } | null>(null);
  const load = useCallback(() => api.mlStatus().then(setS).catch(e => handleError(e, 'ML status unavailable')), [handleError]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!job?.running) return;
    const id = setInterval(async () => {
      const st = await api.retrainStatus();
      setJob(st);
      if (!st.running) { load(); addToast(st.returncode === 0 ? 'Retraining finished' : 'Retraining failed', st.returncode === 0 ? 'Models reloaded.' : 'See log below.', st.returncode === 0 ? 'success' : 'error'); }
    }, 4000);
    return () => clearInterval(id);
  }, [job?.running, load, addToast]);

  const cm = s?.metrics?.complaint_classifier?.metrics;
  const dm = s?.metrics?.demand_forecaster?.metrics;
  const retrain = async (t: 'all' | 'complaints' | 'demand') => {
    try { await api.retrain(t); setJob({ running: true, log: '', returncode: null }); } catch (e) { handleError(e, 'Could not start retraining'); }
  };

  return (
    <section className="p-5 bg-white rounded-2xl border border-slate-200/90 shadow-subtle space-y-4">
      <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 flex items-center gap-2"><Brain className="w-4 h-4 text-violet-600" /> Machine learning models</h3>
      {!s ? <p className="text-xs text-slate-500">Loading…</p> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="p-4 rounded-xl border border-slate-200 space-y-1.5">
            <p className="font-bold text-slate-900">Complaint triage {s.complaintClassifier.loaded ? <span className="text-emerald-600">● loaded</span> : <span className="text-rose-600">● {s.complaintClassifier.error}</span>}</p>
            <p className="text-slate-500">{String(s.complaintClassifier.meta?.model ?? '')}</p>
            {cm && <>
              <p>Category accuracy on unseen phrasings: <strong>{(cm.category.holdout_unseen_phrasings.accuracy * 100).toFixed(1)}%</strong> (macro-F1 {(cm.category.holdout_unseen_phrasings.macro_f1 * 100).toFixed(1)})</p>
              <p>Severity accuracy: <strong>{(cm.severity.holdout_unseen_phrasings.accuracy * 100).toFixed(1)}%</strong></p>
              <p className="text-slate-500">By language (category): {Object.entries(cm.category.by_language as Record<string, number>).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(' · ')}</p>
            </>}
            <p className="text-slate-500">Trained {String(s.complaintClassifier.meta?.trained_at ?? '—')} · real labels used: {String(s.complaintClassifier.meta?.n_real_labels ?? 0)}</p>
          </div>
          <div className="p-4 rounded-xl border border-slate-200 space-y-1.5">
            <p className="font-bold text-slate-900">Demand forecaster {s.demandForecaster.loaded ? <span className="text-emerald-600">● loaded</span> : <span className="text-rose-600">● {s.demandForecaster.error}</span>}</p>
            <p className="text-slate-500">{String(s.demandForecaster.meta?.model ?? '')} · {String(s.demandForecaster.meta?.weather_source ?? '')}</p>
            {dm && <>
              <p>Hold-out MAPE ({dm.split}): <strong>{dm.model.mape_pct}%</strong></p>
              <p className="text-slate-500">vs static baseline {dm.baseline_static_demand.mape_pct}% · vs monthly seasonal {dm.baseline_monthly_seasonal.mape_pct}% · 80% interval coverage {dm.interval_80_coverage_pct}%</p>
            </>}
            <p className="text-slate-500">Trained {String(s.demandForecaster.meta?.trained_at ?? '—')} · real observations: {String(dm?.n_real_observations ?? 0)}</p>
          </div>
        </div>
      )}
      {isAdmin && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {(['complaints', 'demand', 'all'] as const).map(t => (
              <button key={t} onClick={() => retrain(t)} disabled={!!job?.running} className="px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5">
                {job?.running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />} Retrain {t}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-500">Retraining mixes officer-verified complaints and recorded demand observations from this database into the training set, evaluates, and hot-swaps the models. Complaint retraining takes a few minutes.</p>
          {job?.log && <pre className="text-[10px] bg-slate-900 text-slate-200 p-3 rounded-xl max-h-48 overflow-auto whitespace-pre-wrap">{job.log}</pre>}
        </div>
      )}
    </section>
  );
};

const UsersPanel: React.FC = () => {
  const { handleError, addToast, refresh, tankers } = useWaterData();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'officer' as UserRole, designation: '', ward: '', phone: '' });
  const load = useCallback(() => api.users().then(setUsers).catch(e => handleError(e)), [handleError]);
  useEffect(() => { load(); }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.createUser(form); addToast('User created', form.email, 'success'); setForm({ ...form, name: '', email: '', password: '' }); load(); }
    catch (err) { handleError(err, 'Could not create user'); }
  };
  const toggle = async (u: UserProfile) => { try { await api.updateUser(u.id, { isActive: !u.isActive }); load(); } catch (e) { handleError(e); } };
  const assignTanker = async (tankerId: string, userId: number) => {
    const u = users.find(x => x.id === userId);
    try { await api.updateTanker(tankerId, { driverUserId: userId, driverName: u?.name, driverPhone: u?.phone }); addToast('Driver linked', `${u?.name} → ${tankerId}`, 'success'); load(); refresh('tankers'); }
    catch (e) { handleError(e); }
  };

  return (
    <section className="p-5 bg-white rounded-2xl border border-slate-200/90 shadow-subtle space-y-4">
      <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 flex items-center gap-2"><Users className="w-4 h-4 text-sky-600" /> Users & drivers</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-[10px] uppercase text-slate-500 border-b border-slate-200"><tr><th className="py-2">Name</th><th>Email</th><th>Role</th><th>Tanker</th><th>Status</th><th /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {users.map(u => (
              <tr key={u.id}>
                <td className="py-2 font-semibold">{u.name}</td><td className="text-slate-600">{u.email}</td><td className="capitalize">{u.role}</td>
                <td>{u.role === 'driver' ? (
                  <select value={u.tankerId || ''} onChange={e => e.target.value && assignTanker(e.target.value, u.id)} className="px-2 py-1 rounded-lg border border-slate-200 text-xs">
                    <option value="">—</option>{tankers.map(t => <option key={t.id} value={t.id}>{t.id}</option>)}
                  </select>) : '—'}</td>
                <td>{u.isActive ? <span className="text-emerald-600 font-semibold">Active</span> : <span className="text-slate-400">Disabled</span>}</td>
                <td className="text-right"><button onClick={() => toggle(u)} className="text-xs font-semibold text-sky-700">{u.isActive ? 'Disable' : 'Enable'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form onSubmit={create} className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-3 border-t border-slate-100">
        <input required minLength={2} placeholder="Full name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={input} />
        <input required type="email" placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className={input} />
        <input required minLength={8} type="password" placeholder="Temp password (8+)" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} className={input} autoComplete="new-password" />
        <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value as UserRole })} className={input}><option value="officer">Field officer</option><option value="driver">Driver</option><option value="admin">Administrator</option></select>
        <input placeholder="Designation" value={form.designation} onChange={e => setForm({ ...form, designation: e.target.value })} className={input} />
        <input placeholder="Ward" value={form.ward} onChange={e => setForm({ ...form, ward: e.target.value })} className={input} />
        <input placeholder="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className={input} />
        <button type="submit" className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold"><Plus className="w-4 h-4" />Add user</button>
      </form>
    </section>
  );
};

const AuditPanel: React.FC = () => {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.audit>>>([]);
  useEffect(() => { api.audit().then(setRows).catch(() => undefined); }, []);
  return (
    <section className="p-5 bg-white rounded-2xl border border-slate-200/90 shadow-subtle space-y-3">
      <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 flex items-center gap-2"><ScrollText className="w-4 h-4 text-sky-600" /> Audit log</h3>
      <div className="max-h-72 overflow-y-auto">
        <table className="w-full text-xs"><tbody className="divide-y divide-slate-100">
          {rows.map(r => <tr key={r.id}><td className="py-1.5 text-slate-500 whitespace-nowrap pr-3">{dateTime(r.createdAt)}</td><td className="pr-3">{r.user}</td><td className="font-semibold pr-3">{r.action}</td><td className="text-slate-600">{r.entity} {r.entityId}</td></tr>)}
        </tbody></table>
      </div>
    </section>
  );
};
