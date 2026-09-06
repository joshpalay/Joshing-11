import { categoryLabel } from '@/lib/questions-types';
import { isGenericSubcategory } from '@/server/questions/canonical-subcategory';
import type { QueueSlot } from '@/server/daily/types';

/**
 * The most SPECIFIC label a queue slot carries, not merely the first one present.
 *
 * The chain this replaces read broad_category → category → domain, which is
 * least-specific-first. A slot whose domain is "Renaissance Florence" but whose
 * broad_category is the "General Knowledge" bucket badged as General Knowledge —
 * on the screen that promises "Made from your topics, not pulled off a shelf."
 * A live production walkthrough hit it on both of a new player's first two
 * questions, and 68 of 1,302 questions with a specific canonical_subcategory sit
 * under that bucket, so the exposure is systematic rather than a one-off.
 *
 * `isGenericSubcategory` is the same write-boundary guard that already refuses
 * these labels on `questions.canonical_subcategory`, reused here so both agree
 * on what "generic" means instead of this surface keeping its own bucket list.
 * Note it catches the mapped form too: `categoryLabel('general_knowledge')`
 * returns "General Knowledge", which is in the forbidden set.
 *
 * Falls back to `slot.domain` unconditionally at the end — a slot with no usable
 * label at all yields the empty string, and callers already treat that as "no
 * badge" rather than rendering a blank chip.
 */
export function slotCategoryLabel(slot: QueueSlot): string {
  const broad = slot.broad_category?.trim();
  if (broad && !isGenericSubcategory(broad)) return broad;
  const mapped = slot.category ? categoryLabel(slot.category) : '';
  if (mapped && !isGenericSubcategory(mapped)) return mapped;
  return slot.domain;
}
