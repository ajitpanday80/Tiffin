# 🍱 MyTiffin

A light, mobile-first web app for tiffin providers.

- **Provider app** (`/app`): customers (name, address, phone, Normal/Deluxe, boxes per day), a daily "how many to cook" count, one-tap *Delivered* checklist, leave management, monthly reports (CSV + WhatsApp summary).
- **Customer portal** (`/me`): customers log in with their phone number + password and mark their own leave. A personal passwordless link (`/c/<token>`) also works.
- **Telegram bot**: instant alert when a customer takes or cancels leave, plus morning/evening summaries and `/today`, `/tomorrow`, `/pending`.
- **Marketplace** (`/find`): customers find tiffin services nearest-first by GPS, pincode or address, then call, WhatsApp or send a *request to join* that lands in the provider's inbox (one tap to add as a customer).
- **Advertising**: listing is free; providers can pay for a *Sponsored* spot that only shows to customers near them. Platform admin console at `/admin`.
- **Website** (`/`) with login / sign-up (`/login`, `/signup`), a **help guide** (`/help`: provider quick start, Telegram setup, customer guide) and a **blog** (`/blog`, 8 posts in `content/posts.js`, server-rendered, with `/sitemap.xml` and `/robots.txt`).
- Phone + password accounts, sessions last **30 days** (sliding). Many providers can share one install; each only sees their own data.

No dependencies, no build step, one JSON file for data. Needs **Node 18 or newer** (tested on 18.19 and 22).

## Run it

```bash
npm start            # http://localhost:3000
npm test             # API tests
```

| Variable | Purpose |
| --- | --- |
| `PORT` | default `3000` |
| `HOST` | address to listen on (default `0.0.0.0`; use `127.0.0.1` behind a local HTTPS proxy) |
| `TZ` | **Your timezone**, e.g. `Asia/Kolkata` (the default). "Today" and the Telegram summary times follow it. |
| `DATA_DIR` | where `db.json` lives (default `./data`). Put this on a **persistent disk**. |
| `TELEGRAM_BOT_TOKEN` | optional, enables Telegram alerts. The site then confirms the bot's real `@username` with Telegram and links to it in Settings, Help and the blog |
| `TELEGRAM_BOT_USERNAME` | the bot's username shown on the site, without the @ (default `tiffincrm_bot`). If the token belongs to a different bot, the real username reported by Telegram is shown instead |
| `COUNTRY` | ISO country code that biases pincode/address lookups (default `in`) |
| `FORCE_HTTPS` | set to `1` when behind a proxy that sets `X-Forwarded-Proto`: plain-http requests are redirected to https |
| `PUBLIC_URL` | public address (e.g. `https://tiffin.example.com`) used in the blog's canonical links and sitemap; defaults to the request host |
| `GEOCODER` | set to `off` to disable address/pincode geocoding (pincode matching still works) |
| `TELEGRAM_API_BASE` | Telegram API address; only for tests (they point it at a fake server). Leave unset. |
| `GEOCODER_CONTACT` | your email/URL, sent in the geocoder User-Agent (OpenStreetMap asks for this) |

## Telegram setup (5 minutes)

Providers get a friendlier version of this in the app at `/help#telegram`; the owner steps are at `/help#telegram-owner`.


1. In Telegram, message **@BotFather** → `/newbot`. Choose a name and a username ending in `bot` (this project uses **@tiffincrm_bot**) → copy the token.
2. Start the server with `TELEGRAM_BOT_TOKEN=<token>`.
3. Each provider opens **Settings → Telegram**, finds the bot, and sends the `/start CODE` shown there. Done; use *Send test* to check.

One bot serves all providers; the code ties a chat to one provider.

## Marketplace and advertising

**Search.** A customer can use GPS, or type a pincode / address. Typed places are geocoded (OpenStreetMap Nominatim, cached in the database, throttled to 1 request/second). If the geocoder is down or off, search falls back to providers who list that exact pincode, or a nearby one (same first 3 digits), without distances. A provider appears only if the customer is inside its delivery radius (1-25 km) or it lists the customer's pincode.

**Ads are local by construction.** An ad gives a provider a *Sponsored* slot (max 2 per search, nearest advertisers first) only when the customer is within **both** the provider's delivery radius **and** the ad radius of the plan it bought. In pincode-only mode an ad needs an exact pincode match. Nobody far away is ever shown an ad. Ads are flat-fee per plan (no per-click billing); impressions, call/WhatsApp taps and join requests are counted per provider and shown to them.

**Plans and payment.** There is no payment gateway in this app, so I did not invent prices: you create the plans (name, days, radius, price) in `/admin`. A provider orders a plan, gets your payment instructions plus a reference code, pays you outside the app, and you press *Payment received*, which starts the ad (queued after any ad already running). Integrating a gateway (e.g. Razorpay/Stripe) needs your merchant credentials and is the natural next step.

**Admin.** Create the admin account on the server (it cannot be created from the website):
`node scripts/make-admin.js 98xxxxxxxx 'a-long-password'`, restart, then sign in at `/login?role=admin`. Admin can add plans, confirm/reject orders, and suspend a listing.

**Privacy.** Providers' public location is rounded to about 1 km before it is stored, and customers only see distance in 0.5 km steps, so repeated searches cannot pinpoint a home kitchen. Customer searches (coordinates) are not stored. The text a customer types is sent to OpenStreetMap's geocoder. **The public Nominatim server has a usage policy (max 1 request/s, no heavy use); for real traffic, use a paid or self-hosted geocoder** (swap it in `lib/geo.js`).

## Install on your server (`/root/tiffin`) with `mytiffin.online`

On the server (Linux with systemd and Node 18+), as root. Clone straight into `/root/tiffin` and run the installer from there:

```bash
git clone -b claude/happy-gauss-j00emo https://github.com/ajitpanday80/Tiffin.git /root/tiffin   # or your merged main branch
cd /root/tiffin && sudo bash deploy/install.sh
```

There is no `npm install` step (no dependencies). The installer creates `/root/tiffin/.env` (mode 600) from `deploy/env.example` and starts the app as the `tiffin` systemd service (restarts automatically, starts on boot). Re-running it deploys an update and never overwrites `/root/tiffin/data` or `.env`. Data lives in `/root/tiffin/data/db.json`. (If you cloned somewhere else, the installer copies the app into `/root/tiffin` for you.)

**Already running other apps on this server?** Check two things before going live:
- **Port:** the app listens on `127.0.0.1:3000`. If another program uses 3000, the installer stops and tells you; set `PORT=` in `/root/tiffin/.env` (e.g. `3100`) and use the same port in your proxy config.
- **Web server:** if nginx or Apache already owns ports 80/443, do **not** install Caddy. Use `deploy/nginx.conf.example` (step 3).

1. **Edit `/root/tiffin/.env`**: set `GEOCODER_CONTACT` to your email, and `TELEGRAM_BOT_TOKEN` if you want Telegram. Then `systemctl restart tiffin`. The defaults already set `PUBLIC_URL=https://mytiffin.online`, `FORCE_HTTPS=1`, `TZ=Asia/Kolkata` and `HOST=127.0.0.1`, which keeps the app reachable only through the HTTPS proxy.
2. **DNS:** `A` records for `mytiffin.online` and `www` pointing at the server.
3. **HTTPS (required):** browsers only allow the marketplace's GPS button, service workers and "install to home screen" over HTTPS, and passwords must not travel in plain text.
   - *Nothing else uses 80/443:* install [Caddy](https://caddyserver.com/docs/install), copy `deploy/Caddyfile` to `/etc/caddy/Caddyfile`, `systemctl reload caddy`. Caddy gets and renews the certificate itself.
   - *nginx already runs here:* copy `deploy/nginx.conf.example` to `/etc/nginx/sites-available/mytiffin.online`, symlink it into `sites-enabled`, `nginx -t && systemctl reload nginx`, then `certbot --nginx -d mytiffin.online -d www.mytiffin.online`. The file overwrites `X-Forwarded-For` and sets `X-Forwarded-Proto`; the app needs both (login rate limiting and secure cookies).
4. **Admin login:** `cd /root/tiffin && node scripts/make-admin.js <phone> '<long password>' && systemctl restart tiffin`, then sign in at `https://mytiffin.online/login?role=admin`.
5. **Updating later:** `cd /root/tiffin && git pull && sudo bash deploy/install.sh` (keeps your data and `.env`).
6. **Day to day:** `journalctl -u tiffin -f` (logs), `systemctl restart tiffin`, and back up `/root/tiffin/data/db.json` (e.g. a nightly copy off the server).
7. **Run the tests (optional):** `npm test` (works on Node 18+; it needs a free local port and does not touch your data).

The service runs as root because the path is under `/root`; it is sandboxed with `NoNewPrivileges`, `ProtectSystem=strict` and a write-access list limited to the data folder. A dedicated unprivileged user (e.g. `/opt/tiffin`) would be safer if you can change the location.

Tested here: the whole test suite on Node 18.19.1 and 22, the installer's copy/permission/update/port-conflict behaviour, and that the installed copy serves, redirects http to https and listens only on localhost. **Not tested** (no access to your server): systemd, Caddy, nginx/certbot and your real domain. After deploying, check `https://mytiffin.online`, `/sitemap.xml` (https URLs), sign-up, and the marketplace GPS button.

## Deploying

Any host that runs Node with a persistent disk works (a small VPS, Fly.io volume, Railway volume, etc.). Put it behind **HTTPS** (the session cookie is marked `Secure` when the proxy sends `X-Forwarded-Proto: https`). Back up `DATA_DIR/db.json` (a copy of the previous version is kept as `db.backup.json` on each start). A host with an ephemeral disk will lose all data on restart.

## How accounts work (read this)

- A provider signs up with phone + password + service name.
- A **customer can only sign up with a phone number a provider already saved** for them (last 10 digits are compared). They then see every provider who has that number.
- **Known weakness:** whoever knows a customer's number can create the account *before* the real customer does, and could then mark leave for them. Impact is limited to leave days (no payments or addresses are exposed), and providers can see leave changes, but it is real. The personal `/c/<token>` link avoids this since the secret is sent only to the customer.
- **Password recovery** (there is no SMS/email integration, so it relies on channels we already have):
  - *Providers:* "Forgot password?" sends a 6-digit code to the Telegram chat they connected in Settings (valid 10 minutes, 5 tries, rate limited). The answer is the same whether or not the number exists. Providers without Telegram connected cannot use this, so tell them to connect it.
  - *Customers, same bot:* on the **My tiffin** page a customer can connect their own Telegram (their own code, shown only while logged in) and then use the same "Forgot password?" flow. The connected bot also answers `/status` with today's tiffin. Customers without Telegram: their provider opens the customer and taps **Create reset link**, then sends the one-time link (24 h) on WhatsApp. That is allowed only when that login belongs to that provider alone, so a provider can never take over an account that also covers other providers.
  - *Anyone, fallback:* the administrator creates a one-time link (1 h) under **Admin → Reset login** after checking the person's identity by hand, and can publish a support contact (**Admin → Payment & support**) that is shown on the forgot-password page.
  - Last resort on the server: `node scripts/reset-password.js <provider|customer> <phone> <new-password>`.
  - Every reset signs the account out everywhere. Reset links and codes are single use. Adding SMS/WhatsApp OTP later needs a provider account (e.g. Twilio, MSG91) and is the natural next step for customers.
  `node scripts/reset-password.js provider 9811100001 newpassword`
- Failed logins are rate-limited per phone and per IP (this also means someone can temporarily lock a number out).

## Brand assets

Logo, favicon and app icons are generated from one script, so they always match:

```bash
pip install fonttools Pillow        # one-time (Playwright + Chromium are also needed)
python3 brand/build.py              # SVGs, favicon.ico, app/Apple/maskable icons, logo PNGs -> public/
node promo/build-assets.cjs && node brand/og.cjs   # the 1200x630 social-share image (uses a real app screenshot)
```

- **Mark:** a tiffin carrier (wide handle, frame, lid knob, three tiers) in white on the brand gradient. It deliberately avoids a narrow arched handle, which reads as a padlock.
- **Wordmark:** "My" in brand orange + "Tiffin" in ink, set in Inter Display ExtraBold and converted to outlines, so it looks the same everywhere with no font installed.
- **Files:** `public/favicon.svg` + `favicon.ico` (16/32/48), `apple-touch-icon.png`, `icon-192/512.png`, `icon-maskable-512.png`, `og-image.png`; logos in `public/brand/` (`logo.svg` for light backgrounds, `logo-reversed.svg` for dark, PNG exports, `mark-1024.png`).

## Writing blog posts

Add an object to `content/posts.js` (slug, title, description, audience `providers`|`customers`, emoji, date, body). The body supports `##`/`###` headings, lists, `> quotes`, `**bold**`, `` `code` `` and `[links](/path)`. Restart the server to publish. Keep claims honest: the existing posts use no invented statistics, and example prices are labelled as examples.

## Good to know / not built

- No moderation beyond admin suspend, no reviews/ratings, no provider verification.
- Single language (English); one meal per day (no separate lunch/dinner); prices are per box by type, not per customer; amounts in reports use *current* prices.
- Scale: one process and one JSON file. Fine for dozens of providers and hundreds of customers; not for much more.
- Default timezone is `Asia/Kolkata` and phone matching/WhatsApp links assume 10-digit numbers with a configurable country code (default `91`). Change both if you are elsewhere.
