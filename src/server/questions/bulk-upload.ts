/**
 * Admin bulk CSV question upload — pure parsing + per-row validation.
 *
 * Kept free of DB/LLM/Next imports so it is unit-testable in isolation; the route
 * (`/api/admin/bulk-upload-questions`) calls `parseBulkUploadCsv` and then feeds
 * each validated row straight into `createQuestion`. Admin-only, so we trust the
 * uploader and skip the LLM categorize/vet pipeline the authored route runs —
 * category/subcategory/difficulty come from the CSV (or sane defaults) instead.
 */
import { z } from 'zod';

import {
  broadCategoryDisplayName,
  normalizeBroadQuestionCategoryOrDefault,
  normalizeCanonicalSubcategory,
  type BroadQuestionCategory,
} from '@/lib/question-categorization';
import { MAX_ALTERNATE_ANSWERS } from '@/lib/questions-types';

/** Hard cap on data rows per upload — keeps a single request bounded. */
export const MAX_BULK_UPLOAD_ROWS = 1000;

/** Alternate answers are split on `|` within a single CSV cell. */
export const ALTERNATE_ANSWER_DELIMITER = '|';

/**
 * Canonical column name → accepted header aliases (matched case-insensitively,
 * trimmed, with internal whitespace and `_`/`-` collapsed). `question` and
 * `answer` are required; the rest are optional.
 */
const COLUMN_ALIASES: Record<string, readonly string[]> = {
  question: ['question', 'questiontext', 'q'],
  answer: ['answer', 'answertext', 'correctanswer', 'a'],
  alternates: ['alternates', 'alternateanswers', 'alternatives', 'accepted', 'acceptedalternatives'],
  explanation: ['explanation', 'factualexplanation', 'explainer'],
  category: ['category', 'broadcategory'],
  subcategory: ['subcategory', 'canonicalsubcategory', 'domain', 'topic'],
  difficulty: ['difficulty', 'difficultyestimate', 'level'],
};

const REQUIRED_COLUMNS = ['question', 'answer'] as const;

/** A single fully-validated row, shaped for `createQuestion`. */
export type BulkUploadRow = {
  /** 1-based source line number (header is line 1; first data row is line 2). */
  line: number;
  text: string;
  correctAnswer: string;
  alternateAnswers: string[];
  explanation: string | null;
  category: BroadQuestionCategory;
  broadCategory: string;
  canonicalSubcategory: string;
  /** Numeric difficulty (1=accessible, 3=moderate, 5=specialist) for createQuestion. */
  difficulty: number;
};

export type BulkUploadRowError = { line: number; message: string };

export type BulkUploadParseResult =
  | { ok: false; error: string }
  | { ok: true; rows: BulkUploadRow[]; errors: BulkUploadRowError[] };

function normalizeHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

/**
 * RFC 4180-ish CSV tokenizer: handles quoted fields, `""` escaped quotes,
 * commas and newlines inside quotes, and both LF and CRLF line endings. Returns
 * one string[] per record. A leading UTF-8 BOM is stripped.
 */
export function parseCsvRecords(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let sawAnyChar = false;

  const pushField = () => {
    record.push(field);
    field = '';
  };
  const pushRecord = () => {
    pushField();
    records.push(record);
    record = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    sawAnyChar = true;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      pushField();
    } else if (ch === '\n') {
      pushRecord();
    } else if (ch === '\r') {
      // swallow; the following \n (if any) triggers the record break
    } else {
      field += ch;
    }
  }

  // Flush the final record unless the input ended exactly on a newline (no
  // trailing empty record) or was entirely empty.
  if (field.length > 0 || record.length > 0 || (sawAnyChar && text[text.length - 1] !== '\n' && text[text.length - 1] !== '\r')) {
    pushRecord();
  }

  return records;
}

const rowSchema = z.object({
  question: z.string().trim().min(1, 'question is empty').max(2000, 'question exceeds 2000 characters'),
  answer: z.string().trim().min(1, 'answer is empty').max(1000, 'answer exceeds 1000 characters'),
  alternates: z.string().optional().default(''),
  explanation: z.string().optional().default(''),
  category: z.string().optional().default(''),
  subcategory: z.string().optional().default(''),
  difficulty: z.string().optional().default(''),
});

const DIFFICULTY_WORDS: Record<string, number> = {
  accessible: 1,
  easy: 1,
  moderate: 3,
  medium: 3,
  specialist: 5,
  hard: 5,
};

function parseDifficulty(raw: string): number | { error: string } {
  const value = raw.trim().toLowerCase();
  if (!value) return 3; // default: moderate
  if (value in DIFFICULTY_WORDS) return DIFFICULTY_WORDS[value];
  const n = Number(value);
  if (Number.isInteger(n) && n >= 1 && n <= 5) return n;
  return { error: `difficulty must be 1-5 or accessible/moderate/specialist (got "${raw.trim()}")` };
}

function parseAlternates(raw: string): string[] {
  return raw
    .split(ALTERNATE_ANSWER_DELIMITER)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parse and validate a full CSV upload. A structural problem (no header row, a
 * missing required column, too many rows) fails the whole upload with `ok:false`.
 * Otherwise returns the valid rows plus a per-line error list — callers decide
 * whether to insert the good rows or abort on any error.
 */
export function parseBulkUploadCsv(input: string): BulkUploadParseResult {
  const records = parseCsvRecords(input);
  if (records.length === 0) {
    return { ok: false, error: 'The file is empty.' };
  }

  const headerRow = records[0];
  // Map each canonical column to its index in the header row.
  const headerIndex: Partial<Record<string, number>> = {};
  headerRow.forEach((cell, idx) => {
    const normalized = normalizeHeader(cell);
    for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (headerIndex[canonical] === undefined && aliases.includes(normalized)) {
        headerIndex[canonical] = idx;
      }
    }
  });

  const missing = REQUIRED_COLUMNS.filter((col) => headerIndex[col] === undefined);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Expected a header row with at least "question" and "answer".`,
    };
  }

  const dataRecords = records.slice(1);
  if (dataRecords.length > MAX_BULK_UPLOAD_ROWS) {
    return {
      ok: false,
      error: `Too many rows: ${dataRecords.length}. The limit is ${MAX_BULK_UPLOAD_ROWS} per upload.`,
    };
  }

  const rows: BulkUploadRow[] = [];
  const errors: BulkUploadRowError[] = [];

  dataRecords.forEach((record, idx) => {
    const line = idx + 2; // +1 for header, +1 for 1-based
    // Skip entirely-blank lines (common trailing artifact) silently.
    if (record.every((cell) => cell.trim() === '')) return;

    const cellAt = (col: string): string => {
      const at = headerIndex[col];
      return at === undefined ? '' : (record[at] ?? '');
    };

    const parsed = rowSchema.safeParse({
      question: cellAt('question'),
      answer: cellAt('answer'),
      alternates: cellAt('alternates'),
      explanation: cellAt('explanation'),
      category: cellAt('category'),
      subcategory: cellAt('subcategory'),
      difficulty: cellAt('difficulty'),
    });

    if (!parsed.success) {
      errors.push({ line, message: parsed.error.issues.map((i) => i.message).join('; ') });
      return;
    }

    const data = parsed.data;
    const difficulty = parseDifficulty(data.difficulty);
    if (typeof difficulty !== 'number') {
      errors.push({ line, message: difficulty.error });
      return;
    }

    const alternateAnswers = parseAlternates(data.alternates);
    if (alternateAnswers.length > MAX_ALTERNATE_ANSWERS) {
      errors.push({
        line,
        message: `Too many alternate answers (${alternateAnswers.length}); max is ${MAX_ALTERNATE_ANSWERS}.`,
      });
      return;
    }

    const category = normalizeBroadQuestionCategoryOrDefault(data.category || undefined);
    const broadCategory = broadCategoryDisplayName(category);
    // Fall back to the broad-category label when no specific subcategory is
    // supplied, mirroring how the authored route always writes a non-empty
    // canonicalSubcategory.
    const canonicalSubcategory = data.subcategory.trim()
      ? normalizeCanonicalSubcategory(data.subcategory)
      : broadCategory;

    rows.push({
      line,
      text: data.question.trim(),
      correctAnswer: data.answer.trim(),
      alternateAnswers,
      explanation: data.explanation.trim() || null,
      category,
      broadCategory,
      canonicalSubcategory,
      difficulty,
    });
  });

  return { ok: true, rows, errors };
}
