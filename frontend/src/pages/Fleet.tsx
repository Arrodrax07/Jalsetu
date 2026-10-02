import React, { useState } from 'react';
import { Plus, RotateCcw, Wrench } from 'lucide-react';
import { liveState, useApp, useNow } from '../context/AppContext';
import { api } from '../services/api';
import { VehiclePanel } from '../components/panels';
import { Button, Chip, Dialog, Empty, Field, OriginLabel, PageHeader, Panel, StatusChip, TrackingBadge } from '../components/ui';

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
  const create = async () => {
    try { await api.createTanker({ id: form.id, vehicleNumber: form.vehicleNumber, capacity: form.capacity, depotId: form.depotId || undefined }); setAdding(false); refresh('vehicles'); }
    catch (e) { fail(e, 'Could not add vehicle'); }
  };
  const setDriver = async (id: string, driverUserId: number) => { try { await api.updateTanker(id, { driverUserId }); refresh('vehicles'); } catch (e) { fail(e); } };

  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Fleet" subtitle="Status and live tracking state of every vehicle. Positions come only from received telemetry."
        actions={can('manage_master_data') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add vehicle</Button>} />
      <Panel bodyClassName="overflow-x-auto">
        {vehicles.length === 0 ? <Empty title="No vehicles registered" /> : (
          <table className="table-cc">
            <thead><tr><th>Vehicle</th><th>Status</th><th>Tracking</th><th>GPS source</th><th>Default driver</th><th>Trip</th><th className="text-right">Capacity</th><th>Record</th><th /></tr></thead>
            <tbody>{vehicles.map(v => {
              const ls = liveState(v, thresholds, now);
              return (
                <tr key={v.vehicleId}>
                  <td><button className="font-medium text-cc-accent hover:underline" onClick={() => setSel(v.vehicleId)}>{v.registration}</button><div className="text-2xs text-cc-faint">{v.vehicleId}</div></td>
                  <td><StatusChip status={v.status} /></td>
                  <td><TrackingBadge state={ls.state} ageSeconds={ls.age} /></td>
                  <td><Chip>{SOURCE[v.position?.source || v.trackingSource] || v.trackingSource}</Chip></td>
                  <td>{can('manage_master_data') ? (
                    <select className="input py-1 text-xs" value={v.driverUserId ?? ''} onChange={e => e.target.value && setDriver(v.vehicleId, Number(e.target.value))}>
                      <option value="">—</option>{drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>) : (v.driverName || '—')}</td>
                  <td>{v.trip ? <button className="text-cc-accent hover:underline" onClick={() => navigate(`trips/${v.trip!.id}`)}>{v.trip.id}</button> : <span className="text-cc-faint">—</span>}</td>
                  <td className="num text-right">{v.capacity?.toLocaleString('en-IN')} L</td>
                  <td><OriginLabel origin={v.dataOrigin} /></td>
                  <td className="text-right">
                    {can('report_breakdown') && v.status !== 'Maintenance' && <Button size="sm" variant="ghost" icon={<Wrench className="h-3.5 w-3.5" />} onClick={() => setBreakId(v.vehicleId)}>Breakdown</Button>}
                    {can('report_breakdown') && v.status === 'Maintenance' && <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={async () => { try { await api.restoreTanker(v.vehicleId); refresh('vehicles', 'overview'); } catch (e) { fail(e); } }}>Restore</Button>}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </Panel>
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
