'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Bell, PencilLine, Trophy } from 'lucide-react';

// B-CRAFTER-LIFECYCLE-01 Phase 3 — the exhaustion experience, per the
// player-youre-out prototype: completion framing (a trophy, not an apology),
// honesty about why, then three doors. Contribution-weighted: "add one
// yourself" leads for a player deep enough to bottom out a domain. No streaks,
// no guilt — the wait door is a genuine "we'll tell you when there's something
// real."

type BroaderDomain = {
  domain: string;
  broadCategory: string | null;
  rung: 'sibling' | 'cousin' | 'parent' | 'grandparent';
  poolDepth: number;
};

// "47 questions since March — 82% right." The receipts line that makes the
// trophy real; hidden below a floor where the numbers would undercut it.
function receiptsLine(receipts: {
  answered: number;
  correct: number;
  firstPlayed: string | null;
}): string | null {
  if (receipts.answered < 5) return null;
  const pct = Math.round((receipts.correct / receipts.answered) * 100);
  const since = receipts.firstPlayed
    ? new Intl.DateTimeFormat(undefined, { month: 'long' }).format(new Date(receipts.firstPlayed))
    : null;
  return `${receipts.answered} questions${since ? ` since ${since}` : ''} — ${pct}% right.`;
}

export function InvitedClient({
  invitation,
  receipts,
  broaderDomains,
}: {
  invitation: { id: string; domain: string; seenAt: string | null };
  receipts: { answered: number; correct: number; firstPlayed: string | null };
  broaderDomains: BroaderDomain[];
}) {
  const router = useRouter();
  const [expandOpen, setExpandOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [addedDomain, setAddedDomain] = useState<string | null>(null);
  const seenPosted = useRef(false);

  // Once-then-quiet: stamping seenAt on first render means the post-daily gate
  // never redirects here again for this invitation.
  useEffect(() => {
    if (seenPosted.current || invitation.seenAt) return;
    seenPosted.current = true;
    void fetch('/api/invitations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action: 'seen', invitationId: invitation.id }),
    }).catch(() => {});
  }, [invitation.id, invitation.seenAt]);

  function recordDoor(choice: 'author' | 'expand' | 'wait') {
    void fetch('/api/invitations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action: 'door', invitationId: invitation.id, choice }),
    }).catch(() => {});
  }

  async function pickBroader(candidate: BroaderDomain) {
    setNote(null);
    try {
      const res = await fetch('/api/declared-interests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          label: candidate.domain,
          broadCategory: candidate.broadCategory ?? undefined,
        }),
      });
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      if (!res.ok) {
        setNote(body?.message ?? "Couldn't add that area — try another.");
        return;
      }
      setAddedDomain(candidate.domain);
      setNote(null);
    } catch {
      setNote("Couldn't add that area — try another.");
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 py-8">
      {/* the emotional reframe: completion, not failure. The trophy is the
          surface's ONE gold use (scarcity-bound accent, STYLE-GUIDE-COLOR §4);
          its circle sits on a neutral surface, not a status token. */}
      <div className="text-center">
        <div className="bg-muted mx-auto mb-4 grid size-14 place-items-center rounded-full">
          <Trophy className="size-7" style={{ color: 'var(--accent-gold)' }} aria-hidden />
        </div>
        <h1 className="font-serif text-2xl font-semibold leading-snug text-[var(--brand-ink)]">
          You&apos;ve played through
          <br />
          {invitation.domain}
        </h1>
        {receiptsLine(receipts) ? (
          <p className="mt-2 text-sm font-medium text-[var(--brand-ink-700)]">
            {receiptsLine(receipts)}
          </p>
        ) : null}
        <p className="text-muted-foreground mx-auto mt-2 max-w-xs text-sm leading-relaxed">
          You reached the bottom of the good questions here — that&apos;s finishing a real, finite
          thing, not running out of luck. Not many get this deep.
        </p>
      </div>

      <p className="text-muted-foreground my-5 text-center text-xs leading-relaxed">
        We&apos;d rather say &ldquo;you&apos;re done&rdquo; than invent a question and risk getting
        it wrong. So — three ways forward:
      </p>

      <div className="flex flex-col gap-3">
        {/* door 1: add your own — contribution-weighted primary */}
        <button
          type="button"
          onClick={() => {
            recordDoor('author');
            router.push(`/craft/${encodeURIComponent(invitation.domain)}`);
          }}
          className="flex min-h-11 items-start gap-3 rounded-[var(--radius-card)] border p-4 text-left transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          style={{ borderColor: 'var(--brand-navy)', background: 'var(--brand-card)' }}
        >
          <PencilLine className="mt-0.5 size-5 flex-none" style={{ color: 'var(--brand-navy)' }} aria-hidden />
          <span>
            <span className="block text-sm font-semibold" style={{ color: 'var(--brand-navy)' }}>
              Add one yourself
            </span>
            <span className="text-muted-foreground mt-0.5 block text-quiet leading-relaxed">
              You clearly know this world. Write a question only a real fan would get — it gets
              fact-checked, then others who love this play it, usually within a day. (You
              won&apos;t see your own.)
            </span>
          </span>
        </button>

        {/* door 2: go broader — a container div with a real toggle button and
            real pill buttons below (never nested interactives). */}
        <div
          className="rounded-[var(--radius-card)] border p-4"
          style={{ borderColor: 'var(--border)', background: 'var(--brand-card)' }}
        >
          <button
            type="button"
            onClick={() => {
              if (!expandOpen) recordDoor('expand');
              setExpandOpen((v) => !v);
            }}
            aria-expanded={expandOpen}
            className="flex min-h-11 w-full items-start gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <ArrowUpRight className="text-muted-foreground mt-0.5 size-5 flex-none" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-[var(--brand-ink)]">
                Go broader
              </span>
              <span className="text-muted-foreground mt-0.5 block text-quiet leading-relaxed">
                Climb out to the wider world this sits in — pick an area and it joins your daily
                rotation.
              </span>
            </span>
          </button>
          {expandOpen ? (
            <div className="mt-3 flex flex-col gap-1.5 pl-8">
              {broaderDomains.length === 0 ? (
                <span className="text-muted-foreground text-xs">
                  We haven&apos;t mapped this one&apos;s neighbors yet — add any area from your
                  knowledge page instead.
                </span>
              ) : (
                broaderDomains.map((candidate) => (
                  <button
                    key={candidate.domain}
                    type="button"
                    onClick={() => void pickBroader(candidate)}
                    className="min-h-9 w-fit rounded-full border px-3 py-1.5 text-xs transition hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    style={
                      addedDomain === candidate.domain
                        ? { borderColor: 'var(--success)', color: 'var(--success)' }
                        : { borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }
                    }
                  >
                    {addedDomain === candidate.domain ? '✓ added — in your rotation ' : ''}
                    {candidate.domain}
                    {candidate.poolDepth > 0 ? ` · ${candidate.poolDepth} questions waiting` : ''}
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>

        {/* door 3: wait */}
        <button
          type="button"
          onClick={() => {
            recordDoor('wait');
            setNote(
              "Done — no pressure. When new questions land here, they'll simply show up in your daily. (No streaks, no daily guilt — that's not this game.)",
            );
          }}
          className="flex min-h-11 items-start gap-3 rounded-[var(--radius-card)] border p-4 text-left transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          style={{ borderColor: 'var(--border)', background: 'var(--brand-card)' }}
        >
          <Bell className="text-muted-foreground mt-0.5 size-5 flex-none" aria-hidden />
          <span>
            <span className="block text-sm font-semibold text-[var(--brand-ink)]">
              Wait for more
            </span>
            <span className="text-muted-foreground mt-0.5 block text-quiet leading-relaxed">
              {/* Honest about the mechanism: new questions surface in the daily
                  — no notification machinery is promised that doesn't exist. */}
              New {invitation.domain} questions will show up in your daily when someone adds them.
            </span>
          </span>
        </button>
      </div>

      {note ? (
        <p
          className="text-muted-foreground mt-4 rounded-md px-3 py-2.5 text-quiet leading-relaxed"
          style={{ background: 'var(--surface-2)' }}
        >
          {note}
        </p>
      ) : null}

      {/* Fresh takeover (arrived from finishing the daily) → back to the recap;
          revisit (already seen) → just home. */}
      {invitation.seenAt === null ? (
        <button
          type="button"
          onClick={() => router.push('/daily/summary')}
          className="text-muted-foreground mx-auto mt-6 inline-flex min-h-9 items-center rounded-md text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Continue to today&apos;s recap →
        </button>
      ) : (
        <button
          type="button"
          onClick={() => router.push('/')}
          className="text-muted-foreground mx-auto mt-6 inline-flex min-h-9 items-center rounded-md text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Back home
        </button>
      )}
    </main>
  );
}
