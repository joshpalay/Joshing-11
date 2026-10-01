// One short desktop pass (1280x800) as account A, reusing A's signed-in session
// from server.cjs. Screenshots DK1..DK7 go to $QA_DIR/shots; prints a
// horizontal-scroll check per page plus any console errors.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { QA_DIR, BASE, PORTS, et } = require('./paths.cjs');

const PAGES = [
  ['/', 'DK1', 'Home'],
  ['/daily/summary', 'DK2', 'Daily summary'],
  ['/friends', 'DK3', 'Friends'],
  ['/knowledge', 'DK4', 'Knowledge'],
  ['/daily/setup', 'DK5', 'Manage topics'],
  ['/users/me', 'DK6', 'Own profile'],
  ['/activities', 'DK7', 'Lately'],
];

(async () => {
  const cdp = await chromium.connectOverCDP('http://127.0.0.1:' + PORTS.A);
  const state = await cdp.contexts()[0].storageState();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    storageState: state,
    viewport: { width: 1280, height: 800 },
    timezoneId: 'America/New_York',
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(page.url().replace(BASE, '') + ' ' + m.text().slice(0, 200));
  });
  const out = [];
  for (const [url, id, caption] of PAGES) {
    await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(QA_DIR, 'shots', id + '.png') });
    const m = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    fs.appendFileSync(path.join(QA_DIR, 'shots.tsv'), `${id}\t${et()} ET\tA\t${url}\tDesktop 1280x800 - ${caption}\n`);
    fs.appendFileSync(path.join(QA_DIR, 'timeline.tsv'), `${et()} ET\tA\t${url}\tDesktop pass: viewed ${caption} at 1280x800\n`);
    out.push(url + ' ' + JSON.stringify(m));
  }
  console.log(out.join('\n') + '\nERRS:\n' + errs.join('\n'));
  await browser.close();
  process.exit(0);
})();
