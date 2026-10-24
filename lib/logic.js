// Pure helpers: dates, who is scheduled on a day, and the per-day summary.
// Dates are plain 'YYYY-MM-DD' strings in the server's local timezone (set TZ).

export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && ymd(parseDate(s)) === s;
export const todayStr = () => ymd(new Date());
export const addDays = (s, n) => {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
export const dayCount = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 864e5) + 1;
export const fmtDate = (s) =>
  parseDate(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

export const isClosed = (db, date) => db.settings.closedDays.includes(parseDate(date).getDay());
export const isScheduled = (c, date) => (!c.startDate || c.startDate <= date) && (!c.endDate || date <= c.endDate);
export const leaveOn = (c, date) => c.leaves.find((l) => l.from <= date && date <= l.to);

// Earliest date a customer may start a leave: today only before the cutoff hour.
export const leaveMinDate = (db) => {
  const today = todayStr();
  return new Date().getHours() < db.settings.cutoffHour ? today : addDays(today, 1);
};

// Sort + merge overlapping or back-to-back ranges so the list stays tidy.
export function mergeLeaves(leaves) {
  const sorted = [...leaves].sort((a, b) => a.from.localeCompare(b.from));
  const out = [];
  for (const l of sorted) {
    const last = out[out.length - 1];
    if (last && l.from <= addDays(last.to, 1)) {
      if (l.to > last.to) last.to = l.to;
    } else out.push({ ...l });
  }
  return out;
}

export function daySummary(db, date) {
  const closed = isClosed(db, date);
  const delivered = db.deliveries[date] || {};
  const rows = [];
  if (!closed) {
    for (const c of db.customers) {
      if (!isScheduled(c, date)) continue;
      const lv = leaveOn(c, date);
      const { leaves, ...rest } = c;
      rows.push({
        ...rest,
        status: lv ? 'leave' : delivered[c.id] ? 'delivered' : 'pending',
        leaveUntil: lv ? lv.to : null,
        deliveredAt: delivered[c.id] || null,
      });
    }
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  const counts = { boxes: 0, normal: 0, deluxe: 0, stops: 0, pending: 0, delivered: 0, leave: 0 };
  for (const r of rows) {
    if (r.status === 'leave') counts.leave++;
    else {
      counts.boxes += r.qty;
      counts[r.type] += r.qty;
      counts.stops++;
      counts[r.status]++;
    }
  }
  return { date, closed, rows, counts };
}

export function monthReport(db, month) {
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`;
  const last = ymd(new Date(y, m, 0));
  const today = todayStr();
  const price = db.settings.prices;
  const per = new Map(
    db.customers.map((c) => [
      c.id,
      { id: c.id, name: c.name, type: c.type, qty: c.qty, phone: c.phone, delivered: 0, boxes: 0, leave: 0, missed: 0, amount: 0 },
    ]),
  );
  const daily = [];
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const closed = isClosed(db, d);
    const day = { date: d, closed, future: d > today, boxes: 0, delivered: 0, leave: 0, missed: 0 };
    if (!closed && d <= today) {
      const dl = db.deliveries[d] || {};
      for (const c of db.customers) {
        if (!isScheduled(c, d)) continue;
        const r = per.get(c.id);
        if (leaveOn(c, d)) {
          r.leave++;
          day.leave++;
        } else if (dl[c.id]) {
          r.delivered++;
          r.boxes += c.qty;
          r.amount += c.qty * (price[c.type] || 0);
          day.delivered++;
          day.boxes += c.qty;
        } else if (d < today) {
          // today's undelivered tiffins are still "to do", not missed
          r.missed++;
          day.missed++;
        }
      }
    }
    daily.push(day);
  }
  const customers = [...per.values()]
    .filter((r) => r.delivered + r.leave + r.missed > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  const totals = customers.reduce(
    (t, r) => ({
      delivered: t.delivered + r.delivered,
      boxes: t.boxes + r.boxes,
      leave: t.leave + r.leave,
      missed: t.missed + r.missed,
      amount: t.amount + r.amount,
    }),
    { delivered: 0, boxes: 0, leave: 0, missed: 0, amount: 0 },
  );
  return { month, first, last, customers, totals, daily };
}
