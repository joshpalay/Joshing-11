import { InviteLinksSection } from '@/components/friends/InviteLinksSection';

const previewTopics = [
  { label: 'Ancient History', broadCategory: 'History' },
  { label: 'Cinema', broadCategory: 'Arts & Culture' },
  { label: 'Space Exploration', broadCategory: 'Science' },
  { label: 'World Cuisine', broadCategory: 'Food & Drink' },
];

const previewLinks = [
  {
    id: 'preview-history',
    slot: 1,
    title: null,
    categories: [previewTopics[0]!, previewTopics[2]!],
    url: '/dev/invite-redesign/recipient',
    createdAt: '2026-09-01T12:00:00.000Z',
    joinedCount: 1,
  },
  {
    id: 'preview-culture',
    slot: 2,
    title: 'Culture club',
    categories: [previewTopics[1]!, previewTopics[3]!],
    url: '/dev/invite-redesign/recipient',
    createdAt: '2026-09-02T12:00:00.000Z',
    joinedCount: 2,
  },
];

export default function InviteCreatorPreviewPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-5 pb-28">
      <header className="mb-5">
        <h1 className="text-foreground font-serif text-3xl font-semibold">Friends</h1>
      </header>

      <div className="mb-5">
        <InviteLinksSection initialTopics={previewTopics} initialLinks={previewLinks} />
      </div>

      <section aria-label="Friends list preview" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-serif text-xl font-semibold">Your friends</h2>
          <button
            type="button"
            className="min-h-11 text-sm font-medium text-[var(--brand-navy)] underline underline-offset-4"
          >
            Sort friends
          </button>
        </div>
      </section>
    </main>
  );
}
