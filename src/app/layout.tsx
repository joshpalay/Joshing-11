import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import './globals.css';
import { Nav } from '@/components/Nav';
// HIDDEN — the dev design-choice bar (card color / flat / shadow). The
// component and its globals.css rules are kept; to bring the bar back, restore
// this import, the boot <script>, and the <PaletteToggle/> render below.
// import { PaletteToggle } from "@/components/dev/PaletteToggle";
import { getSessionToken, readSessionClaims } from '@/server/auth/session';

// Inter is the sole product typeface. One variable is deliberately routed to
// every historical font alias in globals.css so legacy surfaces cannot drift.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Joshing',
  description: 'A daily knowledge game',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Only the cheap JWT read stays in the blocking path; the DB-backed Nav badge
  // values (display name, bell count, friends dot) are fetched client-side by Nav
  // after mount (GET /api/nav) so the page shell streams immediately on every hard
  // navigation instead of waiting on three queries just to render nav badges.
  const sessionToken = await getSessionToken();
  const claims = await readSessionClaims(sessionToken);
  return (
    <html lang="en" className={`font-sans ${inter.variable}`}>
      <body className={inter.className}>
        {/* HIDDEN — dev design-choice bar. Uncomment the boot <script> and the
            <PaletteToggle/> below (plus its import above) to bring it back.
            The script applies the saved card-background choice before paint so
            there's no flash on navigation; its token map mirrors CARD_BGS in
            PaletteToggle. */}
        {/*
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var i=+localStorage.getItem('joshing-card-bg')||0;var m=['','var(--brand-cream-page)','var(--brand-cream-card)','var(--brand-cream)','var(--game-card-question)','var(--editorial-parchment)','var(--editorial-sage)','var(--editorial-slate)'];if(i>0&&m[i]){document.documentElement.style.setProperty('--brand-card',m[i]);document.documentElement.style.setProperty('--feed-card-elevated',m[i]);document.documentElement.setAttribute('data-card-bg',String(i));}if(localStorage.getItem('joshing-flat')==='1'){document.documentElement.setAttribute('data-flat','1');}var s=localStorage.getItem('joshing-shadow');if(s==='subtle'||s==='none'){document.documentElement.setAttribute('data-shadow',s);}}catch(e){}`,
          }}
        />
        <PaletteToggle />
        */}
        <Nav initialUserId={claims?.userId ?? null} />
        {children}
        {/* Field RUM (B-PERF-04): Core Web Vitals (LCP/INP/CLS/FCP/TTFB) and
            page views, route-attributed across all §12.6 surfaces. Beacon-only
            — no render or handler behaviour change. */}
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
