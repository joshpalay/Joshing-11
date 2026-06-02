import { redirect } from 'next/navigation';

import { MarkActivitiesRead } from '@/app/activities/MarkActivitiesRead';
import { ActivityStream } from '@/components/activity/ActivityStream';
import { CREAM, FS, HILITE, INK, INK2 } from '@/components/lately/tokens';
import { buildActivityStream } from '@/server/activity/build-stream';
import { getSession } from '@/server/auth/session';
import { getUserById } from '@/server/db/queries/users';

// Lately / "What's Happening" FULL view (D-4 CORRECTION 2). One unified stream of
// quiet one-liners — the same items, same source, same rendering as the homepage
// head (see buildActivityStream + ActivityStream). Question-backed items expand
// in place; the homepage shows the curated head of this exact list.
export default async function ActivitiesPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const [items, viewer] = await Promise.all([
    buildActivityStream(session.userId),
    getUserById(session.userId),
  ]);
  const tz = viewer?.timezone ?? 'America/New_York';

  return (
    <main style={{ background: CREAM, color: INK, minHeight: '100dvh' }}>
      <div
        style={{
          maxWidth: 420,
          margin: '0 auto',
          padding: '18px 20px 100px',
          boxSizing: 'border-box',
        }}
      >
        <MarkActivitiesRead />

        <div style={{ marginBottom: 6 }}>
          <h1
            style={{
              fontSize: 52,
              fontFamily: FS,
              fontWeight: 400,
              fontStyle: 'italic',
              lineHeight: 1,
              margin: 0,
              letterSpacing: -1.5,
              position: 'relative',
              display: 'inline-block',
            }}
          >
            Lately.
            <span
              aria-hidden
              style={{
                position: 'absolute',
                left: 0,
                right: '30%',
                bottom: 4,
                height: 8,
                background: HILITE,
                zIndex: -1,
                opacity: 0.85,
              }}
            />
          </h1>
        </div>

        {items.length === 0 ? (
          <div
            style={{
              fontFamily: FS,
              fontStyle: 'italic',
              fontSize: 16,
              color: INK2,
              textAlign: 'center',
              paddingTop: 40,
              lineHeight: 1.5,
            }}
          >
            Nothing yet. It&rsquo;ll appear here once you and your friends start
            answering each other&rsquo;s questions.
          </div>
        ) : (
          <ActivityStream items={items} variant="full" tz={tz} />
        )}
      </div>
    </main>
  );
}
