import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    // Git worktrees for other branches live under .claude/worktrees/, INSIDE the
    // repo root, so vitest's default glob walks into them and collects every
    // test file once per checked-out branch. Measured 2026-09-11 from the repo
    // root: 2,888 files collected, against 368 real ones — 87% of a run was
    // duplicate copies of other branches.
    //
    // That is not merely slow. It is why full runs failed intermittently at the
    // FILE level (workers timing out under the load) while reporting zero failed
    // assertions, and why reported file/test counts were inflated by roughly 4x.
    // Excluding them took a src/server + src/app + src/lib run from 400s+ to 84s.
    //
    // configDefaults.exclude is spread rather than replaced so node_modules,
    // dist and the rest of vitest's own defaults stay excluded — passing a bare
    // array here would silently drop them.
    //
    // tsc is unaffected: tsconfig.typecheck.json already excludes .claude. ESLint
    // is unaffected too: `npm run lint` is scoped to src/.
    exclude: [...configDefaults.exclude, '**/.claude/worktrees/**'],
  },
});
