/**
 * Run the real validation engine over the full extracted history and write
 * data/findings.json. This is the same engine the booking form uses -- there is
 * no second implementation that could disagree with it.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import {
  detectOverlaps,
  checkFit,
  dayCount,
  type Berth,
  type Reservation,
  type Vessel,
} from '../lib/validation/engine.ts'

const snapshot = JSON.parse(readFileSync('data/snapshot.json', 'utf8'))
const vesselData = JSON.parse(readFileSync('data/vessels.json', 'utf8'))

const PREFIX_RE = /^(R\/V|M\/V|F\/V|S\/V|M\/Y|S\/Y|OSV|Tug|Barge)\s+/i
const hullKey = (s: string) => s.replace(PREFIX_RE, '').replace(/\s+/g, ' ').trim().toUpperCase()

const berths: Berth[] = snapshot.berths.map((b: { name: string; lengthFt: number }) => ({
  id: b.name,
  name: b.name,
  lengthFt: b.lengthFt,
}))

const vessels: Vessel[] = vesselData.vessels.map(
  (v: { hullKey: string; displayName: string; lengthFt: number | null; lengthSource: Vessel['lengthSource'] }) => ({
    id: v.hullKey,
    displayName: v.displayName,
    lengthFt: v.lengthFt,
    lengthSource: v.lengthSource,
  }),
)
const vesselById = new Map(vessels.map((v) => [v.id, v]))
const berthByName = new Map(berths.map((b) => [b.name, b]))

const reservations: Reservation[] = snapshot.bookings.map(
  (b: { berth: string; label: string; start: string; end: string; kind: 'vessel' | 'event' }, i: number) => ({
    id: `r${i}`,
    berthId: b.berth,
    start: b.start,
    end: b.end,
    kind: b.kind,
    vesselId: b.kind === 'vessel' ? hullKey(b.label) : null,
    label: b.label,
  }),
)

const conflicts = detectOverlaps(reservations)

const fitFindings = reservations.map((r) => {
  const berth = berthByName.get(r.berthId)!
  const vessel = r.vesselId ? (vesselById.get(r.vesselId) ?? null) : null
  return { reservation: r, fit: checkFit(vessel, berth) }
})

const byStatus = {
  fits: fitFindings.filter((f) => f.fit.status === 'fits'),
  violation: fitFindings.filter((f) => f.fit.status === 'violation'),
  unverifiable: fitFindings.filter((f) => f.fit.status === 'unverifiable'),
  not_applicable: fitFindings.filter((f) => f.fit.status === 'not_applicable'),
}

const conflictViolations = conflicts.filter((c) => c.severity === 'violation')
const conflictWarnings = conflicts.filter((c) => c.severity === 'warning')

const findings = {
  conflicts: conflicts.map((c) => ({
    berth: c.a.berthId,
    severity: c.severity,
    sharedDays: c.sharedDays,
    reason: c.reason,
    a: { id: c.a.id, label: c.a.label, start: c.a.start, end: c.a.end },
    b: { id: c.b.id, label: c.b.label, start: c.b.start, end: c.b.end },
  })),
  oversized: byStatus.violation.map((f) => ({
    id: f.reservation.id,
    berth: f.reservation.berthId,
    label: f.reservation.label,
    start: f.reservation.start,
    end: f.reservation.end,
    vesselLengthFt: f.fit.vesselLengthFt,
    berthLengthFt: f.fit.berthLengthFt,
    overhangFt: f.fit.overhangFt,
  })),
  stats: {
    reservations: reservations.length,
    conflicts: conflicts.length,
    conflictViolations: conflictViolations.length,
    conflictWarnings: conflictWarnings.length,
    fitsCount: byStatus.fits.length,
    oversizedCount: byStatus.violation.length,
    unverifiableCount: byStatus.unverifiable.length,
    eventCount: byStatus.not_applicable.length,
    unverifiableBookedDays: byStatus.unverifiable.reduce(
      (s, f) => s + dayCount(f.reservation.start, f.reservation.end),
      0,
    ),
  },
}

writeFileSync('data/findings.json', JSON.stringify(findings, null, 2))

console.log(`reservations analysed: ${findings.stats.reservations}`)
console.log(`\nDOUBLE-BOOKINGS: ${findings.stats.conflicts}`)
console.log(`   violation (2+ shared days): ${findings.stats.conflictViolations}`)
console.log(`   warning   (1 shared day):   ${findings.stats.conflictWarnings}`)
console.log(`\nBERTH FIT:`)
console.log(`   fits:           ${findings.stats.fitsCount}`)
console.log(`   OVERSIZED:      ${findings.stats.oversizedCount}`)
console.log(`   unverifiable:   ${findings.stats.unverifiableCount} (${findings.stats.unverifiableBookedDays} booked days)`)
console.log(`   events (n/a):   ${findings.stats.eventCount}`)
console.log('\nworst overhangs:')
for (const o of [...findings.oversized].sort((a, b) => (b.overhangFt ?? 0) - (a.overhangFt ?? 0)).slice(0, 8)) {
  console.log(`   ${o.label} ${o.vesselLengthFt}' in ${o.berth} (${o.berthLengthFt}') — over by ${o.overhangFt}'  ${o.start}`)
}
console.log('\nworst conflicts:')
for (const c of [...conflictViolations].sort((a, b) => b.sharedDays - a.sharedDays).slice(0, 6)) {
  console.log(`   ${c.a.berthId}: ${c.a.label} vs ${c.b.label} — ${c.sharedDays} shared days (${c.a.start})`)
}
