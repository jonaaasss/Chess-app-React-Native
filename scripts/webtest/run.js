// Drives the web test build (scripts/webtest/build.sh) in a phone-sized
// Chromium: node scripts/webtest/run.js <steps.js> [--fresh] [--data <store.json>] [--sharp]
// (--sharp: screenshots at 3× pixel density, to look at small details)
// steps.js exports async (page, h) => { ... }:
//   h.tap('Text')      tap the first element with exactly that text
//   h.shot('name')     screenshot to web-build/shots/name.png
//   h.text()           the visible text of the page
//   h.wait(ms)
//   h.saveStore(file)  write the app's data (the whole store) to a file
// Pressables without text (gear, boards) are tapped with page.mouse.click(x, y).
// The app's data stays in web-build/profile between runs; --fresh starts
// empty (example repertoire only); --data loads a store first (Jonas's data
// from share.js pull) and replaces what was there. A placeholder Lichess
// token is set when there is none: the cloud session's proxy supplies the
// real one.
const { chromium } = require('playwright');

// Where storeFile.web.ts keeps the store.
const STORE_KEY = 'file:chess-flashcards-data.json';
const path = require('path');
const fs = require('fs');

(async () => {
  const steps = require(path.resolve(process.argv[2]));
  const root = path.join(__dirname, '..', '..', 'web-build');
  const profile = path.join(root, 'profile');
  if (process.argv.includes('--fresh')) fs.rmSync(profile, { recursive: true, force: true });
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
  const ctx = await chromium.launchPersistentContext(profile, { viewport: { width: 412, height: 869 }, deviceScaleFactor: process.argv.includes('--sharp') ? 3 : 1, proxy });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('console error', m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 800)));
  const h = {
    shot: async (name) => {
      const p = path.join(root, 'shots', `${name}.png`);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      await page.screenshot({ path: p });
      console.log('shot', p);
    },
    text: async () => page.innerText('body'),
    tap: async (text, opts = {}) => {
      await page.getByText(text, { exact: opts.exact ?? true }).nth(opts.nth ?? 0).click({ timeout: opts.timeout ?? 5000 });
      await page.waitForTimeout(opts.wait ?? 500);
    },
    wait: (ms) => page.waitForTimeout(ms),
    saveStore: async (file) => {
      fs.writeFileSync(file, await page.evaluate((k) => localStorage.getItem(k), STORE_KEY));
      console.log('store saved', file);
    },
  };
  try {
    await page.goto('http://localhost:8765/');
    await page.waitForTimeout(2500);
    // A placeholder Lichess token, so the explorer works (the session's proxy
    // supplies the real one); and the store from --data.
    const dataAt = process.argv.indexOf('--data');
    const hasToken = await page.evaluate(() => !!localStorage.getItem('lichess.token'));
    if (dataAt > 0 || !hasToken) {
      const json = dataAt > 0 ? fs.readFileSync(process.argv[dataAt + 1], 'utf8') : null;
      await page.evaluate(([k, v]) => {
        if (!localStorage.getItem('lichess.token')) localStorage.setItem('lichess.token', 'lip_placeholder');
        if (v) localStorage.setItem(k, v);
      }, [STORE_KEY, json]);
      await page.reload();
      await page.waitForTimeout(2500);
    }
    await steps(page, h);
  } catch (e) {
    console.log('STEP ERROR', String(e).slice(0, 800));
    await h.shot('error');
  }
  await ctx.close();
})();
