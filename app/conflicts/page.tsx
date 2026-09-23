import Link from 'next/link'
import { getFindings } from '@/lib/data'
import { dayCount } from '@/lib/validation/engine'

export const dynamic = 'force-dynamic'

function monthLink(iso: string) {
  const [y, m] = iso.split('-')
  return `/?year=${Number(y)}&month=${Number(m)}`
}

export default async function FindingsPage() {
  const { conflicts, fits, stats } = await getFindings()

  const oversized = fits
    .filter((f) => f.fit.status === 'violation')
    .sort((a, b) => (b.fit.overhangFt ?? 0) - (a.fit.overhangFt ?? 0))

  const sortedConflicts = [...conflicts].sort((a, b) => b.sharedDays - a.sharedDays)

  return (
    <div className="mx-auto max-w-[1100px] space-y-8 px-5 py-6">
      <div>
        <h1 className="text-[17px] font-medium tracking-tight">Findings</h1>
        <p className="mt-1 text-sm text-mute">
          Every booking in {stats.yearsCovered} years of history, checked against both rules. This
          replaces reading the grid by eye.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Reservations" value={stats.reservations} />
        <Stat label="Double-booked" value={stats.conflicts} alarm />
        <Stat label="Exceeds berth" value={stats.oversizedCount} alarm />
        <Stat label="Unverifiable" value={stats.unverifiableCount} />
      </div>

      <section className="space-y-3">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[15px] font-medium">Double-bookings</h2>
          <span className="tnum text-sm text-mute">
            {stats.conflicts} in {stats.yearsCovered} years
          </span>
        </div>

        {sortedConflicts.length === 0 ? (
          <Empty>No two bookings share a berth on the same day.</Empty>
        ) : (
          <div className="overflow-hidden rounded-[8px] border border-line bg-panel">
            <table className="w-full text-sm">
              <thead className="bg-paper text-left text-xs uppercase tracking-wide text-mute">
                <tr>
                  <th className="px-4 py-2 font-medium">Severity</th>
                  <th className="px-4 py-2 font-medium">Berth</th>
                  <th className="px-4 py-2 font-medium">Booking A</th>
                  <th className="px-4 py-2 font-medium">Booking B</th>
                  <th className="px-4 py-2 font-medium text-right">Shared</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sortedConflicts.map((c, i) => (
                  <tr key={i} className="hover:bg-paper">
                    <td className="px-4 py-2">
                      <Pill tone={c.severity === 'violation' ? 'bad' : 'warn'}>
                        {c.severity === 'violation' ? 'Double-booked' : 'Turnaround'}
                      </Pill>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{c.a.berthId}</td>
                    <td className="px-4 py-2">
                      <div className="font-medium">{c.a.label}</div>
                      <div className="text-xs text-mute">
                        {c.a.start} to {c.a.end}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="font-medium">{c.b.label}</div>
                      <div className="text-xs text-mute">
                        {c.b.start} to {c.b.end}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right tnum tabular-nums">{c.sharedDays}d</td>
                    <td className="px-4 py-2 text-right">
                      <Link
                        href={monthLink(c.a.start)}
                        className="text-sm text-ink hover:underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[15px] font-medium">Vessels that do not fit their berth</h2>
          <span className="text-sm text-mute">{oversized.length} bookings</span>
        </div>

        {oversized.length === 0 ? (
          <Empty>Every vessel with a known length fits the berth it was assigned.</Empty>
        ) : (
          <div className="overflow-hidden rounded-[8px] border border-line bg-panel">
            <table className="w-full text-sm">
              <thead className="bg-paper text-left text-xs uppercase tracking-wide text-mute">
                <tr>
                  <th className="px-4 py-2 font-medium">Vessel</th>
                  <th className="px-4 py-2 font-medium">Berth</th>
                  <th className="px-4 py-2 font-medium text-right">Vessel</th>
                  <th className="px-4 py-2 font-medium text-right">Berth</th>
                  <th className="px-4 py-2 font-medium text-right">Over by</th>
                  <th className="px-4 py-2 font-medium">Dates</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {oversized.slice(0, 120).map((f) => (
                  <tr key={f.reservation.id} className="hover:bg-paper">
                    <td className="px-4 py-2 font-medium">{f.reservation.label}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{f.reservation.berthId}</td>
                    <td className="px-4 py-2 text-right tnum tabular-nums">{f.fit.vesselLengthFt}′</td>
                    <td className="px-4 py-2 text-right tnum tabular-nums text-mute">
                      {f.fit.berthLengthFt}′
                    </td>
                    <td className="px-4 py-2 text-right tnum tabular-nums font-semibold text-conflict">
                      +{f.fit.overhangFt}′
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-xs text-mute">
                      {f.reservation.start}
                      {f.reservation.start !== f.reservation.end && (
                        <> to {f.reservation.end} ({dayCount(f.reservation.start, f.reservation.end)}d)</>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Link
                        href={monthLink(f.reservation.start)}
                        className="text-sm text-ink hover:underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {oversized.length > 120 && (
              <div className="border-t border-line px-4 py-2 text-xs text-mute">
                Showing the 120 largest overhangs of {oversized.length}.
              </div>
            )}
          </div>
        )}
      </section>

      <section className="rounded-[8px] border border-line bg-wash p-4">
        <h2 className="font-medium text-ink">
          {stats.unverifiableCount.toLocaleString()} bookings could not be checked
        </h2>
        <p className="mt-1 text-sm text-mute">
          That is {stats.unverifiableBookedDays.toLocaleString()} booked days whose vessel has no
          length on record anywhere in the source workbook. They are reported as{' '}
          <strong>unverifiable</strong> rather than approved. the system will not tell you a vessel
          fits when it cannot know.{' '}
          <Link href="/data-quality" className="underline">
            See what data is missing to
          </Link>
        </p>
      </section>
    </div>
  )
}

function Stat({ label, value, alarm }: { label: string; value: number; alarm?: boolean }) {
  return (
    <div className="border-l border-line pl-3">
      <div className={`tnum text-[22px] ${alarm && value > 0 ? 'text-conflict' : 'text-ink'}`}>
        {value.toLocaleString()}
      </div>
      <div className="text-[12px] text-mute">{label}</div>
    </div>
  )
}

function Pill({ tone, children }: { tone: 'bad' | 'warn'; children: React.ReactNode }) {
  const t = tone === 'bad' ? 'bg-wash text-conflict' : 'bg-wash text-mute'
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${t}`}>{children}</span>
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[8px] border border-line bg-panel px-4 py-6 text-sm text-mute">
      {children}
    </div>
  )
}
