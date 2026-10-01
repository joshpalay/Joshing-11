// Prepended to every snippet by run.sh. Daily Five helpers.
// Buttons often carry an aria-label that differs from their visible text
// (Decline -> "Decline friend request from X", topic circles -> "View <topic>
// details", frequency options are role=radio) - prefer getByRole / aria-label
// locators over hasText when a click times out.
const waitIdle = async (max = 45000) => {
  const t0 = Date.now();
  let t = '';
  while (Date.now() - t0 < max) {
    await h.sleep(1500);
    t = await h.text();
    if (!/Grading/.test(t)) break;
  }
  await h.sleep(1200);
  return await h.text();
};
const btns = async () =>
  page.$$eval('button', (b) =>
    b.map((x) => (x.innerText || x.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 50)).filter(Boolean),
  );
const answer = async (a) => {
  await page.getByPlaceholder(/Your answer/).fill(a);
  await page.locator('button', { hasText: /^Answer$/ }).click();
  return await waitIdle();
};
const dots = async () =>
  page.$$eval('[aria-label]', (e) =>
    e.map((x) => x.getAttribute('aria-label')).filter((a) => /^(Question \d|bonus|Bonus|Correct|Skipped|Missed)/.test(a)),
  );

// Design-system probe for the CURRENT screen (_docs/DESIGN-SYSTEM.md). Flags,
// with the element's text so it can be found in a screenshot:
// - misaligned: buttons/links that sit side by side in one row (same parent,
//   overlapping vertically) but whose tops, bottoms or heights differ by > 2px
// - smallTarget: visible tap targets under the 44px touch floor (canon 9)
// - overflow: text clipped or spilling out of its box, and any horizontal page
//   scroll
// - underFixedBar: interactive elements hidden behind a fixed header/nav
// - offSystemFont: computed font family outside Josefin Sans / Cormorant
//   Garamond / Montserrat
// Heuristics, not verdicts: confirm each hit against a screenshot first.
const designAudit = async () =>
  page.evaluate(() => {
    const ALLOWED_FONTS = /josefin|cormorant|montserrat/i;
    const label = (el) => (el.innerText || el.getAttribute('aria-label') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
    };
    const targets = [...document.querySelectorAll('button, a[href], [role=button], input, select, textarea')].filter(visible);
    const out = { misaligned: [], smallTarget: [], overflow: [], underFixedBar: [], offSystemFont: [] };

    const byParent = new Map();
    for (const el of targets) {
      if (!el.parentElement) continue;
      const list = byParent.get(el.parentElement) || [];
      list.push(el);
      byParent.set(el.parentElement, list);
    }
    for (const group of byParent.values()) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i].getBoundingClientRect();
          const b = group[j].getBoundingClientRect();
          const sameRow = a.top < b.bottom && b.top < a.bottom && (a.right <= b.left + 1 || b.right <= a.left + 1);
          if (!sameRow) continue;
          const dTop = Math.abs(a.top - b.top);
          const dBottom = Math.abs(a.bottom - b.bottom);
          const dHeight = Math.abs(a.height - b.height);
          if (dTop > 2 || dBottom > 2 || dHeight > 2) {
            out.misaligned.push(`${label(group[i])} | ${label(group[j])} (top ${Math.round(dTop)}px, bottom ${Math.round(dBottom)}px, height ${Math.round(dHeight)}px)`);
          }
        }
      }
    }

    for (const el of targets) {
      const r = el.getBoundingClientRect();
      if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') continue; // inline text links (canon 3.7)
      if (r.width < 44 || r.height < 44) out.smallTarget.push(`${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }

    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) {
      out.overflow.push(`page scrolls sideways: ${document.documentElement.scrollWidth}px > ${document.documentElement.clientWidth}px`);
    }
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el) || !el.childNodes.length) continue;
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!hasText) continue;
      const s = getComputedStyle(el);
      const clips = s.overflow !== 'visible' || s.textOverflow === 'ellipsis';
      if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && !clips) out.overflow.push(`${label(el)} spills ${el.scrollWidth - el.clientWidth}px`);
      if (s.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 2) out.overflow.push(`${label(el)} truncated with …`);
      const family = s.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      if (family && !ALLOWED_FONTS.test(family) && !out.offSystemFont.some((f) => f.startsWith(family))) {
        out.offSystemFont.push(`${family} (e.g. "${label(el)}")`);
      }
    }

    const fixedBars = [...document.querySelectorAll('header, nav, footer, [class*=fixed], [class*=sticky]')]
      .filter((el) => visible(el) && ['fixed', 'sticky'].includes(getComputedStyle(el).position))
      .map((el) => el.getBoundingClientRect());
    for (const el of targets) {
      const r = el.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= innerHeight) continue;
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const top = document.elementFromPoint(x, y);
      if (top && !el.contains(top) && !top.contains(el) && fixedBars.some((b) => y >= b.top && y <= b.bottom)) {
        out.underFixedBar.push(label(el));
      }
    }
    for (const key of Object.keys(out)) out[key] = [...new Set(out[key])].slice(0, 15);
    return out;
  });
