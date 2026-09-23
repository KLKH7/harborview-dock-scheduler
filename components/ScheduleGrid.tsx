'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { BerthRow } from '@/lib/data'
import { parseDay, dayCount, type Reservation, type Vessel } from '@/lib/validation/engine'
import { ReservePopover, type PendingSelection } from './ReservePopover'
import { MonthHeader } from './MonthHeader'

const DAY_MS = 86_400_000
const WEEKDAY = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const MIN_DAY_PX = 30

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
  const [drag, dispatch] = useReducer(dragReducer, { kind: 'idle' })
  const [placedId, setPlacedId] = useState<string | null>(null)
  const [announcement, setAnnounce] = useState('')

  const scrollerRef = useRef<HTMLDivElement>(null)
  const nDays = daysInMonth(year, month)
  const monthStart = Date.UTC(year, month - 1, 1)
  const monthEnd = Date.UTC(year, month - 1, nDays)

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
        (r) => parseDay(r.end) >= monthStart && parseDay(r.start) <= monthEnd,
      ),
    [reservations, monthStart, monthEnd],
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
      dispatch({ type: 'cancel' })
    },
    [month, year],
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
    const w = rect.width / nDays
    const d = Math.floor((e.clientX - rect.left) / w) + 1
    return Math.min(nDays, Math.max(1, d))
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
    const w = lane.width / nDays
    const endDay = Math.max(drag.anchor, drag.cursor)
    const rect = new DOMRect(lane.left + (endDay - 1) * w, lane.top, w, lane.height)
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

  const gridCols = `repeat(${nDays}, minmax(${MIN_DAY_PX}px, 1fr))`

  return (
    <div className={drag.kind === 'anchored' ? 'dragging' : undefined}>
      <MonthHeader
        year={year}
        month={month}
        years={years}
        onShift={shiftMonth}
        onJump={(y, m) => {
          setYear(y)
          setMonth(m)
        }}
      />

      <div
        ref={scrollerRef}
        className="overflow-auto border-y border-line bg-panel"
        role="grid"
        aria-label={`Berth occupancy, ${monthLabel(year, month)}`}
      >
        <div style={{ minWidth: 120 + nDays * MIN_DAY_PX }}>
          {/* Day header */}
          <div
            className="sticky top-0 z-30 flex border-b border-line bg-panel"
            role="row"
          >
            <div className="sticky left-0 z-40 w-[120px] shrink-0 border-r border-line bg-panel px-3 py-1.5 sm:w-[200px] text-[11px] uppercase tracking-wide text-mute">
              Berth
            </div>
            <div className="grid flex-1" style={{ gridTemplateColumns: gridCols }}>
              {Array.from({ length: nDays }, (_, i) => i + 1).map((d) => {
                const wd = (new Date(Date.UTC(year, month - 1, d)).getUTCDay() + 6) % 7
                const isToday = iso(year, month, d) === today
                return (
                  <div
                    key={d}
                    role="columnheader"
                    className={`tnum py-1 text-center text-[11px] ${
                      isToday ? 'bg-wash text-ink' : wd >= 5 ? 'text-mute/60' : 'text-mute'
                    }`}
                  >
                    <div>{d}</div>
                    <div className="text-[9px] text-mute/60">{WEEKDAY[wd]}</div>
                  </div>
                )
              })}
            </div>
          </div>

          {berths.map((berth) => {
            const rows = layoutLanes(byBerth.get(berth.id) ?? [], monthStart, monthEnd)
            const isDragRow = drag.kind === 'anchored' && drag.berthId === berth.id
            const selLo = isDragRow ? Math.min(drag.anchor, drag.cursor) : 0
            const selHi = isDragRow ? Math.max(drag.anchor, drag.cursor) : 0

            return (
              <div key={berth.id} className="flex border-b border-line" role="row">
                <div className="sticky left-0 z-20 w-[120px] shrink-0 border-r border-line bg-panel px-3 py-2 sm:w-[200px]">
                  <div className="truncate text-[13px] text-ink">{berth.name}</div>
                  <div className="tnum text-[11px] text-mute">
                    {berth.lengthFt === null ? 'length not recorded' : `${berth.lengthFt} ft`}
                  </div>
                </div>

                <div
                  className="relative flex-1 touch-pan-y"
                  onPointerDown={(e) => onRowPointerDown(e, berth.id)}
                  onPointerMove={(e) => onRowPointerMove(e, berth.id)}
                  onPointerUp={onRowPointerUp}
                  onPointerCancel={() => dispatch({ type: 'cancel' })}
                >
                  {/* day columns */}
                  <div
                    className="absolute inset-0 grid"
                    style={{ gridTemplateColumns: gridCols }}
                    aria-hidden
                  >
                    {Array.from({ length: nDays }, (_, i) => i + 1).map((d) => {
                      const isToday = iso(year, month, d) === today
                      return (
                        <div
                          key={d}
                          className={`border-r border-line/60 ${isToday ? 'bg-wash' : ''}`}
                        />
                      )
                    })}
                  </div>

                  {/* live selection */}
                  {isDragRow && (
                    <div
                      className="pointer-events-none absolute inset-y-0 z-10 grid"
                      style={{ gridTemplateColumns: gridCols, width: '100%' }}
                      aria-hidden
                    >
                      <div
                        className="my-[3px] rounded-[3px] bg-occupied-strong"
                        style={{ gridColumn: `${selLo} / span ${selHi - selLo + 1}` }}
                      />
                    </div>
                  )}

                  <div className="relative" style={{ minHeight: 30 }}>
                    {rows.map((lane, li) => (
                      <div
                        key={li}
                        className="relative grid"
                        style={{ gridTemplateColumns: gridCols, height: 28 }}
                      >
                        {lane.map((r) => (
                          <Bar
                            key={r.id}
                            r={r}
                            monthStart={monthStart}
                            monthEnd={monthEnd}
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
    </div>
  )
}

function Bar({
  r,
  monthStart,
  monthEnd,
  placed,
}: {
  r: GridReservation
  monthStart: number
  monthEnd: number
  placed: boolean
}) {
  const s = Math.max(parseDay(r.start), monthStart)
  const e = Math.min(parseDay(r.end), monthEnd)
  const col = (s - monthStart) / DAY_MS + 1
  const span = (e - s) / DAY_MS + 1
  const total = dayCount(r.start, r.end)

  // A stay that runs off either edge of the month gets a square edge there, so
  // "continues" is legible from the shape without an extra element.
  const clippedStart = parseDay(r.start) < monthStart
  const clippedEnd = parseDay(r.end) > monthEnd
  const flag = r.conflicted ? 'conflict' : r.oversize ? 'too long for berth' : ''

  return (
    <div
      className={`relative z-[1] my-[3px] flex items-center overflow-hidden px-1.5 ${
        r.conflicted || r.oversize
          ? 'border-l-2 border-conflict bg-occupied'
          : 'bg-occupied'
      } ${placed ? 'bar-placed' : ''}`}
      style={{
        gridColumn: `${col} / span ${span}`,
        borderTopLeftRadius: clippedStart ? 0 : 3,
        borderBottomLeftRadius: clippedStart ? 0 : 3,
        borderTopRightRadius: clippedEnd ? 0 : 3,
        borderBottomRightRadius: clippedEnd ? 0 : 3,
      }}
      title={`${r.label}. ${r.start} to ${r.end}, ${total} day${total === 1 ? '' : 's'}.${
        flag ? ` ${flag}.` : ''
      }`}
    >
      <span className="truncate whitespace-nowrap text-[11px] leading-none text-ink">
        {clippedStart && <span className="text-mute">‹ </span>}
        {r.kind === 'event' && <span className="text-mute">event </span>}
        {r.label}
        {clippedEnd && <span className="text-mute"> ›</span>}
      </span>
    </div>
  )
}

/**
 * Pack bars into lanes so two overlapping bookings are never drawn on top of
 * each other. A double-booked berth therefore becomes visibly taller, which
 * makes the conflict legible from the shape of the row before any colour is
 * read. That matters here because the palette has one accent, so colour cannot
 * carry the state on its own.
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
