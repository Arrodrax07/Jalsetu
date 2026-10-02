import React, { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApp, useNow } from '../context/AppContext';
import { api } from '../services/api';
import { AlertPanel } from '../components/panels';
import { Button, Chip, Empty, KindLabel, PageHeader, Panel, SeverityChip, StatusChip } from '../components/ui';
import { dt, timeAgo } from '../utils/format';

const SEV: Record<string, number> = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 };
const TYPE_LABEL = (t: string) => t.replace(/_/g, ' ');

export const Disasters: React.FC = () => {
  const { disasters, health, can, fail, toast, serverOffsetMs } = useApp();
  const now = useNow(serverOffsetMs, 10000);
  const [sel, setSel] = useState<number | null>(null);
  const [type, setType] = useState('all');
  const [minSev, setMinSev] = useState(0);
  const types = useMemo(() => [...new Set(disasters.map(d => d.eventType))].sort(), [disasters]);
  const rows = disasters.filter(d => (type === 'all' || d.eventType === type) && SEV[d.severity] >= minSev)
    .sort((a, b) => SEV[b.severity] - SEV[a.severity] || Date.parse(b.publishedAt || '') - Date.parse(a.publishedAt || ''));
  const feeds = (health?.sources || []).filter(s => ['ndma_sachet', 'imd_api', 'cwc_flood', 'data_gov_in', 'geoboundaries'].includes(s.key));
  const sachet = feeds.find(s => s.key === 'ndma_sachet');

  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Disaster intelligence"
        subtitle="Official alerts exactly as published by the issuing authority (via NDMA SACHET, CAP 1.2). JalSetu never decides whether an event exists; it only computes impact on its own records."
        actions={<>
          <KindLabel kind="external-alert" />
          {can('run_ingestion') && <Button icon={<RefreshCw className="h-4 w-4" />} onClick={async () => { try { await api.runIngestion('ndma_sachet'); toast('Sync started', 'Fetching SACHET alerts now.', 'info'); } catch (e) { fail(e); } }}>Sync now</Button>}
        </>} />

      <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {feeds.map(s => (
          <div key={s.key} className="panel p-3">
            <div className="flex items-center justify-between gap-2"><p className="truncate text-xs font-medium">{s.name}</p><StatusChip status={s.status} /></div>
            <p className="mt-1 text-2xs text-cc-muted">{s.lastSuccessAt ? `synced ${timeAgo(s.lastSuccessAt, now)}` : 'never synced'}</p>
            {s.lastError && <p className="mt-1 line-clamp-2 text-2xs text-cc-faint" title={s.lastError}>{s.lastError}</p>}
          </div>
        ))}
      </div>

      {sachet && sachet.status !== 'connected' && (
        <p className="mb-3 rounded-lg border border-cc-warn/40 bg-cc-warn/10 p-3 text-sm text-amber-100">
          Alert feed is <b>{sachet.status}</b>. The list below may be incomplete; absence of alerts is not confirmation that none are active.
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className="input w-auto" value={type} onChange={e => setType(e.target.value)} aria-label="Hazard type">
          <option value="all">All hazards</option>{types.map(t => <option key={t} value={t}>{TYPE_LABEL(t)}</option>)}
        </select>
        <select className="input w-auto" value={minSev} onChange={e => setMinSev(Number(e.target.value))} aria-label="Minimum severity">
          <option value={0}>Any severity</option><option value={2}>Moderate +</option><option value={3}>Severe +</option><option value={4}>Extreme</option>
        </select>
        <span className="text-xs text-cc-muted">{rows.length} active alert(s)</span>
      </div>

      <Panel bodyClassName="overflow-x-auto">
        {rows.length === 0 ? <Empty title="No active alerts match" /> : (
          <table className="table-cc">
            <thead><tr><th>Severity</th><th>Hazard</th><th>Area</th><th>Issuer</th><th>Onset</th><th>Expires</th><th>Area data</th><th>Published</th></tr></thead>
            <tbody>{rows.map(d => (
              <tr key={d.id} className="cursor-pointer" onClick={() => setSel(d.id)}>
                <td><SeverityChip severity={d.severity} /></td>
                <td className="capitalize">{TYPE_LABEL(d.eventType)}<div className="text-2xs text-cc-faint">{d.eventRaw}</div></td>
                <td className="max-w-md"><p className="line-clamp-2">{d.areaDesc}</p></td>
                <td className="text-cc-muted">{d.provider}</td>
                <td className="num text-cc-muted">{dt(d.onsetAt)}</td>
                <td className="num text-cc-muted">{dt(d.expiresAt)}</td>
                <td>{d.geometryStatus === 'ok' ? <Chip tone="external">Official polygon</Chip> : d.geometryStatus === 'district_names' ? <Chip tone="estimated">District match</Chip> : <Chip>None</Chip>}</td>
                <td className="num text-cc-muted">{timeAgo(d.publishedAt, now)}</td>
              </tr>))}</tbody>
          </table>
        )}
      </Panel>
      <AlertPanel id={sel} onClose={() => setSel(null)} />
    </div>
  );
};
