import { notFound } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import { isAdminUser } from '@/server/auth/admin';
import {
  getAllQuestionsForAdmin,
  type AdminQuestionSortDir,
  type AdminQuestionSortKey,
} from '@/server/db/queries/admin-questions';

import { AdminQuestionsClient } from './AdminQuestionsClient';

export const dynamic = 'force-dynamic';

const SORT_KEYS: AdminQuestionSortKey[] = ['createdAt', 'askedCount', 'correctRate', 'category'];

function parseSortKey(value: string | undefined): AdminQuestionSortKey {
  return SORT_KEYS.includes(value as AdminQuestionSortKey) ? (value as AdminQuestionSortKey) : 'createdAt';
}

function trimmed(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

type AdminQuestionsSearchParams = {
  page?: string;
  showDeleted?: string;
  sort?: string;
  dir?: string;
  q?: string;
  category?: string;
  trustTier?: string;
  visibility?: string;
  verdict?: string;
  nobodyCorrect?: string;
  duplicate?: string;
  tombstone?: string;
  perishable?: string;
};

// B-ADMIN-QUESTIONS-OVERVIEW-01 — the FOURTH admin room: an audit view of every
// question in the pool (all creators, house + LLM, and soft-deleted rows). Same
// gate contract as the other admin pages: ADMIN_USER_IDS or Next's 404 — the
// route's existence is not revealed to non-admins. This is NOT the player-facing
// Questions tab.
export default async function AdminQuestionsPage({
  searchParams,
}: {
  searchParams: Promise<AdminQuestionsSearchParams>;
}) {
  const session = await getSession();
  if (!session || !isAdminUser(session.userId)) notFound();

  const params = await searchParams;
  const page = Number.parseInt(params.page ?? '1', 10);

  const result = await getAllQuestionsForAdmin({
    page: Number.isFinite(page) ? page : 1,
    showDeleted: params.showDeleted === '1',
    sortKey: parseSortKey(params.sort),
    sortDir: (params.dir === 'asc' ? 'asc' : 'desc') as AdminQuestionSortDir,
    filters: {
      search: trimmed(params.q),
      category: trimmed(params.category),
      trustTier: trimmed(params.trustTier),
      visibility: trimmed(params.visibility),
      verificationVerdict: trimmed(params.verdict),
      nobodyCorrectFlag: params.nobodyCorrect === '1',
      isDuplicate: params.duplicate === '1',
      authorDeleted: params.tombstone === '1',
      perishable: params.perishable === '1',
    },
  });

  return <AdminQuestionsClient result={result} sortKey={parseSortKey(params.sort)} sortDir={params.dir === 'asc' ? 'asc' : 'desc'} />;
}
