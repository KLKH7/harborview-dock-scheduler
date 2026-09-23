'use client'

import { useEffect, useRef, useState } from 'react'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

type Props = {
  year: number
  month: number
  years: number[]
  onShift: (delta: number) => void
  onJump: (year: number, month: number) => void
}

/**
 * Month navigation.
 *
 * The title is the control: clicking it opens month and year pickers in place,
 * the way Circle's calendar does, rather than sitting two dropdowns and a Go
 * button above the schedule. Changing the month applies immediately; there is
 * nothing to submit.
 */
export function MonthHeader({ year, month, years, onShift, onJump }: Props) {
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
    <div className="relative flex items-center gap-1 px-5 py-3" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          // Arrows move the month while the toolbar has focus. Inside the grid
          // they move the day cursor instead, so the two never collide.
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
        className="tnum -mx-1 rounded-[4px] px-1 text-[15px] font-medium text-ink hover:bg-wash"
      >
        {MONTHS[month - 1]} {year}
      </button>

      <button
        type="button"
        onClick={() => onShift(-1)}
        aria-label="Previous month"
        className="ml-1 flex h-6 w-6 items-center justify-center rounded-[4px] text-mute hover:bg-wash hover:text-ink"
      >
        <Chevron dir="left" />
      </button>
      <button
        type="button"
        onClick={() => onShift(1)}
        aria-label="Next month"
        className="flex h-6 w-6 items-center justify-center rounded-[4px] text-mute hover:bg-wash hover:text-ink"
      >
        <Chevron dir="right" />
      </button>

      {open && (
        <div className="absolute left-4 top-11 z-50 w-[286px] rounded-[8px] border border-line bg-panel p-2 shadow-[0_1px_2px_rgba(75,69,59,0.06)]">
          <div className="grid grid-cols-3 gap-1">
            {MONTHS.map((m, i) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  onJump(year, i + 1)
                  setOpen(false)
                }}
                className={`rounded-[4px] px-2 py-1.5 text-[12px] ${
                  i + 1 === month ? 'bg-occupied text-ink' : 'text-mute hover:bg-wash hover:text-ink'
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
                  className={`tnum rounded-[4px] px-2 py-1 text-[12px] ${
                    y === year ? 'bg-occupied text-ink' : 'text-mute hover:bg-wash hover:text-ink'
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
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
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
