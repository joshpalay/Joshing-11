import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { updateReminderPreferences } from '@/server/db/queries/account';
import { sendVerificationEmail } from '@/server/email/send-verification';

export const dynamic = 'force-dynamic';

// The onboarding "Daily reminders" beat: the user typed an email to opt into
// daily reminders. We stash it as pendingEmail and fire a confirm link minted
// with optInOnConfirm — so confirming the link both verifies the address and
// flips emailOptIn on, with no second trip to the profile toggle. Verification
// is async and off-page, so this never blocks finishing onboarding; the caller
// proceeds to /daily regardless of whether/when the link is clicked.
const bodySchema = z.object({
  email: z.string().trim().email(),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', message: 'Enter a valid email address.' },
      { status: 400 },
    );
  }

  // Also mark the reminder prompt dismissed: the user engaged with the ask
  // here, so the profile reminder banner shouldn't nag them about it later.
  const result = await updateReminderPreferences(session.userId, {
    pendingEmail: parsed.data.email,
    dismissed: true,
  });
  if (!result.ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sendResult = await sendVerificationEmail(session.userId, {
    optInOnConfirm: true,
  });
  if (!sendResult.ok) {
    // The address is saved; surface a soft failure so the client can show a
    // "we couldn't send the email" note without trapping the user in onboarding.
    console.warn('[onboarding/email-reminder] verification send failed:', sendResult.reason);
    return NextResponse.json({ ok: true, sent: false });
  }

  return NextResponse.json({ ok: true, sent: true });
}
