/* Chicken Amine: page logic (language, intro, status, menu, cart, ordering). */
(function () {
  const C = window.CONFIG;
  const MENU = window.MENU;
  const SAUCES = window.SAUCES || [];
  const MAX_SAUCES = window.MAX_SAUCES || 2;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const CART_KEY = "chickenamine.cart.v1";
  const FORM_KEY = "chickenamine.customer.v1";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  let lang = new URLSearchParams(location.search).get("lang") === "ar" ? "ar" : "fr";

  /* ---------- Text helpers ---------- */
  function t(path, vars) {
    const v = path.split(".").reduce((o, k) => (o ? o[k] : undefined), window.I18N[lang]);
    if (typeof v !== "string") return path;
    return vars ? v.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : "")) : v;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  // Escapes text; on the Arabic page, Latin runs are isolated so they keep left-to-right order.
  function rich(s) {
    const e = esc(s);
    if (lang !== "ar") return e;
    return e.replace(/[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9'’.\- ]*[A-Za-zÀ-ÿ0-9]|[A-Za-zÀ-ÿ]/g, (m) => `<span class="ltr" dir="ltr">${m}</span>`);
  }
  const L = (obj) => (obj ? obj[lang] || obj.fr : "");
  const money = (n) => `${n} ${C.currency[lang]}`;

  /* ---------- Opening hours (Casablanca time) ---------- */
  function casablancaMinutes(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: C.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
    const h = +parts.find((p) => p.type === "hour").value;
    const m = +parts.find((p) => p.type === "minute").value;
    return h * 60 + m;
  }
  const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
  function isOpen(now = casablancaMinutes()) {
    const o = toMin(C.hours.open), c = toMin(C.hours.close);
    return c > o ? now >= o && now < c : now >= o || now < c; // a close at or before open is after midnight
  }
  function updateStatus() {
    const el = $("#status");
    const open = isOpen();
    el.classList.toggle("is-open", open);
    el.classList.toggle("is-closed", !open);
    $(".status__text", el).textContent = open ? t("status.open", { time: C.hours.close }) : t("status.closed", { time: C.hours.open });
  }

  /* ---------- Language ---------- */
  function pageUrl(l) { return C.siteUrl.replace(/\/$/, "") + (l === "ar" ? "/?lang=ar" : "/"); }

  function applyLanguage() {
    const html = document.documentElement;
    html.lang = lang;
    html.dir = lang === "ar" ? "rtl" : "ltr";
    document.title = t("meta.title");
    $('meta[name="description"]').setAttribute("content", t("meta.description"));
    $('link[rel="canonical"]').setAttribute("href", pageUrl(lang));
    $('meta[property="og:title"]').setAttribute("content", t("meta.title"));
    $('meta[property="og:url"]').setAttribute("content", pageUrl(lang));
    $('meta[property="og:locale"]').setAttribute("content", lang === "ar" ? "ar_MA" : "fr_MA");
    $('meta[property="og:locale:alternate"]').setAttribute("content", lang === "ar" ? "fr_MA" : "ar_MA");

    $$("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
      delete el.dataset.stReady;
      delete el.dataset.stPlayed;
      el.removeAttribute("aria-label");
      el.classList.remove("st-pending");
    });
    $$("[data-i18n-label]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.i18nLabel)));

    const toggle = $("#lang-toggle");
    toggle.lang = lang === "ar" ? "fr" : "ar";
    toggle.dir = lang === "ar" ? "ltr" : "rtl";

    $("#cart-btn").setAttribute("aria-label", t("cart.title"));
    $("#ig-float").setAttribute("aria-label", t("instagramButton"));
    $("#map-embed").title = t("infos.mapTitle");
    $("#info-address").innerHTML = rich(L(C.address));
    $("#info-hours").innerHTML = rich(t("infos.hoursValue", { open: C.hours.open, close: C.hours.close }));
    $("#footer-text").innerHTML = rich(t("footer", { year: new Date().getFullYear() }));

    updateStatus();
    renderMenu();
    renderCart();
    if ($("#checkout-form").hidden === false) renderCheckout();
    if (window.SpringText) SpringText.observe(document.querySelector("main"));
  }

  function switchLanguage() {
    lang = lang === "ar" ? "fr" : "ar";
    const url = new URL(location.href);
    if (lang === "ar") url.searchParams.set("lang", "ar"); else url.searchParams.delete("lang");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
    applyLanguage();
    // Headings already on screen replay at once.
    $$("main h1, main h2, main h3").forEach((h) => {
      const r = h.getBoundingClientRect();
      if (r.top < innerHeight && r.bottom > 0 && window.SpringText) SpringText.play(h);
    });
  }

  /* ---------- Static links ---------- */
  function setupLinks() {
    $("#location-btn").href = C.googleMapsUrl;
    $("#directions-btn").href = C.googleMapsUrl;
    $("#info-phone").href = "tel:" + C.phoneIntl;
    $("#info-phone").textContent = C.phone.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
    $("#info-instagram").href = C.instagram;
    $("#info-instagram").textContent = C.instagramHandle;
    $("#ig-float").href = C.instagram;
    $("#map-embed").src = "https://maps.google.com/maps?q=" + encodeURIComponent(C.googleMapsQuery) + "&z=16&output=embed";
  }

  /* ---------- Hero video ---------- */
  function setupHero() {
    const v = C.heroVideo || {};
    if (!v.mp4 && !v.webm) return;
    const media = $("#hero-media");
    const video = document.createElement("video");
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.preload = "metadata";
    if (v.poster) video.poster = v.poster;
    if (v.webm) video.insertAdjacentHTML("beforeend", `<source src="${esc(v.webm)}" type="video/webm">`);
    if (v.mp4) video.insertAdjacentHTML("beforeend", `<source src="${esc(v.mp4)}" type="video/mp4">`);
    media.appendChild(video);
    media.classList.add("has-video");
    if (reducedMotion.matches) return; // poster only
    video.autoplay = true;
    video.play().catch(() => {});
  }

  /* ---------- Intro: logo animation that glides into the header ---------- */
  function runIntro() {
    const intro = $("#intro");
    const finish = () => {
      intro.classList.add("is-done");
      document.documentElement.classList.add("no-intro");
      // After the intro the hero title behaves like any heading (it replays on language switch when in view).
      const title = $(".hero__title");
      delete title.dataset.stManual;
      SpringText.play(title);
      SpringText.observe(document.querySelector("main"));
    };
    if (reducedMotion.matches || !intro.animate) { finish(); return; }
    const rooster = $(".intro__rooster", intro);
    const logo = $(".intro__logo", intro);
    const target = $("#header-logo");
    const ease = "cubic-bezier(.2,.9,.25,1)";

    rooster.animate(
      [{ opacity: 0, transform: "scale(.4) rotate(-12deg)" }, { opacity: 1, transform: "scale(1.08) rotate(4deg)", offset: 0.7 }, { opacity: 1, transform: "scale(1) rotate(0)" }],
      { duration: 480, easing: ease, fill: "forwards" }
    );
    const reveal = logo.animate(
      [{ opacity: 1, clipPath: "inset(0 100% 0 0)" }, { opacity: 1, clipPath: "inset(0 0% 0 0)" }],
      { duration: 520, delay: 380, easing: "cubic-bezier(.6,0,.3,1)", fill: "forwards" }
    );
    reveal.finished.then(() => {
      rooster.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: "forwards" });
      // Glide: from the centred logo to the header logo's place.
      const from = logo.getBoundingClientRect();
      const to = target.getBoundingClientRect();
      const dx = to.left + to.width / 2 - (from.left + from.width / 2);
      const dy = to.top + to.height / 2 - (from.top + from.height / 2);
      const s = to.width / from.width;
      target.style.opacity = "0";
      intro.animate([{ backgroundColor: "rgba(255,255,255,1)" }, { backgroundColor: "rgba(255,255,255,0)" }], { duration: 520, easing: ease, fill: "forwards" });
      const glide = logo.animate(
        [{ transform: "translate(0,0) scale(1)" }, { transform: `translate(${dx}px, ${dy}px) scale(${s})` }],
        { duration: 560, delay: 120, easing: ease, fill: "forwards" }
      );
      glide.finished.then(() => { target.style.opacity = ""; finish(); });
    }).catch(finish);
    // Safety net: never keep the page covered.
    setTimeout(() => { if (!intro.classList.contains("is-done")) { $("#header-logo").style.opacity = ""; finish(); } }, 3000);
  }

  /* ---------- Placeholder illustrations ---------- */
  const ICONS = {
    salad: '<circle cx="0" cy="8" r="30" fill="#6fa60b"/><path d="M-34 6h68a34 22 0 0 1-68 0z" fill="#fff" stroke="#141414" stroke-width="3"/><circle cx="-12" cy="-6" r="7" fill="#e1060f"/><circle cx="10" cy="-10" r="6" fill="#fbba00"/>',
    drumstick: '<path d="M-6 -30c20-6 38 10 32 30-4 14-18 18-30 14l-14 14a7 7 0 1 1-8-2l-2-2a7 7 0 1 1 2-8l14-14c-6-12-2-28 6-32z" fill="#c8741c" stroke="#141414" stroke-width="3"/><path d="M4-20c8-2 16 4 14 12" stroke="#fbba00" stroke-width="4" fill="none" stroke-linecap="round"/>',
    wrap: '<path d="M-30 20l40-50 22 18-40 50z" fill="#f4d7a1" stroke="#141414" stroke-width="3"/><path d="M-14 0l26-32" stroke="#e1060f" stroke-width="6" stroke-linecap="round"/><path d="M-6 8l26-32" stroke="#6fa60b" stroke-width="5" stroke-linecap="round"/>',
    plate: '<ellipse cx="0" cy="8" rx="40" ry="20" fill="#fff" stroke="#141414" stroke-width="3"/><ellipse cx="-10" cy="2" rx="16" ry="9" fill="#c8741c"/><path d="M6 -2h22M8 6h20M6 12h18" stroke="#fbba00" stroke-width="4" stroke-linecap="round"/>',
    cordon: '<path d="M-32 6c0-18 18-28 32-28s32 10 32 28-14 18-32 18-32 0-32-18z" fill="#d98a2b" stroke="#141414" stroke-width="3"/><path d="M-14 6c0-6 6-10 14-10s14 4 14 10" fill="none" stroke="#fbba00" stroke-width="5"/>',
    nuggets: '<g stroke="#141414" stroke-width="3" fill="#e0a040"><path d="M-30 4c-2-12 14-18 22-10 6 6 0 18-10 18-6 0-11-3-12-8z"/><path d="M0-12c4-10 22-8 22 4 0 10-12 14-20 10-4-2-4-8-2-14z"/><path d="M4 12c6-6 22-2 20 8-2 8-14 10-20 6-3-3-3-10 0-14z"/></g>',
    tacos: '<path d="M-34 14c4-28 30-40 50-32 14 6 20 22 18 32z" fill="#f4d7a1" stroke="#141414" stroke-width="3"/><path d="M-22 10c8-10 18-14 30-12" stroke="#e1060f" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M-16 14c6-6 16-8 26-6" stroke="#6fa60b" stroke-width="5" fill="none" stroke-linecap="round"/>',
    sandwich: '<path d="M-36 0c0-14 16-22 36-22s36 8 36 22z" fill="#e8b46a" stroke="#141414" stroke-width="3"/><rect x="-38" y="0" width="76" height="7" rx="3" fill="#6fa60b"/><rect x="-36" y="7" width="72" height="7" rx="3" fill="#e1060f"/><path d="M-34 14h68c0 8-14 12-34 12s-34-4-34-12z" fill="#e8b46a" stroke="#141414" stroke-width="3"/>',
    burger: '<path d="M-34-2c0-18 16-26 34-26s34 8 34 26z" fill="#e8a24a" stroke="#141414" stroke-width="3"/><rect x="-36" y="-2" width="72" height="8" rx="4" fill="#6fa60b"/><rect x="-36" y="6" width="72" height="9" rx="4" fill="#5a2a14"/><rect x="-36" y="10" width="72" height="5" fill="#fbba00"/><path d="M-34 15h68v4c0 6-8 10-34 10s-34-4-34-10z" fill="#e8a24a" stroke="#141414" stroke-width="3"/>',
    panini: '<rect x="-38" y="-14" width="76" height="30" rx="10" fill="#e8b46a" stroke="#141414" stroke-width="3"/><path d="M-26-14v30M-12-14v30M2-14v30M16-14v30" stroke="#a5651e" stroke-width="3"/>',
    pizza: '<circle r="34" fill="#f2b84b" stroke="#141414" stroke-width="3"/><circle r="27" fill="#e1060f"/><circle cx="-10" cy="-8" r="5" fill="#fbba00"/><circle cx="12" cy="-4" r="5" fill="#fbba00"/><circle cx="0" cy="12" r="5" fill="#fbba00"/><circle cx="-14" cy="10" r="3" fill="#141414"/><circle cx="14" cy="12" r="3" fill="#141414"/>',
    pasta: '<ellipse cx="0" cy="12" rx="38" ry="14" fill="#fff" stroke="#141414" stroke-width="3"/><path d="M-24 8c6-20 12 8 18-12s12 10 18-8 10 8 14 8" stroke="#fbba00" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="2" cy="4" r="6" fill="#e1060f"/>',
    gratin: '<rect x="-38" y="-6" width="76" height="30" rx="8" fill="#fff" stroke="#141414" stroke-width="3"/><path d="M-32-6c6-10 12 4 18-6s12 6 18-4 12 6 18-2 8 6 10 8" fill="#fbba00" stroke="#d98a2b" stroke-width="3"/>',
    kids: '<circle cx="0" cy="-4" r="22" fill="#fbba00" stroke="#141414" stroke-width="3"/><circle cx="-7" cy="-8" r="3" fill="#141414"/><circle cx="7" cy="-8" r="3" fill="#141414"/><path d="M-8 4c4 5 12 5 16 0" stroke="#141414" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M-12-24l-6-10M12-24l6-10" stroke="#e1060f" stroke-width="5" stroke-linecap="round"/>',
    juice: '<path d="M-18-24h36l-6 52h-24z" fill="#fbba00" stroke="#141414" stroke-width="3"/><path d="M-16-10h32" stroke="#fff" stroke-width="3"/><path d="M6-24l10-14" stroke="#e1060f" stroke-width="4" stroke-linecap="round"/><circle cx="20" cy="-22" r="8" fill="#6fa60b" stroke="#141414" stroke-width="2"/>',
    drink: '<rect x="-14" y="-26" width="28" height="54" rx="8" fill="#e1060f" stroke="#141414" stroke-width="3"/><rect x="-14" y="-8" width="28" height="14" fill="#fff"/><rect x="-8" y="-32" width="16" height="6" rx="2" fill="#141414"/>',
    dessert: '<path d="M-26 0h52l-8 26h-36z" fill="#fff" stroke="#141414" stroke-width="3"/><path d="M-24 0c0-16 10-24 24-24s24 8 24 24z" fill="#7a3b1e" stroke="#141414" stroke-width="3"/><circle cx="0" cy="-26" r="6" fill="#e1060f"/>',
  };
  function illustration(icon) {
    const glyph = ICONS[icon] || ICONS.plate;
    return `<svg viewBox="0 0 420 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="420" height="200" fill="#fff4cc"/>
      <g fill="#fbba00" opacity=".35"><circle cx="40" cy="30" r="26"/><circle cx="390" cy="170" r="40"/><circle cx="360" cy="24" r="12"/><circle cx="70" cy="178" r="14"/></g>
      <g transform="translate(210 100) scale(2.2)">${glyph}</g></svg>`;
  }

  /* ---------- Menu ---------- */
  const itemById = new Map();
  MENU.forEach((cat) => cat.items.forEach((it) => itemById.set(it.id, { ...it, cat })));
  const needsDialog = (it) => !!(it.prices || (it.options && it.options.length) || it.sauces);
  const basePrice = (it) => (it.prices ? Math.min(...Object.values(it.prices)) : it.price);

  function priceLabel(it) {
    if (it.prices) return Object.entries(it.prices).map(([s, p]) => `<span class="price">${esc(s)} ${esc(money(p))}</span>`).join(" ");
    const unit = it.unit === "pc" ? ` <small>/ ${esc(t("menu.perPiece"))}</small>` : "";
    return `<span class="price">${esc(money(it.price))}${unit}</span>`;
  }

  function controlFor(it) {
    if (needsDialog(it)) return `<button class="add-btn" type="button" data-choose="${it.id}">${esc(t("menu.choose"))}</button>`;
    const qty = qtyOfSimple(it.id);
    if (!qty) return `<button class="add-btn" type="button" data-add="${it.id}" aria-label="${esc(t("menu.add") + " · " + L(it))}">${esc(t("menu.add"))}</button>`;
    return `<span class="stepper">
      <button type="button" data-dec="${it.id}" aria-label="${esc(t("menu.decrease", { name: L(it) }))}">−</button>
      <output aria-live="polite">${qty}</output>
      <button type="button" data-inc="${it.id}" aria-label="${esc(t("menu.increase", { name: L(it) }))}">+</button></span>`;
  }

  function renderMenu() {
    const track = $("#catbar-track");
    track.innerHTML = MENU.map((c) => `<button class="chip" type="button" data-cat="${c.id}">${rich(L(c))}</button>`).join("");
    $("#menu-list").innerHTML = MENU.map((c) => `
      <article class="panel category" id="cat-${c.id}" data-cat="${c.id}">
        <div class="category__media">${c.image ? `<img src="${esc(c.image)}" alt="${esc(L(c))}" loading="lazy" width="1200" height="571">` : illustration(c.icon)}</div>
        <h3 class="category__title">${esc(L(c))}</h3>
        <ul class="items">${c.items.map((it) => `
          <li class="item" data-item="${it.id}">
            <p class="item__name">${rich(L(it))}</p>
            ${it.desc ? `<p class="item__desc">${rich(L(it.desc))}</p>` : ""}
            <div class="item__side">${priceLabel(it)}<span class="item__ctl">${controlFor(it)}</span></div>
          </li>`).join("")}</ul>
      </article>`).join("");
    setActiveCat(activeCat || MENU[0].id, false);
  }

  function refreshControls() {
    $$(".item").forEach((li) => {
      const it = itemById.get(li.dataset.item);
      $(".item__ctl", li).innerHTML = controlFor(it);
    });
  }

  /* ---------- Category bar: scroll to, and highlight the active category ---------- */
  let activeCat = null;
  let spyLockUntil = 0;
  const offsetTop = () => $("#header").offsetHeight + $("#catbar").offsetHeight + 8;

  function setActiveCat(id, centre = true) {
    activeCat = id;
    $$(".chip").forEach((c) => {
      const on = c.dataset.cat === id;
      c.classList.toggle("is-active", on);
      if (on) c.setAttribute("aria-current", "true"); else c.removeAttribute("aria-current");
    });
    if (centre) centreChip(id);
  }
  function centreChip(id) {
    const chip = $(`.chip[data-cat="${id}"]`);
    const track = $("#catbar-track");
    if (!chip) return;
    const cr = chip.getBoundingClientRect(), tr = track.getBoundingClientRect();
    const delta = cr.left + cr.width / 2 - (tr.left + tr.width / 2);
    track.scrollBy({ left: delta, behavior: reducedMotion.matches ? "auto" : "smooth" });
  }
  function goToCat(id) {
    const sec = $(`#cat-${id}`);
    if (!sec) return;
    setActiveCat(id);
    const y = sec.getBoundingClientRect().top + scrollY - offsetTop();
    // Keep the clicked category highlighted while the page scrolls (it may not reach the top near the end of the menu).
    spyLockUntil = performance.now() + 1200;
    scrollTo({ top: Math.max(0, y), behavior: reducedMotion.matches ? "auto" : "smooth" });
  }
  function spy() {
    if (performance.now() < spyLockUntil) return;
    const line = offsetTop() + 4;
    const secs = $$(".category");
    if (!secs.length) return;
    let current = secs[0].dataset.cat;
    for (const s of secs) { if (s.getBoundingClientRect().top <= line) current = s.dataset.cat; else break; }
    if (current !== activeCat) setActiveCat(current);
  }
  let spyQueued = false;
  function onScroll() {
    if (spyQueued) return;
    spyQueued = true;
    requestAnimationFrame(() => { spyQueued = false; spy(); });
  }
  function onScrollEnd() { if (performance.now() < spyLockUntil) spyLockUntil = performance.now() + 120; }

  /* ---------- Cart ---------- */
  let cart = loadCart();
  function loadCart() {
    try {
      const raw = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      return Array.isArray(raw) ? raw.filter((l) => itemById.has(l.id) && l.qty > 0) : [];
    } catch (e) { return []; }
  }
  function saveCart() { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) { /* storage unavailable */ } }
  const lineKey = (l) => [l.id, l.size || "", JSON.stringify(l.opts || {}), (l.sauces || []).join("+")].join("|");
  function unitPrice(l) { const it = itemById.get(l.id); return it.prices ? it.prices[l.size] : it.price; }
  const lineTotal = (l) => unitPrice(l) * l.qty;
  const subtotal = () => cart.reduce((s, l) => s + lineTotal(l), 0);
  const count = () => cart.reduce((s, l) => s + l.qty, 0);
  function qtyOfSimple(id) { const l = cart.find((x) => x.id === id && !x.size && !x.opts && !x.sauces); return l ? l.qty : 0; }

  function addLine(line) {
    const key = lineKey(line);
    const found = cart.find((l) => lineKey(l) === key);
    if (found) found.qty += line.qty; else cart.push(line);
    cartChanged();
  }
  function changeQty(key, delta) {
    const l = cart.find((x) => lineKey(x) === key);
    if (!l) return;
    l.qty += delta;
    if (l.qty <= 0) cart = cart.filter((x) => x !== l);
    cartChanged();
  }
  function cartChanged() { saveCart(); refreshControls(); renderCart(); }

  function lineDetails(l) {
    const it = itemById.get(l.id);
    const sep = lang === "ar" ? ": " : " : ";
    const parts = [];
    if (l.size) parts.push(`${t("options.size")} ${l.size}`);
    if (l.opts) (it.options || []).forEach((o) => {
      const ch = o.choices.find((c) => c.id === l.opts[o.id]);
      if (ch) parts.push(`${L(o)}${sep}${L(ch)}`);
    });
    if (l.sauces && l.sauces.length) parts.push(`${t("options.sauces")}${sep}${l.sauces.map((id) => L(SAUCES.find((s) => s.id === id))).join(lang === "ar" ? "، " : ", ")}`);
    return parts;
  }

  function renderCart() {
    const n = count();
    const badge = $("#cart-count");
    badge.textContent = n;
    badge.hidden = n === 0;
    const bar = $("#cart-bar");
    bar.hidden = n === 0;
    document.body.classList.toggle("has-cart", n > 0);
    $("#cart-bar-meta").innerHTML = `${esc(t("cart.items", { n }))} · ${esc(money(subtotal()))}`;

    $("#cart-lines").innerHTML = cart.map((l) => {
      const it = itemById.get(l.id);
      const key = esc(lineKey(l));
      const det = lineDetails(l);
      return `<li class="cart-line">
        <p class="cart-line__name">${rich(L(it))}</p>
        ${det.length ? `<p class="cart-line__opts">${det.map(rich).join(" · ")}</p>` : `<span></span>`}
        <div class="cart-line__side">
          <span class="cart-line__total">${esc(money(lineTotal(l)))}</span>
          <span class="stepper">
            <button type="button" data-line-dec="${key}" aria-label="${esc(t("menu.decrease", { name: L(it) }))}">−</button>
            <output>${l.qty}</output>
            <button type="button" data-line-inc="${key}" aria-label="${esc(t("menu.increase", { name: L(it) }))}">+</button>
          </span>
        </div></li>`;
    }).join("");
    $("#cart-empty").hidden = n > 0;
    renderTotals();
    $("#cart-next").disabled = n === 0;
    $("#cart-clear").hidden = n === 0;
    if (n === 0 && !$("#checkout-form").hidden) showStep("items");
  }

  function mode() { const r = $('input[name="mode"]:checked'); return r ? r.value : "pickup"; }
  function deliveryFee() { return !$("#checkout-form").hidden && mode() === "delivery" ? C.delivery.fee : 0; }
  function renderTotals() {
    const sub = subtotal(), fee = deliveryFee();
    let html = `<dt>${esc(t("cart.subtotal"))}</dt><dd>${esc(money(sub))}</dd>`;
    if (fee) html += `<dt>${esc(t("cart.deliveryFee"))}</dt><dd>${esc(money(fee))}</dd>`;
    html += `<dt class="is-total">${esc(t("cart.total"))}</dt><dd class="is-total">${esc(money(sub + fee))}</dd>`;
    $("#totals").innerHTML = html;
  }

  /* ---------- Options dialog ---------- */
  let optionsItem = null;
  function openOptions(id) {
    const it = itemById.get(id);
    optionsItem = it;
    $("#options-title").innerHTML = rich(L(it));
    let html = "";
    if (it.prices) {
      const sizes = Object.keys(it.prices);
      html += `<fieldset class="opt-group"><legend>${esc(t("options.size"))} <small>(${esc(t("options.required"))})</small></legend>
        ${sizes.map((s, i) => `<label class="opt"><input type="radio" name="size" value="${esc(s)}" ${i === 0 ? "checked" : ""}><span>${esc(s)}</span><span class="opt__price">${esc(money(it.prices[s]))}</span></label>`).join("")}</fieldset>`;
    }
    (it.options || []).forEach((o) => {
      html += `<fieldset class="opt-group" data-opt="${o.id}"><legend>${rich(L(o))} <small>(${esc(t("options.required"))})</small></legend>
        ${o.choices.map((c) => `<label class="opt"><input type="radio" name="opt-${o.id}" value="${c.id}"><span>${rich(L(c))}</span></label>`).join("")}</fieldset>`;
    });
    if (it.sauces && SAUCES.length) {
      html += `<fieldset class="opt-group" data-sauces><legend>${esc(t("options.sauces"))} <small>(${esc(t("options.saucesHint", { max: MAX_SAUCES }))})</small></legend>
        ${SAUCES.map((s) => `<label class="opt"><input type="checkbox" name="sauce" value="${s.id}"><span>${rich(L(s))}</span></label>`).join("")}</fieldset>`;
    }
    $("#options-body").innerHTML = html;
    $("#options-error").textContent = "";
    updateOptionsPrice();
    openDialog($("#options-dialog"));
  }
  function updateOptionsPrice() {
    const it = optionsItem;
    const size = $('#options-body input[name="size"]:checked');
    const price = it.prices ? it.prices[size ? size.value : Object.keys(it.prices)[0]] : it.price;
    $("#options-submit").textContent = t("options.addToOrder", { price: money(price) });
    // Sauce limit: disable the rest once the maximum is ticked.
    const boxes = $$('#options-body input[name="sauce"]');
    const ticked = boxes.filter((b) => b.checked).length;
    boxes.forEach((b) => { b.disabled = !b.checked && ticked >= MAX_SAUCES; });
  }
  function submitOptions(e) {
    e.preventDefault();
    const it = optionsItem;
    const line = { id: it.id, qty: 1 };
    if (it.prices) line.size = $('#options-body input[name="size"]:checked').value;
    if (it.options && it.options.length) {
      line.opts = {};
      for (const o of it.options) {
        const r = $(`#options-body input[name="opt-${o.id}"]:checked`);
        if (!r) { $("#options-error").textContent = t("options.pickRequired", { label: L(o) }); $(`[data-opt="${o.id}"] input`).focus(); return; }
        line.opts[o.id] = r.value;
      }
    }
    if (it.sauces) {
      const s = $$('#options-body input[name="sauce"]:checked').map((b) => b.value);
      if (s.length) line.sauces = s;
    }
    addLine(line);
    closeDialog($("#options-dialog"));
  }

  /* ---------- Dialog helpers ---------- */
  function openDialog(d) { if (!d.open) d.showModal(); document.body.classList.add("is-locked"); }
  function closeDialog(d) { if (d.open) d.close(); }
  function onDialogClose() { if (!$$("dialog").some((d) => d.open)) document.body.classList.remove("is-locked"); }

  /* ---------- Cart / checkout dialog ---------- */
  function openCart() { showStep("items"); openDialog($("#cart-dialog")); }
  function showStep(step) {
    const checkout = step === "checkout";
    $("#cart-step-items").hidden = checkout;
    $("#checkout-form").hidden = !checkout;
    $("#cart-back").hidden = !checkout;
    $("#cart-next").hidden = checkout;
    $("#cart-clear").hidden = checkout || count() === 0;
    $("#send-btn").hidden = !checkout;
    $("#cart-title").textContent = checkout ? t("checkout.title") : t("cart.title");
    if (checkout) renderCheckout();
    renderTotals();
  }

  function renderCheckout() {
    const warn = $("#closed-warning");
    warn.hidden = isOpen();
    warn.textContent = t("checkout.closedWarning", { time: C.hours.open });
    $("#delivery-info").innerHTML = rich(t("checkout.deliveryInfo", { km: C.delivery.maxKm, fee: money(C.delivery.fee) }));
    const delivery = mode() === "delivery";
    $("#delivery-box").hidden = !delivery;
    $("#address-field").hidden = !delivery;
    if (delivery) setupMap();
    updateDeliveryStatus();
    renderTotals();
  }

  /* ---------- Delivery map (Leaflet, loaded on demand) ---------- */
  let map = null, youMarker = null, youPos = null;
  let leafletLoading = null;
  function loadLeaflet() {
    if (window.L && window.L.map) return Promise.resolve();
    if (!leafletLoading) {
      leafletLoading = new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = "/vendor/leaflet/leaflet.js";
        s.onload = res;
        s.onerror = rej;
        document.head.appendChild(s);
      });
    }
    return leafletLoading;
  }
  const pinIcon = (cls) => window.L.divIcon({ className: "", html: `<div class="pin ${cls}"></div>`, iconSize: [22, 22], iconAnchor: [11, 22] });
  function setupMap() {
    loadLeaflet().then(() => {
      const Lf = window.L;
      const resto = [C.location.lat, C.location.lng];
      if (!map) {
        map = Lf.map("delivery-map", { zoomControl: true, attributionControl: true }).setView(resto, 14);
        Lf.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
        Lf.marker(resto, { icon: pinIcon("pin--resto"), title: t("checkout.restaurant") }).addTo(map);
        Lf.circle(resto, { radius: C.delivery.maxKm * 1000, color: "#e1060f", weight: 2, fillOpacity: 0.06 }).addTo(map);
        map.on("click", (e) => setYou(e.latlng.lat, e.latlng.lng));
        if (youPos) setYou(youPos.lat, youPos.lng, false);
      }
      setTimeout(() => map.invalidateSize(), 60);
    }).catch(() => {});
  }
  function setYou(lat, lng, pan = true) {
    youPos = { lat, lng };
    if (map) {
      if (!youMarker) youMarker = window.L.marker([lat, lng], { icon: pinIcon("pin--you"), title: t("checkout.you") }).addTo(map);
      else youMarker.setLatLng([lat, lng]);
      if (pan) map.panTo([lat, lng]);
    }
    updateDeliveryStatus();
  }
  function distanceKm(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const kmText = (km) => km.toFixed(1).replace(".", lang === "fr" ? "," : ".");
  function deliveryState() {
    if (mode() !== "delivery") return { ok: true };
    if (!youPos) return { ok: false, msg: t("checkout.needLocation") };
    const km = distanceKm(C.location, youPos);
    if (km > C.delivery.maxKm) return { ok: false, km, msg: t("checkout.tooFar", { max: C.delivery.maxKm, km: kmText(km) }) };
    return { ok: true, km, msg: t("checkout.distance", { km: kmText(km) }) };
  }
  function updateDeliveryStatus() {
    const st = deliveryState();
    const el = $("#delivery-status");
    if (mode() !== "delivery") { el.textContent = ""; return st; }
    el.innerHTML = rich(st.msg || "");
    el.classList.toggle("is-error", !st.ok && !!youPos);
    el.classList.toggle("is-ok", st.ok);
    return st;
  }
  function useGps() {
    const el = $("#delivery-status");
    if (!navigator.geolocation) { el.textContent = t("checkout.gpsError"); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => setYou(p.coords.latitude, p.coords.longitude),
      () => { el.textContent = t("checkout.gpsError"); el.classList.add("is-error"); },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  }

  /* ---------- Customer details and sending ---------- */
  function loadCustomer() {
    try {
      const c = JSON.parse(localStorage.getItem(FORM_KEY) || "{}");
      const f = $("#checkout-form");
      ["name", "phone", "address"].forEach((k) => { if (c[k]) f.elements[k].value = c[k]; });
    } catch (e) { /* ignore */ }
  }
  function saveCustomer(data) {
    try { localStorage.setItem(FORM_KEY, JSON.stringify({ name: data.name, phone: data.phone, address: data.address })); } catch (e) { /* ignore */ }
  }

  function buildMessage(data, st) {
    const M = (k) => t("message." + k);
    const sep = lang === "ar" ? ": " : " : ";
    const lines = [`*${M("title")}*`];
    if (!isOpen()) lines.push(M("closed"));
    lines.push("");
    lines.push(`${M("mode")}${sep}${data.mode === "delivery" ? t("checkout.delivery") : t("checkout.pickup")}`);
    lines.push(`${M("name")}${sep}${data.name}`);
    lines.push(`${M("phone")}${sep}${data.phone}`);
    lines.push("");
    cart.forEach((l) => {
      const it = itemById.get(l.id);
      lines.push(`${l.qty} × ${L(it)}${l.size ? " (" + l.size + ")" : ""} · ${money(lineTotal(l))}`);
      lineDetails(l).filter((d) => !l.size || !d.startsWith(t("options.size"))).forEach((d) => lines.push(`   ${d}`));
    });
    lines.push("");
    const sub = subtotal();
    const fee = data.mode === "delivery" ? C.delivery.fee : 0;
    lines.push(`${t("cart.subtotal")}${sep}${money(sub)}`);
    if (fee) lines.push(`${t("cart.deliveryFee")}${sep}${money(fee)}`);
    lines.push(`*${t("cart.total")}${sep}${money(sub + fee)}*`);
    if (data.mode === "delivery") {
      lines.push("");
      if (data.address) lines.push(`${M("address")}${sep}${data.address}`);
      lines.push(`${M("position")}${sep}https://maps.google.com/?q=${youPos.lat.toFixed(6)},${youPos.lng.toFixed(6)}`);
      if (st.km !== undefined) lines.push(`${M("distance")}${sep}${kmText(st.km)} km`);
    }
    if (data.notes) { lines.push(""); lines.push(`${M("notes")}${sep}${data.notes}`); }
    return lines.join("\n");
  }

  function send() {
    const f = $("#checkout-form");
    const err = $("#checkout-error");
    err.textContent = "";
    $$(".field", f).forEach((x) => x.classList.remove("is-invalid"));
    const data = {
      mode: mode(),
      name: f.elements.name.value.trim(),
      phone: f.elements.phone.value.trim(),
      address: f.elements.address.value.trim(),
      notes: f.elements.notes.value.trim(),
    };
    const missing = ["name", "phone"].filter((k) => !data[k]);
    if (missing.length) {
      missing.forEach((k) => f.elements[k].closest(".field").classList.add("is-invalid"));
      err.textContent = `${t("checkout.required")}: ${missing.map((k) => t("checkout." + k)).join(", ")}`;
      f.elements[missing[0]].focus();
      return;
    }
    const st = updateDeliveryStatus();
    if (!st.ok) { err.textContent = st.msg; return; }
    saveCustomer(data);
    const url = `https://wa.me/${C.whatsapp}?text=${encodeURIComponent(buildMessage(data, st))}`;
    const w = window.open(url, "_blank", "noopener");
    if (!w) location.href = url;
  }

  /* ---------- Events ---------- */
  function bind() {
    $("#lang-toggle").addEventListener("click", switchLanguage);
    $("#catbar-track").addEventListener("click", (e) => { const b = e.target.closest("[data-cat]"); if (b) goToCat(b.dataset.cat); });
    $("#menu-list").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.add) addLine({ id: b.dataset.add, qty: 1 });
      else if (b.dataset.inc) changeQty(lineKey({ id: b.dataset.inc }), 1);
      else if (b.dataset.dec) changeQty(lineKey({ id: b.dataset.dec }), -1);
      else if (b.dataset.choose) openOptions(b.dataset.choose);
    });
    $("#order-btn").addEventListener("click", (e) => { e.preventDefault(); goToCat(MENU[0].id); });
    $("#options-form").addEventListener("submit", submitOptions);
    $("#options-body").addEventListener("change", updateOptionsPrice);
    $("#cart-btn").addEventListener("click", openCart);
    $("#cart-bar").addEventListener("click", openCart);
    $("#cart-close").addEventListener("click", () => closeDialog($("#cart-dialog")));
    $("#cart-back").addEventListener("click", () => showStep("items"));
    $("#cart-next").addEventListener("click", () => { if (count()) showStep("checkout"); });
    $("#cart-clear").addEventListener("click", () => { cart = []; cartChanged(); });
    $("#cart-lines").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.lineInc) changeQty(b.dataset.lineInc, 1);
      if (b.dataset.lineDec) changeQty(b.dataset.lineDec, -1);
    });
    $("#checkout-form").addEventListener("change", (e) => { if (e.target.name === "mode") renderCheckout(); });
    $("#checkout-form").addEventListener("submit", (e) => { e.preventDefault(); send(); });
    $("#gps-btn").addEventListener("click", useGps);
    $("#send-btn").addEventListener("click", send);
    $$("dialog").forEach((d) => {
      d.addEventListener("close", onDialogClose);
      d.addEventListener("click", (e) => { if (e.target === d) closeDialog(d); }); // click on the backdrop
    });
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("scrollend", onScrollEnd);
    addEventListener("resize", onScroll);
    setInterval(updateStatus, 30000);
  }

  /* ---------- Start ---------- */
  setupLinks();
  setupHero();
  bind();
  loadCustomer();
  applyLanguage();
  runIntro();
  spy();

  // Exposed for the automated tests.
  window.__chickenAmine = { isOpen, distanceKm, cart: () => cart, lineKey };
})();
