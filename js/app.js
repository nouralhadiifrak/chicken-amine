/* Chicken Amine: page logic (language, intro, status, menu, cart, ordering). */
(function () {
  const C = window.CONFIG;
  const MENU = window.MENU;
  const SAUCES = window.SAUCES || [];
  const MAX_SAUCES = window.MAX_SAUCES || 2;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const CART_KEY = "chickenamine.cart.v1";
  const FORM_KEY = "chickenamine.customer.v1";
  const SITE_KEY = "chickenamine.location.v1";
  const INSTALL_KEY = "chickenamine.install-later.v1";

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
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  /* ---------- The restaurant the customer orders from (two locations) ---------- */
  let site = siteFromLink() || loadSite();
  function loadSite() {
    try { const id = localStorage.getItem(SITE_KEY); return C.locations.find((l) => l.id === id) || null; } catch (e) { return null; }
  }
  // A link from a restaurant's own page (?restaurant=sidi-moumen) chooses that restaurant; the address is then tidied.
  function siteFromLink() {
    const url = new URL(location.href);
    const l = C.locations.find((x) => x.id === url.searchParams.get("restaurant"));
    if (!l) return null;
    try { localStorage.setItem(SITE_KEY, l.id); } catch (e) { /* storage unavailable */ }
    url.searchParams.delete("restaurant");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
    return l;
  }
  // The chosen restaurant; the first one until the customer picks.
  const S = () => site || C.locations[0];

  /* ---------- Opening hours (Casablanca time) ---------- */
  function casablancaMinutes(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: C.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
    const h = +parts.find((p) => p.type === "hour").value;
    const m = +parts.find((p) => p.type === "minute").value;
    return h * 60 + m;
  }
  const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function casablancaDay(date = new Date()) {
    return WEEKDAYS.indexOf(new Intl.DateTimeFormat("en-US", { timeZone: C.timeZone, weekday: "short" }).format(date));
  }
  function isOpen(now = casablancaMinutes()) {
    const o = toMin(C.hours.open), c = toMin(C.hours.close);
    return c > o ? now >= o && now < c : now >= o || now < c; // a close at or before open is after midnight
  }
  function updateStatus() {
    const el = $("#status");
    if (!el) return;
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
    applySite();
    $("#info-hours").innerHTML = rich(t("infos.hoursValue", { open: C.hours.open, close: C.hours.close }));
    $("#footer-text").innerHTML = rich(t("footer", { year: new Date().getFullYear() }));

    updateStatus();
    renderMenu();
    renderCart();
    if ($("#checkout-form").hidden === false) renderCheckout();
    if (window.SpringText) SpringText.observe(document.querySelector("main"));
  }

  // The hero title is handwritten: hidden until it is written, then each line is inked in turn along the
  // writing direction, as if with a pen (again after a language switch). Words are never cut, so the
  // joined-up script stays intact.
  let writeRun = 0;
  async function writeTitle() {
    const run = ++writeRun;
    const title = $(".hero__title");
    title.classList.remove("is-writing");
    const text = t("hero.title");
    if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
    if (run !== writeRun) return;
    // find the lines as the browser wraps them
    title.innerHTML = text.split(/\s+/).map((w) => `<span class="hw-word">${esc(w)}</span>`).join(" ");
    const lines = [];
    $$(".hw-word", title).forEach((w) => {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.top - w.offsetTop) < 4) last.words.push(w.textContent);
      else lines.push({ top: w.offsetTop, words: [w.textContent] });
    });
    // each line takes time in proportion to its length, the next starts as the pen reaches the end
    let at = 0;
    title.innerHTML = lines.map((l) => {
      const s = l.words.join(" ");
      const ms = Math.round(380 + s.length * 70);
      const html = `<span class="hw-line" style="--hw-delay:${at}ms;--hw-time:${ms}ms">${esc(s)}</span>`;
      at += ms - 120;
      return html;
    }).join(" ");
    void title.offsetWidth;
    title.classList.add("is-writing");
  }

  function switchLanguage() {
    lang = lang === "ar" ? "fr" : "ar";
    const url = new URL(location.href);
    if (lang === "ar") url.searchParams.set("lang", "ar"); else url.searchParams.delete("lang");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
    applyLanguage();
    writeTitle();
    // Headings already on screen replay at once.
    $$("main h1, main h2, main h3").forEach((h) => {
      const r = h.getBoundingClientRect();
      if (r.top < innerHeight && r.bottom > 0 && window.SpringText) SpringText.play(h);
    });
  }

  /* ---------- The chosen restaurant's links: map, phone, Instagram, address ---------- */
  const phoneText = (p) => p.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
  function applySite() {
    const s = S();
    $("#location-btn").href = s.googleMapsUrl;
    $("#directions-btn").href = s.googleMapsUrl;
    $("#info-phone").href = "tel:" + s.phoneIntl;
    $("#info-phone").textContent = phoneText(s.phone);
    $("#info-instagram").href = s.instagram;
    $("#info-instagram").textContent = s.instagramHandle;
    $("#ig-float").href = s.instagram;
    $("#info-address").innerHTML = rich(L(s.address));
    const embed = `https://maps.google.com/maps?q=${s.location.lat},${s.location.lng}&z=16&output=embed`;
    if ($("#map-embed").getAttribute("src") !== embed) $("#map-embed").src = embed;
    $("#site-btn-name").textContent = L(s.short);
    $("#site-btn").setAttribute("aria-label", `${t("site.change")} · ${L(s.short)}`);
    $("#checkout-site").innerHTML = rich(t("site.current", { name: L(s.name) }));
    moveMapToSite();
  }

  /* ---------- Choosing the restaurant: on the first visit (required), or from the header ---------- */
  let sitePos = null; // the customer's position, when they let us find the nearest restaurant
  function renderSites() {
    const near = sitePos && C.locations.reduce((a, b) => (distanceKm(sitePos, a.location) <= distanceKm(sitePos, b.location) ? a : b));
    $("#site-list").innerHTML = C.locations.map((l) => {
      const km = sitePos ? distanceKm(sitePos, l.location) : null;
      const tags = [l === near ? t("site.nearestTag") : "", km !== null ? t("site.away", { km: kmText(km) }) : ""].filter(Boolean).join(" · ");
      return `<li><button class="site-card${l === near ? " is-nearest" : ""}${site === l ? " is-current" : ""}" type="button" data-site="${l.id}">
        <span class="site-card__name">${rich(L(l.short))}</span>
        <span class="site-card__addr">${rich(L(l.address))}</span>
        <span class="site-card__phone" dir="ltr">${esc(phoneText(l.phone))}</span>
        ${tags ? `<span class="site-card__tag">${rich(tags)}</span>` : ""}
        <span class="site-card__go">${esc(t("site.choose"))}</span>
      </button></li>`;
    }).join("");
  }
  function openSites() {
    const d = $("#site-dialog");
    // The first time, a restaurant must be chosen: the sheet cannot be closed without one.
    d.dataset.locked = site ? "" : "1";
    $("#site-close").hidden = !site;
    renderSites();
    openDialog(d);
  }
  function chooseSite(id) {
    const l = C.locations.find((x) => x.id === id);
    if (!l) return;
    site = l;
    try { localStorage.setItem(SITE_KEY, l.id); } catch (e) { /* storage unavailable */ }
    applySite();
    if (!$("#checkout-form").hidden) renderCheckout();
    closeDialog($("#site-dialog"));
  }
  function findNearestSite() {
    const el = $("#site-status");
    el.classList.remove("is-error");
    if (!navigator.geolocation) { el.textContent = t("site.gpsError"); el.classList.add("is-error"); return; }
    el.textContent = t("site.locating");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        sitePos = { lat: p.coords.latitude, lng: p.coords.longitude };
        el.textContent = "";
        renderSites();
        // It is also the most likely delivery point.
        if (!youPos) youPos = { ...sitePos };
        const best = $("#site-list .is-nearest");
        if (best) best.focus();
      },
      () => { el.textContent = t("site.gpsError"); el.classList.add("is-error"); },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  }

  /* ---------- Hero: the turning plate ---------- */
  function setupHero() {
    const v = C.plateVideo || {};
    if (!v.mp4 && !v.webm) return;
    const media = $("#hero-plate");
    const video = document.createElement("video");
    // Phones only autoplay a video that is muted inline from the start: set it as attributes too.
    ["muted", "autoplay", "loop", "playsinline", "webkit-playsinline"].forEach((a) => video.setAttribute(a, ""));
    video.muted = video.defaultMuted = video.loop = video.playsInline = video.autoplay = true;
    video.preload = "auto";
    if (v.poster) video.poster = v.poster;
    if (v.webm) video.insertAdjacentHTML("beforeend", `<source src="${esc(v.webm)}" type="video/webm">`);
    if (v.mp4) video.insertAdjacentHTML("beforeend", `<source src="${esc(v.mp4)}" type="video/mp4">`);
    media.insertAdjacentHTML("afterbegin", '<div class="hero__light"></div>');
    media.appendChild(video);
    // The slow turn is the point of the hero, so it runs even with reduced motion (nothing flashes or moves
    // across the screen).
    const tryPlay = () => { const p = video.play(); if (p && p.catch) p.catch(() => {}); };
    tryPlay();
    // Some browsers (data or battery savers) only allow it after a touch, or once the video is on screen.
    ["touchstart", "pointerdown", "scroll", "keydown"].forEach((ev) => addEventListener(ev, tryPlay, { passive: true, once: true }));
    document.addEventListener("visibilitychange", () => { if (!document.hidden) tryPlay(); });
    if ("IntersectionObserver" in window) new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && tryPlay())).observe(media);
    // Extra fries, carrot crumbs and herbs floating on both sides of the plate (cut from the video itself).
    // x / y: position in % of the plate box; on PC they spread wider (--spread in the CSS).
    const CRUMBS = [
      ["fry1", 6, 30, 74, 0], ["herb1", 15, 9, 38, 1.2], ["carrot2", 3, 58, 40, 2.1], ["fry4", 13, 86, 91, 0.6],
      ["herb2", 22, 70, 49, 2.8], ["fry6", 10, 47, 60, 3.3],
      ["fry2", 90, 18, 100, 0.4], ["herb4", 82, 6, 30, 1.8], ["carrot1", 94, 50, 70, 2.5], ["fry3", 84, 66, 33, 1.1],
      ["herb3", 96, 84, 42, 3.0], ["fry5", 78, 92, 55, 0.2],
    ];
    const crumbs = document.createElement("div");
    crumbs.className = "hero__crumbs";
    crumbs.innerHTML = CRUMBS.map(([n, x, y, w, d]) =>
      `<img src="/assets/crumbs/${n}.webp" alt="" style="--x:${x};--y:${y};--w:${(w / 720 * 100).toFixed(2)}%;--d:${d}s">`).join("");
    media.appendChild(crumbs);
    // If the video still will not play, turn the plate of the still frame instead.
    const spin = document.createElement("div");
    spin.className = "hero__spin";
    media.appendChild(spin);
    video.addEventListener("playing", () => media.classList.remove("is-spinning"));
    setTimeout(() => { if (video.paused) media.classList.add("is-spinning"); }, 2500);
  }

  /* ---------- Intro: the rooster, the name typed out, the sprig, then a glide into the header ---------- */
  function runIntro() {
    const intro = $("#intro");
    const target = $("#header-logo");
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      target.style.opacity = "";
      intro.classList.add("is-done");
      document.documentElement.classList.add("no-intro");
      if (!site) openSites();
      writeTitle();
      SpringText.observe(document.querySelector("main"));
    };
    if (reducedMotion.matches || !intro.animate) { finish(); return; }

    const stage = $("#intro-stage");
    const layer = (n) => $(".intro__" + n, intro);
    const ease = "cubic-bezier(.2,.9,.25,1)";
    const slide = "cubic-bezier(.22,1.25,.36,1)"; // slight overshoot as each word lands
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const show = (el, frames, opts) => el.animate(frames, { easing: ease, fill: "forwards", ...opts }).finished;
    // The rooster's centre in the logo is at 17% / 41%: these shifts put it in the middle of the screen.
    const centre = "translate(33%, 9%)";

    (async () => {
      await Promise.all($$(".intro__layer", intro).map((img) => (img.decode ? img.decode().catch(() => {}) : null)));

      // 1. The rooster alone, in the middle.
      await show(layer("rooster"), [
        { opacity: 0, transform: `${centre} scale(.3) rotate(-14deg)` },
        { opacity: 1, transform: `${centre} scale(1.12) rotate(5deg)`, offset: 0.7 },
        { opacity: 1, transform: `${centre} scale(1) rotate(0)` },
      ], { duration: 480 });
      await wait(140);

      // 2. "hicken" slides in from the right while the rooster steps aside to its place.
      show(layer("rooster"), [{ transform: `${centre}` }, { transform: "none" }], { duration: 560 });
      await show(layer("hicken"), [
        { opacity: 0, transform: "translateX(70vw) skewX(-12deg)" },
        { opacity: 1, transform: "translateX(-2%) skewX(4deg)", offset: 0.75 },
        { opacity: 1, transform: "none" },
      ], { duration: 600, easing: slide });

      // 3. "AMINE" slides in from the right.
      await show(layer("amine"), [
        { opacity: 0, transform: "translateX(70vw) skewX(-12deg)" },
        { opacity: 1, transform: "translateX(-2%) skewX(4deg)", offset: 0.75 },
        { opacity: 1, transform: "none" },
      ], { duration: 560, easing: slide });

      // 4. The flower grows slowly out of the logo, from its stem (the layer's transform-origin) up.
      await show(layer("sprig"), [
        { opacity: 0, transform: "scale(.02) rotate(-12deg)" },
        { opacity: 1, transform: "scale(.25) rotate(-9deg)", offset: 0.15 },
        { opacity: 1, transform: "scale(.8) rotate(-2deg)", offset: 0.7 },
        { opacity: 1, transform: "none" },
      ], { duration: 1500, easing: "cubic-bezier(.33,0,.25,1)" });
      await wait(260);

      // 5. The finished logo glides into its place in the header.
      const from = stage.getBoundingClientRect();
      const to = target.getBoundingClientRect();
      const k = to.width / from.width;
      target.style.opacity = "0";
      intro.animate([{ backgroundColor: "rgba(255,255,255,1)" }, { backgroundColor: "rgba(255,255,255,0)" }], { duration: 520, easing: ease, fill: "forwards" });
      await stage.animate(
        [{ transform: "none" }, { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${k})` }],
        { duration: 600, easing: ease, fill: "forwards" }
      ).finished;
      finish();
    })().catch(finish);
    // Safety net: never keep the page covered.
    setTimeout(finish, 6500);
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

  /* ---------- Menu: categories first, then the dishes of the chosen one ---------- */
  const itemById = new Map();
  MENU.forEach((cat) => cat.items.forEach((it) => itemById.set(it.id, { ...it, cat })));
  const catById = new Map(MENU.map((c) => [c.id, c]));
  const hasSauces = (it) => SAUCES.length > 0 && (it.sauces !== undefined ? !!it.sauces : !!it.cat.sauces);
  const needsDialog = (it) => !!(it.prices || (it.options && it.options.length));
  const basePrice = (it) => (it.prices ? Math.min(...Object.values(it.prices)) : it.price);
  // Dishes served on some days only (the couscous on Fridays): { days, from, to }, Casablanca time.
  const availOf = (it) => it.available || it.cat.available || null;
  function isAvailable(it, now = new Date()) {
    const a = availOf(it);
    if (!a) return true;
    const m = casablancaMinutes(now);
    return a.days.indexOf(casablancaDay(now)) !== -1 && m >= toMin(a.from) && m < toMin(a.to);
  }
  function availText(a, key, vars) {
    const D = window.I18N[lang].days;
    return t(key, { ...vars, days: a.days.map((d) => D[d]).join(lang === "ar" ? " و" : ", "), from: a.from, to: a.to });
  }

  function priceLabel(it) {
    if (it.prices) return Object.entries(it.prices).map(([s, p]) => `<span class="price">${esc(s)} ${esc(money(p))}</span>`).join(" ");
    const unit = it.unit === "pc" ? ` <small>/ ${esc(t("menu.perPiece"))}</small>` : "";
    return `<span class="price">${esc(money(it.price))}${unit}</span>`;
  }

  const PLUS_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path stroke="currentColor" stroke-width="3" stroke-linecap="round" d="M5 12h14M12 5v14"/></svg>';
  function controlFor(it) {
    const qty = qtyOf(it.id);
    const label = needsDialog(it) ? t("menu.choose") : t("menu.add");
    const inCart = qty ? `<span class="in-cart" aria-label="${esc(t("menu.inCart", { n: qty }))}">${qty}</span>` : "";
    if (!isAvailable(itemById.get(it.id))) {
      const why = availText(availOf(itemById.get(it.id)), "menu.notNow");
      return `${inCart}<button class="add-btn" type="button" data-add="${it.id}" disabled title="${esc(why)}" aria-label="${esc(L(it) + " · " + why)}">${PLUS_ICON}</button>`;
    }
    return `${inCart}<button class="add-btn" type="button" data-add="${it.id}" aria-label="${esc(label + " · " + L(it))}">${PLUS_ICON}</button>`;
  }

  // A photo of the dish when it has one (item.image), otherwise its emoji on a tile.
  function thumbFor(it) {
    it = itemById.get(it.id);
    if (it.image) return `<div class="item__thumb"><img src="${esc(it.image)}" alt="" loading="lazy" width="160" height="160"></div>`;
    return `<div class="item__thumb" aria-hidden="true"><span>${it.emoji || it.cat.emoji || "🍽️"}</span></div>`;
  }

  let currentCat = null;

  function renderHome() {
    $("#cat-grid").innerHTML = MENU.map((c) => {
      const from = Math.min(...c.items.map(basePrice));
      return `<button class="cat-tile" type="button" data-open-cat="${c.id}" aria-label="${esc(t("menu.open", { name: L(c) }))}">
        <span class="cat-tile__media">${c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy" width="600" height="400">` : illustration(c.icon)}</span>
        <span class="cat-tile__text"><span class="cat-tile__name">${rich(L(c))}</span>
        <span class="cat-tile__meta">${esc(t("menu.dishes", { n: c.items.length }))} · ${esc(t("menu.from", { price: money(from) }))}</span></span>
      </button>`;
    }).join("");
  }

  // The torn-paper strip between the hero and the menu: the categories move across it (tap to open).
  // The track holds the list twice so the loop has no gap; the copy is hidden from screen readers and the keyboard.
  function renderBand() {
    const cats = (copy) => MENU.map((c) => `<button class="band__item" type="button" data-open-cat="${c.id}"${copy ? ' tabindex="-1"' : ""}>${esc(L(c))}</button>`).join("");
    $("#band-front").innerHTML = `<div class="band__group">${cats(false)}</div><div class="band__group" aria-hidden="true">${cats(true)}</div>`;
  }

  // A merged category lists its dishes under their original sections (groups); others in one list.
  function sections(c) {
    if (!c.groups) return [[null, c.items]];
    return c.groups.map((g) => [g, c.items.filter((it) => it.group === g.id)]).filter(([, items]) => items.length);
  }

  function renderDetail() {
    const c = catById.get(currentCat);
    if (!c) return;
    $("#catbar-track").innerHTML = MENU.map((x) => `<button class="chip${x.id === c.id ? " is-active" : ""}" type="button" data-cat="${x.id}"${x.id === c.id ? ' aria-current="true"' : ""}>${rich(L(x))}</button>`).join("");
    $("#menu-list").innerHTML = `
      <article class="panel category" id="cat-${c.id}" data-cat="${c.id}">
        <h3 class="category__title">${esc(L(c))}</h3>
        ${c.available ? `<p class="category__note">${rich(cap(availText(c.available, "menu.onlyOn")))}</p>` : ""}
        <div class="category__body">${sections(c).map(([g, items], i) => `
          ${g && !(i === 0 && L(g) === L(c)) ? `<h4 class="items__group">${rich(L(g))}</h4>` : ""}
          <ul class="items">${items.map((it) => `
          <li class="item" data-item="${it.id}">
            ${thumbFor(it)}
            <p class="item__name">${rich(L(it))}</p>
            ${it.desc ? `<p class="item__desc">${rich(L(it.desc))}</p>` : ""}
            <div class="item__side">${priceLabel(it)}<span class="item__ctl">${controlFor(it)}</span></div>
          </li>`).join("")}</ul>`).join("")}
        </div>
      </article>`;
    requestAnimationFrame(() => centreChip(c.id));
  }

  function renderMenu() {
    renderHome();
    renderBand();
    const detail = !!currentCat;
    $("#cat-grid").hidden = detail;
    $("#menu-detail").hidden = !detail;
    if (detail) renderDetail();
  }

  function refreshControls() {
    $$(".item").forEach((li) => {
      const it = itemById.get(li.dataset.item);
      $(".item__ctl", li).innerHTML = controlFor(it);
    });
  }

  const headerH = () => $("#header").offsetHeight;
  function scrollToMenu() {
    const y = $("#menu").getBoundingClientRect().top + scrollY - headerH();
    scrollTo({ top: Math.max(0, y), behavior: reducedMotion.matches ? "auto" : "smooth" });
  }
  function centreChip(id) {
    const chip = $(`.chip[data-cat="${id}"]`);
    const track = $("#catbar-track");
    if (!chip) return;
    const cr = chip.getBoundingClientRect(), tr = track.getBoundingClientRect();
    track.scrollBy({ left: cr.left + cr.width / 2 - (tr.left + tr.width / 2), behavior: "auto" });
  }

  // Each view has its own address (#categorie-tacos), so the phone's back button returns to the categories.
  const catHash = (id) => (id ? "#categorie-" + id : "#menu");
  // Sections that were merged into another category keep working as links.
  const MERGED = Object.fromEntries(MENU.flatMap((c) => (c.groups || []).map((g) => [g.id, c.id])));
  function catFromHash() {
    const m = /^#categorie-(.+)$/.exec(location.hash);
    const id = m && (catById.has(m[1]) ? m[1] : MERGED[m[1]]);
    return id || null;
  }
  function openCategory(id, push = true) {
    if (!catById.has(id)) return;
    const fromHome = !currentCat;
    currentCat = id;
    if (push) history[fromHome ? "pushState" : "replaceState"]({ cat: id }, "", location.pathname + location.search + catHash(id));
    renderMenu();
    if (window.SpringText) { SpringText.observe($("#menu-list")); SpringText.play($(".category__title")); }
    scrollToMenu();
    setTimeout(offerInstall, 1500);
  }
  function showCategories(push = true) {
    const was = currentCat;
    currentCat = null;
    if (push && was) {
      if (history.state && history.state.cat) history.back();
      else history.replaceState(null, "", location.pathname + location.search + "#menu");
    }
    renderMenu();
    scrollToMenu();
    const tile = was && $(`.cat-tile[data-open-cat="${was}"]`);
    if (tile) tile.focus({ preventScroll: true });
  }
  function onPopState() {
    const id = catFromHash();
    if (id === currentCat) return;
    currentCat = id;
    renderMenu();
    if (id && window.SpringText) SpringText.observe($("#menu-list"));
    scrollToMenu();
  }

  /* ---------- Header: shadow once it floats over the page, current section underlined ---------- */
  function updateHeader() {
    $("#header").classList.toggle("is-floating", scrollY > 4);
    const line = headerH() + 80;
    let current = "";
    ["menu", "infos"].forEach((id) => { const r = $("#" + id).getBoundingClientRect(); if (r.top <= line && r.bottom > line) current = id; });
    $$(".header__nav a").forEach((a) => {
      if (a.dataset.nav === current) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
    });
  }
  let headerQueued = false;
  function onScroll() {
    if (headerQueued) return;
    headerQueued = true;
    requestAnimationFrame(() => { headerQueued = false; updateHeader(); });
  }

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
  const qtyOf = (id) => cart.reduce((n, l) => n + (l.id === id ? l.qty : 0), 0);

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

  // The cart rocks on its wheels while it holds something, and once more on every add.
  function animateCart(bump) {
    const has = count() > 0;
    $$(".cart-ico").forEach((ico) => {
      ico.classList.toggle("is-looping", has);
      if (bump) { ico.classList.remove("is-bump"); void ico.getBoundingClientRect(); ico.classList.add("is-bump"); }
    });
  }

  const BIN_ICON = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12.2A2 2 0 0 0 8.5 21h7a2 2 0 0 0 2-1.8L18.5 7M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/></svg>';

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
    Kit.roll(badge, n);
    badge.hidden = n === 0;
    const bar = $("#cart-bar");
    bar.hidden = n === 0;
    document.body.classList.toggle("has-cart", n > 0);
    animateCart(false);
    $("#cart-bar-items").textContent = t("cart.items", { n });
    Kit.setMoney($("#cart-bar-total"), subtotal(), C.currency[lang]);

    // Keep each line's shown numbers so the new ones roll from them.
    const before = new Map($$("#cart-lines .cart-line").map((li) => [li.dataset.key, {
      total: (($(".cart-line__total .roll", li) || {}).dataset || {}).v,
      qty: $(".stepper output", li).dataset.v,
    }]));
    $("#cart-lines").innerHTML = cart.map((l) => {
      const it = itemById.get(l.id);
      const key = esc(lineKey(l));
      const det = lineDetails(l);
      // At one, the minus becomes a bin: the next tap removes the dish.
      const dec = l.qty > 1
        ? `<button type="button" data-line-dec="${key}" aria-label="${esc(t("menu.decrease", { name: L(it) }))}">−</button>`
        : `<button type="button" class="stepper__bin" data-line-dec="${key}" aria-label="${esc(t("cart.remove") + " · " + L(it))}">${BIN_ICON}</button>`;
      return `<li class="cart-line" data-key="${key}">
        <p class="cart-line__name">${rich(L(it))}</p>
        ${det.length ? `<p class="cart-line__opts">${det.map(rich).join(" · ")}</p>` : `<span></span>`}
        <div class="cart-line__side">
          <span class="cart-line__total"></span>
          <span class="stepper">
            ${dec}
            <output class="roll"></output>
            <button type="button" data-line-inc="${key}" aria-label="${esc(t("menu.increase", { name: L(it) }))}">+</button>
          </span>
        </div></li>`;
    }).join("");
    $$("#cart-lines .cart-line").forEach((li) => {
      const l = cart.find((x) => lineKey(x) === li.dataset.key);
      const was = before.get(li.dataset.key) || {};
      Kit.setMoney($(".cart-line__total", li), lineTotal(l), C.currency[lang], was.total);
      Kit.roll($(".stepper output", li), l.qty, was.qty);
    });
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
    const shown = {};
    $$("#totals [data-sum] .roll").forEach((r) => { shown[r.closest("[data-sum]").dataset.sum] = r.dataset.v; });
    let html = `<dt>${esc(t("cart.subtotal"))}</dt><dd data-sum="sub"><span></span></dd>`;
    if (fee) html += `<dt>${esc(t("cart.deliveryFee"))}</dt><dd data-sum="fee"><span></span></dd>`;
    html += `<dt class="is-total">${esc(t("cart.total"))}</dt><dd class="is-total" data-sum="total"><span></span></dd>`;
    $("#totals").innerHTML = html;
    const values = { sub, fee, total: sub + fee };
    $$("#totals [data-sum]").forEach((dd) => Kit.setMoney(dd.firstChild, values[dd.dataset.sum], C.currency[lang], shown[dd.dataset.sum]));
  }

  /* ---------- Adding: emojis fly, the cart rocks, then the sauce choice ---------- */
  function emojisFor(it) {
    const list = [it.emoji || it.cat.emoji || "🍽️"];
    const d = it.desc ? it.desc.fr.toLowerCase() : "";
    if (/frites/.test(d)) list.push("🍟");
    if (/boisson|coca|soda/.test(d)) list.push("🥤");
    if (/jouet/.test(d)) list.push("🧸");
    return list;
  }
  // The kit's spree of the dish's emojis; the cart rocks and pops as they peak.
  function sprayEmojis(fromEl, it) {
    // Adding re-renders the dish's controls, so start from the button now on the page.
    if (!fromEl || !fromEl.isConnected) fromEl = $(`.item[data-item="${it.id}"] [data-add]`);
    Kit.emojiSpree(fromEl, {
      emoji: emojisFor(it),
      onLand: () => { animateCart(true); Kit.bump($("#cart-btn")); },
    });
  }

  function onAdd(id, btn) {
    const it = itemById.get(id);
    if (!isAvailable(it)) return;
    if (needsDialog(it)) { openOptions(id, btn); return; }
    // Sauces are chosen first; the dish goes into the order (and the emojis fly) once that is settled.
    if (hasSauces(it)) { openSauces(it, btn); return; }
    addDish({ id, qty: 1 }, btn);
  }
  function addDish(line, fromEl) {
    addLine(line);
    sprayEmojis(fromEl, itemById.get(line.id));
  }

  /* ---------- Sauce sheet: before a dish goes into the order, up to MAX_SAUCES sauces to go with it ---------- */
  let sauceItem = null, sauceFrom = null;
  function openSauces(it, fromEl) {
    sauceItem = it;
    sauceFrom = fromEl;
    $("#sauce-title").innerHTML = rich(L(it));
    $("#sauce-added").innerHTML = rich(t("sauce.pick", { max: MAX_SAUCES }));
    $("#sauce-list").innerHTML = SAUCES.map(saucePill).join("");
    updateSauceLimit();
    openDialog($("#sauce-dialog"));
  }
  function updateSauceLimit() {
    const boxes = $$('#sauce-list input[name="sauce"]');
    const ticked = boxes.filter((b) => b.checked).length;
    boxes.forEach((b) => { b.disabled = !b.checked && ticked >= MAX_SAUCES; });
    $("#sauce-ok").disabled = ticked === 0;
  }
  // "Valider" adds the dish with its sauces, "Sans sauce" without; closing the sheet adds nothing.
  function finishSauces(sauces) {
    const it = sauceItem;
    sauceItem = null;
    closeDialog($("#sauce-dialog"));
    if (!it) return;
    const line = { id: it.id, qty: 1 };
    if (sauces.length) line.sauces = sauces;
    addDish(line, sauceFrom);
  }
  function submitSauces(e) {
    e.preventDefault();
    if (e.submitter && e.submitter.value === "cancel") { sauceItem = null; closeDialog($("#sauce-dialog")); return; }
    finishSauces($$('#sauce-list input[name="sauce"]:checked').map((b) => b.value));
  }

  /* ---------- Options dialog (sizes, required choices; sauces too when the dish has them) ---------- */
  let optionsItem = null, optionsFrom = null, optionsQty = 1;
  function openOptions(id, fromEl) {
    const it = itemById.get(id);
    optionsItem = it;
    optionsFrom = fromEl || null;
    $("#options-title").innerHTML = rich(L(it));
    optionsQty = 1;
    const need = `<small>(${esc(t("options.required"))})</small>`;
    let html = "";
    if (it.prices) {
      const sizes = Object.keys(it.prices);
      html += `<fieldset class="field"><legend class="field__label">${esc(t("options.size"))} ${need}</legend><div class="pills">
        ${sizes.map((s, i) => pill("radio", "size", s, `${esc(s)} · ${esc(money(it.prices[s]))}`, i === 0)).join("")}</div></fieldset>`;
    }
    (it.options || []).forEach((o) => {
      html += `<fieldset class="field" data-opt="${o.id}"><legend class="field__label">${rich(L(o))} ${need}</legend><div class="pills">
        ${o.choices.map((c) => pill("radio", "opt-" + o.id, c.id, rich(L(c)))).join("")}</div></fieldset>`;
    });
    if (hasSauces(it)) {
      html += `<fieldset class="field" data-sauces><legend class="field__label">${esc(t("options.sauces"))} <small>(${esc(t("options.saucesHint", { max: MAX_SAUCES }))})</small></legend><div class="pills">
        ${SAUCES.map(saucePill).join("")}</div></fieldset>`;
    }
    html += `<div class="field"><span class="field__label">${esc(t("options.qty"))}</span>
      <div class="qty">
        <button type="button" class="qty__btn" data-step="-1" aria-label="${esc(t("menu.decrease", { name: L(it) }))}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path stroke="currentColor" stroke-width="2.6" stroke-linecap="round" d="M5 12h14"/></svg></button>
        <output class="roll" id="options-qty"></output>
        <button type="button" class="qty__btn" data-step="1" aria-label="${esc(t("menu.increase", { name: L(it) }))}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path stroke="currentColor" stroke-width="2.6" stroke-linecap="round" d="M5 12h14M12 5v14"/></svg></button>
      </div></div>`;
    $("#options-body").innerHTML = html;
    $("#options-error").textContent = "";
    $("#options-submit").innerHTML = `<span>${esc(t("menu.add"))}</span> · <span class="money" id="options-price"></span>`;
    updateOptionsPrice();
    openDialog($("#options-dialog"));
  }
  function pill(type, name, value, label, checked = false) {
    return `<label class="pill"><input type="${type}" name="${name}" value="${esc(value)}"${checked ? " checked" : ""}><span>${label}</span></label>`;
  }
  function saucePill(s) {
    const swatch = s.color ? `<i class="pill__swatch" style="--sauce:${s.color}"></i>` : "";
    return pill("checkbox", "sauce", s.id, swatch + rich(L(s)));
  }
  function updateOptionsPrice() {
    const it = optionsItem;
    const size = $('#options-body input[name="size"]:checked');
    const price = it.prices ? it.prices[size ? size.value : Object.keys(it.prices)[0]] : it.price;
    Kit.roll($("#options-qty"), optionsQty);
    $('.qty__btn[data-step="-1"]').disabled = optionsQty <= 1;
    Kit.setMoney($("#options-price"), price * optionsQty, C.currency[lang]);
    // Sauce limit: disable the rest once the maximum is ticked.
    const boxes = $$('#options-body input[name="sauce"]');
    const ticked = boxes.filter((b) => b.checked).length;
    boxes.forEach((b) => { b.disabled = !b.checked && ticked >= MAX_SAUCES; });
  }
  function onOptionsStep(e) {
    const b = e.target.closest(".qty__btn");
    if (!b) return;
    optionsQty = Math.max(1, Math.min(50, optionsQty + +b.dataset.step));
    updateOptionsPrice();
  }
  function submitOptions(e) {
    e.preventDefault();
    if (e.submitter && e.submitter.value === "cancel") { closeDialog($("#options-dialog")); return; }
    const it = optionsItem;
    const line = { id: it.id, qty: optionsQty };
    if (it.prices) line.size = $('#options-body input[name="size"]:checked').value;
    if (it.options && it.options.length) {
      line.opts = {};
      for (const o of it.options) {
        const r = $(`#options-body input[name="opt-${o.id}"]:checked`);
        if (!r) { $("#options-error").textContent = t("options.pickRequired", { label: L(o) }); $(`[data-opt="${o.id}"] input`).focus(); return; }
        line.opts[o.id] = r.value;
      }
    }
    const sauces = $$('#options-body input[name="sauce"]:checked').map((b) => b.value);
    if (sauces.length) line.sauces = sauces;
    addLine(line);
    closeDialog($("#options-dialog"));
    sprayEmojis(optionsFrom, it);
  }

  /* ---------- A dish photo, big: a long press on a phone, a click with a mouse ---------- */
  function openPhoto(id) {
    const it = itemById.get(id);
    if (!it || !it.image) return;
    $("#photo-img").src = it.image;
    $("#photo-img").alt = L(it);
    $("#photo-name").innerHTML = rich(L(it));
    $("#photo-desc").innerHTML = it.desc ? rich(L(it.desc)) : "";
    openDialog($("#photo-dialog"));
  }
  let pressTimer = null, pointerType = "";
  function bindPhotos() {
    const list = $("#menu-list");
    const photoOf = (e) => { const img = e.target.closest && e.target.closest(".item__thumb img"); return img && img.closest(".item").dataset.item; };
    const stop = () => { clearTimeout(pressTimer); pressTimer = null; };
    list.addEventListener("pointerdown", (e) => {
      pointerType = e.pointerType;
      const id = photoOf(e);
      stop();
      if (id && e.pointerType !== "mouse") pressTimer = setTimeout(() => { pressTimer = null; openPhoto(id); }, 450);
    });
    // lifting the finger early, or scrolling, is not a long press
    ["pointerup", "pointercancel", "pointerleave"].forEach((ev) => list.addEventListener(ev, stop));
    addEventListener("scroll", stop, { passive: true });
    list.addEventListener("click", (e) => { const id = photoOf(e); if (id && pointerType === "mouse") openPhoto(id); });
    // the phone's own menu for images would open on the same long press
    list.addEventListener("contextmenu", (e) => { if (photoOf(e)) e.preventDefault(); });
    $("#photo-dialog").addEventListener("click", () => closeDialog($("#photo-dialog")));
  }

  /* ---------- Installing the site as an app (home-screen icon, full screen) ---------- */
  // Android browsers offer their own install prompt (kept for our buttons); iPhone Safari has none, so its steps are shown.
  let installPrompt = null;
  const BANNER_PAUSE = 14 * 24 * 3600 * 1000; // after « Plus tard », not again for two weeks
  const isInstalled = () => (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const canInstall = () => !isInstalled() && (!!installPrompt || isIos());
  function renderInstall() {
    $("#install-btn").hidden = !canInstall();
    if (!canInstall()) hideInstallBanner();
  }
  // The banner comes once the customer has looked around (opened a category, or after a while), never over a sheet.
  function offerInstall() {
    if (!canInstall() || !$("#install-banner").hidden || $$("dialog").some((d) => d.open)) return;
    try { if (Date.now() - (+localStorage.getItem(INSTALL_KEY) || 0) < BANNER_PAUSE) return; } catch (e) { /* storage unavailable */ }
    $("#install-banner").hidden = false;
  }
  function hideInstallBanner() { $("#install-banner").hidden = true; }
  function laterInstall() {
    hideInstallBanner();
    try { localStorage.setItem(INSTALL_KEY, String(Date.now())); } catch (e) { /* storage unavailable */ }
  }
  function install() {
    hideInstallBanner();
    if (installPrompt) {
      const p = installPrompt;
      installPrompt = null;
      p.prompt();
      if (p.userChoice) p.userChoice.then(renderInstall, renderInstall); else renderInstall();
    } else if (isIos()) openDialog($("#ios-dialog"));
  }
  function setupInstall() {
    addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; renderInstall(); });
    addEventListener("appinstalled", () => { installPrompt = null; renderInstall(); });
    $("#install-btn").addEventListener("click", install);
    $("#install-banner-btn").addEventListener("click", install);
    $("#install-close").addEventListener("click", laterInstall);
    $("#ios-close").addEventListener("click", () => closeDialog($("#ios-dialog")));
    $("#ios-ok").addEventListener("click", () => closeDialog($("#ios-dialog")));
    setTimeout(offerInstall, 40000);
    renderInstall();
    // Saved copy of the site, so the installed app opens on a weak connection (sw.js).
    if ("serviceWorker" in navigator && window.isSecureContext) {
      addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
    }
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
    // the chosen mode is highlighted by class (older browsers lack :has())
    $$(".mode__opt").forEach((o) => o.classList.toggle("is-checked", $("input", o).checked));
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
  let map = null, youMarker = null, youPos = null, restoMarker = null, restoCircle = null;
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
      const resto = [S().location.lat, S().location.lng];
      if (!map) {
        map = Lf.map("delivery-map", { zoomControl: true, attributionControl: true }).setView(resto, 14);
        Lf.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
        restoMarker = Lf.marker(resto, { icon: pinIcon("pin--resto"), title: t("checkout.restaurant") }).addTo(map);
        restoCircle = Lf.circle(resto, { radius: C.delivery.maxKm * 1000, color: "#e1060f", weight: 2, fillOpacity: 0.06 }).addTo(map);
        map.on("click", (e) => setYou(e.latlng.lat, e.latlng.lng));
        if (youPos) setYou(youPos.lat, youPos.lng, false);
      }
      setTimeout(() => map.invalidateSize(), 60);
    }).catch(() => {});
  }
  // After a change of restaurant, the pin and the delivery circle move to it.
  function moveMapToSite() {
    if (!map) return;
    const resto = [S().location.lat, S().location.lng];
    restoMarker.setLatLng(resto);
    restoCircle.setLatLng(resto);
    map.setView(youPos ? [youPos.lat, youPos.lng] : resto, 14);
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
    const km = distanceKm(S().location, youPos);
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
    const lines = [`*${M("title")}*`, `${M("restaurant")}${sep}${L(S().name)}`];
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
    const off = cart.map((l) => itemById.get(l.id)).find((it) => !isAvailable(it));
    if (off) { err.textContent = availText(availOf(off), "checkout.unavailable", { name: L(off) }); return; }
    const st = updateDeliveryStatus();
    if (!st.ok) { err.textContent = st.msg; return; }
    saveCustomer(data);
    const url = `https://wa.me/${S().whatsapp}?text=${encodeURIComponent(buildMessage(data, st))}`;
    const w = window.open(url, "_blank", "noopener");
    if (!w) location.href = url;
  }

  /* ---------- Events ---------- */
  function bind() {
    $("#lang-toggle").addEventListener("click", switchLanguage);
    $("#catbar-track").addEventListener("click", (e) => { const b = e.target.closest("[data-cat]"); if (b && b.dataset.cat !== currentCat) openCategory(b.dataset.cat); });
    $("#cat-grid").addEventListener("click", (e) => { const b = e.target.closest("[data-open-cat]"); if (b) openCategory(b.dataset.openCat); });
    $("#cat-band").addEventListener("click", (e) => { const b = e.target.closest("[data-open-cat]"); if (b) openCategory(b.dataset.openCat); });
    $("#back-to-cats").addEventListener("click", () => showCategories());
    $("#menu-list").addEventListener("click", (e) => { const b = e.target.closest("[data-add]"); if (b) onAdd(b.dataset.add, b); });
    $("#order-btn").addEventListener("click", (e) => { e.preventDefault(); if (currentCat) showCategories(); else scrollToMenu(); });
    $$('.header__nav a[href="#menu"]').forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); scrollToMenu(); }));
    addEventListener("popstate", onPopState);
    $("#options-form").addEventListener("submit", submitOptions);
    $("#options-body").addEventListener("change", updateOptionsPrice);
    $("#options-body").addEventListener("click", onOptionsStep);
    $("#sauce-form").addEventListener("submit", submitSauces);
    $("#sauce-list").addEventListener("change", updateSauceLimit);
    $("#sauce-skip").addEventListener("click", () => finishSauces([]));
    $("#sauce-dialog").addEventListener("close", () => { sauceItem = null; });
    $("#cart-btn").addEventListener("mouseenter", () => { if (!count()) animateCart(true); });
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
    bindPhotos();
    $("#site-btn").addEventListener("click", openSites);
    $("#site-gps").addEventListener("click", findNearestSite);
    $("#site-close").addEventListener("click", () => closeDialog($("#site-dialog")));
    $("#site-list").addEventListener("click", (e) => { const b = e.target.closest("[data-site]"); if (b) chooseSite(b.dataset.site); });
    $$("[data-change-site]").forEach((b) => b.addEventListener("click", openSites));
    // Escape cannot dismiss the first choice of restaurant.
    $("#site-dialog").addEventListener("cancel", (e) => { if ($("#site-dialog").dataset.locked) e.preventDefault(); });
    $("#send-btn").addEventListener("click", send);
    $$("dialog").forEach((d) => {
      d.addEventListener("close", onDialogClose);
      d.addEventListener("click", (e) => { if (e.target === d && !d.dataset.locked) closeDialog(d); }); // click on the backdrop
    });
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    setInterval(() => { updateStatus(); refreshControls(); }, 30000);
  }

  /* ---------- Start ---------- */
  setupHero();
  bind();
  setupInstall();
  loadCustomer();
  currentCat = catFromHash();
  applyLanguage();
  runIntro();
  updateHeader();
  if (currentCat) requestAnimationFrame(scrollToMenu);

  // Exposed for the automated tests.
  window.__chickenAmine = { isOpen, isAvailable: (id) => isAvailable(itemById.get(id)), distanceKm, cart: () => cart, lineKey, site: () => site && site.id };
})();
