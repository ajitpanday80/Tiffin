# 🍱 Tiffin Manager

A light, mobile-first web app for tiffin providers.

- **Provider app** (`/app`): customers (name, address, phone, Normal/Deluxe, boxes per day), a daily "how many to cook" count, one-tap *Delivered* checklist, leave management, monthly reports (CSV + WhatsApp summary).
- **Customer portal** (`/me`): customers log in with their phone number + password and mark their own leave. A personal passwordless link (`/c/<token>`) also works.
- **Telegram bot**: instant alert when a customer takes or cancels leave, plus morning/evening summaries and `/today`, `/tomorrow`, `/pending`.
- **Marketplace** (`/find`): customers find tiffin services nearest-first by GPS, pincode or address, then call, WhatsApp or send a *request to join* that lands in the provider's inbox (one tap to add as a customer).
- **Advertising**: listing is free; providers can pay for a *Sponsored* spot that only shows to customers near them. Platform admin console at `/admin`.
- **Website** (`/`) with login / sign-up (`/login`, `/signup`).
- Phone + password accounts, sessions last **30 days** (sliding). Many providers can share one install; each only sees their own data.

No dependencies, no build step, one JSON file for data. Needs **Node 20+**.

## Run it

```bash
npm start            # http://localhost:3000
npm test             # API tests
```

| Variable | Purpose |
| --- | --- |
| `PORT` | default `3000` |
| `TZ` | **Your timezone**, e.g. `Asia/Kolkata` (the default). "Today" and the Telegram summary times follow it. |
| `DATA_DIR` | where `db.json` lives (default `./data`). Put this on a **persistent disk**. |
| `TELEGRAM_BOT_TOKEN` | optional, enables Telegram alerts |
| `COUNTRY` | ISO country code that biases pincode/address lookups (default `in`) |
| `GEOCODER` | set to `off` to disable address/pincode geocoding (pincode matching still works) |
| `GEOCODER_CONTACT` | your email/URL, sent in the geocoder User-Agent (OpenStreetMap asks for this) |

## Telegram setup (5 minutes)

1. In Telegram, message **@BotFather** → `/newbot` → copy the token.
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

## Deploying

Any host that runs Node with a persistent disk works (a small VPS, Fly.io volume, Railway volume, etc.). Put it behind **HTTPS** (the session cookie is marked `Secure` when the proxy sends `X-Forwarded-Proto: https`). Back up `DATA_DIR/db.json` (a copy of the previous version is kept as `db.backup.json` on each start). A host with an ephemeral disk will lose all data on restart.

## How accounts work (read this)

- A provider signs up with phone + password + service name.
- A **customer can only sign up with a phone number a provider already saved** for them (last 10 digits are compared). They then see every provider who has that number.
- **Known weakness:** whoever knows a customer's number can create the account *before* the real customer does, and could then mark leave for them. Impact is limited to leave days (no payments or addresses are exposed), and providers can see leave changes, but it is real. The personal `/c/<token>` link avoids this since the secret is sent only to the customer.
- **No self-service password reset** (no SMS/email integration). Reset on the server:
  `node scripts/reset-password.js provider 9811100001 newpassword`
- Failed logins are rate-limited per phone and per IP (this also means someone can temporarily lock a number out).

## Good to know / not built

- No moderation beyond admin suspend, no reviews/ratings, no provider verification.
- Single language (English); one meal per day (no separate lunch/dinner); prices are per box by type, not per customer; amounts in reports use *current* prices.
- Scale: one process and one JSON file. Fine for dozens of providers and hundreds of customers; not for much more.
- Default timezone is `Asia/Kolkata` and phone matching/WhatsApp links assume 10-digit numbers with a configurable country code (default `91`). Change both if you are elsewhere.
