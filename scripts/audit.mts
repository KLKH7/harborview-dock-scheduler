/**
 * Independent audit of the extraction.
 *
 * Deliberately re-counts the workbook WITHOUT reusing the extractor's logic, so
 * a bug in the extractor cannot hide itself here. Compares raw cell counts
 * against the snapshot and asserts the invariant that ties them together.
 */
import ExcelJS from 'exceljs'
import { readFileSync } from 'node:fs'

const NEUTRAL = new Set(['FFFFFFFF', '00000000', 'FFD9D9D9', 'FFF2F2F2'])
const BERTH_RE = /^(.*?)\s*-\s*(\d+)\s*'/
const UNMEASURED = new Set(['North Finger Piers:', 'Small craft slips (institution boats)'])

const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile('data/source.xlsx')

let textFilled = 0
let textOnly = 0
let fillOnly = 0

for (const ws of wb.worksheets) {
  if (!/^\d{4}$/.test(ws.name)) continue
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const a = row.getCell(1).value
    if (typeof a !== 'string') continue
    const label = a.trim()
    if (!BERTH_RE.test(label) && !UNMEASURED.has(label)) continue

    for (let c = 2; c <= ws.columnCount; c++) {
      const cell = row.getCell(c)
      const f = cell.fill as { type?: string; fgColor?: { argb?: string } } | undefined
      const fg = f && f.type === 'pattern' ? (f.fgColor?.argb ?? null) : null
      const filled = fg !== null && !NEUTRAL.has(fg)
      const hasText = cell.value != null && String(cell.value).trim() !== ''

      if (hasText && filled) textFilled++
      else if (hasText) textOnly++
      else if (filled) fillOnly++
    }
  }
}

const textCells = textFilled + textOnly
const snapshot = JSON.parse(readFileSync('data/snapshot.json', 'utf8'))
const bookings = snapshot.bookings as { start: string; end: string }[]
const bookedDays = bookings.reduce(
  (s, b) => s + (Date.parse(b.end) - Date.parse(b.start)) / 86_400_000 + 1,
  0,
)

console.log('RAW CELL CENSUS (berth rows only)')
console.log(`  text + fill  (start of a coloured run): ${textFilled}`)
console.log(`  text, NO fill (single-day entry)      : ${textOnly}`)
console.log(`  fill, no text (continuation cell)     : ${fillOnly}`)
console.log(`  => cells containing text              : ${textCells}`)
console.log()
console.log('SNAPSHOT')
console.log(`  bookings    : ${bookings.length}`)
console.log(`  booked days : ${bookedDays}`)
console.log()

// INVARIANT: every text cell starts at most one booking. Fewer bookings than
// text cells is expected -- adjacent cells naming the same vessel merge into a
// single stay. MORE bookings than text cells would mean we invented some.
const merged = textCells - bookings.length
console.log(`invariant: bookings (${bookings.length}) <= text cells (${textCells})`)
console.log(`  ${merged} cells merged into an adjacent continuing stay`)
if (bookings.length > textCells) {
  throw new Error(
    `OVER-EXTRACTION: ${bookings.length} bookings from only ${textCells} text cells. ` +
    `The extractor is inventing bookings.`,
  )
}

// Every coloured continuation cell must be absorbed by some booking, so total
// booked days should at least cover the filled cells.
const filledTotal = textFilled + fillOnly
if (bookedDays < filledTotal) {
  throw new Error(
    `UNDER-EXTRACTION: ${bookedDays} booked days cover fewer than the ` +
    `${filledTotal} occupied cells in the workbook.`,
  )
}
console.log(`invariant: booked days (${bookedDays}) >= occupied cells (${filledTotal})`)

console.log('\nAUDIT PASS')
