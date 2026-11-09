/*
 * Chicken Amine: the owner's promotions, chosen in the staff app (/commandes/, « Promotions » tab) and shown on the
 * site. The same rules are checked by the database when an order arrives (supabase/schema.sql, orders_check_promos).
 * A promotion: { id, name, location (null = both restaurants), all_items, category_ids, item_ids,
 *   kind ("percent" | "amount"), value, starts_at, ends_at, daily_from, daily_to ("HH:MM", both or neither), active }.
 * The discount is rounded to the dirham (10 % of 37 DH = 4 DH); when several promotions cover a dish, the biggest wins.
 * Delivery fees are never discounted.
 */
(function () {
  const TZ = "Africa/Casablanca";
  // an order started just before a promotion ends is still accepted for a few minutes
  const GRACE_MS = 10 * 60e3;

  function minutesIn(date) {
    const p = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
    return +p.find((x) => x.type === "hour").value * 60 + +p.find((x) => x.type === "minute").value;
  }
  const toMin = (s) => { const [h, m] = String(s).split(":").map(Number); return h * 60 + m; };

  // The daily window (Casablanca time); it may run past midnight (22:00 – 02:00).
  function inWindow(p, date) {
    if (!p.daily_from || !p.daily_to) return true;
    const m = minutesIn(date), a = toMin(p.daily_from), b = toMin(p.daily_to);
    return a < b ? m >= a && m < b : m >= a || m < b;
  }
  function isOn(p, now = new Date(), grace = 0) {
    if (!p || !p.active) return false;
    const t = now.getTime();
    if (t < Date.parse(p.starts_at) || t >= Date.parse(p.ends_at) + grace) return false;
    return inWindow(p, now) || (grace > 0 && inWindow(p, new Date(t - grace)));
  }
  const covers = (p, itemId, catId) => !!(p.all_items || (p.item_ids || []).indexOf(itemId) !== -1 || (p.category_ids || []).indexOf(catId) !== -1);
  const forSite = (p, site) => !p.location || p.location === site;

  // Dirhams off one unit at this price.
  function off(p, unit) {
    const d = p.kind === "percent" ? Math.round((unit * p.value) / 100) : p.value;
    return Math.max(0, Math.min(unit, d));
  }

  // The best promotion for one unit of a dish at a restaurant, now: { promo, off } or null.
  function best(list, itemId, catId, site, unit, now = new Date()) {
    let win = null;
    (list || []).forEach((p) => {
      if (!forSite(p, site) || !covers(p, itemId, catId) || !isOn(p, now)) return;
      const o = off(p, unit);
      if (o > 0 && (!win || o > win.off)) win = { promo: p, off: o };
    });
    return win;
  }

  // "-10%" or "-5 DH"
  const label = (p, currency) => (p.kind === "percent" ? `-${p.value}%` : `-${p.value} ${currency || "DH"}`);

  window.Promos = { TZ, GRACE_MS, isOn, inWindow, covers, forSite, off, best, label, minutesIn };
})();
