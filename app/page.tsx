import { getBerths, getVessels, getReservations, getYears, getLatestOccupancyDate } from '@/lib/data'
import { detectOverlaps, checkFit } from '@/lib/validation/engine'
import { ScheduleGrid, type GridReservation } from '@/components/ScheduleGrid'

export const dynamic = 'force-dynamic'

export default async function SchedulePage(props: PageProps<'/'>) {
  const params = await props.searchParams
  const [years, lastOccupied] = await Promise.all([getYears(), getLatestOccupancyDate()])

  const now = new Date()
  const fallback = lastOccupied ?? now.toISOString().slice(0, 10)
  const latest = years[years.length - 1] ?? now.getUTCFullYear()
  const year = clamp(
    Number(params.year) || Number(fallback.slice(0, 4)),
    years[0] ?? latest,
    latest,
  )
  const month = clamp(Number(params.month) || Number(fallback.slice(5, 7)), 1, 12)

  // Serve a window wider than the month so a stay starting in the previous
  // month still draws, and still takes part in conflict detection.
  const [berths, vessels, reservations] = await Promise.all([
    getBerths(),
    getVessels(),
    getReservations(`${year - 1}-11-01`, `${year + 1}-02-28`),
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

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScheduleGrid
        berths={berths}
        vessels={vessels}
        reservations={rows}
        initialYear={year}
        initialMonth={month}
        years={years}
        today={today}
      />
    </div>
  )
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(Math.max(n, lo), hi)
}
