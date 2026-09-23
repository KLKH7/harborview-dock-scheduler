import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = {
  title: 'Harborview dock schedule',
  description: 'Berth occupancy, 1997 to 2019',
}

const NAV = [
  { href: '/', label: 'Schedule' },
  { href: '/conflicts', label: 'Findings' },
  { href: '/data-quality', label: 'Data quality' },
] as const

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className="h-full">
      <body className="flex min-h-full flex-col">
        <header className="border-b border-line">
          <div className="flex items-baseline gap-6 px-5 py-2.5">
            <Link href="/" className="font-medium tracking-tight text-ink">
              Harborview dock schedule
            </Link>
            <nav className="flex gap-4 text-[13px] text-mute">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="hover:text-ink">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  )
}
