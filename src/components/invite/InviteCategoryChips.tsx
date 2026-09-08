'use client';

import { getPortraitDomainColor } from '@/components/knowledge/PortraitCircles';
import { sanitizeInviteLinkCategories } from '@/lib/invite-links';

export function InviteCategoryChips({ categories }: { categories: unknown }) {
  const safeCategories = sanitizeInviteLinkCategories(categories);
  if (safeCategories.length === 0) return null;

  return (
    <div className="flex flex-wrap justify-center gap-2" aria-label="Recommended categories">
      {safeCategories.map((category) => {
        const color = getPortraitDomainColor(category.broadCategory ?? category.label);
        return (
          <span
            key={category.label}
            className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold whitespace-normal"
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
            {category.label}
          </span>
        );
      })}
    </div>
  );
}
