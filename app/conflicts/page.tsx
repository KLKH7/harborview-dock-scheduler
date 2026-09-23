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
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Findings</h1>
        <p className="mt-1 text-sm text-slate-600">
          Every booking in {stats.yearsCovered} years of history, checked against both rules. This
          replaces reading the grid by eye.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Reservations" value={stats.reservations} tone="neutral" />
        <Stat label="Double-booked" value={stats.conflicts} tone={stats.conflicts ? 'bad' : 'good'} />
        <Stat label="Exceeds berth" value={stats.oversizedCount} tone={stats.oversizedCount ? 'warn' : 'good'} />
        <Stat label="Unverifiable" value={stats.unverifiableCount} tone="info" />
      </div>

      <section className="space-y-3">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-semibold">Double-bookings</h2>
          <span className="text-sm text-slate-500">
            {stats.conflictViolations} violation{stats.conflictViolations === 1 ? '' : 's'},{' '}
            {stats.conflictWarnings} same-day turnaround
            {stats.conflictWarnings === 1 ? '' : 's'}
          </span>
        </div>

        {sortedConflicts.length === 0 ? (
          <Empty>No two bookings share a berth on the same day.</Empty>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Severity</th>
                  <th className="px-4 py-2 font-medium">Berth</th>
                  <th className="px-4 py-2 font-medium">Booking A</th>
                  <th className="px-4 py-2 font-medium">Booking B</th>
                  <th className="px-4 py-2 font-medium text-right">Shared</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedConflicts.map((c, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <Pill tone={c.severity === 'violation' ? 'bad' : 'warn'}>
                        {c.severity === 'violation' ? 'Double-booked' : 'Turnaround'}
                      </Pill>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{c.a.berthId}</td>
                    <td className="px-4 py-2">
                      <div className="font-medium">{c.a.label}</div>
                      <div className="text-xs text-slate-500">
                        {c.a.start} → {c.a.end}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="font-medium">{c.b.label}</div>
                      <div className="text-xs text-slate-500">
                        {c.b.start} → {c.b.end}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{c.sharedDays}d</td>
                    <td className="px-4 py-2 text-right">
                      <Link
                        href={monthLink(c.a.start)}
                        className="text-sm text-sky-700 hover:underline"
                      >
                        View →
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
          <h2 className="text-lg font-semibold">Vessels that do not fit their berth</h2>
          <span className="text-sm text-slate-500">{oversized.length} bookings</span>
        </div>

        {oversized.length === 0 ? (
          <Empty>Every vessel with a known length fits the berth it was assigned.</Empty>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
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
              <tbody className="divide-y divide-slate-100">
                {oversized.slice(0, 120).map((f) => (
                  <tr key={f.reservation.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium">{f.reservation.label}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{f.reservation.berthId}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{f.fit.vesselLengthFt}′</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500">
                      {f.fit.berthLengthFt}′
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-amber-700">
                      +{f.fit.overhangFt}′
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-xs text-slate-500">
                      {f.reservation.start}
                      {f.reservation.start !== f.reservation.end && (
                        <> → {f.reservation.end} ({dayCount(f.reservation.start, f.reservation.end)}d)</>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Link
                        href={monthLink(f.reservation.start)}
                        className="text-sm text-sky-700 hover:underline"
                      >
                        View →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {oversized.length > 120 && (
              <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
                Showing the 120 largest overhangs of {oversized.length}.
              </div>
            )}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-sky-200 bg-sky-50 p-4">
        <h2 className="font-semibold text-sky-900">
          {stats.unverifiableCount.toLocaleString()} bookings could not be checked
        </h2>
        <p className="mt-1 text-sm text-sky-900/80">
          That is {stats.unverifiableBookedDays.toLocaleString()} booked days whose vessel has no
          length on record anywhere in the source workbook. They are reported as{' '}
          <strong>unverifiable</strong> rather than approved — the system will not tell you a vessel
          fits when it cannot know.{' '}
          <Link href="/data-quality" className="underline">
            See what data is missing →
          </Link>
        </p>
      </section>
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'neutral' | 'good' | 'bad' | 'warn' | 'info'
}) {
  const tones = {
    neutral: 'bg-white text-slate-900 ring-slate-200',
    good: 'bg-emerald-50 text-emerald-900 ring-emerald-200',
    bad: 'bg-red-50 text-red-900 ring-red-200',
    warn: 'bg-amber-50 text-amber-900 ring-amber-200',
    info: 'bg-sky-50 text-sky-900 ring-sky-200',
  } as const
  return (
    <div className={`rounded-lg px-4 py-3 ring-1 ${tones[tone]}`}>
      <div className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div>
      <div className="text-xs">{label}</div>
    </div>
  )
}

function Pill({ tone, children }: { tone: 'bad' | 'warn'; children: React.ReactNode }) {
  const t = tone === 'bad' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${t}`}>{children}</span>
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
      {children}
    </div>
  )
}
