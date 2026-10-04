/**
 * Public landing page: one continuous world (components/landing/World.tsx) that scroll travels through.
 *
 * The page is a tall scroll track behind a fixed stage. Scroll sets the story clock (landing/story.ts); the camera,
 * the scene's shaders, the type and the labels anchored in the world all read that one value. Nothing re-renders
 * React while scrolling: one animation-frame loop writes styles directly.
 *
 * Numbers on this page are live (GET /api/public/summary). The tanker run, the supply arcs and the national arcs are
 * illustrations of how JalSetu works and are labelled as such. Screen readers get the same story as plain sections;
 * without WebGL the page falls back to a static version of it.
 */
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight } from '../components/icons';
import { api } from '../services/api';
import type { PublicSummary } from '../types';
import { Mark } from '../components/shell/Shell';
import { cx } from '../components/ui';
import { districtName } from '../utils/format';
import { loadGeo, plain, project, type GeoFile, type Place } from '../components/landing/geo';
import { CHAPTERS, band, chapterAt, clock, phases, ramp } from '../components/landing/story';
import type { Anchors, Quality } from '../components/landing/World';

const World = React.lazy(() => import('../components/landing/World'));

const EnterContext = React.createContext<(() => void) | undefined>(undefined);
const EnterLink: React.FC<{ className?: string; children: React.ReactNode }> = ({ className, children }) => {
  const enter = React.useContext(EnterContext);
  return enter
    ? <button type="button" onClick={() => { window.scrollTo(0, 0); enter(); }} className={className}>{children}</button>
    : <a href="/login" className={className}>{children}</a>;
};

const num = (n: number) => n.toLocaleString('en-IN');
const millions = (n: number) => `${(n / 1e6).toFixed(1)}M`;
const istTime = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

function webglOk() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}
function pickQuality(): Quality {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const small = window.innerWidth < 900 || window.matchMedia('(pointer: coarse)').matches;
  const weak = (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4;
  return small || weak ? 'low' : 'high';
}

// ---------------------------------------------------------------------------- type layers
/** A text layer bound to a slice of one chapter (local progress a..b). The frame loop sets its opacity and depth. */
const Layer: React.FC<{ ch: number; a?: number; b?: number; className?: string; children?: React.ReactNode; depth?: number; first?: boolean }> =
  ({ ch, a = 0, b = 1, className, children, depth = 1, first }) => (
    <div data-ch={ch} data-a={a} data-b={b} data-depth={depth} data-first={first ? 1 : undefined}
      className={cx('pointer-events-none absolute opacity-0 will-change-[opacity,transform]', className)}>{children}</div>
  );

const Eyebrow: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <p className={cx('font-mono text-[11px] uppercase tracking-[0.22em] text-[#3d7486]', className)}>{children}</p>
);
const Illustration: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <span className="inline-flex items-center gap-1.5 rounded-[3px] border border-dashed border-[#3d7486]/50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[#2d6c7f]">
    Illustration{children ? <span className="normal-case tracking-normal text-[#6a7f88]">· {children}</span> : null}
  </span>
);
const Live: React.FC<{ at?: string }> = ({ at }) => (
  <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[#1f7a45]">
    <span className="h-1.5 w-1.5 rounded-full bg-[#22a35a]" />Live data{at ? <span className="text-[#6a7f88]"> · {at} IST</span> : null}
  </span>
);

const H = 'font-display font-semibold tracking-[-0.035em] [font-variation-settings:"wdth"_112]';

const Scatter: React.FC<{ text: string; className?: string }> = ({ text, className }) => (
  <span className={className} aria-hidden>
    {[...text].map((ch, i) => {
      const r = (k: number) => Math.sin((i + 1) * 12.9898 * k) * 43758.5453 % 1;
      return <span key={i} data-scatter={`${(r(1) * 260).toFixed(0)},${(r(2) * 140).toFixed(0)},${(r(3) * 50).toFixed(0)}`} className="inline-block will-change-transform">{ch}</span>;
    })}
  </span>
);

// ---------------------------------------------------------------------------- page
export const Landing: React.FC<{ onEnter?: () => void }> = ({ onEnter }) => {
  const [s, setS] = useState<PublicSummary | null>(null);
  const [geo, setGeo] = useState<GeoFile | null>(null);
  const [failed, setFailed] = useState(false);
  const [gl] = useState(webglOk);
  const [quality] = useState(pickQuality);
  const [focus, setFocus] = useState<{ focusName: string | null; focusDistrict: string | null; focusCrisis: number; focusPop: number } | null>(null);
  const [chapter, setChapter] = useState(0);
  const anchors = useRef<Anchors>({});
  const stage = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const truckText = useRef<HTMLSpanElement>(null);
  const numeral = useRef<HTMLSpanElement>(null);
  const reduce = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);

  useEffect(() => {
    api.publicSummary().then(setS).catch(() => setFailed(true));
    loadGeo().then(setGeo).catch(() => setFailed(true));
  }, []);

  // the landing page owns the document scroll; the app shell sets overflow on <html>/<body>
  useEffect(() => {
    const prev = [document.documentElement.style.overflowY, document.body.style.overflowY, document.documentElement.style.background];
    document.documentElement.style.overflowY = 'auto'; document.body.style.overflowY = 'visible';
    document.documentElement.style.background = '#eaf1f3';
    clock.reduce = reduce;
    return () => { [document.documentElement.style.overflowY, document.body.style.overflowY, document.documentElement.style.background] = prev; };
  }, [reduce]);

  // scroll -> story target
  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      clock.target = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); };
  }, []);

  // inertial wheel scrolling: mouse wheels move in steps, the journey should glide. Touch, keys and the scrollbar stay native.
  useEffect(() => {
    if (reduce || !window.matchMedia('(pointer: fine)').matches) return;
    let target = window.scrollY, current = window.scrollY, raf = 0, ours = false;
    const max = () => document.documentElement.scrollHeight - window.innerHeight;
    const step = () => {
      current += (target - current) * 0.085;
      if (Math.abs(target - current) < 0.4) current = target;
      ours = true; window.scrollTo(0, current);
      raf = current === target ? 0 : requestAnimationFrame(step);
    };
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.defaultPrevented) return;
      e.preventDefault();
      const d = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaMode === 2 ? e.deltaY * window.innerHeight : e.deltaY;
      target = Math.min(max(), Math.max(0, target + d));
      if (!raf) { current = window.scrollY; raf = requestAnimationFrame(step); }
    };
    const onScroll = () => { if (ours) { ours = false; return; } if (!raf) target = current = window.scrollY; };
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { cancelAnimationFrame(raf); window.removeEventListener('wheel', onWheel); window.removeEventListener('scroll', onScroll); };
  }, [reduce]);

  // one frame loop for all DOM layers (the WebGL world advances the clock; without it, this loop does)
  const worldDriving = gl && !failed;
  useEffect(() => {
    let raf = 0, last = performance.now(), lastCh = -1;
    const layers = () => Array.from(stage.current?.querySelectorAll<HTMLElement>('[data-ch]') ?? []);
    let els = layers(), scat = Array.from(stage.current?.querySelectorAll<HTMLElement>('[data-scatter]') ?? []);
    const mo = new MutationObserver(() => { els = layers(); scat = Array.from(stage.current?.querySelectorAll<HTMLElement>('[data-scatter]') ?? []); });
    if (stage.current) mo.observe(stage.current, { childList: true, subtree: true });
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (!worldDriving) clock.p += (clock.target - clock.p) * (1 - Math.exp(-dt * (reduce ? 14 : 4)));
      const p = clock.p;
      for (const el of els) {
        const c = CHAPTERS[+el.dataset.ch!];
        const lp = (p - c.start) / (c.end - c.start);
        const a = +el.dataset.a!, b = +el.dataset.b!, f = Math.min(0.18, (b - a) / 3);
        let o = band(lp, a, a + f, b - f, b);
        if (el.dataset.first && p < c.start + (c.end - c.start) * (a + f)) o = Math.max(o, 1 - ramp(lp, b - f, b));
        if (b >= 1 && +el.dataset.ch! === CHAPTERS.length - 1) o = ramp(lp, a, a + f);
        const depth = +el.dataset.depth!;
        const mid = (a + b) / 2;
        const z = (lp - mid) / Math.max(0.2, b - a);
        el.style.opacity = o.toFixed(3);
        el.style.transform = reduce ? 'none' : `translate3d(0, ${(-z * 46 * depth).toFixed(1)}px, 0) scale(${(1 + z * 0.045 * depth).toFixed(4)})`;
        el.style.filter = reduce || o > 0.98 ? 'none' : `blur(${((1 - o) * 5).toFixed(2)}px)`;
        el.style.visibility = o < 0.005 ? 'hidden' : 'visible';
      }
      // JalSetu letters converge as the network reorganises
      const conv = ramp(p, 0.225, 0.29);
      for (const el of scat) {
        const [dx, dy, r] = el.dataset.scatter!.split(',').map(Number);
        const k = reduce ? 0 : 1 - conv;
        el.style.transform = `translate3d(${(dx * k).toFixed(1)}px, ${(dy * k).toFixed(1)}px, 0) rotate(${(r * k).toFixed(1)}deg)`;
      }
      if (bar.current) bar.current.style.transform = `scaleX(${p.toFixed(4)})`;
      if (numeral.current) {
        const c = CHAPTERS[chapterAt(p)], lp = (p - c.start) / (c.end - c.start);
        numeral.current.style.transform = reduce ? 'none' : `translate3d(${((0.5 - lp) * 60).toFixed(1)}px, ${((0.5 - lp) * 160).toFixed(1)}px, 0)`;
        numeral.current.style.opacity = (band(lp, 0, 0.18, 0.82, 1) * (p > 0.84 ? 0 : 1)).toFixed(3);
      }
      if (truckText.current) {
        const t = phases(p).tanker;
        const label = t < 0.08 ? 'Accepted · waiting for a fresh GPS fix' : t < 0.82 ? 'En route · live GPS' : t < 0.95 ? 'Arrived · inside the geofence' : 'Delivered · proof of delivery recorded';
        if (truckText.current.textContent !== label) truckText.current.textContent = label;
      }
      const ch = chapterAt(p);
      if (ch !== lastCh) { lastCh = ch; setChapter(ch); if (numeral.current) numeral.current.textContent = String(ch + 1).padStart(2, '0'); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); mo.disconnect(); };
  }, [worldDriving, reduce]);

  const onHover = useCallback((pl: Place | null, x: number, y: number) => {
    const el = tip.current;
    if (!el) return;
    if (!pl) { el.style.opacity = '0'; document.body.style.cursor = ''; return; }
    el.style.opacity = '1';
    el.style.transform = `translate3d(${x + 14}px, ${y + 14}px, 0)`;
    el.querySelector('[data-k="crisis"]')!.textContent = `${pl.crisis}/100`;
    el.querySelector('[data-k="pop"]')!.textContent = num(pl.pop);
    el.querySelector('[data-k="ll"]')!.textContent = `${pl.lat.toFixed(2)}°N ${pl.lng.toFixed(2)}°E`;
    document.body.style.cursor = 'crosshair';
  }, []);

  const goTo = (i: number) => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const c = CHAPTERS[i];
    window.scrollTo({ top: (c.start + (c.end - c.start) * (i === 0 ? 0 : 0.42)) * max, behavior: reduce ? 'auto' : 'smooth' });
  };

  const at = s ? istTime(s.generatedAt) : undefined;
  const topDeficit = s?.rainfall[0];
  const ready = !!(s && geo);

  return (
    <EnterContext.Provider value={onEnter}>
      <div className="landing relative bg-[#eaf1f3] text-[#13222b] antialiased selection:bg-[#0a7f99]/20">
        {/* ------------------------------------------------ stage (fixed) */}
        <div ref={stage} className="fixed inset-0 overflow-hidden" aria-hidden>
          <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_70%_0%,#ffffff_0%,#eef4f6_38%,#dde8ec_100%)]" />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-end overflow-hidden pr-[3vw]">
            <span ref={numeral} className="select-none font-display text-[46vw] font-semibold leading-none tracking-[-0.06em] text-transparent [-webkit-text-stroke:1.5px_rgba(19,34,43,0.07)] will-change-transform md:text-[34vw]">01</span>
          </div>
          {worldDriving && ready && (
            <Suspense fallback={null}>
              <div className="absolute inset-0 animate-[landingIn_1.6s_ease-out_both]">
                <World geo={geo!} summary={s!} quality={quality} anchors={anchors} onHover={onHover} onReady={setFocus} />
              </div>
            </Suspense>
          )}
          {(!worldDriving || failed) && <StaticMap s={s} geo={geo} />}
          {/* vignette and horizon haze keep type readable over the world */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_45%,transparent_45%,rgba(226,236,240,0.85)_100%)]" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[34vh] bg-gradient-to-t from-[#eaf1f3] via-[#eaf1f3]/70 to-transparent md:h-[26vh]" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#f3f7f8]/90 to-transparent" />

          {/* readability scrims for the chapters that sit over a busy scene */}
          {[3, 4, 5].map(ch => <Layer key={ch} ch={ch} a={0} b={1} depth={0} className="inset-y-0 left-0 w-full bg-gradient-to-b from-[#eef4f6]/95 from-30% via-[#eef4f6]/60 via-50% to-transparent to-70% md:w-[46vw] md:bg-gradient-to-r md:from-[#eef4f6]/92 md:from-0% md:via-[#eef4f6]/55 md:via-50% md:to-transparent md:to-100%" />)}
          <Layer ch={7} a={0} b={1} depth={0} className="inset-0 bg-[#eef4f6]/70 backdrop-blur-[2px]" />

          {/* Chapter 1: scale */}
          <Layer ch={0} a={0} b={0.62} first className="inset-x-5 top-[24vh] md:left-[8vw] md:right-auto md:top-[28vh]">
            <Eyebrow className="mb-6">Maharashtra · {s ? `${num(s.places)} towns and villages` : 'loading the country'}</Eyebrow>
            <h1 className={cx(H, 'text-[13vw] leading-[0.9] md:text-[5.6vw]')}>Water moves.<br /><span className="text-[#0a7f99]">So should intelligence.</span></h1>
          </Layer>
          <Layer ch={0} a={0.55} b={1} depth={1.4} className="inset-x-5 bottom-[16vh] md:left-[8vw] md:right-auto">
            <p className={cx(H, 'text-[18vw] leading-none md:text-[9vw]')}>JalSetu</p>
            <p className="mt-3 max-w-[34ch] text-[17px] leading-snug text-[#3f525b] md:text-[19px]">Intelligent water logistics and emergency response, live across water-stressed Maharashtra.</p>
          </Layer>

          {/* Chapter 2: the problem */}
          <Layer ch={1} a={0} b={0.36} className="inset-x-5 top-[22vh] md:left-[8vw] md:right-auto">
            <p className={cx(H, 'text-[12vw] leading-[0.92] md:text-[6vw]')}>Demand doesn’t wait.</p>
          </Layer>
          <Layer ch={1} a={0.3} b={0.66} className="inset-x-5 top-[22vh] md:left-auto md:right-[8vw] md:text-right">
            <p className={cx(H, 'text-[12vw] leading-[0.92] md:text-[6vw]')}>Emergencies don’t<br />follow schedules.</p>
          </Layer>
          <Layer ch={1} a={0.6} b={1} className="inset-x-5 top-[22vh] md:left-[8vw] md:right-auto">
            <p className="text-[19px] text-[#4d626b] md:text-[24px]">The challenge isn’t only water.</p>
            <p className={cx(H, 'mt-2 text-[14vw] leading-none text-[#c0621c] md:text-[7vw]')}>It’s coordination.</p>
          </Layer>
          {s && (
            <Layer ch={1} a={0.1} b={1} depth={0.3} className="bottom-[9vh] left-5 md:bottom-[10vh] md:left-[8vw]">
              <Live at={at} />
              <p className="mt-2 font-mono text-[13px] text-[#23343d]"><span className="text-[22px] text-[#c0621c]">{num(s.inCrisis)}</span> places under water stress · <span className="text-[#c23b1b]">{num(s.critical)} critical</span></p>
            </Layer>
          )}

          {/* Chapter 3: JalSetu enters */}
          <Layer ch={2} a={0.05} b={1} depth={0.5} className="inset-x-0 top-[20vh] text-center md:top-[18vh]">
            <Scatter text="JalSetu" className={cx(H, 'text-[22vw] leading-none md:text-[13vw]')} />
          </Layer>
          <Layer ch={2} a={0.45} b={1} className="inset-x-5 bottom-[12vh] text-center">
            <p className={cx(H, 'text-[7vw] leading-tight md:text-[2.8vw]')}>One picture of need. One plan for every tanker.</p>
            <p className="mx-auto mt-3 max-w-[56ch] text-[14px] text-[#4d626b] md:text-[16px]">Priority from live crisis signals, vulnerability, unmet need and distance to water, with the reasons shown.</p>
            <div className="mt-4 flex justify-center"><Illustration>supply arcs</Illustration></div>
          </Layer>

          {/* Chapter 4: intelligence */}
          <Layer ch={3} a={0.05} b={0.95} className="left-5 top-[18vh] max-w-[90vw] md:left-[6vw] md:max-w-[28vw]">
            <Eyebrow className="mb-4">04 · Intelligence</Eyebrow>
            <p className={cx(H, 'text-[10vw] leading-[0.95] md:text-[4.2vw]')}>Every place, scored.<br /><span className="text-[#0a7f99]">And explained.</span></p>
            <p className="mt-4 text-[14px] leading-relaxed text-[#4d626b] md:text-[15px]">Columns rise where the crisis score is high: rainfall deficit, news from the ground, vulnerability, distance to water. Height is the score.</p>
          </Layer>
          <div ref={el => { anchors.current.focus = el; }} className="pointer-events-none absolute left-0 top-0 opacity-0" style={{ visibility: 'hidden' }}>
            <div className="w-max translate-y-10 -translate-x-1/2 border-t border-[#0a7f99] bg-white/85 px-3 py-2 shadow-[0_20px_50px_-24px_rgba(19,34,43,0.45)] backdrop-blur-md sm:w-auto sm:-translate-y-1/2 sm:translate-x-6 sm:border-l sm:border-t-0 sm:pl-3 sm:pr-4">
              <p className={cx(H, 'text-[22px] leading-none')}>{focus?.focusName ?? 'Highest-crisis place'}</p>
              {focus?.focusDistrict && <p className="mt-1 text-[12px] text-[#4d626b]">{districtName(focus.focusDistrict)} district</p>}
              <dl className="mt-2 grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 font-mono text-[11px]">
                <dt className="text-[#6a7f88]">Crisis score</dt><dd className="text-[#c23b1b]">{focus?.focusCrisis ?? '—'}/100</dd>
                <dt className="text-[#6a7f88]">Population</dt><dd>{focus ? num(focus.focusPop) : '—'}</dd>
                {topDeficit && focus?.focusDistrict && plain(topDeficit.district) === plain(focus.focusDistrict) && (
                  <><dt className="text-[#6a7f88]">Monsoon rain</dt><dd className="text-[#c0621c]">{topDeficit.deviation}% vs 10-yr</dd></>
                )}
              </dl>
              <div className="mt-2"><Live at={at} /></div>
            </div>
          </div>

          {/* Chapter 5: live operations */}
          <Layer ch={4} a={0.04} b={0.96} className="left-5 top-[18vh] max-w-[90vw] md:left-[6vw] md:max-w-[30vw]">
            <Eyebrow className="mb-4">05 · Live operations</Eyebrow>
            <p className={cx(H, 'text-[10vw] leading-[0.95] md:text-[4.2vw]')}>Every tanker,<br />on real GPS.</p>
            <p className="mt-4 text-[14px] leading-relaxed text-[#4d626b] md:text-[15px]">The driver’s phone is the tracker. Start needs a fresh fix, arrival is detected by geofence, delivery is signed and photographed, and an officer verifies it.</p>
            <div className="mt-4"><Illustration>the tracking workflow, not live telemetry</Illustration></div>
          </Layer>
          <div ref={el => { anchors.current.truck = el; }} className="pointer-events-none absolute left-0 top-0 opacity-0" style={{ visibility: 'hidden' }}>
            <div className="-translate-x-1/2 -translate-y-[calc(100%+18px)] whitespace-nowrap rounded-full bg-white/90 px-3 py-1.5 font-mono text-[11px] shadow-[0_12px_30px_-14px_rgba(19,34,43,0.5)] backdrop-blur-md">
              <span className="mr-2 text-[#0a7f99]">●</span><span ref={truckText}>Accepted</span>
            </div>
          </div>

          {/* Chapter 6: disaster response */}
          <Layer ch={5} a={0.04} b={0.96} className="left-5 top-[16vh] max-w-[90vw] md:left-[6vw] md:max-w-[32vw]">
            <Eyebrow className="mb-4">06 · Disaster response</Eyebrow>
            <p className={cx(H, 'text-[10vw] leading-[0.95] md:text-[4.2vw]')}>When the monsoon fails,<br /><span className="text-[#c0621c]">the plan moves.</span></p>
            <p className="mt-4 text-[14px] leading-relaxed text-[#4d626b] md:text-[15px]">Shaded districts: monsoon rainfall far below their own 10-year mean (Open-Meteo ERA5). Official NDMA alerts and news re-rank every place, and dispatch follows the new priorities.</p>
            <div className="mt-4"><Live at={at} /></div>
          </Layer>
          {s?.rainfall.slice(0, 3).map((r, i) => (
            <div key={r.district} ref={el => { anchors.current[`d${i}`] = el; }} className="pointer-events-none absolute left-0 top-0 opacity-0" style={{ visibility: 'hidden' }}>
              <div className="-translate-x-1/2 -translate-y-1/2 rounded-md bg-white/75 px-2 py-1 text-center shadow-[0_10px_30px_-16px_rgba(19,34,43,0.5)] backdrop-blur-sm">
                <p className="font-mono text-[18px] text-[#b8531a] md:text-[22px]">{r.deviation}%</p>
                <p className="text-[11px] uppercase tracking-[0.14em] text-[#7a4a2e]">{districtName(r.district)}</p>
              </div>
            </div>
          ))}

          {/* Chapter 7: the network */}
          <Layer ch={6} a={0.05} b={0.95} className="inset-x-5 top-[16vh] text-center">
            <p className={cx(H, 'text-[9vw] leading-[0.95] md:text-[4.6vw]')}>{s ? num(s.places) : '1,263'} towns and villages today.<br /><span className="text-[#0a7f99]">Built for every state.</span></p>
            <div className="mt-5 flex justify-center"><Illustration>national arcs show the design, not current coverage</Illustration></div>
          </Layer>

          {/* Chapter 8: impact (live numbers only) */}
          {s && (
            <Layer ch={7} a={0.03} b={0.97} depth={0.6} className="inset-x-5 top-[14vh] md:inset-x-[8vw] md:top-[24vh]">
              <div className="flex items-center justify-between"><Eyebrow>08 · Right now</Eyebrow><Live at={at} /></div>
              <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-3 md:gap-y-12">
                {[
                  [num(s.places), 'places monitored', 'OSM + Census 2011 populations'],
                  [millions(s.people), 'people in those places', 'demand at CPHEEO/JJM norms'],
                  [num(s.inCrisis), 'places under water stress', `${num(s.critical)} critical`],
                  [millions(s.peopleInCrisis), 'people in stressed places', 'from the crisis score'],
                  [num(s.newsReports), 'news reports read', 'Marathi + English, unverified until confirmed'],
                  [`${s.tankers} / ${s.depots}`, 'tankers / depots on real GPS', 'depots on real water sites'],
                ].map(([v, l, n]) => (
                  <div key={l} className="border-t border-[#c4d3d9] pt-3">
                    <dt className="text-[12px] text-[#4d626b] md:text-[13px]">{l}</dt>
                    <dd className={cx(H, 'mt-1 text-[11vw] leading-none md:text-[4.6vw]')}>{v}</dd>
                    <dd className="mt-2 font-mono text-[10.5px] text-[#6a7f88]">{n}</dd>
                  </div>
                ))}
              </dl>
            </Layer>
          )}

          {/* Chapter 9 (title only; the call to action is real page content below) */}
          <Layer ch={8} a={0} b={1} className="inset-x-5 top-[14vh] text-center md:top-[16vh]">
            <p className={cx(H, 'text-[9vw] leading-[0.95] md:text-[5vw]')}>From water movement<br /><span className="text-[#0a7f99]">to intelligent response.</span></p>
          </Layer>

          {/* hover card for real places */}
          <div ref={tip} className="pointer-events-none absolute left-0 top-0 z-10 opacity-0 transition-opacity duration-150">
            <div className="min-w-[180px] rounded-md border border-[#c4d3d9] bg-white/90 px-3 py-2 font-mono text-[11px] shadow-[0_16px_40px_-20px_rgba(19,34,43,0.5)] backdrop-blur">
              <p className="mb-1 text-[10px] uppercase tracking-[0.16em] text-[#3d7486]">Place · live</p>
              <p className="flex justify-between gap-4"><span className="text-[#6a7f88]">Crisis</span><span data-k="crisis" /></p>
              <p className="flex justify-between gap-4"><span className="text-[#6a7f88]">Population</span><span data-k="pop" /></p>
              <p className="mt-1 text-[#6a7f88]" data-k="ll" />
            </div>
          </div>
        </div>

        {/* ------------------------------------------------ chrome */}
        <header className="fixed inset-x-0 top-0 z-30">
          <div className="flex h-16 items-center justify-between px-5 md:px-8">
            <a href="/welcome" className="flex items-center gap-2.5 text-[#13222b]" aria-label="JalSetu home">
              <Mark className="h-7 w-7 text-[#0a7f99]" /><span className={cx(H, 'text-[22px] leading-none')}>JalSetu</span>
            </a>
            <p className="hidden font-mono text-[11px] uppercase tracking-[0.2em] text-[#3d7486] md:block" aria-live="polite">
              {String(chapter + 1).padStart(2, '0')} / {String(CHAPTERS.length).padStart(2, '0')} · {CHAPTERS[chapter].label}
            </p>
            <nav aria-label="Primary" className="flex items-center gap-1 md:gap-5">
              <a href="/report" className="hidden rounded px-2 py-1 text-[13px] text-[#3f525b] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0a7f99] sm:inline">Report a problem</a>
              <a href="/water" className="hidden rounded px-2 py-1 text-[13px] text-[#3f525b] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0a7f99] md:inline">Water schedule</a>
              <EnterLink className="group flex items-center gap-1.5 rounded-full border border-[#0a7f99]/50 px-3.5 py-1.5 text-[13px] font-medium text-[#13222b] transition-colors hover:bg-[#0a7f99] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0a7f99]">
                Control room <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </EnterLink>
            </nav>
          </div>
          <div className="h-px bg-[#cfdce1]"><div ref={bar} className="h-px origin-left scale-x-0 bg-[#0a7f99]" /></div>
        </header>

        <nav aria-label="Chapters" className="fixed right-4 top-1/2 z-30 hidden -translate-y-1/2 lg:block">
          <ol className="space-y-2.5">
            {CHAPTERS.map((c, i) => (
              <li key={c.id}>
                <button type="button" onClick={() => goTo(i)} aria-current={i === chapter ? 'step' : undefined}
                  className="group flex w-full items-center justify-end gap-3 rounded py-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0a7f99]">
                  <span className={cx('font-mono text-[10px] uppercase tracking-[0.16em] transition-opacity duration-300', i === chapter ? 'text-[#13222b] opacity-100' : 'text-[#6a7f88] opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100')}>{c.label}</span>
                  <span className={cx('h-px transition-all duration-500', i === chapter ? 'w-8 bg-[#0a7f99]' : 'w-4 bg-[#9fb3bb] group-hover:bg-[#6a7f88]')} />
                </button>
              </li>
            ))}
          </ol>
        </nav>

        {/* ------------------------------------------------ the scroll track, with the story as plain text for assistive tech */}
        <main className="pointer-events-none relative z-20">
          <div style={{ height: `${quality === 'high' ? 1250 : 1050}vh` }} className="relative">
            {CHAPTERS.slice(0, -1).map((c, i) => (
              <section key={c.id} id={c.id} aria-labelledby={`sr-${c.id}`} className="sr-only" style={{ position: 'absolute', top: `${c.start * 100}%` }}>
                <h2 id={`sr-${c.id}`}>{c.label}</h2>
                <p>{SR_TEXT[i](s)}</p>
              </section>
            ))}
            {/* final chapter: real, focusable content that arrives with the end of the journey */}
            <section id="return" aria-labelledby="return-title" className="absolute inset-x-0 bottom-0 flex h-[100svh] flex-col items-center justify-end px-5 pb-[10vh] text-center [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
              <h2 id="return-title" className="sr-only">From water movement to intelligent response</h2>
              <p className={cx(H, 'text-[20vw] leading-none md:text-[10vw]')}>JalSetu</p>
              <p className="mt-3 font-mono text-[12px] uppercase tracking-[0.32em] text-[#2d6c7f] md:text-[13px]">Connect · Coordinate · Respond</p>
              <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
                <EnterLink className="group inline-flex items-center gap-2 rounded-full bg-[#0a7f99] px-6 py-3 text-[15px] font-semibold text-white shadow-[0_18px_40px_-18px_rgba(10,127,153,0.8)] transition-[background-color,transform] hover:bg-[#0b6e85] active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0a7f99]">
                  Open the control room <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </EnterLink>
                <a href="/report" className="inline-flex items-center gap-1.5 rounded-full border border-[#9fb3bb] px-5 py-3 text-[14px] text-[#23343d] transition-colors hover:border-[#0a7f99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0a7f99]">
                  Report a water problem <ArrowUpRight className="h-4 w-4" />
                </a>
                <a href="/water" className="inline-flex items-center gap-1.5 rounded-full px-4 py-3 text-[14px] text-[#4d626b] transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0a7f99]">
                  When is water coming? <ArrowUpRight className="h-4 w-4" />
                </a>
              </div>
              <p className="mt-10 max-w-[70ch] text-[11px] leading-relaxed text-[#6a7f88]">
                Live figures from the JalSetu database{at ? ` at ${at} IST` : ''}. Places: OpenStreetMap with Census 2011 populations. Rainfall: Open-Meteo ERA5.
                Outlines: geoBoundaries (CC BY 2.5 IN / ODbL). Supply arcs, the tanker run and national arcs are illustrations.
              </p>
            </section>
          </div>
        </main>
      </div>
      <style>{`@keyframes landingIn { from { opacity: 0 } to { opacity: 1 } }`}</style>
    </EnterContext.Provider>
  );
};

const SR_TEXT: ((s: PublicSummary | null) => string)[] = [
  s => `Water moves. So should intelligence. JalSetu: intelligent water logistics and emergency response, live across ${s ? num(s.places) : 'over a thousand'} towns and villages in Maharashtra.`,
  s => `Demand doesn't wait. Emergencies don't follow schedules. The challenge isn't only water; it's coordination.${s ? ` Right now ${num(s.inCrisis)} places are under water stress, ${num(s.critical)} of them critical.` : ''}`,
  () => 'JalSetu turns scattered requests into one picture of need and one plan for every tanker, prioritising by live crisis signals, vulnerability, unmet need and distance to water, with the reasons shown.',
  () => 'Every place is scored and explained: rainfall deficit, news from the ground, vulnerability and distance to water combine into a crisis score.',
  () => "Every tanker is tracked on real GPS from the driver's phone. Start needs a fresh fix, arrival is detected by geofence, delivery is signed and photographed, and an officer verifies it.",
  s => `When the monsoon fails, the plan moves.${s?.rainfall[0] ? ` ${districtName(s.rainfall[0].district)} district has ${s.rainfall[0].deviation}% monsoon rainfall against its 10-year mean.` : ''} Official alerts and news re-rank every place and dispatch follows.`,
  s => `${s ? num(s.places) : 'Over a thousand'} towns and villages are monitored today, and the model is built for every state.`,
  s => (s ? `Right now: ${num(s.places)} places monitored with ${millions(s.people)} people; ${num(s.inCrisis)} places under water stress with ${millions(s.peopleInCrisis)} people; ${num(s.newsReports)} news reports read; ${s.tankers} tankers at ${s.depots} depots on real GPS.` : 'Live figures are loading.'),
];

// ---------------------------------------------------------------------------- fallback without WebGL
const StaticMap: React.FC<{ s: PublicSummary | null; geo: GeoFile | null }> = ({ s, geo }) => {
  const paths = useMemo(() => geo?.states.flatMap(st => st.rings.map(r => r.map(([lng, lat]) => project(lng, lat).map(v => v.toFixed(2)).join(',')).join(' '))) ?? [], [geo]);
  return (
    <svg viewBox="-12 -16 30 31" className="absolute inset-0 h-full w-full opacity-70" preserveAspectRatio="xMidYMid meet">
      {paths.map((d, i) => <polygon key={i} points={d} fill="none" stroke="#284050" strokeWidth={0.04} />)}
      {s?.points.map(([lng, lat, crisis], i) => {
        const [x, z] = project(lng, lat);
        return <circle key={i} cx={x} cy={z} r={crisis >= 70 ? 0.07 : 0.045} fill={crisis >= 70 ? '#c23b1b' : crisis >= 40 ? '#d8953f' : '#2f7f95'} />;
      })}
    </svg>
  );
};

export default Landing;
