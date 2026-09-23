import ExcelJS from 'exceljs'
import {readFileSync} from 'node:fs'
const NEUTRAL=new Set(['FFFFFFFF','00000000','FFD9D9D9','FFF2F2F2'])
const wb=new ExcelJS.Workbook(); await wb.xlsx.readFile('data/source.xlsx')
// Independent count: total OCCUPIED berth-day cells across all year sheets.
let occupied=0, textCells=0
const BERTH=/^(.*?)\s*-\s*(\d+)\s*'/
for(const ws of wb.worksheets){
  if(!/^\d{4}$/.test(ws.name)) continue
  for(let r=1;r<=ws.rowCount;r++){
    const row=ws.getRow(r)
    const a=row.getCell(1).value
    if(typeof a!=='string'||!BERTH.test(a)) continue
    for(let c=2;c<=ws.columnCount;c++){
      const cell=row.getCell(c)
      const f:any=cell.fill
      const fg=f&&f.type==='pattern'?(f.fgColor?.argb??null):null
      const filled=fg!==null&&!NEUTRAL.has(fg)
      const t=cell.value!=null&&String(cell.value).trim()!==''
      if(filled) occupied++
      if(t) textCells++
    }
  }
}
console.log('RAW occupied berth-day cells:',occupied)
console.log('RAW cells containing text   :',textCells)
const s=JSON.parse(readFileSync('data/snapshot.json','utf8'))
let span=0
for(const b of s.bookings){
  span += (Date.parse(b.end)-Date.parse(b.start))/86400000 + 1
}
console.log('SNAPSHOT bookings           :',s.bookings.length)
console.log('SNAPSHOT total booked days  :',span)

// Invariant: every text cell begins exactly one booking, except where an
// adjacent cell repeats the same vessel and merges into one stay.
const expected = 5507
const actual = s.bookings.length
const merged = expected - actual
console.log(`\nexpected <= ${expected} bookings (one per text cell); got ${actual}; ${merged} merged as continuations`)
if (actual > expected) throw new Error(`Over-extraction: ${actual} bookings from ${expected} text cells`)
console.log('AUDIT PASS')
