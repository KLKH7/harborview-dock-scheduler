/**
 * Create the schema and load data/snapshot.json + data/vessels.json into Postgres.
 *
 * Idempotent: drops and rebuilds the imported tables every run, so a reviewer
 * poking at the live site can never leave it in a state the demo cannot recover
 * from. Reservations created through the app live in the same table and are
 * marked source='app', so a reseed intentionally clears them too.
 */
import { neon } from '@neondatabase/serverless'
import { readFileSync } from 'node:fs'
import { config } from 'dotenv'

config({ path: '.env.local' })

const sql = neon(process.env.DATABASE_URL!)

const PREFIX_RE = /^(R\/V|M\/V|F\/V|S\/V|M\/Y|S\/Y|OSV|Tug|Barge)\s+/i
const hullKey = (s: string) => s.replace(PREFIX_RE, '').replace(/\s+/g, ' ').trim().toUpperCase()

const snapshot = JSON.parse(readFileSync('data/snapshot.json', 'utf8'))
const vesselData = JSON.parse(readFileSync('data/vessels.json', 'utf8'))

async function main() {
  console.log('dropping and recreating tables…')
  await sql`DROP TABLE IF EXISTS reservation CASCADE`
  await sql`DROP TABLE IF EXISTS vessel CASCADE`
  await sql`DROP TABLE IF EXISTS berth CASCADE`

  await sql`
    CREATE TABLE berth (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      -- NULL means the berth's capacity is genuinely not recorded in the
      -- source (grouped areas like "North Finger Piers"). Never 0 -- that
      -- would make every vessel read as too long.
      length_ft    INTEGER,
      display_order INTEGER NOT NULL
    )`

  await sql`
    CREATE TABLE vessel (
      id            TEXT PRIMARY KEY,
      display_name  TEXT NOT NULL,
      -- NULL = length unknown. Paired with length_source so the UI can say
      -- WHY it is unknown rather than silently treating it as fine.
      length_ft     INTEGER,
      length_source TEXT NOT NULL
        CHECK (length_source IN ('roster_exact','fuzzy_hull_match','manual_override','unknown')),
      booked_days   INTEGER NOT NULL DEFAULT 0
    )`

  await sql`
    CREATE TABLE reservation (
      id              SERIAL PRIMARY KEY,
      berth_id        TEXT NOT NULL REFERENCES berth(id),
      -- DATE, not timestamp: this schedule has no notion of time of day, and
      -- timestamps would drag timezones into a purely calendar problem.
      start_date      DATE NOT NULL,
      end_date        DATE NOT NULL,
      kind            TEXT NOT NULL CHECK (kind IN ('vessel','event')),
      vessel_id       TEXT REFERENCES vessel(id),
      label           TEXT NOT NULL,
      source          TEXT NOT NULL CHECK (source IN ('spreadsheet','app')),
      source_sheet    TEXT,
      override_reason TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (end_date >= start_date)
    )`

  await sql`CREATE INDEX reservation_berth_dates ON reservation (berth_id, start_date, end_date)`

  // Berths
  const berths = snapshot.berths as { name: string; lengthFt: number | null }[]
  for (const [i, b] of berths.entries()) {
    await sql`
      INSERT INTO berth (id, name, length_ft, display_order)
      VALUES (${b.name}, ${b.name}, ${b.lengthFt}, ${i})`
  }
  console.log(`  berths: ${berths.length}`)

  // Vessels
  const vessels = vesselData.vessels as {
    hullKey: string
    displayName: string
    lengthFt: number | null
    lengthSource: string
    bookedDays: number
  }[]
  for (const v of vessels) {
    await sql`
      INSERT INTO vessel (id, display_name, length_ft, length_source, booked_days)
      VALUES (${v.hullKey}, ${v.displayName}, ${v.lengthFt}, ${v.lengthSource}, ${v.bookedDays})
      ON CONFLICT (id) DO NOTHING`
  }
  console.log(`  vessels: ${vessels.length}`)

  // Reservations, batched -- 2000+ individual round trips would be slow.
  const bookings = snapshot.bookings as {
    berth: string
    label: string
    start: string
    end: string
    kind: 'vessel' | 'event'
    sourceSheet: string
  }[]

  // Parameterised throughout -- vessel names contain apostrophes ("S/V O'Hara"
  // style) and hand-rolled quoting is how import scripts get SQL injection.
  const CHUNK = 200
  for (let i = 0; i < bookings.length; i += CHUNK) {
    const chunk = bookings.slice(i, i + CHUNK)
    const params: (string | null)[] = []
    const rows = chunk.map((b, j) => {
      const base = j * 8
      params.push(
        b.berth,
        b.start,
        b.end,
        b.kind,
        b.kind === 'vessel' ? hullKey(b.label) : null,
        b.label,
        'spreadsheet',
        b.sourceSheet,
      )
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8})`
    })
    await sql.query(
      `INSERT INTO reservation (berth_id,start_date,end_date,kind,vessel_id,label,source,source_sheet) VALUES ${rows.join(',')}`,
      params,
    )
  }
  console.log(`  reservations: ${bookings.length}`)

  const [counts] = await sql`
    SELECT
      (SELECT count(*) FROM berth)       AS berths,
      (SELECT count(*) FROM vessel)      AS vessels,
      (SELECT count(*) FROM reservation) AS reservations`
  console.log('\nin database:', counts)
}

await main()
