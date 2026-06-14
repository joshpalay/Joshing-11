import type { Metadata } from 'next'
import { Cormorant_Garamond, Montserrat, Playfair_Display } from 'next/font/google'
import './globals.css'
import { Nav } from "@/components/Nav";
// TESTING ONLY — card-background cycler bar (see PaletteToggle).
// Remove this import + the <PaletteToggle/> + boot script before shipping.
import { PaletteToggle } from "@/components/dev/PaletteToggle";
import { getSessionToken, readSessionClaims } from '@/server/auth/session';

// Intentional product choice (2026-05-16): Montserrat is the body font.
// PRD §typography spec'd Inter, but Montserrat ships. Update PRD to reflect this.
const montserrat = Montserrat({
  subsets: ['latin'],
  variable: '--font-sans-body',
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

// Editorial serif register from the Figma design system (display/Body-Serif,
// display/card/question|update|action). Cormorant Garamond is the project's
// "Garamond" — used for headlines and feed-card question/answer text. Exposed
// via --font-cormorant and surfaced to Tailwind as `font-serif` in globals.css.
const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  // 700 added for the gameplay question/answer text (Figma display/game/question
  // is Cormorant Bold 28). Without it the bold synthesizes from 600.
  weight: ['500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-cormorant',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Joshing',
  description: 'A daily knowledge game',
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Only the cheap JWT read stays in the blocking path; the DB-backed Nav badge
  // values (display name, bell count, friends dot) are fetched client-side by Nav
  // after mount (GET /api/nav) so the page shell streams immediately on every hard
  // navigation instead of waiting on three queries just to render nav badges.
  const sessionToken = await getSessionToken()
  const claims = await readSessionClaims(sessionToken)
  return (
    <html
      lang="en"
      className={`font-sans ${montserrat.variable} ${playfair.variable} ${cormorant.variable}`}
    >
      <body className={montserrat.className}>
        {/* TESTING ONLY — apply the saved card-background choice before paint so
            there's no flash on navigation. Remove with <PaletteToggle/> before
            shipping. The token map mirrors CARD_BGS in PaletteToggle. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var i=+localStorage.getItem('joshing-card-bg')||0;var m=['','var(--brand-cream-page)','var(--brand-cream-card)','var(--brand-cream)','var(--game-card-question)','var(--editorial-parchment)','var(--editorial-sage)','var(--editorial-slate)'];if(i>0&&m[i]){document.documentElement.style.setProperty('--brand-card',m[i]);document.documentElement.style.setProperty('--feed-card-elevated',m[i]);document.documentElement.setAttribute('data-card-bg',String(i));}}catch(e){}`,
          }}
        />
        <PaletteToggle />
        <Nav initialUserId={claims?.userId ?? null} />
        {children}
      </body>
    </html>
  )
}
