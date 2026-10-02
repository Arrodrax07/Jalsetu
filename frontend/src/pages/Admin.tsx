import React, { useCallback, useEffect, useState } from 'react';
import { Brain, Database, Plus, RefreshCw, Save } from 'lucide-react';
import { useApp, useNow } from '../context/AppContext';
import { api } from '../services/api';
import { Button, Chip, Dialog, Empty, Field, Loading, PageHeader, Panel, StatusChip, Tabs } from '../components/ui';
import { FACTOR_LABELS } from './Requests';
import type { MlStatus, OperationsSettings, PriorityWeights, UserProfile, UserRole } from '../types';
import { dt, timeAgo } from '../utils/format';

export const Admin: React.FC = () => {
  const { can } = useApp();
  const [tab, setTab] = useState('health');
  const tabs = [
    { id: 'health', label: 'System & integrations' },
    ...(can('manage_users') ? [{ id: 'users', label: 'Users & roles' }] : []),
    { id: 'settings', label: 'Settings' },
    { id: 'ml', label: 'ML models' },
    ...(can('manage_settings') ? [{ id: 'audit', label: 'Audit log' }] : []),
  ];
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Administration" subtitle={can('manage_settings') ? 'Changes are audited with before/after state.' : 'Read-only for your role.'} />
      <div className="panel overflow-hidden">
        <Tabs tabs={tabs} value={tab} onChange={setTab} />
        <div className="p-4">
          {tab === 'health' && <Health />}
          {tab === 'users' && <Users />}
          {tab === 'settings' && <Settings />}
          {tab === 'ml' && <Ml />}
          {tab === 'audit' && <Audit />}
        </div>
      </div>
    </div>
  );
};

const Health: React.FC = () => {
  const { health, refresh, can, fail, toast } = useApp();
  const now = useNow(0, 10000);
  const [geo, setGeo] = useState<{ states: number; districts: number; districtsWithLgdCode: number } | null>(null);
  useEffect(() => { api.geoStatus().then(setGeo).catch(() => undefined); }, []);
  const run = async (key: string) => { try { await api.runIngestion(key); toast('Job started', key, 'info'); setTimeout(() => refresh('health'), 4000); } catch (e) { fail(e); } };
  if (!health) return <Loading />;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <div className="panel p-3"><p className="eyebrow">Database</p><div className="mt-1 flex items-center gap-2"><StatusChip status={health.database.status} /><span className="text-xs text-cc-muted">{health.database.engine} · {health.database.latencyMs} ms</span></div></div>
        <div className="panel p-3"><p className="eyebrow">ML services</p><div className="mt-1 flex flex-wrap gap-1"><StatusChip status={health.ml.complaintClassifier} label={`triage ${health.ml.complaintClassifier}`} /><StatusChip status={health.ml.demandForecaster} label={`forecast ${health.ml.demandForecaster}`} /></div></div>
        <div className="panel p-3"><p className="eyebrow">GPS ingestion</p><div className="mt-1 flex items-center gap-2"><StatusChip status={health.gpsIngestion.status} /><span className="text-xs text-cc-muted">{health.gpsIngestion.fixesLast10Min} fixes / 10 min</span></div><p className="mt-1 text-2xs text-cc-faint">last fix {timeAgo(health.gpsIngestion.lastFixReceivedAt, now)}</p></div>
        <div className="panel p-3"><p className="eyebrow">Geography</p><p className="mt-1 text-sm">{geo ? `${geo.states} states · ${geo.districts} districts` : '…'}</p><p className="text-2xs text-cc-faint">{geo ? `${geo.districtsWithLgdCode} with LGD codes` : ''}</p></div>
      </div>
      <div className="overflow-x-auto">
        <table className="table-cc">
          <thead><tr><th>Source</th><th>Status</th><th>Last success</th><th>Access required</th><th>Env</th><th>Update</th><th>Licence</th><th /></tr></thead>
          <tbody>{health.sources.map(s => (
            <tr key={s.key}>
              <td><p className="font-medium">{s.name}</p><p className="text-2xs text-cc-faint">{s.provider}</p></td>
              <td><StatusChip status={s.status} />{s.lastError && <p className="mt-1 max-w-xs text-2xs text-cc-faint">{s.lastError}</p>}</td>
              <td className="text-cc-muted">{s.lastSuccessAt ? timeAgo(s.lastSuccessAt, now) : '—'}</td>
              <td className="max-w-xs text-xs text-cc-muted">{s.access}</td><td className="text-2xs text-cc-faint">{s.env || '—'}</td>
              <td className="text-xs text-cc-muted">{s.frequency}</td><td className="text-2xs text-cc-faint">{s.license}</td>
              <td>{can('run_ingestion') && ['ndma_sachet', 'geoboundaries'].includes(s.key) && <Button size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => run(s.key)}>Run</Button>}</td>
            </tr>))}</tbody>
        </table>
      </div>
      {can('run_ingestion') && <Button size="sm" icon={<Database className="h-3.5 w-3.5" />} onClick={() => run('probes')}>Re-check credential-gated sources</Button>}
    </div>
  );
};

const Users: React.FC = () => {
  const { fail, toast, refresh, vehicles } = useApp();
  const [users, setUsers] = useState<UserProfile[] | null>(null);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'operator' as UserRole, phone: '', designation: '' });
  const load = useCallback(() => api.users().then(setUsers).catch(fail), [fail]);
  useEffect(() => { load(); }, [load]);
  const create = async () => { try { await api.createUser(f); toast('User created', `${f.email} must change the password at first sign-in.`, 'success'); setOpen(false); load(); refresh('drivers'); } catch (e) { fail(e); } };
  const toggle = async (u: UserProfile) => { try { await api.updateUser(u.id, { isActive: !u.isActive }); load(); } catch (e) { fail(e); } };
  if (!users) return <Loading />;
  return (
    <div>
      <div className="mb-3 flex justify-between"><p className="text-sm text-cc-muted">Roles: admin (everything) · operator (verification, complaints, approvals) · dispatcher (trips, drivers) · driver (own trips + GPS only).</p>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Add user</Button></div>
      <table className="table-cc">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Vehicle</th><th>Status</th><th /></tr></thead>
        <tbody>{users.map(u => (
          <tr key={u.id}><td className="font-medium">{u.name}{u.mustChangePassword && <Chip className="ml-2" tone="warn">initial password</Chip>}</td><td className="text-cc-muted">{u.email}</td>
            <td className="capitalize">{u.role}</td><td className="text-cc-muted">{u.role === 'driver' ? (vehicles.find(v => v.driverUserId === u.id)?.registration || '—') : ''}</td>
            <td>{u.isActive ? <StatusChip status="Available" label="active" /> : <StatusChip status="Cancelled" label="disabled" />}</td>
            <td className="text-right"><Button size="sm" variant="ghost" onClick={() => toggle(u)}>{u.isActive ? 'Disable' : 'Enable'}</Button></td></tr>))}</tbody>
      </table>
      <Dialog open={open} onClose={() => setOpen(false)} title="Add user" subtitle="The user must change this initial password at first sign-in.">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" className="col-span-2"><input className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Email"><input className="input" type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Role"><select className="input" value={f.role} onChange={e => setF({ ...f, role: e.target.value as UserRole })}><option value="operator">Operator</option><option value="dispatcher">Dispatcher</option><option value="driver">Driver</option><option value="admin">Administrator</option></select></Field>
          <Field label="Initial password" hint="≥ 10 characters with letters and digits"><input className="input" type="password" autoComplete="new-password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} /></Field>
          <Field label="Phone"><input className="input" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></Field>
        </div>
        <div className="mt-4 flex justify-end gap-2"><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={!f.name || !f.email || f.password.length < 10} onClick={create}>Create</Button></div>
      </Dialog>
    </div>
  );
};

const OPS: { k: keyof OperationsSettings; label: string; step?: string }[] = [
  { k: 'geofenceRadiusM', label: 'Arrival geofence radius (m)' }, { k: 'arrivalConsecutiveFixes', label: 'Fixes inside geofence for arrival' },
  { k: 'arrivalMaxAccuracyM', label: 'Max fix accuracy counted for arrival (m)' }, { k: 'startMaxAccuracyM', label: 'Max accuracy to START trip (m)' },
  { k: 'liveSeconds', label: 'LIVE if last fix within (s)' }, { k: 'offlineSeconds', label: 'OFFLINE after (s)' },
  { k: 'maxPlausibleSpeedKmh', label: 'GPS jump threshold (km/h)' }, { k: 'deviationThresholdM', label: 'Route deviation threshold (m)' },
  { k: 'deviationConsecutiveFixes', label: 'Fixes off-route for deviation' }, { k: 'prolongedStopMinutes', label: 'Prolonged stop (min)' },
  { k: 'varianceTolerancePct', label: 'Delivery volume tolerance (±%)', step: '0.5' }, { k: 'tripsPerDay', label: 'Trips per tanker per day' },
  { k: 'survivalLitresPerPerson', label: 'Survival floor (L/person/day)', step: '0.5' }, { k: 'minCoveragePct', label: 'Minimum coverage guarantee (%)' },
  { k: 'protectVulnerabilityAbove', label: 'Protect vulnerability ≥' }, { k: 'dieselPricePerLitre', label: 'Diesel price (₹/L)', step: '0.1' },
];

const Settings: React.FC = () => {
  const { weights, operations, can, fail, toast, refresh } = useApp();
  const [w, setW] = useState<PriorityWeights | null>(weights);
  const [o, setO] = useState<Partial<OperationsSettings>>(operations || {});
  useEffect(() => setW(weights), [weights]);
  useEffect(() => setO(operations || {}), [operations]);
  const edit = can('manage_settings');
  if (!w || !operations) return <Loading />;
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="Priority weights">
        {(Object.keys(w) as (keyof PriorityWeights)[]).map(k => (
          <div key={k} className="mb-3"><div className="flex justify-between text-sm"><span>{FACTOR_LABELS[k]}</span><span className="num text-cc-muted">{total ? Math.round(100 * w[k] / total) : 0}%</span></div>
            <input type="range" min={0} max={1} step={0.01} value={w[k]} disabled={!edit} aria-label={FACTOR_LABELS[k]} onChange={e => setW({ ...w, [k]: Number(e.target.value) })} className="w-full accent-sky-500" /></div>
        ))}
        {edit && <Button variant="primary" icon={<Save className="h-4 w-4" />} onClick={async () => { try { await api.saveWeights(w); toast('Weights saved', 'Normalised to 100%.', 'success'); refresh('settings', 'communities'); } catch (e) { fail(e); } }}>Save weights</Button>}
      </Panel>
      <Panel title="Operations, tracking & delivery policy">
        <div className="grid grid-cols-2 gap-3">
          {OPS.map(x => <Field key={x.k} label={x.label}><input className="input" type="number" step={x.step || '1'} disabled={!edit} value={(o[x.k] as number) ?? ''} onChange={e => setO({ ...o, [x.k]: Number(e.target.value) })} /></Field>)}
        </div>
        {edit && <Button className="mt-3" variant="primary" icon={<Save className="h-4 w-4" />} onClick={async () => { try { await api.saveOperations(o); toast('Settings saved', '', 'success'); refresh('settings', 'vehicles'); } catch (e) { fail(e); } }}>Save</Button>}
      </Panel>
    </div>
  );
};

const Ml: React.FC = () => {
  const { can, fail, toast } = useApp();
  const [s, setS] = useState<MlStatus | null>(null);
  const [job, setJob] = useState<{ running: boolean; log: string; returncode: number | null } | null>(null);
  useEffect(() => { api.mlStatus().then(setS).catch(fail); }, [fail]);
  useEffect(() => {
    if (!job?.running) return;
    const id = setInterval(async () => { const st = await api.retrainStatus(); setJob(st); if (!st.running) { api.mlStatus().then(setS); toast(st.returncode === 0 ? 'Retraining finished' : 'Retraining failed', '', st.returncode === 0 ? 'success' : 'error'); } }, 4000);
    return () => clearInterval(id);
  }, [job?.running, toast]);
  if (!s) return <Loading />;
  const cm = s.metrics?.complaint_classifier?.metrics, dm = s.metrics?.demand_forecaster?.metrics;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Complaint triage classifier" actions={<StatusChip status={s.complaintClassifier.loaded ? 'healthy' : 'unavailable'} />}>
          <p className="text-xs text-cc-muted">{String(s.complaintClassifier.meta?.model ?? '')}</p>
          {cm && <ul className="mt-2 space-y-1 text-sm">
            <li>Category accuracy on unseen phrasings: <b className="num">{(cm.category.holdout_unseen_phrasings.accuracy * 100).toFixed(1)}%</b></li>
            <li>Severity accuracy: <b className="num">{(cm.severity.holdout_unseen_phrasings.accuracy * 100).toFixed(1)}%</b></li>
            <li className="text-xs text-cc-muted">By language: {Object.entries(cm.category.by_language as Record<string, number>).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(' · ')}</li>
          </ul>}
          <p className="mt-2 text-2xs text-cc-faint">Bootstrap training data is a generated multilingual corpus (no public labelled dataset exists). Officer-verified labels are mixed in on retraining. Not validated on real operational complaints yet.</p>
        </Panel>
        <Panel title="Demand forecaster" actions={<StatusChip status={s.demandForecaster.loaded ? 'healthy' : 'unavailable'} />}>
          <p className="text-xs text-cc-muted">{String(s.demandForecaster.meta?.model ?? '')}</p>
          {dm && <ul className="mt-2 space-y-1 text-sm"><li>Hold-out MAPE: <b className="num">{dm.model.mape_pct}%</b> (seasonal baseline {dm.baseline_monthly_seasonal.mape_pct}%)</li><li className="text-xs text-cc-muted">Real observations used: {dm.n_real_observations}</li></ul>}
          <p className="mt-2 text-2xs text-cc-faint">Real weather inputs; simulated demand response. Advisory only; requires real metered observations before production use.</p>
        </Panel>
      </div>
      {can('manage_settings') && (
        <div className="space-y-2">
          <div className="flex gap-2">{(['complaints', 'demand', 'all'] as const).map(t => <Button key={t} icon={<Brain className="h-4 w-4" />} disabled={!!job?.running} onClick={async () => { try { await api.retrain(t); setJob({ running: true, log: '', returncode: null }); } catch (e) { fail(e); } }}>Retrain {t}</Button>)}</div>
          {job?.log && <pre className="max-h-48 overflow-auto rounded-lg bg-cc-bg p-3 text-2xs text-cc-muted">{job.log}</pre>}
        </div>
      )}
    </div>
  );
};

const Audit: React.FC = () => {
  const { fail } = useApp();
  const [rows, setRows] = useState<any[] | null>(null);
  const [open, setOpen] = useState<any | null>(null);
  useEffect(() => { api.audit('?limit=300').then(setRows).catch(fail); }, [fail]);
  if (!rows) return <Loading />;
  if (!rows.length) return <Empty title="No audit entries" />;
  return (
    <div className="max-h-[60vh] overflow-auto">
      <table className="table-cc text-xs">
        <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Entity</th><th>IP / device</th><th /></tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.id}><td className="num whitespace-nowrap text-cc-muted">{dt(r.createdAt)}</td><td>{r.user} <span className="text-cc-faint">{r.role}</span></td><td className="font-medium">{r.action}</td>
            <td className="text-cc-muted">{r.entity} {r.entityId}</td><td className="text-cc-faint">{r.ip} {r.deviceId ? `· ${String(r.deviceId).slice(0, 8)}` : ''}</td>
            <td>{(r.before || r.after || Object.keys(r.details || {}).length > 0) && <Button size="sm" variant="ghost" onClick={() => setOpen(r)}>Details</Button>}</td></tr>))}</tbody>
      </table>
      <Dialog open={!!open} onClose={() => setOpen(null)} title={open ? `${open.action} · ${open.entity} ${open.entityId}` : ''} wide>
        {open && <div className="grid gap-3 md:grid-cols-3 text-2xs">{(['before', 'after', 'details'] as const).map(k => <div key={k}><p className="eyebrow mb-1">{k}</p><pre className="overflow-auto rounded-lg bg-cc-bg p-2 text-cc-muted">{JSON.stringify(open[k], null, 2)}</pre></div>)}</div>}
      </Dialog>
    </div>
  );
};
