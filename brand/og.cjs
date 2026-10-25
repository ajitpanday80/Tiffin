// Renders brand/og.html -> public/og-image.png (1200x630 social share image). Run after promo/build-assets.cjs.
const { chromium } = require('playwright');
const path = require('node:path');
(async () => {
  const b = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await p.goto(`file://${path.join(__dirname, 'og.html')}`);
  await p.waitForLoadState('networkidle');
  await p.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  await p.screenshot({ path: path.join(__dirname, '..', 'public', 'og-image.png') });
  await b.close();
})();
