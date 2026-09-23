import 'server-only'
import { sql } from './db'
import {
  detectOverlaps,
  detectDoubleAssignment,
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

export type StoredReservation = Reservation & {
  source: string
  overrideReason: string | null
  /** Stable across imports for archive rows; null for app rows. */
  sourceKey: string | null
}

function toReservation(r: Record<string, unknown>): StoredReservation {
  return {
    id: String(r.id),
    berthId: r.berth_id as string,
    // DATE comes back as text (selected with ::text). The driver would otherwise
    // parse it as LOCAL midnight, and toISOString() would then shift every stay
    // a day early on any host east of UTC. Vercel is UTC and hid this.
    start: String(r.start_date).slice(0, 10),
    end: String(r.end_date).slice(0, 10),
    kind: r.kind as 'vessel' | 'event',
    vesselId: (r.vessel_id as string | null) ?? null,
    label: r.label as string,
    source: r.source as string,
    overrideReason: (r.override_reason as string | null) ?? null,
    sourceKey: (r.source_key as string | null) ?? null,
  }
}

export async function getReservations(from?: string, to?: string) {
  const rows =
    from && to
      ? ((await sql`
          SELECT id, berth_id, start_date::text, end_date::text, kind, vessel_id, label, source, override_reason, source_key
          FROM reservation
          WHERE start_date <= ${to}::date AND end_date >= ${from}::date
          ORDER BY start_date`) as Record<string, unknown>[])
      : ((await sql`
          SELECT id, berth_id, start_date::text, end_date::text, kind, vessel_id, label, source, override_reason, source_key
          FROM reservation
          ORDER BY start_date`) as Record<string, unknown>[])
  return rows.map(toReservation)
}

export type Findings = {
  /** Two things in one berth. */
  conflicts: Conflict[]
  /** One vessel in two berths. */
  crossBerth: Conflict[]
  fits: { reservation: StoredReservation; fit: FitFinding }[]
  reservations: StoredReservation[]
  dispositions: Map<string, Disposition>
  today: string
  stats: {
    reservations: number
    conflicts: number
    crossBerthViolations: number
    crossBerthShifts: number
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
export async function getFindings(today = new Date().toISOString().slice(0, 10)): Promise<Findings> {
  const [berths, vessels, reservations, dispositions] = await Promise.all([
    getBerths(),
    getVessels(),
    getReservations(),
    getDispositions(),
  ])

  const berthById = new Map(berths.map((b) => [b.id, b]))
  const vesselById = new Map(vessels.map((v) => [v.id, v]))

  const conflicts = detectOverlaps(reservations)
  const crossBerth = detectDoubleAssignment(reservations)
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
    crossBerth,
    fits,
    reservations,
    dispositions,
    today,
    stats: {
      reservations: reservations.length,
      conflicts: conflicts.length,
      crossBerthViolations: crossBerth.filter((c) => c.severity === 'violation').length,
      crossBerthShifts: crossBerth.filter((c) => c.severity === 'warning').length,
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
  const rows = (await sql`
    SELECT id, display_name, length_ft, length_source FROM vessel WHERE hull_key = ${hullKey(name)}
  `) as Record<string, unknown>[]
  const r = rows[0]
  if (!r) return null
  return {
    id: r.id as string,
    displayName: r.display_name as string,
    lengthFt: r.length_ft === null ? null : Number(r.length_ft),
    lengthSource: r.length_source as Vessel['lengthSource'],
  }
}

/**
 * The SQL for adding a vessel, as a statement, so createReservation can run
 * it inside the same transaction as the stay. ON CONFLICT on hull_key makes
 * two concurrent adds of the same name converge on one row instead of two.
 */
export function upsertVesselStatement(displayName: string, lengthFt: number | null) {
  const id = `app_${crypto.randomUUID()}`
  const lengthSource = lengthFt != null ? 'manual_override' : 'unknown'
  return sql`
    INSERT INTO vessel (id, display_name, length_ft, length_source, hull_key)
    VALUES (${id}, ${displayName}, ${lengthFt}, ${lengthSource}, ${hullKey(displayName)})
    ON CONFLICT (hull_key) DO UPDATE SET display_name = vessel.display_name
    RETURNING id, display_name, length_ft, length_source`
}

export async function insertVessel(displayName: string, lengthFt: number | null): Promise<Vessel> {
  const rows = (await upsertVesselStatement(displayName, lengthFt)) as Record<string, unknown>[]
  const r = rows[0]
  return {
    id: r.id as string,
    displayName: r.display_name as string,
    lengthFt: r.length_ft === null ? null : Number(r.length_ft),
    lengthSource: r.length_source as Vessel['lengthSource'],
  }
}

// ---------------------------------------------------------------------------
// The desk: what is true today.
// ---------------------------------------------------------------------------

export type DayBoard = {
  today: string
  inPort: StoredReservation[]
  arriving: StoredReservation[]
  departing: StoredReservation[]
  next7: StoredReservation[]
  freeTonight: BerthRow[]
  berthCount: number
  /** Bounds of what the archive covers, for the "Archive covers …" line. */
  archive: { first: string; last: string } | null
}

/**
 * The 8am questions: who is alongside, who arrives, who leaves, what is free.
 * Four indexed queries. Cheap and date-dependent, so computed per request.
 */
export async function getDayBoard(today: string): Promise<DayBoard> {
  const cols = 'id, berth_id, start_date::text, end_date::text, kind, vessel_id, label, source, override_reason, source_key'
  const [inPort, arriving, departing, next7, berths, bounds] = await Promise.all([
    sql.query(`SELECT ${cols} FROM reservation WHERE start_date <= $1::date AND end_date >= $1::date ORDER BY berth_id`, [today]),
    sql.query(`SELECT ${cols} FROM reservation WHERE start_date = $1::date ORDER BY berth_id`, [today]),
    sql.query(`SELECT ${cols} FROM reservation WHERE end_date = $1::date ORDER BY berth_id`, [today]),
    sql.query(`SELECT ${cols} FROM reservation WHERE start_date > $1::date AND start_date <= $1::date + 7 ORDER BY start_date`, [today]),
    getBerths(),
    sql`SELECT min(start_date)::text AS first, max(end_date)::text AS last FROM reservation WHERE source = 'spreadsheet'`,
  ])
  const port = (inPort as Record<string, unknown>[]).map(toReservation)
  const occupied = new Set(port.map((r) => r.berthId))
  const b = (bounds as Record<string, unknown>[])[0]
  return {
    today,
    inPort: port,
    arriving: (arriving as Record<string, unknown>[]).map(toReservation),
    departing: (departing as Record<string, unknown>[]).map(toReservation),
    next7: (next7 as Record<string, unknown>[]).map(toReservation),
    freeTonight: berths.filter((x) => !occupied.has(x.id)),
    berthCount: berths.length,
    archive: b?.first ? { first: String(b.first).slice(0, 10), last: String(b.last).slice(0, 10) } : null,
  }
}

export type Disposition = { fingerprint: string; status: 'accepted' | 'data_error' | 'resolved'; note: string | null; decidedAt: string }

export async function getDispositions(): Promise<Map<string, Disposition>> {
  const rows = (await sql`SELECT fingerprint, status, note, decided_at::text AS decided_at FROM finding_disposition`) as Record<string, unknown>[]
  return new Map(rows.map((r) => [r.fingerprint as string, {
    fingerprint: r.fingerprint as string,
    status: r.status as Disposition['status'],
    note: (r.note as string | null) ?? null,
    decidedAt: String(r.decided_at),
  }]))
}

export type ChangeEntry = { id: string; at: string; tbl: string; rowId: string; op: string; old: Record<string, unknown> | null; new: Record<string, unknown> | null }

export async function getRecentChanges(limit = 20): Promise<ChangeEntry[]> {
  const rows = (await sql`
    SELECT id, at::text AS at, tbl, row_id, op, old, new FROM change_log
    WHERE NOT (op = 'INSERT' AND (new->>'source') = 'spreadsheet')  -- imports are not edits
      AND NOT (op = 'UPDATE' AND tbl = 'vessel' AND (old->>'length_ft') IS NOT DISTINCT FROM (new->>'length_ft'))
    ORDER BY id DESC LIMIT ${limit}
  `) as Record<string, unknown>[]
  return rows.map((r) => ({
    id: String(r.id), at: String(r.at), tbl: r.tbl as string, rowId: r.row_id as string, op: r.op as string,
    old: (r.old as Record<string, unknown> | null) ?? null, new: (r.new as Record<string, unknown> | null) ?? null,
  }))
}

export type ImportRun = {
  id: number
  importedAt: string
  stats: Record<string, unknown>
}

/** The most recent import, which is where the five numbers about the source live now. */
export async function getLatestImport(): Promise<ImportRun | null> {
  const rows = (await sql`
    SELECT id, imported_at::text AS imported_at, stats FROM import_run ORDER BY id DESC LIMIT 1
  `) as Record<string, unknown>[]
  const r = rows[0]
  if (!r) return null
  return { id: Number(r.id), importedAt: String(r.imported_at), stats: (r.stats as Record<string, unknown>) ?? {} }
}
