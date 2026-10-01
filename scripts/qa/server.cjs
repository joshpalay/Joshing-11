// Long-lived headless phone browsers, one per test account (A/B/C), each its own
// persistent profile so all three stay signed in at once. Reachable over CDP by
// qa.cjs. Logs console errors/warnings, page errors, 4xx/5xx responses and
// dialogs (auto-accepted) to $QA_DIR/console.log.
//
//   node scripts/qa/server.cjs      # run in the background for the whole session
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { QA_DIR, PORTS, et } = require('./paths.cjs');

const logLine = (s) => fs.appendFileSync(path.join(QA_DIR, 'console.log'), s + '\n');

(async () => {
  for (const [acct, port] of Object.entries(PORTS)) {
    const ctx = await chromium.launchPersistentContext(path.join(QA_DIR, 'profile-' + acct), {
      headless: true,
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      timezoneId: 'America/New_York',
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      args: ['--remote-debugging-port=' + port],
    });
    const hook = (page) => {
      const u = () => { try { return new URL(page.url()).pathname; } catch { return page.url(); } };
      page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning')
          logLine(`${et()} ET\t${acct}\t${u()}\t${m.type()}\t${m.text().slice(0, 400)}`);
      });
      page.on('pageerror', (e) => logLine(`${et()} ET\t${acct}\t${u()}\tpageerror\t${String(e).slice(0, 400)}`));
      page.on('response', (r) => {
        if (r.status() >= 400 && r.url().includes('joshing-11'))
          logLine(`${et()} ET\t${acct}\t${u()}\thttp ${r.status()}\t${r.request().method()} ${new URL(r.url()).pathname}`);
      });
      page.on('dialog', async (d) => {
        logLine(`${et()} ET\t${acct}\t${u()}\tdialog ${d.type()}\t${d.message()}`);
        await d.accept();
      });
    };
    ctx.pages().forEach(hook);
    ctx.on('page', hook);
    if (ctx.pages().length === 0) await ctx.newPage();
    console.log('up', acct, port, QA_DIR);
  }
  setInterval(() => {}, 1 << 30);
})();
