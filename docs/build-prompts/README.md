# Build prompts — implementation log (NOT product spec)

> **This directory holds execution instructions, not product documentation.** The staged build prompts
> are how the restructure was *built*; they are kept here as an implementation log. For *what the
> product is and why*, read [`PRD-D-0-PRODUCT-DIRECTION-AND-DECISIONS.md`](../../PRD-D-0-PRODUCT-DIRECTION-AND-DECISIONS.md)
> and the `PRD-D-1/2/3` specs — **not** these prompts. Prompts go stale the moment the code merges;
> do not treat them as current spec.

## What lives here

- *(none of the staged prompt bodies are filed yet — see "Not yet filed" below)*

## Already in the repo (root)

- [`B-Friends-prompts-revised.md`](../../B-Friends-prompts-revised.md) — the B-Friends build prompts
  (P0-A…P0-D, B-Friends-1…4), already committed at repo root before this filing. Left in place to avoid
  breaking references; logged here for discoverability. Move it under this directory only if you want
  all build prompts colocated.

## Not yet filed (source content needed)

The filing task asked to include these under a clearly-separate path. They were **not present in the
repo and their bodies were not provided**, so they have not been filed (I will not fabricate execution
prompts). Drop the source text here and they'll slot in:

- The **staged build prompts** — D-1 / D-2 / D-3 stage prompts and **B-1 … B-8**.
- The **investigation prompts** — the "cheeky-context" investigation prompts.

Suggested layout once content is available:

```
docs/build-prompts/
  README.md            (this file)
  d1/ d2/ d3/          (staged D-1/D-2/D-3 build prompts)
  b1..b8/              (B-1 … B-8 build prompts)
  investigation/       (cheeky-context investigation prompts)
```
