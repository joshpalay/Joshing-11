import { chromium, type Browser, type BrowserContext } from 'playwright';

export async function launchBrowser(headed: boolean): Promise<Browser> {
  return chromium.launch({ headless: !headed });
}

export async function contextForPlayer(
  browser: Browser,
  baseUrl: string,
  sessionCookieValue: string,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });

  const url = new URL(baseUrl);
  await context.addCookies([
    {
      name: 'joshing_session',
      value: sessionCookieValue,
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      secure: url.protocol === 'https:',
      sameSite: 'Lax',
    },
  ]);

  return context;
}
