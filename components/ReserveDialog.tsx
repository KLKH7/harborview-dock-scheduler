'use client'

import { useMemo, useState, useTransition } from 'react'
import type { BerthRow } from '@/lib/data'
import { dayCount, findAvailableBerths, type Reservation, type Vessel } from '@/lib/validation/engine'
import { createReservation } from '@/app/actions'

type Props = {
  berths: BerthRow[]
  vessels: Vessel[]
  /** Every stay, all berths. Needed to say which berths are actually free. */
  reservations: Reservation[]
  defaultStart: string
  onClose: () => void
  onReserved: (id: string, start: string) => void
}

/**
 * First-class booking. Drag on the grid is a shortcut for the month in view.
 * This is how you put a vessel or an event on a berth for any dates.
 */
export function ReserveDialog({ berths, vessels, reservations, defaultStart, onClose, onReserved }: Props) {
  const [kind, setKind] = useState<'vessel' | 'event'>('vessel')
  const [berthId, setBerthId] = useState(berths[0]?.id ?? '')
  const [start, setStart] = useState(defaultStart)
  const [end, setEnd] = useState(defaultStart)
  const [name, setName] = useState('')
  const [length, setLength] = useState('')
  const [pending, startTransition] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)

  const berth = berths.find((b) => b.id === berthId)
  const vessel = useMemo(
    () => vessels.find((v) => v.displayName.toLowerCase() === name.trim().toLowerCase()) ?? null,
    [vessels, name],
  )
  const isNewHull = kind === 'vessel' && name.trim() !== '' && vessel == null
  const parsedLength = length.trim() === '' ? null : Number(length)
  const lengthFt = vessel?.lengthFt ?? (Number.isFinite(parsedLength) ? parsedLength : null)

  const oversize =
    kind === 'vessel' &&
    lengthFt != null &&
    berth?.lengthFt != null &&
    lengthFt > berth.lengthFt

  const datesOk = /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && end >= start

  // The finder. Once dates are known, every berth is sorted into free and long
  // enough, too short, or occupied, before the user has picked one. This is
  // the question the coordinator used to answer by scanning rows.
  const finder = useMemo(() => {
    if (!datesOk) return null
    return findAvailableBerths(start, end, kind === 'vessel' ? lengthFt : null, berths, reservations)
  }, [datesOk, start, end, kind, lengthFt, berths, reservations])
  const fits = finder?.available ?? []
  const canReserve =
    !pending &&
    !oversize &&
    datesOk &&
    berthId &&
    (kind === 'event' ? name.trim() !== '' : name.trim() !== '')

  function reserve() {
    if (!canReserve) return
    setServerError(null)
    startTransition(async () => {
      const res = await createReservation({
        berthId,
        start,
        end,
        kind,
        vesselId: kind === 'vessel' ? (vessel?.id ?? null) : null,
        label: name.trim(),
        newVesselLengthFt: isNewHull ? parsedLength : null,
      })
      if (res.status === 'created') onReserved(res.id, start)
      else setServerError(res.message)
    })
  }

  const span = datesOk ? dayCount(start, end) : 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/25 px-4 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-labelledby="reserve-title"
        className="w-full max-w-[420px] rounded-lg border border-line bg-panel p-5 text-ink shadow-[0_8px_24px_rgba(35,31,32,0.12)]"
      >
        <h2 id="reserve-title" className="text-[16px] font-medium tracking-[-0.03em]">
          Reserve a berth
        </h2>
        <p className="mt-1 text-[13px] text-mute">
          Dates and berth first. The system refuses a double-booking or a vessel that does not fit.
        </p>

        <div className="mt-4 inline-flex rounded border border-line p-0.5" role="radiogroup">
          {(['vessel', 'event'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={`rounded px-2.5 py-1 text-[12px] ${
                kind === k ? 'bg-sea-fill text-sea' : 'text-mute hover:text-ink'
              }`}
            >
              {k === 'vessel' ? 'Vessel' : 'Event'}
            </button>
          ))}
        </div>

        <label className="mt-4 block text-[11px] uppercase tracking-[0.06em] text-mute">
          Berth
          <select
            value={berthId}
            onChange={(e) => setBerthId(e.target.value)}
            className="mt-1 w-full rounded border border-line bg-panel px-2 py-2 text-[13px] text-ink outline-none focus:border-sea"
          >
            {berths.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.lengthFt != null ? ` · ${b.lengthFt} ft` : ''}
              </option>
            ))}
          </select>
        </label>

        {finder && (
          <div className="tnum mt-2 space-y-0.5 text-[12px]">
            {finder.available.length > 0 ? (
              <p className="text-mute">
                Free:{' '}
                {finder.available.map((b, i) => (
                  <span key={b.id}>
                    {i > 0 && ', '}
                    <button
                      type="button"
                      onClick={() => setBerthId(b.id)}
                      className={`underline-offset-2 hover:underline ${b.id === berthId ? 'text-ink' : 'text-sea'}`}
                    >
                      {b.name}
                    </button>
                  </span>
                ))}
              </p>
            ) : (
              <p className="text-conflict">No berth is free and long enough for these dates.</p>
            )}
            {finder.tooShort.length > 0 && (
              <p className="text-mute">Too short: {finder.tooShort.map((b) => b.name).join(', ')}</p>
            )}
            {finder.occupied.length > 0 && (
              <p className="text-mute">
                Occupied: {finder.occupied.map((o) => `${o.berth.name} (${o.by[0].label})`).join(', ')}
              </p>
            )}
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block text-[11px] uppercase tracking-[0.06em] text-mute">
            Arrive
            <input
              type="date"
              value={start}
              onChange={(e) => {
                setStart(e.target.value)
                if (e.target.value > end) setEnd(e.target.value)
              }}
              className="mt-1 w-full rounded border border-line bg-panel px-2 py-2 text-[13px] text-ink outline-none focus:border-sea"
            />
          </label>
          <label className="block text-[11px] uppercase tracking-[0.06em] text-mute">
            Depart
            <input
              type="date"
              value={end}
              min={start}
              onChange={(e) => setEnd(e.target.value)}
              className="mt-1 w-full rounded border border-line bg-panel px-2 py-2 text-[13px] text-ink outline-none focus:border-sea"
            />
          </label>
        </div>
        {datesOk && (
          <p className="tnum mt-1 text-[12px] text-mute">
            {span} day{span === 1 ? '' : 's'}
          </p>
        )}

        <label className="mt-3 block text-[11px] uppercase tracking-[0.06em] text-mute">
          {kind === 'vessel' ? 'Vessel' : 'What is happening'}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            list={kind === 'vessel' ? 'reserve-vessel-names' : undefined}
            placeholder={kind === 'vessel' ? 'R/V Atlantis' : 'Community sail day'}
            className="mt-1 w-full rounded border border-line bg-panel px-2 py-2 text-[13px] text-ink outline-none focus:border-sea"
          />
        </label>
        {kind === 'vessel' && (
          <datalist id="reserve-vessel-names">
            {vessels.map((v) => (
              <option key={v.id} value={v.displayName} />
            ))}
          </datalist>
        )}

        {kind === 'vessel' && vessel?.lengthFt != null && (
          <p className="tnum mt-1 text-[12px] text-mute">{vessel.lengthFt} ft</p>
        )}

        {isNewHull && (
          <label className="mt-3 block text-[11px] uppercase tracking-[0.06em] text-mute">
            Length, feet
            <input
              type="number"
              min={1}
              value={length}
              onChange={(e) => setLength(e.target.value)}
              placeholder="needed to check fit"
              className="mt-1 w-full rounded border border-line bg-panel px-2 py-2 text-[13px] text-ink outline-none focus:border-sea"
            />
          </label>
        )}

        {oversize && berth && lengthFt != null && (
          <p className="tnum mt-2 text-[12px] text-conflict">
            {name.trim() || 'This vessel'} is {lengthFt} ft. {berth.name} is {berth.lengthFt} ft.
            {fits.length > 0 && (
              <span className="mt-0.5 block text-mute">
                Fits at {fits.map((b) => b.name).join(', ')}.
              </span>
            )}
          </p>
        )}

        {serverError && <p className="mt-2 text-[12px] text-conflict">{serverError}</p>}

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={reserve}
            disabled={!canReserve}
            className="rounded bg-sea px-3.5 py-2 text-[13px] text-white disabled:bg-line disabled:text-mute"
          >
            {pending ? 'Saving' : 'Reserve'}
          </button>
          <button type="button" onClick={onClose} className="px-2 py-2 text-[13px] text-mute hover:text-ink">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
