import React, { useState } from 'react';
import { Plus, RotateCcw, Wrench } from '../components/icons';
import { liveState, useApp, useNow } from '../context/AppContext';
import { DataTable } from '../components/DataTable';
import { api } from '../services/api';
import { VehiclePanel } from '../components/panels';
import { Button, Dialog, Field, PageHeader, StatusChip, TrackingBadge } from '../components/ui';

const SOURCE: Record<string, string> = { phone_gps: 'Phone GPS', vltd: 'VLTD', ais140: 'AIS-140', manual: 'Manual' };

export const Fleet: React.FC = () => {
  const { vehicles, thresholds, serverOffsetMs, can, drivers, fail, refresh, toast, navigate, depots } = useApp();
  const now = useNow(serverOffsetMs);
  const [sel, setSel] = useState<string | null>(null);
  const [breakId, setBreakId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ id: '', vehicleNumber: '', capacity: 10000, depotId: '' as number | '' });

  const breakdown = async () => {
    try { await api.breakdown(breakId!, note || 'Breakdown reported'); toast('Vehicle out of service', 'Allocation re-planned with protected communities held.', 'warning'); setBreakId(null); setNote(''); refresh('vehicles', 'plan', 'overview'); }
    catch (e) { fail(e); }
  };
  const rows = vehicles.map(v => ({ v, ls: liveState(v, thresholds, now) }));
  const create = async () => {
    try { await api.createTanker({ id: form.id, vehicleNumber: form.vehicleNumber, capacity: form.capacity, depotId: form.depotId || undefined }); setAdding(false); refresh('vehicles'); }
    catch (e) { fail(e, 'Could not add vehicle'); }
  };
  const setDriver = async (id: string, driverUserId: number) => { try { await api.updateTanker(id, { driverUserId }); refresh('vehicles'); } catch (e) { fail(e); } };

  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Fleet" subtitle="Status and live tracking state of every vehicle. Positions come only from received telemetry."
        actions={can('manage_master_data') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add vehicle</Button>} />
      <DataTable label="Fleet" rows={rows} rowKey={r => r.v.vehicleId} onRowClick={r => setSel(r.v.vehicleId)} selectedKey={sel}
        filters={[
          { id: 'all', label: 'All', test: () => true },
          { id: 'live', label: 'Live GPS', test: r => r.ls.state === 'live' },
          { id: 'trip', label: 'On a trip', test: r => !!r.v.trip },
          { id: 'free', label: 'Available', test: r => r.v.status === 'Available' },
          { id: 'maint', label: 'Maintenance', test: r => r.v.status === 'Maintenance' },
        ]}
        defaultSort={{ id: 'tracking', dir: 'asc' }}
        search={r => `${r.v.registration} ${r.v.vehicleId} ${r.v.driverName ?? ''}`} searchPlaceholder="Search vehicles or drivers"
        emptyTitle="No vehicles in this view"
        columns={[
          { id: 'vehicle', header: 'Vehicle', sort: r => r.v.registration, cell: r => <><span className="mono font-medium text-cc-accent">{r.v.registration}</span><div className="text-[11.5px] text-cc-faint">{r.v.vehicleId}{r.v.depot ? ` · ${r.v.depot.name}` : ''}</div></> },
          { id: 'status', header: 'Status', sort: r => r.v.status, cell: r => <StatusChip status={r.v.status} /> },
          { id: 'tracking', header: 'Tracking', sort: r => ['live', 'stale', 'offline', 'no_signal'].indexOf(r.ls.state) * 1e7 + (r.ls.age ?? 9e6), cell: r => <TrackingBadge state={r.ls.state} ageSeconds={r.ls.age} /> },
          { id: 'src', header: 'Source', hideBelow: 'xl', cell: r => <span className="text-[12.5px] text-cc-muted">{SOURCE[r.v.position?.source || r.v.trackingSource] || r.v.trackingSource}</span> },
          { id: 'driver', header: 'Default driver', hideBelow: 'md', cell: r => can('manage_master_data') ? (
            <select className="input h-8 py-0 text-[12.5px]" value={r.v.driverUserId ?? ''} onClick={e => e.stopPropagation()} onChange={e => e.target.value && setDriver(r.v.vehicleId, Number(e.target.value))} aria-label={`Default driver for ${r.v.registration}`}>
              <option value="">—</option>{drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>) : (r.v.driverName || '—') },
          { id: 'trip', header: 'Trip', hideBelow: 'lg', cell: r => r.v.trip ? <button className="mono text-cc-accent hover:underline" onClick={e => { e.stopPropagation(); navigate(`trips/${r.v.trip!.id}`); }}>{r.v.trip.id}</button> : <span className="text-cc-faint">—</span> },
          { id: 'cap', header: 'Capacity', align: 'right', sort: r => r.v.capacity ?? 0, hideBelow: 'lg', cell: r => <span className="mono">{r.v.capacity?.toLocaleString('en-IN')} L</span> },
          { id: 'act', header: <span className="sr-only">Actions</span>, align: 'right', cell: r => <>
            {can('report_breakdown') && r.v.status !== 'Maintenance' && <Button size="sm" variant="ghost" icon={<Wrench className="h-3.5 w-3.5" />} onClick={e => { e.stopPropagation(); setBreakId(r.v.vehicleId); }}>Breakdown</Button>}
            {can('report_breakdown') && r.v.status === 'Maintenance' && <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={async e => { e.stopPropagation(); try { await api.restoreTanker(r.v.vehicleId); refresh('vehicles', 'overview'); } catch (x) { fail(x); } }}>Restore</Button>}
          </> },
        ]} />
      <VehiclePanel id={sel} onClose={() => setSel(null)} onOpenTrip={r => navigate(`trips/${r}`)} />
      <Dialog open={!!breakId} onClose={() => setBreakId(null)} title={`Report breakdown: ${breakId}`} subtitle="The vehicle is taken out of service and the allocation plan is recomputed.">
        <Field label="What happened?"><input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. axle failure near depot" /></Field>
        <div className="mt-4 flex justify-end gap-2"><Button onClick={() => setBreakId(null)}>Cancel</Button><Button variant="danger" onClick={breakdown}>Take out of service</Button></div>
      </Dialog>
      <Dialog open={adding} onClose={() => setAdding(false)} title="Add vehicle">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Vehicle ID"><input className="input" value={form.id} onChange={e => setForm({ ...form, id: e.target.value })} placeholder="T-3001" /></Field>
          <Field label="Registration"><input className="input" value={form.vehicleNumber} onChange={e => setForm({ ...form, vehicleNumber: e.target.value })} placeholder="MH-01-AB-1234" /></Field>
          <Field label="Capacity (L)"><input className="input" type="number" value={form.capacity} onChange={e => setForm({ ...form, capacity: Number(e.target.value) })} /></Field>
          <Field label="Home depot"><select className="input" value={form.depotId} onChange={e => setForm({ ...form, depotId: e.target.value ? Number(e.target.value) : '' })}><option value="">—</option>{depots.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        </div>
        <div className="mt-4 flex justify-end gap-2"><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" onClick={create} disabled={!form.id || form.vehicleNumber.length < 4}>Add</Button></div>
      </Dialog>
    </div>
  );
};
