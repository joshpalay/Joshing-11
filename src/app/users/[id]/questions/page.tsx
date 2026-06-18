import Link from 'next/link'
import { notFound } from 'next/navigation'

import { AuthoredQuestionsFeed } from '@/components/profile/AuthoredQuestionsFeed'
import { getSession } from '@/server/auth/session'
import { getAuthoredQuestionsForUser } from '@/server/db/queries/questions'
import { getFriendPortraitData } from '@/server/profile/friend'

type FriendQuestionsPageProps = {
  params: Promise<{ id: string }>
}

function firstName(displayName: string): string {
  const trimmed = displayName.trim()
  if (!trimmed) return 'They'
  const [first] = trimmed.split(/\s+/)
  return first ?? trimmed
}

export const dynamic = 'force-dynamic'

// Full list of a user's authored questions, linked from the "Questions" module
// on their profile dashboard. Renders the full filterable feed (search +
// category/difficulty/answered filters). Gated by the viewed user's
// authored_questions visibility — the same gate the dashboard module uses.
export default async function FriendQuestionsPage({ params }: FriendQuestionsPageProps) {
  const session = await getSession()
  if (!session) notFound()

  const { id } = await params
  const portrait = await getFriendPortraitData(id, session.userId)
  if (!portrait) notFound()
  if (portrait.visibility === 'stranger') notFound()
  if (!portrait.sectionVisibleTo.authored_questions) notFound()

  const authoredQuestions = await getAuthoredQuestionsForUser({
    userId: portrait.user.id,
    limit: 100,
    viewerUserId: session.userId,
    viewer: portrait.visibility,
    sectionVisible: portrait.sectionVisibleTo.authored_questions,
  })
  const authoredItems = authoredQuestions.map((question) => ({
    id: question.id,
    questionText: question.questionText,
    category: question.canonicalSubcategory ?? question.broadCategory,
    broadCategory: question.broadCategory,
    difficulty: question.difficulty,
    createdAt: question.createdAt,
    viewerAnswered: question.viewerAnswered,
  }))
  const friendFirstName = firstName(portrait.user.displayName)

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-5 pb-28">
      <div className="mb-5">
        <Link
          href={`/users/${portrait.user.id}`}
          className="text-muted-foreground text-sm font-medium underline-offset-4 hover:underline"
        >
          &larr; {friendFirstName}&rsquo;s profile
        </Link>
      </div>

      <AuthoredQuestionsFeed
        questions={authoredItems}
        friendDisplayName={portrait.user.displayName}
        friendUserId={portrait.user.id}
        friendProfileHref={`/users/${portrait.user.id}`}
      />
    </main>
  )
}
