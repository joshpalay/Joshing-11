import { describe, expect, it } from 'vitest'
import {
  GenericCanonicalSubcategoryError,
  assertSpecificCanonicalSubcategory,
  isGenericSubcategory,
} from '@/server/questions/canonical-subcategory'

describe('canonical-subcategory boundary guard (F4.5)', () => {
  describe('isGenericSubcategory', () => {
    it('returns true for null/undefined/empty', () => {
      expect(isGenericSubcategory(null)).toBe(true)
      expect(isGenericSubcategory(undefined)).toBe(true)
      expect(isGenericSubcategory('')).toBe(true)
      expect(isGenericSubcategory('   ')).toBe(true)
    })

    it('returns true for the forbidden bucket labels (case + whitespace + separator insensitive)', () => {
      expect(isGenericSubcategory('Other')).toBe(true)
      expect(isGenericSubcategory('OTHER')).toBe(true)
      expect(isGenericSubcategory('general_knowledge')).toBe(true)
      expect(isGenericSubcategory('General Knowledge')).toBe(true)
      expect(isGenericSubcategory('general-knowledge')).toBe(true)
      expect(isGenericSubcategory('  General  Knowledge  ')).toBe(true)
      expect(isGenericSubcategory('general')).toBe(true)
      expect(isGenericSubcategory('trivia')).toBe(true)
      expect(isGenericSubcategory('Potpourri')).toBe(true)
    })

    it('returns false for hyper-specific labels', () => {
      expect(isGenericSubcategory('Late Tchaikovsky')).toBe(false)
      expect(isGenericSubcategory('Bebop')).toBe(false)
      expect(isGenericSubcategory('Mrs. Dalloway')).toBe(false)
      expect(isGenericSubcategory('T. S. Eliot')).toBe(false)
    })

    it('returns false for broad-but-acceptable category names', () => {
      // Note: the audit lists these in the LLM helper's superset (used for
      // re-prompting), but they are NOT in the strict write-boundary set.
      // Once an LLM has confirmed (or human-authored) one of these labels,
      // landing it in canonical_subcategory is permitted.
      expect(isGenericSubcategory('Music')).toBe(false)
      expect(isGenericSubcategory('History')).toBe(false)
    })
  })

  describe('assertSpecificCanonicalSubcategory', () => {
    it('throws GenericCanonicalSubcategoryError on a generic value', () => {
      expect(() => assertSpecificCanonicalSubcategory('other')).toThrow(
        GenericCanonicalSubcategoryError,
      )
      expect(() => assertSpecificCanonicalSubcategory('general_knowledge')).toThrow(
        GenericCanonicalSubcategoryError,
      )
      expect(() => assertSpecificCanonicalSubcategory(null)).toThrow(
        GenericCanonicalSubcategoryError,
      )
    })

    it('passes through a specific value', () => {
      expect(() => assertSpecificCanonicalSubcategory('Bebop')).not.toThrow()
    })
  })
})
