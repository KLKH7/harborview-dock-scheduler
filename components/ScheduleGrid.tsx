import Link from 'next/link'
import type { BerthRow } from '@/lib/data'
import { parseDay, dayCount, type Reservation, type FitStatus } from '@/lib/validation/engine'

const DAY_MS = 86_400_000

export type GridBar = {
  reservation: Reservation
  fitStatus: FitStatus
  conflicted: boolean
}

type Props = {
  berths: BerthRow[]
  year: number
  month: number
  bars: GridBar[]
}

const WEEKDAY = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/** Colour is meaning here, so it is driven by finding severity -- not by the
 *  arbitrary fill colours the original spreadsheet used. */
function barClasses(bar: GridBar): string {
  if (bar.conflicted) return 'bg-red-600 text-white ring-1 ring-red-800'
  if (bar.fitStatus === 'violation') return 'bg-amber-500 text-white ring-1 ring-amber-700'
  if (bar.reservation.kind === 'event') return 'bg-slate-500 text-white ring-1 ring-slate-700'
  if (bar.fitStatus === 'unverifiable') return 'bg-sky-100 text-sky-900 ring-1 ring-sky-300'
  return 'bg-emerald-600 text-white ring-1 ring-emerald-800'
}

export function ScheduleGrid({ berths, year, month, bars }: Props) {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const monthStart = Date.UTC(year, month - 1, 1)
  const monthEnd = Date.UTC(year, month - 1, daysInMonth)
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)

  const byBerth = new Map<string, GridBar[]>()
  for (const bar of bars) {
    const list = byBerth.get(bar.reservation.berthId)
    if (list) list.push(bar)
    else byBerth.set(bar.reservation.berthId, [bar])
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full border-collapse text-xs" style={{ minWidth: 940 }}>
        <thead>
          <tr>
            <th className="sticky left-0 z-10 w-52 min-w-52 border-b border-r border-slate-200 bg-slate-100 px-3 py-2 text-left font-semibold">
              Berth
            </th>
            {days.map((d) => {
              const wd = (new Date(Date.UTC(year, month - 1, d)).getUTCDay() + 6) % 7
              const weekend = wd >= 5
              return (
                <th
                  key={d}
                  className={`border-b border-slate-200 px-0 py-1 text-center font-normal tabular-nums ${
                    weekend ? 'bg-slate-100 text-slate-400' : 'bg-white text-slate-500'
                  }`}
                >
                  <div>{d}</div>
                  <div className="text-[9px] text-slate-400">{WEEKDAY[wd]}</div>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {berths.map((berth) => {
            const rows = layoutLanes(byBerth.get(berth.id) ?? [], monthStart, monthEnd)
            return (
              <tr key={berth.id} className="align-top">
                <th className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-3 py-2 text-left font-medium">
                  <div className="truncate">{berth.name}</div>
                  <div className="text-[10px] font-normal text-slate-500">
                    {berth.lengthFt === null ? 'length not recorded' : `${berth.lengthFt}′`}
                  </div>
                </th>
                <td colSpan={daysInMonth} className="border-b border-slate-200 p-0">
                  <div className="relative" style={{ minHeight: 30 }}>
                    {/* day gridlines */}
                    <div
                      className="absolute inset-0 grid"
                      style={{ gridTemplateColumns: `repeat(${daysInMonth}, minmax(0,1fr))` }}
                      aria-hidden
                    >
                      {days.map((d) => {
                        const wd = (new Date(Date.UTC(year, month - 1, d)).getUTCDay() + 6) % 7
                        return (
                          <div
                            key={d}
                            className={`border-r border-slate-100 ${wd >= 5 ? 'bg-slate-50' : ''}`}
                          />
                        )
                      })}
                    </div>

                    {rows.map((lane, li) => (
                      <div
                        key={li}
                        className="relative grid"
                        style={{
                          gridTemplateColumns: `repeat(${daysInMonth}, minmax(0,1fr))`,
                          height: 26,
                        }}
                      >
                        {lane.map((bar) => {
                          const s = Math.max(parseDay(bar.reservation.start), monthStart)
                          const e = Math.min(parseDay(bar.reservation.end), monthEnd)
                          const startCol = (s - monthStart) / DAY_MS + 1
                          const span = (e - s) / DAY_MS + 1
                          const total = dayCount(bar.reservation.start, bar.reservation.end)
                          return (
                            <div
                              key={bar.reservation.id}
                              className={`z-[1] m-[2px] flex items-center overflow-hidden rounded px-1 ${barClasses(bar)}`}
                              style={{ gridColumn: `${startCol} / span ${span}` }}
                              title={`${bar.reservation.label}\n${bar.reservation.start} → ${bar.reservation.end} (${total} day${total === 1 ? '' : 's'})${
                                bar.conflicted ? '\n⚠ DOUBLE-BOOKED' : ''
                              }${bar.fitStatus === 'violation' ? '\n⚠ vessel exceeds berth length' : ''}${
                                bar.fitStatus === 'unverifiable' ? '\nvessel length unknown — not verified' : ''
                              }`}
                            >
                              <span className="truncate whitespace-nowrap text-[10px] leading-none">
                                {bar.reservation.label}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Pack bars into as few visual rows as possible without letting two overlapping
 * bars land in the same row. Overlaps are the thing we are trying to make
 * visible, so they must never be drawn on top of each other.
 */
function layoutLanes(bars: GridBar[], monthStart: number, monthEnd: number): GridBar[][] {
  const visible = bars
    .filter((b) => parseDay(b.reservation.end) >= monthStart && parseDay(b.reservation.start) <= monthEnd)
    .sort((a, b) => parseDay(a.reservation.start) - parseDay(b.reservation.start))

  const lanes: GridBar[][] = []
  for (const bar of visible) {
    const s = parseDay(bar.reservation.start)
    const e = parseDay(bar.reservation.end)
    let placed = false
    for (const lane of lanes) {
      const clash = lane.some(
        (o) => parseDay(o.reservation.start) <= e && s <= parseDay(o.reservation.end),
      )
      if (!clash) {
        lane.push(bar)
        placed = true
        break
      }
    }
    if (!placed) lanes.push([bar])
  }
  return lanes.length ? lanes : [[]]
}

export function Legend() {
  const items = [
    ['bg-emerald-600', 'Verified fit'],
    ['bg-sky-100 ring-1 ring-sky-300', 'Length unknown — unverified'],
    ['bg-amber-500', 'Vessel exceeds berth'],
    ['bg-red-600', 'Double-booked'],
    ['bg-slate-500', 'Facility event'],
  ] as const
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600">
      {items.map(([cls, label]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className={`inline-block h-3 w-5 rounded ${cls}`} />
          {label}
        </span>
      ))}
    </div>
  )
}

export function MonthNav({
  year,
  month,
  years,
}: {
  year: number
  month: number
  years: number[]
}) {
  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 }
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 }
  const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en', {
    month: 'long',
    timeZone: 'UTC',
  })
  const canPrev = years.includes(prev.y)
  const canNext = years.includes(next.y)

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1">
        {canPrev ? (
          <Link
            href={`/?year=${prev.y}&month=${prev.m}`}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-sm hover:bg-slate-100"
          >
            ←
          </Link>
        ) : (
          <span className="rounded border border-slate-200 px-2 py-1 text-sm text-slate-300">←</span>
        )}
        <div className="min-w-44 text-center text-lg font-semibold">
          {monthName} {year}
        </div>
        {canNext ? (
          <Link
            href={`/?year=${next.y}&month=${next.m}`}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-sm hover:bg-slate-100"
          >
            →
          </Link>
        ) : (
          <span className="rounded border border-slate-200 px-2 py-1 text-sm text-slate-300">→</span>
        )}
      </div>

      <form className="flex items-center gap-2 text-sm">
        <select
          name="year"
          defaultValue={year}
          className="rounded border border-slate-300 bg-white px-2 py-1"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <select
          name="month"
          defaultValue={month}
          className="rounded border border-slate-300 bg-white px-2 py-1"
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {new Date(Date.UTC(2000, m - 1, 1)).toLocaleString('en', {
                month: 'short',
                timeZone: 'UTC',
              })}
            </option>
          ))}
        </select>
        <button className="rounded border border-slate-300 bg-white px-3 py-1 hover:bg-slate-100">
          Go
        </button>
      </form>
    </div>
  )
}
