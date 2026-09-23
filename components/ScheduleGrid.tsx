'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { BerthRow } from '@/lib/data'
import { parseDay, dayCount, type Reservation, type Vessel } from '@/lib/validation/engine'
import { deleteReservation } from '@/app/actions'
import { ReservePopover, type PendingSelection } from './ReservePopover'
import { ReserveDialog } from './ReserveDialog'
import { MonthHeader, type ScheduleView } from './MonthHeader'

const DAY_MS = 86_400_000
const WEEKDAY = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const BERTH_COL_PX = 268
const MONTH_DAY_PX = 64
/**
 * The narrowest a day can go before a one-day stay's name collapses to a
 * letter. Measured: the widest single-day label needs 40px across its two
 * clamped lines. Below this the month scrolls instead of shrinking further.
 */
const MIN_DAY_PX = 40
const WEEK_DAY_PX = 128

export type GridReservation = Reservation & {
  conflicted: boolean
  oversize: boolean
}

type Props = {
  berths: BerthRow[]
  vessels: Vessel[]
  reservations: GridReservation[]
  initialYear: number
  initialMonth: number
  years: number[]
  today: string
  /** Hull to trace on load, from a review row's "Open on schedule". */
  initialTrace?: string | null
}

/**
 * Drag state.
 *
 * `anchor` is never mutated once set. start/end are derived as min/max on every
 * render, which is what makes dragging backwards work without a special case.
 */
type DragState =
  | { kind: 'idle' }
  | { kind: 'anchored'; berthId: string; anchor: number; cursor: number }
  | { kind: 'pending'; berthId: string; start: number; end: number; rect: DOMRect | null }

type DragAction =
  | { type: 'anchor'; berthId: string; day: number }
  | { type: 'move'; day: number }
  | { type: 'commit'; rect: DOMRect | null }
  | { type: 'cancel' }

function dragReducer(state: DragState, action: DragAction): DragState {
  switch (action.type) {
    case 'anchor':
      return { kind: 'anchored', berthId: action.berthId, anchor: action.day, cursor: action.day }
    case 'move':
      if (state.kind !== 'anchored') return state
      if (state.cursor === action.day) return state
      return { ...state, cursor: action.day }
    case 'commit': {
      if (state.kind !== 'anchored') return state
      return {
        kind: 'pending',
        berthId: state.berthId,
        start: Math.min(state.anchor, state.cursor),
        end: Math.max(state.anchor, state.cursor),
        rect: action.rect,
      }
    }
    case 'cancel':
      return { kind: 'idle' }
  }
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function iso(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function monthLabel(year: number, month: number) {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function dayLabel(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day)).toLocaleString('en', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
}

export function ScheduleGrid({
  berths,
  vessels,
  reservations,
  initialYear,
  initialMonth,
  years,
  today,
  initialTrace = null,
}: Props) {
  const [year, setYear] = useState(initialYear)
  const [month, setMonth] = useState(initialMonth)
  const [view, setView] = useState<ScheduleView>('month')
  // Null means "follow the first occupied day of the visible month". A user
  // paging weeks sets an explicit value; changing month clears it. Derived
  // rather than synced in an effect, which read a value declared below it and
  // could leave the week view on a stale start.
  const [weekOverride, setWeekOverride] = useState<{ key: string; day: number } | null>(null)
  const [drag, dispatch] = useReducer(dragReducer, { kind: 'idle' })
  const [placedId, setPlacedId] = useState<string | null>(null)
  const [announcement, setAnnounce] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [hover, setHover] = useState<{ r: GridReservation; rect: DOMRect } | null>(null)
  // Clicking a bar pins its hull so the trace survives the pointer leaving, and
  // so keyboard and touch can reach it at all. Hover alone would be mouse-only.
  const [pinnedHull, setPinnedHull] = useState<string | null>(initialTrace)
  const hideHover = useRef<ReturnType<typeof setTimeout> | null>(null)
  const router = useRouter()

  function openHover(next: { r: GridReservation; rect: DOMRect }) {
    if (hideHover.current) clearTimeout(hideHover.current)
    setHover(next)
  }
  function closeHoverSoon() {
    if (hideHover.current) clearTimeout(hideHover.current)
    hideHover.current = setTimeout(() => setHover(null), 200)
  }

  /**
   * Identity of a stay for the purpose of tracing one hull across the grid.
   * Mirrors how the validation engine decides two rows are the same occupant:
   * vessel id when known, case-folded label when not.
   */
  const hullOf = useCallback(
    (r: GridReservation) => r.vesselId ?? r.label.trim().toUpperCase(),
    [],
  )

  // Pin wins over hover, so a pinned trace does not flicker as the pointer
  // crosses other bars on the way to reading it.
  const tracedHull = pinnedHull ?? (hover ? hullOf(hover.r) : null)

  const vesselById = useMemo(() => new Map(vessels.map((v) => [v.id, v])), [vessels])
  const berthById = useMemo(() => new Map(berths.map((b) => [b.id, b])), [berths])

  const scrollerRef = useRef<HTMLDivElement>(null)
  const nDays = daysInMonth(year, month)
  const monthKey = `${year}-${month}`
  const monthStart = Date.UTC(year, month - 1, 1)
  const monthEnd = Date.UTC(year, month - 1, nDays)

  const occupiedThisMonth = useMemo(
    () =>
      reservations.filter(
        (r) => parseDay(r.end) >= monthStart && parseDay(r.start) <= monthEnd,
      ),
    [reservations, monthStart, monthEnd],
  )

  /** First day of the month that has anything on it, so week view opens on work. */
  const firstOccupied = useMemo(() => {
    let min = Infinity
    for (const r of occupiedThisMonth) {
      const day =
        Math.floor((Math.max(parseDay(r.start), monthStart) - monthStart) / DAY_MS) + 1
      if (day < min) min = day
    }
    return Number.isFinite(min) ? min : 1
  }, [occupiedThisMonth, monthStart])

  // An explicit page through weeks wins, but only within the month it was made.
  // Changing month drops back to the first occupied day with no effect needed.
  const weekStart =
    weekOverride && weekOverride.key === monthKey ? weekOverride.day : firstOccupied
  const setWeekStart = useCallback(
    (day: number) => setWeekOverride({ key: monthKey, day }),
    [monthKey],
  )

  const firstDay = view === 'week' ? Math.min(weekStart, Math.max(1, nDays - 6)) : 1
  const visCount = view === 'week' ? Math.min(7, nDays - firstDay + 1) : nDays
  const lastDay = firstDay + visCount - 1
  const dayPx = view === 'week' ? WEEK_DAY_PX : MONTH_DAY_PX
  const visStart = Date.UTC(year, month - 1, firstDay)
  const visEnd = Date.UTC(year, month - 1, lastDay)

  // Reset horizontal scroll when the month changes, otherwise a 31-day scroll
  // offset carries into February and the view opens mid-month.
  useEffect(() => {
    scrollerRef.current?.scrollTo({ left: 0 })
  }, [year, month])

  // Keep the URL in step without a server round-trip. A navigation here would
  // remount the scroll container and throw away keyboard focus.
  useEffect(() => {
    const u = new URL(window.location.href)
    u.searchParams.set('year', String(year))
    u.searchParams.set('month', String(month))
    window.history.replaceState(null, '', u)
  }, [year, month])

  const visible = useMemo(
    () =>
      reservations.filter(
        (r) => parseDay(r.end) >= visStart && parseDay(r.start) <= visEnd,
      ),
    [reservations, visStart, visEnd],
  )

  const byBerth = useMemo(() => {
    const m = new Map<string, GridReservation[]>()
    for (const b of berths) m.set(b.id, [])
    for (const r of visible) m.get(r.berthId)?.push(r)
    return m
  }, [visible, berths])

  /**
   * Per-berth occupancy mask, one byte per day of the visible month.
   *
   * This is what makes clamping cheap: extending a drag is an O(days) scan
   * rather than a search through every reservation.
   */
  const masks = useMemo(() => {
    const m = new Map<string, Uint8Array>()
    for (const b of berths) {
      const mask = new Uint8Array(nDays + 2)
      for (const r of byBerth.get(b.id) ?? []) {
        const s = Math.max(1, (parseDay(r.start) - monthStart) / DAY_MS + 1)
        const e = Math.min(nDays, (parseDay(r.end) - monthStart) / DAY_MS + 1)
        for (let d = s; d <= e; d++) mask[d] = 1
      }
      m.set(b.id, mask)
    }
    return m
  }, [berths, byBerth, nDays, monthStart])

  /**
   * Stop the selection at the last free day between the anchor and the cursor.
   *
   * The bar simply stops growing where the berth is taken, so the rule is felt
   * at the moment of the mistake instead of being reported afterwards.
   */
  const clamp = useCallback(
    (berthId: string, anchor: number, cursor: number) => {
      const mask = masks.get(berthId)
      if (!mask) return cursor
      const step = cursor >= anchor ? 1 : -1
      let last = anchor
      for (let d = anchor; step > 0 ? d <= cursor : d >= cursor; d += step) {
        if (mask[d]) break
        last = d
      }
      return last
    },
    [masks],
  )

  const shiftMonth = useCallback(
    (delta: number) => {
      let m = month + delta
      let y = year
      if (m < 1) {
        m = 12
        y -= 1
      } else if (m > 12) {
        m = 1
        y += 1
      }
      setYear(y)
      setMonth(m)
      setWeekStart(1)
      dispatch({ type: 'cancel' })
    },
    [month, year, setWeekStart],
  )

  const shiftRange = useCallback(
    (delta: number) => {
      if (view === 'month') {
        shiftMonth(delta)
        return
      }
      let d = firstDay + delta * 7
      let m = month
      let y = year
      while (d > daysInMonth(y, m)) {
        d -= daysInMonth(y, m)
        m += 1
        if (m > 12) {
          m = 1
          y += 1
        }
      }
      while (d < 1) {
        m -= 1
        if (m < 1) {
          m = 12
          y -= 1
        }
        d += daysInMonth(y, m)
      }
      setYear(y)
      setMonth(m)
      setWeekStart(d)
      dispatch({ type: 'cancel' })
    },
    [view, firstDay, month, year, shiftMonth, setWeekStart],
  )

  // Escape clears a pinned trace. Separate from the drag handler below, which
  // only binds while a drag is live, so the two never contend for the key.
  useEffect(() => {
    if (pinnedHull === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPinnedHull(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [pinnedHull])

  // Escape cancels a drag or a pending selection. Bound only while one is live.
  useEffect(() => {
    if (drag.kind === 'idle') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dispatch({ type: 'cancel' })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drag.kind])

  const dayFromEvent = (e: React.PointerEvent<HTMLDivElement>, el: HTMLElement) => {
    const rect = el.getBoundingClientRect()
    const w = rect.width / visCount
    const d = Math.floor((e.clientX - rect.left) / w) + firstDay
    return Math.min(lastDay, Math.max(firstDay, d))
  }

  function onRowPointerDown(e: React.PointerEvent<HTMLDivElement>, berthId: string) {
    if (e.button !== 0 || !e.isPrimary) return
    const lane = e.currentTarget
    const day = dayFromEvent(e, lane)
    if (masks.get(berthId)?.[day]) return // occupied: that is the edit path
    e.preventDefault()
    lane.setPointerCapture(e.pointerId)
    dispatch({ type: 'anchor', berthId, day })
    setAnnounce(`${dayLabel(year, month, day)}, ${berthId}`)
  }

  function onRowPointerMove(e: React.PointerEvent<HTMLDivElement>, berthId: string) {
    if (drag.kind !== 'anchored' || drag.berthId !== berthId) return
    // clientY is ignored on purpose: a reservation belongs to one berth, so a
    // drag must never wander to another row.
    const raw = dayFromEvent(e, e.currentTarget)
    const day = clamp(berthId, drag.anchor, raw)
    if (day !== drag.cursor) {
      dispatch({ type: 'move', day })
      const lo = Math.min(drag.anchor, day)
      const hi = Math.max(drag.anchor, day)
      setAnnounce(
        `${dayLabel(year, month, lo)} to ${dayLabel(year, month, hi)}, ${hi - lo + 1} days`,
      )
    }
  }

  function onRowPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (drag.kind !== 'anchored') return
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // capture may already be gone; nothing to do
    }
    const lane = e.currentTarget.getBoundingClientRect()
    const w = lane.width / visCount
    const endDay = Math.max(drag.anchor, drag.cursor)
    const rect = new DOMRect(lane.left + (endDay - firstDay) * w, lane.top, w, lane.height)
    dispatch({ type: 'commit', rect })
  }

  const pending: PendingSelection | null =
    drag.kind === 'pending'
      ? {
          berthId: drag.berthId,
          start: iso(year, month, drag.start),
          end: iso(year, month, drag.end),
          anchorRect: drag.rect,
        }
      : null

  // Month view fits the viewport: 31 days at a fixed 64px is 2,252px, which
  // never fits a 1,280px screen, and the only sign it scrolled was a thin
  // paper-coloured scrollbar that macOS hides until you already know to
  // swipe. Days 17 to 31 read as cut off. Letting each day shrink to fill
  // the row removes the horizontal scroll rather than decorating it. Week
  // view keeps a fixed width because seven days always fit.
  // Days shrink to fill the row, down to a floor that keeps a one-day name
  // legible. Past the floor the grid scrolls, and the scrollbar is drawn
  // (see .grid-scroller in globals.css), so overflow is never a secret.
  const floor = view === 'week' ? dayPx : MIN_DAY_PX
  const gridCols = `repeat(${visCount}, minmax(${floor}px, 1fr))`
  const minWidth = BERTH_COL_PX + visCount * floor

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col ${drag.kind === 'anchored' ? 'dragging' : ''}`}
    >
      <MonthHeader
        year={year}
        month={month}
        years={years}
        view={view}
        onView={(v) => {
          setView(v)
          if (v === 'week') setWeekStart(firstOccupied)
        }}
        onShift={shiftRange}
        onJump={(y, m) => {
          setYear(y)
          setMonth(m)
          setWeekStart(1)
        }}
        onToday={() => {
          const [y, m] = today.split('-').map(Number)
          setYear(y)
          setMonth(m)
          setWeekStart(1)
        }}
        onReserve={() => setFormOpen(true)}
      />

      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 overflow-auto bg-panel"
        role="grid"
        data-scroller=""
        aria-label={`Berth occupancy, ${monthLabel(year, month)}`}
      >
        <div className="flex min-h-full flex-col" style={{ minWidth }}>
          <div
            className="sticky top-0 z-30 flex h-14 shrink-0 border-b border-line bg-panel"
            role="row"
          >
            <div className="sticky left-0 z-40 flex shrink-0 items-center border-r border-line bg-panel px-5 text-[11px] font-medium uppercase tracking-[0.06em] text-mute" style={{ width: BERTH_COL_PX }}>
              Berth
            </div>
            <div className="grid flex-1" style={{ gridTemplateColumns: gridCols }}>
              {Array.from({ length: visCount }, (_, i) => firstDay + i).map((d) => {
                const wd = (new Date(Date.UTC(year, month - 1, d)).getUTCDay() + 6) % 7
                const isToday = iso(year, month, d) === today
                return (
                  <div
                    key={d}
                    role="columnheader"
                    className={`tnum flex flex-col items-center justify-center text-[12px] ${
                      isToday ? 'bg-wash text-ink' : wd >= 5 ? 'text-mute/70' : 'text-mute'
                    }`}
                  >
                    <div className="text-[11px] uppercase tracking-[0.04em]">{WEEKDAY[wd]}</div>
                    <div className={`text-[14px] font-medium ${isToday ? 'text-ink' : 'text-ink'}`}>{d}</div>
                  </div>
                )
              })}
            </div>
          </div>

          {berths.map((berth) => {
            const rows = layoutLanes(byBerth.get(berth.id) ?? [], visStart, visEnd)
            const isDragRow = drag.kind === 'anchored' && drag.berthId === berth.id
            const selLo = isDragRow ? Math.min(drag.anchor, drag.cursor) : 0
            const selHi = isDragRow ? Math.max(drag.anchor, drag.cursor) : 0
            const selCol = selLo - firstDay + 1
            const selSpan = selHi - selLo + 1

            return (
              <div
                key={berth.id}
                className="flex min-h-[88px] flex-1 border-b border-line"
                role="row"
              >
                <div
                  className="sticky left-0 z-20 flex shrink-0 flex-col justify-center border-r border-line bg-panel px-5 py-3"
                  style={{ width: BERTH_COL_PX }}
                >
                  <div className="text-[14px] font-medium leading-snug text-ink">
                    {berth.name}
                  </div>
                  <div className="tnum mt-0.5 text-[13px] text-mute">
                    {berth.lengthFt != null ? `${berth.lengthFt} ft` : ''}
                  </div>
                </div>

                <div
                  className="relative flex-1 touch-pan-y"
                  onPointerDown={(e) => onRowPointerDown(e, berth.id)}
                  onPointerMove={(e) => onRowPointerMove(e, berth.id)}
                  onPointerUp={onRowPointerUp}
                  onPointerCancel={() => dispatch({ type: 'cancel' })}
                >
                  <div
                    className="absolute inset-0 grid"
                    style={{ gridTemplateColumns: gridCols }}
                    aria-hidden
                  >
                    {Array.from({ length: visCount }, (_, i) => firstDay + i).map((d) => {
                      const wd = (new Date(Date.UTC(year, month - 1, d)).getUTCDay() + 6) % 7
                      const isToday = iso(year, month, d) === today
                      return (
                        <div
                          key={d}
                          className={`border-r border-line/70 ${
                            isToday ? 'bg-wash' : wd >= 5 ? 'bg-wash/40' : ''
                          }`}
                        />
                      )
                    })}
                  </div>

                  {isDragRow && (
                    <div
                      className="pointer-events-none absolute inset-y-0 z-10 grid"
                      style={{ gridTemplateColumns: gridCols, width: '100%' }}
                      aria-hidden
                    >
                      <div
                        className="my-2 rounded bg-occupied-strong"
                        style={{ gridColumn: `${selCol} / span ${selSpan}` }}
                      />
                    </div>
                  )}

                  <div className="relative flex h-full min-h-[60px] flex-col justify-center py-1.5">
                    {rows.map((lane, li) => (
                      <div
                        key={li}
                        className="relative grid"
                        style={{ gridTemplateColumns: gridCols, minHeight: 48 }}
                      >
                        {lane.map((r) => (
                          <Bar
                            key={r.id}
                            r={r}
                            visStart={visStart}
                            visEnd={visEnd}
                            placed={placedId === r.id}
                            traced={tracedHull === null ? null : hullOf(r) === tracedHull}
                            pinned={pinnedHull !== null && hullOf(r) === pinnedHull}
                            onHover={openHover}
                            onHoverEnd={closeHoverSoon}
                            onToggleTrace={() =>
                              setPinnedHull((cur) => (cur === hullOf(r) ? null : hullOf(r)))
                            }
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {visible.length === 0 && occupiedThisMonth.length > 0 && view === 'week' && (
        <p className="px-5 py-4 text-[14px] text-mute sm:px-8">
          No stays in these seven days. Switch to month to see the rest of{' '}
          {monthLabel(year, month)}.
        </p>
      )}
      {visible.length === 0 && occupiedThisMonth.length === 0 && (
        <p className="px-5 py-4 text-[14px] text-mute sm:px-8">
          {monthStart >= Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 1)
            ? 'Nothing booked from here on. Reserve, or drag across empty days on a berth.'
            : `Nothing was booked in ${monthLabel(year, month)}.`}
        </p>
      )}

      {hover && (
        <StayTip
          r={hover.r}
          anchor={hover.rect}
          berth={berthById.get(hover.r.berthId) ?? null}
          vessel={hover.r.vesselId ? (vesselById.get(hover.r.vesselId) ?? null) : null}
          onEnter={() => {
            if (hideHover.current) clearTimeout(hideHover.current)
          }}
          onLeave={closeHoverSoon}
          onDeleted={() => {
            setHover(null)
            router.refresh()
          }}
        />
      )}

      {pending && (
        <ReservePopover
          selection={pending}
          berths={berths}
          vessels={vessels}
          onCancel={() => dispatch({ type: 'cancel' })}
          onReserved={(id) => {
            setPlacedId(id)
            dispatch({ type: 'cancel' })
            router.refresh()
          }}
        />
      )}

      {formOpen && (
        <ReserveDialog
          berths={berths}
          vessels={vessels}
          reservations={reservations}
          defaultStart={today}
          onClose={() => setFormOpen(false)}
          onReserved={(id, start) => {
            const [y, m] = start.split('-').map(Number)
            setYear(y)
            setMonth(m)
            setWeekStart(1)
            setPlacedId(id)
            setFormOpen(false)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

function Bar({
  r,
  visStart,
  visEnd,
  placed,
  traced,
  pinned,
  onHover,
  onHoverEnd,
  onToggleTrace,
}: {
  r: GridReservation
  visStart: number
  visEnd: number
  placed: boolean
  /** null when nothing is traced, true when this bar is the traced hull. */
  traced: boolean | null
  pinned: boolean
  onHover: (h: { r: GridReservation; rect: DOMRect }) => void
  onHoverEnd: () => void
  onToggleTrace: () => void
}) {
  const s = Math.max(parseDay(r.start), visStart)
  const e = Math.min(parseDay(r.end), visEnd)
  const col = (s - visStart) / DAY_MS + 1
  const span = (e - s) / DAY_MS + 1

  const clippedStart = parseDay(r.start) < visStart
  const clippedEnd = parseDay(r.end) > visEnd
  const alarm = r.conflicted || r.oversize
  const fill = alarm
    ? 'border-l-[3px] border-conflict bg-conflict/10 text-conflict'
    : r.kind === 'event'
      ? 'border-l-[3px] border-mute bg-occupied text-ink'
      : 'border-l-[3px] border-ink bg-occupied text-ink'

  // The old spreadsheet gave each regular vessel its own fill colour, which
  // answered "where else is this hull this month" at a glance. That does not
  // survive 462 vessels and one accent, so the same question is answered on
  // demand instead: the other stays recede rather than this one shouting.
  const dimmed = traced === false

  return (
    <button
      type="button"
      aria-pressed={pinned}
      className={`bar-trace relative z-[1] mx-px my-1 flex items-center overflow-hidden px-1.5 text-left ${fill} ${
        placed ? 'bar-placed' : ''
      }`}
      data-dimmed={dimmed ? '' : undefined}
      data-traced={traced === true ? '' : undefined}
      style={{
        gridColumn: `${col} / span ${span}`,
        borderTopLeftRadius: clippedStart ? 0 : 4,
        borderBottomLeftRadius: clippedStart ? 0 : 4,
        borderTopRightRadius: clippedEnd ? 0 : 4,
        borderBottomRightRadius: clippedEnd ? 0 : 4,
      }}
      onMouseEnter={(e) => onHover({ r, rect: e.currentTarget.getBoundingClientRect() })}
      onMouseLeave={onHoverEnd}
      onFocus={(e) => onHover({ r, rect: e.currentTarget.getBoundingClientRect() })}
      onBlur={onHoverEnd}
      onClick={onToggleTrace}
    >
      <span className="line-clamp-2 text-[12px] font-medium leading-snug [overflow-wrap:anywhere]">
        {clippedStart && <span className="opacity-50">‹ </span>}
        {r.kind === 'event' && <span className="font-normal text-mute">event · </span>}
        {r.label}
        {clippedEnd && <span className="opacity-50"> ›</span>}
      </span>
    </button>
  )
}

function fmtDay(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleString('en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function StayTip({
  r,
  anchor,
  berth,
  vessel,
  onEnter,
  onLeave,
  onDeleted,
}: {
  r: GridReservation
  anchor: DOMRect
  berth: BerthRow | null
  vessel: Vessel | null
  onEnter: () => void
  onLeave: () => void
  onDeleted: () => void
}) {
  const n = dayCount(r.start, r.end)
  const range =
    r.start === r.end ? fmtDay(r.start) : `${fmtDay(r.start)} to ${fmtDay(r.end)}`
  const lengthFt = vessel?.lengthFt ?? null
  const berthFt = berth?.lengthFt ?? null

  let fit: string | null = null
  if (r.kind === 'event') fit = 'Event. No length check.'
  else if (lengthFt == null) fit = 'No length on this vessel.'
  else if (berthFt == null) fit = `${lengthFt} ft. Berth length not set.`
  else if (r.oversize) fit = `Does not fit. ${lengthFt} ft on a ${berthFt} ft berth.`
  else fit = `${lengthFt} ft. Fits ${berth?.name ?? 'this berth'} (${berthFt} ft).`

  const left = Math.min(Math.max(8, anchor.left), (typeof window === 'undefined' ? 400 : window.innerWidth) - 280)
  const below = anchor.bottom + 8
  const top =
    typeof window !== 'undefined' && below + 200 > window.innerHeight
      ? Math.max(8, anchor.top - 200)
      : below

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <div
      role="dialog"
      aria-label={r.label}
      className="fixed z-[80] w-[260px] rounded-lg border border-line bg-panel px-3 py-2.5 text-ink shadow-[0_8px_24px_rgba(35,31,32,0.14)]"
      style={{ left, top }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="text-[13px] font-medium leading-snug">{r.label}</div>
      <div className="tnum mt-1 text-[12px] text-mute">
        {range}
        <span className="text-mute"> · {n} day{n === 1 ? '' : 's'}</span>
      </div>
      {berth && <div className="mt-0.5 text-[12px] leading-snug text-mute">{berth.name}</div>}
      {fit && <div className="mt-2 text-[12px] text-ink">{fit}</div>}
      {r.conflicted && (
        <div className="mt-1 text-[12px] text-conflict">Shares this berth with another stay.</div>
      )}
      {error && <p className="mt-2 text-[12px] text-conflict">{error}</p>}
      <button
        type="button"
        disabled={busy}
        className="mt-3 text-[12px] text-mute hover:text-conflict disabled:opacity-50"
        onClick={async () => {
          setBusy(true)
          setError(null)
          const res = await deleteReservation(r.id)
          if (res.status === 'ok') onDeleted()
          else {
            setError(res.message)
            setBusy(false)
          }
        }}
      >
        {busy ? 'Removing' : 'Remove stay'}
      </button>
    </div>
  )
}

/**
 * Pack bars into lanes so two overlapping bookings are never drawn on top of
 * each other. A double-booked berth therefore becomes visibly taller. Colour
 * marks kind (vessel vs event) and alarm. Shape still carries overlap.
 */
function layoutLanes(
  bars: GridReservation[],
  monthStart: number,
  monthEnd: number,
): GridReservation[][] {
  const vis = bars
    .filter((b) => parseDay(b.end) >= monthStart && parseDay(b.start) <= monthEnd)
    .sort((a, b) => parseDay(a.start) - parseDay(b.start))

  const lanes: GridReservation[][] = []
  for (const bar of vis) {
    const s = parseDay(bar.start)
    const e = parseDay(bar.end)
    let placed = false
    for (const lane of lanes) {
      if (!lane.some((o) => parseDay(o.start) <= e && s <= parseDay(o.end))) {
        lane.push(bar)
        placed = true
        break
      }
    }
    if (!placed) lanes.push([bar])
  }
  return lanes.length ? lanes : [[]]
}
