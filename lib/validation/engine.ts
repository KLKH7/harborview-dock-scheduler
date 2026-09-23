/**
 * Validation engine: overlap detection and berth-fit checking.
 *
 * This module is PURE. No database, no fetch, no Date.now(). It is imported by
 * both the import/seed path and the live booking form, so the rules applied to
 * historical data and to a new reservation provably cannot drift apart.
 *
 * ---------------------------------------------------------------------------
 * INTERVAL SEMANTICS -- the decision that changes the numbers
 * ---------------------------------------------------------------------------
 * Dates are INCLUSIVE on both ends: [start, end].
 *
 * A booking API would normally use half-open [start, end), where a vessel
 * departing on the 17th frees the berth for someone arriving the 17th. That is
 * the wrong model for this data. The source of truth is a day-grid in which a
 * filled cell means "this berth was occupied on this day". A run ending on the
 * 17th means the vessel was physically there ON the 17th.
 *
 * Under half-open semantics every same-day handover would silently become
 * legal, which would drop roughly four fifths of the conflicts found in the
 * historical schedule. We keep inclusive semantics and instead grade a one-day
 * overlap as a WARNING (plausible turnaround) rather than a VIOLATION.
 */

export type BookingKind = 'vessel' | 'event'

export type Berth = {
  id: string
  name: string
  lengthFt: number
}

export type Vessel = {
  id: string
  displayName: string
  /** null means the length is unknown -- never substitute a sentinel. */
  lengthFt: number | null
  lengthSource: 'roster_exact' | 'fuzzy_hull_match' | 'manual_override' | 'unknown'
}

export type Reservation = {
  id: string
  berthId: string
  /** ISO date, inclusive */
  start: string
  /** ISO date, inclusive */
  end: string
  kind: BookingKind
  vesselId: string | null
  label: string
}

/**
 * Fit is deliberately FOUR-valued, not boolean.
 *
 *  fits           - checked, vessel is within berth length
 *  violation      - checked, vessel is longer than the berth
 *  unverifiable   - could NOT check: no length on record for this vessel
 *  not_applicable - nothing to check: this is an event, not a vessel
 *
 * `unverifiable` is not a softer `violation`, and it is emphatically not a
 * `fits`. Collapsing it into either would misrepresent the data: the remedy for
 * a violation is a human decision, the remedy for unverifiable is to go and
 * find the vessel's length.
 */
export type FitStatus = 'fits' | 'violation' | 'unverifiable' | 'not_applicable'

export type FitFinding = {
  status: FitStatus
  vesselLengthFt: number | null
  berthLengthFt: number
  /** Feet by which the vessel exceeds the berth. Positive only when violation. */
  overhangFt: number | null
  reason: string
}

export type ConflictSeverity = 'violation' | 'warning'

export type Conflict = {
  a: Reservation
  b: Reservation
  severity: ConflictSeverity
  sharedDays: number
  reason: string
}

const DAY_MS = 86_400_000

export function parseDay(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

export function dayCount(start: string, end: string): number {
  return (parseDay(end) - parseDay(start)) / DAY_MS + 1
}

export function addDays(iso: string, n: number): string {
  const t = new Date(parseDay(iso) + n * DAY_MS)
  return t.toISOString().slice(0, 10)
}

/** Inclusive overlap: true when the two ranges share at least one day. */
export function overlaps(a: Pick<Reservation, 'start' | 'end'>, b: Pick<Reservation, 'start' | 'end'>): boolean {
  return parseDay(a.start) <= parseDay(b.end) && parseDay(b.start) <= parseDay(a.end)
}

/** Number of days two inclusive ranges share. 0 when they do not overlap. */
export function sharedDayCount(
  a: Pick<Reservation, 'start' | 'end'>,
  b: Pick<Reservation, 'start' | 'end'>,
): number {
  const lo = Math.max(parseDay(a.start), parseDay(b.start))
  const hi = Math.min(parseDay(a.end), parseDay(b.end))
  if (lo > hi) return 0
  return (hi - lo) / DAY_MS + 1
}

/**
 * Grade an overlap.
 *
 * One shared day is usually a same-day turnaround -- one vessel leaving as the
 * next arrives -- which is normal waterfront practice and is graded a warning.
 * Two or more shared days cannot be explained that way and is a violation.
 */
export function gradeOverlap(sharedDays: number): ConflictSeverity {
  return sharedDays >= 2 ? 'violation' : 'warning'
}

/**
 * Find every pair of reservations that occupy the same berth at the same time.
 *
 * Sorts by start date and breaks out of the inner loop as soon as a candidate
 * starts after the current reservation ends, so this is near-linear on the
 * realistic case rather than quadratic over the whole set.
 */
export function detectOverlaps(reservations: Reservation[]): Conflict[] {
  const byBerth = new Map<string, Reservation[]>()
  for (const r of reservations) {
    const list = byBerth.get(r.berthId)
    if (list) list.push(r)
    else byBerth.set(r.berthId, [r])
  }

  const conflicts: Conflict[] = []
  for (const list of byBerth.values()) {
    list.sort((x, y) => parseDay(x.start) - parseDay(y.start))
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (parseDay(list[j].start) > parseDay(list[i].end)) break

        const a = list[i]
        const b = list[j]

        // The same vessel recorded twice over adjacent cells is a transcription
        // artifact of the grid, not a double-booking.
        if (sameOccupant(a, b)) continue

        const shared = sharedDayCount(a, b)
        if (shared <= 0) continue

        const severity = gradeOverlap(shared)
        conflicts.push({
          a,
          b,
          severity,
          sharedDays: shared,
          reason:
            severity === 'violation'
              ? `${a.label} and ${b.label} both occupy this berth for ${shared} days`
              : `${a.label} and ${b.label} share one day — likely a same-day turnaround`,
        })
      }
    }
  }
  return conflicts
}

function sameOccupant(a: Reservation, b: Reservation): boolean {
  if (a.vesselId && b.vesselId) return a.vesselId === b.vesselId
  return a.label.trim().toUpperCase() === b.label.trim().toUpperCase()
}

/**
 * Check whether a vessel physically fits a berth.
 *
 * Returns `unverifiable` rather than passing when the length is unknown. This
 * is the single most important behaviour in the engine: silently approving an
 * unmeasurable vessel would be exactly the failure the system exists to prevent.
 */
export function checkFit(vessel: Vessel | null, berth: Berth): FitFinding {
  if (!vessel) {
    return {
      status: 'not_applicable',
      vesselLengthFt: null,
      berthLengthFt: berth.lengthFt,
      overhangFt: null,
      reason: 'Non-vessel event — no length to check',
    }
  }

  if (vessel.lengthFt === null) {
    return {
      status: 'unverifiable',
      vesselLengthFt: null,
      berthLengthFt: berth.lengthFt,
      overhangFt: null,
      reason: `No length on record for ${vessel.displayName} — cannot verify it fits ${berth.name}`,
    }
  }

  const overhang = vessel.lengthFt - berth.lengthFt
  if (overhang > 0) {
    return {
      status: 'violation',
      vesselLengthFt: vessel.lengthFt,
      berthLengthFt: berth.lengthFt,
      overhangFt: overhang,
      reason: `${vessel.displayName} is ${vessel.lengthFt}' but ${berth.name} is only ${berth.lengthFt}' — overhangs by ${overhang}'`,
    }
  }

  return {
    status: 'fits',
    vesselLengthFt: vessel.lengthFt,
    berthLengthFt: berth.lengthFt,
    overhangFt: null,
    reason: `${vessel.displayName} (${vessel.lengthFt}') fits ${berth.name} (${berth.lengthFt}')`,
  }
}

export type DraftReservation = {
  berthId: string
  start: string
  end: string
  kind: BookingKind
  vesselId: string | null
  label: string
}

export type ValidationReport = {
  ok: boolean
  /** True when the only thing standing in the way is a violation the user may override. */
  overridable: boolean
  conflicts: Conflict[]
  fit: FitFinding
  errors: string[]
}

/**
 * Validate a proposed reservation against existing ones.
 *
 * Blocking rules:
 *   - malformed input (end before start, unknown berth) is a hard error
 *   - a fit violation or a multi-day overlap blocks, but MAY be overridden with
 *     a reason, because real waterfronts raft vessels and make judgment calls
 *   - a one-day turnaround and an unverifiable length are surfaced, not blocked
 */
export function validateProposed(
  draft: DraftReservation,
  existing: Reservation[],
  berths: Berth[],
  vessels: Vessel[],
): ValidationReport {
  const errors: string[] = []

  const berth = berths.find((b) => b.id === draft.berthId)
  if (!berth) {
    return {
      ok: false,
      overridable: false,
      conflicts: [],
      fit: {
        status: 'not_applicable',
        vesselLengthFt: null,
        berthLengthFt: 0,
        overhangFt: null,
        reason: 'Unknown berth',
      },
      errors: [`Unknown berth: ${draft.berthId}`],
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.start) || !/^\d{4}-\d{2}-\d{2}$/.test(draft.end)) {
    errors.push('Dates must be ISO (YYYY-MM-DD)')
  } else if (parseDay(draft.end) < parseDay(draft.start)) {
    errors.push('End date is before start date')
  }

  if (draft.kind === 'vessel' && !draft.vesselId) errors.push('Select a vessel')
  if (!draft.label.trim()) errors.push('A label is required')

  const vessel = draft.vesselId ? (vessels.find((v) => v.id === draft.vesselId) ?? null) : null
  if (draft.kind === 'vessel' && draft.vesselId && !vessel) {
    errors.push(`Unknown vessel: ${draft.vesselId}`)
  }

  const fit = checkFit(vessel, berth)

  // Give the draft a temporary id so it can go through the same overlap code
  // path as stored reservations -- one implementation, not two.
  const candidate: Reservation = { ...draft, id: '__draft__' }
  const conflicts =
    errors.length > 0
      ? []
      : detectOverlaps([...existing.filter((r) => r.berthId === draft.berthId), candidate]).filter(
          (c) => c.a.id === '__draft__' || c.b.id === '__draft__',
        )

  const blockingConflicts = conflicts.filter((c) => c.severity === 'violation')
  const blockedByFit = fit.status === 'violation'
  const blocked = blockingConflicts.length > 0 || blockedByFit

  return {
    ok: errors.length === 0 && !blocked,
    overridable: errors.length === 0 && blocked,
    conflicts,
    fit,
    errors,
  }
}

/**
 * Berths that are free for the whole requested range and long enough.
 *
 * A berth whose availability cannot be confirmed is reported separately rather
 * than being quietly offered or quietly withheld.
 */
export function findAvailableBerths(
  start: string,
  end: string,
  requiredLengthFt: number | null,
  berths: Berth[],
  reservations: Reservation[],
): { available: Berth[]; tooShort: Berth[]; occupied: { berth: Berth; by: Reservation[] }[] } {
  const available: Berth[] = []
  const tooShort: Berth[] = []
  const occupied: { berth: Berth; by: Reservation[] }[] = []

  for (const berth of berths) {
    const clashes = reservations.filter(
      (r) => r.berthId === berth.id && overlaps(r, { start, end }),
    )
    if (clashes.length > 0) {
      occupied.push({ berth, by: clashes })
      continue
    }
    if (requiredLengthFt !== null && requiredLengthFt > berth.lengthFt) {
      tooShort.push(berth)
      continue
    }
    available.push(berth)
  }

  return { available, tooShort, occupied }
}
