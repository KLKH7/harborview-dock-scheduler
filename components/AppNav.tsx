'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  { href: '/', label: 'schedule' },
  { href: '/review', label: 'review' },
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
      <div className="grid h-full grid-cols-[1fr_auto_1fr] items-center px-5 sm:px-8">
        <Link
          href="/"
          className="justify-self-start text-[16px] font-medium tracking-tight text-ink"
        >
          harborview
        </Link>

        <nav aria-label="Main">
          <ul className="flex items-center gap-8 sm:gap-12">
            {NAV.map((n) => {
              const on = isActive(pathname, n.href)
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={on ? 'page' : undefined}
                    className={`text-[14px] font-medium sm:text-[15px] ${
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
