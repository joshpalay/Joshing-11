# Self-hosted fonts

Loaded by `src/app/layout.tsx` through `next/font/local`. These are Google Fonts'
**latin** subset, **variable** (one file covers the whole weight range), downloaded
2026-09-30 from `fonts.gstatic.com`:

| File | Family | Weights | Style | Google version |
| --- | --- | --- | --- | --- |
| `josefin-sans-latin-100-700.woff2` | Josefin Sans | 100–700 | normal | v34 |
| `montserrat-latin-100-900.woff2` | Montserrat | 100–900 | normal | v31 |
| `cormorant-garamond-latin-500-700.woff2` | Cormorant Garamond | 500–700 | normal | v21 |
| `cormorant-garamond-latin-500-700-italic.woff2` | Cormorant Garamond | 500–700 | italic | v21 |

All three families are licensed under the SIL Open Font License 1.1, which
permits bundling and redistribution with software.

They are self-hosted so a production build never depends on Google Fonts being
reachable or returning a URL shape Turbopack can parse (a 2026-09-30 production
build failed on `/l/font?kit=…&skey=…` URLs). To refresh a file, request the
family's `css2` URL with a modern browser user agent, take the `/* latin */`
block's `src` URL, and replace the file here.
