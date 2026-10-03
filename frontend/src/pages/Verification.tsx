import React, { useEffect, useState } from 'react';
import { CheckCircle2, FileImage, MapPin, PenLine, SearchCheck } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { Button, Chip, Dialog, Empty, Field, KindLabel, KV, PageHeader, Panel, StatusChip } from '../components/ui';
import type { DeliveryRecord } from '../types';
import { dt, litres } from '../utils/format';

const FILTERS = ['To verify', 'Verified', 'All'] as const;

export const Verification: React.FC = () => {
  const { deliveries, operations, can } = useApp();
  const [f, setF] = useState<(typeof FILTERS)[number]>('To verify');
  const [sel, setSel] = useState<DeliveryRecord | null>(null);
  const rows = deliveries.filter(d => f === 'All' ? true : f === 'Verified' ? d.status === 'Verified' : d.status !== 'Verified');
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Delivery verification"
        subtitle={<>A trip completes only when every delivery is verified. Automatic checks: GPS-detected arrival, vehicle within {operations ? 2 * operations.geofenceRadiusM : '…'} m when recorded, volume within ±{operations?.varianceTolerancePct ?? '…'}%, receiver named.</>} />
      <div className="mb-3 flex gap-1">{FILTERS.map(x => <Button key={x} size="sm" variant={f === x ? 'primary' : 'secondary'} onClick={() => setF(x)}>{x}</Button>)}</div>
      <Panel bodyClassName="overflow-x-auto">
        {rows.length === 0 ? <Empty title={f === 'To verify' ? 'Nothing waiting for verification' : 'No deliveries'} hint="Deliveries are recorded by drivers at the destination." /> : (
          <table className="table-cc">
            <thead><tr><th>Delivery</th><th>Trip</th><th>Community</th><th className="text-right">Delivered</th><th className="text-right">Variance</th><th>GPS</th><th>Receiver</th><th>Recorded</th><th>Status</th><th /></tr></thead>
            <tbody>{rows.map(d => (
              <tr key={d.id}>
                <td className="font-medium">{d.id}</td><td className="text-cc-muted">{d.tripId}</td><td>{d.communityName}</td>
                <td className="num text-right">{litres(d.deliveredAmount)}</td>
                <td className={`num text-right ${d.varianceAmount !== 0 ? 'text-amber-800' : 'text-cc-muted'}`}>{d.varianceAmount.toLocaleString('en-IN')} L</td>
                <td>{d.gpsVerified ? <Chip tone="ok" icon={<MapPin className="h-3 w-3" />}>Arrived</Chip> : <Chip tone="danger">No GPS arrival</Chip>}</td>
                <td>{d.receiverName || <span className="text-cc-faint">—</span>}</td>
                <td className="num text-cc-muted">{dt(d.deliveryTime)}</td>
                <td><StatusChip status={d.status} /></td>
                <td className="text-right"><Button size="sm" onClick={() => setSel(d)}>{d.status !== 'Verified' && can('verify_delivery') ? 'Review' : 'View'}</Button></td>
              </tr>))}</tbody>
          </table>
        )}
      </Panel>
      {sel && <ReviewDialog d={sel} onClose={() => setSel(null)} />}
    </div>
  );
};

const ReviewDialog: React.FC<{ d: DeliveryRecord; onClose: () => void }> = ({ d, onClose }) => {
  const { can, fail, toast, refresh } = useApp();
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [sig, setSig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let urls: string[] = [];
    if (d.photoUrl) api.deliveryFile(d.photoUrl).then(u => { urls.push(u); setPhoto(u); }).catch(() => undefined);
    if (d.signatureUrl) api.deliveryFile(d.signatureUrl).then(u => { urls.push(u); setSig(u); }).catch(() => undefined);
    return () => urls.forEach(URL.revokeObjectURL);
  }, [d]);
  const flagged = d.status === 'Mismatch' || d.status === 'Under Investigation';
  const verify = async () => {
    setBusy(true);
    try {
      const r = await api.verifyDelivery(d.id, notes);
      toast('Delivery verified', r.tripCompleted ? `${d.tripId} completed; tanker ${d.vehicleNumber} is available again.` : 'Recorded.', 'success');
      await refresh('deliveries', 'trips', 'vehicles', 'overview', 'requests');
      onClose();
    } catch (e) { fail(e, 'Verification failed'); }
    setBusy(false);
  };
  const investigate = async () => {
    setBusy(true);
    try { await api.investigateDelivery(d.id, notes); await refresh('deliveries'); onClose(); } catch (e) { fail(e); }
    setBusy(false);
  };
  return (
    <Dialog open onClose={onClose} title={`Delivery ${d.id}`} subtitle={`${d.communityName} · ${d.vehicleNumber} · ${d.tripId}`} wide>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <KV k="Allocated" v={<span className="num">{litres(d.allocatedAmount)}</span>} />
          <KV k="Delivered (meter)" v={<span className="num">{litres(d.deliveredAmount)}</span>} />
          <KV k="Variance" v={<span className="num">{d.varianceAmount.toLocaleString('en-IN')} L</span>} />
          <KV k="GPS arrival at stop" v={d.gpsVerified ? <KindLabel kind="live-gps" title="Arrival detected from consecutive GPS fixes" /> : 'not detected'} />
          <KV k="Vehicle distance when recorded" v={<span className="num">{d.geofenceDistanceM != null ? `${d.geofenceDistanceM} m` : 'no position'}</span>} />
          <KV k="Fix time used" v={<span className="num">{dt(d.gpsDeviceTime)}</span>} />
          <KV k="Receiver" v={`${d.receiverName || '—'}${d.receiverPhone ? ` (${d.receiverPhone})` : ''}`} />
          <KV k="Recorded by / at" v={`${d.recordedBy} · ${dt(d.deliveryTime)}`} />
          <KV k="Status" v={<StatusChip status={d.status} />} />
          {d.notes && <p className="mt-2 rounded-md border border-cc-warn/40 bg-cc-warn/10 p-2 text-xs text-amber-800">{d.notes}</p>}
          {d.verifiedBy && <p className="mt-2 text-xs text-green-700">Verified by {d.verifiedBy}, {dt(d.verifiedAt)} {d.verificationNotes && `— ${d.verificationNotes}`}</p>}
        </div>
        <div className="space-y-3">
          <div><p className="label flex items-center gap-1"><FileImage className="h-3.5 w-3.5" /> Photo</p>{photo ? <img src={photo} alt="Delivery photo" className="max-h-56 w-full rounded-lg border border-cc-border object-contain" /> : <p className="text-xs text-cc-faint">{d.photoUrl ? 'Loading…' : 'No photo attached'}</p>}</div>
          <div><p className="label flex items-center gap-1"><PenLine className="h-3.5 w-3.5" /> Signature</p>{sig ? <img src={sig} alt="Receiver signature" className="h-24 w-full rounded-lg border border-cc-border bg-cc-bg object-contain" /> : <p className="text-xs text-cc-faint">{d.signatureUrl ? 'Loading…' : 'No signature'}</p>}</div>
        </div>
      </div>
      {d.status !== 'Verified' && can('verify_delivery') && (
        <div className="mt-4 border-t border-cc-border pt-4">
          <Field label={flagged ? 'How was the discrepancy resolved? (required, min 10 characters)' : 'Verification note (optional)'}>
            <textarea className="input" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </Field>
          <div className="mt-3 flex justify-end gap-2">
            {d.status !== 'Under Investigation' && <Button variant="danger" icon={<SearchCheck className="h-4 w-4" />} onClick={investigate} loading={busy}>Open investigation</Button>}
            <Button variant="success" icon={<CheckCircle2 className="h-4 w-4" />} onClick={verify} loading={busy} disabled={flagged && notes.trim().length < 10}>Verify delivery</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
};
