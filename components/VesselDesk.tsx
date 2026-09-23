'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Vessel } from '@/lib/validation/engine'
import { addVessel, updateVesselLength } from '@/app/actions'

type Props = { vessels: Vessel[] }

export function VesselDesk({ vessels }: Props) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [newName, setNewName] = useState('')
  const [newLen, setNewLen] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = needle
      ? vessels.filter((v) => v.displayName.toLowerCase().includes(needle))
      : vessels
    return [...list].sort((a, b) => a.displayName.localeCompare(b.displayName))
  }, [vessels, q])

  function saveLength(id: string, raw: string) {
    const trimmed = raw.trim()
    const ft = trimmed === '' ? null : Number(trimmed)
    setError(null)
    start(async () => {
      const res = await updateVesselLength(id, ft)
      if (res.status === 'refused') setError(res.message)
      else router.refresh()
    })
  }

  function create() {
    const ft = newLen.trim() === '' ? null : Number(newLen)
    setError(null)
    start(async () => {
      const res = await addVessel(newName, ft)
      if (res.status === 'refused') setError(res.message)
      else {
        setNewName('')
        setNewLen('')
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[180px] flex-1 text-[11px] uppercase tracking-[0.06em] text-mute">
          Find
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name"
            className="mt-1 w-full rounded border border-line bg-panel px-2 py-2 text-[13px] text-ink outline-none focus:border-sea"
          />
        </label>
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-panel">
        <table className="w-full text-sm">
          <thead className="bg-wash text-left text-[11px] uppercase tracking-[0.06em] text-mute">
            <tr>
              <th className="px-4 py-2 font-medium">Vessel</th>
              <th className="w-36 px-4 py-2 font-medium">Length, ft</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((v) => (
              <LengthRow
                key={`${v.id}-${v.lengthFt ?? 'x'}`}
                vessel={v}
                onSave={saveLength}
                disabled={pending}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-line bg-panel p-4">
        <h2 className="text-[14px] font-medium">Add a vessel</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="min-w-[200px] flex-1 text-[11px] uppercase tracking-[0.06em] text-mute">
            Name
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="R/V Atlantis"
              className="mt-1 w-full rounded border border-line bg-panel px-2 py-2 text-[13px] text-ink outline-none focus:border-sea"
            />
          </label>
          <label className="w-28 text-[11px] uppercase tracking-[0.06em] text-mute">
            Length
            <input
              type="number"
              min={1}
              value={newLen}
              onChange={(e) => setNewLen(e.target.value)}
              placeholder="ft"
              className="mt-1 w-full rounded border border-line bg-panel px-2 py-2 text-[13px] text-ink outline-none focus:border-sea"
            />
          </label>
          <button
            type="button"
            onClick={create}
            disabled={pending || !newName.trim()}
            className="rounded bg-sea px-3.5 py-2 text-[13px] text-white disabled:bg-line disabled:text-mute"
          >
            Add
          </button>
        </div>
      </div>

      {error && <p className="text-[13px] text-conflict">{error}</p>}
    </div>
  )
}

function LengthRow({
  vessel,
  onSave,
  disabled,
}: {
  vessel: Vessel
  onSave: (id: string, raw: string) => void
  disabled: boolean
}) {
  const [draft, setDraft] = useState(vessel.lengthFt == null ? '' : String(vessel.lengthFt))
  const current = vessel.lengthFt == null ? '' : String(vessel.lengthFt)
  const dirty = draft !== current

  return (
    <tr className={vessel.lengthFt == null ? 'bg-wash/50' : undefined}>
      <td className="px-4 py-2 font-medium">{vessel.displayName}</td>
      <td className="px-4 py-1.5">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            onSave(vessel.id, draft)
          }}
        >
          <input
            type="number"
            min={1}
            value={draft}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (dirty) onSave(vessel.id, draft)
            }}
            placeholder="—"
            className="tnum w-20 rounded border border-line bg-panel px-2 py-1 text-[13px] outline-none focus:border-sea"
          />
          {dirty && (
            <button type="submit" className="text-[12px] text-sea">
              Save
            </button>
          )}
        </form>
      </td>
    </tr>
  )
}
