'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Inbox, ExternalLink } from 'lucide-react'
import type { FindingRow } from '@/lib/findings'
import type { ChangeEntry, Disposition } from '@/lib/data'
import { dismissFinding } from '@/app/actions'
import { PairLengthFix } from './PairLengthFix'

type Props = {
  row: FindingRow | null
  disposition: Disposition | null
  openCount: number
  archiveCounts: { overlap: number; cross: number; oversize: number }
  changes: ChangeEntry[]
}

function fmt(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleString('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/**
 * The detail pane. Everything about one finding, and every action on it,
 * without leaving the page. Nothing selected shows one glyph and one
 * computed sentence, not an illustration.
 */
export function FindingDetail({ row, disposition, openCount, archiveCounts, changes }: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [note, setNote] = useState('')

  if (!row) {
    return (
      <div className="hidden min-h-0 flex-1 flex-col sm:flex">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <Inbox size={40} strokeWidth={1} aria-hidden className="text-line" />
          <p className="tnum max-w-[36ch] text-[13px] text-mute">
            {openCount === 0 ? 'Nothing open. ' : `${openCount} open. `}
            {archiveCounts.overlap} overlaps, {archiveCounts.cross} in two berths and {archiveCounts.oversize} oversize pairings in the archive.
          </p>
        </div>
        <RecentChanges changes={changes} />
      </div>
    )
  }

  const act = (status: Disposition['status'] | null) =>
    start(async () => {
      await dismissFinding(row.fingerprint, status, note)
      setNote('')
      router.refresh()
    })

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-[720px] px-6 py-6">
        <p className="text-[12px] uppercase tracking-[0.06em] text-mute">
          {row.kind === 'overlap' ? 'Two stays in one berth' : row.kind === 'cross' ? 'One vessel in two berths' : 'Too long for the berth'}
          {row.open ? '' : ' · archive'}
        </p>
        <h2 className="mt-1 text-[17px] font-medium tracking-[-0.02em] text-ink">{row.title}</h2>
        <p className="tnum mt-1 text-[13px] text-mute">{row.detail}</p>

        <div className="mt-5 divide-y divide-line rounded-[8px] border border-line bg-panel">
          {row.stays.slice(0, 8).map((s) => (
            <div key={s.id} className="flex items-baseline gap-3 px-4 py-2.5 text-[13px]">
              <span className="min-w-0 flex-1 truncate text-ink">{s.label}</span>
              <span className="tnum shrink-0 text-mute">{s.berthId}</span>
              <span className="tnum shrink-0 text-mute">
                {s.start === s.end ? fmt(s.start) : `${fmt(s.start)} to ${fmt(s.end)}`}
              </span>
            </div>
          ))}
          {row.stays.length > 8 && (
            <p className="tnum px-4 py-2 text-[12px] text-mute">and {row.stays.length - 8} more</p>
          )}
        </div>

        {row.kind === 'oversize' && row.vessel && (
          <div className="mt-5">
            <p className="text-[12px] uppercase tracking-[0.06em] text-mute">Length on roster</p>
            <div className="mt-1.5">
              <PairLengthFix vesselId={row.vessel.id} currentFt={row.vessel.lengthFt ?? 0} berthFt={row.vessel.berthFt} />
            </div>
            <p className="tnum mt-1.5 text-[12px] text-mute">
              Is the roster wrong, or does {row.berthId} tolerate {row.vessel.overFt} ft of overhang? A corrected length settles every stay in this group.
            </p>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Link
            href={`/?year=${row.link.year}&month=${row.link.month}${row.link.trace ? `&trace=${encodeURIComponent(row.link.trace)}` : ''}`}
            className="inline-flex items-center gap-1.5 rounded border border-line bg-panel px-2.5 py-1.5 text-[13px] text-ink hover:bg-wash"
          >
            <ExternalLink size={14} strokeWidth={1.75} aria-hidden />
            Open on schedule
          </Link>
        </div>

        <div className="mt-6 border-t border-line pt-5">
          <p className="text-[12px] uppercase tracking-[0.06em] text-mute">Decision</p>
          {disposition ? (
            <div className="mt-2 text-[13px]">
              <p className="text-ink">
                Marked <span className="font-medium">{disposition.status === 'data_error' ? 'data error' : disposition.status}</span>
                <span className="tnum text-mute"> · {disposition.decidedAt.slice(0, 10)}</span>
              </p>
              {disposition.note && <p className="mt-1 text-mute">{disposition.note}</p>}
              <button type="button" disabled={pending} onClick={() => act(null)} className="mt-2 text-[12px] text-mute hover:text-ink">
                Reopen
              </button>
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Note, optional. e.g. rafted alongside, agreed with the skipper"
                className="w-full rounded border border-line bg-panel px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-sea"
              />
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={pending} onClick={() => act('accepted')} className="rounded bg-ink px-2.5 py-1.5 text-[13px] text-paper disabled:opacity-50">
                  Accept as is
                </button>
                <button type="button" disabled={pending} onClick={() => act('data_error')} className="rounded border border-line bg-panel px-2.5 py-1.5 text-[13px] text-ink hover:bg-wash disabled:opacity-50">
                  Data error
                </button>
              </div>
              <p className="text-[12px] text-mute">
                Accept: the situation was fine in practice. Data error: the sheet or the roster is wrong. Either way the row leaves the list and the decision is kept.
              </p>
            </div>
          )}
        </div>
      </div>
      <RecentChanges changes={changes} />
    </div>
  )
}

function RecentChanges({ changes }: { changes: ChangeEntry[] }) {
  if (changes.length === 0) return null
  return (
    <div className="mt-auto border-t border-line px-6 py-4">
      <p className="text-[12px] uppercase tracking-[0.06em] text-mute">Recent changes</p>
      <ul className="mt-2 space-y-1">
        {changes.slice(0, 8).map((c) => {
          const row = c.new ?? c.old
          const what = row?.label ?? row?.display_name ?? c.rowId
          const verb = c.op === 'INSERT' ? 'added' : c.op === 'DELETE' ? 'removed' : 'changed'
          return (
            <li key={c.id} className="tnum flex gap-3 text-[12px] text-mute">
              <span className="shrink-0">{String(c.at).slice(0, 10)}</span>
              <span className="min-w-0 truncate">
                {verb} {c.tbl === 'vessel' ? 'vessel' : 'stay'} {String(what)}
                {c.op === 'UPDATE' && c.tbl === 'vessel' && ` · length ${c.old?.length_ft ?? 'none'} to ${c.new?.length_ft ?? 'none'} ft`}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
