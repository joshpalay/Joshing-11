'use client'

import { useState } from 'react'

import { AddTopicField, type AddTopicCandidate, type AddTopicError } from '@/components/interests/AddTopicField'
import { getPortraitDomainColor } from '@/components/knowledge/PortraitCircles'

const SEED_TOPIC_CAP = 3
const SHARE_TEXT = "I'm playing Joshing — come be my friend."

export type InviteLinkTopic = {
  label: string
  broadCategory?: string | null
}

export type InviteLinkRowData = {
  id: string
  slot: number
  url: string
  createdAt: string
  joinedCount: number
}

type Props = {
  initialTopics: InviteLinkTopic[]
  initialLinks: InviteLinkRowData[]
}

type TopicsResponse = { topics?: InviteLinkTopic[]; message?: string }
type LinkResponse = { link?: InviteLinkRowData; message?: string }

function topicColor(topic: InviteLinkTopic | null): { primary: string; text: string } {
  if (!topic) return { primary: 'var(--brand-ink-400)', text: 'var(--brand-ink-700)' }
  return getPortraitDomainColor(topic.broadCategory ?? topic.label)
}

// The tag a specific link carries — 0 (untagged) or the topic at that
// standing slot, 1-indexed against `topics`.
function slotLabel(slot: number, topics: InviteLinkTopic[]): string {
  if (slot === 0) return 'No category'
  return topics[slot - 1]?.label ?? 'No category'
}

async function shareUrl(url: string, onCopied: () => void) {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ text: SHARE_TEXT, url })
      return
    } catch (shareError) {
      if (shareError instanceof Error && shareError.name === 'AbortError') return
    }
  }
  await navigator.clipboard.writeText(url)
  onCopied()
}

export function InviteLinksSection({ initialTopics, initialLinks }: Props) {
  const [topics, setTopics] = useState<InviteLinkTopic[]>(initialTopics)
  const [links, setLinks] = useState<InviteLinkRowData[]>(initialLinks)
  const [draftSlot, setDraftSlot] = useState<number | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [creatingTopic, setCreatingTopic] = useState(false)
  const [creatingLink, setCreatingLink] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const usedSlots = new Set(links.map((link) => link.slot).filter((slot) => slot !== 0))

  function flashToast(message: string) {
    setToast(message)
    window.setTimeout(() => setToast((current) => (current === message ? null : current)), 1800)
  }

  async function handleAddTopic(candidate: AddTopicCandidate) {
    const label = candidate.label.trim()
    if (topics.some((topic) => topic.label.toLowerCase() === label.toLowerCase())) {
      const err: AddTopicError = new Error('You already added that one.')
      throw err
    }
    if (topics.length >= SEED_TOPIC_CAP) {
      const err: AddTopicError = new Error(`You already have ${SEED_TOPIC_CAP}. Remove one to add another.`)
      err.code = 'limit_reached'
      throw err
    }

    const next = [...topics, { label, broadCategory: candidate.broadCategory ?? null }]
    const response = await fetch('/api/account/invite-links/topics', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topics: next.map((topic) => topic.label) }),
    })
    const body = (await response.json().catch(() => null)) as TopicsResponse | null
    if (!response.ok) {
      const err: AddTopicError = new Error(body?.message ?? 'Could not add that topic.')
      if (body?.message?.includes('too broad')) err.code = 'too_broad'
      throw err
    }
    // Keep the broadCategory this add just resolved (AddTopicField already ran
    // it through expansion/convergence) — the PATCH response only echoes
    // labels, since curated storage doesn't persist category.
    setTopics(next)
  }

  async function removeTopic(label: string) {
    const next = topics.filter((topic) => topic.label !== label)
    setTopics(next)
    setDraftSlot(null)
    setShowCreate(true)
    await fetch('/api/account/invite-links/topics', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topics: next.map((topic) => topic.label) }),
    }).catch(() => undefined)
  }

  async function createLink() {
    if (draftSlot === null || creatingLink) return
    setCreatingLink(true)
    setCreateError(null)
    try {
      const response = await fetch('/api/account/invite-links', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slot: draftSlot }),
      })
      const body = (await response.json().catch(() => null)) as LinkResponse | null
      if (!response.ok || !body?.link) {
        setCreateError(body?.message ?? 'Could not create that link.')
        return
      }
      setLinks((current) => [...current, body.link!])
      setDraftSlot(null)
      setShowCreate(false)
      flashToast('Link created.')
    } catch {
      setCreateError('Network error. Try again.')
    } finally {
      setCreatingLink(false)
    }
  }

  async function confirmDelete() {
    if (!pendingDeleteId || deleting) return
    setDeleting(true)
    try {
      const response = await fetch(`/api/account/invite-links/${pendingDeleteId}/delete`, {
        method: 'POST',
        credentials: 'include',
      })
      if (response.ok) {
        setLinks((current) => current.filter((link) => link.id !== pendingDeleteId))
        flashToast('Link deleted. Friends kept.')
      }
    } finally {
      setDeleting(false)
      setPendingDeleteId(null)
    }
  }

  const pendingDeleteLink = links.find((link) => link.id === pendingDeleteId) ?? null

  return (
    <section id="invite-links" className="bg-card text-card-foreground rounded-[var(--radius-card)] border p-4 shadow-[var(--shadow-card)]">
      <h2 className="font-serif text-lg font-semibold">Invite via link</h2>
      <p className="text-muted-foreground mt-1 text-sm">
        Up to 3 at a time. Anyone with a link can join — deleting one never removes a friend.
      </p>

      <div className="mt-3 space-y-2">
        {links.map((link) => {
          const topic = link.slot === 0 ? null : (topics[link.slot - 1] ?? null)
          const color = topicColor(topic)
          const label = slotLabel(link.slot, topics)
          // An untagged link carries every standing topic; a tagged one carries
          // exactly its slot. Same resolution the server uses in
          // getInviteLinkSeedTopics(userId, slot).
          const carriedTopics = link.slot === 0 ? topics : topic ? [topic] : []
          return (
            <article
              key={link.id}
              className="relative overflow-hidden rounded-[var(--radius-card)] border bg-background pl-4 pr-3 py-3"
              style={{ borderColor: 'var(--brand-border)' }}
            >
              <span
                aria-hidden
                className="absolute left-0 top-0 h-full w-[5px]"
                style={{ background: color.primary }}
              />
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold"
                style={{ background: `color-mix(in srgb, ${color.primary} 12%, transparent)`, color: color.text }}
              >
                <span className="size-1.5 rounded-full" style={{ background: color.primary }} />
                {label}
              </span>
              {/* The raw share URL is deliberately NOT rendered. It was 60+
                  characters of base64 wrapping onto two lines -- the loudest
                  thing on the card, and unreadable by design (nobody reads a
                  token). What a person actually needs to recognise a link is
                  what it CARRIES and how it has done, so the topic chips and
                  the join count take that space instead. The URL still reaches
                  the clipboard and the share sheet via the buttons below. */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {carriedTopics.length > 0 ? (
                  carriedTopics.map((topic) => {
                    const chipColor = topicColor(topic)
                    return (
                      <span
                        key={topic.label}
                        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
                        style={{ borderColor: `color-mix(in srgb, ${chipColor.primary} 40%, transparent)`, color: chipColor.text }}
                      >
                        <span className="size-1 rounded-full" style={{ background: chipColor.primary }} />
                        {topic.label}
                      </span>
                    )
                  })
                ) : (
                  <span className="text-muted-foreground text-xs">No topics yet</span>
                )}
              </div>
              <p className="text-muted-foreground/80 mt-1.5 text-xs">
                {link.joinedCount} joined
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => void shareUrl(link.url, () => flashToast('Link copied.'))}
                  className="btn-ghost h-8 px-3 text-xs"
                >
                  Share
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDeleteId(link.id)}
                  className="btn-ghost text-destructive h-8 px-3 text-xs"
                >
                  Delete
                </button>
              </div>
            </article>
          )
        })}
        {links.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No invite links yet. Make one and share it anywhere — a text, a group chat, your bio.
          </p>
        ) : null}
      </div>

      {links.length >= 3 ? (
        <p className="text-muted-foreground mt-3 text-xs">
          You have all 3 links. Delete one to make another.
        </p>
      ) : showCreate ? (
        <div className="mt-3 space-y-3 rounded-xl border p-3" style={{ borderColor: 'var(--brand-border)' }}>
          <p className="text-sm font-medium">Tag the new link</p>
          <div className="space-y-2">
            {topics.map((topic, index) => {
              const slot = index + 1
              const color = topicColor(topic)
              const locked = usedSlots.has(slot)
              const selected = draftSlot === slot
              return (
                <div
                  key={topic.label}
                  className="flex items-stretch overflow-hidden rounded-full border-2"
                  style={{
                    borderColor: selected ? color.primary : 'var(--brand-border)',
                    background: selected ? `color-mix(in srgb, ${color.primary} 8%, transparent)` : 'var(--brand-field)',
                  }}
                >
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => setDraftSlot(slot)}
                    aria-pressed={selected}
                    className="flex flex-1 items-center gap-2.5 px-3 py-2.5 text-left disabled:opacity-45"
                  >
                    <span
                      className="size-4 rounded-full border-2"
                      style={{ borderColor: selected ? color.primary : 'var(--brand-border)' }}
                    >
                      {selected ? (
                        <span
                          className="block size-full scale-50 rounded-full"
                          style={{ background: color.primary }}
                        />
                      ) : null}
                    </span>
                    <span className="text-sm font-semibold">
                      {topic.label}{' '}
                      <span className="text-muted-foreground text-xs font-medium">
                        {locked ? '— link exists' : topic.broadCategory ?? ''}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => void removeTopic(topic.label)}
                    aria-label={`Swap out ${topic.label} for something else`}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30 px-3 text-xs font-medium underline underline-offset-2"
                  >
                    Swap
                  </button>
                </div>
              )
            })}
            <button
              type="button"
              onClick={() => setDraftSlot(0)}
              aria-pressed={draftSlot === 0}
              className="flex w-full items-center gap-2.5 rounded-full border-2 px-3 py-2.5 text-left"
              style={{
                borderColor: draftSlot === 0 ? 'var(--accent-gold)' : 'var(--brand-border)',
                background:
                  draftSlot === 0
                    ? 'color-mix(in srgb, var(--accent-gold) 12%, transparent)'
                    : 'var(--brand-field)',
              }}
            >
              <span
                className="size-4 rounded-full border-2"
                style={{ borderColor: draftSlot === 0 ? 'var(--accent-gold)' : 'var(--brand-border)' }}
              >
                {draftSlot === 0 ? (
                  <span className="block size-full scale-50 rounded-full" style={{ background: 'var(--accent-gold)' }} />
                ) : null}
              </span>
              <span className="text-sm font-semibold">
                No category{' '}
                <span className="text-muted-foreground text-xs font-medium">
                  {topics.length > 0
                    ? `carries all ${topics.length} topic${topics.length === 1 ? '' : 's'} above`
                    : 'carries your most-played topics'}
                </span>
              </span>
            </button>
          </div>

          {topics.length < SEED_TOPIC_CAP ? (
            creatingTopic ? (
              <div className="rounded-xl border p-3" style={{ borderColor: 'var(--brand-border)', background: 'var(--brand-cream-card)' }}>
                <AddTopicField
                  onAdd={handleAddTopic}
                  existingLabels={topics.map((topic) => topic.label)}
                  convergeBeforeAdd
                  placeholder="e.g. Byzantine Coinage"
                />
                <button
                  type="button"
                  onClick={() => setCreatingTopic(false)}
                  className="text-muted-foreground hover:text-foreground mt-2 text-xs underline underline-offset-2"
                >
                  Done
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setCreatingTopic(true)} className="btn-ghost w-full">
                + Create your own
              </button>
            )
          ) : (
            // At the 3-topic cap the add flow isn't gone, just one step away —
            // say so instead of rendering nothing, since a bare "×" glyph
            // above doesn't read as "this reopens adding."
            <p className="text-muted-foreground text-center text-xs">
              All 3 topics are taken. Tap Swap above to trade one for something new.
            </p>
          )}

          {createError ? <p className="text-destructive text-sm">{createError}</p> : null}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void createLink()}
              disabled={draftSlot === null || creatingLink}
              className="btn-primary flex-1"
            >
              {creatingLink ? 'Creating…' : 'Create link'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCreate(false)
                setDraftSlot(null)
                setCreateError(null)
              }}
              className="btn-ghost"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setShowCreate(true)} className="btn-primary mt-3 w-full">
          Create an invite link
        </button>
      )}

      {pendingDeleteLink ? (
        <div
          className="fixed inset-0 z-[var(--z-modal)] flex items-end justify-center sm:items-center"
          style={{ background: 'var(--scrim)' }}
        >
          <div className="w-full max-w-sm rounded-t-2xl bg-card p-5 text-card-foreground sm:rounded-2xl">
            <h3 className="font-serif text-xl font-semibold">
              Delete your {slotLabel(pendingDeleteLink.slot, topics)} link?
            </h3>
            <p
              className="mt-3 rounded-lg p-2.5 text-sm"
              style={{ background: 'var(--success-surface)', color: 'var(--success)' }}
            >
              The {pendingDeleteLink.joinedCount} {pendingDeleteLink.joinedCount === 1 ? 'person' : 'people'} who
              already joined through this link stay your friends. Nothing changes for them.
            </p>
            <p
              className="mt-2 rounded-lg p-2.5 text-sm"
              style={{ background: 'var(--warning-surface)', color: 'var(--warning)' }}
            >
              The link stops working right away. A new link gets a new address, so you&rsquo;d need to
              send it again.
            </p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setPendingDeleteId(null)} className="btn-ghost flex-1">
                Keep it
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                disabled={deleting}
                className="btn-primary flex-1 bg-[var(--destructive)]"
              >
                {deleting ? 'Deleting…' : 'Delete link'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="fixed bottom-24 left-1/2 z-[var(--z-toast)] -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {toast}
        </div>
      ) : null}
    </section>
  )
}
