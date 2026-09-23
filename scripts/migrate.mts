/**
 * Schema. Idempotent, and it never drops.
 *
 * `npm run seed` used to DROP every table on each run, which was fine for a
 * demo and wrong for a desk: it destroyed every stay the coordinator had made
 * in the app. Schema now lives here and only ever adds; data lives in
 * import.mts and upserts.
 *
 * Run: npm run migrate
 */
import { neon } from '@neondatabase/serverless'
import { config } from 'dotenv'

config({ path: '.env.local' })
const sql = neon(process.env.DATABASE_URL!)

async function main() {
  // Exclusion constraints over a text column need btree operators inside GiST.
  await sql`CREATE EXTENSION IF NOT EXISTS btree_gist`

  await sql`
    CREATE TABLE IF NOT EXISTS berth (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      -- NULL means the berth's capacity is not recorded in the source. Never 0.
      length_ft     INTEGER,
      display_order INTEGER NOT NULL
    )`

  await sql`
    CREATE TABLE IF NOT EXISTS vessel (
      id            TEXT PRIMARY KEY,
      display_name  TEXT NOT NULL,
      -- NULL = length unknown, paired with length_source so the UI can say why.
      length_ft     INTEGER,
      length_source TEXT NOT NULL
        CHECK (length_source IN ('roster_exact','fuzzy_hull_match','manual_override','unknown')),
      booked_days   INTEGER NOT NULL DEFAULT 0
    )`
  // Identity. The prefix-stripped, case-folded hull name. Before this column
  // existed, resolving a typed name meant loading all 431 rows and comparing
  // in JS; now it is an index lookup, and the UNIQUE makes insert race-safe.
  await sql`ALTER TABLE vessel ADD COLUMN IF NOT EXISTS hull_key TEXT`
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS vessel_hull_key ON vessel (hull_key)`

  await sql`
    CREATE TABLE IF NOT EXISTS import_run (
      id           SERIAL PRIMARY KEY,
      file_sha256  TEXT,
      imported_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      stats        JSONB
    )`

  await sql`
    CREATE TABLE IF NOT EXISTS reservation (
      id              SERIAL PRIMARY KEY,
      berth_id        TEXT NOT NULL REFERENCES berth(id),
      -- DATE, not timestamp. This schedule has no time of day.
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
  // Stable identity for an archive row across re-imports. SERIAL ids are
  // reassigned by any reseed, so nothing durable (a disposition, a log entry,
  // a link) may reference them for spreadsheet rows.
  await sql`ALTER TABLE reservation ADD COLUMN IF NOT EXISTS source_key TEXT`
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS reservation_source_key ON reservation (source_key)`
  await sql`ALTER TABLE reservation ADD COLUMN IF NOT EXISTS import_run_id INTEGER REFERENCES import_run(id)`
  // The archive contains 8 rows that genuinely overlap another row in the same
  // berth. They are history and must stay. Flagging them lets the constraint
  // below apply to every other row, and to every row the app will ever add.
  await sql`ALTER TABLE reservation ADD COLUMN IF NOT EXISTS legacy_overlap BOOLEAN NOT NULL DEFAULT false`

  await sql`CREATE INDEX IF NOT EXISTS reservation_berth_dates ON reservation (berth_id, start_date, end_date)`
  await sql`CREATE INDEX IF NOT EXISTS reservation_end_start ON reservation (end_date, start_date)`

  // The guarantee. Until this existed, "refuses a double-booking" was only
  // true when two requests happened not to interleave: the JS engine read,
  // validated, and inserted with nothing at the database holding the line.
  // daterange(..., '[]') is inclusive on both ends, which is exactly the
  // engine's semantics, so the two can never disagree about what overlaps.
  const has = (await sql`
    SELECT 1 FROM pg_constraint WHERE conname = 'reservation_no_double_booking'
  `) as unknown[]
  if (has.length === 0) {
    // Rows already in the table that overlap each other must be flagged first,
    // or the constraint refuses to attach. Pure SQL so migrate has no
    // dependency on the engine: a self-join on inclusive ranges.
    await sql`
      UPDATE reservation r SET legacy_overlap = true
      FROM reservation o
      WHERE r.berth_id = o.berth_id AND r.id <> o.id
        AND daterange(r.start_date, r.end_date, '[]') && daterange(o.start_date, o.end_date, '[]')`
    await sql`
      ALTER TABLE reservation ADD CONSTRAINT reservation_no_double_booking
        EXCLUDE USING gist (berth_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
        WHERE (NOT legacy_overlap)`
  }

  // A finding is derived by the engine on every read; this table records the
  // human's answer to it. Keyed by a fingerprint built from source_key (or an
  // app id) so it survives re-imports. Oversize is keyed by (hull, berth)
  // pair, because 113 stays of one vessel in one berth is one decision.
  await sql`
    CREATE TABLE IF NOT EXISTS finding_disposition (
      fingerprint  TEXT PRIMARY KEY,
      status       TEXT NOT NULL CHECK (status IN ('accepted','data_error','resolved')),
      note         TEXT,
      decided_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )`

  // Trail. A trigger, so no code path can forget to write it. `old` holds the
  // whole row, which makes "undo remove" a one-line action later.
  await sql`
    CREATE TABLE IF NOT EXISTS change_log (
      id      BIGSERIAL PRIMARY KEY,
      at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      tbl     TEXT NOT NULL,
      row_id  TEXT NOT NULL,
      op      TEXT NOT NULL,
      old     JSONB,
      new     JSONB
    )`
  await sql`
    CREATE OR REPLACE FUNCTION log_change() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO change_log (tbl, row_id, op, old, new)
      VALUES (TG_TABLE_NAME, coalesce(NEW.id, OLD.id)::text, TG_OP, to_jsonb(OLD), to_jsonb(NEW));
      RETURN NULL;
    END $$`
  await sql`DROP TRIGGER IF EXISTS reservation_log ON reservation`
  await sql`
    CREATE TRIGGER reservation_log AFTER INSERT OR UPDATE OR DELETE ON reservation
    FOR EACH ROW EXECUTE FUNCTION log_change()`
  await sql`DROP TRIGGER IF EXISTS vessel_log ON vessel`
  await sql`
    CREATE TRIGGER vessel_log AFTER INSERT OR UPDATE OR DELETE ON vessel
    FOR EACH ROW EXECUTE FUNCTION log_change()`

  const [c] = (await sql`
    SELECT
      (SELECT count(*) FROM pg_constraint WHERE conname = 'reservation_no_double_booking') AS guard,
      (SELECT count(*) FROM pg_trigger WHERE tgname IN ('reservation_log','vessel_log')) AS triggers,
      (SELECT count(*) FROM pg_extension WHERE extname = 'btree_gist') AS gist
  `) as Record<string, unknown>[]
  console.log('migrated:', c)
}

await main()
