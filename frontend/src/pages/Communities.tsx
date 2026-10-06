import React, { useEffect, useState } from 'react';
import { Crosshair, Map as MapIcon, Pencil, Plus, Warehouse } from '../components/icons';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { MAP_COLORS, OpsMap } from '../components/map/OpsMap';
import { Button, Chip, Dialog, Field, KindLabel, KV, Loading, OriginLabel, PageHeader, SlideOver, StatusChip } from '../components/ui';
import { DataTable } from '../components/DataTable';
import type { Community } from '../types';
import { districtName, litres, timeAgo } from '../utils/format';

export const Communities: React.FC = () => {
  const { communities, depots, can } = useApp();
  const [sel, setSel] = useState<Community | null>(null);
  const [edit, setEdit] = useState<Community | 'new' | null>(null);
  const [depotOpen, setDepotOpen] = useState(false);
  return (
    <div className="p-4 lg:p-8">
      <PageHeader eyebrow="Demand" title="Communities" subtitle={`${communities.length.toLocaleString('en-IN')} ${communities.some(c => c.level === 'area') ? 'places (towns, villages and areas within cities)' : 'towns and villages'} with real populations (OpenStreetMap / Census; area populations are estimates). Coverage, status and priority are computed live from supply, deliveries and crisis signals.`}
        actions={can('manage_master_data') && <>
          <Button icon={<Warehouse className="h-4 w-4" />} onClick={() => setDepotOpen(true)}>Add depot</Button>
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>Add community</Button>
        </>} />
      <DataTable label="Communities" rows={communities} rowKey={c => c.id} onRowClick={setSel} selectedKey={sel?.id} pageSize={50}
        filters={[
          { id: 'all', label: 'All', test: () => true },
          { id: 'Critical', label: 'Critical', test: c => c.status === 'Critical' },
          { id: 'High Demand', label: 'High demand', test: c => c.status === 'High Demand' },
          { id: 'Normal', label: 'Normal', test: c => c.status === 'Normal' || c.status === 'Recently Served' },
        ]}
        defaultSort={{ id: 'crisis', dir: 'desc' }}
        search={c => `${c.name} ${c.ward} ${c.districtName} ${districtName(c.districtName)} ${c.stateName}`} searchPlaceholder="Search town, village or district"
        emptyTitle="No communities match"
        columns={[
          { id: 'name', header: 'Place', sort: c => c.name, cell: c => <><span className="font-medium">{c.name}</span><div className="text-[11.5px] text-cc-faint">{c.level === 'area' && c.parentName ? `Area of ${c.parentName}` : <span className="capitalize">{c.settlementType || c.ward}</span>}</div></> },
          { id: 'district', header: 'District', sort: c => districtName(c.districtName), hideBelow: 'md', cell: c => <span className="text-cc-muted">{districtName(c.districtName) || '—'}</span> },
          { id: 'pop', header: 'Population', align: 'right', sort: c => c.population, cell: c => <span className="mono">{c.population.toLocaleString('en-IN')}</span> },
          { id: 'crisis', header: 'Crisis signals', sort: c => c.crisisScore ?? 0, cell: c => { const cs = c.crisisScore ?? 0; return (
            <div className="flex items-center gap-2"><div className="h-1.5 w-16 overflow-hidden rounded-full bg-cc-hover"><div className="h-full rounded-full" style={{ width: `${cs}%`, background: cs >= 70 ? MAP_COLORS.critical : cs >= 30 ? MAP_COLORS.high : MAP_COLORS.normal }} /></div><span className="mono w-7 text-[12px]">{cs}</span></div>); } },
          { id: 'access', header: 'To water', align: 'right', sort: c => c.waterAccessKm ?? -1, hideBelow: 'xl', cell: c => <span className="mono text-cc-muted" title={c.waterAccessNote ?? undefined}>{c.waterAccessKm != null ? `${c.waterAccessKm.toFixed(1)} km` : '—'}</span> },
          { id: 'short', header: 'Shortfall / day', align: 'right', sort: c => c.shortfall, hideBelow: 'lg', cell: c => <span className="mono whitespace-nowrap">{litres(c.shortfall)}</span> },
          { id: 'cov', header: 'Coverage', align: 'right', sort: c => c.currentCoverage, hideBelow: 'lg', cell: c => <span className="mono text-cc-muted">{c.currentCoverage}%</span> },
          { id: 'status', header: 'Status', sort: c => c.status, cell: c => <StatusChip status={c.status} /> },
          { id: 'origin', header: 'Source', hideBelow: 'xl', cell: c => <OriginLabel origin={c.dataOrigin} /> },
        ]} />
      <p className="mt-3 text-[11px] text-cc-faint">Depots: {depots.map(d => `${d.name}${d.dataOrigin === 'seeded' ? ' (reference)' : ''}`).join(' · ') || 'none'}</p>
      {sel && <CommunityDetail c={sel} onClose={() => setSel(null)} onEdit={can('manage_master_data') ? () => { setEdit(sel); setSel(null); } : undefined} />}
      {edit && <CommunityForm initial={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {depotOpen && <DepotForm onClose={() => setDepotOpen(false)} />}
    </div>
  );
};

const CommunityDetail: React.FC<{ c: Community; onClose: () => void; onEdit?: () => void }> = ({ c, onClose, onEdit }) => {
  const { navigate } = useApp();
  const [fc, setFc] = useState<{ weatherSource: string; days: any[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.communityForecast(c.id).then(setFc).catch(e => setErr(e.message)); }, [c.id]);
  return (
    <SlideOver open onClose={onClose} title={c.name} subtitle={`${districtName(c.districtName) || 'District unknown'} district${c.stateName ? `, ${c.stateName}` : ''}`} width="max-w-lg">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2"><OriginLabel origin={c.dataOrigin} />
          <Button size="sm" icon={<MapIcon className="h-3.5 w-3.5" />} onClick={() => navigate(`overview/${c.id}`)}>Crisis evidence on map</Button>
          {onEdit && <Button size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={onEdit}>Edit</Button>}</div>
        {c.dataOrigin === 'seeded' && <p className="text-xs text-violet-700">Reference record for demonstration and testing. Population and demand values are not official statistics.</p>}
        <div>
          <KV k="Coordinates" v={<span className="num">{c.lat.toFixed(5)}, {c.lng.toFixed(5)}</span>} />
          <KV k="Population (recorded)" v={<span className="num">{c.population.toLocaleString('en-IN')}</span>} />
          <KV k="Baseline demand" v={<span className="num">{litres(c.dailyDemand)}/day</span>} />
          <KV k="Allocated" v={<span className="num">{litres(c.allocatedWater)} ({c.currentCoverage}%)</span>} />
          <KV k="Vulnerability score" v={<span className="num">{c.vulnerabilityScore}/100 ({c.vulnerability})</span>} />
          <KV k="Open complaints" v={c.openComplaints} />
          <KV k="Last delivery" v={timeAgo(c.lastDelivery)} />
          {c.contactOfficer && <KV k="Contact officer" v={`${c.contactOfficer} ${c.officerPhone}`} />}
        </div>
        <div className="rounded-lg border border-cc-border p-3">
          <div className="mb-2 flex items-center justify-between"><p className="text-sm font-semibold">7-day demand forecast</p><KindLabel kind="predicted" title="Advisory only; not used by allocation unless explicitly selected" /></div>
          {err ? <p className="text-xs text-cc-muted">{err}</p> : !fc ? <Loading /> : (
            <>
              <div className="grid grid-cols-7 gap-1 text-center">{fc.days.map((d: any) => (
                <div key={d.date} className="rounded bg-cc-raised p-1"><p className="text-2xs text-cc-muted">{new Date(d.date).toLocaleDateString('en-IN', { weekday: 'short' })}</p>
                  <p className="num text-xs font-semibold">{Math.round(d.litres_p50 / 1000)}k</p><p className="text-[10px] text-cc-faint">{d.temp_max}°</p></div>))}</div>
              <p className="mt-2 text-2xs text-cc-faint">Weather: {fc.weatherSource}. Demand response learned from a documented simulation driven by real weather; needs real metered observations before production use.</p>
            </>
          )}
        </div>
      </div>
    </SlideOver>
  );
};

const CommunityForm: React.FC<{ initial: Community | null; onClose: () => void }> = ({ initial, onClose }) => {
  const { refresh, fail, toast, communities, depots } = useApp();
  const [f, setF] = useState({
    name: initial?.name || '', ward: initial?.ward || '', population: initial?.population || 1000, dailyDemand: initial?.dailyDemand || 10000,
    allocatedWater: initial?.allocatedWater || 0, vulnerabilityScore: initial?.vulnerabilityScore ?? 50,
    lat: initial?.lat ?? NaN, lng: initial?.lng ?? NaN, contactOfficer: initial?.contactOfficer || '', officerPhone: initial?.officerPhone || '',
  });
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [where, setWhere] = useState<string | null>(null);
  const hasPos = Number.isFinite(f.lat) && Number.isFinite(f.lng);
  const set = (k: keyof typeof f, v: string) => setF(s => ({ ...s, [k]: typeof s[k] === 'number' ? Number(v) : v }));
  const useDevice = () => {
    setLocating(true);
    navigator.geolocation?.getCurrentPosition(p => { setF(s => ({ ...s, lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) })); setWhere(`Device GPS ± ${Math.round(p.coords.accuracy)} m`); setLocating(false); },
      e => { fail(new Error(e.message || 'Location unavailable')); setLocating(false); }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  };
  const submit = async () => {
    setBusy(true);
    try {
      if (initial) await api.updateCommunity(initial.id, f); else await api.createCommunity(f);
      toast(initial ? 'Community updated' : 'Community added', f.name, 'success');
      await refresh('communities', 'overview');
      onClose();
    } catch (e) { fail(e, 'Could not save'); }
    setBusy(false);
  };
  return (
    <Dialog open onClose={onClose} title={initial ? `Edit ${initial.name}` : 'Add community'} subtitle="Click the map, enter coordinates, or use this device's location. District/state are assigned from boundaries on save." wide>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" className="col-span-2"><input className="input" value={f.name} onChange={e => set('name', e.target.value)} /></Field>
          <Field label="Ward / locality" className="col-span-2"><input className="input" value={f.ward} onChange={e => set('ward', e.target.value)} /></Field>
          <Field label="Latitude"><input className="input num" type="number" step="any" value={Number.isFinite(f.lat) ? f.lat : ''} onChange={e => set('lat', e.target.value)} /></Field>
          <Field label="Longitude"><input className="input num" type="number" step="any" value={Number.isFinite(f.lng) ? f.lng : ''} onChange={e => set('lng', e.target.value)} /></Field>
          <div className="col-span-2 flex items-center gap-2"><Button size="sm" icon={<Crosshair className="h-3.5 w-3.5" />} loading={locating} onClick={useDevice}>Use this device's location</Button>{where && <Chip tone="ok">{where}</Chip>}</div>
          <Field label="Population (recorded)"><input className="input" type="number" min={1} value={f.population} onChange={e => set('population', e.target.value)} /></Field>
          <Field label="Baseline demand (L/day)"><input className="input" type="number" min={1} value={f.dailyDemand} onChange={e => set('dailyDemand', e.target.value)} /></Field>
          <Field label="Current allocation (L/day)"><input className="input" type="number" min={0} value={f.allocatedWater} onChange={e => set('allocatedWater', e.target.value)} /></Field>
          <Field label="Vulnerability (0–100)" hint="From census / survey"><input className="input" type="number" min={0} max={100} value={f.vulnerabilityScore} onChange={e => set('vulnerabilityScore', e.target.value)} /></Field>
          <Field label="Contact officer"><input className="input" value={f.contactOfficer} onChange={e => set('contactOfficer', e.target.value)} /></Field>
          <Field label="Officer phone"><input className="input" value={f.officerPhone} onChange={e => set('officerPhone', e.target.value)} /></Field>
        </div>
        <div className="h-[420px] overflow-hidden rounded-lg border border-cc-border">
          <OpsMap vehicles={[]} communities={[...communities.filter(c => c.id !== initial?.id),
            ...(hasPos ? [{ ...(initial || {}), id: '__new', name: f.name || 'New', lat: f.lat, lng: f.lng, status: 'Normal', dataOrigin: 'manual' } as unknown as Community] : [])]}
            depots={depots} onMapClick={(lat, lng) => { setF(s => ({ ...s, lat: +lat.toFixed(6), lng: +lng.toFixed(6) })); setWhere('Picked on map'); }}
            fit={hasPos ? { center: [f.lat, f.lng], zoom: 15, key: initial?.id || 'new' } : null} />
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!f.name || !f.ward || !hasPos} onClick={submit}>Save</Button></div>
    </Dialog>
  );
};

const DepotForm: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { refresh, fail, toast } = useApp();
  const [f, setF] = useState({ name: '', lat: NaN, lng: NaN });
  const ok = f.name.length >= 2 && Number.isFinite(f.lat) && Number.isFinite(f.lng);
  return (
    <Dialog open onClose={onClose} title="Add depot" subtitle="Filling station / yard where tankers load.">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" className="col-span-2"><input className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Latitude"><input className="input" type="number" step="any" onChange={e => setF({ ...f, lat: Number(e.target.value) })} /></Field>
        <Field label="Longitude"><input className="input" type="number" step="any" onChange={e => setF({ ...f, lng: Number(e.target.value) })} /></Field>
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!ok} onClick={async () => { try { await api.createDepot(f); toast('Depot added', f.name, 'success'); refresh('depots'); onClose(); } catch (e) { fail(e); } }}>Save</Button></div>
    </Dialog>
  );
};
