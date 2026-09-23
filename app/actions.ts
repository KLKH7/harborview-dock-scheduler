'use server'

import { revalidatePath } from 'next/cache'
import { sql } from '@/lib/db'
import { getBerths, getVessels, getReservations } from '@/lib/data'
import { validateProposed, type DraftReservation } from '@/lib/validation/engine'

export type CreateResult =
  | { status: 'created'; id: string }
  | { status: 'refused'; message: string }

/**
 * Create a reservation.
 *
 * Re-validates on the server rather than trusting what the grid computed. The
 * client's view of existing bookings can be stale, and a request is not a
 * source of truth.
 *
 * There is no override. An overlap or an oversize vessel is refused, and the
 * message names the numbers so the refusal is actionable.
 */
export async function createReservation(draft: DraftReservation): Promise<CreateResult> {
  const [berths, vessels, existing] = await Promise.all([
    getBerths(),
    getVessels(),
    getReservations(draft.start, draft.end),
  ])

  const report = validateProposed(draft, existing, berths, vessels)

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
    VALUES (${draft.berthId}, ${draft.start}::date, ${draft.end}::date, ${draft.kind},
            ${draft.vesselId}, ${draft.label}, 'app')
    RETURNING id
  `) as Record<string, unknown>[]

  revalidatePath('/')
  revalidatePath('/conflicts')
  return { status: 'created', id: String(rows[0].id) }
}
