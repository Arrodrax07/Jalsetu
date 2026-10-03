/** Live crisis signals: news reports and measured rainfall deficit, with operator review. */
import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CloudRain, ExternalLink, Newspaper, RefreshCw, XCircle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import type { CrisisSignal } from '../types';
import { timeAgo } from '../utils/format';
import { Button, Chip, cx, Empty } from './ui';

const SEV_TONE = { Severe: 'danger', Moderate: 'warn', Minor: 'accent' } as const;
const STATUS_TONE = { unverified: 'neutral', confirmed: 'ok', dismissed: 'neutral' } as const;

export const CrisisSignals: React.FC<{ onPlace?: (communityId: string) => void; compact?: boolean }> = ({ onPlace, compact }) => {
  const { signals, loaded, refresh, can, toast, fail } = useApp();
  const [filter, setFilter] = useState<'all' | 'news' | 'rainfall_deficit'>('all');
  const [busy, setBusy] = useState<number | 'refresh' | null>(null);
  useEffect(() => { if (!loaded.has('signals')) refresh('signals'); }, [loaded, refresh]);

  const rows = useMemo(() => signals.filter(s => s.status !== 'dismissed' && (filter === 'all' || s.kind === filter)), [signals, filter]);
  const counts = useMemo(() => ({
    news: signals.filter(s => s.kind === 'news' && s.status !== 'dismissed').length,
    rain: signals.filter(s => s.kind === 'rainfall_deficit' && s.status !== 'dismissed').length,
    unverified: signals.filter(s => s.kind === 'news' && s.status === 'unverified').length,
  }), [signals]);

  const review = async (s: CrisisSignal, status: CrisisSignal['status']) => {
    setBusy(s.id);
    try { await api.reviewSignal(s.id, status); await refresh('signals', 'communities'); }
    catch (e) { fail(e, 'Could not update signal'); }
    finally { setBusy(null); }
  };
  const pull = async () => {
    setBusy('refresh');
    try {
      const r = await api.refreshCrisis();
      toast('Signals refreshed', `${r.news.created} new news report(s); ${r.inCrisis} communities in crisis`, 'success');
      await refresh('signals', 'communities');
    } catch (e) { fail(e, 'Refresh failed'); }
    finally { setBusy(null); }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-cc-border px-3 py-2 text-2xs">
        {(['all', 'news', 'rainfall_deficit'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={cx('rounded-md px-2 py-1 font-semibold', filter === f ? 'bg-cc-accent/20 text-cc-accent' : 'text-cc-muted hover:text-cc-text')}>
            {f === 'all' ? `All (${counts.news + counts.rain})` : f === 'news' ? `News (${counts.news})` : `Rainfall (${counts.rain})`}
          </button>
        ))}
        {counts.unverified > 0 && <Chip tone="warn">{counts.unverified} to review</Chip>}
        {can('run_ingestion') && (
          <Button size="sm" variant="ghost" className="ml-auto" loading={busy === 'refresh'} icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={pull}>Refresh</Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!loaded.has('signals') ? <Empty title="Loading signals…" /> : rows.length === 0
          ? <Empty title="No active crisis signals" hint="News reports and rainfall deficits matched to Maharashtra places appear here." />
          : (
            <ul className="divide-y divide-cc-border">
              {rows.slice(0, compact ? 60 : 300).map(s => (
                <li key={s.id} className="px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    {s.kind === 'news' ? <Newspaper className="h-3.5 w-3.5 text-sky-700" aria-label="News" /> : <CloudRain className="h-3.5 w-3.5 text-cyan-700" aria-label="Rainfall" />}
                    <Chip tone={SEV_TONE[s.severity]}>{s.severity}</Chip>
                    {s.kind === 'news' && <Chip tone={STATUS_TONE[s.status]} icon={s.status === 'confirmed' ? <CheckCircle2 className="h-3 w-3" /> : undefined}>{s.status}</Chip>}
                    <span className="ml-auto whitespace-nowrap text-2xs text-cc-faint">{timeAgo(s.publishedAt)}</span>
                  </div>
                  <a href={s.url} target="_blank" rel="noreferrer noopener" className="group mt-1 block text-sm leading-snug text-cc-text hover:text-sky-700">
                    {s.title} <ExternalLink className="inline h-3 w-3 opacity-50 group-hover:opacity-100" aria-hidden />
                  </a>
                  <p className="mt-0.5 truncate text-2xs text-cc-muted">{s.publisher}{s.metric != null ? ` · ${s.metric > 0 ? '+' : ''}${s.metric}% vs 10-yr mean` : ''}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {s.communities.slice(0, 4).map(c => (
                      <button key={c.id} onClick={() => onPlace?.(c.id)} className="rounded bg-cc-danger/15 px-1.5 py-0.5 text-2xs font-medium text-red-700 ring-1 ring-cc-danger/30 hover:bg-cc-danger/25">{c.name}</button>
                    ))}
                    {s.districts.slice(0, s.regionOnly ? 3 : 4).map(d => (
                      <span key={d.id} className="rounded bg-cc-raised px-1.5 py-0.5 text-2xs text-cc-muted ring-1 ring-cc-border">{d.name} district</span>
                    ))}
                    {s.regionOnly && <span className="rounded px-1 py-0.5 text-2xs text-cc-faint">{s.matchedTerms.map(t => t.term).join(', ')} region (counts half)</span>}
                  </div>
                  {s.kind === 'news' && can('acknowledge') && (
                    <div className="mt-1.5 flex gap-1">
                      {s.status !== 'confirmed' && <Button size="sm" variant="ghost" loading={busy === s.id} className="-ml-2 text-green-700" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => review(s, 'confirmed')}>Confirm</Button>}
                      <Button size="sm" variant="ghost" disabled={busy === s.id} className="text-cc-muted" icon={<XCircle className="h-3.5 w-3.5" />} onClick={() => review(s, 'dismissed')}>Not relevant</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  );
};
