import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Download } from '../components/icons';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { Button, PageHeader } from '../components/ui';
import { DUR, EASE_OUT } from '../motion';

type Kind = 'trips' | 'deliveries' | 'requests' | 'complaints' | 'communities' | 'allocation';
const GROUPS: { group: string; rows: { kind: Kind; title: string; desc: string; cols: string }[] }[] = [
  { group: 'Operations', rows: [
    { kind: 'trips', title: 'Trips', desc: 'Every trip with real start, arrival and completion times, planned km and GPS km travelled.', cols: 'trip · vehicle · driver · status · stops · started/arrived/completed · planned km · GPS km' },
    { kind: 'deliveries', title: 'Proof of delivery', desc: 'Deliveries with volume variance, distance from the destination when recorded, and who verified them.', cols: 'tanker · community · allocated/delivered L · variance · geofence m · GPS OK · verified by' },
  ] },
  { group: 'Demand', rows: [
    { kind: 'requests', title: 'Water requests', desc: 'Requests with priority, status and contact.', cols: 'community · litres · urgency · priority · status · days without water · contact' },
    { kind: 'communities', title: 'Communities', desc: 'Population, demand, allocation, coverage and shortfall, vulnerability, priority and status.', cols: 'community · ward · population · demand/allocated L · coverage % · shortfall · last delivery' },
    { kind: 'allocation', title: 'Latest allocation plan', desc: 'Recommended quotas with floors and the written justification.', cols: 'community · demand · previous · survival floor · recommended L · justification' },
  ] },
  { group: 'Grievances', rows: [
    { kind: 'complaints', title: 'Complaints', desc: 'Complaints with model category and confidence, severity, duplicates and status.', cols: 'community · category · confidence · severity · status · duplicate of · source' },
  ] },
];

const Row: React.FC<{ r: (typeof GROUPS)[number]['rows'][number] }> = ({ r }) => {
  const { fail } = useApp();
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const run = async () => {
    setState('busy');
    try { await api.downloadReport(r.kind); setState('done'); setTimeout(() => setState('idle'), 2400); }
    catch (x) { fail(x, 'Export failed'); setState('idle'); }
  };
  return (
    <li className="grid items-center gap-x-6 gap-y-2 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[14rem_minmax(0,1fr)_auto]">
      <p className="text-[14px] font-medium text-cc-text">{r.title}</p>
      <div className="min-w-0 sm:col-start-1 lg:col-start-auto">
        <p className="text-[13px] text-cc-muted">{r.desc}</p>
        <p className="mono mt-0.5 truncate text-[11.5px] text-cc-faint">{r.cols}</p>
      </div>
      <div className="sm:col-start-2 sm:row-span-2 sm:row-start-1 lg:col-start-3 lg:row-span-1">
        <Button size="sm" onClick={run} loading={state === 'busy'} aria-label={`Download ${r.title} CSV`} className="w-[8.5rem]"
          icon={state === 'done' ? undefined : <Download className="h-4 w-4" />}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={state === 'done' ? 'done' : 'idle'} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              transition={{ duration: DUR.quick, ease: EASE_OUT }} className="inline-flex items-center gap-1.5">
              {state === 'done' ? <><Check className="h-4 w-4 text-cc-ok" aria-hidden />Downloaded</> : 'Download CSV'}
            </motion.span>
          </AnimatePresence>
        </Button>
      </div>
    </li>
  );
};

export const Reports: React.FC = () => {
  const { can } = useApp();
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Reports" subtitle="CSV exports built on the server from the live database at the moment you download them. UTF-8, opens in Excel; times are in UTC." />
      {!can('export_reports') ? <p className="text-sm text-cc-muted">Your role cannot export reports.</p> : (
        <div className="panel max-w-5xl px-5 py-2">
          {GROUPS.map((g, gi) => (
            <section key={g.group} aria-labelledby={`rg-${gi}`} className={gi ? 'border-t border-cc-border pt-3' : 'pt-1'}>
              <h2 id={`rg-${gi}`} className="pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-cc-faint">{g.group}</h2>
              <ul className="divide-y divide-cc-border/70">{g.rows.map(r => <Row key={r.kind} r={r} />)}</ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};
