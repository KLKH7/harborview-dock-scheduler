import { describe, it, expect } from 'vitest'
import {
  overlaps,
  sharedDayCount,
  gradeOverlap,
  detectOverlaps,
  checkFit,
  validateProposed,
  findAvailableBerths,
  dayCount,
  type Berth,
  type Vessel,
  type Reservation,
} from './engine'

const NORTH_PIER_WEST: Berth = { id: 'npw', name: 'North Pier West', lengthFt: 410 }
const INNER_CHANNEL: Berth = { id: 'ic', name: 'Inner Channel', lengthFt: 55 }
const BERTHS = [NORTH_PIER_WEST, INNER_CHANNEL]

const SMALL: Vessel = { id: 'v1', displayName: 'S/V Wild Drift', lengthFt: 24, lengthSource: 'roster_exact' }
const HUGE: Vessel = { id: 'v2', displayName: 'R/V High Drift', lengthFt: 120, lengthSource: 'roster_exact' }
const UNMEASURED: Vessel = { id: 'v3', displayName: 'R/V Golden Compass', lengthFt: null, lengthSource: 'unknown' }
const VESSELS = [SMALL, HUGE, UNMEASURED]

function res(over: Partial<Reservation> & Pick<Reservation, 'id' | 'start' | 'end'>): Reservation {
  return {
    berthId: 'npw',
    kind: 'vessel',
    vesselId: null,
    label: over.id,
    ...over,
  }
}

describe('inclusive interval semantics', () => {
  // This is the load-bearing convention. The source data is a day-grid where a
  // filled cell means "occupied that day", so a booking ending the 10th and one
  // starting the 10th DO collide. Under half-open [start,end) they would not.
  it('treats a shared end/start day as an overlap', () => {
    const a = { start: '2019-06-01', end: '2019-06-10' }
    const b = { start: '2019-06-10', end: '2019-06-20' }
    expect(overlaps(a, b)).toBe(true)
    expect(sharedDayCount(a, b)).toBe(1)
  })

  it('treats strictly adjacent days as no overlap', () => {
    const a = { start: '2019-06-01', end: '2019-06-09' }
    const b = { start: '2019-06-10', end: '2019-06-20' }
    expect(overlaps(a, b)).toBe(false)
    expect(sharedDayCount(a, b)).toBe(0)
  })

  it('counts a single-day booking as one day', () => {
    expect(dayCount('2019-06-01', '2019-06-01')).toBe(1)
  })

  it('handles full containment', () => {
    const a = { start: '2019-06-01', end: '2019-06-30' }
    const b = { start: '2019-06-10', end: '2019-06-12' }
    expect(sharedDayCount(a, b)).toBe(3)
  })

  it('handles identical ranges', () => {
    const a = { start: '2019-06-01', end: '2019-06-05' }
    expect(sharedDayCount(a, a)).toBe(5)
  })

  it('spans month and year boundaries', () => {
    expect(dayCount('2019-12-30', '2020-01-02')).toBe(4)
    const a = { start: '2019-12-28', end: '2020-01-03' }
    const b = { start: '2020-01-01', end: '2020-01-10' }
    expect(sharedDayCount(a, b)).toBe(3)
  })

  it('handles a leap day', () => {
    expect(dayCount('2020-02-28', '2020-03-01')).toBe(3)
  })
})

describe('overlap severity', () => {
  // Severity still grades HISTORY (the findings page ranks by it). It no longer
  // decides whether a new booking is allowed: see validateProposed, which
  // refuses any overlap.
  it('grades one shared day as a warning when reporting history', () => {
    expect(gradeOverlap(1)).toBe('warning')
  })

  it('grades two or more shared days as a violation', () => {
    expect(gradeOverlap(2)).toBe('violation')
    expect(gradeOverlap(15)).toBe('violation')
  })
})

describe('detectOverlaps', () => {
  it('finds a genuine multi-day double-booking', () => {
    const found = detectOverlaps([
      res({ id: 'a', start: '2019-06-01', end: '2019-06-10', label: 'R/V Alpha' }),
      res({ id: 'b', start: '2019-06-05', end: '2019-06-15', label: 'R/V Beta' }),
    ])
    expect(found).toHaveLength(1)
    expect(found[0].severity).toBe('violation')
    expect(found[0].sharedDays).toBe(6)
  })

  it('does not flag bookings in different berths', () => {
    const found = detectOverlaps([
      res({ id: 'a', start: '2019-06-01', end: '2019-06-10', berthId: 'npw', label: 'R/V Alpha' }),
      res({ id: 'b', start: '2019-06-01', end: '2019-06-10', berthId: 'ic', label: 'R/V Beta' }),
    ])
    expect(found).toHaveLength(0)
  })

  it('ignores the same vessel recorded twice (grid transcription artifact)', () => {
    const found = detectOverlaps([
      res({ id: 'a', start: '2019-06-01', end: '2019-06-10', vesselId: 'v1', label: 'S/V Wild Drift' }),
      res({ id: 'b', start: '2019-06-05', end: '2019-06-12', vesselId: 'v1', label: 'S/V Wild Drift' }),
    ])
    expect(found).toHaveLength(0)
  })

  it('matches the same occupant by label when ids are absent', () => {
    const found = detectOverlaps([
      res({ id: 'a', start: '2019-06-01', end: '2019-06-10', label: 'S/V Golden Heron' }),
      res({ id: 'b', start: '2019-06-05', end: '2019-06-12', label: 's/v golden heron' }),
    ])
    expect(found).toHaveLength(0)
  })

  it('flags an event colliding with a vessel', () => {
    const found = detectOverlaps([
      res({ id: 'a', start: '2019-06-01', end: '2019-06-10', label: 'R/V Alpha' }),
      res({ id: 'e', start: '2019-06-03', end: '2019-06-04', kind: 'event', label: 'Community sail day' }),
    ])
    expect(found).toHaveLength(1)
    expect(found[0].severity).toBe('violation')
  })

  it('finds every pair when three bookings collide', () => {
    const found = detectOverlaps([
      res({ id: 'a', start: '2019-06-01', end: '2019-06-10', label: 'A' }),
      res({ id: 'b', start: '2019-06-02', end: '2019-06-11', label: 'B' }),
      res({ id: 'c', start: '2019-06-03', end: '2019-06-12', label: 'C' }),
    ])
    expect(found).toHaveLength(3)
  })
})

describe('checkFit', () => {
  it('passes a vessel that fits', () => {
    expect(checkFit(SMALL, INNER_CHANNEL).status).toBe('fits')
  })

  it('flags a vessel longer than the berth', () => {
    const f = checkFit(HUGE, INNER_CHANNEL)
    expect(f.status).toBe('violation')
    expect(f.overhangFt).toBe(65)
  })

  it('treats an exact-length fit as fitting, not overhanging', () => {
    const exact: Vessel = { id: 'x', displayName: 'Exact', lengthFt: 55, lengthSource: 'roster_exact' }
    expect(checkFit(exact, INNER_CHANNEL).status).toBe('fits')
  })

  // The crux: unknown length must NOT read as approval.
  it('returns unverifiable — never "fits" — when the length is unknown', () => {
    const f = checkFit(UNMEASURED, INNER_CHANNEL)
    expect(f.status).toBe('unverifiable')
    expect(f.status).not.toBe('fits')
    expect(f.vesselLengthFt).toBeNull()
    expect(f.reason).toContain('No length on record')
  })

  it('returns not_applicable for a non-vessel event', () => {
    expect(checkFit(null, INNER_CHANNEL).status).toBe('not_applicable')
  })

  // Two grouped areas in the source carry no length. A known-length vessel in
  // an unmeasured berth is still unverifiable -- there is nothing to compare
  // against. Representing that berth as 0 or Infinity would make this "violation"
  // or "fits" respectively, and both would be a lie.
  it('returns unverifiable when the BERTH has no recorded length', () => {
    const unmeasured: Berth = { id: 'nfp', name: 'North Finger Piers', lengthFt: null }
    const f = checkFit(HUGE, unmeasured)
    expect(f.status).toBe('unverifiable')
    expect(f.status).not.toBe('fits')
    expect(f.berthLengthFt).toBeNull()
    expect(f.vesselLengthFt).toBe(120)
  })
})

describe('validateProposed', () => {
  const existing = [
    res({ id: 'e1', start: '2019-06-10', end: '2019-06-20', berthId: 'npw', label: 'R/V Existing' }),
  ]

  it('accepts a clean booking', () => {
    const r = validateProposed(
      { berthId: 'npw', start: '2019-07-01', end: '2019-07-05', kind: 'vessel', vesselId: 'v1', label: 'S/V Wild Drift' },
      existing, BERTHS, VESSELS,
    )
    expect(r.ok).toBe(true)
    expect(r.conflicts).toHaveLength(0)
    expect(r.fit.status).toBe('fits')
  })

  it('refuses a multi-day overlap', () => {
    const r = validateProposed(
      { berthId: 'npw', start: '2019-06-15', end: '2019-06-25', kind: 'vessel', vesselId: 'v1', label: 'S/V Wild Drift' },
      existing, BERTHS, VESSELS,
    )
    expect(r.ok).toBe(false)
    expect(r.conflicts[0].severity).toBe('violation')
  })

  // The rule the brief tightened. A vessel arriving the day another leaves used
  // to be allowed; it now refuses like any other overlap.
  it('refuses a single shared day, not just a multi-day overlap', () => {
    const r = validateProposed(
      { berthId: 'npw', start: '2019-06-20', end: '2019-06-28', kind: 'vessel', vesselId: 'v1', label: 'S/V Wild Drift' },
      existing, BERTHS, VESSELS,
    )
    expect(r.ok).toBe(false)
    expect(r.conflicts).toHaveLength(1)
    expect(r.conflicts[0].sharedDays).toBe(1)
  })

  it('allows a booking that ends the day before another starts', () => {
    const r = validateProposed(
      { berthId: 'npw', start: '2019-06-01', end: '2019-06-09', kind: 'vessel', vesselId: 'v1', label: 'S/V Wild Drift' },
      existing, BERTHS, VESSELS,
    )
    expect(r.ok).toBe(true)
    expect(r.conflicts).toHaveLength(0)
  })

  it('refuses an oversized vessel', () => {
    const r = validateProposed(
      { berthId: 'ic', start: '2019-07-01', end: '2019-07-02', kind: 'vessel', vesselId: 'v2', label: 'R/V High Drift' },
      [], BERTHS, VESSELS,
    )
    expect(r.ok).toBe(false)
    expect(r.fit.status).toBe('violation')
  })

  it('permits an unknown-length booking but reports it as unverifiable', () => {
    const r = validateProposed(
      { berthId: 'ic', start: '2019-07-01', end: '2019-07-02', kind: 'vessel', vesselId: 'v3', label: 'R/V Golden Compass' },
      [], BERTHS, VESSELS,
    )
    expect(r.ok).toBe(true)
    expect(r.fit.status).toBe('unverifiable')
  })

  it('rejects an end date before the start date', () => {
    const r = validateProposed(
      { berthId: 'npw', start: '2019-07-10', end: '2019-07-01', kind: 'vessel', vesselId: 'v1', label: 'S/V Wild Drift' },
      [], BERTHS, VESSELS,
    )
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toContain('before')
  })

  it('rejects an unknown berth without throwing', () => {
    const r = validateProposed(
      { berthId: 'nope', start: '2019-07-01', end: '2019-07-02', kind: 'vessel', vesselId: 'v1', label: 'X' },
      [], BERTHS, VESSELS,
    )
    expect(r.ok).toBe(false)
  })

  it('only reports conflicts involving the draft, not pre-existing ones', () => {
    const messy = [
      res({ id: 'x', start: '2019-06-01', end: '2019-06-10', berthId: 'npw', label: 'A' }),
      res({ id: 'y', start: '2019-06-02', end: '2019-06-11', berthId: 'npw', label: 'B' }),
    ]
    const r = validateProposed(
      { berthId: 'npw', start: '2019-08-01', end: '2019-08-02', kind: 'vessel', vesselId: 'v1', label: 'S/V Wild Drift' },
      messy, BERTHS, VESSELS,
    )
    expect(r.conflicts).toHaveLength(0)
    expect(r.ok).toBe(true)
  })
})

describe('findAvailableBerths', () => {
  it('separates available, too-short and occupied berths', () => {
    const reservations = [
      res({ id: 'r1', start: '2019-06-01', end: '2019-06-30', berthId: 'npw', label: 'R/V Resident' }),
    ]
    const out = findAvailableBerths('2019-06-10', '2019-06-12', 120, BERTHS, reservations)
    expect(out.occupied.map((o) => o.berth.id)).toEqual(['npw'])
    expect(out.tooShort.map((b) => b.id)).toEqual(['ic'])
    expect(out.available).toHaveLength(0)
  })

  it('offers a berth when the requested length is unknown', () => {
    const out = findAvailableBerths('2019-06-10', '2019-06-12', null, BERTHS, [])
    expect(out.available).toHaveLength(2)
  })
})
