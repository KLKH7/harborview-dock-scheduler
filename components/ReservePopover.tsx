'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import type { BerthRow } from '@/lib/data'
import { dayCount, type Vessel } from '@/lib/validation/engine'
import { createReservation } from '@/app/actions'

export type PendingSelection = {
  berthId: string
  start: string
  end: string
  anchorRect: DOMRect | null
}

type Props = {
  selection: PendingSelection
  berths: BerthRow[]
  vessels: Vessel[]
  onCancel: () => void
  onReserved: (id: string) => void
}

const PANEL_W = 300
/** Enough to flip the panel above the row near the bottom of the window. */
const PANEL_H_EST = 250

function prettyRange(start: string, end: string) {
  const fmt = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleString('en', {
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    })
  const n = dayCount(start, end)
  const span = start === end ? fmt(start) : `${fmt(start)} to ${fmt(end)}`
  return `${span}, ${n} day${n === 1 ? '' : 's'}`
}

/**
 * The reserve panel.
 *
 * Deliberately not a form of date fields: the dates were already chosen by
 * dragging on the schedule, so they appear here as a line of text to confirm
 * the drag did what was meant. What remains is one choice and one name.
 *
 * Rendered in the top layer via the Popover API so it escapes the grid's
 * horizontal scroll container without being clipped. Position is computed from
 * the anchor rect rather than CSS anchor positioning, which Safari does not
 * support yet.
 */
export function ReservePopover({ selection, berths, vessels, onCancel, onReserved }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const [kind, setKind] = useState<'vessel' | 'event'>('vessel')
  const [name, setName] = useState('')
  const [pending, startTransition] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)

  const berth = berths.find((b) => b.id === selection.berthId)!
  const vessel = useMemo(
    () => vessels.find((v) => v.displayName.toLowerCase() === name.trim().toLowerCase()) ?? null,
    [vessels, name],
  )

  // Fit is known only once a vessel resolves, so it cannot be prevented during
  // the drag the way an overlap can. It refuses here instead, the moment the
  // name matches, rather than after the reserve button is pressed.
  const oversize =
    kind === 'vessel' &&
    vessel?.lengthFt != null &&
    berth.lengthFt != null &&
    vessel.lengthFt > berth.lengthFt

  const unverifiable = kind === 'vessel' && vessel != null && vessel.lengthFt == null

  const fits = useMemo(() => {
    if (!oversize || vessel?.lengthFt == null) return []
    return berths.filter((b) => b.lengthFt != null && b.lengthFt >= vessel.lengthFt!)
  }, [oversize, vessel, berths])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!el.matches(':popover-open')) {
      try {
        el.showPopover()
      } catch {
        // popover unsupported: the element still renders as a fixed panel
      }
    }
    nameRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  // The popover renders in the top layer, so it is positioned in viewport
  // coordinates. Derived during render rather than stored in state: the anchor
  // is fixed for the life of this selection, so there is nothing to settle.
  const pos = useMemo(() => {
    const rect = selection.anchorRect
    if (typeof window === 'undefined') return { left: 24, top: 96 }
    if (!rect) return { left: 24, top: 96 }
    const left = Math.min(
      Math.max(8, rect.left + rect.width / 2 - PANEL_W / 2),
      window.innerWidth - PANEL_W - 8,
    )
    // Prefer below the selection, flip above when it would run off the bottom.
    const below = rect.bottom + 6
    const top = below + PANEL_H_EST > window.innerHeight - 8
      ? Math.max(8, rect.top - PANEL_H_EST - 6)
      : below
    return { left, top }
  }, [selection.anchorRect])

  const canReserve = !pending && !oversize && (kind === 'event' ? name.trim() !== '' : vessel != null)

  function reserve() {
    if (!canReserve) return
    setServerError(null)
    startTransition(async () => {
      const res = await createReservation({
        berthId: selection.berthId,
        start: selection.start,
        end: selection.end,
        kind,
        vesselId: kind === 'vessel' ? (vessel?.id ?? null) : null,
        label: kind === 'vessel' ? (vessel?.displayName ?? name.trim()) : name.trim(),
      })
      if (res.status === 'created') onReserved(res.id)
      else setServerError(res.message)
    })
  }

  return (
    <div
      ref={ref}
      popover="manual"
      className="m-0 rounded-[8px] border border-line bg-panel p-3 text-ink shadow-[0_1px_2px_rgba(75,69,59,0.06)]"
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        width: PANEL_W,
        inset: 'auto',
      }}
    >
      <div className="text-[13px] text-ink">{berth.name}</div>
      <div className="tnum mt-0.5 text-[12px] text-mute">
        {prettyRange(selection.start, selection.end)}
      </div>

      <div className="mt-3 inline-flex rounded-[4px] border border-line p-0.5" role="radiogroup">
        {(['vessel', 'event'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            className={`rounded-[3px] px-2.5 py-1 text-[12px] ${
              kind === k ? 'bg-occupied text-ink' : 'text-mute hover:text-ink'
            }`}
          >
            {k === 'vessel' ? 'Vessel' : 'Event'}
          </button>
        ))}
      </div>

      <label className="mt-3 block">
        <span className="mb-1 block text-[11px] uppercase tracking-wide text-mute">
          {kind === 'vessel' ? 'Vessel' : 'What is happening'}
        </span>
        <input
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          list={kind === 'vessel' ? 'vessel-names' : undefined}
          aria-describedby={oversize ? 'fit-refusal' : undefined}
          placeholder={kind === 'vessel' ? 'Name or part of it' : 'Community sail day'}
          className="w-full rounded-[4px] border border-line bg-panel px-2 py-1.5 text-[13px] outline-none focus:border-ink"
        />
        {kind === 'vessel' && (
          <datalist id="vessel-names">
            {vessels.map((v) => (
              <option key={v.id} value={v.displayName} />
            ))}
          </datalist>
        )}
      </label>

      {kind === 'vessel' && vessel?.lengthFt != null && !oversize && (
        <p className="tnum mt-1 text-[11px] text-mute">{vessel.lengthFt} ft, from roster</p>
      )}

      {unverifiable && (
        <p className="mt-1 text-[11px] text-mute">
          No length on record for this vessel. Fit not checked.
        </p>
      )}

      {oversize && vessel && (
        <div id="fit-refusal" className="tnum mt-1.5 text-[12px] text-conflict">
          {vessel.displayName} is {vessel.lengthFt} ft. {berth.name} is {berth.lengthFt} ft.
          {fits.length > 0 && (
            <span className="mt-0.5 block text-mute">
              Fits at {fits.map((b) => b.name).join(', ')}.
            </span>
          )}
        </div>
      )}

      {serverError && <p className="mt-1.5 text-[12px] text-conflict">{serverError}</p>}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={reserve}
          disabled={!canReserve}
          className="rounded-[4px] bg-ink px-3 py-1.5 text-[12px] text-paper disabled:bg-line disabled:text-mute"
        >
          {pending ? 'Saving' : 'Reserve'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-[4px] px-2 py-1.5 text-[12px] text-mute hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
