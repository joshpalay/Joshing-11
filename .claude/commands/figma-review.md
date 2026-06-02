---
description: Compare a running screen against its Figma frame (fonts, colors, spacing) and report drift.
argument-hint: <route> (e.g. /login) — then paste the Figma link or exact CSS spec
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

Do a Figma-fidelity review of the screen at route `$ARGUMENTS` against its Figma
frame. Goal: every **font, color, and spacing** value in the running app must
match the Figma. Report drift. **Do not change code unless I explicitly say so** —
show me the comparison first.

## Source of truth for the Figma spec
Use whichever applies (I will have provided one in my message):
- If a **Figma Dev Mode MCP** is connected, pull the frame's spec directly
  (typography, fills, effects, auto-layout padding/gap) from the node link I pasted.
- Otherwise, use the **exact CSS / token values** or the **reference screenshot** I
  pasted. If I gave you neither, ask me for the frame link or the spec before
  proceeding — don't guess from memory.

## Run the app (this repo's quirks)
- If `node_modules` is missing, run `npm install` first.
- `src/instrumentation.ts` wraps DB setup in try/catch, so `next dev` boots without a
  real database. If boot needs env, create a throwaway `.env.local`
  (`DATABASE_URL=postgres://localhost:5432/nope`, `NODE_ENV=development`) and
  **delete it when done**.
- Start `next dev` in the background; poll `http://localhost:3000$ARGUMENTS` for
  HTTP 200 before screenshotting.
- When finished: stop the dev server, restore any auto-generated files
  (e.g. `next-env.d.ts` — `git checkout -- next-env.d.ts`), and confirm
  `git status` is clean.

## Capture computed styles (not just a screenshot)
- Use **Playwright** (installed; chromium at `/opt/pw-browsers`). Render the route at
  the Figma frame's viewport width — state which width you used (e.g. 390px mobile).
- For each text/element in the design, read `getComputedStyle` and report the ACTUAL
  values: `font-family`, `font-size`, `font-weight`, `line-height`, `letter-spacing`,
  `text-transform`, `color`, `background`, `border`, `box-shadow`, plus the
  margins / paddings / gaps that produce the spacing.
- Save the screenshot to a file and include the path in your report.

## Compare and report
Produce a table per element: **Element | Property | Figma | App | Match?**
- **Colors:** compare resolved hex/rgb, accounting for CSS variables (e.g.
  `--tri-amber` = `#d9a82e`, `--brand-navy` = `#1f3a5a` in `src/app/globals.css`).
  Flag any hardcoded hex that should be an existing token.
- **Fonts:** confirm the rendered `font-family`, size, weight, line-height, and
  letter-spacing in px.
- **Spacing:** confirm padding / gap / margin in px against the Figma auto-layout.

End with:
1. A **Drift** list — only the mismatches, ranked by visibility.
2. A proposed fix for each, **reusing existing tokens in `src/app/globals.css`**
   where possible rather than introducing new hardcoded values.
3. A verdict: **PASS** if everything matches, otherwise the drift list.

Show me the screenshot and the table before making any edits.
