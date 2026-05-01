import Link from 'next/link';

type SessionCloseMessageProps = {
  closeCopy: string;
  reviewLink?: string;
  knowledgeLink?: string;
};

export function SessionCloseMessage({ closeCopy, reviewLink, knowledgeLink }: SessionCloseMessageProps) {
  return (
    <>
      <p className="text-[1.22rem] text-[var(--text)] leading-relaxed">{closeCopy}</p>
      {reviewLink ? (
        <div className="pt-2">
          <Link href={reviewLink} className="btn-primary inline-flex">
            Review today&apos;s answers
          </Link>
        </div>
      ) : null}
      {knowledgeLink ? (
        <p className="text-sm text-[var(--text-muted)]">
          <Link href={knowledgeLink} className="underline underline-offset-4">
            See your Knowledge page -&gt;
          </Link>
        </p>
      ) : null}
    </>
  );
}
