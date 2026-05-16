import type { Metadata } from 'next'
import { Caveat, Montserrat, Playfair_Display } from 'next/font/google'
import './globals.css'
import { Nav } from "@/components/Nav";


// Intentional product choice (2026-05-16): Montserrat is the body font.
// PRD §typography spec'd Inter, but Montserrat ships. Update PRD to reflect this.
const montserrat = Montserrat({
  subsets: ['latin'],
  variable: '--font-sans-body',
})

// F5.1: handwriting register (Personal Record, annotations, signature-style microcopy).
const caveat = Caveat({
  subsets: ['latin'],
  variable: '--font-handwriting',
  display: 'swap',
})

// F5.2: editorial italic register for category names (Categories on Portrait,
// PortraitCircles labels). Loaded with italic style; component CSS picks it
// up via the --font-display variable.
const playfair = Playfair_Display({
  subsets: ['latin'],
  style: ['italic'],
  variable: '--font-display',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Joshing',
  description: 'A daily knowledge game',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`font-sans ${caveat.variable} ${playfair.variable}`}
    >
      <body className={montserrat.className}>
        <Nav />
        {children}
      </body>
    </html>
  )
}
