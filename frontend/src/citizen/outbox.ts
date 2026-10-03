/**
 * Offline outbox for citizen complaints.
 *
 * A complaint written without a connection is stored on the device with a client-generated id (clientRef)
 * and the time it was written. It is sent when the connection returns (on the `online` event, when the
 * portal opens, and every 30 s while anything is waiting). The server stores a clientRef once, so a resend
 * after a lost response is harmless. Permanent rejections (e.g. a place that no longer exists) stop retrying
 * and are shown to the resident; "too many" (429) waits ten minutes.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { api, ApiError, type PublicComplaintInput } from '../services/api';

export type OutboxStatus = 'queued' | 'sending' | 'failed';
export interface OutboxItem {
  clientRef: string; payload: PublicComplaintInput; placeName: string; queuedAt: string;
  status: OutboxStatus; attempts: number; nextAttemptAt: number; lastError: string | null; permanent: boolean;
}
export interface SentTicket { id: string; placeName: string; sentAt: string; queuedAt: string | null; viaOutbox: boolean }

const KEY = 'jalsetu_outbox_v1';
const SENT_KEY = 'jalsetu_tickets_v1';

function read<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}
function write(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage full or blocked: keep in memory */ }
}

let items: OutboxItem[] = read<OutboxItem[]>(KEY, []).map(i => (i.status === 'sending' ? { ...i, status: 'queued' as const } : i));
let tickets: SentTicket[] = read<SentTicket[]>(SENT_KEY, []);
let lastFlush = null as { at: number; sent: number } | null;
const listeners = new Set<() => void>();
let snapshot = { items, tickets, lastFlush };
function emit() {
  write(KEY, items);
  write(SENT_KEY, tickets.slice(0, 30));
  snapshot = { items, tickets, lastFlush };
  listeners.forEach(l => l());
}

export function newClientRef(): string {
  const rnd = crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `c-${rnd}`.slice(0, 64);
}

export function enqueue(payload: PublicComplaintInput, placeName: string): OutboxItem {
  const item: OutboxItem = {
    clientRef: payload.clientRef || newClientRef(), payload, placeName, queuedAt: new Date().toISOString(),
    status: 'queued', attempts: 0, nextAttemptAt: 0, lastError: null, permanent: false,
  };
  item.payload = { ...payload, clientRef: item.clientRef, queuedAt: item.queuedAt };
  items = [...items, item];
  emit();
  return item;
}

export function remove(clientRef: string) { items = items.filter(i => i.clientRef !== clientRef); emit(); }

export function recordTicket(t: SentTicket) { tickets = [t, ...tickets.filter(x => x.id !== t.id)]; emit(); }

let flushing: Promise<number> | null = null;
/** Sends everything that is due. Returns how many were sent. ``force`` ignores back-off (the "try again" button). */
export function flush(force = false): Promise<number> {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    for (const it of [...items]) {
      if (it.permanent && !force) continue;
      if (!force && it.nextAttemptAt > Date.now()) continue;
      if (!navigator.onLine) break;
      items = items.map(x => (x.clientRef === it.clientRef ? { ...x, status: 'sending' } : x));
      emit();
      try {
        const r = await api.publicComplaint(it.payload);
        items = items.filter(x => x.clientRef !== it.clientRef);
        tickets = [{ id: r.id, placeName: it.placeName, sentAt: new Date().toISOString(), queuedAt: it.queuedAt, viaOutbox: true }, ...tickets];
        sent++;
        emit();
      } catch (e) {
        const status = e instanceof ApiError ? e.status : 0;
        const permanent = status >= 400 && status < 500 && status !== 408 && status !== 429;
        const backoff = status === 429 ? 10 * 60_000 : Math.min(5 * 60_000, 15_000 * 2 ** it.attempts);
        items = items.map(x => (x.clientRef === it.clientRef ? {
          ...x, status: 'failed', attempts: x.attempts + 1, permanent, nextAttemptAt: Date.now() + backoff,
          lastError: e instanceof Error ? e.message : String(e),
        } : x));
        emit();
        if (status === 0) break; // connection dropped again: stop for now
      }
    }
    lastFlush = { at: Date.now(), sent };
    emit();
    return sent;
  })().finally(() => { flushing = null; });
  return flushing;
}

function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

/** Outbox state + automatic flushing while the component is mounted. */
export function useOutbox() {
  const s = useSyncExternalStore(subscribe, () => snapshot);
  useEffect(() => {
    const go = () => { flush(); };
    window.addEventListener('online', go);
    const id = setInterval(() => { if (snapshot.items.length) flush(); }, 30_000);
    go();
    return () => { window.removeEventListener('online', go); clearInterval(id); };
  }, []);
  return s;
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    l => { window.addEventListener('online', l); window.addEventListener('offline', l); return () => { window.removeEventListener('online', l); window.removeEventListener('offline', l); }; },
    () => navigator.onLine,
  );
}
