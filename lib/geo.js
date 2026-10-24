// Geography helpers + a cached, throttled geocoder (OpenStreetMap Nominatim by default).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function haversineKm(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// 2 decimals is roughly 1.1 km. Providers only ever store/publish this coarse spot, so a
// home kitchen cannot be pinpointed by repeating searches from different places.
export const snap = (n) => Math.round(n * 100) / 100;
export const validCoords = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

export class Geocoder {
  constructor({ store, country = 'in', enabled = true, fetchImpl = fetch, minGapMs = 1100, userAgent = 'tiffin-manager/1.0' }) {
    Object.assign(this, { store, country, enabled, fetchImpl, minGapMs, userAgent });
    this.last = 0;
    this.chain = Promise.resolve();
  }
  // Returns { lat, lng, label } or null (never throws). Results are cached in the database.
  lookup(query) {
    const q = String(query || '').trim().replace(/\s+/g, ' ').slice(0, 200);
    if (!q || !this.enabled) return Promise.resolve(null);
    const key = q.toLowerCase();
    const cache = this.store.db.platform.geocache;
    if (cache[key]) return Promise.resolve(cache[key]);
    // one request at a time, at most one per minGapMs (Nominatim usage policy)
    const run = this.chain.then(async () => {
      if (cache[key]) return cache[key];
      const wait = this.last + this.minGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      try {
        const isPin = /^\d{4,8}$/.test(q);
        const url = new URL('https://nominatim.openstreetmap.org/search');
        url.searchParams.set('format', 'jsonv2');
        url.searchParams.set('limit', '1');
        url.searchParams.set('countrycodes', this.country);
        url.searchParams.set(isPin ? 'postalcode' : 'q', q);
        const r = await this.fetchImpl(url, { headers: { 'User-Agent': this.userAgent, 'Accept-Language': 'en' }, signal: AbortSignal.timeout(6000) });
        if (!r.ok) return null;
        const hit = (await r.json())?.[0];
        const lat = Number(hit?.lat);
        const lng = Number(hit?.lon);
        if (!validCoords(lat, lng)) return null;
        const out = { lat, lng, label: String(hit.display_name || q).split(',').slice(0, 3).join(',').trim() };
        const keys = Object.keys(cache);
        if (keys.length > 5000) delete cache[keys[0]];
        cache[key] = out;
        this.store.save();
        return out;
      } catch {
        return null;
      }
    });
    this.chain = run.catch(() => {});
    return run;
  }
}
