import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { CreatorNoteForm } from '@/app/creator-notes/new/CreatorNoteForm';
import { getSession } from '@/server/auth/session';
import { findWrongAnswerContext } from '@/server/creator-notes';
import { db, questions, users } from '@/server/db';

type PageProps = {
  searchParams: Promise<{ q?: string; r?: string }>;
};

function displayName(value: string | null | undefined) {
  return value?.trim() || 'your friend';
}

function invalidView(message: string) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-4 py-8">
      <section className="rounded-md border bg-card p-5">
        <h1 className="font-serif text-2xl font-semibold text-foreground">This note link is not available</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{message}</p>
        <Link className="btn-primary mt-5" href="/">Back home</Link>
      </section>
    </main>
  );
}

export default async function NewCreatorNotePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const questionId = params.q?.trim() ?? '';
  const recipientUserId = params.r?.trim() ?? '';
  const intended = `/creator-notes/new?q=${encodeURIComponent(questionId)}&r=${encodeURIComponent(recipientUserId)}`;

  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(intended)}`);
  if (!questionId || !recipientUserId) return invalidView('The question or recipient was missing from the link.');

  const [row] = await db
    .select({
      question: questions,
      recipient: { displayName: users.displayName },
    })
    .from(questions)
    .innerJoin(users, eq(users.id, recipientUserId))
    .where(eq(questions.id, questionId))
    .limit(1);

  if (!row) return invalidView('We could not find that question.');
  if (row.question.creatorId !== session.userId) return invalidView('Only the question author can write this note.');

  const wrongAnswer = await findWrongAnswerContext(questionId, recipientUserId);
  if (!wrongAnswer) return invalidView('This friend does not have a wrong answer recorded for that question.');

  const recipientName = displayName(row.recipient.displayName);

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-6">
      <header>
        <p className="font-mono text-[0.62rem] uppercase tracking-[0.06em] text-muted-foreground">
          <Link href="/" className="underline underline-offset-2">HOME</Link>
          {' / CREATOR NOTE'}
        </p>
        <h1 className="mt-3 font-serif text-3xl font-semibold leading-tight text-foreground">
          Write a note to {recipientName}
        </h1>
      </header>

      {/* §8.22 wrong-answer text visibility: the answerer's submitted text is
          intentionally NOT shown to the question author here. The author writes
          the note from the question + canonical answer alone. */}
      <section className="mt-5 rounded-md border bg-card p-4 text-sm leading-6">
        <p><span className="font-medium text-foreground">Question:</span> {row.question.questionText}</p>
        <p className="mt-2 text-muted-foreground">
          <span className="font-medium text-foreground">Answer:</span> {row.question.answerText}
        </p>
      </section>

      <CreatorNoteForm questionId={questionId} recipientUserId={recipientUserId} />
    </main>
  );
}
