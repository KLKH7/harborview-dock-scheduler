/**
 * Vessel-name handling, shared by the extractor, the roster join and the seed.
 *
 * This lives in one place on purpose. The prefix list was previously duplicated
 * in four scripts, and when `OS/V` turned out to be a real prefix it had to be
 * fixed in all of them or they would disagree about what counts as a vessel.
 *
 * `OS/V` and `OSV` both appear, in the schedule AND on the roster tabs.
 */
export const VESSEL_PREFIXES = [
  'R/V', 'M/V', 'F/V', 'S/V', 'M/Y', 'S/Y', 'OS/V', 'OSV', 'Tug', 'Barge',
] as const

const alternation = VESSEL_PREFIXES.join('|').replace(/\//g, '\\/')

/** Does this label name a vessel (as opposed to an event or an annotation)? */
export const VESSEL_PREFIX_RE = new RegExp(`^(${alternation})\\s+`, 'i')

/** Roster form: "R/V High Drift 120'" -> [, name, length] */
export const ROSTER_NAME_RE = new RegExp(
  `^((?:${alternation})\\s+.+?)\\s+(\\d+)\\s*['′]\\s*$`,
  'i',
)

export function isVesselLabel(label: string): boolean {
  return VESSEL_PREFIX_RE.test(label.trim())
}

/**
 * Identity key for a vessel: prefix stripped, case and whitespace normalised.
 *
 * The prefix must be ignored because the schedule and the roster disagree about
 * it — the schedule writes "R/V Clear Sextant" where the roster says
 * "S/Y Clear Sextant 145'". Casing must be ignored because the same hull is
 * written "S/V Golden Heron" in one year and "S/V GOLDEN HERON" in another.
 */
export function hullKey(label: string): string {
  return label.replace(VESSEL_PREFIX_RE, '').replace(/\s+/g, ' ').trim().toUpperCase()
}
