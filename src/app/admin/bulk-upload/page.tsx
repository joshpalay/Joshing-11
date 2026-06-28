import { notFound } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import { isAdminUser } from '@/server/auth/admin';

import { BulkUploadClient } from './BulkUploadClient';

export const dynamic = 'force-dynamic';

// Admin-only CSV bulk question upload. Reachable ONLY to ADMIN_USER_IDS members;
// everyone else (incl. authenticated non-admins) gets Next's 404 — the route's
// existence is not revealed. Unset env ⇒ no admins ⇒ always 404.
export default async function AdminBulkUploadPage() {
  const session = await getSession();
  if (!session || !isAdminUser(session.userId)) notFound();

  return <BulkUploadClient />;
}
