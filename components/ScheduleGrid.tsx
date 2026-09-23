'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { BerthRow } from '@/lib/data'
import { parseDay, dayCount, type Reservation, type Vessel } from '@/lib/validation/engine'
import { ReservePopover, type PendingSelection } from './ReservePopover'
import { ReserveDialog } from './ReserveDialog'
import { MonthHeader, type ScheduleView } from './MonthHeader'

const DAY_MS = 86_400_000
const WEEKDAY = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const BERTH_COL_PX = 220
const MONTH_DAY_PX = 64
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
}: Props) {
  const [year, setYear] = useState(initialYear)
  const [month, setMonth] = useState(initialMonth)
  const [view, setView] = useState<ScheduleView>('month')
  const [weekStart, setWeekStart] = useState(1)
  const [drag, dispatch] = useReducer(dragReducer, { kind: 'idle' })
  const [placedId, setPlacedId] = useState<string | null>(null)
  const [announcement, setAnnounce] = useState('')
  const [formOpen, setFormOpen] = useState(false)

  const scrollerRef = useRef<HTMLDivElement>(null)
  const nDays = daysInMonth(year, month)
  const firstDay = view === 'week' ? Math.min(weekStart, Math.max(1, nDays - 6)) : 1
  const visCount = view === 'week' ? Math.min(7, nDays - firstDay + 1) : nDays
  const lastDay = firstDay + visCount - 1
  const dayPx = view === 'week' ? WEEK_DAY_PX : MONTH_DAY_PX
  const monthStart = Date.UTC(year, month - 1, 1)
  const monthEnd = Date.UTC(year, month - 1, nDays)
  const visStart = Date.UTC(year, month - 1, firstDay)
  const visEnd = Date.UTC(year, month - 1, lastDay)

  // Reset horizontal scroll when the month changes, otherwise a 31-day scroll
  // offset carries into February and the view opens mid-month.
  useEffect(() => {
    scrollerRef.current?.scrollTo({ left: 0 })
  }, [year, month])

  useEffect(() => {
    if (view === 'week') setWeekStart(firstOccupied)
  }, [year, month])

  // Keep the URL in step without a server round-trip. A navigation here would
  // remount the scroll container and throw away keyboard focus.
  useEffect(() => {
    const u = new URL(window.location.href)
    u.searchParams.set('year', String(year))
    u.searchParams.set('month', String(month))
    window.history.replaceState(null, '', u)
  }, [year, month])

  const occupiedThisMonth = useMemo(
    () =>
      reservations.filter(
        (r) => parseDay(r.end) >= monthStart && parseDay(r.start) <= monthEnd,
      ),
    [reservations, monthStart, monthEnd],
  )

  const firstOccupied = useMemo(() => {
    let min = Infinity
    for (const r of occupiedThisMonth) {
      const day =
        Math.floor((Math.max(parseDay(r.start), monthStart) - monthStart) / DAY_MS) + 1
      if (day < min) min = day
    }
    return Number.isFinite(min) ? min : 1
  }, [occupiedThisMonth, monthStart])

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
    [month, year],
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
    [view, firstDay, month, year, shiftMonth],
  )

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

  const gridCols = `repeat(${visCount}, minmax(${dayPx}px, 1fr))`
  const minWidth = BERTH_COL_PX + visCount * dayPx

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
        aria-label={`Berth occupancy, ${monthLabel(year, month)}`}
      >
        <div className="flex min-h-full flex-col" style={{ minWidth }}>
          <div
            className="sticky top-0 z-30 flex h-12 shrink-0 border-b border-line bg-panel"
            role="row"
          >
            <div className="sticky left-0 z-40 shrink-0 border-r border-line bg-panel px-4 py-2 text-[11px] font-medium uppercase tracking-[0.06em] text-mute" style={{ width: BERTH_COL_PX }}>
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
                      isToday ? 'bg-today text-sea' : wd >= 5 ? 'text-mute/70' : 'text-mute'
                    }`}
                  >
                    <div className="text-[10px] uppercase tracking-[0.04em]">{WEEKDAY[wd]}</div>
                    <div className={`text-[13px] font-medium ${isToday ? 'text-sea' : 'text-ink'}`}>{d}</div>
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
                className="flex min-h-[76px] flex-1 border-b border-line"
                role="row"
              >
                <div
                  className="sticky left-0 z-20 flex shrink-0 flex-col justify-center border-r border-line bg-panel px-4 py-3"
                  style={{ width: BERTH_COL_PX }}
                >
                  <div className="truncate text-[14px] font-medium tracking-[-0.03em] text-ink">
                    {berth.name}
                  </div>
                  <div className="tnum mt-0.5 text-[12px] text-mute">
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
                            isToday ? 'bg-today' : wd >= 5 ? 'bg-wash/40' : ''
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
        <p className="px-5 py-3 text-[13px] text-mute sm:px-8">
          No stays in these seven days. Switch to month to see the rest of{' '}
          {monthLabel(year, month)}.
        </p>
      )}
      {visible.length === 0 && occupiedThisMonth.length === 0 && (
        <p className="px-5 py-3 text-[13px] text-mute sm:px-8">
          Nothing booked this month. Reserve, or drag across empty days on a berth.
        </p>
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
          }}
        />
      )}

      {formOpen && (
        <ReserveDialog
          berths={berths}
          vessels={vessels}
          defaultStart={today}
          onClose={() => setFormOpen(false)}
          onReserved={(id, start) => {
            const [y, m] = start.split('-').map(Number)
            setYear(y)
            setMonth(m)
            setWeekStart(1)
            setPlacedId(id)
            setFormOpen(false)
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
}: {
  r: GridReservation
  visStart: number
  visEnd: number
  placed: boolean
}) {
  const s = Math.max(parseDay(r.start), visStart)
  const e = Math.min(parseDay(r.end), visEnd)
  const col = (s - visStart) / DAY_MS + 1
  const span = (e - s) / DAY_MS + 1
  const total = dayCount(r.start, r.end)

  const clippedStart = parseDay(r.start) < visStart
  const clippedEnd = parseDay(r.end) > visEnd
  const flag = r.conflicted ? 'conflict' : r.oversize ? 'too long for berth' : ''
  const alarm = r.conflicted || r.oversize
  const fill = alarm
    ? 'border-l-[3px] border-conflict bg-conflict/10 text-conflict'
    : r.kind === 'event'
      ? 'border-l-[3px] border-event bg-event-fill text-event'
      : 'border-l-[3px] border-sea bg-sea-fill text-sea'

  return (
    <div
      className={`relative z-[1] mx-px my-1 flex items-center overflow-hidden px-2.5 ${fill} ${
        placed ? 'bar-placed' : ''
      }`}
      style={{
        gridColumn: `${col} / span ${span}`,
        borderTopLeftRadius: clippedStart ? 0 : 4,
        borderBottomLeftRadius: clippedStart ? 0 : 4,
        borderTopRightRadius: clippedEnd ? 0 : 4,
        borderBottomRightRadius: clippedEnd ? 0 : 4,
      }}
      title={`${r.label}. ${r.start} to ${r.end}, ${total} day${total === 1 ? '' : 's'}.${
        flag ? ` ${flag}.` : ''
      }`}
    >
      <span className="truncate whitespace-nowrap text-[12px] font-medium leading-none tracking-[-0.02em]">
        {clippedStart && <span className="opacity-50">‹ </span>}
        {r.label}
        {clippedEnd && <span className="opacity-50"> ›</span>}
      </span>
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
