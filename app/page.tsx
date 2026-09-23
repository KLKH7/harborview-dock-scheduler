import { getBerths, getVessels, getReservations, getYears, getDayBoard } from '@/lib/data'
import { detectOverlaps, checkFit } from '@/lib/validation/engine'
import { ScheduleGrid, type GridReservation } from '@/components/ScheduleGrid'
import { DayBoard } from '@/components/DayBoard'

export const dynamic = 'force-dynamic'

export default async function SchedulePage(props: PageProps<'/'>) {
  const params = await props.searchParams
  const today = new Date().toISOString().slice(0, 10)
  const [years, board] = await Promise.all([getYears(), getDayBoard(today)])

  // Open on today. The archive is reached by navigating back, never by
  // landing on a month seven years ago because it happens to hold data.
  const latest = years[years.length - 1] ?? Number(today.slice(0, 4))
  const year = clamp(Number(params.year) || Number(today.slice(0, 4)), years[0] ?? latest, latest)
  const month = clamp(Number(params.month) || Number(today.slice(5, 7)), 1, 12)
  const trace = typeof params.trace === 'string' && params.trace ? params.trace : null

  // Load the whole schedule. Month changes are client-side and must not
  // require a refetch; a 2k-row import is small enough to keep in memory.
  const [berths, vessels, reservations] = await Promise.all([
    getBerths(),
    getVessels(),
    getReservations(),
  ])

  const vesselById = new Map(vessels.map((v) => [v.id, v]))
  const berthById = new Map(berths.map((b) => [b.id, b]))

  const conflicted = new Set<string>()
  for (const c of detectOverlaps(reservations)) {
    conflicted.add(c.a.id)
    conflicted.add(c.b.id)
  }

  const rows: GridReservation[] = reservations.map((r) => ({
    ...r,
    conflicted: conflicted.has(r.id),
    oversize:
      checkFit(r.vesselId ? (vesselById.get(r.vesselId) ?? null) : null, berthById.get(r.berthId)!)
        .status === 'violation',
  }))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DayBoard board={board} />
      <ScheduleGrid
        berths={berths}
        vessels={vessels}
        reservations={rows}
        initialYear={year}
        initialMonth={month}
        years={years}
        today={today}
        initialTrace={trace}
      />
    </div>
  )
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(Math.max(n, lo), hi)
}
