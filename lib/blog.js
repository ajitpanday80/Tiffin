// Server-rendered blog: a tiny Markdown subset -> HTML, plus the page templates.
import { posts } from '../content/posts.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// escape first, then add markup, so post text can never inject HTML
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(((?:\/|https:\/\/)[^)\s]*)\)/g, '<a href="$2">$1</a>');
}

export function md(src) {
  const lines = src.trim().split('\n');
  const out = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = /^(#{2,3}) (.+)/.exec(line))) {
      out.push(`<h${m[1].length} id="${slug(m[2])}">${inline(m[2])}</h${m[1].length}>`);
      i++;
    } else if (/^(- |\d+\. )/.test(line)) {
      const ordered = /^\d/.test(line);
      const items = [];
      while (i < lines.length && /^(- |\d+\. )/.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^(- |\d+\. )/, ''))}</li>`);
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
    } else if (line.startsWith('> ')) {
      const q = [];
      while (i < lines.length && lines[i].startsWith('> ')) q.push(lines[i++].slice(2));
      out.push(`<blockquote>${inline(q.join(' '))}</blockquote>`);
    } else {
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^(#{2,3} |- |\d+\. |> )/.test(lines[i])) para.push(lines[i++]);
      out.push(`<p>${inline(para.join(' '))}</p>`);
    }
  }
  return out.join('\n');
}

const minutes = (p) => Math.max(1, Math.round(p.body.split(/\s+/).length / 200));
const niceDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const AUD = { providers: 'For tiffin providers', customers: 'For customers' };

function page({ title, description, path, body, base, type = 'website' }) {
  const url = `${base}${path}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(url)}">
  <meta property="og:type" content="${type}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(url)}">
  <meta name="theme-color" content="#e8590c">
  <link rel="icon" href="/icon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/site.css">
</head>
<body class="site">
<header class="site-nav"><div class="wrap">
  <a class="brand" href="/"><img src="/icon.svg" alt="">MyTiffin</a>
  <nav class="nav-links" aria-label="Sections"><a href="/find">Find tiffin</a><a href="/blog">Blog</a><a href="/help">Help</a></nav>
  <div class="nav-cta" id="navcta"><a class="btn ghost sm" href="/login">Log in</a><a class="btn primary sm" href="/signup">Get started</a></div>
</div></header>
<main>${body}</main>
<footer class="site"><div class="wrap"><a class="brand" href="/"><img src="/icon.svg" alt="">MyTiffin</a><span><a href="/blog">Blog</a> · <a href="/help">Help</a> · <a href="/find">Find tiffin</a></span></div></footer>
<script src="/site.js"></script>
</body>
</html>`;
}

const card = (p) => `<a class="postcard" href="/blog/${p.slug}">
  <span class="pc-ic">${p.emoji}</span>
  <span class="pc-body"><span class="pc-meta"><span class="aud ${p.audience}">${AUD[p.audience]}</span> · ${minutes(p)} min read</span>
  <strong>${esc(p.title)}</strong><span class="pc-desc">${esc(p.description)}</span></span></a>`;

export function renderIndex(filter, base) {
  const list = posts.filter((p) => !AUD[filter] || p.audience === filter);
  const chip = (key, label) => `<a class="fchip${(AUD[filter] ? filter : '') === key ? ' on' : ''}" href="${key ? `/blog?for=${key}` : '/blog'}">${label}</a>`;
  return page({
    title: 'MyTiffin blog: tips for tiffin providers and customers',
    description: 'Practical guides on running a tiffin service, handling leave and billing, getting customers, and choosing a tiffin.',
    path: '/blog', base,
    body: `<section class="finder"><div class="wrap"><span class="eyebrow">Blog</span><h1>Practical tips for tiffin kitchens and the people they feed</h1>
<p class="lead">Short, honest guides. No hype.</p>
<div class="fchips">${chip('', 'All')}${chip('providers', 'For providers')}${chip('customers', 'For customers')}</div></div></section>
<section class="wrap postlist">${list.map(card).join('\n')}</section>`,
  });
}

export function renderPost(p, base) {
  const related = posts.filter((x) => x !== p && x.audience === p.audience).slice(0, 2);
  const cta = p.audience === 'providers'
    ? `<div class="cta-box"><h3>Run a tiffin service?</h3><p>Keep customers, track deliveries and leave, and get alerts on Telegram. Free for providers and customers.</p><a class="btn primary" href="/signup">Create your free account</a> <a class="btn" href="/help">Read the guide</a></div>`
    : `<div class="cta-box"><h3>Looking for a tiffin near you?</h3><p>Search by location, pincode or address and see who delivers to you, nearest first.</p><a class="btn primary" href="/find">Find a tiffin</a> <a class="btn" href="/help#customers">How customers use it</a></div>`;
  return page({
    title: `${p.title} | MyTiffin`,
    description: p.description,
    path: `/blog/${p.slug}`, base, type: 'article',
    body: `<article class="wrap post">
<a class="back" href="/blog">← All posts</a>
<p class="pc-meta"><span class="aud ${p.audience}">${AUD[p.audience]}</span> · ${niceDate(p.date)} · ${minutes(p)} min read</p>
<h1>${esc(p.title)}</h1>
<p class="lead">${esc(p.description)}</p>
<div class="prose">${md(p.body)}</div>
${cta}
${related.length ? `<h2 class="more">Keep reading</h2><div class="postlist tight">${related.map(card).join('')}</div>` : ''}
</article>`,
  });
}

export const findPost = (s) => posts.find((p) => p.slug === s);
export const postSlugs = () => posts.map((p) => p.slug);
