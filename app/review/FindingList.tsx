'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Layers, Split, Ruler } from 'lucide-react'
import type { FindingRow, FindingKind } from '@/lib/findings'
import type { Disposition } from '@/lib/data'
import { relativeDays } from '@/lib/relative-time'

const ICON: Record<FindingKind, typeof Layers> = { overlap: Layers, cross: Split, oversize: Ruler }
const KIND_LABEL: Record<FindingKind, string> = { overlap: 'two in one berth', cross: 'one in two berths', oversize: 'too long' }

type Props = {
  rows: FindingRow[]
  openCount: number
  archiveCounts: { overlap: number; cross: number; oversize: number; oversizeStays: number }
  archiveRange: string
  dismissedCount: number
  showDismissed: boolean
  dispositions: Record<string, Disposition>
  selected: string | null
  today: string
  lever: { vessels: number; clears: number; of: number }
}

function fmtShort(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleString('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/**
 * The list pane. One row shape for every kind of finding: a glyph, the title,
 * one line of context, and how far from today it is. Nothing needs a hover
 * to be read, and nothing needs a click to leave the page.
 */
export function FindingList({ rows, openCount, archiveCounts, archiveRange, dismissedCount, showDismissed, dispositions, selected, today, lever }: Props) {
  const [archiveOpen, setArchiveOpen] = useState(openCount === 0 && !!selected)
  const open = rows.filter((r) => r.open)
  const archive = rows.filter((r) => !r.open)

  const archiveLine = [
    archiveCounts.overlap && `${archiveCounts.overlap} overlap${archiveCounts.overlap === 1 ? '' : 's'}`,
    archiveCounts.cross && `${archiveCounts.cross} in two berths`,
    archiveCounts.oversize && `${archiveCounts.oversizeStays} too long across ${archiveCounts.oversize} pairings`,
  ].filter(Boolean).join(', ')

  return (
    <div className="flex w-full min-w-0 flex-col border-r border-line sm:w-[440px] sm:shrink-0">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-line px-4">
        <h1 className="text-[15px] font-medium tracking-[-0.02em] text-ink">Review</h1>
        {dismissedCount > 0 && (
          <Link
            href={showDismissed ? '/review' : '/review?dismissed=1'}
            className="ml-auto text-[12px] text-mute hover:text-ink"
          >
            {showDismissed ? 'Hide dismissed' : `Dismissed ${dismissedCount}`}
          </Link>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section
          heading="Open"
          count={open.length}
          note={open.length === 0 ? 'Nothing open. Every stay from today on passes both checks.' : undefined}
        >
          {open.map((r) => <Row key={r.fingerprint} r={r} today={today} selected={selected === r.fingerprint} disp={dispositions[r.fingerprint]} />)}
        </Section>

        {lever.of > 0 && lever.clears > 0 && (
          <p className="tnum border-b border-line px-4 py-2.5 text-[12px] text-mute">
            Setting a length for {lever.vessels} vessel{lever.vessels === 1 ? '' : 's'} would settle {lever.clears} of the {lever.of} oversize stays in the archive.
          </p>
        )}

        <button
          type="button"
          onClick={() => setArchiveOpen((o) => !o)}
          aria-expanded={archiveOpen}
          className="flex w-full items-baseline gap-2 border-b border-line px-4 py-2.5 text-left hover:bg-wash"
        >
          <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-mute">Archive</span>
          <span className="tnum min-w-0 flex-1 truncate text-[12px] text-mute">
            {archiveRange}: {archiveLine || 'nothing'}
          </span>
          <span className="text-[12px] text-mute">{archiveOpen ? 'hide' : 'show'}</span>
        </button>
        {archiveOpen && archive.map((r) => (
          <Row key={r.fingerprint} r={r} today={today} selected={selected === r.fingerprint} disp={dispositions[r.fingerprint]} />
        ))}
      </div>
    </div>
  )
}

function Section({ heading, count, note, children }: { heading: string; count: number; note?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline gap-2 border-b border-line px-4 py-2.5">
        <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-mute">{heading}</span>
        <span className="tnum text-[12px] text-mute">{count}</span>
      </div>
      {note && <p className="border-b border-line px-4 py-3 text-[13px] text-mute">{note}</p>}
      {children}
    </div>
  )
}

function Row({ r, today, selected, disp }: { r: FindingRow; today: string; selected: boolean; disp?: Disposition }) {
  const Icon = ICON[r.kind]
  const alarm = r.open && !disp
  return (
    <Link
      href={`/review?f=${encodeURIComponent(r.fingerprint)}`}
      aria-current={selected ? 'true' : undefined}
      className={`flex gap-3 border-b border-line px-4 py-2.5 ${selected ? 'bg-wash' : 'hover:bg-wash/60'} ${disp ? 'opacity-60' : ''}`}
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden className={`mt-0.5 shrink-0 ${alarm ? 'text-conflict' : 'text-mute'}`} />
      <div className="min-w-0 flex-1">
        <div className={`truncate text-[13px] text-ink ${disp ? 'line-through' : ''}`}>{r.title}</div>
        <div className="tnum truncate text-[12px] text-mute">
          {KIND_LABEL[r.kind]} · {fmtShort(r.when)}
          {disp && ` · ${disp.status === 'data_error' ? 'data error' : disp.status}`}
        </div>
      </div>
      <span className="tnum shrink-0 self-start text-[12px] text-mute">{relativeDays(r.when, today)}</span>
    </Link>
  )
}
