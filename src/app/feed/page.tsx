import { redirect } from 'next/navigation';

/**
 * B-11.1 (2026-08-30): the standalone top-level feed route is retired.
 *
 * It 404'd because it never had a page — `src/app/feed/` only ever held the
 * `debug/friend-coverage` tool, so `/feed` matched no route at all. The nav was
 * revised away from Feed as a primary destination (PRD-v11.2 §8.12) and home's
 * embedded `FeedList` section (`<section id="feed">` in src/app/page.tsx) is
 * where the feed actually lives.
 *
 * Nothing to apologise for here, unlike the Games sunset (B-10) — this is a
 * stale URL pointed at the real thing, so an old bookmark or a deep link lands
 * on the working feed instead of a 404.
 *
 * `/feed/debug/friend-coverage` is a separate, still-live debug tool and is
 * unaffected: a page at this segment does not shadow deeper routes.
 */
export default function FeedPage() {
  redirect('/');
}
