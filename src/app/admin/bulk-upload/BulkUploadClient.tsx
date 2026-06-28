'use client';

import { useState } from 'react';

// Per-line error returned by /api/admin/bulk-upload-questions.
type RowError = { line: number; message: string };

type UploadResult = {
  dryRun: boolean;
  total: number;
  valid?: number;
  invalid?: number;
  created: number;
  skipped?: number;
  rowErrors: RowError[];
};

const SAMPLE_CSV = `question,answer,alternates,explanation,category,subcategory,difficulty
"Which planet is known as the Red Planet?",Mars,,"Iron oxide gives it the colour.",science,Astronomy,1
"Who wrote ""Hamlet""?","William Shakespeare","Shakespeare|Bill Shakespeare",,literature,Shakespeare,moderate`;

// Deliberately minimal — an internal ops tool, not a product surface.
export function BulkUploadClient() {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<'dry' | 'commit' | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A selected file wins over pasted text; otherwise the textarea is the source.
  const hasInput = file !== null || text.trim().length > 0;

  async function submit(dryRun: boolean) {
    if (!hasInput || pending) return;
    setPending(dryRun ? 'dry' : 'commit');
    setError(null);
    setResult(null);
    try {
      const res = file
        ? await fetch('/api/admin/bulk-upload-questions', {
            method: 'POST',
            credentials: 'include',
            body: (() => {
              const form = new FormData();
              form.set('file', file);
              form.set('dryRun', dryRun ? 'true' : 'false');
              return form;
            })(),
          })
        : await fetch('/api/admin/bulk-upload-questions', {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ csv: text, dryRun }),
          });
      const data = (await res.json().catch(() => null)) as (UploadResult & { message?: string }) | null;
      if (!res.ok) {
        setError(data?.message ?? `Upload failed (${res.status}).`);
        setPending(null);
        return;
      }
      setResult(data);
    } catch {
      setError('Upload failed.');
    }
    setPending(null);
  }

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-6">
      <header className="mb-5">
        <h1 className="font-serif text-2xl font-semibold text-[var(--brand-ink)]">Bulk upload questions</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Upload a CSV to create questions in bulk. They are saved as verified, public, and attributed to you.
        </p>
      </header>

      <section className="rounded-md border p-4 text-sm" style={{ borderColor: 'var(--border)' }}>
        <h2 className="font-medium text-[var(--brand-ink)]">CSV format</h2>
        <ul className="text-muted-foreground mt-2 list-disc space-y-1 pl-5">
          <li>
            Required columns: <code>question</code>, <code>answer</code>.
          </li>
          <li>
            Optional: <code>alternates</code> (separate with <code>|</code>), <code>explanation</code>,{' '}
            <code>category</code>, <code>subcategory</code>, <code>difficulty</code> (1–5 or
            accessible/moderate/specialist).
          </li>
          <li>Unknown categories fall back to General Knowledge. Max 1000 rows per upload.</li>
        </ul>
        <pre
          className="mt-3 overflow-x-auto rounded-md border p-3 text-[0.7rem] text-[var(--brand-ink-700)]"
          style={{ borderColor: 'var(--border)', background: 'var(--brand-field)' }}
        >
          {SAMPLE_CSV}
        </pre>
      </section>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setResult(null);
            setError(null);
          }}
          className="min-w-0 flex-1 text-sm"
        />
      </div>

      <div className="mt-3">
        <label htmlFor="csv-text" className="text-muted-foreground mb-1 block text-sm">
          …or paste CSV directly (include the header row)
        </label>
        <textarea
          id="csv-text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResult(null);
            setError(null);
          }}
          rows={8}
          placeholder={SAMPLE_CSV}
          disabled={file !== null}
          className="w-full rounded-md border p-3 font-mono text-[0.75rem] disabled:opacity-50"
          style={{ borderColor: 'var(--border)', background: 'var(--brand-field)' }}
        />
        {file !== null ? (
          <p className="text-muted-foreground mt-1 text-xs">
            A file is selected, so the pasted text is ignored. Clear the file to use the text box.
          </p>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void submit(true)}
          disabled={!hasInput || pending !== null}
          className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ borderColor: 'var(--border)' }}
        >
          {pending === 'dry' ? 'Validating…' : 'Validate (dry run)'}
        </button>
        <button
          type="button"
          onClick={() => void submit(false)}
          disabled={!hasInput || pending !== null}
          className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
        >
          {pending === 'commit' ? 'Uploading…' : 'Upload'}
        </button>
      </div>

      {error ? (
        <p className="mt-3 text-sm" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : null}

      {result ? (
        <section className="mt-4 rounded-md border p-4 text-sm" style={{ borderColor: 'var(--border)' }}>
          <h2 className="font-medium text-[var(--brand-ink)]">
            {result.dryRun ? 'Dry run results' : 'Upload complete'}
          </h2>
          <p className="text-muted-foreground mt-1">
            {result.dryRun ? (
              <>
                {result.valid ?? 0} valid · {result.invalid ?? 0} with errors · {result.total} total rows
              </>
            ) : (
              <>
                Created {result.created} · skipped {result.skipped ?? 0} · {result.total} total rows
              </>
            )}
          </p>
          {result.rowErrors.length > 0 ? (
            <div className="mt-3">
              <p className="font-medium text-[var(--brand-ink)]">Row errors</p>
              <ul className="mt-1 space-y-1">
                {result.rowErrors.map((err) => (
                  <li key={err.line} style={{ color: 'var(--danger)' }}>
                    Line {err.line}: {err.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-2 text-[var(--brand-ink-700)]">No row errors.</p>
          )}
        </section>
      ) : null}
    </main>
  );
}
