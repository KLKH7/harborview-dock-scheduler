import Link from 'next/link'
import type { DayBoard as Board } from '@/lib/data'

function fmt(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleString('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/**
 * The 8am line. One sentence, not a dashboard: on a typical day the desk has
 * about three vessels in port, one leaving, five due this week. Numbers that
 * small do not need tiles.
 */
export function DayBoard({ board }: { board: Board }) {
  const empty = board.inPort.length === 0 && board.arriving.length === 0 && board.departing.length === 0

  if (empty) {
    return (
      <p className="tnum px-5 py-2 text-[13px] text-mute sm:px-8">
        Nothing alongside today. All {board.berthCount} berths free.
        {board.next7.length > 0 && <> {board.next7.length} due in the next 7 days.</>}
        {board.archive && (
          <>
            {' '}
            <Link
              href={`/?year=${board.archive.last.slice(0, 4)}&month=${Number(board.archive.last.slice(5, 7))}`}
              className="text-ink underline underline-offset-2"
            >
              Archive covers {fmt(board.archive.first)} to {fmt(board.archive.last)}
            </Link>
            .
          </>
        )}
      </p>
    )
  }

  const parts = [
    `${board.inPort.length} in port`,
    `${board.arriving.length} arriving`,
    `${board.departing.length} departing`,
    `${board.freeTonight.length} of ${board.berthCount} berths free tonight`,
  ]
  return (
    <p className="tnum px-5 py-2 text-[13px] text-mute sm:px-8">
      {parts.join(' · ')}
      {board.next7.length > 0 && <> · {board.next7.length} due this week</>}
    </p>
  )
}
