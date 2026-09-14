'use client';

import { getPortraitDomainColor } from '@/components/knowledge/PortraitCircles';
import { sanitizeInviteLinkCategories } from '@/lib/invite-links';
import { Chip } from '@/components/ui/Chip';

export function InviteCategoryChips({ categories }: { categories: unknown }) {
  const safeCategories = sanitizeInviteLinkCategories(categories);
  if (safeCategories.length === 0) return null;

  return (
    <div className="flex flex-wrap justify-center gap-2" aria-label="Recommended categories">
      {safeCategories.map((category) => {
        const color = getPortraitDomainColor(category.broadCategory ?? category.label);
        return (
          <Chip
            key={category.label}
            variant="outline"
            className="max-w-full whitespace-normal font-semibold"
            style={{
              borderColor: `color-mix(in srgb, ${color.primary} 40%, transparent)`,
              color: color.text,
              overflowWrap: 'anywhere',
            }}
            leading={
              <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: color.primary }} />
            }
          >
            {category.label}
          </Chip>
        );
      })}
    </div>
  );
}
