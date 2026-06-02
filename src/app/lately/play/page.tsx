import Link from 'next/link';
import { redirect } from 'next/navigation';

import { CREAM, FS, INK, INK2 } from '@/components/lately/tokens';
import { SeededPlayClient } from '@/components/lately/SeededPlayClient';
import { getSession } from '@/server/auth/session';
import { getSeededPlayQuestions } from '@/server/db/queries/lately';

type PageProps = {
  searchParams: Promise<{ q?: string }>;
};

// Lately milestone click-through: a practice session seeded with EXACTLY the
// friend's literal questions (the comma-separated `q` ids). getSeededPlayQuestions
// re-derives the viewer's milestones to authorize the list, so a tampered URL
// resolves to nothing.
export default async function LatelyPlayPage({ searchParams }: PageProps) {
  const session = await getSession();
  if (!session) redirect('/login');

  const { q } = await searchParams;
  const requestedIds = (q ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  const questions = await getSeededPlayQuestions(session.userId, requestedIds);

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
        {questions.length === 0 ? (
          <div style={{ paddingTop: 40 }}>
            <p
              style={{
                fontFamily: FS,
                fontStyle: 'italic',
                fontSize: 16,
                color: INK2,
                lineHeight: 1.5,
              }}
            >
              These questions aren&rsquo;t available to play right now.
            </p>
            <Link
              href="/activities"
              style={{ color: INK, textDecoration: 'underline', textUnderlineOffset: 4 }}
            >
              Back to Lately
            </Link>
          </div>
        ) : (
          <SeededPlayClient questions={questions} />
        )}
      </div>
    </main>
  );
}
