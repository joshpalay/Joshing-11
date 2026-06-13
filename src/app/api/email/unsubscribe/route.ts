import { NextResponse } from 'next/server';

import { updateReminderPreferences } from '@/server/db/queries/account';
import { verifyUnsubscribeToken } from '@/server/email/unsubscribe-token';

export const dynamic = 'force-dynamic';

// RFC 8058 one-click unsubscribe target. Gmail/Yahoo bulk senders POST here with
// body `List-Unsubscribe=One-Click` straight from the inbox UI (no session), so
// we authenticate purely on the signed token in the query string. GET hits the
// same path so a plain link click also works; both just flip emailOptIn to
// opted_out (always allowed — no verification gate on opting *out*).
async function optOut(token: string | null): Promise<boolean> {
  if (!token) return false;
  const userId = verifyUnsubscribeToken(token);
  if (!userId) return false;
  const result = await updateReminderPreferences(userId, { emailOptIn: 'opted_out' });
  return result.ok;
}

export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get('token');
  const ok = await optOut(token);
  // One-click clients ignore the body; a 200 is the signal they want.
  return NextResponse.json({ ok }, { status: ok ? 200 : 400 });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  // Send link-clickers to the friendly confirmation page, preserving the token.
  return NextResponse.redirect(new URL(`/unsubscribe?token=${token ?? ''}`, url.origin));
}
