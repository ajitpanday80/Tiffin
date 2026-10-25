// Renders SVGs to PNG with Chromium. Reads brand/jobs.json: [[outPng, srcSvg, width, height, transparent], ...]
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
(async () => {
  const jobs = JSON.parse(fs.readFileSync(path.join(__dirname, 'jobs.json'), 'utf8'));
  const browser = await chromium.launch();
  for (const [out, src, w, h, transparent] of jobs) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const svg = fs.readFileSync(path.join(ROOT, src), 'utf8');
    await page.setContent(`<body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${w}" height="${h}" `)}</body>`);
    await page.screenshot({ path: path.join(ROOT, out), omitBackground: !!transparent === true || true, clip: { x: 0, y: 0, width: w, height: h } });
    await page.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
