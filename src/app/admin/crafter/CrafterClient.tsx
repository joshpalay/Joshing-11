'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import type { CrafterWorklistRow } from '@/server/db/queries/crafter-demand';
import type { GateCalibration } from '@/server/db/queries/crafter-decisions';
import { CreationSurface } from '@/components/craft/CreationSurface';
import { AdminTabs } from '@/app/admin/AdminTabs';

// B-CRAFTER-LIFECYCLE-01 Phase 2 — Panel B + the creation surface, one client.
// Internal ops idiom (matches AdminReportsClient): token vars inline, minimal
// chrome. Two views: the domain worklist ("where your craft is wanted" — an
// invitation, never a to-do list) and, once a domain is chosen, the creation
// surface (machine drafts, human keeps/kills/edits; nothing unkept is ever
// served). The open domain lives in ?domain= so a refresh doesn't lose it.
export function CrafterClient({
  worklist,
  needingReviewCount,
  initialDomain,
  calibration,
}: {
  worklist: CrafterWorklistRow[];
  needingReviewCount: number;
  initialDomain?: string | null;
  calibration?: GateCalibration | null;
}) {
  const router = useRouter();
  const [crafting, setCrafting] = useState<CrafterWorklistRow | null>(
    () => worklist.find((row) => row.domain === initialDomain) ?? null,
  );

  function openDomain(row: CrafterWorklistRow | null) {
    setCrafting(row);
    router.replace(row ? `/admin/crafter?domain=${encodeURIComponent(row.domain)}` : '/admin/crafter', {
      scroll: false,
    });
  }

  return (
    <main className="mx-auto min-h-dvh max-w-4xl px-4 pt-6 pb-24">
      <header className="mb-5">
        <div className="mb-3">
          <AdminTabs active="crafter" needingReviewCount={needingReviewCount} />
        </div>
        {/* Plain function in the title; the voice lives in the subtitle. */}
        <h1 className="font-serif text-2xl font-semibold text-[var(--brand-ink)]">
          Write questions
        </h1>
        <p className="text-muted-foreground mt-0.5 text-sm italic">Where your craft is wanted.</p>
      </header>

      {crafting ? (
        <CreationSurface
          domain={crafting.domain}
          statsLine={`${crafting.activePlayers} player${crafting.activePlayers === 1 ? '' : 's'} active · ${crafting.machineDepth} machine · ${crafting.humanAuthored} human-authored`}
          endpoint="/api/admin/craft"
          variant="crafter"
          onBack={() => openDomain(null)}
        />
      ) : (
        <>
          <p className="text-muted-foreground mb-1 text-sm leading-relaxed">
            Where players are active <em>and</em> the set is still thin — ranked by where your
            authoring would matter most. An invitation, not a to-do list: make what you love; this
            just shows where love and need overlap.
          </p>
          <p className="text-muted-foreground mb-4 text-xs">
            Depth counts machine pool and human-authored separately — a domain with players and no
            human questions is where your craft is most wanted. Within a band, domains where the
            machine <em>struggles</em> (its questions get pulled, or generation times out) rank
            first: those can&apos;t self-heal on refill — only a human deepens them.
          </p>
          <div className="space-y-2.5">
            {worklist.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No active domains in the window yet — check back after people play.
              </p>
            ) : (
              worklist.map((row) => (
                <DomainRow key={row.domain} row={row} onCraft={() => openDomain(row)} />
              ))
            )}
          </div>
          <GateCalibrationReadout calibration={calibration ?? null} />
        </>
      )}
    </main>
  );
}

// How often the machine's doubts agree with the human's verdicts — the
// evidence base any future auto-keep must clear. Kinds reuse the card-chip
// vocabulary (FLAG_LABEL) so this reads in the crafter's own language.
function GateCalibrationReadout({ calibration }: { calibration: GateCalibration | null }) {
  if (!calibration) return null;
  const totalVerdicts = calibration.totalKept + calibration.totalKilled;
  return (
    <section className="mt-8">
      <h2 className="mb-1 font-serif text-lg font-semibold text-[var(--brand-ink)]">
        How often the machine&apos;s doubts were right
      </h2>
      {totalVerdicts === 0 ? (
        <p className="text-muted-foreground text-sm">
          Appears once you keep or kill drafts — every verdict teaches the machine, and this
          shows how often its doubts were right.
        </p>
      ) : (
        <>
          <p className="text-muted-foreground mb-2 text-xs">
            {calibration.totalKept} kept · {calibration.totalKilled} killed
            {calibration.totalKilled > 0
              ? ` · ${calibration.cleanKills} kill${calibration.cleanKills === 1 ? '' : 's'} the machine saw nothing wrong with`
              : ''}
          </p>
          {calibration.byKind.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              No flagged candidates decided yet — the gates haven&apos;t been tested against your
              judgment.
            </p>
          ) : (
            <ul className="space-y-1">
              {calibration.byKind.map((row) => {
                const overruledPct = Math.round((row.keptDespite / row.shown) * 100);
                return (
                  <li key={row.kind} className="text-xs text-[var(--brand-ink-700)]">
                    <span className="font-medium">
                      {FLAG_LABEL[row.kind as keyof typeof FLAG_LABEL] ?? row.kind}
                    </span>
                    <span className="text-muted-foreground">
                      {' '}
                      — flagged {row.shown}: you kept {row.keptDespite} anyway ({overruledPct}%
                      overruled), killed {row.killed}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

// Mirror of CreationSurface's card-chip labels — the calibration readout
// speaks the same vocabulary the crafter saw on the cards.
const FLAG_LABEL: Record<string, string> = {
  factual_suspect: 'machine may be fabricating',
  quality: 'quality gate',
  answer_leak: 'answer appears in the question',
  tier_mismatch: 'tier mismatch',
};

// Plain-speech demand labels (the old "wanted & thin" / "getting there" read
// as riddles): how much a human's authoring would matter here right now.
const HEAT_LABEL: Record<CrafterWorklistRow['heat'], string> = {
  high: 'high need',
  mid: 'some need',
  low: 'niche',
  covered: 'covered',
};

// Heat reads as a left border accent + a small colored label in the stats line
// — the row's right edge belongs to the Author action alone.
function heatColor(heat: CrafterWorklistRow['heat']): string {
  switch (heat) {
    case 'high':
      return 'var(--danger)';
    case 'mid':
      return 'var(--warning)';
    case 'covered':
      return 'var(--success)';
    default:
      return 'var(--border-strong, var(--border))';
  }
}

type DomainPlayerView = {
  userId: string;
  displayName: string | null;
  lastPlayed: string | null;
  invited: boolean;
  invitationSeen: boolean;
};

function DomainRow({ row, onCraft }: { row: CrafterWorklistRow; onCraft: () => void }) {
  const [players, setPlayers] = useState<DomainPlayerView[] | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function togglePlayers() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (players !== null || loading) return;
    setLoading(true);
    try {
      const res = await fetch('/api/admin/craft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'players', domain: row.domain }),
      });
      if (!res.ok) {
        setError(`Couldn't load players (${res.status}).`);
        return;
      }
      const body = (await res.json()) as { players: DomainPlayerView[] };
      setPlayers(body.players);
    } catch {
      setError("Couldn't load players.");
    } finally {
      setLoading(false);
    }
  }

  async function flipInvitation(player: DomainPlayerView) {
    const action = player.invited ? 'revoke' : 'invite';
    const res = await fetch('/api/admin/craft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action, domain: row.domain, userId: player.userId }),
    });
    if (!res.ok) {
      setError(`${action === 'invite' ? 'Invite' : 'Revoke'} failed (${res.status}).`);
      return;
    }
    setError(null);
    setPlayers((prev) =>
      prev
        ? prev.map((p) =>
            p.userId === player.userId
              ? { ...p, invited: !p.invited, invitationSeen: p.invited ? p.invitationSeen : false }
              : p,
          )
        : prev,
    );
  }

  // The strongest line in the tool is "people are playing and no human has
  // written for them" — when that's true, say it as a sentence, not metadata.
  // Cluster-aware: a variant label holding human questions breaks the story.
  const noHumanStory = row.clusterHumanAuthored === 0 && row.activePlayers >= 2;

  return (
    <div
      className="rounded-md border p-3 text-sm"
      style={{ borderColor: 'var(--border)', borderLeft: `3px solid ${heatColor(row.heat)}` }}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-[var(--brand-ink)]">{row.domain}</span>
            {row.declaredByCrafter ? (
              <span
                className="rounded-sm border px-1.5 py-0.5 type-eyebrow font-semibold uppercase tracking-eyebrow"
                style={{ borderColor: 'var(--accent-gold)', color: 'var(--accent-gold)' }}
                title="One of your declared loves"
              >
                you love this
              </span>
            ) : null}
            {/* D-SUPPLY-FINITE-SET-01: this subject crossed the "too expensive
                for the machine" line — human curation beats auto-fill here. */}
            {row.expensiveToMachine ? (
              <span
                className="rounded-sm border px-1.5 py-0.5 type-eyebrow font-semibold uppercase tracking-eyebrow"
                style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                title={`Expensive for the machine — curate this (${row.expensiveReason ?? 'costly to generate'})`}
              >
                expensive · curate
              </span>
            ) : null}
            <span className="type-eyebrow uppercase tracking-eyebrow" style={{ color: heatColor(row.heat) }}>
              {HEAT_LABEL[row.heat]}
            </span>
          </div>
          {noHumanStory ? (
            <div className="mt-0.5 text-xs text-[var(--brand-ink-700)]">
              {row.activePlayers} people are playing here and no human has ever written for them.
              <span className="text-muted-foreground"> · {row.machineDepth} machine questions</span>
            </div>
          ) : (
            <div className="text-muted-foreground mt-0.5 text-xs">
              {row.activePlayers} player{row.activePlayers === 1 ? '' : 's'} active ·{' '}
              {row.machineDepth} machine · {row.humanAuthored} human-authored
              {row.lastActivity ? ` · last played ${new Date(row.lastActivity).toLocaleDateString()}` : ''}
            </div>
          )}
          {/* The player list used to hide behind the count text itself — an
              invisible affordance. Now it's a real button. */}
          <button
            type="button"
            onClick={() => void togglePlayers()}
            aria-expanded={open}
            className="mt-1 inline-flex min-h-7 items-center rounded-md border px-2 text-xs font-medium"
            style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }}
            title="See who's playing here and invite them to author"
          >
            {open ? 'Hide players ▴' : 'Players & invitations ▾'}
          </button>
          {row.clusterLabels.length > 0 ? (
            <div className="text-muted-foreground mt-0.5 text-xs">
              with variant labels: {row.clusterMachineDepth} machine · {row.clusterHumanAuthored}{' '}
              human —{' '}
              {row.clusterLabels
                .map((c) => `${c.label} (${c.machineDepth + c.humanAuthored})`)
                .join(' · ')}
            </div>
          ) : null}
          {/* The machine-futility story: WHY this row outranks its heat-mates.
              The machine failing here is exactly where a human is
              irreplaceable — a costly domain, not just a thin one. The rate
              counts only SUBSTANTIVE verifier rejections (fact/spoiler/quality);
              self-containment "name-the-source" demotions are excluded upstream
              (they're a salvageable formatting slip, not the machine struggling
              with the subject), so this number can be trusted at face value. */}
          {row.demotionRate !== null && row.demotionRate > 0 ? (
            <div className="mt-0.5 text-xs" style={{ color: 'var(--danger)' }}>
              the verifier rejects the machine here — {row.machineDemoted} of{' '}
              {row.machineVerified} fact-checked questions came back wrong (
              {Math.round(row.demotionRate * 100)}%)
              {row.generationStruggling ? ' · and generation keeps timing out' : ''}
            </div>
          ) : row.generationStruggling ? (
            <div className="mt-0.5 text-xs" style={{ color: 'var(--danger)' }}>
              the machine can’t generate here — refill keeps timing out
            </div>
          ) : null}
        </div>
        {row.heat !== 'covered' ? (
          <button
            type="button"
            onClick={onCraft}
            className="whitespace-nowrap rounded-md border px-3 py-1.5 text-sm font-medium"
            style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
          >
            Author
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
          <p className="text-muted-foreground mb-2 text-xs">
            Invite a player to author here — they&apos;ll see the &ldquo;you&apos;ve played
            through&rdquo; screen once, with authoring as a door. Manual by design: you decide who
            has genuinely bottomed out.
          </p>
          {loading ? (
            <p className="text-muted-foreground text-xs">Loading players…</p>
          ) : players && players.length > 0 ? (
            <ul className="space-y-1.5">
              {players.map((player) => (
                <li key={player.userId} className="flex items-center gap-2 text-xs">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={player.invited}
                      onChange={() => void flipInvitation(player)}
                    />
                    <span className="text-[var(--brand-ink)]">
                      {player.displayName ?? player.userId}
                    </span>
                  </label>
                  <span className="text-muted-foreground">
                    {player.lastPlayed
                      ? `last played ${new Date(player.lastPlayed).toLocaleDateString()}`
                      : ''}
                    {player.invited
                      ? `${player.invitationSeen ? ' · seen the screen' : ' · invited, not yet seen'} · tap again to withdraw`
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-xs">No recent players found.</p>
          )}
          {error ? (
            <p className="mt-2 text-xs" style={{ color: 'var(--danger)' }}>
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
