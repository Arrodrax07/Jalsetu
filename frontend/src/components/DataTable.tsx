/**
 * Operational table: dense but readable. Search, filter segments, column sorting, pagination, expandable rows,
 * keyboard navigation (arrows move, Enter opens, Space / right arrow expands), and composed loading / empty / error states.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CaretDown, CaretLeft, CaretUp, CaretUpDown, ChevronRight, Search, X } from './icons';
import { cx, Empty, ErrorBox, Segmented, Skeleton } from './ui';
import { DUR, EASE_OUT, SPRING } from '../motion';

export interface Column<T> {
  id: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  sort?: (row: T) => number | string | null | undefined;
  align?: 'left' | 'right';
  className?: string;
  /** Hide on narrow screens. */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl';
}
export interface FilterDef<T> { id: string; label: string; test: (row: T) => boolean }

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  expand?: (row: T) => React.ReactNode;
  search?: (row: T) => string;
  searchPlaceholder?: string;
  filters?: FilterDef<T>[];
  filter?: string;
  onFilter?: (id: string) => void;
  defaultSort?: { id: string; dir: 'asc' | 'desc' };
  pageSize?: number;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyHint?: React.ReactNode;
  emptyAction?: React.ReactNode;
  toolbar?: React.ReactNode;
  label: string;
  rowClassName?: (row: T) => string | undefined;
}

const HIDE = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell', xl: 'hidden xl:table-cell' };

export function DataTable<T>(p: Props<T>) {
  const reduce = useReducedMotion();
  const [q, setQ] = useState('');
  const [ownFilter, setOwnFilter] = useState(p.filters?.[0]?.id ?? '');
  const filterId = p.filter ?? ownFilter;
  const setFilter = (id: string) => { setOwnFilter(id); p.onFilter?.(id); setPage(0); };
  const [sort, setSort] = useState<{ id: string; dir: 'asc' | 'desc' } | null>(p.defaultSort ?? null);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const body = useRef<HTMLTableSectionElement>(null);
  const size = p.pageSize ?? 25;

  const counts = useMemo(() => Object.fromEntries((p.filters ?? []).map(f => [f.id, p.rows.filter(f.test).length])), [p.rows, p.filters]);
  const filtered = useMemo(() => {
    const f = p.filters?.find(x => x.id === filterId);
    const needle = q.trim().toLowerCase();
    let rs = p.rows.filter(r => (!f || f.test(r)) && (!needle || !p.search || p.search(r).toLowerCase().includes(needle)));
    const col = sort && p.columns.find(c => c.id === sort.id);
    if (col?.sort) {
      const k = col.sort, d = sort!.dir === 'asc' ? 1 : -1;
      rs = [...rs].sort((a, b) => {
        const x = k(a), y = k(b);
        if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * d;
      });
    }
    return rs;
  }, [p.rows, p.filters, filterId, q, sort, p.columns, p.search]);
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  useEffect(() => { if (page >= pages) setPage(pages - 1); }, [page, pages]);
  useEffect(() => { setPage(0); }, [q]);
  const shown = filtered.slice(page * size, page * size + size);

  const toggleSort = (c: Column<T>) => {
    if (!c.sort) return;
    setSort(s => (s?.id === c.id ? { id: c.id, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { id: c.id, dir: 'desc' }));
  };
  const toggleOpen = (k: string) => setOpen(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const onKey = (e: React.KeyboardEvent<HTMLTableRowElement>, row: T) => {
    const rowsEls = [...(body.current?.querySelectorAll<HTMLTableRowElement>('tr[data-row]') ?? [])];
    const i = rowsEls.indexOf(e.currentTarget);
    if (e.key === 'ArrowDown') { e.preventDefault(); rowsEls[i + 1]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); rowsEls[i - 1]?.focus(); }
    else if (e.key === 'Enter' && p.onRowClick) { e.preventDefault(); p.onRowClick(row); }
    else if ((e.key === ' ' || e.key === 'ArrowRight' || e.key === 'ArrowLeft') && p.expand) { e.preventDefault(); toggleOpen(p.rowKey(row)); }
  };
  const colSpan = p.columns.length + (p.expand ? 1 : 0);

  return (
    <div className="flex min-w-0 flex-col">
      {(p.search || p.filters || p.toolbar) && (
        <div className="flex flex-wrap items-center gap-2 pb-3">
          {p.filters && (
            <div className="max-w-full overflow-x-auto">
              <Segmented label={`${p.label} filter`} value={filterId} onChange={setFilter}
                options={p.filters.map(f => ({ id: f.id, label: <span className="flex items-center gap-1.5">{f.label}<span className="mono text-[11px] text-cc-faint">{counts[f.id]?.toLocaleString('en-IN')}</span></span> }))} />
            </div>
          )}
          {p.search && (
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cc-faint" />
              <input className="input h-9 py-0 pl-9 pr-8" placeholder={p.searchPlaceholder ?? 'Search'} value={q} onChange={e => setQ(e.target.value)} aria-label={`Search ${p.label}`} />
              {q && <button className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-cc-faint hover:text-cc-text" aria-label="Clear search" onClick={() => setQ('')}><X className="h-3.5 w-3.5" /></button>}
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">{p.toolbar}</div>
        </div>
      )}
      {p.error ? <ErrorBox message={p.error} onRetry={p.onRetry} /> : (
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-cc" aria-label={p.label} aria-rowcount={filtered.length}>
              <thead>
                <tr>
                  {p.expand && <th className="w-8 !px-2"><span className="sr-only">Expand</span></th>}
                  {p.columns.map(c => (
                    <th key={c.id} scope="col" aria-sort={sort?.id === c.id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                      className={cx(c.align === 'right' && 'text-right', c.hideBelow && HIDE[c.hideBelow], c.className)}>
                      {c.sort ? (
                        <button onClick={() => toggleSort(c)} className={cx('group inline-flex items-center gap-1 transition-colors hover:text-cc-text', sort?.id === c.id && 'text-cc-text', c.align === 'right' && 'flex-row-reverse')}>
                          {c.header}
                          {sort?.id === c.id ? (sort.dir === 'asc' ? <CaretUp className="h-3 w-3" weight="bold" /> : <CaretDown className="h-3 w-3" weight="bold" />)
                            : <CaretUpDown className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />}
                        </button>
                      ) : c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody ref={body}>
                {p.loading ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={`sk${i}`}>{Array.from({ length: colSpan }).map((__, j) => <td key={j}><Skeleton className="h-3.5" style={{ width: `${50 + ((i * 7 + j * 13) % 45)}%` }} /></td>)}</tr>
                )) : shown.length === 0 ? (
                  <tr><td colSpan={colSpan} className="!p-0">
                    <Empty title={q ? `Nothing matches “${q}”` : p.emptyTitle ?? 'Nothing here yet'} hint={q ? 'Try a shorter search or another filter.' : p.emptyHint} action={p.emptyAction} />
                  </td></tr>
                ) : shown.map((r, i) => {
                  const k = p.rowKey(r);
                  const isOpen = open.has(k);
                  return (
                    <React.Fragment key={k}>
                      <motion.tr data-row tabIndex={0} aria-selected={p.selectedKey === k || undefined} aria-expanded={p.expand ? isOpen : undefined}
                        initial={reduce ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DUR.quick, ease: EASE_OUT, delay: Math.min(i, 12) * 0.012 }}
                        onClick={() => p.onRowClick?.(r)} onKeyDown={e => onKey(e, r)}
                        className={cx('outline-none focus-visible:bg-cc-accent/[0.06] focus-visible:shadow-[inset_3px_0_0_rgb(var(--cc-accent))]', p.onRowClick && 'cursor-pointer',
                          p.selectedKey === k && 'bg-cc-accent/[0.06] shadow-[inset_3px_0_0_rgb(var(--cc-accent))]', p.rowClassName?.(r))}>
                        {p.expand && (
                          <td className="w-8 !px-2">
                            <button tabIndex={-1} aria-label={isOpen ? 'Collapse row' : 'Expand row'} onClick={e => { e.stopPropagation(); toggleOpen(k); }}
                              className="flex h-6 w-6 items-center justify-center rounded-[6px] text-cc-faint hover:bg-cc-hover hover:text-cc-text">
                              <motion.span animate={{ rotate: isOpen ? 90 : 0 }} transition={SPRING}><ChevronRight className="h-3.5 w-3.5" /></motion.span>
                            </button>
                          </td>
                        )}
                        {p.columns.map(c => <td key={c.id} className={cx(c.align === 'right' && 'text-right', c.hideBelow && HIDE[c.hideBelow], c.className)}>{c.cell(r)}</td>)}
                      </motion.tr>
                      <AnimatePresence initial={false}>
                        {p.expand && isOpen && (
                          <tr className="!bg-cc-raised/60 hover:!bg-cc-raised/60">
                            <td colSpan={colSpan} className="!border-t-0 !p-0">
                              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: DUR.base, ease: EASE_OUT }} className="overflow-hidden">
                                <div className="px-5 py-4 pl-12">{p.expand(r)}</div>
                              </motion.div>
                            </td>
                          </tr>
                        )}
                      </AnimatePresence>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!p.loading && filtered.length > size && (
            <div className="flex items-center justify-between gap-3 border-t border-cc-border px-4 py-2 text-[12px] text-cc-muted">
              <span><span className="mono">{(page * size + 1).toLocaleString('en-IN')}–{Math.min(filtered.length, (page + 1) * size).toLocaleString('en-IN')}</span> of <span className="mono">{filtered.length.toLocaleString('en-IN')}</span></span>
              <div className="flex items-center gap-1">
                <button className="flex h-8 w-8 items-center justify-center rounded-control hover:bg-cc-hover disabled:opacity-30" disabled={page === 0} onClick={() => setPage(x => x - 1)} aria-label="Previous page"><CaretLeft className="h-4 w-4" /></button>
                <span className="mono px-2">{page + 1} / {pages}</span>
                <button className="flex h-8 w-8 rotate-180 items-center justify-center rounded-control hover:bg-cc-hover disabled:opacity-30" disabled={page >= pages - 1} onClick={() => setPage(x => x + 1)} aria-label="Next page"><CaretLeft className="h-4 w-4" /></button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
