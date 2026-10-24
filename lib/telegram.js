import * as L from './logic.js';
import { Limiter } from './limiter.js';

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function summaryText(db, date, heading) {
  const s = L.daySummary(db, date);
  if (s.closed) return `${heading} — <b>${L.fmtDate(date)}</b>\n🌴 Closed, no tiffins.`;
  const c = s.counts;
  let t = `${heading} — <b>${L.fmtDate(date)}</b>\n\n🍱 Prepare <b>${c.boxes}</b> box${c.boxes === 1 ? '' : 'es'}\n• Normal: ${c.normal}\n• Deluxe: ${c.deluxe}`;
  const lv = s.rows.filter((r) => r.status === 'leave');
  if (lv.length) t += `\n\n🏖 On leave (${lv.length}): ${lv.map((r) => esc(r.name)).join(', ')}`;
  return t;
}

export function pendingText(db, date) {
  const s = L.daySummary(db, date);
  if (s.closed) return '🌴 Closed today, nothing to deliver.';
  const p = s.rows.filter((r) => r.status === 'pending');
  if (!p.length) return '🎉 Everything is delivered!';
  const lines = p.map(
    (r) => `• <b>${esc(r.name)}</b>${r.qty > 1 ? ` ×${r.qty}` : ''}${r.address ? ` — ${esc(r.address)}` : ''}${r.phone ? ` · ${esc(r.phone)}` : ''}`,
  );
  return `📦 <b>${p.length}</b> left to deliver:\n\n${lines.join('\n')}`;
}

export function leaveText(db, c, from, to, action) {
  const range = from === to ? L.fmtDate(from) : `${L.fmtDate(from)} → ${L.fmtDate(to)} (${L.dayCount(from, to)} days)`;
  const who = `<b>${esc(c.name)}</b> (${c.type === 'deluxe' ? 'Deluxe' : 'Normal'}${c.qty > 1 ? ` ×${c.qty}` : ''})`;
  let t = action === 'add' ? `🏖 ${who} is on leave\n📅 ${range}` : `↩️ ${who} cancelled leave\n📅 ${range}`;
  const today = L.todayStr();
  for (const [label, d] of [['Today', today], ['Tomorrow', L.addDays(today, 1)]]) {
    if (from <= d && d <= to) {
      const s = L.daySummary(db, d);
      if (!s.closed) t += `\n\n🍱 ${label}: <b>${s.counts.boxes}</b> to prepare (Normal ${s.counts.normal}, Deluxe ${s.counts.deluxe})`;
    }
  }
  return t;
}

export class Telegram {
  constructor({ token, store, log = console }) {
    this.token = token;
    this.store = store;
    this.log = log;
    this.limiter = new Limiter(5, 60 * 60 * 1000);
    this.botName = '';
    this.running = false;
  }
  get configured() {
    return !!this.token;
  }
  tenants() {
    return Object.values(this.store.db.tenants);
  }
  tenantByChat(chat) {
    return this.tenants().find((t) => t.settings.telegramChatId === chat);
  }
  isLinked(t) {
    return this.configured && !!t.settings.telegramChatId;
  }
  notify(t, text) {
    return this.isLinked(t) ? this.send(t.settings.telegramChatId, text) : Promise.resolve(false);
  }

  async api(method, body = {}, timeoutMs = 15000) {
    const r = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(j.description || `Telegram ${method} failed (${r.status})`);
    return j.result;
  }

  // Never throws: a Telegram outage must not break the app.
  async send(chatId, text) {
    if (!this.configured || !chatId) return false;
    try {
      await this.api('sendMessage', { chat_id: chatId, text: text.slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true });
      return true;
    } catch (e) {
      this.log.error('[telegram] send failed:', e.message);
      return false;
    }
  }

  async start() {
    if (!this.configured) return;
    try {
      this.botName = (await this.api('getMe')).username;
      this.log.log(`[telegram] bot @${this.botName} ready`);
    } catch (e) {
      this.log.error('[telegram] getMe failed, check TELEGRAM_BOT_TOKEN:', e.message);
      return;
    }
    this.running = true;
    this.poll();
  }

  async poll() {
    let offset = 0;
    while (this.running) {
      try {
        const updates = await this.api('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] }, 40000);
        for (const u of updates) {
          offset = u.update_id + 1;
          if (u.message) await this.handle(u.message).catch((e) => this.log.error('[telegram] handler:', e.message));
        }
      } catch (e) {
        this.log.error('[telegram] polling error:', e.message);
        await sleep(5000);
      }
    }
  }

  async handle(msg) {
    if (msg.chat.type !== 'private' || !msg.text) return;
    const chat = String(msg.chat.id);
    const reply = (t) => this.send(chat, t);
    const [raw, ...rest] = msg.text.trim().split(/\s+/);
    const cmd = raw.split('@')[0].toLowerCase();

    if (cmd === '/start' || cmd === '/link') {
      const code = rest.join('').toUpperCase();
      const mine = this.tenantByChat(chat);
      if (!code) return reply(mine ? 'Already connected ✅ Try /today' : 'Open the Tiffin app → Settings → Telegram, then send the code shown there, like:\n<code>/start ABCD2345</code>');
      if (this.limiter.blocked(chat)) return reply('Too many wrong attempts. Try again in an hour.');
      const t = this.tenants().find((x) => x.settings.linkCode && x.settings.linkCode === code);
      if (!t) {
        this.limiter.fail(chat);
        return reply('❌ That code is not right. Check Settings → Telegram in the app.');
      }
      this.limiter.reset(chat);
      for (const o of this.tenants()) if (o.settings.telegramChatId === chat) o.settings.telegramChatId = '';
      t.settings.telegramChatId = chat;
      this.store.save();
      this.api('deleteMessage', { chat_id: chat, message_id: msg.message_id }).catch(() => {});
      return reply(`✅ Connected to <b>${esc(t.settings.businessName)}</b>! You will get leave alerts and daily summaries here.\n\n/today — what to cook today\n/tomorrow — tomorrow's count\n/pending — left to deliver`);
    }
    const t = this.tenantByChat(chat);
    if (!t) return reply('This bot is private. Open the Tiffin app → Settings → Telegram to connect.');

    const today = L.todayStr();
    switch (cmd) {
      case '/today':
        return reply(summaryText(t, today, '🍱 Today'));
      case '/tomorrow':
        return reply(summaryText(t, L.addDays(today, 1), '🌙 Tomorrow'));
      case '/pending':
        return reply(pendingText(t, today));
      default:
        return reply("/today — what to cook today\n/tomorrow — tomorrow's count\n/pending — left to deliver");
    }
  }

  // Called every ~30s: sends each provider's morning/evening summary once a day, within 30 min of the set time.
  tick() {
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    const today = L.todayStr();
    for (const t of this.tenants()) {
      if (!this.isLinked(t)) continue;
      for (const [slot, target, heading, offset] of [
        ['morning', t.settings.morningTime, '☀️ Good morning', 0],
        ['evening', t.settings.eveningTime, '🌙 Tomorrow', 1],
      ]) {
        if (!/^\d{2}:\d{2}$/.test(target) || t.notified[slot] === today) continue;
        const at = Number(target.slice(0, 2)) * 60 + Number(target.slice(3));
        if (mins < at || mins > at + 30) continue;
        t.notified[slot] = today;
        this.store.save();
        const date = L.addDays(today, offset);
        if (!L.isClosed(t, date)) this.send(t.settings.telegramChatId, summaryText(t, date, heading));
      }
    }
  }
}
