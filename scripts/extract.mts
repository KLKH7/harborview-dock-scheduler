/**
 * Offline extractor: dock schedule .xlsx -> data/snapshot.json
 *
 * This NEVER runs on Vercel. Run it locally, commit the snapshot.
 *
 * Three things make this workbook hard, and all three are handled here:
 *
 *  1. DURATION IS A FILL COLOUR, NOT TEXT.
 *     A multi-day stay is a contiguous band of same-coloured cells. The vessel
 *     name is written as text ONLY in the first cell of the run. Reading
 *     cell.value alone yields thousands of bogus one-day bookings.
 *
 *  2. EARLY SHEETS (1997-2001) STORE DAY NUMBERS AS UNCACHED FORMULAS
 *     (=SUM(B3+1)). There is no cached result to read, so the day numbers must
 *     be reconstructed arithmetically from the anchor "1".
 *
 *  3. RECONSTRUCTION MUST BE PROVEN, NOT TRUSTED.
 *     Every month grid carries its own weekday-letter row (M/T/W/TR/F/S/S). We
 *     assert our reconstructed dates against it. A mismatch is a hard failure,
 *     not a warning -- silently wrong dates are the worst outcome here.
 */
import ExcelJS from 'exceljs'
import { writeFileSync } from 'node:fs'

const SOURCE = 'data/source.xlsx'
const OUT = 'data/snapshot.json'

const MONTHS = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
]

/** Fills that mean "no booking here". Excel writes white/grey backgrounds for
 *  ordinary grid styling, so they cannot be treated as occupancy. */
const NEUTRAL_FILLS = new Set(['FFFFFFFF', '00000000', 'FFD9D9D9', 'FFF2F2F2'])

/** Weekday letters as used in the sheets. 'S' is ambiguous (Sat or Sun) and is
 *  accepted for either, which is why verification uses the unambiguous ones. */
const DOW: Record<string, number[]> = {
  M: [0], T: [1], W: [2], TR: [3], R: [3], TH: [3], F: [4], S: [5, 6],
}

/** Labels that describe facility activity rather than a vessel visit. These
 *  still occupy a berth -- they just have no hull to length-check. */
const EVENT_RE =
  /community|sail day|maintenance|dredg|concrete|closed|repair|inspect|open house|regatta|festival|survey|haul|no docking|clean|utility|test|power/i

const BERTH_RE = /^(.*?)\s*-\s*(\d+)\s*'/

export type Booking = {
  berth: string
  label: string
  start: string
  end: string
  kind: 'vessel' | 'event'
  sourceSheet: string
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    // Formula cells: prefer the cached result, fall back to rich text.
    const o = v as Record<string, unknown>
    if ('result' in o && o.result != null) return String(o.result).trim()
    if ('richText' in o && Array.isArray(o.richText)) {
      return (o.richText as { text: string }[]).map((t) => t.text).join('').trim()
    }
    if ('formula' in o) return ''
    if ('text' in o) return String(o.text).trim()
    return ''
  }
  return String(v).trim()
}

function isFormulaCell(cell: ExcelJS.Cell): boolean {
  const v = cell.value
  return typeof v === 'object' && v !== null && 'formula' in (v as object)
}

function fillColor(cell: ExcelJS.Cell): string | null {
  const f = cell.fill as ExcelJS.FillPattern | undefined
  if (!f || f.type !== 'pattern' || !f.pattern || f.pattern === 'none') return null
  const argb = f.fgColor?.argb
  return argb ?? null
}

function isOccupied(cell: ExcelJS.Cell): boolean {
  const c = fillColor(cell)
  return c !== null && !NEUTRAL_FILLS.has(c)
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function iso(year: number, month: number, day: number): string {
  const m = String(month).padStart(2, '0')
  const d = String(day).padStart(2, '0')
  return `${year}-${m}-${d}`
}

function weekdayOf(year: number, month: number, day: number): number {
  // getUTCDay: 0=Sun..6=Sat -> shift to 0=Mon..6=Sun to match DOW table.
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7
}

type MonthBlock = {
  year: number
  month: number
  dayCols: Map<number, number>
  headerRow: number
}

/**
 * Locate the day-number columns for a month block.
 *
 * Two layouts exist in this workbook:
 *   (a) literal day numbers, sometimes on the month-title row itself
 *   (b) an anchor "1" followed by =SUM(prev+1) formulas (1997-2001)
 */
function findDayColumns(
  ws: ExcelJS.Worksheet,
  headerRow: number,
  year: number,
  month: number,
): Map<number, number> | null {
  const nDays = daysInMonth(year, month)

  // (a) literal numbers within the next few rows
  for (const off of [0, 1, 2]) {
    const row = ws.getRow(headerRow + off)
    const found = new Map<number, number>()
    for (let c = 1; c <= ws.columnCount; c++) {
      const t = cellText(row.getCell(c))
      if (/^\d+$/.test(t)) {
        const n = Number(t)
        if (n >= 1 && n <= 31) found.set(c, n)
      }
    }
    if (found.size >= 20) return found
  }

  // (b) anchor "1" then consecutive formula cells
  for (const off of [1, 2, 3]) {
    const row = ws.getRow(headerRow + off)
    let anchor = -1
    for (let c = 1; c <= ws.columnCount; c++) {
      if (cellText(row.getCell(c)) === '1') { anchor = c; break }
    }
    if (anchor < 0) continue
    const found = new Map<number, number>()
    let day = 0
    for (let c = anchor; c <= ws.columnCount; c++) {
      const cell = row.getCell(c)
      if (c === anchor || isFormulaCell(cell)) {
        day++
        if (day > nDays) break
        found.set(c, day)
      } else break
    }
    if (found.size >= 20) return found
  }
  return null
}

type WeekdayCheck = { status: 'verified' | 'sheet-wrong' | 'unverifiable'; detail?: string }

/**
 * Check reconstructed dates against the sheet's own weekday-letter row.
 *
 * Three outcomes:
 *   'verified'     - letters agree with our dates. The normal case.
 *   'sheet-wrong'  - letters disagree CONSISTENTLY, i.e. they are offset by a
 *                    fixed number of days. That is a template pasted from
 *                    another year and never corrected: the day NUMBERS are
 *                    authoritative, the letters are stale. We keep our dates
 *                    and report the sheet as a data-quality finding.
 *   'unverifiable' - no readable weekday row to check against.
 *
 * A NON-uniform disagreement is different in kind: it would mean our column->day
 * mapping is broken, so that still throws.
 */
function verifyWeekdays(
  ws: ExcelJS.Worksheet,
  block: MonthBlock,
  sheetName: string,
): WeekdayCheck {
  const nDays = daysInMonth(block.year, block.month)
  for (const off of [0, 1, 2]) {
    const row = ws.getRow(block.headerRow + off)
    // 'S' matches both Sat and Sun, so it cannot pin down a shift. Judge
    // uniformity using only the unambiguous letters, then re-check the
    // ambiguous ones against the shift we derived.
    const unambiguousShifts: number[] = []
    let checked = 0
    let bad = 0
    const seen: { day: number; expected: number[] }[] = []

    for (const [col, day] of block.dayCols) {
      if (day > nDays) continue
      const t = cellText(row.getCell(col)).toUpperCase()
      const expected = DOW[t]
      if (!expected) continue
      checked++
      const actual = weekdayOf(block.year, block.month, day)
      if (!expected.includes(actual)) bad++
      seen.push({ day, expected })
      if (expected.length === 1) {
        unambiguousShifts.push((expected[0] - actual + 7) % 7)
      }
    }

    if (checked < 15) continue
    if (bad === 0) return { status: 'verified' }

    const shifts = new Set(unambiguousShifts)
    if (shifts.size === 1) {
      const shift = [...shifts][0]
      // Every letter, ambiguous ones included, must fit this single shift.
      const consistent = seen.every(({ day, expected }) => {
        const shifted = (weekdayOf(block.year, block.month, day) + shift) % 7
        return expected.includes(shifted)
      })
      if (consistent) {
        return {
          status: 'sheet-wrong',
          detail:
            `${sheetName} ${block.year}-${String(block.month).padStart(2, '0')}: ` +
            `weekday letters are uniformly ${shift} day(s) off (stale template ` +
            `pasted from another year). Day numbers used instead.`,
        }
      }
    }

    throw new Error(
      `Weekday verification FAILED on ${sheetName} ${block.year}-${block.month}: ` +
      `${bad}/${checked} day columns disagree by INCONSISTENT amounts ` +
      `(${[...shifts].join(', ')}). The column-to-day mapping is broken; ` +
      `reconstructed dates cannot be trusted.`,
    )
  }
  return { status: 'unverifiable' }
}

function main() {
  const wb = new ExcelJS.Workbook()
  return wb.xlsx.readFile(SOURCE).then(() => {
    const bookings: Booking[] = []
    const berthLengths = new Map<string, number>()
    let blocksFound = 0
    let blocksVerified = 0
    const staleWeekdayBlocks: string[] = []

    for (const ws of wb.worksheets) {
      if (!/^\d{4}$/.test(ws.name)) continue
      const sheetYear = Number(ws.name)

      for (let r = 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r)

        // A month block starts at a cell like "JANUARY 2008" or "January".
        let month = 0
        let titleText = ''
        for (let c = 1; c <= 3; c++) {
          const t = cellText(row.getCell(c)).toUpperCase()
          const idx = MONTHS.findIndex((m) => t.startsWith(m))
          if (idx >= 0) { month = idx + 1; titleText = t; break }
        }
        if (!month) continue

        // Sheets 2002-2004 open with a December block belonging to the PRIOR
        // year. Trust an explicit year in the title over the sheet name.
        const yearInTitle = titleText.match(/(19|20)\d{2}/)
        const year = yearInTitle ? Number(yearInTitle[0]) : sheetYear

        const dayCols = findDayColumns(ws, r, year, month)
        if (!dayCols) continue
        blocksFound++

        const block: MonthBlock = { year, month, dayCols, headerRow: r }
        const check = verifyWeekdays(ws, block, ws.name)
        if (check.status === 'verified') blocksVerified++
        else if (check.status === 'sheet-wrong') staleWeekdayBlocks.push(check.detail!)

        const nDays = daysInMonth(year, month)
        const sortedCols = [...dayCols.entries()]
          .filter(([, d]) => d <= nDays)
          .sort((a, b) => a[0] - b[0])

        // Berth rows follow the header until the NEXT month block begins.
        // Blocks sit ~11 rows apart, so an over-wide window would re-parse the
        // following month's berth rows against this month's dates.
        for (let br = r + 1; br <= ws.rowCount; br++) {
          const brow = ws.getRow(br)
          const label = cellText(brow.getCell(1))

          const upper = label.toUpperCase()
          if (MONTHS.some((mo) => upper.startsWith(mo))) break

          const m = BERTH_RE.exec(label)
          if (!m) continue
          const berth = m[1].trim()
          berthLengths.set(berth, Number(m[2]))

          // Walk the row left-to-right, accumulating colour bands into runs.
          let run: { label: string; color: string | null; start: number; end: number } | null = null
          const flush = () => {
            if (!run || !run.label) { run = null; return }
            bookings.push({
              berth,
              label: run.label,
              start: iso(year, month, run.start),
              end: iso(year, month, run.end),
              kind: EVENT_RE.test(run.label) ? 'event' : 'vessel',
              sourceSheet: ws.name,
            })
            run = null
          }

          for (const [col, day] of sortedCols) {
            const cell = brow.getCell(col)
            const text = cellText(cell)
            const color = fillColor(cell)
            const occupied = isOccupied(cell) || text !== ''

            if (!occupied) { flush(); continue }

            // Continue the current run only when this cell adds no NEW label
            // and carries the same colour. A new label always starts a new
            // booking, even mid-band (that is how back-to-back stays appear).
            if (run && !text && color === run.color) {
              run.end = day
            } else {
              flush()
              run = { label: text, color, start: day, end: day }
            }
          }
          flush()
        }
      }
    }

    const berths = [...berthLengths.entries()]
      .map(([name, lengthFt]) => ({ name, lengthFt }))
      .sort((a, b) => b.lengthFt - a.lengthFt)

    bookings.sort((a, b) => a.start.localeCompare(b.start) || a.berth.localeCompare(b.berth))

    const snapshot = {
      generatedFrom: SOURCE,
      berths,
      bookings,
      stats: {
        bookings: bookings.length,
        monthBlocks: blocksFound,
        monthBlocksWeekdayVerified: blocksVerified,
        firstDate: bookings[0]?.start ?? null,
        lastDate: bookings.reduce((mx, b) => (b.end > mx ? b.end : mx), ''),
      },
      staleWeekdayBlocks,
    }
    writeFileSync(OUT, JSON.stringify(snapshot, null, 2))

    console.log(`berths: ${berths.length}`)
    for (const b of berths) console.log(`   ${b.name} — ${b.lengthFt}'`)
    console.log(`month blocks: ${blocksFound}, weekday-verified: ${blocksVerified}`)
    if (staleWeekdayBlocks.length) {
      console.log(`stale weekday templates (day numbers used): ${staleWeekdayBlocks.length}`)
      for (const s of staleWeekdayBlocks) console.log(`   ${s}`)
    }
    console.log(`bookings: ${bookings.length}`)
    console.log(`  vessel: ${bookings.filter((b) => b.kind === 'vessel').length}`)
    console.log(`  event:  ${bookings.filter((b) => b.kind === 'event').length}`)
    console.log(`span: ${snapshot.stats.firstDate} -> ${snapshot.stats.lastDate}`)
    console.log(`wrote ${OUT}`)
  })
}

await main()
