'use server'

import { revalidatePath } from 'next/cache'
import { sql } from '@/lib/db'
import { getBerths, getVessels, getReservations } from '@/lib/data'
import { validateProposed, type DraftReservation, type ValidationReport } from '@/lib/validation/engine'

export type CreateResult =
  | { status: 'created'; id: string; report: ValidationReport }
  | { status: 'rejected'; report: ValidationReport }
  | { status: 'needs_override'; report: ValidationReport }

/**
 * Validate a draft WITHOUT saving. Used for live feedback as the form is filled
 * in, so the user sees conflicts and fit problems before committing.
 */
export async function checkDraft(draft: DraftReservation): Promise<ValidationReport> {
  const [berths, vessels, existing] = await Promise.all([
    getBerths(),
    getVessels(),
    getReservations(draft.start, draft.end),
  ])
  return validateProposed(draft, existing, berths, vessels)
}

/**
 * Create a reservation.
 *
 * Re-validates server-side rather than trusting the client's check -- the
 * client's view can be stale, and a form post is not a source of truth.
 *
 * A violation blocks unless an explicit override reason is supplied. Real
 * waterfronts do raft vessels and make judgment calls; a system that makes the
 * correct action impossible just gets worked around. The reason is stored.
 */
export async function createReservation(
  draft: DraftReservation,
  overrideReason?: string,
): Promise<CreateResult> {
  const [berths, vessels, existing] = await Promise.all([
    getBerths(),
    getVessels(),
    getReservations(draft.start, draft.end),
  ])
  const report = validateProposed(draft, existing, berths, vessels)

  if (report.errors.length > 0) return { status: 'rejected', report }

  const reason = overrideReason?.trim()
  if (!report.ok && !reason) return { status: 'needs_override', report }

  const rows = (await sql`
    INSERT INTO reservation
      (berth_id, start_date, end_date, kind, vessel_id, label, source, override_reason)
    VALUES
      (${draft.berthId}, ${draft.start}::date, ${draft.end}::date, ${draft.kind},
       ${draft.vesselId}, ${draft.label}, 'app', ${report.ok ? null : (reason ?? null)})
    RETURNING id
  `) as Record<string, unknown>[]

  revalidatePath('/')
  revalidatePath('/conflicts')
  return { status: 'created', id: String(rows[0].id), report }
}
