'use server'

import { revalidatePath } from 'next/cache'
import { sql } from '@/lib/db'
import { getBerths, getVessels, getReservations, findVesselByHull, insertVessel } from '@/lib/data'
import { validateProposed, type DraftReservation } from '@/lib/validation/engine'

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
  let vesselId = draft.vesselId
  const label = draft.label.trim()

  if (draft.kind === 'vessel') {
    if (!vesselId) {
      const existingHull = await findVesselByHull(label)
      if (existingHull) vesselId = existingHull.id
      else {
        const length =
          draft.newVesselLengthFt != null && Number.isFinite(draft.newVesselLengthFt)
            ? Math.round(draft.newVesselLengthFt)
            : null
        const created = await insertVessel(label, length)
        vesselId = created.id
      }
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

  const report = validateProposed(resolved, existing, berths, vessels)

  if (report.errors.length > 0) {
    return { status: 'refused', message: report.errors.join('. ') }
  }

  if (!report.ok) {
    if (report.fit.status === 'violation') {
      return { status: 'refused', message: report.fit.reason }
    }
    const c = report.conflicts[0]
    const other = c.a.id === '__draft__' ? c.b : c.a
    return {
      status: 'refused',
      message: `${other.label} holds this berth from ${other.start} to ${other.end}.`,
    }
  }

  const rows = (await sql`
    INSERT INTO reservation (berth_id, start_date, end_date, kind, vessel_id, label, source)
    VALUES (${resolved.berthId}, ${resolved.start}::date, ${resolved.end}::date, ${resolved.kind},
            ${resolved.vesselId}, ${resolved.label}, 'app')
    RETURNING id
  `) as Record<string, unknown>[]

  revalidatePath('/')
  revalidatePath('/conflicts')
  revalidatePath('/vessels')
  return { status: 'created', id: String(rows[0].id) }
}

export async function deleteReservation(id: string): Promise<{ status: 'ok' } | { status: 'refused'; message: string }> {
  const rows = (await sql`
    DELETE FROM reservation WHERE id = ${id} RETURNING id
  `) as Record<string, unknown>[]
  if (rows.length === 0) return { status: 'refused', message: 'That stay is already gone.' }
  revalidatePath('/')
  revalidatePath('/conflicts')
  return { status: 'ok' }
}

export async function updateVesselLength(
  id: string,
  lengthFt: number | null,
): Promise<{ status: 'ok' } | { status: 'refused'; message: string }> {
  if (lengthFt != null && (!Number.isFinite(lengthFt) || lengthFt <= 0)) {
    return { status: 'refused', message: 'Length must be a positive number of feet.' }
  }
  const ft = lengthFt == null ? null : Math.round(lengthFt)
  const source = ft == null ? 'unknown' : 'manual_override'
  await sql`
    UPDATE vessel
    SET length_ft = ${ft}, length_source = ${source}
    WHERE id = ${id}
  `
  revalidatePath('/')
  revalidatePath('/conflicts')
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
