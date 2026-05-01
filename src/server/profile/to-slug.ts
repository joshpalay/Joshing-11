import { toCanonicalDomainSlug } from '@/server/profile/domain-slug';

export function toSlug(value: string): string {
  return toCanonicalDomainSlug(value);
}
