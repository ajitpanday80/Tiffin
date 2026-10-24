// Usage: node promo/render.cjs <provider|customer> <v|l> [--stills]
// Renders promo/video.html frame by frame (30 fps) and encodes promo/out/<video>-<aspect>.mp4 with ffmpeg.
// --stills only writes a handful of preview PNGs to promo/out/stills/ (fast check, no video).
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const [video = 'provider', aspect = 'v'] = process.argv.slice(2);
const stillsOnly = process.argv.includes('--stills');
const FPS = 30;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/promo/video.html?v=${video}&a=${aspect}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: aspect === 'v' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 } });
  page.on('pageerror', (e) => console.error('PAGEERROR', e.message));
  page.on('console', (m) => m.type() === 'error' && console.error('console', m.text()));
  await page.goto(url);
  const { dur } = await page.evaluate(() => window.ready);
  const name = `${video}-${aspect === 'v' ? 'vertical' : 'landscape'}`;
  fs.mkdirSync(path.join(__dirname, 'out', 'stills'), { recursive: true });

  if (stillsOnly) {
    for (const t of (process.env.STILLS ? process.env.STILLS.split(',').map(Number) : [1.5, 4.5, 7, 11.4, 13.5, 17, 19.5, 21.8, 26, 31.5, 37])) {
      if (t > dur) continue;
      await page.evaluate((x) => window.seek(x), t);
      await page.screenshot({ path: path.join(__dirname, 'out', 'stills', `${name}-${String(t).replace('.', '_')}.png`) });
    }
  } else {
    const out = path.join(__dirname, 'out', `${name}.mp4`);
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-shortest', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((r) => ff.on('close', r));
    const frames = Math.round(dur * FPS);
    for (let i = 0; i < frames; i++) {
      await page.evaluate((x) => window.seek(x), i / FPS);
      const buf = await page.screenshot({ type: 'jpeg', quality: 93 });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      if (i % 150 === 0) console.log(`${name}: ${i}/${frames}`);
    }
    ff.stdin.end();
    await done;
    await page.evaluate((x) => window.seek(x), Math.min(dur - 0.2, 11.4));
    console.log('wrote', out);
  }
  await browser.close();
  server.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
