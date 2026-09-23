import 'server-only'
import { sql } from './db'
import {
  detectOverlaps,
  checkFit,
  dayCount,
  type Berth,
  type Reservation,
  type Vessel,
  type Conflict,
  type FitFinding,
} from './validation/engine'
import { hullKey } from './vessel-name'

export type BerthRow = Berth & { displayOrder: number }

export async function getBerths(): Promise<BerthRow[]> {
  const rows = (await sql`
    SELECT id, name, length_ft, display_order FROM berth ORDER BY display_order
  `) as Record<string, unknown>[]
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    lengthFt: r.length_ft === null ? null : Number(r.length_ft),
    displayOrder: Number(r.display_order),
  }))
}

export async function getVessels(): Promise<Vessel[]> {
  const rows = (await sql`
    SELECT id, display_name, length_ft, length_source FROM vessel ORDER BY display_name
  `) as Record<string, unknown>[]
  return rows.map((r) => ({
    id: r.id as string,
    displayName: r.display_name as string,
    lengthFt: r.length_ft === null ? null : Number(r.length_ft),
    lengthSource: r.length_source as Vessel['lengthSource'],
  }))
}

function toReservation(r: Record<string, unknown>): Reservation & {
  source: string
  overrideReason: string | null
} {
  return {
    id: String(r.id),
    berthId: r.berth_id as string,
    start: (r.start_date as Date).toISOString().slice(0, 10),
    end: (r.end_date as Date).toISOString().slice(0, 10),
    kind: r.kind as 'vessel' | 'event',
    vesselId: (r.vessel_id as string | null) ?? null,
    label: r.label as string,
    source: r.source as string,
    overrideReason: (r.override_reason as string | null) ?? null,
  }
}

export async function getReservations(from?: string, to?: string) {
  const rows =
    from && to
      ? ((await sql`
          SELECT id, berth_id, start_date, end_date, kind, vessel_id, label, source, override_reason
          FROM reservation
          WHERE start_date <= ${to}::date AND end_date >= ${from}::date
          ORDER BY start_date`) as Record<string, unknown>[])
      : ((await sql`
          SELECT id, berth_id, start_date, end_date, kind, vessel_id, label, source, override_reason
          FROM reservation
          ORDER BY start_date`) as Record<string, unknown>[])
  return rows.map(toReservation)
}

export type Findings = {
  conflicts: Conflict[]
  fits: { reservation: Reservation; fit: FitFinding }[]
  stats: {
    reservations: number
    conflicts: number
    conflictViolations: number
    conflictWarnings: number
    fitsCount: number
    oversizedCount: number
    unverifiableCount: number
    eventCount: number
    unverifiableBookedDays: number
    yearsCovered: number
    firstDate: string
    lastDate: string
  }
}

/**
 * Run the SAME validation engine the booking form uses across the whole
 * archive. There is no second implementation of these rules.
 */
export async function getFindings(): Promise<Findings> {
  const [berths, vessels, reservations] = await Promise.all([
    getBerths(),
    getVessels(),
    getReservations(),
  ])

  const berthById = new Map(berths.map((b) => [b.id, b]))
  const vesselById = new Map(vessels.map((v) => [v.id, v]))

  const conflicts = detectOverlaps(reservations)
  const fits = reservations.map((r) => {
    const berth = berthById.get(r.berthId)!
    const vessel = r.vesselId ? (vesselById.get(r.vesselId) ?? null) : null
    return { reservation: r, fit: checkFit(vessel, berth) }
  })

  const oversized = fits.filter((f) => f.fit.status === 'violation')
  const unverifiable = fits.filter((f) => f.fit.status === 'unverifiable')
  const dates = reservations.map((r) => r.start).sort()
  const firstDate = dates[0] ?? ''
  const lastDate = reservations.reduce((mx, r) => (r.end > mx ? r.end : mx), '')

  return {
    conflicts,
    fits,
    stats: {
      reservations: reservations.length,
      conflicts: conflicts.length,
      conflictViolations: conflicts.filter((c) => c.severity === 'violation').length,
      conflictWarnings: conflicts.filter((c) => c.severity === 'warning').length,
      fitsCount: fits.filter((f) => f.fit.status === 'fits').length,
      oversizedCount: oversized.length,
      unverifiableCount: unverifiable.length,
      eventCount: fits.filter((f) => f.fit.status === 'not_applicable').length,
      unverifiableBookedDays: unverifiable.reduce(
        (s, f) => s + dayCount(f.reservation.start, f.reservation.end),
        0,
      ),
      yearsCovered:
        firstDate && lastDate ? Number(lastDate.slice(0, 4)) - Number(firstDate.slice(0, 4)) + 1 : 0,
      firstDate,
      lastDate,
    },
  }
}

/** Vessels with no recorded length, ranked by how much schedule they occupy.
 *  This is a worklist: fixing the top few unlocks the most verification. */
export async function getUnknownLengthVessels(limit = 40) {
  const rows = (await sql`
    SELECT v.id, v.display_name, v.booked_days, count(r.id) AS bookings
    FROM vessel v
    LEFT JOIN reservation r ON r.vessel_id = v.id
    WHERE v.length_ft IS NULL
    GROUP BY v.id, v.display_name, v.booked_days
    ORDER BY v.booked_days DESC
    LIMIT ${limit}
  `) as Record<string, unknown>[]
  return rows.map((r) => ({
    id: r.id as string,
    displayName: r.display_name as string,
    bookedDays: Number(r.booked_days),
    bookings: Number(r.bookings),
  }))
}

/** Vessels whose length came from a prefix-stripped match rather than an exact
 *  one. Surfaced so a human can confirm or reject each inference. */
export async function getFuzzyMatches() {
  const rows = (await sql`
    SELECT id, display_name, length_ft
    FROM vessel
    WHERE length_source = 'fuzzy_hull_match'
    ORDER BY booked_days DESC
  `) as Record<string, unknown>[]
  return rows.map((r) => ({
    id: r.id as string,
    displayName: r.display_name as string,
    lengthFt: Number(r.length_ft),
  }))
}

/**
 * Years the coordinator can open. Archive years plus the current year and
 * two ahead, so 2026 is a real month you can book into, not a wall after 2019.
 */
/** Last day that has a booking. The schedule opens here so imported history is visible. */
export async function getLatestOccupancyDate(): Promise<string | null> {
  const rows = (await sql`
    SELECT max(end_date)::text AS d FROM reservation
  `) as Record<string, unknown>[]
  const d = rows[0]?.d
  return typeof d === 'string' && d ? d.slice(0, 10) : null
}

export async function getYears(): Promise<number[]> {
  const rows = (await sql`
    SELECT
      min(extract(year FROM start_date))::int AS lo,
      max(extract(year FROM start_date))::int AS hi
    FROM reservation
  `) as Record<string, unknown>[]
  const now = new Date().getUTCFullYear()
  const lo = Number(rows[0]?.lo) || now
  const hi = Math.max(Number(rows[0]?.hi) || now, now + 2)
  const years: number[] = []
  for (let y = lo; y <= hi; y++) years.push(y)
  return years
}

export async function findVesselByHull(name: string): Promise<Vessel | null> {
  const key = hullKey(name)
  const vessels = await getVessels()
  return vessels.find((v) => hullKey(v.displayName) === key) ?? null
}

export async function insertVessel(displayName: string, lengthFt: number | null): Promise<Vessel> {
  const id = `app_${crypto.randomUUID()}`
  const lengthSource = lengthFt != null ? 'manual_override' : 'unknown'
  await sql`
    INSERT INTO vessel (id, display_name, length_ft, length_source)
    VALUES (${id}, ${displayName}, ${lengthFt}, ${lengthSource})
  `
  return { id, displayName, lengthFt, lengthSource }
}
