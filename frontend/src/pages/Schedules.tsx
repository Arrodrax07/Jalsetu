/** Operators publish tap timings and supply notices; residents see them at /water. */
import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BellRing, Clock, ExternalLink, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api, type ScheduleInput } from '../services/api';
import { Button, Chip, cx, Dialog, EASE, Empty, Field, Loading, PageHeader, Panel, StatusChip } from '../components/ui';
import type { Community, NoticeKind, ScheduleKind, SupplyNotice, TapSchedule } from '../types';
import { dt } from '../utils/format';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const KINDS: { id: ScheduleKind; label: string }[] = [{ id: 'tap', label: 'Tap' }, { id: 'standpost', label: 'Standpost' }, { id: 'piped', label: 'Piped supply' }, { id: 'tanker_halt', label: 'Tanker halt' }];
const NOTICE_KINDS: { id: NoticeKind; label: string }[] = [{ id: 'interruption', label: 'Supply interruption' }, { id: 'extra_supply', label: 'Extra supply' }, { id: 'quality', label: 'Water quality advisory' }, { id: 'info', label: 'Information' }];

const CommunityPicker: React.FC<{ communities: Community[]; value: string; onChange: (id: string) => void }> = ({ communities, value, onChange }) => {
  const [q, setQ] = useState('');
  const sel = communities.find(c => c.id === value);
  const hits = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (n.length < 2) return [];
    return communities.filter(c => c.name.toLowerCase().includes(n) || (c.districtName || '').toLowerCase().includes(n)).slice(0, 8);
  }, [q, communities]);
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cc-faint" aria-hidden />
      <input className="input pl-9" value={q} onChange={e => setQ(e.target.value)} aria-label="Find a community"
        placeholder={sel ? `${sel.name} · ${sel.districtName ?? ''}` : 'Find a community by name or district'} />
      {hits.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full rounded-xl border border-cc-border bg-cc-surface p-1 shadow-pop">
          {hits.map(c => <li key={c.id}><button type="button" onClick={() => { onChange(c.id); setQ(''); }}
            className="flex w-full justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-cc-hover"><span>{c.name}</span><span className="text-xs text-cc-muted">{c.districtName}</span></button></li>)}
        </ul>
      )}
    </div>
  );
};

const blank = (communityId: string): ScheduleInput => ({ communityId, pointName: '', kind: 'standpost', days: [1, 2, 3, 4, 5, 6, 7], startTime: '06:00', endTime: '08:00', notes: '', isActive: true });

export const Schedules: React.FC = () => {
  const { communities, can, fail, toast } = useApp();
  const [communityId, setCommunityId] = useState('');
  const [rows, setRows] = useState<TapSchedule[] | null>(null);
  const [notices, setNotices] = useState<SupplyNotice[]>([]);
  const [edit, setEdit] = useState<{ id?: number; f: ScheduleInput } | null>(null);
  const [notice, setNotice] = useState<{ communityId: string; kind: NoticeKind; message: string; endsAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const manage = can('manage_schedules');
  const load = React.useCallback(() => api.schedules(communityId || undefined).then(r => { setRows(r.schedules); setNotices(r.notices); }).catch(fail), [communityId, fail]);
  useEffect(() => { setRows(null); load(); }, [load]);
  const community = communities.find(c => c.id === communityId);

  const save = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      if (edit.id) await api.updateSchedule(edit.id, edit.f); else await api.createSchedule(edit.f);
      toast('Schedule published', `${edit.f.pointName}: visible on the public page now.`, 'success');
      setEdit(null); load();
    } catch (e) { fail(e); }
    setBusy(false);
  };
  const del = async (s: TapSchedule) => { try { await api.deleteSchedule(s.id); toast('Schedule removed', s.pointName, 'info'); load(); } catch (e) { fail(e); } };
  const postNotice = async () => {
    if (!notice) return;
    setBusy(true);
    try {
      await api.createNotice({ communityId: notice.communityId, kind: notice.kind, message: notice.message, endsAt: notice.endsAt ? new Date(notice.endsAt).toISOString() : undefined });
      toast('Notice published', '', 'success'); setNotice(null); load();
    } catch (e) { fail(e); }
    setBusy(false);
  };

  return (
    <div className="p-4 lg:p-6">
      <PageHeader eyebrow="Public supply information" title="Tap schedules"
        subtitle="When each tap, standpost or piped line runs, and notices about interruptions. Residents see these at /water, in English, Marathi and Hindi."
        actions={<>
          <a href={community ? '/water' : '/water'} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl border border-cc-border bg-cc-surface px-3.5 py-2 text-sm font-medium hover:border-cc-strong">
            Public page <ExternalLink className="h-3.5 w-3.5" aria-hidden /></a>
          {manage && <Button icon={<BellRing className="h-4 w-4" />} disabled={!communityId} onClick={() => setNotice({ communityId, kind: 'interruption', message: '', endsAt: '' })}>Post notice</Button>}
          {manage && <Button variant="primary" icon={<Plus className="h-4 w-4" />} disabled={!communityId} onClick={() => setEdit({ f: blank(communityId) })}>Add timing</Button>}
        </>} />
      <div className="mb-4 grid gap-3 md:grid-cols-[minmax(0,420px)_1fr] md:items-center">
        <CommunityPicker communities={communities} value={communityId} onChange={setCommunityId} />
        <div className="flex items-center gap-2 text-sm text-cc-muted">
          {community ? <><span className="font-medium text-cc-text">{community.name}</span> · {community.districtName} · <button className="text-cc-accent underline underline-offset-4" onClick={() => setCommunityId('')}>show all places</button></>
            : 'Showing every published timing. Pick a place to add one.'}
        </div>
      </div>

      {notices.length > 0 && (
        <Panel title="Active notices" className="mb-4" bodyClassName="divide-y divide-cc-border">
          {notices.map(n => (
            <div key={n.id} className="flex items-start justify-between gap-3 px-5 py-3">
              <div><p className="text-sm"><span className="font-medium">{n.communityName}</span> · <Chip tone={n.kind === 'interruption' || n.kind === 'quality' ? 'warn' : 'accent'}>{NOTICE_KINDS.find(k => k.id === n.kind)?.label}</Chip></p>
                <p className="mt-1 text-sm">{n.message}</p><p className="text-xs text-cc-muted">{dt(n.startsAt)} → {n.endsAt ? dt(n.endsAt) : 'until ended'} · {n.createdBy}</p></div>
              {manage && <Button size="sm" onClick={async () => { try { await api.endNotice(n.id); load(); } catch (e) { fail(e); } }}>End now</Button>}
            </div>
          ))}
        </Panel>
      )}

      <Panel bodyClassName="overflow-x-auto">
        {!rows ? <Loading /> : rows.length === 0 ? (
          <Empty icon={<Clock className="h-5 w-5" />} title={community ? `No timings published for ${community.name}` : 'No tap timings published yet'}
            hint={manage ? 'Pick a place and add the times its taps or standposts run. They appear on the public page immediately.' : 'Operators publish these.'} />
        ) : (
          <table className="table-cc">
            <thead><tr><th>Place</th><th>Point</th><th>Kind</th><th>Days</th><th>Time (IST)</th><th>Next</th><th>Status</th><th>Updated</th>{manage && <th />}</tr></thead>
            <tbody>
              <AnimatePresence initial={false}>
                {rows.map(s => (
                  <motion.tr key={s.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease: EASE }}>
                    <td className="font-medium">{s.communityName}</td><td>{s.pointName}{s.notes && <p className="text-xs text-cc-muted">{s.notes}</p>}</td>
                    <td>{KINDS.find(k => k.id === s.kind)?.label}</td><td className="text-cc-muted">{s.daysLabel}</td>
                    <td className="num whitespace-nowrap">{s.startTime}–{s.endTime}</td>
                    <td className="whitespace-nowrap text-cc-muted">{s.next ? (s.next.running ? <Chip tone="ok">Running now</Chip> : s.next.startsLocal) : '—'}</td>
                    <td><StatusChip status={s.isActive ? 'Approved' : 'Cancelled'} label={s.isActive ? 'Published' : 'Paused'} /></td>
                    <td className="text-xs text-cc-muted">{dt(s.updatedAt)}<br />{s.updatedBy}</td>
                    {manage && <td className="whitespace-nowrap"><Button size="sm" variant="ghost" aria-label="Edit" onClick={() => setEdit({ id: s.id, f: { communityId: s.communityId, pointName: s.pointName, kind: s.kind, days: s.days, startTime: s.startTime, endTime: s.endTime, notes: s.notes, isActive: s.isActive } })}><Pencil className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" aria-label="Delete" onClick={() => del(s)}><Trash2 className="h-4 w-4" /></Button></td>}
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        )}
      </Panel>

      <Dialog open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit timing' : 'Add timing'} subtitle={communities.find(c => c.id === edit?.f.communityId)?.name}>
        {edit && (
          <div className="space-y-4">
            <Field label="Point name (what residents call it)"><input className="input" value={edit.f.pointName} onChange={e => setEdit({ ...edit, f: { ...edit.f, pointName: e.target.value } })} placeholder="e.g. Standpost near the gram panchayat office" /></Field>
            <div role="group" aria-label="Kind"><span className="label">Kind</span><div className="flex flex-wrap gap-1.5">{KINDS.map(k => (
              <button key={k.id} type="button" aria-pressed={edit.f.kind === k.id} onClick={() => setEdit({ ...edit, f: { ...edit.f, kind: k.id } })}
                className={cx('rounded-full px-3 py-1.5 text-sm ring-1', edit.f.kind === k.id ? 'bg-cc-text text-white ring-cc-text' : 'ring-cc-border')}>{k.label}</button>))}</div></div>
            <div role="group" aria-label="Days"><span className="label">Days</span><div className="flex flex-wrap gap-1.5">{DAYS.map((d, i) => {
              const on = edit.f.days.includes(i + 1);
              return <button key={d} type="button" aria-pressed={on} aria-label={d} onClick={() => setEdit({ ...edit, f: { ...edit.f, days: on ? edit.f.days.filter(x => x !== i + 1) : [...edit.f.days, i + 1].sort() } })}
                className={cx('h-10 w-12 rounded-xl text-sm font-medium ring-1', on ? 'bg-cc-accent text-white ring-cc-accent' : 'ring-cc-border text-cc-muted')}>{d}</button>;
            })}</div></div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Starts (IST)"><input className="input num" type="time" value={edit.f.startTime} onChange={e => setEdit({ ...edit, f: { ...edit.f, startTime: e.target.value } })} /></Field>
              <Field label="Ends (IST)" hint="Earlier than start = runs past midnight"><input className="input num" type="time" value={edit.f.endTime} onChange={e => setEdit({ ...edit, f: { ...edit.f, endTime: e.target.value } })} /></Field>
            </div>
            <Field label="Notes for residents (optional)"><input className="input" value={edit.f.notes} onChange={e => setEdit({ ...edit, f: { ...edit.f, notes: e.target.value } })} placeholder="e.g. Pressure is low after 7:30" /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.f.isActive} onChange={e => setEdit({ ...edit, f: { ...edit.f, isActive: e.target.checked } })} /> Published</label>
            <div className="flex justify-end gap-2 border-t border-cc-border pt-3"><Button onClick={() => setEdit(null)}>Cancel</Button>
              <Button variant="primary" loading={busy} disabled={edit.f.pointName.trim().length < 2 || !edit.f.days.length || edit.f.startTime === edit.f.endTime} onClick={save}>Publish</Button></div>
          </div>
        )}
      </Dialog>

      <Dialog open={!!notice} onClose={() => setNotice(null)} title="Post a supply notice" subtitle={communities.find(c => c.id === notice?.communityId)?.name}>
        {notice && (
          <div className="space-y-4">
            <Field label="Kind"><select className="input" value={notice.kind} onChange={e => setNotice({ ...notice, kind: e.target.value as NoticeKind })}>{NOTICE_KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}</select></Field>
            <Field label="Message (shown as written)" hint="Write it in the language residents read; Marathi or Hindi is fine."><textarea className="input" rows={3} value={notice.message} onChange={e => setNotice({ ...notice, message: e.target.value })} /></Field>
            <Field label="Ends (optional)"><input className="input" type="datetime-local" value={notice.endsAt} onChange={e => setNotice({ ...notice, endsAt: e.target.value })} /></Field>
            <div className="flex justify-end gap-2 border-t border-cc-border pt-3"><Button onClick={() => setNotice(null)}>Cancel</Button>
              <Button variant="primary" loading={busy} disabled={notice.message.trim().length < 5} onClick={postNotice}>Publish notice</Button></div>
          </div>
        )}
      </Dialog>
    </div>
  );
};
