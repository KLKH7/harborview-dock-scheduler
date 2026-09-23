'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateVesselLength } from '@/app/actions'

/**
 * Inline length correction for one vessel.
 *
 * A vessel refused 49 times in the same berth is one question, not 49: is the
 * roster length wrong, or does the berth tolerate the overhang? Fixing the
 * length here clears every stay in the group at once.
 */
export function PairLengthFix({
  vesselId,
  currentFt,
  berthFt,
}: {
  vesselId: string
  currentFt: number
  berthFt: number | null
}) {
  const router = useRouter()
  const [draft, setDraft] = useState(String(currentFt))
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const n = Number(draft)
  const dirty = draft.trim() !== '' && n !== currentFt
  const wouldFit = berthFt != null && Number.isFinite(n) && n <= berthFt

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!dirty) return
        setError(null)
        start(async () => {
          const res = await updateVesselLength(vesselId, n)
          if (res.status === 'refused') setError(res.message)
          else router.refresh()
        })
      }}
    >
      <input
        type="number"
        min={1}
        value={draft}
        disabled={pending}
        onChange={(e) => setDraft(e.target.value)}
        aria-label="Vessel length in feet"
        className="tnum w-16 rounded border border-line bg-panel px-1.5 py-1 text-[12px] outline-none focus:border-sea"
      />
      <span className="text-[11px] text-mute">ft</span>
      {dirty && (
        <button type="submit" disabled={pending} className="text-[12px] text-sea">
          {pending ? 'Saving' : wouldFit ? 'Save, clears group' : 'Save'}
        </button>
      )}
      {error && <span className="text-[12px] text-conflict">{error}</span>}
    </form>
  )
}
