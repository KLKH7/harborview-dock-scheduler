'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  { href: '/', label: 'schedule' },
  { href: '/conflicts', label: 'findings' },
  { href: '/vessels', label: 'vessels' },
] as const

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function AppNav() {
  const pathname = usePathname() ?? '/'

  return (
    <header className="relative z-40 h-16 shrink-0 bg-panel">
      <div className="flex h-full items-center px-5 sm:px-8">
        <Link
          href="/"
          className="relative z-10 shrink-0 text-[15px] font-medium tracking-[-0.04em] text-ink"
        >
          harborview
        </Link>

        <nav
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          aria-label="Main"
        >
          <ul className="pointer-events-auto flex items-center gap-8 sm:gap-12">
            {NAV.map((n) => {
              const on = isActive(pathname, n.href)
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={on ? 'page' : undefined}
                    className={`text-[13px] font-medium tracking-[-0.03em] sm:text-[14px] ${
                      on ? 'text-ink' : 'text-mute hover:text-ink'
                    }`}
                  >
                    {n.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      </div>
    </header>
  )
}
