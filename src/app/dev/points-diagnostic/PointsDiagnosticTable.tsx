'use client';

import { useMemo, useState } from 'react';

import type { PointsDiagnosticRow } from '@/server/db/queries/points-diagnostic';

type SortKey =
  | 'createdAt'
  | 'sourceType'
  | 'answerState'
  | 'sessionContext'
  | 'questionTextSnippet'
  | 'category'
  | 'canonicalSubcategory'
  | 'difficulty'
  | 'correctRate'
  | 'basePoints'
  | 'weight'
  | 'awardedPoints'
  | 'answeredByDisplayName';

type SortDir = 'asc' | 'desc';

type Column = {
  key: SortKey;
  label: string;
  align?: 'left' | 'right';
};

const COLUMNS: Column[] = [
  { key: 'createdAt', label: 'answered_at' },
  { key: 'sourceType', label: 'source' },
  { key: 'answerState', label: 'answer_state' },
  { key: 'sessionContext', label: 'context' },
  { key: 'questionTextSnippet', label: 'question' },
  { key: 'category', label: 'category' },
  { key: 'canonicalSubcategory', label: 'subcategory' },
  { key: 'difficulty', label: 'difficulty' },
  { key: 'correctRate', label: 'correct_rate', align: 'right' },
  { key: 'basePoints', label: 'base', align: 'right' },
  { key: 'weight', label: 'weight', align: 'right' },
  { key: 'awardedPoints', label: 'awarded', align: 'right' },
  { key: 'answeredByDisplayName', label: 'answerer' },
];

const POSITIVE_SOURCES = new Set(['live_correct', 'catchup_correct']);
const AUTHORING_SOURCES = new Set(['authored', 'author_credit', 'curator_credit']);
const META_SOURCES = new Set(['domain_merged', 'declared_promoted']);

function sourceColor(sourceType: string, answerState: string | null): string {
  if (answerState === 'incorrect') return '#a02500';
  if (POSITIVE_SOURCES.has(sourceType)) return '#0a7d2a';
  if (AUTHORING_SOURCES.has(sourceType)) return '#1e40af';
  if (META_SOURCES.has(sourceType)) return '#7c00a0';
  return '#444';
}

function fmtTimestamp(value: string): string {
  return value.replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

function fmtNumber(value: number, digits = 2): string {
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(digits);
}

function fmtRate(value: number | null): string {
  if (value === null) return '—';
  return `${Math.round(value * 100)}%`;
}

function compareValues(a: unknown, b: unknown): number {
  // Nulls sort last regardless of direction (we flip the final result for desc).
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

export function PointsDiagnosticTable({ rows }: { rows: PointsDiagnosticRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const base = compareValues(a[sortKey], b[sortKey]);
      if (base !== 0) return sortDir === 'asc' ? base : -base;
      // Stable tiebreaker by id so re-sorts are deterministic.
      return a.masteryEventId.localeCompare(b.masteryEventId);
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  function clickHeader(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'createdAt' ? 'desc' : 'asc');
    }
  }

  if (rows.length === 0) {
    return (
      <p style={{ color: '#666', fontSize: '13px', padding: '12px 0' }}>
        No mastery events match the current filters.
      </p>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
        <thead>
          <tr style={{ background: '#f4f4f4' }}>
            {COLUMNS.map((col) => {
              const active = col.key === sortKey;
              const arrow = active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
              return (
                <th
                  key={col.key}
                  style={{
                    padding: '6px 8px',
                    textAlign: col.align ?? 'left',
                    fontSize: '11px',
                    whiteSpace: 'nowrap',
                    borderBottom: '1px solid #ddd',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => clickHeader(col.key)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      font: 'inherit',
                      fontWeight: active ? 'bold' : 'normal',
                      color: active ? '#000' : '#444',
                    }}
                  >
                    {col.label}{arrow}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.masteryEventId} style={{ verticalAlign: 'top', borderBottom: '1px solid #f0f0f0' }}>
              <td style={{ padding: '4px 8px', fontFamily: 'monospace', fontSize: '11px', whiteSpace: 'nowrap' }}>
                {fmtTimestamp(row.createdAt)}
              </td>
              <td
                style={{
                  padding: '4px 8px',
                  fontFamily: 'monospace',
                  fontSize: '11px',
                  color: sourceColor(row.sourceType, row.answerState),
                  fontWeight: 'bold',
                  whiteSpace: 'nowrap',
                }}
              >
                {row.sourceType}
              </td>
              <td style={{ padding: '4px 8px', fontFamily: 'monospace', fontSize: '11px', whiteSpace: 'nowrap' }}>
                {row.answerState ?? '—'}
              </td>
              <td style={{ padding: '4px 8px', fontFamily: 'monospace', fontSize: '11px', whiteSpace: 'nowrap' }}>
                {row.sessionContext ?? '—'}
              </td>
              <td style={{ padding: '4px 8px', fontSize: '12px', maxWidth: '420px' }}>
                <div>{row.questionTextSnippet ?? <em style={{ color: '#999' }}>(no question)</em>}</div>
                {row.questionId && (
                  <div style={{ fontFamily: 'monospace', fontSize: '10px', color: '#888' }}>
                    q={row.questionId.slice(0, 8)}…
                  </div>
                )}
              </td>
              <td style={{ padding: '4px 8px', fontSize: '11px', whiteSpace: 'nowrap' }}>
                {row.category ?? '—'}
              </td>
              <td style={{ padding: '4px 8px', fontFamily: 'monospace', fontSize: '11px' }}>
                {row.canonicalSubcategory ?? row.eventCanonicalSubcategory ?? '—'}
              </td>
              <td style={{ padding: '4px 8px', fontSize: '11px', whiteSpace: 'nowrap' }}>
                {row.difficulty ?? '—'}
              </td>
              <td style={{ padding: '4px 8px', fontFamily: 'monospace', fontSize: '11px', textAlign: 'right' }}>
                {fmtRate(row.correctRate)}
              </td>
              <td style={{ padding: '4px 8px', fontFamily: 'monospace', fontSize: '11px', textAlign: 'right' }}>
                {row.basePoints}
              </td>
              <td style={{ padding: '4px 8px', fontFamily: 'monospace', fontSize: '11px', textAlign: 'right' }}>
                {fmtNumber(row.weight)}
              </td>
              <td
                style={{
                  padding: '4px 8px',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  textAlign: 'right',
                  fontWeight: 'bold',
                  color: row.awardedPoints > 0 ? '#0a7d2a' : row.awardedPoints < 0 ? '#a02500' : '#444',
                }}
              >
                {fmtNumber(row.awardedPoints)}
              </td>
              <td style={{ padding: '4px 8px', fontSize: '11px', whiteSpace: 'nowrap' }}>
                {row.answeredByDisplayName ?? (row.answeredByUserId ? <span style={{ fontFamily: 'monospace', color: '#888' }}>{row.answeredByUserId.slice(0, 8)}…</span> : '—')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
