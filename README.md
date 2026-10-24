# 🍱 Tiffin Manager

A light, mobile-first web app for tiffin providers.

- **Provider app** (`/app`): customers (name, address, phone, Normal/Deluxe, boxes per day), a daily "how many to cook" count, one-tap *Delivered* checklist, leave management, monthly reports (CSV + WhatsApp summary).
- **Customer portal** (`/me`): customers log in with their phone number + password and mark their own leave. A personal passwordless link (`/c/<token>`) also works.
- **Telegram bot**: instant alert when a customer takes or cancels leave, plus morning/evening summaries and `/today`, `/tomorrow`, `/pending`.
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

## Telegram setup (5 minutes)

1. In Telegram, message **@BotFather** → `/newbot` → copy the token.
2. Start the server with `TELEGRAM_BOT_TOKEN=<token>`.
3. Each provider opens **Settings → Telegram**, finds the bot, and sends the `/start CODE` shown there. Done; use *Send test* to check.

One bot serves all providers; the code ties a chat to one provider.

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

- Single language (English); one meal per day (no separate lunch/dinner); prices are per box by type, not per customer; amounts in reports use *current* prices.
- Scale: one process and one JSON file. Fine for dozens of providers and hundreds of customers; not for much more.
- Default timezone is `Asia/Kolkata` and phone matching/WhatsApp links assume 10-digit numbers with a configurable country code (default `91`). Change both if you are elsewhere.
