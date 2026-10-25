#!/usr/bin/env python3
"""MyTiffin brand assets, generated from one place.

  python3 brand/build.py        # writes SVGs, then rasterises PNGs/ICO (needs fonttools, Pillow, Playwright+Chromium)

Mark: a tiffin carrier (handle, lid, three stacked tiers, two straps) in white on the brand gradient.
Wordmark: "My" in brand orange + "Tiffin" in ink, set in Inter Display ExtraBold and converted to outlines so it
looks the same on every device (no font needed).
"""
import json, os, subprocess, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, 'public')
BRAND = os.path.join(PUB, 'brand')
os.makedirs(BRAND, exist_ok=True)

ORANGE, AMBER, DEEP = '#F76707', '#F59F00', '#E8590C'
INK, CREAM = '#2A2016', '#FFF7EA'
FONT = '/usr/share/fonts/opentype/inter/InterDisplay-ExtraBold.otf'

GRAD = f'<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{ORANGE}"/><stop offset="1" stop-color="{AMBER}"/></linearGradient>'


def tiffin(stroke_scale=1.0):
    """A tiffin carrier in a 512 box: wide handle, two frame bars, lid and three stacked tiers (white on the brand colour).
    The handle spans the whole body (a shackle narrower than the body reads as a padlock)."""
    k = stroke_scale
    return f'''<g fill="#fff">
    <path d="M118 178C118 108 166 88 256 88s138 20 138 90" fill="none" stroke="#fff" stroke-width="{28 * k:g}" stroke-linecap="round"/>
    <rect x="106" y="168" width="24" height="258" rx="12"/><rect x="382" y="168" width="24" height="258" rx="12"/>
    <circle cx="256" cy="150" r="17"/>
    <rect x="152" y="172" width="208" height="54" rx="27"/>
    <rect x="140" y="234" width="232" height="58" rx="26"/>
    <rect x="140" y="300" width="232" height="58" rx="26"/>
    <rect x="140" y="366" width="232" height="58" rx="26"/>
  </g>'''


def app_icon(rounded=True, scale=1.0):
    r = 116 if rounded else 0
    t = f'<g transform="translate({256 * (1 - scale):g} {256 * (1 - scale):g}) scale({scale:g})">{tiffin()}</g>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="MyTiffin"><title>MyTiffin</title><defs>{GRAD}</defs><rect width="512" height="512" rx="{r}" fill="url(#g)"/>{t}</svg>'


def favicon_svg():
    # fewer, bolder shapes so it still reads at 16 px
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><title>MyTiffin</title><defs>{GRAD}</defs>
  <rect width="512" height="512" rx="112" fill="url(#g)"/>
  <g fill="#fff"><path d="M112 190C112 112 166 84 256 84s144 28 144 106" fill="none" stroke="#fff" stroke-width="34" stroke-linecap="round"/>
  <rect x="96" y="176" width="30" height="262" rx="15"/><rect x="386" y="176" width="30" height="262" rx="15"/>
  <rect x="150" y="196" width="212" height="66" rx="30"/><rect x="150" y="278" width="212" height="66" rx="30"/><rect x="150" y="360" width="212" height="66" rx="30"/></g>
</svg>'''


# ---- wordmark as outlines
font = TTFont(FONT)
upm = font['head'].unitsPerEm
cmap = font.getBestCmap()
gs = font.getGlyphSet()
hmtx = font['hmtx']


def text_paths(text, size, x0, baseline, fills, tracking=-0.015):
    """Returns (svg group markup, end x). fills: dict char-index -> colour."""
    s = size / upm
    x = x0
    out = []
    for i, ch in enumerate(text):
        name = cmap[ord(ch)]
        pen = SVGPathPen(gs)
        gs[name].draw(TransformPen(pen, (s, 0, 0, -s, x, baseline)))
        d = pen.getCommands()
        if d:
            out.append(f'<path fill="{fills[i]}" d="{d}"/>')
        x += hmtx[name][0] * s + tracking * size
    return ''.join(out), x - tracking * size


def lockup(on_dark=False):
    mark = 96
    size, gap = 80, 24
    ink = CREAM if on_dark else INK
    fills = [DEEP, DEEP] + [ink] * 6
    baseline = mark / 2 + (size * 0.727) / 2  # Inter cap height ~0.727em
    paths, end = text_paths('MyTiffin', size, mark + gap, baseline, fills)
    inner = app_icon(True).replace('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="MyTiffin"><title>MyTiffin</title>', f'<svg x="0" y="0" width="{mark}" height="{mark}" viewBox="0 0 512 512">')
    w = round(end)
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {mark}" role="img" aria-label="MyTiffin"><title>MyTiffin</title>{inner}{paths}</svg>', w, mark


def write(path, text):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


icon = app_icon(True)
write(os.path.join(PUB, 'icon.svg'), icon)
write(os.path.join(PUB, 'favicon.svg'), favicon_svg())
write(os.path.join(BRAND, 'mark.svg'), icon)
light, w, h = lockup(False)
dark, _, _ = lockup(True)
write(os.path.join(BRAND, 'logo.svg'), light)
write(os.path.join(BRAND, 'logo-reversed.svg'), dark)
write(os.path.join(BRAND, 'mark-maskable.svg'), app_icon(False, 0.8))
write(os.path.join(BRAND, 'mark-fullbleed.svg'), app_icon(False, 0.92))
print('svg written; lockup', w, 'x', h)

# ---- raster outputs (Chromium renders the SVGs)
jobs = [
    ('public/icon-192.png', 'public/icon.svg', 192, 192, True),
    ('public/icon-512.png', 'public/icon.svg', 512, 512, True),
    ('public/icon-maskable-512.png', 'public/brand/mark-maskable.svg', 512, 512, False),
    ('public/apple-touch-icon.png', 'public/brand/mark-fullbleed.svg', 180, 180, False),
    ('public/favicon-16.png', 'public/favicon.svg', 16, 16, True),
    ('public/favicon-32.png', 'public/favicon.svg', 32, 32, True),
    ('public/favicon-48.png', 'public/favicon.svg', 48, 48, True),
    ('public/brand/mark-1024.png', 'public/icon.svg', 1024, 1024, True),
    ('public/brand/logo.png', 'public/brand/logo.svg', w * 8, h * 8, True),
    ('public/brand/logo-reversed.png', 'public/brand/logo-reversed.svg', w * 8, h * 8, True),
]
write(os.path.join(ROOT, 'brand', 'jobs.json'), json.dumps(jobs))
subprocess.run(['node', os.path.join(ROOT, 'brand', 'rasterize.cjs')], check=True, cwd=ROOT)

from PIL import Image
imgs = [Image.open(os.path.join(PUB, f'favicon-{n}.png')).convert('RGBA') for n in (16, 32, 48)]
imgs[2].save(os.path.join(PUB, 'favicon.ico'), format='ICO', sizes=[(16, 16), (32, 32), (48, 48)], append_images=imgs[:2])
for n in (16, 32, 48):
    os.remove(os.path.join(PUB, f'favicon-{n}.png'))
os.remove(os.path.join(ROOT, 'brand', 'jobs.json'))
print('png + ico written')
