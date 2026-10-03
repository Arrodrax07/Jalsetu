/** Side sheet for one community: numbers, the evidence behind its crisis score, and where the data came from. */
import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import { CloudRain, Crosshair, ExternalLink, MapPin, Newspaper, Route } from './icons';
import { useApp } from '../context/AppContext';
import { districtName, litres, timeAgo } from '../utils/format';
import { Button, Chip, CountUp, EASE, KV, SlideOver, StatusChip } from './ui';
import { MAP_COLORS } from './map/OpsMap';

/** Boundary names carry transliteration marks ("Mahārāshtra"); show the everyday spelling. */
const plain = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const Gauge: React.FC<{ value: number }> = ({ value }) => {
  const r = 52, c = Math.PI * r;
  const color = value >= 70 ? MAP_COLORS.critical : value >= 30 ? MAP_COLORS.high : MAP_COLORS.normal;
  return (
    <svg viewBox="0 0 120 70" className="w-40" aria-label={`Crisis score ${Math.round(value)} of 100`}>
      <path d="M8 62a52 52 0 0 1 104 0" fill="none" stroke="rgb(var(--cc-hover))" strokeWidth="10" strokeLinecap="round" />
      <motion.path d="M8 62a52 52 0 0 1 104 0" fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" strokeDasharray={c}
        initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - Math.min(100, value) / 100) }} transition={{ duration: 1.1, ease: EASE }} />
    </svg>
  );
};

type SheetProps = { id: string | null; onClose: () => void; onFocus?: (lat: number, lng: number) => void };

export const communitySubtitle = (c: { settlementType?: string | null; districtName: string | null; stateName: string | null }) =>
  [c.settlementType && c.settlementType[0].toUpperCase() + c.settlementType.slice(1), c.districtName && `${districtName(c.districtName)} district`, plain(c.stateName)].filter(Boolean).join(' · ');

export const CommunitySheet: React.FC<SheetProps> = (props) => {
  const { communities } = useApp();
  const c = communities.find(x => x.id === props.id) || null;
  return (
    <SlideOver open={!!c} onClose={props.onClose} width="max-w-lg" title={c?.name ?? ''} subtitle={c ? communitySubtitle(c) : null}>
      <CommunityDetail {...props} />
    </SlideOver>
  );
};

/** One community: the numbers, the evidence behind its crisis score, and where the data came from. */
export const CommunityDetail: React.FC<SheetProps> = ({ id, onClose, onFocus }) => {
  const { communities, signals, navigate, can } = useApp();
  const c = communities.find(x => x.id === id) || null;
  const evidence = useMemo(() => !c ? [] : signals.filter(s => s.status !== 'dismissed' && (s.communities.some(x => x.id === c.id) || s.districts.some(d => d.id === c.districtId)))
    .sort((a, b) => Number(b.communities.some(x => x.id === c.id)) - Number(a.communities.some(x => x.id === c.id))), [c, signals]);

  return (
    <>
      {c && (
        <div className="space-y-6">
          <div className="flex items-center gap-5 rounded-2xl border border-cc-border bg-cc-raised p-4">
            <div className="relative">
              <Gauge value={c.crisisScore ?? 0} />
              <p className="display absolute inset-x-0 bottom-0 text-center text-3xl leading-none"><CountUp value={c.crisisScore ?? 0} /></p>
            </div>
            <div className="min-w-0 flex-1">
              <p className="eyebrow">Live crisis score</p>
              <div className="mt-1.5"><StatusChip status={c.status} /></div>
              <p className="mt-2 text-xs leading-relaxed text-cc-muted">From measured rainfall deficit and news reports naming this place or its district. 30+ is high demand, 70+ critical.</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[{ k: 'Population', v: c.population }, { k: 'Priority', v: c.priorityScore, s: '/100' }, { k: 'Coverage', v: c.currentCoverage, s: '%' }].map(x => (
              <div key={x.k} className="rounded-xl border border-cc-border p-3">
                <p className="text-[11px] text-cc-muted">{x.k}</p>
                <p className="display mt-0.5 text-2xl leading-none"><CountUp value={x.v} />{x.s && <span className="text-base text-cc-faint">{x.s}</span>}</p>
              </div>
            ))}
          </div>

          <section>
            <p className="eyebrow mb-2">Water balance (litres / day)</p>
            <KV k="Daily need" v={litres(c.dailyDemand)} />
            <KV k={<span>Piped supply <Chip tone="estimated">estimate</Chip></span>} v={litres(c.baselineSupply ?? 0)} />
            <KV k="Tanker allocation" v={litres(c.allocatedWater)} />
            <KV k="Shortfall" v={<span className={c.shortfall > 0 ? 'text-red-700' : ''}>{litres(c.shortfall)}</span>} />
            {c.demandBasis && <p className="mt-2 text-[11.5px] leading-relaxed text-cc-muted">Need = {c.demandBasis}.</p>}
            {c.waterAccessKm != null && <KV k={<span>Nearest water source <Chip tone="estimated">straight line</Chip></span>} v={`${c.waterAccessKm.toFixed(1)} km`} />}
            {c.waterAccessNote && <p className="mt-1 text-[11.5px] leading-relaxed text-cc-muted">{c.waterAccessNote}. Farther from any source = fewer fallbacks, so it raises priority.</p>}
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between"><p className="eyebrow">Evidence ({evidence.length})</p>
              {evidence.some(s => s.status === 'unverified') && <Chip tone="warn">includes unverified news</Chip>}</div>
            {evidence.length === 0 ? <p className="text-sm text-cc-muted">No active crisis signals for this place or its district.</p> : (
              <ul className="space-y-2">
                {evidence.slice(0, 8).map((s, i) => {
                  const direct = s.communities.some(x => x.id === c.id);
                  return (
                    <motion.li key={s.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.04, duration: 0.35, ease: EASE }}>
                      <a href={s.url} target="_blank" rel="noreferrer noopener" className="group block rounded-xl border border-cc-border p-3 transition hover:border-cc-strong hover:shadow-lift">
                        <div className="flex items-center gap-1.5 text-[11px] text-cc-muted">
                          {s.kind === 'news' ? <Newspaper className="h-3.5 w-3.5 text-cc-accent" /> : <CloudRain className="h-3.5 w-3.5 text-cc-accent" />}
                          <span className="truncate">{s.publisher}</span><span>·</span><span>{timeAgo(s.publishedAt)}</span>
                          <span className="ml-auto">{direct ? <Chip tone="danger">names this place</Chip> : <Chip>district-wide</Chip>}</span>
                        </div>
                        <p className="mt-1.5 text-sm leading-snug group-hover:text-cc-accent-strong">{s.title} <ExternalLink className="inline h-3 w-3 opacity-40" /></p>
                      </a>
                    </motion.li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="rounded-xl bg-cc-raised p-3 text-[11.5px] leading-relaxed text-cc-muted">
            <p className="flex items-center gap-1.5 font-medium text-cc-text"><MapPin className="h-3.5 w-3.5" /> Source</p>
            <p className="mt-1">{c.source ?? 'Entered by staff'}{c.sourceUrl && <> · <a className="text-cc-accent underline underline-offset-2" href={c.sourceUrl} target="_blank" rel="noreferrer noopener">view record</a></>}</p>
            <p className="mt-1">Vulnerability {c.vulnerabilityScore}/100 is a settlement-type baseline until socio-economic data is attached.</p>
          </section>

          <div className="flex gap-2">
            <Button className="flex-1" icon={<Crosshair className="h-4 w-4" />} onClick={() => onFocus?.(c.lat, c.lng)}>Focus on map</Button>
            {can('dispatch') && <Button variant="primary" className="flex-1" icon={<Route className="h-4 w-4" />} onClick={() => { onClose(); navigate('trips'); }}>Plan trips</Button>}
          </div>
        </div>
      )}
    </>
  );
};
