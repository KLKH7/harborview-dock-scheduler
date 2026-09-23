'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import type { BerthRow } from '@/lib/data'
import type { Vessel, ValidationReport, DraftReservation } from '@/lib/validation/engine'
import { checkDraft, createReservation } from './actions'

type Props = { berths: BerthRow[]; vessels: Vessel[] }

/** Stable identity for a draft, used to tie a verdict to the input it came from. */
function keyOf(d: DraftReservation): string {
  return [d.berthId, d.start, d.end, d.kind, d.vesselId ?? '', d.label].join('\u0000')
}

export function BookingForm({ berths, vessels }: Props) {
  const [kind, setKind] = useState<'vessel' | 'event'>('vessel')
  const [berthId, setBerthId] = useState(berths[0]?.id ?? '')
  const [vesselId, setVesselId] = useState('')
  const [eventLabel, setEventLabel] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [overrideReason, setOverrideReason] = useState('')

  // Keyed by the draft it describes, so a stale verdict can never be shown
  // against a draft the user has since edited.
  const [stored, setReport] = useState<{ forDraft: string; value: ValidationReport } | null>(null)
  const [created, setCreated] = useState<{ id: string; forDraft: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)

  const selectedVessel = vessels.find((v) => v.id === vesselId) ?? null
  const selectedBerth = berths.find((b) => b.id === berthId) ?? null

  const draft: DraftReservation | null = useMemo(() => {
    if (!berthId || !start || !end) return null
    if (kind === 'vessel' && !vesselId) return null
    if (kind === 'event' && !eventLabel.trim()) return null
    return {
      berthId,
      start,
      end,
      kind,
      vesselId: kind === 'vessel' ? vesselId : null,
      label: kind === 'vessel' ? (selectedVessel?.displayName ?? '') : eventLabel.trim(),
    }
  }, [berthId, start, end, kind, vesselId, eventLabel, selectedVessel])

  // Live validation: the user sees the verdict before committing, using the
  // same engine the server will re-run on submit.
  //
  // Only the async result is written to state. Clearing the previous report is
  // handled by deriving it below rather than by calling setState synchronously
  // here, which would force a second render pass on every keystroke.
  useEffect(() => {
    if (!draft) return
    startTransition(async () => {
      const r = await checkDraft(draft)
      setReport({ forDraft: keyOf(draft), value: r })
    })
  }, [draft])

  // A stored report is only meaningful for the draft it was computed from. When
  // the draft changes, the old verdict is stale and must not be shown as if it
  // described the new one.
  const report = draft && stored?.forDraft === keyOf(draft) ? stored.value : null

  async function submit() {
    if (!draft) return
    setSaving(true)
    try {
      const res = await createReservation(draft, overrideReason || undefined)
      setReport({ forDraft: keyOf(draft), value: res.report })
      if (res.status === 'created') {
        setCreated({ id: res.id, forDraft: keyOf(draft) })
        setOverrideReason('')
      }
    } finally {
      setSaving(false)
    }
  }

  const blocked = report ? !report.ok && report.errors.length === 0 : false
  const canSubmit =
    !!draft && !saving && report !== null && report.errors.length === 0 && (!blocked || !!overrideReason.trim())

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <Field label="Type">
          <div className="flex gap-2">
            {(['vessel', 'event'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`rounded border px-3 py-1.5 text-sm capitalize ${
                  kind === k
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white hover:bg-slate-50'
                }`}
              >
                {k === 'vessel' ? 'Vessel' : 'Facility event'}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Berth">
          <select
            value={berthId}
            onChange={(e) => setBerthId(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          >
            {berths.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} {b.lengthFt === null ? '(length not recorded)' : `— ${b.lengthFt}′`}
              </option>
            ))}
          </select>
        </Field>

        {kind === 'vessel' ? (
          <Field label={`Vessel (${vessels.length} on record)`}>
            <input
              list="vessel-list"
              value={vesselId}
              onChange={(e) => setVesselId(e.target.value)}
              placeholder="Start typing a vessel name…"
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
            <datalist id="vessel-list">
              {vessels.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.displayName}
                  {v.lengthFt === null ? ' — length unknown' : ` — ${v.lengthFt}′`}
                </option>
              ))}
            </datalist>
            {selectedVessel && (
              <p className="mt-1 text-xs text-slate-500">
                {selectedVessel.displayName} ·{' '}
                {selectedVessel.lengthFt === null ? (
                  <span className="text-sky-700">no length on record</span>
                ) : (
                  `${selectedVessel.lengthFt}′`
                )}
              </p>
            )}
          </Field>
        ) : (
          <Field label="Event description">
            <input
              value={eventLabel}
              onChange={(e) => setEventLabel(e.target.value)}
              placeholder="e.g. Community sail day"
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="First day">
            <input
              type="date"
              value={start}
              onChange={(e) => {
                setStart(e.target.value)
                if (!end) setEnd(e.target.value)
              }}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="Last day (inclusive)">
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </Field>
        </div>

        {blocked && (
          <Field label="Override reason (required to book anyway)">
            <input
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="e.g. rafting alongside, approved by harbourmaster"
              className="w-full rounded border border-amber-400 bg-amber-50 px-2 py-1.5 text-sm"
            />
          </Field>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="w-full rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {saving ? 'Saving…' : blocked ? 'Book anyway with reason' : 'Create booking'}
        </button>

        {created && draft && created.forDraft === keyOf(draft) && (
          <p className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-900 ring-1 ring-emerald-200">
            Booking #{created.id} created.{' '}
            <Link href={`/?year=${start.slice(0, 4)}&month=${Number(start.slice(5, 7))}`} className="underline">
              View it on the schedule →
            </Link>
          </p>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Checks {pending && <span className="font-normal normal-case">· checking…</span>}
        </h2>

        {!draft && (
          <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">
            Choose a berth, {kind === 'vessel' ? 'a vessel' : 'an event'} and a date range. Conflicts
            and berth fit are checked as you type, before anything is saved.
          </p>
        )}

        {report && (
          <div className="space-y-3">
            {report.errors.length > 0 && (
              <Box tone="bad" title="Cannot save">
                <ul className="list-inside list-disc">
                  {report.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </Box>
            )}

            <Box
              tone={
                report.fit.status === 'violation'
                  ? 'warn'
                  : report.fit.status === 'unverifiable'
                    ? 'info'
                    : 'good'
              }
              title={
                report.fit.status === 'fits'
                  ? 'Fits the berth'
                  : report.fit.status === 'violation'
                    ? 'Too long for this berth'
                    : report.fit.status === 'unverifiable'
                      ? 'Cannot verify fit'
                      : 'No fit check needed'
              }
            >
              {report.fit.reason}
              {report.fit.status === 'unverifiable' && (
                <>
                  {' '}
                  This booking is <strong>not</strong> being approved as fitting — it simply cannot
                  be checked.
                </>
              )}
            </Box>

            {report.conflicts.length === 0 ? (
              <Box tone="good" title="Berth is free">
                Nothing else is booked in {selectedBerth?.name} over these dates.
              </Box>
            ) : (
              report.conflicts.map((c, i) => {
                const other = c.a.id === '__draft__' ? c.b : c.a
                return (
                  <Box
                    key={i}
                    tone={c.severity === 'violation' ? 'bad' : 'warn'}
                    title={
                      c.severity === 'violation'
                        ? `Double-booked with ${other.label}`
                        : `Same-day turnaround with ${other.label}`
                    }
                  >
                    {other.label} occupies {other.berthId} from {other.start} to {other.end} —{' '}
                    {c.sharedDays} day{c.sharedDays === 1 ? '' : 's'} shared.
                  </Box>
                )
              })
            )}

            {blocked && (
              <p className="text-xs text-slate-500">
                This would normally be refused. You can still book it by recording a reason — the
                reason is stored with the booking.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
    </label>
  )
}

function Box({
  tone,
  title,
  children,
}: {
  tone: 'good' | 'bad' | 'warn' | 'info'
  title: string
  children: React.ReactNode
}) {
  const tones = {
    good: 'bg-emerald-50 text-emerald-900 ring-emerald-200',
    bad: 'bg-red-50 text-red-900 ring-red-200',
    warn: 'bg-amber-50 text-amber-900 ring-amber-200',
    info: 'bg-sky-50 text-sky-900 ring-sky-200',
  } as const
  return (
    <div className={`rounded-lg px-4 py-3 text-sm ring-1 ${tones[tone]}`}>
      <div className="font-semibold">{title}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  )
}
