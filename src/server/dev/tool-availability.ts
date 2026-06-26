import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

// Route-exists check for the Developer-tools section (AccountActions). Each dev
// tool links to an App Router page; this scans the filesystem for the pages
// that actually exist so the UI can dim tools whose route hasn't been built
// (or has been removed). Returns the set of hrefs that resolve to a real page.
//
// FAIL OPEN: returns `null` on any error. In a production serverless bundle the
// `src/app` source tree may not be present at runtime, and we never want to
// hide a working tool because the scan couldn't read the source — the caller
// treats `null` as "assume everything is available". The check is therefore
// most meaningful in dev/preview, which is exactly where a WIP tool whose route
// doesn't exist yet would be added.

const PAGE_FILES = ['page.tsx', 'page.ts', 'page.jsx', 'page.js'];

function hasPage(dir: string): boolean {
  return PAGE_FILES.some((file) => existsSync(path.join(dir, file)));
}

export function getExistingDevToolHrefs(): string[] | null {
  try {
    const appDir = path.join(process.cwd(), 'src', 'app');
    const devDir = path.join(appDir, 'dev');
    const hrefs: string[] = [];

    // Every `/dev/<name>` route folder that contains a page.
    for (const entry of readdirSync(devDir, { withFileTypes: true })) {
      if (entry.isDirectory() && hasPage(path.join(devDir, entry.name))) {
        hrefs.push(`/dev/${entry.name}`);
      }
    }

    // The one dev tool that lives outside /dev (the expansion-offer card
    // preview is nested under the real daily-summary route).
    if (hasPage(path.join(appDir, 'daily', 'summary', 'expand-preview'))) {
      hrefs.push('/daily/summary/expand-preview');
    }

    // Nested onboarding-harness stage. The /dev/onboarding hub page was
    // consolidated into the profile dev-tools section, so its parent folder no
    // longer has its own page — but the dev-tools UI still links straight to the
    // setup/areas replay one level deeper.
    if (hasPage(path.join(devDir, 'onboarding', 'intro'))) {
      hrefs.push('/dev/onboarding/intro');
    }

    return hrefs;
  } catch {
    return null;
  }
}
