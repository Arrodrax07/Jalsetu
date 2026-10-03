import React, { useState } from 'react';
import { Download, FileSpreadsheet } from '../components/icons';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { Button, PageHeader } from '../components/ui';

const EXPORTS = [
  { kind: 'trips', title: 'Trips', desc: 'Every trip with real start/arrival/completion times, planned km and GPS km travelled.' },
  { kind: 'deliveries', title: 'Proof of delivery', desc: 'Deliveries with variance, GPS distance at recording, receiver and verification.' },
  { kind: 'requests', title: 'Water requests', desc: 'Requests with priority, status and contact.' },
  { kind: 'complaints', title: 'Grievances', desc: 'Complaints with model category/confidence, severity, duplicates and status.' },
  { kind: 'communities', title: 'Communities', desc: 'Demand, allocation, coverage, priority, status (with record origin).' },
  { kind: 'allocation', title: 'Latest allocation plan', desc: 'Recommended quotas with floors and written justification.' },
] as const;

export const Reports: React.FC = () => {
  const { fail, can } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Reports" subtitle="CSV exports generated on the server from the live database (UTF-8; opens in Excel). Times are UTC in exports." />
      {!can('export_reports') ? <p className="text-sm text-cc-muted">Your role cannot export reports.</p> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {EXPORTS.map(e => (
            <div key={e.kind} className="panel flex flex-col p-4">
              <FileSpreadsheet className="mb-2 h-5 w-5 text-cc-accent" aria-hidden />
              <p className="text-sm font-semibold">{e.title}</p>
              <p className="mt-1 flex-1 text-xs text-cc-muted">{e.desc}</p>
              <Button className="mt-3" icon={<Download className="h-4 w-4" />} loading={busy === e.kind}
                onClick={async () => { setBusy(e.kind); try { await api.downloadReport(e.kind as any); } catch (x) { fail(x, 'Export failed'); } setBusy(null); }}>Download CSV</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
