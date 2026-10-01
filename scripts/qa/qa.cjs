// Run a snippet of async JS against one account's browser (started by server.cjs).
//
//   bash scripts/qa/run.sh A <<'X'
//   await h.go('/friends'); h.log('A viewed Friends'); await h.shot('F01', 'A friends'); return await h.text();
//   X
//
// `h` helpers: go(url), text(sel), shot(id, caption, {full}), click(name, opts),
// api(url, fetchOpts), login(phone), log(msg) (→ timeline.tsv), out(...).
// Screenshots land in $QA_DIR/shots with captions in shots.tsv.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { QA_DIR, BASE, PORTS, et } = require('./paths.cjs');

const acct = process.argv[2];
if (!PORTS[acct]) {
  console.error('usage: node qa.cjs <A|B|C> < snippet.js');
  process.exit(2);
}
const code = fs.readFileSync(0, 'utf8');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORTS[acct]);
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];
  page.setDefaultTimeout(15000);
  const out = [];
  const p = () => {
    try {
      const u = new URL(page.url());
      return u.pathname + u.search.replace(/token=[^&]+/i, 'token=…');
    } catch {
      return page.url();
    }
  };
  const h = {
    page, ctx, BASE,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log(msg) {
      const line = `${et()} ET\t${acct}\t${p()}\t${msg}`;
      fs.appendFileSync(path.join(QA_DIR, 'timeline.tsv'), line + '\n');
      out.push('LOG ' + line);
    },
    async go(url, wait = 2500) {
      await page.goto(url.startsWith('http') ? url : BASE + url, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(wait);
    },
    async text(sel = 'body') {
      return (await page.locator(sel).first().innerText()).replace(/\n{2,}/g, '\n');
    },
    async shot(id, caption, opts = {}) {
      await page.screenshot({ path: path.join(QA_DIR, 'shots', id + '.png'), fullPage: !!opts.full });
      fs.appendFileSync(path.join(QA_DIR, 'shots.tsv'), `${id}\t${et()} ET\t${acct}\t${p()}\t${caption}\n`);
      out.push('SHOT ' + id);
    },
    async click(name, opts = {}) {
      const loc = page.getByRole(opts.role || 'button', { name, exact: !!opts.exact });
      await loc.first().scrollIntoViewIfNeeded();
      await loc.first().click();
      await page.waitForTimeout(opts.wait ?? 1500);
    },
    async api(url, opt = {}) {
      return page.evaluate(async ([url, opt]) => {
        const r = await fetch(url, Object.assign({ headers: { 'content-type': 'application/json' } }, opt));
        return r.status + ' ' + (await r.text()).slice(0, 3000);
      }, [url, opt]);
    },
    // Fast account switch via the API (use the real login screen once per account for coverage).
    async login(phone) {
      await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
      const r = [];
      r.push(await h.api('/api/account/logout', { method: 'POST' }));
      r.push(await h.api('/api/auth/request-otp', { method: 'POST', body: JSON.stringify({ phone }) }));
      r.push(await h.api('/api/auth/verify-otp', { method: 'POST', body: JSON.stringify({ phone, code: '000000' }) }));
      return r.join('\n');
    },
    out: (...a) => out.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x, null, 1))).join(' ')),
  };
  try {
    const fn = new Function('h', 'page', `return (async()=>{ ${code}\n })()`);
    const res = await fn(h, page);
    if (res !== undefined) out.push(typeof res === 'string' ? res : JSON.stringify(res, null, 1));
  } catch (e) {
    out.push('ERROR: ' + (e && e.message ? e.message.split('\n').slice(0, 6).join('\n') : e));
    try { await h.shot('err-' + Date.now(), 'error state'); } catch {}
  }
  console.log(out.join('\n'));
  // Disconnect only; server.cjs keeps the browser (and its session) alive.
  process.exit(0);
})();
