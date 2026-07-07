import { notFound } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import { isAdminUser } from '@/server/auth/admin';
import { getAllQuestionsForAdmin } from '@/server/db/queries/admin-questions';

import { AdminQuestionsClient } from './AdminQuestionsClient';

export const dynamic = 'force-dynamic';

// B-ADMIN-QUESTIONS-OVERVIEW-01 — the FOURTH admin room: an audit view of every
// question in the pool (all creators, house + LLM, and soft-deleted rows). Same
// gate contract as the other admin pages: ADMIN_USER_IDS or Next's 404 — the
// route's existence is not revealed to non-admins. This is NOT the player-facing
// Questions tab.
export default async function AdminQuestionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; showDeleted?: string }>;
}) {
  const session = await getSession();
  if (!session || !isAdminUser(session.userId)) notFound();

  const params = await searchParams;
  const page = Number.parseInt(params.page ?? '1', 10);
  const showDeleted = params.showDeleted === '1';

  const result = await getAllQuestionsForAdmin({
    page: Number.isFinite(page) ? page : 1,
    showDeleted,
  });

  return <AdminQuestionsClient result={result} />;
}
