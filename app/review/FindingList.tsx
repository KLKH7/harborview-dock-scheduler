import Link from 'next/link'
import { Layers, Split, Ruler } from 'lucide-react'
import type { FindingRow, FindingKind } from '@/lib/findings'
import type { Disposition } from '@/lib/data'
import { relativeDays } from '@/lib/relative-time'

const ICON: Record<FindingKind, typeof Layers> = { overlap: Layers, cross: Split, oversize: Ruler }
const KIND_LABEL: Record<FindingKind, string> = { overlap: 'two in one berth', cross: 'one in two berths', oversize: 'too long' }

type Props = {
  rows: FindingRow[]
  todoCount: number
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
 * The list pane. One flat list of what still needs a decision, soonest
 * first. One row shape for every kind of finding: a glyph, the title, one
 * line of context, and how far from today it is. Nothing needs a hover to
 * be read, and nothing needs a click to leave the page.
 */
export function FindingList({ rows, todoCount, dismissedCount, showDismissed, dispositions, selected, today, lever }: Props) {
  return (
    <div className="flex w-full min-w-0 flex-col border-r border-line sm:w-[440px] sm:shrink-0">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-line px-4">
        <h1 className="text-[15px] font-medium tracking-[-0.02em] text-ink">Review</h1>
        <span className="tnum text-[12px] text-mute">{todoCount} to review</span>
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
        {lever.of > 0 && lever.clears > 0 && (
          <p className="tnum border-b border-line px-4 py-2.5 text-[12px] text-mute">
            Setting a length for {lever.vessels} vessel{lever.vessels === 1 ? '' : 's'} would settle {lever.clears} of the {lever.of} oversize stays.
          </p>
        )}

        {rows.length === 0 ? (
          <p className="border-b border-line px-4 py-3 text-[13px] text-mute">
            Nothing to review. Every stay passes both checks.
          </p>
        ) : (
          rows.map((r) => (
            <Row key={r.fingerprint} r={r} today={today} selected={selected === r.fingerprint} disp={dispositions[r.fingerprint]} />
          ))
        )}
      </div>
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
