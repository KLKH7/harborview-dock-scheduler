import { getBerths, getVessels, getReservations, getYears } from '@/lib/data'
import { detectOverlaps, checkFit } from '@/lib/validation/engine'
import { ScheduleGrid, type GridReservation } from '@/components/ScheduleGrid'

export const dynamic = 'force-dynamic'

export default async function SchedulePage(props: PageProps<'/'>) {
  const params = await props.searchParams
  const years = await getYears()

  const latest = years[years.length - 1] ?? new Date().getUTCFullYear()
  const year = clamp(Number(params.year) || latest, years[0] ?? latest, latest)
  const month = clamp(Number(params.month) || 7, 1, 12)

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
    <ScheduleGrid
      berths={berths}
      vessels={vessels}
      reservations={rows}
      initialYear={year}
      initialMonth={month}
      years={years}
      today={today}
    />
  )
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(Math.max(n, lo), hi)
}
