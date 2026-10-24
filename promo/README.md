# Promo and instruction videos

## Promo videos

Two videos, each in vertical (1080×1920, for Reels / Shorts / WhatsApp status) and landscape (1920×1080, for YouTube / the website):

| Video | Length | Story |
| --- | --- | --- |
| `provider` | ~40 s | Cooked for someone not home → today's box count → tap Delivered → customers mark their own leave + Telegram alert → month-end report → get found nearby → *Free for tiffin providers* |
| `customer` | ~34 s | Going out of town → mark leave in 10 s → provider told instantly → find a tiffin near you → call / WhatsApp / join → *Free for customers* |

Everything on the phone screens is the **real app** (captured from a seeded demo kitchen), not mockups. The Telegram message uses the real bot text and the real box counts from that demo data. Names, addresses and prices in the demo are made up.

## Instruction (how-to) videos

Step-by-step walkthroughs with a "STEP n OF m" label and a progress bar, in the same two formats:

| Video | Length | Steps |
| --- | --- | --- |
| `provider-howto` | ~96 s | 1 account · 2 add customers · 3 prices & closed days · 4 Today · 5 tick deliveries · 6 leave & the customer's link · 7 reports · 8 Grow (listing & ads) · 9 connect Telegram |
| `customer-howto` | ~64 s | 1 get a login · 2 mark leave · 3 cancel leave · 4 find a tiffin · 5 request to join |

They use the same real-app capture method. The Telegram chat screen is an illustration of the conversation using the app's real bot wording, and the Telegram step shows the placeholder bot name `@YourTiffinBot`: re-record it with your real bot name once you have created it (see `build-assets-howto.cjs`).

## Regenerate

```bash
npm install --no-save playwright   # if Playwright is not already available
node promo/build-assets.cjs        # (promo + shared screens) seeds a demo kitchen on a throwaway server, captures screenshots -> promo/assets/
node promo/build-assets-howto.cjs  # (extra screens for the how-to videos)
node promo/render.cjs provider v   # -> promo/out/provider-vertical.mp4   (use `l` for landscape, `customer` for the other video)
node promo/render.cjs provider v --stills   # quick preview PNGs only
```

Needs `ffmpeg` and Chromium. A video takes about 5 minutes to render (it screenshots every frame).

## Edit

All text, timings, zoom/camera moves, tap ripples and highlight rings live in `defs()` in `promo/video.html`. Times are in seconds. Change a caption, re-run `render.cjs`.

## Notes

- The videos are **silent with captions** (they carry a silent audio track so social platforms accept them). Add a voice-over or licensed music in any editor, or with ffmpeg: `ffmpeg -i video.mp4 -i music.mp3 -shortest -c:v copy -map 0:v -map 1:a out.mp4`. Only use music you have the rights to.
- The masters in `promo/out/` are git-ignored (large). Small 720p web copies used by the landing page and `/help` are in `public/videos/` (made with `ffmpeg -i master.mp4 -vf scale=720:1280 -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p -an -movflags +faststart out.mp4`).
- Demo kitchen names, addresses, prices and counts are made up for the videos.
