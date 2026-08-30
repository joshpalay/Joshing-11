import { redirect } from 'next/navigation';

/**
 * B-10.1 (2026-08-30): Joshing Games is sunset. The summary screen redirects
 * home alongside the play screen — it was the other half of the shared-link
 * surface (SMS carried `${baseUrl}/games/<id>/summary`), so leaving it live
 * while `/games/<id>` redirected would have been incoherent.
 *
 * Soft sunset only — see the note in ../page.tsx. The prior implementation
 * (growth recap, round recap, overlap map) is recoverable from git.
 */
export default async function JoshingGameSummaryPage() {
  redirect('/');
}
