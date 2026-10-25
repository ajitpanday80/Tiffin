// Marketplace: who is listed, who is advertising, and nearest-first search.
import { haversineKm } from './geo.js';

const DAY = 864e5;

export const isListed = (t) => {
  const l = t.listing;
  return !!l && l.enabled && !l.suspended && (l.lat != null || !!l.pincode);
};

// The ad currently running for a provider (latest-ending paid order that has started).
export function activeAd(db, tid, now = Date.now()) {
  const live = db.platform.orders.filter((o) => o.tid === tid && o.status === 'paid' && o.startsAt <= now && now < o.endsAt);
  return live.sort((a, b) => b.endsAt - a.endsAt)[0] || null;
}

export const SPONSORED_SLOTS = 2;

/**
 * Nearest-first search.
 *  origin: { lat, lng } | null,  pin: '411045' | ''
 * A provider appears only if the customer is inside its service radius, or it explicitly
 * serves the customer's pincode. Without coordinates we fall back to same-pincode / same
 * 3-digit area matches.
 *
 * ADS ARE LOCAL: a provider with a running ad gets a "Sponsored" slot only when the
 * customer is within BOTH its service radius and the ad radius it paid for (or, in
 * pincode-only mode, exactly serves that pincode). Slots go to the nearest advertisers.
 */
export function search(db, { origin, pin = '' }, now = Date.now()) {
  const found = [];
  for (const [tid, t] of Object.entries(db.tenants)) {
    if (!isListed(t)) continue;
    const l = t.listing;
    const dist = origin && l.lat != null ? haversineKm(origin, l) : null;
    const servesPin = !!pin && (l.pincode === pin || l.servesPincodes.includes(pin));
    const inRadius = dist != null && dist <= l.radiusKm;
    const sameArea = !origin && !!pin && !!l.pincode && l.pincode.slice(0, 3) === pin.slice(0, 3);
    if (!inRadius && !servesPin && !sameArea) continue;
    const ad = activeAd(db, tid, now);
    const adOk = !!ad && (dist != null ? dist <= Math.min(ad.radiusKm, l.radiusKm) : servesPin);
    found.push({ tid, t, l, dist, servesPin, adOk, match: servesPin ? 'pincode' : inRadius ? 'nearby' : 'area' });
  }
  const byNear = (a, b) => (a.dist ?? 1e3) - (b.dist ?? 1e3) || Number(b.servesPin) - Number(a.servesPin) || a.l.id.localeCompare(b.l.id);
  const sponsored = found.filter((f) => f.adOk).sort(byNear).slice(0, SPONSORED_SLOTS);
  const chosen = new Set(sponsored);
  const rest = found.filter((f) => !chosen.has(f)).sort(byNear);
  return [...sponsored.map((f) => ({ ...f, sponsored: true })), ...rest.map((f) => ({ ...f, sponsored: false }))].slice(0, 40);
}

export function card(f) {
  const { t, l } = f;
  const s = t.settings;
  return {
    id: l.id,
    name: s.businessName,
    tagline: l.tagline,
    about: l.about,
    tags: l.tags,
    meals: l.meals,
    area: l.area,
    city: l.city,
    pincode: l.pincode,
    // distance is approximate on purpose (provider location is coarse); shown in 0.5 km steps
    distanceKm: f.dist == null ? null : Math.max(0.5, Math.round(f.dist * 2) / 2),
    match: f.match,
    sponsored: f.sponsored,
    priceFrom: { normal: s.prices.normal || null, deluxe: s.prices.deluxe || null, currency: s.currency },
    phone: s.businessPhone || '',
  };
}

export const adView = (o) => ({ id: o.id, ref: o.ref, planName: o.planName, days: o.days, radiusKm: o.radiusKm, price: o.price, status: o.status, createdAt: o.createdAt, startsAt: o.startsAt || null, endsAt: o.endsAt || null });

// Mark an order paid: the ad starts now, or right after the provider's current ad ends.
export function activateOrder(db, order, now = Date.now()) {
  const lastEnd = Math.max(now, ...db.platform.orders.filter((o) => o.tid === order.tid && o.status === 'paid').map((o) => o.endsAt));
  order.status = 'paid';
  order.paidAt = now;
  order.startsAt = lastEnd;
  order.endsAt = lastEnd + order.days * DAY;
  return order;
}

const dayKey = (now) => new Date(now).toISOString().slice(0, 10);
export function track(db, tid, field, n = 1, now = Date.now()) {
  const byTenant = (db.platform.stats[tid] ||= {});
  const row = (byTenant[dayKey(now)] ||= { imp: 0, spImp: 0, enquiry: 0 });
  row[field] = (row[field] || 0) + n;
  const days = Object.keys(byTenant).sort();
  while (days.length > 90) delete byTenant[days.shift()];
}

export function statsFor(db, tid, sinceDays = 30, now = Date.now()) {
  const from = dayKey(now - sinceDays * DAY);
  const out = { imp: 0, spImp: 0, enquiry: 0 };
  for (const [d, row] of Object.entries(db.platform.stats[tid] || {})) if (d >= from) for (const k of Object.keys(out)) out[k] += row[k] || 0;
  return out;
}
