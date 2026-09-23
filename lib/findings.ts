/**
 * Findings as a list: one row shape for all three kinds, a stable fingerprint
 * for each, and a sort that puts "what do I deal with first" at the top.
 *
 * Pure. Takes the engine's output and returns rows; no I/O. The review page,
 * the day board strip, and the fingerprint used by dispositions all come
 * from here so they cannot disagree about which finding is which.
 */
import type { Conflict, FitFinding } from './validation/engine'
import type { StoredReservation } from './data'
import { hullKey } from './vessel-name'

export type FindingKind = 'overlap' | 'cross' | 'oversize'

export type FindingRow = {
  fingerprint: string
  kind: FindingKind
  /** The date the row sorts by: the latest end of the stays involved. */
  when: string
  /** True when a stay involved ends on or after today. */
  open: boolean
  title: string
  detail: string
  berthId: string
  /** Month to open on the schedule, and the hull to trace there. */
  link: { year: number; month: number; trace: string | null }
  stays: StoredReservation[]
  /** Oversize only: how many stays this vessel/berth pairing covers. */
  count?: number
  vessel?: { id: string; lengthFt: number | null; berthFt: number | null; overFt: number }
}

/** Stable identity for a stay: the source key for archive rows, the id for app rows. */
export function stayKey(r: StoredReservation): string {
  return r.sourceKey ?? `app:${r.id}`
}

function pairKey(a: StoredReservation, b: StoredReservation): string {
  return [stayKey(a), stayKey(b)].sort().join(':')
}

function prettyRange(r: StoredReservation): string {
  return r.start === r.end ? r.start : `${r.start} to ${r.end}`
}

function ym(iso: string) {
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) }
}

export function buildFindingRows(input: {
  conflicts: Conflict[]
  crossBerth: Conflict[]
  fits: { reservation: StoredReservation; fit: FitFinding }[]
  today: string
}): FindingRow[] {
  const { today } = input
  const rows: FindingRow[] = []

  for (const c of input.conflicts) {
    const a = c.a as StoredReservation
    const b = c.b as StoredReservation
    const when = a.end > b.end ? a.end : b.end
    rows.push({
      fingerprint: `overlap:${pairKey(a, b)}`,
      kind: 'overlap',
      when,
      open: when >= today,
      title: `${a.label} and ${b.label} both in ${a.berthId}`,
      detail: `${c.sharedDays} day${c.sharedDays === 1 ? '' : 's'} shared. ${prettyRange(a)} and ${prettyRange(b)}.`,
      berthId: a.berthId,
      link: { ...ym(a.start), trace: a.vesselId ?? b.vesselId ?? null },
      stays: [a, b],
    })
  }

  // One vessel in two berths. Four rows about one barge in one October are one
  // event, so group by hull and month, keeping every stay involved.
  const crossGroups = new Map<string, { a: StoredReservation; stays: Set<StoredReservation>; berths: Set<string>; maxShared: number; when: string }>()
  for (const c of input.crossBerth) {
    if (c.severity !== 'violation') continue
    const a = c.a as StoredReservation
    const b = c.b as StoredReservation
    const key = `${a.vesselId}|${a.start.slice(0, 7)}`
    const g = crossGroups.get(key) ?? { a, stays: new Set(), berths: new Set(), maxShared: 0, when: a.end }
    g.stays.add(a); g.stays.add(b); g.berths.add(a.berthId); g.berths.add(b.berthId)
    g.maxShared = Math.max(g.maxShared, c.sharedDays)
    if (b.end > g.when) g.when = b.end
    crossGroups.set(key, g)
  }
  for (const [key, g] of crossGroups) {
    const stays = [...g.stays].sort((x, y) => x.start.localeCompare(y.start))
    rows.push({
      fingerprint: `cross:${key}`,
      kind: 'cross',
      when: g.when,
      open: g.when >= today,
      title: `${g.a.label} in ${[...g.berths].join(' and ')} at once`,
      detail: `Up to ${g.maxShared} days in two berths. ${stays.map(prettyRange).join('; ')}.`,
      berthId: g.a.berthId,
      link: { ...ym(stays[0].start), trace: g.a.vesselId },
      stays,
    })
  }

  // Oversize, grouped by vessel and berth: the roster length is the one
  // decision, and it clears every stay in the group at once.
  const over = new Map<string, { stays: StoredReservation[]; fit: FitFinding }>()
  for (const f of input.fits) {
    if (f.fit.status !== 'violation' || !f.reservation.vesselId) continue
    const key = `${f.reservation.vesselId}|${f.reservation.berthId}`
    const g = over.get(key) ?? { stays: [], fit: f.fit }
    g.stays.push(f.reservation)
    over.set(key, g)
  }
  for (const [key, g] of over) {
    const stays = g.stays.sort((x, y) => x.start.localeCompare(y.start))
    const last = stays[stays.length - 1]
    const first = stays[0]
    const when = last.end
    rows.push({
      fingerprint: `oversize:${key}`,
      kind: 'oversize',
      when,
      open: when >= today,
      title: `${first.label} does not fit ${first.berthId}`,
      detail: `${g.fit.vesselLengthFt} ft on a ${g.fit.berthLengthFt} ft berth, over by ${g.fit.overhangFt} ft. ${stays.length} stay${stays.length === 1 ? '' : 's'}, ${first.start.slice(0, 4)}${last.end.slice(0, 4) !== first.start.slice(0, 4) ? ` to ${last.end.slice(0, 4)}` : ''}.`,
      berthId: first.berthId,
      link: { ...ym(last.start), trace: first.vesselId },
      stays,
      count: stays.length,
      vessel: { id: first.vesselId!, lengthFt: g.fit.vesselLengthFt, berthFt: g.fit.berthLengthFt, overFt: g.fit.overhangFt ?? 0 },
    })
  }

  // Soonest first. Among the same day, overlap before cross before oversize.
  const rank: Record<FindingKind, number> = { overlap: 0, cross: 1, oversize: 2 }
  rows.sort((x, y) => {
    if (x.open !== y.open) return x.open ? -1 : 1
    const dx = Math.abs(Date.parse(x.when) - Date.parse(today))
    const dy = Math.abs(Date.parse(y.when) - Date.parse(today))
    if (dx !== dy) return dx - dy
    return rank[x.kind] - rank[y.kind]
  })
  return rows
}

/**
 * "Setting a length for N vessels would clear M of the K oversize findings."
 * Derived, never hand-written: the top vessels by number of oversize stays.
 */
export function rosterLever(rows: FindingRow[], topN = 5): { vessels: number; clears: number; of: number } {
  const over = rows.filter((r) => r.kind === 'oversize')
  const byVessel = new Map<string, number>()
  for (const r of over) byVessel.set(r.vessel!.id, (byVessel.get(r.vessel!.id) ?? 0) + (r.count ?? 1))
  const top = [...byVessel.values()].sort((a, b) => b - a).slice(0, topN)
  const total = over.reduce((s, r) => s + (r.count ?? 1), 0)
  return { vessels: Math.min(topN, byVessel.size), clears: top.reduce((a, b) => a + b, 0), of: total }
}

export { hullKey }
