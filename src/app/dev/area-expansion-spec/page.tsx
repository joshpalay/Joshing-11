import { readFileSync } from 'node:fs';
import path from 'node:path';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

// Dev-only viewer for the Area Expansion build prompt + its source decision doc.
// Reads the markdown straight off disk at request time (the /dev layout forces
// dynamic) and renders it verbatim in a <pre> — no markdown dependency, and the
// raw source is exactly what a builder wants to read. Fails soft to a notice if
// the source tree isn't present (e.g. a production serverless bundle).

const DOCS: { file: string; label: string }[] = [
  { file: 'B-AREA-EXPANSION-01.md', label: 'B-AREA-EXPANSION-01 (build prompt)' },
  { file: 'D-AREA-EXPANSION-01.md', label: 'D-AREA-EXPANSION-01 (decision doc)' },
];

function readDoc(file: string): string | null {
  try {
    return readFileSync(path.join(process.cwd(), file), 'utf8');
  } catch {
    return null;
  }
}

export default function AreaExpansionSpecPage() {
  const docs = DOCS.map((doc) => ({ ...doc, body: readDoc(doc.file) }));

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 pt-10 pb-28">
      <Link
        href="/users/me"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ChevronLeft className="size-4" />
        Back
      </Link>
      <h1 className="mt-6 font-serif text-3xl leading-tight font-semibold">Area Expansion spec</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        The build prompt for game-end area expansion, plus the decision doc it derives from.
      </p>

      <div className="mt-10 flex flex-col gap-10">
        {docs.map((doc) => (
          <section key={doc.file}>
            <h2 className="mb-3 font-mono type-eyebrow font-semibold tracking-eyebrow uppercase">
              {doc.label}
            </h2>
            {doc.body ? (
              <pre className="bg-card text-card-foreground overflow-x-auto rounded-xl border p-5 text-xs leading-5 whitespace-pre-wrap">
                {doc.body}
              </pre>
            ) : (
              <div className="bg-card text-card-foreground rounded-xl border p-8 text-center">
                <p className="font-serif text-lg font-semibold">{doc.file} not found</p>
                <p className="text-muted-foreground mt-1 text-sm">
                  The doc isn&rsquo;t present in this build&rsquo;s source tree. Read it from the repo
                  root instead.
                </p>
              </div>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
