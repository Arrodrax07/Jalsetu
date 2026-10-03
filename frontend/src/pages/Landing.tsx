/**
 * Public landing page: what is happening to water in Maharashtra right now, and how JalSetu responds.
 * Every number on this page is live (GET /api/public/summary): real places, Census populations,
 * measured rainfall deficit and published news. Scroll drives the story.
 */
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTransform, MotionValue } from 'motion/react';
import { ArrowRight, ArrowUpRight, CheckCircle2, CloudRain, MapPin, Navigation, Newspaper, Radio, Route, Scale, ShieldCheck, Truck } from '../components/icons';
import { api } from '../services/api';
import type { PublicSummary } from '../types';
import { Mark } from '../components/shell/Shell';
import { CountUp, cx, EASE } from '../components/ui';
import { districtName, timeAgo } from '../utils/format';

const WaterScene = React.lazy(() => import('../components/landing/WaterScene'));

const fmtM = (n: number) => `${(n / 1e6).toFixed(1)}M`;

/** "Open the control room": enters the app in place when the landing page is the app's front door,
 *  or navigates to sign-in when shown standalone (/welcome). */
const EnterContext = React.createContext<(() => void) | undefined>(undefined);
const EnterLink: React.FC<{ className?: string; children: React.ReactNode }> = ({ className, children }) => {
  const enter = React.useContext(EnterContext);
  return enter
    ? <button type="button" onClick={() => { window.scrollTo(0, 0); enter(); }} className={className}>{children}</button>
    : <a href="/login" className={className}>{children}</a>;
};

// ---------------------------------------------------------------------------- small pieces
const Reveal: React.FC<{ children: React.ReactNode; className?: string; delay?: number; y?: number }> = ({ children, className, delay = 0, y = 24 }) => (
  <motion.div className={className} initial={{ opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-12% 0px' }}
    transition={{ duration: 0.8, delay, ease: EASE }}>{children}</motion.div>
);

const SplitWords: React.FC<{ text: string; className?: string; delay?: number }> = ({ text, className, delay = 0 }) => (
  <span className={className} aria-label={text}>
    {text.split(' ').map((w, i) => (
      <span key={i} className="inline-block overflow-hidden pb-[0.08em] align-bottom" aria-hidden>
        <motion.span className="inline-block" initial={{ y: '105%' }} animate={{ y: 0 }} transition={{ delay: delay + i * 0.06, duration: 0.9, ease: EASE }}>
          {w}&nbsp;
        </motion.span>
      </span>
    ))}
  </span>
);

const Ticker: React.FC<{ items: PublicSummary['headlines'] }> = ({ items }) => {
  if (!items.length) return null;
  const row = [...items, ...items];
  return (
    <div className="relative overflow-hidden border-y border-cc-border bg-cc-surface/70 py-3 backdrop-blur [mask-image:linear-gradient(90deg,transparent,black_8%,black_92%,transparent)]">
      <div className="flex w-max ticker gap-10 hover:[animation-play-state:paused]">
        {row.map((h, i) => (
          <a key={i} href={h.url} target="_blank" rel="noreferrer noopener" className="flex items-center gap-2 whitespace-nowrap text-[13px] text-cc-muted hover:text-cc-text">
            <span className="h-1.5 w-1.5 rounded-full bg-[#c2361f]" />
            <span className="font-medium text-cc-text">{h.publisher}</span>
            <span className="max-w-[46ch] truncate">{h.title}</span>
          </a>
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------- nav
const Nav: React.FC<{ scrolled: boolean }> = ({ scrolled }) => (
  <motion.header initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.6, ease: EASE, delay: 0.2 }}
    className={cx('fixed inset-x-0 top-0 z-50 transition-all duration-500', scrolled ? 'border-b border-cc-border bg-cc-bg/80 backdrop-blur-md' : 'bg-transparent')}>
    <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between px-5 md:px-8">
      <a href="/" className="flex items-center gap-2.5"><Mark className="h-8 w-8 text-cc-accent" /><span className="display text-[26px] leading-none">JalSetu</span></a>
      <nav className="hidden items-center gap-8 text-sm text-cc-muted md:flex">
        <a href="#situation" className="transition-colors hover:text-cc-text">The situation</a>
        <a href="#how" className="transition-colors hover:text-cc-text">How it works</a>
        <a href="#evidence" className="transition-colors hover:text-cc-text">Evidence</a>
        <a href="/report" className="transition-colors hover:text-cc-text">Report a problem</a>
      </nav>
      <EnterLink className="group flex items-center gap-1.5 rounded-full bg-cc-ink px-4 py-2 text-sm font-medium text-cc-on-ink shadow-[0_8px_20px_-10px_rgb(19_31_42/0.7)] transition hover:bg-[#0b1621]">
        Control room <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </EnterLink>
    </div>
  </motion.header>
);

// ---------------------------------------------------------------------------- hero
const Hero: React.FC<{ s: PublicSummary | null; progress: React.MutableRefObject<number>; scrollY: MotionValue<number> }> = ({ s, progress, scrollY }) => {
  const reduce = useReducedMotion();
  const y = useTransform(scrollY, [0, 700], [0, -120]);
  const fade = useTransform(scrollY, [0, 520], [1, 0]);
  return (
    <section className="relative min-h-[100svh] overflow-hidden">
      <div className="absolute inset-0 contours opacity-70" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_70%_45%,rgb(12_110_150/0.08),transparent_70%)]" />
      {/* phones: model sits under the copy; desktop: to the right of it */}
      <div className="absolute inset-x-[-15%] bottom-[4%] top-[55%] [mask-image:radial-gradient(ellipse_50%_50%_at_50%_50%,black_70%,transparent_100%)] md:inset-x-auto md:inset-y-0 md:right-[-6%] md:w-[66%]">
        <Suspense fallback={null}><WaterScene progress={progress} reduce={!!reduce} className="!h-full !w-full" /></Suspense>
      </div>
      <motion.div style={reduce ? undefined : { y, opacity: fade }} className="pointer-events-none relative mx-auto flex min-h-[100svh] max-w-[1320px] flex-col justify-start px-5 pb-[48svh] pt-28 md:justify-center md:pb-0 md:pt-20 md:px-8">
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="mb-5 flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.2em] text-cc-muted">
          <span className="relative flex h-2 w-2"><span className="absolute inset-0 animate-ping rounded-full bg-[#c2361f] opacity-60" /><span className="relative h-2 w-2 rounded-full bg-[#c2361f]" /></span>
          Maharashtra · live water picture
        </motion.p>
        <h1 className="display max-w-[11ch] text-[64px] leading-[0.92] text-cc-text sm:text-[88px] lg:text-[118px]">
          <SplitWords text="Water, where" delay={0.35} /><br />
          <SplitWords text="it is needed" delay={0.5} className="italic text-cc-accent" /><br />
          <SplitWords text="most." delay={0.65} />
        </h1>
        <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.05, duration: 0.7, ease: EASE }}
          className="mt-7 max-w-[46ch] text-[17px] leading-relaxed text-cc-muted">
          {s ? <>Right now <b className="font-semibold text-cc-text">{s.inCrisis.toLocaleString('en-IN')} towns and villages</b> show signs of water stress,{' '}
            <b className="font-semibold text-[#a8301c]">{s.critical} of them critical</b>. JalSetu finds them from rainfall and news, sends the right tanker, and proves the water arrived.</>
            : 'JalSetu finds where water is short from rainfall and news, sends the right tanker, and proves the water arrived.'}
        </motion.p>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2, duration: 0.7, ease: EASE }} className="pointer-events-auto mt-9 flex flex-wrap gap-3">
          <EnterLink className="group flex items-center gap-2 rounded-full bg-cc-ink px-6 py-3.5 text-[15px] font-medium text-cc-on-ink shadow-[0_14px_30px_-14px_rgb(19_31_42/0.8)] transition hover:-translate-y-0.5">
            Open the control room <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </EnterLink>
          <a href="/report" className="flex items-center gap-2 rounded-full border border-cc-border bg-cc-surface/80 px-6 py-3.5 text-[15px] font-medium backdrop-blur transition hover:border-cc-strong">
            Report a water problem
          </a>
        </motion.div>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.8 }} className="mt-12 hidden items-center gap-2 text-[12px] text-cc-muted md:flex">
          <span className="relative flex h-2 w-2"><span className="absolute inset-0 animate-ping rounded-full bg-cc-accent opacity-50" /><span className="relative h-2 w-2 rounded-full bg-cc-accent" /></span>
          Touch the water
        </motion.p>
      </motion.div>
      <div className="absolute inset-x-0 bottom-0">{s && <Ticker items={s.headlines} />}</div>
    </section>
  );
};

// ---------------------------------------------------------------------------- situation (sticky scrollytelling)
const Situation: React.FC<{ s: PublicSummary }> = ({ s }) => {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const [beat, setBeat] = useState(0);
  useMotionValueEvent(scrollYProgress, 'change', v => setBeat(v < 0.34 ? 0 : v < 0.67 ? 1 : 2));
  const bar = useSpring(scrollYProgress, { stiffness: 120, damping: 30 });
  const beats = [
    { n: s.inCrisis, unit: 'places', title: 'under water stress', body: `Out of ${s.places.toLocaleString('en-IN')} towns and villages we track, these show a measured monsoon deficit, or have been named in recent reports of shortage, tankers or drought.`, color: '#b46d06' },
    { n: s.peopleInCrisis, unit: 'people', title: 'live in those places', body: `Census populations, not estimates. That is ${Math.round((100 * s.peopleInCrisis) / s.people)}% of everyone in the places JalSetu covers.`, color: '#131f2a', fmt: fmtM },
    { n: s.critical, unit: 'critical', title: 'need water first', body: 'Named in the news and in a district with a severe rainfall deficit. These are where JalSetu proposes the next tanker trips.', color: '#a8301c' },
  ];
  const b = beats[beat];
  return (
    <section id="situation" ref={ref} className="relative h-[300vh]">
      <div className="sticky top-0 flex h-[100svh] items-center overflow-hidden">
        <div className="mx-auto grid w-full max-w-[1320px] gap-10 px-5 md:grid-cols-[1.1fr_1fr] md:px-8">
          <div>
            <p className="eyebrow mb-6">01 · The situation, today</p>
            <motion.div key={beat} initial={{ opacity: 0, y: 30, filter: 'blur(6px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ duration: 0.7, ease: EASE }}>
              <p className="display text-[96px] leading-[0.9] md:text-[160px]" style={{ color: b.color }}>
                <CountUp value={b.n} format={b.fmt} duration={1.2} />
              </p>
              <p className="display mt-2 text-[40px] leading-tight md:text-[56px]"><span className="text-cc-muted">{b.unit}</span> {b.title}</p>
              <p className="mt-5 max-w-[48ch] text-[17px] leading-relaxed text-cc-muted">{b.body}</p>
            </motion.div>
            <div className="mt-10 flex items-center gap-3">
              {beats.map((_, i) => <span key={i} className={cx('h-1 rounded-full transition-all duration-500', i === beat ? 'w-10 bg-cc-ink' : 'w-4 bg-cc-strong')} />)}
            </div>
          </div>
          <div className="relative hidden md:block">
            <div className="panel overflow-hidden p-0">
              <div className="flex items-center justify-between border-b border-cc-border px-5 py-3.5">
                <p className="text-sm font-semibold">Most critical right now</p>
                <span className="flex items-center gap-1.5 text-[11px] text-cc-muted"><Radio className="h-3.5 w-3.5 text-[#c2361f]" />live</span>
              </div>
              <ul>
                {s.criticalPlaces.slice(0, 8).map((p, i) => (
                  <motion.li key={p.name} initial={{ opacity: 0, x: 20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}
                    transition={{ delay: i * 0.06, duration: 0.5, ease: EASE }} className="flex items-center gap-3 border-b border-cc-border/70 px-5 py-3 last:border-0">
                    <span className="num w-5 text-xs text-cc-faint">{String(i + 1).padStart(2, '0')}</span>
                    <span className="flex-1"><span className="block text-[15px] font-medium">{p.name}</span><span className="block text-xs text-cc-muted">{districtName(p.district)} district</span></span>
                    <span className="flex w-28 items-center gap-2">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-cc-hover">
                        <motion.span className="block h-full rounded-full bg-[#c2361f]" initial={{ width: 0 }} whileInView={{ width: `${p.crisis}%` }} viewport={{ once: true }} transition={{ delay: 0.3 + i * 0.06, duration: 0.9, ease: EASE }} />
                      </span>
                      <span className="num w-6 text-right text-xs">{p.crisis}</span>
                    </span>
                  </motion.li>
                ))}
              </ul>
            </div>
            <motion.div className="absolute -left-6 top-0 h-full w-[3px] origin-top rounded-full bg-cc-ink/80" style={{ scaleY: bar }} />
          </div>
        </div>
      </div>
    </section>
  );
};

// ---------------------------------------------------------------------------- how it works (pinned horizontal scroll)
const STEPS = [
  { icon: CloudRain, k: 'Sense', title: 'Find stress before the calls come', body: 'Monsoon rainfall for every district is compared with its last ten years, and Marathi and English news is matched to towns and villages. Every signal links to its source.' },
  { icon: Scale, k: 'Prioritise', title: 'Rank need fairly, and explain it', body: 'A transparent score weighs shortfall, population, vulnerability, recent deliveries and live crisis signals. A survival floor comes first for everyone.' },
  { icon: Route, k: 'Dispatch', title: 'Propose the right truck', body: 'The planner pairs each available tanker with the place one load helps most, nearby stops included, then a dispatcher approves with one click.' },
  { icon: Navigation, k: 'Track', title: 'Real GPS from the driver’s phone', body: 'No simulated dots. Arrival is detected by geofence from consecutive fixes; route deviations and stops are flagged as they happen.' },
  { icon: ShieldCheck, k: 'Prove', title: 'Proof that water arrived', body: 'Receiver, signature and meter photo at the stop, verified by an operator before the trip closes. Every action is audit-logged.' },
];

const How: React.FC = () => {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const x = useTransform(scrollYProgress, [0.05, 0.95], ['0%', '-62%']);
  const line = useSpring(useTransform(scrollYProgress, [0.05, 0.95], [0, 1]), { stiffness: 140, damping: 30 });
  return (
    <section id="how" ref={ref} className="relative h-[320vh] bg-cc-ink text-[#f5f3ee]">
      <div className="sticky top-0 flex h-[100svh] flex-col justify-center overflow-hidden">
        <div className="mx-auto w-full max-w-[1320px] px-5 md:px-8">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">02 · How JalSetu works</p>
          <h2 className="display max-w-[16ch] text-[52px] leading-[0.95] md:text-[80px]">From a headline to a <em className="text-[#7cc4e4]">delivered litre</em>.</h2>
        </div>
        <motion.div style={{ x }} className="mt-14 flex gap-6 pl-5 md:pl-[max(2rem,calc((100vw-1320px)/2+2rem))]">
          {STEPS.map((s, i) => (
            <div key={s.k} className="group relative w-[340px] flex-shrink-0 rounded-3xl border border-white/10 bg-white/[0.04] p-7 backdrop-blur transition-colors hover:bg-white/[0.07] md:w-[420px]">
              <div className="flex items-center justify-between">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-[#7cc4e4] transition-transform duration-500 group-hover:rotate-[-8deg] group-hover:scale-110"><s.icon className="h-6 w-6" /></span>
                <span className="display text-[64px] leading-none text-white/10">0{i + 1}</span>
              </div>
              <p className="mt-8 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#7cc4e4]">{s.k}</p>
              <p className="display mt-2 text-[32px] leading-[1.05]">{s.title}</p>
              <p className="mt-4 text-[15px] leading-relaxed text-white/65">{s.body}</p>
            </div>
          ))}
        </motion.div>
        <div className="mx-auto mt-14 w-full max-w-[1320px] px-5 md:px-8">
          <div className="relative h-[3px] rounded-full bg-white/10">
            <motion.div className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-gradient-to-r from-[#7cc4e4] to-white" style={{ scaleX: line }} />
            <motion.span className="absolute -top-[5px] h-[13px] w-[13px] rounded-full bg-white shadow-[0_0_0_6px_rgb(124_196_228/0.25)]" style={{ left: useTransform(line, v => `calc(${v * 100}% - 6px)`) }} />
          </div>
        </div>
      </div>
    </section>
  );
};

// ---------------------------------------------------------------------------- evidence
const Evidence: React.FC<{ s: PublicSummary }> = ({ s }) => {
  const max = Math.max(...s.rainfall.map(r => Math.abs(r.deviation)), 1);
  return (
    <section id="evidence" className="relative py-32">
      <div className="mx-auto max-w-[1320px] px-5 md:px-8">
        <Reveal><p className="eyebrow mb-4">03 · Evidence, not guesses</p></Reveal>
        <Reveal delay={0.05}><h2 className="display max-w-[18ch] text-[52px] leading-[0.95] md:text-[76px]">The monsoon fell short. <em className="text-cc-muted">Here is where.</em></h2></Reveal>
        <div className="mt-16 grid gap-12 lg:grid-cols-[1.15fr_1fr]">
          <Reveal className="panel p-6 md:p-8">
            <div className="mb-6 flex items-end justify-between">
              <div><p className="text-sm font-semibold">Monsoon rainfall vs 10-year average</p><p className="text-xs text-cc-muted">1 June to date, by district · Open-Meteo ERA5 reanalysis</p></div>
              <CloudRain className="h-5 w-5 text-cc-accent" />
            </div>
            <ul className="space-y-3.5">
              {s.rainfall.map((r, i) => (
                <li key={r.district} className="grid grid-cols-[120px_1fr_56px] items-center gap-4">
                  <span className="truncate text-sm">{districtName(r.district)}</span>
                  <span className="relative h-7 overflow-hidden rounded-lg bg-cc-hover">
                    <motion.span className="absolute inset-y-0 left-0 rounded-lg" style={{ background: r.deviation <= -40 ? '#c2361f' : r.deviation <= -25 ? '#d48806' : '#0c6e96' }}
                      initial={{ width: 0 }} whileInView={{ width: `${(Math.abs(r.deviation) / max) * 100}%` }} viewport={{ once: true, margin: '-10% 0px' }}
                      transition={{ delay: i * 0.07, duration: 1, ease: EASE }} />
                  </span>
                  <span className="num text-right text-sm font-semibold">{r.deviation.toFixed(0)}%</span>
                </li>
              ))}
            </ul>
          </Reveal>
          <div>
            <Reveal className="mb-5 flex items-center justify-between">
              <p className="text-sm font-semibold">{s.newsReports} reports matched to places this fortnight</p><Newspaper className="h-5 w-5 text-cc-accent" />
            </Reveal>
            <div className="grid gap-3">
              {s.headlines.slice(0, 5).map((h, i) => (
                <Reveal key={h.url} delay={i * 0.06} y={16}>
                  <a href={h.url} target="_blank" rel="noreferrer noopener" className="group block rounded-2xl border border-cc-border bg-cc-surface p-4 transition hover:-translate-y-0.5 hover:border-cc-strong hover:shadow-lift">
                    <div className="flex items-center gap-2 text-[11px] text-cc-muted"><span className="font-semibold text-cc-text">{h.publisher}</span>·<span>{timeAgo(h.publishedAt)}</span>
                      {h.places.length > 0 && <span className="ml-auto flex items-center gap-1 text-[#a8301c]"><MapPin className="h-3 w-3" />{h.places.join(', ')}</span>}</div>
                    <p className="mt-1.5 text-[15px] leading-snug group-hover:text-cc-accent-strong">{h.title} <ArrowUpRight className="inline h-3.5 w-3.5 opacity-40" /></p>
                  </a>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

// ---------------------------------------------------------------------------- field app (3D tilting phone)
const Field: React.FC = () => {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const rotY = useTransform(scrollYProgress, [0, 0.5, 1], [-28, -8, 14]);
  const rotX = useTransform(scrollYProgress, [0, 0.5, 1], [16, 6, -6]);
  const yv = useTransform(scrollYProgress, [0, 1], [80, -80]);
  const steps = ['Accept', 'Start', 'On the way', 'Arrived', 'Delivering', 'Done'];
  return (
    <section ref={ref} className="relative overflow-hidden py-32">
      <div className="absolute inset-0 contours opacity-60" />
      <div className="relative mx-auto grid max-w-[1320px] items-center gap-16 px-5 md:grid-cols-2 md:px-8">
        <div>
          <Reveal><p className="eyebrow mb-4">04 · In the field</p></Reveal>
          <Reveal delay={0.05}><h2 className="display text-[52px] leading-[0.95] md:text-[72px]">A phone is the <em className="text-cc-accent">tracker</em>.</h2></Reveal>
          <Reveal delay={0.1}><p className="mt-6 max-w-[44ch] text-[17px] leading-relaxed text-cc-muted">Drivers open a web link, accept the trip and press start. Their phone’s GPS streams to the control room, keeps working through dead zones, and unlocks “Arrived” only when they are really there.</p></Reveal>
          <Reveal delay={0.15}>
            <ul className="mt-8 grid gap-3 text-[15px]">
              {['No app install, works on any smartphone', 'Offline buffer: fixes upload when signal returns', 'Arrival by geofence, delivery with signature and photo'].map(t => (
                <li key={t} className="flex items-center gap-3"><CheckCircle2 className="h-5 w-5 flex-shrink-0 text-cc-accent" />{t}</li>
              ))}
            </ul>
          </Reveal>
        </div>
        <div className="flex justify-center [perspective:1400px]">
          <motion.div style={{ rotateY: rotY, rotateX: rotX, y: yv }} className="relative w-[300px] [transform-style:preserve-3d]">
            <div className="rounded-[46px] border border-black/10 bg-[#131f2a] p-3 shadow-[0_60px_80px_-40px_rgb(19_31_42/0.6),0_30px_40px_-30px_rgb(19_31_42/0.5)]">
              <div className="overflow-hidden rounded-[36px] bg-cc-bg">
                <div className="flex items-center justify-between px-5 pb-2 pt-4 text-[11px] font-semibold"><span>9:41</span><span className="h-5 w-20 rounded-full bg-[#131f2a]" /><span>5G</span></div>
                <div className="space-y-3 px-4 pb-6">
                  <div className="flex items-center gap-2"><Mark className="h-6 w-6 text-cc-accent" /><span className="display text-lg">JalSetu <span className="text-cc-muted">Driver</span></span></div>
                  <div className="rounded-2xl bg-cc-surface p-3 shadow-panel">
                    <div className="relative mx-1 mt-1">
                      <div className="absolute left-0 right-0 top-[8px] h-[2px] bg-cc-hover" />
                      <motion.div className="absolute left-0 top-[8px] h-[2px] bg-cc-accent" initial={{ width: 0 }} whileInView={{ width: '60%' }} viewport={{ once: true }} transition={{ duration: 1.4, ease: EASE, delay: 0.3 }} />
                      <div className="relative flex justify-between">{steps.map((s, i) => (
                        <span key={s} className={cx('h-[18px] w-[18px] rounded-full border-2', i < 3 ? 'border-cc-accent bg-cc-accent' : i === 3 ? 'border-cc-accent bg-cc-surface' : 'border-cc-border bg-cc-surface')} />))}</div>
                    </div>
                    <p className="mt-2 text-center text-[10px] text-cc-muted">On the way · stop 1 of 2</p>
                  </div>
                  <div className="rounded-2xl bg-cc-surface p-4 shadow-panel">
                    <p className="eyebrow">Destination</p>
                    <p className="display text-2xl leading-tight">Tarodi Khurd</p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-cc-raised p-2.5"><p className="text-[9px] uppercase tracking-wider text-cc-faint">Distance</p><p className="display text-2xl leading-none">2.4 km</p></div>
                      <div className="rounded-xl bg-cc-raised p-2.5"><p className="text-[9px] uppercase tracking-wider text-cc-faint">Deliver</p><p className="display text-2xl leading-none">8,000 L</p></div>
                    </div>
                  </div>
                  <div className="rounded-2xl bg-cc-surface p-3 shadow-panel">
                    <div className="flex items-center justify-between text-[11px]"><span className="flex items-center gap-1.5 font-semibold"><span className="relative flex h-1.5 w-1.5"><span className="absolute inset-0 animate-ping rounded-full bg-cc-live opacity-60" /><span className="relative h-1.5 w-1.5 rounded-full bg-cc-live" /></span>GPS live</span><span className="text-cc-muted">± 6 m</span></div>
                  </div>
                  <div className="rounded-2xl bg-cc-ink py-3 text-center text-sm font-semibold text-cc-on-ink">ARRIVED · unlocks at 150 m</div>
                </div>
              </div>
            </div>
            <div className="absolute -right-24 top-24 hidden w-48 rounded-2xl border border-cc-border bg-cc-surface p-3 shadow-pop lg:block [transform:translateZ(60px)]">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold"><Truck className="h-3.5 w-3.5 text-cc-accent" />MH-01-WT-1740</p>
              <p className="mt-1 text-[10px] text-cc-muted">Live in the control room · 3 s ago</p>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};

// ---------------------------------------------------------------------------- closing
const Closing: React.FC<{ s: PublicSummary | null }> = ({ s }) => (
  <section className="relative overflow-hidden bg-cc-surface py-32">
    <div className="mx-auto max-w-[1320px] px-5 text-center md:px-8">
      <Reveal><h2 className="display mx-auto max-w-[18ch] text-[56px] leading-[0.95] md:text-[96px]">Every litre, <em className="whitespace-nowrap text-cc-accent">accounted for.</em></h2></Reveal>
      <Reveal delay={0.1}><p className="mx-auto mt-6 max-w-[52ch] text-[17px] leading-relaxed text-cc-muted">
        {s ? `${s.places.toLocaleString('en-IN')} places · ${fmtM(s.people)} people · ${s.tankers} tankers · ${s.depots} depots sited on real water infrastructure.` : ''}
      </p></Reveal>
      <Reveal delay={0.18} className="mt-10 flex flex-wrap justify-center gap-3">
        <EnterLink className="group flex items-center gap-2 rounded-full bg-cc-ink px-7 py-4 text-[15px] font-medium text-cc-on-ink transition hover:-translate-y-0.5">Open the control room <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></EnterLink>
        <a href="/report" className="flex items-center gap-2 rounded-full border border-cc-border px-7 py-4 text-[15px] font-medium transition hover:border-cc-strong">Report a water problem</a>
      </Reveal>
    </div>
    <footer className="mx-auto mt-28 flex max-w-[1320px] flex-col gap-4 border-t border-cc-border px-5 pt-8 text-[12px] text-cc-muted md:flex-row md:items-center md:justify-between md:px-8">
      <span className="flex items-center gap-2"><Mark className="h-5 w-5 text-cc-accent" />JalSetu · water operations for Maharashtra</span>
      <span>Data: OpenStreetMap contributors (ODbL) · Census of India · Open-Meteo ERA5 (CC BY 4.0) · NDMA SACHET · publishers via Google News</span>
    </footer>
  </section>
);

// ---------------------------------------------------------------------------- page
export const Landing: React.FC<{ onEnter?: () => void }> = ({ onEnter }) => {
  const [s, setS] = useState<PublicSummary | null>(null);
  const { scrollY } = useScroll(); // the landing page scrolls the document itself
  const progress = useRef(0);
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, 'change', v => { progress.current = Math.min(1, v / 900); setScrolled(v > 40); });
  useEffect(() => { api.publicSummary().then(setS).catch(() => undefined); }, []);
  const page = useMemo(() => s, [s]);
  return (
    <EnterContext.Provider value={onEnter}>
    <div className="min-h-full overflow-x-clip bg-cc-bg">
      <Nav scrolled={scrolled} />
      <Hero s={page} progress={progress} scrollY={scrollY} />
      {page && <Situation s={page} />}
      <How />
      {page && <Evidence s={page} />}
      <Field />
      <Closing s={page} />
    </div>
    </EnterContext.Provider>
  );
};
