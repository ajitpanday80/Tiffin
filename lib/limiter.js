// Tiny in-memory failure limiter: block a key after `max` failures within `windowMs`.
export class Limiter {
  constructor(max, windowMs) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map();
  }
  blocked(key) {
    const e = this.hits.get(key);
    if (!e) return false;
    if (Date.now() - e.first > this.windowMs) {
      this.hits.delete(key);
      return false;
    }
    return e.n >= this.max;
  }
  fail(key) {
    const e = this.hits.get(key);
    if (!e || Date.now() - e.first > this.windowMs) this.hits.set(key, { n: 1, first: Date.now() });
    else e.n++;
    if (this.hits.size > 5000) this.prune();
  }
  prune() {
    const now = Date.now();
    for (const [k, e] of this.hits) if (now - e.first > this.windowMs) this.hits.delete(k);
  }
  reset(key) {
    this.hits.delete(key);
  }
}
