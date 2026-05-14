import type { ReactNode } from 'react'

import { FeedCard } from './FeedCard'
import type { AnsweredByYouFeedItem } from './types'

type AnsweredByYouCardProps = {
  item: AnsweredByYouFeedItem
  actions?: ReactNode
  children?: ReactNode
}

function FeedProgressCircles({
  correct,
}: {
  correct: boolean | null | undefined
}) {
  return (
    <div
      className="flex items-center gap-1.5"
      aria-label="Feed answer progress"
    >
      {Array.from({ length: 5 }, (_, index) => {
        const active = index === 0
        const className = active
          ? correct
            ? 'bg-emerald-600 border-emerald-600'
            : 'bg-stone-400 border-stone-400'
          : 'border-stone-300 bg-white/70'
        return (
          <span
            key={index}
            aria-hidden
            className={`size-2.5 rounded-full border ${className}`}
          />
        )
      })}
    </div>
  )
}

function AnsweredDetails({ item }: { item: AnsweredByYouFeedItem }) {
  return (
    <div className="rounded-xl bg-white/65 p-3 text-sm leading-6 text-stone-700">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-medium text-stone-900">
          {item.answerSummary ?? 'You answered this question.'}
        </p>
        <FeedProgressCircles correct={item.isCorrect} />
      </div>
      {item.submittedAnswer ? (
        <p className="mt-2">
          <span className="font-medium text-stone-900">Your answer:</span>{' '}
          {item.submittedAnswer}
        </p>
      ) : null}
      {item.correctAnswer ? (
        <p className="mt-1">
          <span className="font-medium text-stone-900">Correct answer:</span>{' '}
          {item.correctAnswer}
        </p>
      ) : null}
      {item.isCorrect && typeof item.awardedPoints === 'number' ? (
        <p className="mt-2 inline-flex rounded-full bg-emerald-100 px-3 py-1 font-medium text-emerald-900">
          +{item.awardedPoints} points
        </p>
      ) : null}
      {item.isCorrect === false ? (
        <p className="mt-2 rounded-lg bg-stone-100 px-3 py-2 text-stone-700">
          Added to your missed questions — you can try again for review later.
        </p>
      ) : null}
      {item.unverifiedAnswer ? (
        <p className="text-muted-foreground mt-2">
          This answer is still unverified.
        </p>
      ) : null}
      {item.explanation ? (
        <p className="text-muted-foreground mt-2">{item.explanation}</p>
      ) : null}
    </div>
  )
}

export function AnsweredByYouCard({
  item,
  actions,
  children,
}: AnsweredByYouCardProps) {
  return (
    <FeedCard
      item={item}
      tone="gray"
      eyebrow={<span>{item.resultLabel ?? 'You answered'}</span>}
      actions={actions}
    >
      {children ?? <AnsweredDetails item={item} />}
    </FeedCard>
  )
}
