'use client'

import { useEffect, useRef, useState } from 'react'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export type ScheduleView = 'week' | 'month'

type Props = {
  year: number
  month: number
  years: number[]
  view: ScheduleView
  onView: (view: ScheduleView) => void
  onShift: (delta: number) => void
  onJump: (year: number, month: number) => void
  onToday: () => void
  onReserve: () => void
}

export function MonthHeader({
  year,
  month,
  years,
  view,
  onView,
  onShift,
  onJump,
  onToday,
  onReserve,
}: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative flex h-10 shrink-0 items-center gap-1 px-5 sm:px-8" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') {
            e.preventDefault()
            onShift(-1)
          }
          if (e.key === 'ArrowRight') {
            e.preventDefault()
            onShift(1)
          }
        }}
        aria-expanded={open}
        className="tnum -mx-1 rounded px-1 text-[15px] font-medium tracking-[-0.02em] text-ink hover:bg-wash"
      >
        {MONTHS[month - 1]} {year}
      </button>

      <button
        type="button"
        onClick={() => onShift(-1)}
        aria-label={view === 'week' ? 'Previous week' : 'Previous month'}
        className="ml-1 flex h-8 w-8 items-center justify-center rounded text-mute hover:bg-wash hover:text-ink"
      >
        <Chevron dir="left" />
      </button>
      <button
        type="button"
        onClick={() => onShift(1)}
        aria-label={view === 'week' ? 'Next week' : 'Next month'}
        className="flex h-8 w-8 items-center justify-center rounded text-mute hover:bg-wash hover:text-ink"
      >
        <Chevron dir="right" />
      </button>

      <div className="ml-3 flex rounded bg-wash p-0.5 text-[12px] font-medium tracking-[-0.02em]">
        {(['month', 'week'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onView(v)}
            aria-pressed={view === v}
            className={`rounded px-2.5 py-1 ${
              view === v ? 'bg-panel text-ink shadow-[0_1px_1px_rgba(35,31,32,0.06)]' : 'text-mute hover:text-ink'
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-3">
      <button
        type="button"
        onClick={onToday}
        className="rounded px-2 py-1 text-[12px] text-ink hover:bg-wash"
      >
        Today
      </button>
      <button
        type="button"
        onClick={onReserve}
        className="rounded bg-sea px-3 py-1.5 text-[13px] font-medium text-white"
      >
        Reserve
      </button>
      <div className="hidden items-center gap-4 text-[11px] tracking-[-0.02em] text-mute lg:flex">
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-sm bg-sea-fill ring-1 ring-sea/30" />
          vessel
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-sm bg-event-fill ring-1 ring-event/30" />
          event
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-sm bg-conflict/20 ring-1 ring-conflict/50" />
          conflict
        </span>
      </div>
      </div>

      {open && (
        <div className="absolute left-5 top-12 z-50 w-[286px] rounded-[8px] border border-line bg-panel p-2 shadow-[var(--shadow-panel)] sm:left-8">
          <div className="grid grid-cols-3 gap-1">
            {MONTHS.map((m, i) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  onJump(year, i + 1)
                  setOpen(false)
                }}
                className={`rounded px-2 py-1.5 text-[12px] ${
                  i + 1 === month ? 'bg-sea-fill text-sea' : 'text-mute hover:bg-wash hover:text-ink'
                }`}
              >
                {m.slice(0, 3)}
              </button>
            ))}
          </div>
          <div className="mt-2 max-h-[150px] overflow-auto border-t border-line pt-2">
            <div className="grid grid-cols-4 gap-1">
              {years.map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => {
                    onJump(y, month)
                    setOpen(false)
                  }}
                  className={`tnum rounded px-2 py-1 text-[12px] ${
                    y === year ? 'bg-sea-fill text-sea' : 'text-mute hover:bg-wash hover:text-ink'
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d={dir === 'left' ? 'M10 3.5 5.5 8l4.5 4.5' : 'M6 3.5 10.5 8 6 12.5'}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
