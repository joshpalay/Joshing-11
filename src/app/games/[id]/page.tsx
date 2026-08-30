import { redirect } from 'next/navigation';

/**
 * B-10.1 (2026-08-30): Joshing Games is sunset. The play screen redirects home
 * for any id — old shared links (SMS carried `${baseUrl}/games/<id>`) land
 * somewhere real instead of 404ing, and no "coming soon" state implies the
 * surface is coming back.
 *
 * Soft sunset only: `src/server/db/queries/joshing-game.ts`, the
 * `/api/joshing-games/*` routes and the underlying tables are all untouched, so
 * a revival means restoring this page body and its play client from git.
 */
export default async function JoshingGamePage() {
  redirect('/');
}
