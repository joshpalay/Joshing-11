'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';

import {
  AddTopicField,
  type AddTopicCandidate,
  type AddTopicError,
} from '@/components/interests/AddTopicField';
import { getPortraitDomainColor } from '@/components/knowledge/PortraitCircles';
import {
  DEFAULT_INVITE_LINK_TITLE,
  inviteLinkCardTitle,
  MAX_INVITE_LINK_CATEGORIES,
  MAX_INVITE_LINK_TITLE_LENGTH,
  sanitizeInviteLinkCategories,
  sanitizeInviteLinkTitle,
  type InviteLinkCategory,
} from '@/lib/invite-links';

const SHARE_TEXT = "I'm playing Joshing — come be my friend.";

export type InviteLinkTopic = InviteLinkCategory;

export type InviteLinkRowData = {
  id: string;
  slot: number;
  title?: string | null;
  categories: InviteLinkTopic[];
  url: string;
  createdAt: string;
  joinedCount: number;
};

type Props = {
  initialTopics: InviteLinkTopic[];
  initialLinks: InviteLinkRowData[];
};

type LinkResponse = { link?: InviteLinkRowData; message?: string };
type EditResponse = { title?: string; categories?: InviteLinkTopic[]; message?: string };
type EditorState = { kind: 'create' } | { kind: 'edit'; linkId: string };

function topicColor(topic: InviteLinkTopic | null): { primary: string; text: string } {
  if (!topic) return { primary: 'var(--brand-ink-400)', text: 'var(--brand-ink-700)' };
  return getPortraitDomainColor(topic.broadCategory ?? topic.label);
}

export function joinedFriendsCopy(count: number): string {
  return `${count} ${count === 1 ? 'friend' : 'friends'} joined`;
}

export function createInviteLinkControlCopy(activeCount: number): string {
  return activeCount === 0 ? 'Create an invite link' : 'Create a link with different categories';
}

async function shareUrl(url: string, onCopied: () => void) {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ text: SHARE_TEXT, url });
      return;
    } catch (shareError) {
      if (shareError instanceof Error && shareError.name === 'AbortError') return;
    }
  }
  await navigator.clipboard.writeText(url);
  onCopied();
}

function CategoryChip({ topic, onRemove }: { topic: InviteLinkTopic; onRemove?: () => void }) {
  const color = topicColor(topic);
  return (
    <span
      className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-normal"
      style={{
        borderColor: `color-mix(in srgb, ${color.primary} 40%, transparent)`,
        color: color.text,
        overflowWrap: 'anywhere',
      }}
    >
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ background: color.primary }}
      />
      <span>{topic.label}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-base leading-none hover:bg-[var(--brand-navy)]/5 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--brand-navy)]"
          aria-label={`Remove ${topic.label}`}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

export function InviteLinksSection({ initialTopics, initialLinks }: Props) {
  const suggestions = sanitizeInviteLinkCategories(initialTopics);
  const [links, setLinks] = useState<InviteLinkRowData[]>(() =>
    initialLinks.map((link) => ({
      ...link,
      title: inviteLinkCardTitle(link.title),
      categories: sanitizeInviteLinkCategories(link.categories),
    })),
  );
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftCategories, setDraftCategories] = useState<InviteLinkTopic[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function flashToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast((current) => (current === message ? null : current)), 1800);
  }

  function closeEditor() {
    setEditor(null);
    setDraftTitle('');
    setDraftCategories([]);
    setSaveError(null);
  }

  function openCreate() {
    setDraftTitle(DEFAULT_INVITE_LINK_TITLE);
    setDraftCategories([]);
    setSaveError(null);
    setEditor({ kind: 'create' });
  }

  function openEdit(link: InviteLinkRowData) {
    setDraftTitle(inviteLinkCardTitle(link.title));
    setDraftCategories(sanitizeInviteLinkCategories(link.categories));
    setSaveError(null);
    setEditor({ kind: 'edit', linkId: link.id });
  }

  async function handleAddTopic(candidate: AddTopicCandidate) {
    if (draftCategories.length >= MAX_INVITE_LINK_CATEGORIES) {
      const error = new Error(
        `You can choose up to ${MAX_INVITE_LINK_CATEGORIES} categories per link.`,
      ) as AddTopicError;
      error.code = 'limit_reached';
      throw error;
    }
    const next = sanitizeInviteLinkCategories([...draftCategories, candidate]);
    if (next.length === draftCategories.length) {
      throw new Error('You already added that category.');
    }
    setDraftCategories(next);
    setSaveError(null);
  }

  function addSuggestedTopic(topic: InviteLinkTopic) {
    if (draftCategories.length >= MAX_INVITE_LINK_CATEGORIES) return;
    setDraftCategories((current) => sanitizeInviteLinkCategories([...current, topic]));
    setSaveError(null);
  }

  function removeDraftTopic(label: string) {
    setDraftCategories((current) => current.filter((topic) => topic.label !== label));
  }

  async function saveLink() {
    const title = sanitizeInviteLinkTitle(draftTitle);
    if (!title) {
      setSaveError('Add a title before saving this link.');
      return;
    }
    const categories = sanitizeInviteLinkCategories(draftCategories);
    if (categories.length === 0) {
      setSaveError('Choose at least one category before saving this link.');
      return;
    }
    if (!editor || saving) return;

    setSaving(true);
    setSaveError(null);
    try {
      if (editor.kind === 'create') {
        const response = await fetch('/api/account/invite-links', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title, categories }),
        });
        const body = (await response.json().catch(() => null)) as LinkResponse | null;
        if (!response.ok || !body?.link) {
          setSaveError(body?.message ?? 'Could not create that link.');
          return;
        }
        setLinks((current) => [
          ...current,
          {
            ...body.link!,
            title: inviteLinkCardTitle(body.link!.title),
            categories: sanitizeInviteLinkCategories(body.link!.categories),
          },
        ]);
        flashToast('Link created.');
      } else {
        const response = await fetch(`/api/account/invite-links/${editor.linkId}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title, categories }),
        });
        const body = (await response.json().catch(() => null)) as EditResponse | null;
        if (!response.ok || !body?.title || !body.categories) {
          setSaveError(body?.message ?? 'Could not save that link.');
          return;
        }
        setLinks((current) =>
          current.map((link) =>
            link.id === editor.linkId
              ? {
                  ...link,
                  title: inviteLinkCardTitle(body.title),
                  categories: sanitizeInviteLinkCategories(body.categories),
                }
              : link,
          ),
        );
        flashToast('Link updated.');
      }
      closeEditor();
    } catch {
      setSaveError('Network error. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDeleteId || deleting) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/account/invite-links/${pendingDeleteId}/delete`, {
        method: 'POST',
        credentials: 'include',
      });
      if (response.ok) {
        setLinks((current) => current.filter((link) => link.id !== pendingDeleteId));
        if (editor?.kind === 'edit' && editor.linkId === pendingDeleteId) closeEditor();
        flashToast('Link deleted. Friends kept.');
      }
    } finally {
      setDeleting(false);
      setPendingDeleteId(null);
    }
  }

  const pendingDeleteLink = links.find((link) => link.id === pendingDeleteId) ?? null;
  const availableSuggestions = suggestions.filter(
    (suggestion) =>
      !draftCategories.some(
        (selected) =>
          selected.label.toLocaleLowerCase('en-US') === suggestion.label.toLocaleLowerCase('en-US'),
      ),
  );

  return (
    <section
      id="invite-links"
      className="bg-card text-card-foreground rounded-[var(--radius-card)] border p-4 shadow-[var(--shadow-card)]"
    >
      <h2 className="font-serif text-xl font-semibold">Invite via link</h2>
      <p className="text-muted-foreground mt-1 text-sm leading-5">
        Create a personal invitation with a few categories to get the two of you playing.
      </p>

      <div className="mt-4 space-y-3">
        {links.map((link) => {
          const categories = sanitizeInviteLinkCategories(link.categories);
          const accent = topicColor(categories[0] ?? null);
          return (
            <article
              key={link.id}
              className="bg-background relative min-w-0 overflow-hidden rounded-[var(--radius-card)] border py-3 pr-3 pl-4"
              style={{ borderColor: 'var(--brand-border)' }}
            >
              <span
                aria-hidden
                className="absolute top-0 left-0 h-full w-[5px]"
                style={{ background: accent.primary }}
              />
              <h3 className="font-serif text-xl leading-tight font-semibold break-words text-[var(--brand-navy)]">
                {inviteLinkCardTitle(link.title)}
              </h3>
              <p className="text-muted-foreground mt-1 text-sm leading-5">
                We’ll recommend these categories to anyone who uses this link.
              </p>
              {categories.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {categories.map((topic) => (
                    <CategoryChip key={topic.label} topic={topic} />
                  ))}
                </div>
              ) : (
                <p className="text-destructive mt-2 text-xs leading-5">
                  This legacy link needs at least one category. Use Edit to choose one.
                </p>
              )}
              <p className="text-muted-foreground/80 mt-2 text-xs">
                {joinedFriendsCopy(link.joinedCount)}
              </p>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-muted text-muted-foreground hover:text-foreground mt-2 block rounded-md px-2 py-1.5 font-mono text-xs break-all underline decoration-transparent underline-offset-2 transition hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-navy)]"
              >
                {link.url}
              </a>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                <button
                  type="button"
                  onClick={() => void shareUrl(link.url, () => flashToast('Link copied.'))}
                  className="inline-flex min-h-10 items-center justify-center rounded-md bg-[var(--brand-navy)] px-3 text-xs font-semibold text-[var(--brand-card)] transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-navy)]"
                >
                  Share link
                </button>
                <button
                  type="button"
                  onClick={() => openEdit(link)}
                  className="min-h-10 text-sm font-medium text-[var(--brand-navy)] underline decoration-transparent underline-offset-4 transition hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-navy)]"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDeleteId(link.id)}
                  className="text-destructive focus-visible:outline-destructive min-h-10 text-sm font-medium underline decoration-transparent underline-offset-4 transition hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  Delete
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {editor ? (
        <div
          className="mt-4 space-y-3 rounded-[var(--radius-card)] border p-3"
          style={{ borderColor: 'var(--brand-border)' }}
        >
          <div>
            <h3 className="font-serif text-lg font-semibold">
              {editor.kind === 'create' ? 'Create invitation link' : 'Edit invitation link'}
            </h3>
            <p className="text-muted-foreground mt-1 text-sm leading-5">
              Choose up to {MAX_INVITE_LINK_CATEGORIES}. Your friend can keep, change, or ignore
              them during setup.
            </p>
          </div>

          <div>
            <label htmlFor="invite-link-title" className="text-sm font-medium">
              Title
            </label>
            <input
              id="invite-link-title"
              type="text"
              required
              maxLength={MAX_INVITE_LINK_TITLE_LENGTH}
              value={draftTitle}
              onChange={(event) => {
                setDraftTitle(event.target.value);
                setSaveError(null);
              }}
              className="bg-background mt-1 min-h-11 w-full rounded-md border px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-navy)]"
            />
          </div>

          {draftCategories.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {draftCategories.map((topic) => (
                <CategoryChip
                  key={topic.label}
                  topic={topic}
                  onRemove={() => removeDraftTopic(topic.label)}
                />
              ))}
            </div>
          ) : (
            <p className="text-destructive text-sm" role="status">
              Choose at least one category to save.
            </p>
          )}

          {availableSuggestions.length > 0 &&
          draftCategories.length < MAX_INVITE_LINK_CATEGORIES ? (
            <div>
              <p className="text-muted-foreground mb-2 text-xs font-medium">Your categories</p>
              <div className="flex flex-wrap gap-2">
                {availableSuggestions.map((topic) => (
                  <button
                    key={topic.label}
                    type="button"
                    onClick={() => addSuggestedTopic(topic)}
                    className="hover:bg-muted inline-flex min-h-9 max-w-full items-center gap-1 rounded-full border px-3 py-1 text-left text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-navy)]"
                  >
                    <Plus className="size-3.5 shrink-0" aria-hidden />
                    <span style={{ overflowWrap: 'anywhere' }}>{topic.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {draftCategories.length < MAX_INVITE_LINK_CATEGORIES ? (
            <AddTopicField
              heading="Add a different category"
              onAdd={handleAddTopic}
              existingLabels={draftCategories.map((topic) => topic.label)}
              convergeBeforeAdd
              placeholder="e.g. Byzantine Coinage"
              multiAddHint={false}
            />
          ) : (
            <p className="text-muted-foreground text-xs">
              You’ve chosen the maximum of {MAX_INVITE_LINK_CATEGORIES} categories.
            </p>
          )}

          {saveError ? (
            <p className="text-destructive text-sm" role="alert">
              {saveError}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void saveLink()}
              disabled={!draftTitle.trim() || draftCategories.length === 0 || saving}
              className="btn-primary min-h-11 px-4 disabled:opacity-45"
            >
              {saving ? 'Saving…' : editor.kind === 'create' ? 'Create link' : 'Save changes'}
            </button>
            <button type="button" onClick={closeEditor} className="btn-ghost min-h-11 px-3">
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {links.length < 3 && !editor ? (
        <button
          type="button"
          onClick={openCreate}
          className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-left text-sm font-semibold text-[var(--brand-navy)] underline decoration-transparent underline-offset-4 transition hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-navy)]"
        >
          <Plus className="size-4 shrink-0" aria-hidden />
          {createInviteLinkControlCopy(links.length)}
        </button>
      ) : null}
      <p className="text-muted-foreground mt-1 text-xs leading-5">
        You can keep up to three active invitation links.
      </p>

      {pendingDeleteLink ? (
        <div
          className="fixed inset-0 z-[var(--z-modal)] flex items-end justify-center sm:items-center"
          style={{ background: 'var(--scrim)' }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-invite-link-title"
        >
          <div className="bg-card text-card-foreground w-full max-w-sm rounded-t-2xl p-5 sm:rounded-2xl">
            <h3 id="delete-invite-link-title" className="font-serif text-xl font-semibold">
              Delete this invitation link?
            </h3>
            <p
              className="mt-3 rounded-lg p-2.5 text-sm"
              style={{ background: 'var(--success-surface)', color: 'var(--success)' }}
            >
              The {pendingDeleteLink.joinedCount}{' '}
              {pendingDeleteLink.joinedCount === 1 ? 'person' : 'people'} who already joined through
              this link stay your friends. Nothing changes for them.
            </p>
            <p
              className="mt-2 rounded-lg p-2.5 text-sm"
              style={{ background: 'var(--warning-surface)', color: 'var(--warning)' }}
            >
              The link stops working right away. A new link gets a new address, so you’d need to
              send it again.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setPendingDeleteId(null)}
                className="btn-ghost min-h-11 flex-1"
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                disabled={deleting}
                className="btn-primary min-h-11 flex-1 bg-[var(--destructive)]"
              >
                {deleting ? 'Deleting…' : 'Delete link'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div
          className="bg-foreground text-background fixed bottom-24 left-1/2 z-[var(--z-toast)] -translate-x-1/2 rounded-full px-4 py-2 text-sm whitespace-nowrap shadow-lg"
          role="status"
        >
          {toast}
        </div>
      ) : null}
    </section>
  );
}
