'use server'

import { revalidatePath } from 'next/cache'
import { sql } from '@/lib/db'
import { getBerths, getVessels, getReservations, findVesselByHull, insertVessel, upsertVesselStatement } from '@/lib/data'
import { validateProposed, type DraftReservation } from '@/lib/validation/engine'
import { hullKey } from '@/lib/vessel-name'

/** Postgres SQLSTATE for an exclusion-constraint violation. */
const EXCLUSION_VIOLATION = '23P01'

function pgCode(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && 'code' in e ? String((e as { code?: unknown }).code) : undefined
}

function revalidateAll() {
  revalidatePath('/')
  revalidatePath('/review')
  revalidatePath('/vessels')
}

export type CreateResult =
  | { status: 'created'; id: string }
  | { status: 'refused'; message: string }

export type CreateInput = DraftReservation & {
  /** Length for a hull that is not yet on the roster. Ignored if the name already exists. */
  newVesselLengthFt?: number | null
}

/**
 * Create a reservation.
 *
 * Re-validates on the server rather than trusting what the grid computed. The
 * client's view of existing bookings can be stale, and a request is not a
 * source of truth.
 *
 * A vessel name that is not on the roster is added, with the length the
 * coordinator typed (or unknown). The prompt is to manage bookings going
 * forward, not to restrict the waterfront to hulls that appeared in 1997-2019.
 *
 * There is no override. An overlap or an oversize vessel is refused, and the
 * message names the numbers so the refusal is actionable.
 */
export async function createReservation(draft: CreateInput): Promise<CreateResult> {
  const label = draft.label.trim()
  let vesselId = draft.vesselId
  let newVessel: { name: string; lengthFt: number | null } | null = null

  // Resolve the name to a hull. If it is genuinely new, remember that, but do
  // NOT insert it yet: a refused booking used to leave an orphan vessel behind.
  if (draft.kind === 'vessel' && !vesselId) {
    const existingHull = await findVesselByHull(label)
    if (existingHull) vesselId = existingHull.id
    else {
      const length =
        draft.newVesselLengthFt != null && Number.isFinite(draft.newVesselLengthFt)
          ? Math.round(draft.newVesselLengthFt)
          : null
      newVessel = { name: label, lengthFt: length }
      // The engine needs an id to check cross-berth and fit. Use the hull key,
      // which is what the row will resolve to once it exists.
      vesselId = `pending:${hullKey(label)}`
    }
  }

  const resolved: DraftReservation = {
    berthId: draft.berthId,
    start: draft.start,
    end: draft.end,
    kind: draft.kind,
    vesselId: draft.kind === 'vessel' ? vesselId : null,
    label,
  }

  const [berths, vessels, existing] = await Promise.all([
    getBerths(),
    getVessels(),
    getReservations(resolved.start, resolved.end),
  ])

  // A vessel that does not exist yet is validated as if it did, with the
  // length the coordinator typed.
  const vesselsForCheck = newVessel
    ? [...vessels, { id: vesselId!, displayName: label, lengthFt: newVessel.lengthFt, lengthSource: newVessel.lengthFt != null ? 'manual_override' as const : 'unknown' as const }]
    : vessels

  const report = validateProposed(resolved, existing, berths, vesselsForCheck)

  if (report.errors.length > 0) {
    return { status: 'refused', message: report.errors.join('. ') }
  }

  if (!report.ok) {
    if (report.fit.status === 'violation') {
      return { status: 'refused', message: report.fit.reason }
    }
    if (report.conflicts.length > 0) {
      const c = report.conflicts[0]
      const other = c.a.id === '__draft__' ? c.b : c.a
      return {
        status: 'refused',
        message: `${other.label} holds this berth from ${other.start} to ${other.end}.`,
      }
    }
    // The only thing left that can block is this vessel already being in
    // another berth for two or more of these days.
    const x = report.crossBerth.find((c) => c.severity === 'violation')
    if (x) {
      const other = x.a.id === '__draft__' ? x.b : x.a
      return {
        status: 'refused',
        message: `${resolved.label} is already in ${other.berthId} from ${other.start} to ${other.end}.`,
      }
    }
    return { status: 'refused', message: 'This booking was refused.' }
  }

  // Everything the engine can see is fine. Now the part it cannot see: two
  // requests that both passed validation a moment apart. The exclusion
  // constraint holds that line; the engine only ever produced the good
  // message. Vessel and stay go in one transaction so a refusal here leaves
  // no orphan vessel either.
  try {
    if (newVessel) {
      const [vesselRows, stayRows] = await sql.transaction([
        upsertVesselStatement(newVessel.name, newVessel.lengthFt),
        sql`
          INSERT INTO reservation (berth_id, start_date, end_date, kind, vessel_id, label, source)
          SELECT ${resolved.berthId}, ${resolved.start}::date, ${resolved.end}::date, ${resolved.kind},
                 (SELECT id FROM vessel WHERE hull_key = ${hullKey(newVessel.name)}), ${resolved.label}, 'app'
          RETURNING id`,
      ])
      void vesselRows
      revalidateAll()
      return { status: 'created', id: String((stayRows as Record<string, unknown>[])[0].id) }
    }
    const rows = (await sql`
      INSERT INTO reservation (berth_id, start_date, end_date, kind, vessel_id, label, source)
      VALUES (${resolved.berthId}, ${resolved.start}::date, ${resolved.end}::date, ${resolved.kind},
              ${resolved.vesselId}, ${resolved.label}, 'app')
      RETURNING id
    `) as Record<string, unknown>[]
    revalidateAll()
    return { status: 'created', id: String(rows[0].id) }
  } catch (e) {
    if (pgCode(e) === EXCLUSION_VIOLATION) {
      return { status: 'refused', message: 'That berth was just taken for those dates.' }
    }
    throw e
  }
}

export async function dismissFinding(
  fingerprint: string,
  status: 'accepted' | 'data_error' | 'resolved' | null,
  note?: string,
): Promise<{ status: 'ok' }> {
  if (status === null) {
    await sql`DELETE FROM finding_disposition WHERE fingerprint = ${fingerprint}`
  } else {
    await sql`
      INSERT INTO finding_disposition (fingerprint, status, note)
      VALUES (${fingerprint}, ${status}, ${note?.trim() || null})
      ON CONFLICT (fingerprint) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, decided_at = now()`
  }
  revalidatePath('/review')
  return { status: 'ok' }
}

export async function deleteReservation(id: string): Promise<{ status: 'ok' } | { status: 'refused'; message: string }> {
  const rows = (await sql`
    DELETE FROM reservation WHERE id = ${id} AND source = 'app' RETURNING id
  `) as Record<string, unknown>[]
  if (rows.length === 0) {
    const archive = (await sql`SELECT 1 FROM reservation WHERE id = ${id} AND source = 'spreadsheet'`) as unknown[]
    return archive.length
      ? { status: 'refused', message: 'The archive is a record. Mark the finding instead of removing the stay.' }
      : { status: 'refused', message: 'That stay is already gone.' }
  }
  revalidateAll()
  return { status: 'ok' }
}

export async function updateVesselLength(
  id: string,
  lengthFt: number | null,
): Promise<{ status: 'ok' } | { status: 'refused'; message: string }> {
  if (lengthFt != null && (!Number.isFinite(lengthFt) || lengthFt <= 0 || lengthFt > 1000)) {
    return { status: 'refused', message: 'Length must be between 1 and 1000 feet.' }
  }
  const ft = lengthFt == null ? null : Math.round(lengthFt)
  const source = ft == null ? 'unknown' : 'manual_override'
  await sql`
    UPDATE vessel
    SET length_ft = ${ft}, length_source = ${source}
    WHERE id = ${id}
  `
  revalidatePath('/')
  revalidatePath('/review')
  revalidatePath('/vessels')
  return { status: 'ok' }
}

export async function addVessel(
  displayName: string,
  lengthFt: number | null,
): Promise<CreateResult> {
  const name = displayName.trim()
  if (!name) return { status: 'refused', message: 'A vessel name is required.' }
  const existing = await findVesselByHull(name)
  if (existing) return { status: 'refused', message: `${existing.displayName} is already on the list.` }
  const ft = lengthFt != null && Number.isFinite(lengthFt) && lengthFt > 0 ? Math.round(lengthFt) : null
  const created = await insertVessel(name, ft)
  revalidatePath('/')
  revalidatePath('/vessels')
  return { status: 'created', id: created.id }
}
