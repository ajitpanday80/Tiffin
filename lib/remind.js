// Join requests nobody answered: nudge the provider after 1 day, and once more after 3 days.
const DAY = 864e5;

// Marks the requests it returns, so each reminder is sent once. Returns [{ tenant, late: [enquiry...] }].
export function dueReminders(tenants, now = Date.now()) {
  const out = [];
  for (const t of tenants) {
    const late = t.enquiries.filter((e) => e.status === 'new' && (e.reminded || 0) < 2 && now - e.at >= (e.reminded ? 3 : 1) * DAY);
    if (!late.length) continue;
    for (const e of late) e.reminded = (e.reminded || 0) + 1;
    out.push({ tenant: t, late });
  }
  return out;
}
