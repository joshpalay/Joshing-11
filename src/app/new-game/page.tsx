import { redirect } from 'next/navigation';

/**
 * B-10.1 (2026-08-30): Joshing Games is sunset. Game creation had been disabled
 * since v11.1 and this route rendered a "coming soon" card, which promised
 * future work that isn't coming. It now redirects home rather than 404ing, so
 * anyone following an old link or bookmark lands somewhere real.
 *
 * Soft sunset only: the API routes, queries and tables are untouched (see
 * B-10.1's historical-data caveat). Prior page bodies are recoverable from git.
 */
export default function NewGamePage() {
  redirect('/');
}
