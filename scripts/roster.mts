/**
 * Parse vessel lengths from the Science / Yachts roster tabs and join them to
 * the schedule labels.
 *
 * The join is the hard part. The schedule and the roster disagree about vessel
 * prefixes -- the schedule says "R/V Clear Sextant", the roster says
 * "S/Y Clear Sextant 145'". Matching on the full string finds almost nothing;
 * matching on the hull name (prefix stripped) finds most of it.
 *
 * Even then a large share of scheduled vessels appear NOWHERE in the roster.
 * Their length is unknowable from this workbook, and the app must say so rather
 * than guess -- see the `unverifiable` fit status in lib/validation/engine.ts.
 */
import ExcelJS from 'exceljs'
import { readFileSync, writeFileSync } from 'node:fs'

const PREFIXES = ['R/V', 'M/V', 'F/V', 'S/V', 'M/Y', 'S/Y', 'OSV', 'Tug', 'Barge']
const PREFIX_RE = new RegExp(`^(${PREFIXES.join('|').replace(/\//g, '\\/')})\\s+`, 'i')

/** "R/V High Drift 120'" -> name + length */
const NAMED_LENGTH_RE = new RegExp(
  `^((?:${PREFIXES.join('|').replace(/\//g, '\\/')})\\s+.+?)\\s+(\\d+)\\s*'\\s*$`,
  'i',
)
const LOA_RE = /LOA:\s*(\d+)\s*'/i

export type RosterVessel = {
  canonicalName: string
  hullKey: string
  lengthFt: number
  /** A contradictory LOA note on the same roster row, if present. */
  loaFt: number | null
  sourceTab: string
}

/** Strip the prefix and normalise case/whitespace so the two tabs can be joined. */
export function hullKey(label: string): string {
  return label.replace(PREFIX_RE, '').replace(/\s+/g, ' ').trim().toUpperCase()
}

async function main() {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile('data/source.xlsx')

  const roster = new Map<string, RosterVessel>()
  const conflictingLoa: { name: string; nameLen: number; loa: number }[] = []

  for (const tab of ['Science', 'Yachts']) {
    const ws = wb.getWorksheet(tab)
    if (!ws) continue

    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)

      // The roster tabs are malformed: contact details have slid into arbitrary
      // columns and phone numbers sometimes sit in the VESSEL column. So scan
      // every cell for something shaped like a vessel name, not just column A.
      for (let c = 1; c <= ws.columnCount; c++) {
        const v = row.getCell(c).value
        if (typeof v !== 'string') continue
        const m = NAMED_LENGTH_RE.exec(v.trim())
        if (!m) continue

        const canonicalName = m[1].trim()
        const lengthFt = Number(m[2])
        const key = hullKey(canonicalName)

        // An "LOA: 65'" note on a nearby row may contradict the name length.
        let loaFt: number | null = null
        for (let rr = r; rr <= Math.min(r + 2, ws.rowCount); rr++) {
          const scan = ws.getRow(rr)
          for (let cc = 1; cc <= ws.columnCount; cc++) {
            const sv = scan.getCell(cc).value
            if (typeof sv === 'string') {
              const lm = LOA_RE.exec(sv)
              if (lm) { loaFt = Number(lm[1]); break }
            }
          }
          if (loaFt !== null) break
        }

        const existing = roster.get(key)
        if (existing) {
          // Same hull listed twice. Keep the LONGER length: a fit check that
          // errs must err toward flagging, never toward silent approval.
          if (lengthFt > existing.lengthFt) existing.lengthFt = lengthFt
        } else {
          roster.set(key, { canonicalName, hullKey: key, lengthFt, loaFt, sourceTab: tab })
        }

        if (loaFt !== null && loaFt !== lengthFt) {
          conflictingLoa.push({ name: canonicalName, nameLen: lengthFt, loa: loaFt })
        }
      }
    }
  }

  // Join against the schedule.
  const snapshot = JSON.parse(readFileSync('data/snapshot.json', 'utf8'))
  const bookings = snapshot.bookings as { label: string; kind: string; start: string; end: string }[]

  const scheduleVessels = new Map<string, { label: string; days: number }>()
  for (const b of bookings) {
    if (b.kind !== 'vessel') continue
    const key = hullKey(b.label)
    const days = (Date.parse(b.end) - Date.parse(b.start)) / 86_400_000 + 1
    const prev = scheduleVessels.get(key)
    if (prev) prev.days += days
    else scheduleVessels.set(key, { label: b.label.replace(/\s+/g, ' ').trim(), days })
  }

  const vessels: {
    hullKey: string
    displayName: string
    lengthFt: number | null
    lengthSource: 'roster_exact' | 'fuzzy_hull_match' | 'unknown'
    bookedDays: number
  }[] = []

  for (const [key, info] of scheduleVessels) {
    const match = roster.get(key)
    vessels.push({
      hullKey: key,
      displayName: info.label,
      lengthFt: match ? match.lengthFt : null,
      // Exact when the schedule label matches the roster label outright;
      // fuzzy when only the prefix-stripped hull matched.
      lengthSource: !match
        ? 'unknown'
        : match.canonicalName.toUpperCase() === info.label.toUpperCase()
          ? 'roster_exact'
          : 'fuzzy_hull_match',
      bookedDays: info.days,
    })
  }
  vessels.sort((a, b) => b.bookedDays - a.bookedDays)

  const known = vessels.filter((v) => v.lengthFt !== null)
  const unknown = vessels.filter((v) => v.lengthFt === null)

  writeFileSync(
    'data/vessels.json',
    JSON.stringify(
      {
        vessels,
        rosterSize: roster.size,
        conflictingLoa,
        stats: {
          scheduledVessels: vessels.length,
          withLength: known.length,
          withoutLength: unknown.length,
          bookedDaysWithLength: known.reduce((s, v) => s + v.bookedDays, 0),
          bookedDaysWithoutLength: unknown.reduce((s, v) => s + v.bookedDays, 0),
        },
      },
      null,
      2,
    ),
  )

  console.log(`roster vessels parsed: ${roster.size}`)
  console.log(`scheduled vessels:     ${vessels.length}`)
  console.log(`  with length:    ${known.length} (${known.reduce((s, v) => s + v.bookedDays, 0)} booked days)`)
  console.log(`  without length: ${unknown.length} (${unknown.reduce((s, v) => s + v.bookedDays, 0)} booked days)`)
  console.log(`  exact matches:  ${vessels.filter((v) => v.lengthSource === 'roster_exact').length}`)
  console.log(`  fuzzy matches:  ${vessels.filter((v) => v.lengthSource === 'fuzzy_hull_match').length}`)
  console.log(`contradictory LOA notes: ${conflictingLoa.length}`)
  console.log('\ntop unknown-length vessels by booked days:')
  for (const v of unknown.slice(0, 10)) {
    console.log(`   ${String(v.bookedDays).padStart(4)}d  ${v.displayName}`)
  }
}

await main()
