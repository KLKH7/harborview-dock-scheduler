import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = {
  title: 'Harborview Dock Scheduling',
  description: 'Berth reservations, conflict detection and vessel fit checking',
}

const NAV = [
  { href: '/', label: 'Schedule' },
  { href: '/conflicts', label: 'Findings' },
  { href: '/new', label: 'New booking' },
  { href: '/data-quality', label: 'Data quality' },
] as const

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-[1400px] px-6 py-3 flex items-baseline gap-6 flex-wrap">
            <Link href="/" className="font-semibold tracking-tight">
              Harborview Marine Research Center
            </Link>
            <nav className="flex gap-4 text-sm">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="text-slate-600 hover:text-slate-900 hover:underline underline-offset-4"
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-6 py-6">{children}</main>
        <footer className="border-t border-slate-200 bg-white">
          <div className="mx-auto max-w-[1400px] px-6 py-3 text-xs text-slate-500">
            Dock scheduling system · imported from 23 years of spreadsheet history
          </div>
        </footer>
      </body>
    </html>
  )
}
