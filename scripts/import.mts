/**
 * Load data/snapshot.json and data/vessels.json into Postgres. Upserts only.
 *
 * Re-running this is safe: archive rows match on source_key, vessels on
 * hull_key, and rows the coordinator made in the app are never touched. A
 * length the coordinator corrected by hand survives a re-import; the roster
 * value does not overwrite it.
 *
 * Run: npm run import   (after npm run migrate)
 */
import { neon } from '@neondatabase/serverless'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { config } from 'dotenv'
import { hullKey } from '../lib/vessel-name'
import { detectOverlaps, sharedDayCount, type Reservation } from '../lib/validation/engine'

config({ path: '.env.local' })
const sql = neon(process.env.DATABASE_URL!)

const snapshot = JSON.parse(readFileSync('data/snapshot.json', 'utf8'))
const vesselData = JSON.parse(readFileSync('data/vessels.json', 'utf8'))

type Booking = { berth: string; label: string; start: string; end: string; kind: 'vessel' | 'event'; sourceSheet: string }

/** Deterministic identity for an archive row. Same sheet cell, same key, every import. */
export function sourceKeyOf(b: Booking): string {
  return createHash('sha256')
    .update([b.sourceSheet, b.berth, b.start, b.end, b.label.trim().toUpperCase()].join('|'))
    .digest('hex')
    .slice(0, 24)
}

async function main() {
  const bookings = snapshot.bookings as Booking[]
  const fileSha = createHash('sha256').update(readFileSync('data/snapshot.json')).digest('hex')

  // Berths
  const berths = snapshot.berths as { name: string; lengthFt: number | null }[]
  for (const [i, b] of berths.entries()) {
    await sql`
      INSERT INTO berth (id, name, length_ft, display_order)
      VALUES (${b.name}, ${b.name}, ${b.lengthFt}, ${i})
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, display_order = EXCLUDED.display_order`
  }

  // Vessels, batched. Roster vessels use the hull key as their id, so the
  // conflict target is the primary key; that also lets this pass backfill
  // hull_key onto rows imported before the column existed. A manual_override
  // length is the coordinator's word and beats the roster on re-import.
  const vessels = vesselData.vessels as {
    hullKey: string; displayName: string; lengthFt: number | null; lengthSource: string; bookedDays: number
  }[]
  const CHUNK = 200
  for (let i = 0; i < vessels.length; i += CHUNK) {
    const chunk = vessels.slice(i, i + CHUNK)
    const params: (string | number | null)[] = []
    const rows = chunk.map((v, j) => {
      const b = j * 6
      params.push(v.hullKey, v.displayName, v.lengthFt, v.lengthSource, v.bookedDays, hullKey(v.displayName))
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`
    })
    await sql.query(
      `INSERT INTO vessel (id, display_name, length_ft, length_source, booked_days, hull_key)
       VALUES ${rows.join(',')}
       ON CONFLICT (id) DO UPDATE SET
         hull_key      = EXCLUDED.hull_key,
         display_name  = EXCLUDED.display_name,
         booked_days   = EXCLUDED.booked_days,
         length_ft     = CASE WHEN vessel.length_source = 'manual_override' THEN vessel.length_ft ELSE EXCLUDED.length_ft END,
         length_source = CASE WHEN vessel.length_source = 'manual_override' THEN vessel.length_source ELSE EXCLUDED.length_source END`,
      params,
    )
  }

  // Which archive rows overlap another row in the same berth, any occupant.
  // Those 8 are exempted from the exclusion constraint; everything else, and
  // everything the app adds, is held to it.
  const asRes: Reservation[] = bookings.map((b, i) => ({
    id: String(i), berthId: b.berth, start: b.start, end: b.end, kind: b.kind,
    vesselId: b.kind === 'vessel' ? hullKey(b.label) : null, label: b.label,
  }))
  const legacy = new Set<string>()
  const byBerth = new Map<string, Reservation[]>()
  for (const r of asRes) (byBerth.get(r.berthId) ?? byBerth.set(r.berthId, []).get(r.berthId)!).push(r)
  for (const list of byBerth.values())
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++)
        if (sharedDayCount(list[i], list[j]) > 0) { legacy.add(list[i].id); legacy.add(list[j].id) }

  const [run] = (await sql`
    INSERT INTO import_run (file_sha256, stats) VALUES (${fileSha}, ${JSON.stringify({
      ...snapshot.stats,
      staleWeekdayBlocks: snapshot.staleWeekdayBlocks ?? [],
      legacyOverlapRows: legacy.size,
      sameBerthConflicts: detectOverlaps(asRes).length,
    })}::jsonb) RETURNING id
  `) as { id: number }[]
  const runId = run.id

  // Reservations, batched, keyed by source_key so a re-import updates in place.
  for (let i = 0; i < bookings.length; i += CHUNK) {
    const chunk = bookings.slice(i, i + CHUNK)
    const params: (string | number | boolean | null)[] = []
    const rows = chunk.map((b, j) => {
      const base = j * 11
      const idx = i + j
      params.push(
        b.berth, b.start, b.end, b.kind,
        b.kind === 'vessel' ? hullKey(b.label) : null,
        b.label, 'spreadsheet', b.sourceSheet,
        sourceKeyOf(b), runId, legacy.has(String(idx)),
      )
      return `($${base + 1},$${base + 2}::date,$${base + 3}::date,$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11})`
    })
    await sql.query(
      `INSERT INTO reservation
         (berth_id, start_date, end_date, kind, vessel_id, label, source, source_sheet, source_key, import_run_id, legacy_overlap)
       VALUES ${rows.join(',')}
       ON CONFLICT (source_key) DO UPDATE SET
         berth_id = EXCLUDED.berth_id, start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date,
         kind = EXCLUDED.kind, vessel_id = EXCLUDED.vessel_id, label = EXCLUDED.label,
         import_run_id = EXCLUDED.import_run_id, legacy_overlap = EXCLUDED.legacy_overlap`,
      params,
    )
  }

  // Archive rows that vanished from the sheet go; app rows are never touched.
  const gone = (await sql`
    DELETE FROM reservation
    WHERE source = 'spreadsheet' AND (import_run_id IS DISTINCT FROM ${runId})
    RETURNING id
  `) as unknown[]

  const [c] = (await sql`
    SELECT
      (SELECT count(*) FROM reservation) AS reservations,
      (SELECT count(*) FROM reservation WHERE source = 'app') AS app_rows,
      (SELECT count(*) FROM reservation WHERE legacy_overlap) AS legacy_overlap,
      (SELECT count(*) FROM vessel) AS vessels,
      (SELECT count(*) FROM vessel WHERE length_source = 'manual_override') AS manual_lengths
  `) as Record<string, unknown>[]
  console.log(`import run ${runId}: removed ${gone.length} stale archive rows`)
  console.log('in database:', c)
}

await main()
