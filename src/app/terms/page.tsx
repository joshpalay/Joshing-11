import type { Metadata } from 'next';
import Link from 'next/link';

import { getSession } from '@/server/auth/session';

export const metadata: Metadata = {
  title: 'Terms & Disclaimer · Joshing',
  description: 'The common-sense terms for using Joshing.',
};

const CONTACT_EMAIL = 'Joshuapalay+joshingsupport@gmail.com';

// Each clause renders with a bolded lead-in followed by its body, matching the
// "Play nice." / "No warranties." rhythm of the source copy.
const CLAUSES: { lead: string; body: string }[] = [
  {
    lead: 'It’s early.',
    body: 'Joshing is in active development. Things may break, change, or disappear without notice. We make no guarantees that it’ll work perfectly or stay available.',
  },
  {
    lead: 'Play nice.',
    body: 'Questions and content come from real people in your circle. Don’t submit anything hateful, harassing, illegal, or that you don’t have the right to share. We can remove content or remove people from the game at our discretion.',
  },
  {
    lead: 'Other people’s stuff.',
    body: 'You’ll see content created by friends and other players. We don’t write or verify most of it, and we’re not responsible for its accuracy. Treat it as part of the game, not as fact.',
  },
  {
    lead: 'No warranties.',
    body: 'Joshing is provided “as is,” without warranties of any kind. We’re not liable for any loss, damage, or hurt feelings arising from using it, to the fullest extent the law allows.',
  },
  {
    lead: 'Your content.',
    body: 'When you create questions or content, you’re letting us use, display, and share it within the game so it works the way it’s meant to.',
  },
  {
    lead: 'Privacy, briefly.',
    body: 'We collect what we need to run the game and don’t sell your data. (A fuller privacy policy is coming.)',
  },
  {
    lead: 'Changes.',
    body: 'We may update these terms as Joshing grows. Continuing to play means you’re cool with the current version.',
  },
];

export default async function TermsPage() {
  // The page is public (it is linked from the logged-out /login card), so the
  // back link can't assume a profile: /users/me is auth-gated and would bounce
  // a logged-out reader to /login. Point signed-out visitors back to sign-in
  // instead, and only offer the profile link to authenticated readers.
  const session = await getSession();
  const backHref = session ? '/users/me' : '/login';
  const backLabel = session ? '← Back to profile' : '← Back to sign in';

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-10 pb-28">
      <div className="mb-6">
        <Link
          href={backHref}
          className="text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
        >
          {backLabel}
        </Link>
      </div>

      <h1 className="font-serif text-3xl font-semibold">Terms &amp; Disclaimer</h1>

      <p className="mt-4 text-sm leading-6 text-muted-foreground">
        Joshing is a game we’re building and improving as we go. By using it, you agree to a few
        common-sense things:
      </p>

      <div className="mt-6 space-y-4">
        {CLAUSES.map((clause) => (
          <p key={clause.lead} className="text-sm leading-6 text-foreground">
            <span className="font-semibold">{clause.lead}</span> {clause.body}
          </p>
        ))}
      </div>

      <p className="mt-8 text-sm leading-6 text-muted-foreground">
        Questions? Reach out to us at{' '}
        <a
          href={`mailto:${CONTACT_EMAIL}`}
          className="font-medium text-[var(--brand-orange)] underline underline-offset-4"
        >
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    </main>
  );
}
