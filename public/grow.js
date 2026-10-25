'use strict';
// Provider "Grow" screen: marketplace listing, enquiries from customers, and paid advertising.
// Loaded before app.js; uses its helpers (h, api, act, toast, S, ...) at call time.

const RADII = [2, 3, 5, 8, 10, 15, 20, 25];

async function loadGrow() {
  const [listing, ads, enq] = await Promise.all([api('GET', '/api/listing'), api('GET', '/api/ads'), api('GET', '/api/enquiries')]);
  S.grow = { listing, ads, enquiries: enq.enquiries };
  setBadge(enq.enquiries.length);
}

function setBadge(n) {
  const a = document.querySelector('nav.tabs a[data-tab="grow"]');
  if (!a) return;
  a.querySelector('.badge-dot')?.remove();
  if (n > 0) a.append(h('span', { class: 'badge-dot' }, n));
}
const updateBadge = () => api('GET', '/api/enquiries').then((r) => setBadge(r.enquiries.length)).catch(() => {});

const dateOnly = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

function renderGrow() {
  const { listing: l, ads, enquiries } = S.grow;
  return h('div', { class: 'stack' },
    h('div', { class: 'section-title' }, 'Grow your tiffin business'),
    enquiries.length > 0 && enquiryCard(enquiries),
    listingCard(l),
    adsCard(ads, l));
}

function enquiryCard(list) {
  return h('div', { class: 'card stack' },
    h('h2', {}, `📩 New requests (${list.length})`),
    list.map((e) => h('div', { class: 'card', style: { background: 'var(--soft)', boxShadow: 'none' } },
      h('div', { class: 'row-title' }, h('strong', {}, e.name), h('span', { class: `badge ${e.type}` }, e.type === 'deluxe' ? '✨ Deluxe' : 'Normal')),
      h('div', { class: 'muted' }, e.phone), e.address && h('div', { class: 'muted addr' }, e.address), e.note && h('div', { class: 'note' }, `📝 ${e.note}`),
      h('div', { class: 'row-actions', style: { marginTop: '10px' } },
        h('button', { class: 'btn ok sm grow', onclick: async (ev) => {
          ev.currentTarget.disabled = true;
          if (await act(() => api('POST', `/api/enquiries/${e.id}/accept`), `${e.name} added to your customers ✓`)) refresh(true); else ev.currentTarget.disabled = false;
        } }, 'Add as customer'),
        h('a', { class: 'btn sm', href: `tel:${e.phone}` }, '📞 Call'),
        h('button', { class: 'btn sm', onclick: async () => { if (await act(() => api('POST', `/api/enquiries/${e.id}/dismiss`))) refresh(true); } }, 'Dismiss')))));
}

function listingCard(l) {
  let { lat, lng } = l;
  const on = h('input', { type: 'checkbox', checked: l.enabled });
  const tagline = h('input', { type: 'text', value: l.tagline, maxLength: 80, placeholder: 'e.g. Fresh home-style veg meals, delivered hot' });
  const about = h('textarea', { rows: 3, maxLength: 400, placeholder: 'Menu style, timings, delivery areas… (optional)' }, l.about);
  const area = h('input', { type: 'text', value: l.area, maxLength: 60, placeholder: 'e.g. Baner' });
  const city = h('input', { type: 'text', value: l.city, maxLength: 60, placeholder: 'e.g. Pune' });
  const pin = h('input', { type: 'text', value: l.pincode, maxLength: 8, inputMode: 'numeric', placeholder: 'Your pincode' });
  const serves = h('input', { type: 'text', value: l.servesPincodes.join(', '), placeholder: 'Other pincodes you deliver to (optional)' });
  const radius = h('select', {}, RADII.map((r) => h('option', { value: r, selected: r === l.radiusKm }, `${r} km`)));
  const chips = (name, options, chosen) => h('div', { class: 'tagpick' }, options.map((o) => h('label', {}, h('input', { type: 'checkbox', name, value: o, checked: chosen.includes(o) }), h('span', {}, o))));
  const tagBox = chips('tags', l.options.tags, l.tags);
  const mealBox = chips('meals', l.options.meals, l.meals);
  const picked = (box) => [...box.querySelectorAll('input:checked')].map((i) => i.value);
  const locState = h('p', { class: 'help' });
  const drawLoc = () => { locState.textContent = lat != null ? '✓ Location set. Only your approximate area (about 1 km) is saved and shown, never your exact address.' : 'No location yet. Without it, customers only find you by pincode.'; };
  drawLoc();
  const findText = h('input', { type: 'text', placeholder: 'Pincode or area to find on map' });

  const gps = h('button', { type: 'button', class: 'btn sm', onclick: () => {
    if (!navigator.geolocation) return toast('This browser cannot share location', true);
    navigator.geolocation.getCurrentPosition((p) => { lat = p.coords.latitude; lng = p.coords.longitude; drawLoc(); toast('Location captured. Remember to save.'); }, () => toast('Location is blocked. Use the box below instead.', true), { timeout: 10000 });
  } }, '📍 Use my phone’s location');
  const lookup = h('button', { type: 'button', class: 'btn sm', onclick: async () => {
    const r = await act(() => api('POST', '/api/listing/locate', { q: findText.value || pin.value }));
    if (r) { lat = r.lat; lng = r.lng; drawLoc(); toast(`Found: ${r.label}. Remember to save.`); }
  } }, 'Find on map');

  const save = h('button', { class: 'btn primary block', type: 'submit' }, 'Save listing');
  return h('form', {
    class: 'card stack', onsubmit: async (e) => {
      e.preventDefault();
      save.disabled = true;
      const r = await act(() => api('PUT', '/api/listing', {
        enabled: on.checked, tagline: tagline.value, about: about.value, area: area.value, city: city.value, pincode: pin.value,
        servesPincodes: serves.value.split(/[,\s]+/).filter(Boolean), radiusKm: radius.value, tags: picked(tagBox), meals: picked(mealBox), lat, lng,
      }), on.checked ? 'Saved. You are visible in the marketplace ✓' : 'Saved (hidden from the marketplace)');
      save.disabled = false;
      if (r) refresh(true);
    },
  },
    h('h2', {}, '🔎 Your marketplace listing'),
    h('p', { class: 'help' }, 'Listing is free. Customers near you can find you, call you or send a request to join.'),
    h('div', { class: 'tagpick' }, h('label', {}, on, h('span', {}, 'Show my kitchen in the marketplace'))),
    !l.hasPhone && h('p', { class: 'note-area' }, 'Tip: add your phone in Settings so customers can call you.'),
    h('label', { class: 'field' }, 'One-line description', tagline),
    h('div', { class: 'field' }, h('span', {}, 'Food type'), tagBox),
    h('div', { class: 'field' }, h('span', {}, 'Meals you serve'), mealBox),
    h('div', { class: 'grid2' }, h('label', { class: 'field' }, 'Area / locality', area), h('label', { class: 'field' }, 'City', city)),
    h('label', { class: 'field' }, 'Pincode', pin),
    h('div', { class: 'field' }, h('span', {}, 'Where you are'), h('div', { class: 'stack' }, gps, h('div', { class: 'grid2' }, findText, lookup), locState)),
    h('label', { class: 'field' }, 'You deliver within', radius),
    h('label', { class: 'field' }, 'Other pincodes', serves),
    h('label', { class: 'field' }, 'About', about),
    save);
}

function adsCard(ads, l) {
  const money2 = (n) => `${ads.currency}${Number(n).toLocaleString('en-IN')}`;
  const s = ads.stats;
  const pending = ads.orders.filter((o) => o.status === 'pending');
  return h('div', { class: 'card stack' },
    h('h2', {}, '📣 Advertise (optional)'),
    h('p', { class: 'help' }, 'Your free listing shows to nearby customers. An ad adds a “Sponsored” spot at the top, only for customers close to you (within the radius of your plan). Never for people far away.'),
    h('div', { class: 'kpis' },
      h('div', {}, h('b', {}, s.imp), h('span', {}, 'Shown in search (30 days)')),
      h('div', {}, h('b', {}, s.spImp), h('span', {}, 'Shown as Sponsored')),
      h('div', {}, h('b', {}, s.enquiry), h('span', {}, 'Join requests'))),
    h('p', { class: 'help' }, 'Counted when your listing appears in a customer’s search results, and when a customer sends you a join request. We cannot tell if someone phones you, so calls are not counted.'),
    ads.active && h('div', { class: 'live' }, `✅ Your ad is live until ${dateOnly(ads.active.endsAt)}. Customers within ${ads.active.radiusKm} km see you as Sponsored.`),
    !ads.canAdvertise && h('p', { class: 'note-area' }, 'To advertise, first switch on your listing above and set your location, then save.'),
    ads.canAdvertise && (ads.plans.length
      ? h('div', { class: 'stack' }, ads.plans.map((p) => h('div', { class: 'plan' },
          h('div', {}, h('b', {}, p.name), h('div', { class: 'muted' }, `${p.days} days · customers within ${Math.min(p.radiusKm, l.radiusKm)} km`)),
          h('div', { style: { textAlign: 'right' } }, h('div', { class: 'price-big' }, money2(p.price)),
            h('button', { class: 'btn primary sm', onclick: async (e) => {
              if (!confirm(`Order “${p.name}” for ${money2(p.price)}?`)) return;
              e.currentTarget.disabled = true;
              if (await act(() => api('POST', '/api/ads/order', { planId: p.id }), 'Order placed. See the payment steps below.')) refresh(true); else e.currentTarget.disabled = false;
            } }, 'Order')))))
      : h('p', { class: 'muted' }, 'Advertising plans are not open yet. Check back soon.')),
    pending.map((o) => h('div', { class: 'stack' },
      h('div', { class: 'rowline' }, h('b', {}, `${o.planName} · ${money2(o.price)}`), h('span', { class: 'st pending' }, 'Waiting for payment')),
      h('div', { class: 'pay' }, `${ads.payInstructions || 'Please contact us to complete the payment.'}\n\nUse this reference when paying: ${o.ref}\nYour ad starts once we confirm the payment.`),
      h('button', { class: 'btn sm danger', onclick: async () => { if (await act(() => api('POST', `/api/ads/orders/${o.id}/cancel`))) refresh(true); } }, 'Cancel order'))),
    ads.orders.some((o) => o.status === 'paid') && h('details', {}, h('summary', {}, 'Past ads'),
      ads.orders.filter((o) => o.status === 'paid').map((o) => h('p', { class: 'muted' }, `${o.planName}: ${dateOnly(o.startsAt)} – ${dateOnly(o.endsAt)}`))));
}
