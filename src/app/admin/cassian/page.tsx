import { notFound } from 'next/navigation';
import { getSession } from '@/server/auth/session';
import { isAdminUser } from '@/server/auth/admin';
import { CassianReviewClient } from './review-client';
import { AdminTabs } from '../AdminTabs';

export const dynamic = 'force-dynamic';

export default async function CassianAdminPage() {
  const session = await getSession();
  if (!session || !isAdminUser(session.userId)) notFound();
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <AdminTabs active="cassian" />
      <div className="mt-5 rounded-xl border-2 p-5" style={{ borderColor: 'var(--brand-navy)', background: 'var(--surface)' }}>
        <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--brand-navy)' }}>
          Admin only · Question experiment
        </p>
        <h1 className="mt-2 font-serif text-3xl font-semibold">Cassian</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          Answer and rate experimental questions. They do not affect mastery, points, streaks, or the activity stream.
          Your notes help compare quality across broad and narrow topics.
        </p>
      </div>
      <CassianReviewClient />
    </main>
  );
}
