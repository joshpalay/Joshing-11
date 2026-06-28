import { describe, expect, it } from 'vitest';

import {
  MAX_BULK_UPLOAD_ROWS,
  parseBulkUploadCsv,
  parseCsvRecords,
} from '@/server/questions/bulk-upload';

describe('parseCsvRecords', () => {
  it('parses simple rows', () => {
    expect(parseCsvRecords('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles quoted fields with commas, newlines, and escaped quotes', () => {
    const csv = 'q,a\n"Hello, world","He said ""hi""\nthen left"';
    expect(parseCsvRecords(csv)).toEqual([
      ['q', 'a'],
      ['Hello, world', 'He said "hi"\nthen left'],
    ]);
  });

  it('handles CRLF line endings and a trailing newline', () => {
    expect(parseCsvRecords('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips a leading BOM', () => {
    expect(parseCsvRecords('﻿q,a\n1,2')).toEqual([
      ['q', 'a'],
      ['1', '2'],
    ]);
  });
});

describe('parseBulkUploadCsv', () => {
  it('parses a valid file with required + optional columns', () => {
    const csv = [
      'question,answer,alternates,explanation,category,subcategory,difficulty',
      '"Who wrote Hamlet?","William Shakespeare","Shakespeare|Bill",,"literature","Shakespeare","moderate"',
    ].join('\n');
    const result = parseBulkUploadCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      line: 2,
      text: 'Who wrote Hamlet?',
      correctAnswer: 'William Shakespeare',
      alternateAnswers: ['Shakespeare', 'Bill'],
      explanation: null,
      category: 'literature',
      broadCategory: 'Literature',
      canonicalSubcategory: 'Shakespeare',
      difficulty: 3,
    });
  });

  it('accepts header aliases and is case-insensitive', () => {
    const csv = 'Q,Correct Answer\n"2+2?","4"';
    const result = parseBulkUploadCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]).toMatchObject({ text: '2+2?', correctAnswer: '4' });
  });

  it('fails when required columns are missing', () => {
    const result = parseBulkUploadCsv('question,explanation\nfoo,bar');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('answer');
  });

  it('fails on an empty file', () => {
    const result = parseBulkUploadCsv('');
    expect(result.ok).toBe(false);
  });

  it('defaults category to general_knowledge and difficulty to 3', () => {
    const result = parseBulkUploadCsv('question,answer\n"Q?","A"');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]).toMatchObject({
      category: 'general_knowledge',
      broadCategory: 'General Knowledge',
      canonicalSubcategory: 'General Knowledge',
      difficulty: 3,
    });
  });

  it('maps difficulty words and numbers', () => {
    const csv = [
      'question,answer,difficulty',
      '"Q1","A",accessible',
      '"Q2","A",5',
      '"Q3","A",specialist',
    ].join('\n');
    const result = parseBulkUploadCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((r) => r.difficulty)).toEqual([1, 5, 5]);
  });

  it('reports per-row errors without failing the whole upload', () => {
    const csv = [
      'question,answer,difficulty',
      '"Good?","A",2',
      '"","Missing question",2',
      '"Bad difficulty","A",nine',
    ].join('\n');
    const result = parseBulkUploadCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0].line).toBe(3);
    expect(result.errors[1].line).toBe(4);
    expect(result.errors[1].message).toContain('difficulty');
  });

  it('rejects too many alternate answers', () => {
    const csv = 'question,answer,alternates\n"Q?","A","a|b|c|d|e|f|g"';
    const result = parseBulkUploadCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(0);
    expect(result.errors[0].message).toContain('alternate');
  });

  it('skips entirely-blank lines', () => {
    const csv = 'question,answer\n"Q?","A"\n,\n';
    const result = parseBulkUploadCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });

  it('fails when exceeding the row cap', () => {
    const lines = ['question,answer'];
    for (let i = 0; i < MAX_BULK_UPLOAD_ROWS + 1; i++) lines.push(`"Q${i}","A"`);
    const result = parseBulkUploadCsv(lines.join('\n'));
    expect(result.ok).toBe(false);
  });
});
