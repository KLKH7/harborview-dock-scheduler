'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { CalendarDays, ListChecks, Ship } from 'lucide-react'

const ITEMS = [
  { href: '/', label: 'Schedule', key: '1', Icon: CalendarDays },
  { href: '/review', label: 'Review', key: '2', Icon: ListChecks },
  { href: '/vessels', label: 'Vessels', key: '3', Icon: Ship },
] as const

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)
}

const STORAGE = 'harborview.rail'

/**
 * Navigation as a rail, not a bar.
 *
 * Three surfaces do not earn a 64px top bar. They earn 48px on the left,
 * collapsed by default, with `[` to expand and `1` `2` `3` to jump. On a
 * phone the rail becomes a bottom bar, which is where thumbs are.
 *
 * Keyboard actions are never animated: they are repeated hundreds of times
 * a day, and a transition on a keystroke reads as lag.
 */
export function Rail() {
  const pathname = usePathname() ?? '/'
  const router = useRouter()
  // Read the remembered state once, lazily, rather than setting it inside an
  // effect after a first paint in the wrong state. Server render has no
  // storage and gets the collapsed default, which is also the initial client
  // value, so there is no hydration mismatch.
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try { return localStorage.getItem(STORAGE) === 'open' } catch { return false }
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '[') {
        e.preventDefault()
        setOpen((o) => {
          try { localStorage.setItem(STORAGE, o ? 'closed' : 'open') } catch { /* ignore */ }
          return !o
        })
        return
      }
      const item = ITEMS.find((i) => i.key === e.key)
      if (item) {
        e.preventDefault()
        router.push(item.href)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [router])

  return (
    <nav
      aria-label="Main"
      className={`z-40 shrink-0 border-line bg-panel
        fixed inset-x-0 bottom-0 h-12 border-t
        sm:static sm:h-auto sm:border-t-0 sm:border-r ${open ? 'sm:w-[200px]' : 'sm:w-12'}`}
    >
      <ul className="flex h-full items-center justify-around sm:h-auto sm:flex-col sm:items-stretch sm:justify-start sm:gap-0.5 sm:p-1.5 sm:pt-3">
        {ITEMS.map(({ href, label, key, Icon }) => {
          const on = isActive(pathname, href)
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={on ? 'page' : undefined}
                title={open ? undefined : `${label}  ${key}`}
                className={`flex items-center gap-2.5 rounded px-2 py-2 text-[13px] ${
                  on ? 'bg-wash text-ink' : 'text-mute hover:bg-wash hover:text-ink'
                } ${open ? '' : 'sm:justify-center'}`}
              >
                <Icon size={18} strokeWidth={1.75} aria-hidden />
                <span className={open ? '' : 'sr-only sm:sr-only'}>{label}</span>
                {open && <kbd className="ml-auto text-[11px] text-mute">{key}</kbd>}
              </Link>
            </li>
          )
        })}
      </ul>
      <button
        type="button"
        onClick={() => {
          setOpen((o) => {
            try { localStorage.setItem(STORAGE, o ? 'closed' : 'open') } catch { /* ignore */ }
            return !o
          })
        }}
        title={open ? 'Collapse  [' : 'Expand  ['}
        aria-expanded={open}
        className="hidden rounded px-2 py-1.5 text-[11px] text-mute hover:bg-wash hover:text-ink sm:absolute sm:bottom-2 sm:left-1.5 sm:right-1.5 sm:block"
      >
        {open ? '‹' : '›'}
      </button>
    </nav>
  )
}
