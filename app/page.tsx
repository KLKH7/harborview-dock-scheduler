import Link from 'next/link'
import { getBerths, getVessels, getReservations, getYears } from '@/lib/data'
import { detectOverlaps, checkFit } from '@/lib/validation/engine'
import { ScheduleGrid, Legend, MonthNav, type GridBar } from '@/components/ScheduleGrid'

export const dynamic = 'force-dynamic'

export default async function SchedulePage(props: PageProps<'/'>) {
  const params = await props.searchParams
  const years = await getYears()

  const latest = years[years.length - 1] ?? new Date().getUTCFullYear()
  const year = clamp(Number(params.year) || latest, years[0] ?? latest, latest)
  const month = clamp(Number(params.month) || 7, 1, 12)

  // Pull a window wider than the month so a stay that starts in the previous
  // month still renders (and still participates in conflict detection).
  const from = `${year - 1}-12-01`
  const to = `${year + 1}-01-31`

  const [berths, vessels, reservations] = await Promise.all([
    getBerths(),
    getVessels(),
    getReservations(from, to),
  ])

  const vesselById = new Map(vessels.map((v) => [v.id, v]))
  const berthById = new Map(berths.map((b) => [b.id, b]))

  const conflicts = detectOverlaps(reservations)
  const conflicted = new Set<string>()
  for (const c of conflicts) {
    conflicted.add(c.a.id)
    conflicted.add(c.b.id)
  }

  const bars: GridBar[] = reservations.map((r) => {
    const berth = berthById.get(r.berthId)!
    const vessel = r.vesselId ? (vesselById.get(r.vesselId) ?? null) : null
    return {
      reservation: r,
      fitStatus: checkFit(vessel, berth).status,
      conflicted: conflicted.has(r.id),
    }
  })

  const monthBars = bars.filter(
    (b) =>
      b.reservation.end >= `${year}-${String(month).padStart(2, '0')}-01` &&
      b.reservation.start <= `${year}-${String(month).padStart(2, '0')}-31`,
  )
  const issuesThisMonth = monthBars.filter(
    (b) => b.conflicted || b.fitStatus === 'violation',
  ).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Pier &amp; dock schedule</h1>
          <p className="mt-1 text-sm text-slate-600">
            The same grid the coordinator used — but every booking is checked for double-booking
            and berth fit as it is drawn.
          </p>
        </div>
        <MonthNav year={year} month={month} years={years} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Legend />
        {issuesThisMonth > 0 ? (
          <Link
            href="/conflicts"
            className="rounded-md bg-red-50 px-3 py-1.5 text-sm font-medium text-red-800 ring-1 ring-red-200 hover:bg-red-100"
          >
            {issuesThisMonth} issue{issuesThisMonth === 1 ? '' : 's'} flagged this month →
          </Link>
        ) : (
          <span className="text-sm text-slate-500">No issues flagged this month</span>
        )}
      </div>

      <ScheduleGrid berths={berths} year={year} month={month} bars={bars} />

      <p className="text-xs text-slate-500">
        Bookings are inclusive of both start and end dates. A bar that touches the next bar shares
        a day with it — that is a same-day turnaround, and it is reported rather than hidden.
      </p>
    </div>
  )
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(Math.max(n, lo), hi)
}
